import { Context } from "koishi";
import { FaithHooksService } from "../hooks";
import { KeyedLockService } from "../lock";
import type { FaithCoreUserData, UserValueDelta } from "../types";
import { FaithTransactionService, type CoreDatabase } from "./transaction";
import { assertUid } from "./validation";
import type { FaithBonusService } from "../bonus";
import { FaithCoreError } from "../errors";
import type { FaithAuditService } from "./audit";
import type { FaithRegistryService } from "../faith";

export interface UserChangeOptions { source?: string; isFixed?: boolean; metadata?: Readonly<Record<string, unknown>>; }

export class FaithUsersService {
  private bonuses?: FaithBonusService;
  private faithRegistry?: FaithRegistryService;
  constructor(
    private ctx: Context,
    private transactions: FaithTransactionService,
    private locks: KeyedLockService,
    private hooks: FaithHooksService,
    private audit: FaithAuditService,
  ) {}

  attachBonuses(service: FaithBonusService) { this.bonuses = service; }
  attachFaiths(service: FaithRegistryService) { this.faithRegistry = service; }

  async get(uid: number, database: CoreDatabase = this.ctx.database) {
    assertUid(uid);
    const [data] = await database.get("faith_core_users_data", { uid });
    return data ?? null;
  }

  async require(uid: number, database: CoreDatabase = this.ctx.database, options: { allowInactive?: boolean } = {}) {
    const data = await this.get(uid, database);
    if (!data) throw new FaithCoreError("USER_NOT_FOUND", `UID 不存在：${uid}`, { uid });
    if (!options.allowInactive && data.status && data.status !== "active") throw new FaithCoreError("USER_DISABLED", `用户 ${uid} 当前状态为 ${data.status}`, { uid, status: data.status });
    return data;
  }

