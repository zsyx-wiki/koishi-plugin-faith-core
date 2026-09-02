import type { Context } from "koishi";
import { CORE_FAITHS } from "../data/faiths";
import type { FaithHooksService } from "../hooks";
import type { KeyedLockService } from "../lock";
import type { FaithProfessionService } from "../professions";
import type { FaithDefinition, IdentityInput } from "../types";
import type { FaithIdentityService } from "../services/identity";
import type { FaithUsersService } from "../services/users";
import { normalizeFaiths } from "../services/users";
import { FaithRegistryServiceBase } from "./registry";
import type { FaithAuditService } from "../services/audit";
import { FaithCoreError } from "../errors";

export class FaithRegistryService extends FaithRegistryServiceBase {
  constructor(private ctx: Context, private identities: FaithIdentityService, private users: FaithUsersService, private professions: FaithProfessionService, private locks: KeyedLockService, private hooks: FaithHooksService, private defaultInitialGold = 300, private audit?: FaithAuditService) {
    super(); this.registerMany(CORE_FAITHS);
  }

  configureRegistration(initialGold: number) {
    if (!Number.isSafeInteger(initialGold) || initialGold < 0 || initialGold > 1_000_000_000) throw new FaithCoreError("VALIDATION_FAILED", "初始金币配置无效");
    this.defaultInitialGold = initialGold;
  }

  async load() {
    for (const row of await this.ctx.database.get("faith_core_faiths", {})) {
      this.register({ name: row.name, path: row.path, type: "dynamic", creator_uid: row.creator_uid, believer_count: row.believer_count, prayer_word: row.prayer_word || undefined, custom_professions: row.custom_professions ?? {}, metadata: row.metadata ?? {} }, { override: true });
      this.registerCustomProfessions(row.name, row.custom_professions ?? {});
    }
    for (const stat of await this.ctx.database.get("faith_core_faith_stats", {})) {
      const faith = this.get(stat.name); if (faith) this.register({ ...faith, believer_count: stat.believer_count }, { override: true });
    }
  }

  async registerUser(identity: IdentityInput, faithName: string, initialGold = this.defaultInitialGold) {
    const faith = this.require(faithName.trim());
    if (!Number.isSafeInteger(initialGold) || initialGold < 0) throw new Error("初始金币必须是非负安全整数");
    let believerCount: number | undefined;
    const uid = await this.identities.createUser(identity, async (targetUid, database) => {
      const user = await this.users.require(targetUid, database);
      if (user.faiths[0]) throw new Error(`用户已经注册信仰：${user.faiths[0]}`);
      const transactionId = this.audit ? await this.audit.begin(database, { source: "faith.register" }) : null;
      const write = await database.set("faith_core_users_data", { uid: targetUid, gold: user.gold }, { faiths: normalizeFaiths([faith.name]), gold: initialGold, updated_at: new Date() });
      if (write.matched !== 1) throw new FaithCoreError("TRANSACTION_CONFLICT", "注册数据已被其他实例修改，请重试", { uid: targetUid });
      if (transactionId && initialGold) await this.audit!.entry(database, transactionId, targetUid, "gold", user.gold, initialGold);
      believerCount = await this.adjustBelieverCount(database, faith.name, 1);
    });
    await this.refreshCount(faith.name, believerCount);
    const user = await this.users.require(uid);
    await this.hooks.emit("user/registered", { uid, faith: faith.name, user });
    await this.hooks.emit("user/faiths-changed", { uid, oldFaith: null, newFaith: faith.name, after: user });
    return user;
  }

  async registerDynamic(input: { name: string; path: string; creatorUid: number; prayerWord?: string; metadata?: Record<string, unknown> }) {
    if (this.has(input.name)) throw new Error(`信仰已存在：${input.name}`);
    await this.users.require(input.creatorUid);
    const definition = this.register({ name: input.name, path: input.path, type: "dynamic", creator_uid: input.creatorUid, believer_count: 1, prayer_word: input.prayerWord?.trim() || undefined, custom_professions: {}, metadata: input.metadata ?? {} });
    try {
      await this.ctx.database.create("faith_core_faiths", {
        name: definition.name, path: definition.path, type: "dynamic", creator_uid: input.creatorUid,
        believer_count: 1, prayer_word: definition.prayer_word ?? "", custom_professions: {}, metadata: definition.metadata ?? {}, created_at: new Date(),
      });
    } catch (error) { this.unregister(definition.name); throw error; }
    await this.hooks.emit("faith/registered", definition); return definition;
  }

