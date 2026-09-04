import { Context } from "koishi";
import { FaithHooksService } from "../../hooks";
import { KeyedLockService } from "../../lock";
import type { IdentityInput } from "../../types";
import { normalizeIdentity } from "./validation";
import { FaithTransactionService, type CoreDatabase } from "../transaction";
import { FaithUidService } from "./uid";
import { FaithUsersService } from "../users";
import { FaithCoreError } from "../../errors";

export class FaithIdentityService {
  private resolved = new Map<string, number | null>();
  private pending = new Map<string, Promise<number | null>>();
  constructor(
    private ctx: Context,
    private transactions: FaithTransactionService,
    private locks: KeyedLockService,
    private hooks: FaithHooksService,
    private uids: FaithUidService,
    private users: FaithUsersService,
  ) {}

  normalize(input: IdentityInput) { return normalizeIdentity(input); }

  async resolve(input: IdentityInput, database: CoreDatabase = this.ctx.database): Promise<number | null> {
    const identity = normalizeIdentity(input);
    if (database !== this.ctx.database) return this.resolveFromDatabase(identity, database);
    const key = identityCacheKey(identity);
    if (this.resolved.has(key)) return this.resolved.get(key)!;
    const active = this.pending.get(key);
    if (active) return active;
    const work = this.resolveFromDatabase(identity, database).then((uid) => {
      if (this.resolved.size >= 10_000) this.resolved.delete(this.resolved.keys().next().value!);
      this.resolved.set(key, uid);
      return uid;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }

  async createUser(input: IdentityInput, initialize?: (uid: number, database: CoreDatabase, created: boolean) => Promise<void>) {
    const normalized = normalizeIdentity(input);
    const denied = await this.hooks.bailStrict<typeof normalized, boolean>("identity/before-create-user", normalized);
    if (denied === false) throw new Error("用户创建被 Hook 拒绝");
    const lockKey = identityLockKey(normalized);
    const result = await this.locks.run("uid:allocate", () =>
      this.locks.run(lockKey, () => this.transactions.run(async (database) => {
        const existing = await this.resolve(input, database);
        if (existing !== null) {
          await initialize?.(existing, database, false);
          return { uid: existing, created: false };
        }
        const uid = await this.uids.allocate(database);
        await this.users.create(uid, database);
        await this.bindRow(uid, input, database);
        await initialize?.(uid, database, true);
        return { uid, created: true };
      })));
    if (result.created) {
      await this.hooks.emit("user/created", { uid: result.uid });
      await this.hooks.emit("identity/bound", { uid: result.uid, identity: normalized });
    }
    return result.uid;
  }

  async bind(uid: number, input: IdentityInput) {
    const normalized = normalizeIdentity(input);
    const denied = await this.hooks.bailStrict("identity/before-bind", Object.freeze({ uid, identity: normalized }));
    if (denied === false) throw new Error("身份绑定被 Hook 拒绝");
    const lockKey = identityLockKey(normalized);
    const created = await this.locks.run(lockKey, () =>
      this.transactions.run(async (database) => this.bindRow(uid, input, database)));
    if (created) await this.hooks.emit("identity/bound", { uid, identity: normalized });
    return created;
  }

  async list(uid: number) {
    await this.users.require(uid);
    return this.ctx.database.get("faith_core_users", { uid }, { sort: { id: "asc" } });
  }

  /** 只删除指定身份映射；用户数据、背包及业务数据不参与该事务。 */
  async unbind(uid: number, input: IdentityInput) {
    const identity = normalizeIdentity(input);
    const removed = await this.locks.run(identityLockKey(identity), () => this.transactions.run(async (database) => {
      await this.users.require(uid, database, { allowInactive: true });
      const existing = await this.resolve(identity, database);
      if (existing === null) return false;
      if (existing !== uid) throw new FaithCoreError("IDENTITY_ALREADY_BOUND", `此外部身份属于 UID ${existing}`, { existingUid: existing });
      const result = await database.remove("faith_core_users", { ...identityQuery(identity), uid });
      return result.matched === 1;
    }));
    if (removed) {
      this.invalidate(identity);
      await this.hooks.emit("identity/unbound", { uid, identity });
    }
    return removed;
  }

  private async bindRow(uid: number, input: IdentityInput, database: CoreDatabase) {
    await this.users.require(uid, database);
    const identity = normalizeIdentity(input);
    const existing = await this.resolve(input, database);
    if (existing !== null && existing !== uid) throw new FaithCoreError("IDENTITY_ALREADY_BOUND", `此外部身份已经绑定 UID ${existing}`, { existingUid: existing });
    if (existing === uid) return false;
    try {
      await database.create("faith_core_users", { uid, ...identityQuery(identity) });
    } catch (error) {
      const owner = await this.resolve(identity, database);
      if (owner !== null) throw new FaithCoreError("IDENTITY_ALREADY_BOUND", `此外部身份已经绑定 UID ${owner}`, { existingUid: owner }, { cause: error });
      throw error;
    }
    this.invalidate(identity);
    return true;
  }

  private async resolveFromDatabase(identity: ReturnType<typeof normalizeIdentity>, database: CoreDatabase) {
    const [row] = await database.get("faith_core_users", identityQuery(identity), { fields: ["uid"], limit: 1 });
    return row?.uid ?? null;
  }

  private invalidate(identity: ReturnType<typeof normalizeIdentity>) {
    this.resolved.delete(identityCacheKey(identity));
  }
}

function identityQuery(identity: ReturnType<typeof normalizeIdentity>) {
  return { adapter: identity.adapter, type: identity.type, value: identity.value, scope: identity.scope, scope_value: identity.scopeValue };
}
function identityLockKey(identity: ReturnType<typeof normalizeIdentity>) {
  return `identity:${JSON.stringify([identity.adapter, identity.type, identity.scope, identity.scopeValue, identity.value])}`;
}
function identityCacheKey(identity: ReturnType<typeof normalizeIdentity>) {
  return JSON.stringify([identity.adapter, identity.type, identity.scope, identity.scopeValue, identity.value]);
}