  async exists(uid: number) { return !!await this.get(uid); }
  async count(status?: FaithCoreUserData["status"]) { return (await this.ctx.database.get("faith_core_users_data", status ? { status } : {}, { fields: ["uid"] })).length; }
  list(options: { status?: FaithCoreUserData["status"]; offset?: number; limit?: number } = {}) {
    const limit = options.limit ?? 50, offset = options.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0) throw new FaithCoreError("VALIDATION_FAILED", "用户分页参数无效");
    return this.ctx.database.get("faith_core_users_data", options.status ? { status: options.status } : {}, { limit, offset, sort: { uid: "asc" } });
  }
  batchGet(uids: readonly number[]) {
    if (uids.length > 500) throw new FaithCoreError("VALIDATION_FAILED", "单次最多查询 500 个 UID");
    const unique = [...new Set(uids)];
    unique.forEach(assertUid);
    return unique.length ? this.ctx.database.get("faith_core_users_data", { uid: unique }) : Promise.resolve([]);
  }
  async getPublicProfile(uid: number) { const user = await this.require(uid); return Object.freeze({ uid: user.uid, faiths: [...user.faiths], profession_id: user.profession_id, ascension_score: user.ascension_score, audience_score: user.audience_score, audience_rank: user.audience_rank }); }
  setStatus(uid: number, status: FaithCoreUserData["status"], reason = "") {
    if (!["active", "disabled", "closed"].includes(status) || reason.length > 255) throw new FaithCoreError("VALIDATION_FAILED", "用户状态无效");
    return this.locks.run(`uid:${uid}`, () => this.transactions.run(async (database) => {
      await this.require(uid, database, { allowInactive: true });
      const result = await database.set("faith_core_users_data", { uid }, { status, status_reason: reason, updated_at: new Date() });
      if (result.matched !== 1) throw new FaithCoreError("TRANSACTION_CONFLICT", "用户状态已被其他实例修改，请重试", { uid });
      return this.require(uid, database, { allowInactive: true });
    }));
  }
  disable(uid: number, reason: string) { return this.setStatus(uid, "disabled", reason); }
  enable(uid: number) { return this.setStatus(uid, "active", ""); }
  close(uid: number, reason: string) { return this.setStatus(uid, "closed", reason); }

  async create(uid: number, database: CoreDatabase) {
    assertUid(uid);
    return database.create("faith_core_users_data", {
      uid,
      faiths: [],
      abandon_count: 0,
      profession_id: "",
      gold: 0,
      ascension_score: 0,
      audience_score: 0,
      audience_rank: 0,
      status: "active",
      status_reason: "",
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  currentFaith(user: FaithCoreUserData) { return user.faiths[0] ?? null; }

  async setFaiths(uid: number, faiths: readonly string[]) {
    const normalized = normalizeFaiths(faiths);
    if (this.faithRegistry) for (const faith of normalized) this.faithRegistry.require(faith);
    const result = await this.locks.run(`uid:${uid}`, () => this.transactions.run(async (database) => {
      const before = await this.require(uid, database);
      const oldFaith = before.faiths[0] ?? null, newFaith = normalized[0] ?? null;
      let oldCount: number | undefined, newCount: number | undefined;
      if (oldFaith !== newFaith && this.faithRegistry) {
        if (oldFaith) oldCount = await this.faithRegistry.adjustBelieverCount(database, oldFaith, -1);
        if (newFaith) newCount = await this.faithRegistry.adjustBelieverCount(database, newFaith, 1);
      }
      await assertUserWrite(database, { uid, faiths: before.faiths }, { faiths: normalized });
      return { before, after: { ...before, faiths: normalized }, oldCount, newCount };
    }));
    if (this.faithRegistry && result.before.faiths[0] !== result.after.faiths[0]) {
      if (result.before.faiths[0]) await this.faithRegistry.refreshCount(result.before.faiths[0], result.oldCount);
      if (result.after.faiths[0]) await this.faithRegistry.refreshCount(result.after.faiths[0], result.newCount);
    }
    await this.hooks.emit("user/faiths-changed", { uid, ...result, oldFaith: result.before.faiths[0] ?? null, newFaith: result.after.faiths[0] ?? null });
    return result.after;
  }

  async replaceCurrentFaith(uid: number, faith: string) {
    const user = await this.require(uid);
    const next = normalizeFaith(faith);
    return this.setFaiths(uid, [next, ...user.faiths.slice(1).filter((item) => item !== next)]);
  }

  /** Core 只提交弃誓状态：更换当前信仰并将次数加一，不计算玩法费用。 */
  async abandonFaith(uid: number, faith: string) {
    const next = normalizeFaith(faith);
    const result = await this.locks.run(`uid:${uid}`, () => this.transactions.run(async (database) => {
      const transactionId = await this.audit.begin(database, { source: "faith.abandon" });
      const before = await this.require(uid, database), oldFaith = before.faiths[0] ?? null;
      if (!oldFaith) throw new Error("用户当前没有信仰，请使用首次信仰设置流程");
      if (oldFaith === next) throw new Error(`当前信仰已经是：${next}`);
      const faiths = normalizeFaiths([next, ...before.faiths.slice(1).filter((item) => item !== next)]);
      const after: FaithCoreUserData = { ...before, faiths, abandon_count: before.abandon_count + 1 };
      const patch = { faiths, abandon_count: after.abandon_count, updated_at: new Date() };
      await assertUserWrite(database, { uid, faiths: before.faiths, abandon_count: before.abandon_count }, patch);
      const oldCount = this.faithRegistry ? await this.faithRegistry.adjustBelieverCount(database, oldFaith, -1) : undefined;
      const newCount = this.faithRegistry ? await this.faithRegistry.adjustBelieverCount(database, next, 1) : undefined;
      await this.audit.entry(database, transactionId, uid, "abandon_count", before.abandon_count, after.abandon_count);
      return { before, after, oldFaith, newFaith: next, oldCount, newCount };
    }));
    if (this.faithRegistry) { await this.faithRegistry.refreshCount(result.oldFaith, result.oldCount); await this.faithRegistry.refreshCount(result.newFaith, result.newCount); }
    await this.hooks.emit("user/faiths-changed", { uid, ...result });
    await this.hooks.emit("user/faith-changed", { uid, ...result });
    await this.hooks.emit("user/values-changed", { uid, before: result.before, after: result.after, source: "faith-abandon", delta: { abandon_count: 1 } });
    return result;
  }

  async change(uid: number, delta: UserValueDelta, options: UserChangeOptions = {}) {
    this.validateDelta(delta);
    const requested = await this.hooks.waterfallStrict("user/before-values-change", Object.freeze({ uid, delta: Object.freeze({ ...delta }), options: Object.freeze({ ...options }) }));
    this.validateDelta(requested.delta);
    const applied = await this.applyBonuses(uid, requested.delta, requested.options);
    const result = await this.locks.run(`uid:${uid}`, () =>
      this.transactions.run(async (database) => {
        const transactionId = await this.audit.begin(database, { source: options.source ?? "user.change", metadata: options.metadata as Record<string, unknown> | undefined });
        const before = await this.require(uid, database);
        const after: FaithCoreUserData = { ...before };
        for (const key of Object.keys(applied) as (keyof UserValueDelta)[]) {
          const value = applied[key];
          if (value !== undefined) after[key] += value;
        }
        validateUserValues(after);
        if (after.gold < 0) throw new FaithCoreError("INSUFFICIENT_BALANCE", "金币余额不足", { uid });
        if (after.abandon_count < 0 || !Number.isSafeInteger(after.abandon_count)) throw new Error("弃誓次数不能为负数且必须是安全整数");
        const patch = Object.fromEntries(Object.keys(applied).map((key) => [key, after[key as keyof UserValueDelta]]));
        await assertUserWrite(database, userValueQuery(before), { ...patch, updated_at: new Date() });
        for (const key of Object.keys(applied) as (keyof UserValueDelta)[]) if (applied[key]) await this.audit.entry(database, transactionId, uid, key, Number(before[key]), Number(after[key]));
        return { before, after };
      }));
    await this.hooks.emit("user/values-changed", { uid, ...result, requestedDelta: requested.delta, delta: applied, source: requested.options.source });
    return result.after;
  }

  private async applyBonuses(uid: number, delta: UserValueDelta, options: UserChangeOptions) {
    if (options.isFixed || !this.bonuses) return { ...delta };
    const applied = { ...delta };
    const targets = (["gold", "ascension_score", "audience_score"] as const).filter((type) => delta[type] !== undefined && delta[type]! > 0);
    if (!targets.length) return applied;
    const user = await this.require(uid);
    const calculations = await Promise.all(targets.map((type) => this.bonuses!.calculateForUser(user, { uid, type, baseValue: delta[type]!, source: options.source, metadata: options.metadata })));
    for (let index = 0; index < targets.length; index++) {
      const type = targets[index];
      const value = delta[type];
      if (value !== undefined) applied[type] = calculations[index].finalValue;
    }
    return applied;
  }

  private validateDelta(delta: UserValueDelta) {
    const entries = Object.entries(delta);
    if (!entries.length) throw new Error("数值变更不能为空");
    for (const [key, value] of entries) {
      if (!USER_VALUE_FIELDS.has(key)) throw new Error(`不允许修改用户数值字段：${key}`);
      if (!Number.isFinite(value)) throw new Error(`数值变更必须是有限数字：${key}`);
      if ((key === "audience_rank" || key === "abandon_count") && !Number.isSafeInteger(value)) throw new Error(`${key} 变更必须是安全整数`);
    }
  }
}

const USER_VALUE_FIELDS = new Set(["gold", "ascension_score", "audience_score", "audience_rank", "abandon_count"]);
function userValueQuery(user: FaithCoreUserData) { return { uid: user.uid, gold: user.gold, ascension_score: user.ascension_score, audience_score: user.audience_score, audience_rank: user.audience_rank, abandon_count: user.abandon_count }; }
function validateUserValues(user: FaithCoreUserData) {
  for (const key of USER_VALUE_FIELDS) if (!Number.isFinite(user[key as keyof UserValueDelta]) || Math.abs(user[key as keyof UserValueDelta]) > Number.MAX_SAFE_INTEGER) throw new FaithCoreError("VALIDATION_FAILED", `数值运算溢出或超出安全范围：${key}`);
  if (!Number.isSafeInteger(user.audience_rank) || user.audience_rank < 0) throw new FaithCoreError("VALIDATION_FAILED", "觐见之梯必须是非负安全整数");
}
async function assertUserWrite(database: CoreDatabase, query: Record<string, unknown>, patch: Record<string, unknown>) {
  const result = await database.set("faith_core_users_data", query as never, patch as never);
  if (result.matched !== 1) throw new FaithCoreError("TRANSACTION_CONFLICT", "用户数据已被其他实例修改，请重试", { uid: Number(query.uid) });
}
export function normalizeFaiths(faiths: readonly string[]) {
  if (!Array.isArray(faiths) || faiths.length > 64) throw new Error("信仰数组最多包含 64 项");
  const result = faiths.map(normalizeFaith);
  if (new Set(result).size !== result.length) throw new Error("信仰数组不能包含重复信仰");
  return result;
}
function normalizeFaith(faith: string) {
  if (typeof faith !== "string") throw new TypeError("信仰名称必须是字符串");
  const value = faith.trim();
  if (!value || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("信仰名称必须是 1-64 个有效字符");
  return value;
}