  async setPrayerWord(name: string, word: string) {
    const faith = this.requireDynamic(name), value = word.trim();
    if (value.length > 1024) throw new Error("祷词不能超过 1024 字符");
    const write = await this.ctx.database.set("faith_core_faiths", { name: faith.name }, { prayer_word: value });
    if (write.matched !== 1) throw new FaithCoreError("DATA_INTEGRITY_ERROR", `动态信仰数据库记录不存在：${faith.name}`);
    const updated = this.register({ ...faith, prayer_word: value || undefined }, { override: true });
    await this.hooks.emit("faith/updated", updated); return updated;
  }

  async setCustomProfession(name: string, type: string, professionName: string) {
    const faith = this.requireDynamic(name), custom = { ...(faith.custom_professions ?? {}), [type.trim()]: professionName.trim() };
    const definition = { id: professionName.trim(), name: professionName.trim(), type: type.trim(), faith: faith.name, source: `faith:${faith.name}` };
    const owner = `faith:${faith.name}`, previous = this.professions.get(definition.id);
    this.professions.register(definition, { owner, override: !!previous });
    try {
      const write = await this.ctx.database.set("faith_core_faiths", { name: faith.name }, { custom_professions: custom });
      if (write.matched !== 1) throw new FaithCoreError("DATA_INTEGRITY_ERROR", `动态信仰数据库记录不存在：${faith.name}`);
    } catch (error) {
      if (previous) this.professions.register(previous, { owner, override: true }); else this.professions.unregister(definition.id, owner);
      throw error;
    }
    const updated = this.register({ ...faith, custom_professions: custom }, { override: true });
    await this.hooks.emit("faith/updated", updated); return updated;
  }

  async adjustBelieverCount(database: import("../services").CoreDatabase, name: string, delta: number) {
    const faith = this.require(name);
    if (!Number.isSafeInteger(delta)) throw new Error("信徒数量变化必须是安全整数");
    for (let attempt = 0; attempt < 16; attempt++) {
      const [row] = await database.get("faith_core_faith_stats", { name });
      const before = row?.believer_count ?? faith.believer_count;
      const count = Math.max(0, before + delta);
      if (row) {
        const result = await database.set("faith_core_faith_stats", { name, believer_count: before }, { believer_count: count, updated_at: new Date() });
        if (result.matched !== 1) continue;
      } else {
        try { await database.create("faith_core_faith_stats", { name, believer_count: count, updated_at: new Date() }); }
        catch (error) {
          if ((await database.get("faith_core_faith_stats", { name })).length) continue;
          throw error;
        }
      }
      if (faith.type === "dynamic") await database.set("faith_core_faiths", { name }, { believer_count: count });
      return count;
    }
    throw new FaithCoreError("TRANSACTION_CONFLICT", "信徒计数发生持续并发冲突，请重试", { faith: name });
  }
  async refreshCount(name: string, knownCount?: number) {
    const count = knownCount ?? (await this.ctx.database.get("faith_core_faith_stats", { name }, { fields: ["believer_count"], limit: 1 }))[0]?.believer_count;
    if (count !== undefined) this.register({ ...this.require(name), believer_count: count }, { override: true });
  }
  async recountBelievers() {
    const users = await this.ctx.database.get("faith_core_users_data", {}, { fields: ["faiths"] }), counts = new Map<string, number>();
    for (const user of users) if (user.faiths[0]) counts.set(user.faiths[0], (counts.get(user.faiths[0]) ?? 0) + 1);
    for (const faith of this.all()) await this.ctx.database.upsert("faith_core_faith_stats", [{ name: faith.name, believer_count: counts.get(faith.name) ?? 0, updated_at: new Date() }], ["name"]);
    for (const faith of this.all()) await this.refreshCount(faith.name);
    return Object.fromEntries(counts);
  }
  async verifyBelieverCounts() {
    const users = await this.ctx.database.get("faith_core_users_data", {}, { fields: ["faiths"] }), actual = new Map<string, number>();
    for (const user of users) if (user.faiths[0]) actual.set(user.faiths[0], (actual.get(user.faiths[0]) ?? 0) + 1);
    return this.all().flatMap((faith) => faith.believer_count === (actual.get(faith.name) ?? 0) ? [] : [{ faith: faith.name, stored: faith.believer_count, actual: actual.get(faith.name) ?? 0 }]);
  }

  private requireDynamic(name: string) { const faith = this.require(name); if (faith.type !== "dynamic") throw new Error(`固定信仰不支持此操作：${name}`); return faith; }
  private registerCustomProfessions(faith: string, values: Record<string, string>) {
    for (const [type, name] of Object.entries(values)) this.professions.register({ id: name, name, type, faith, source: `faith:${faith}` }, { owner: `faith:${faith}`, override: !!this.professions.get(name) });
  }
}
