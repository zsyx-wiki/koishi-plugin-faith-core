import type { FaithHooksService } from "../hooks";
import { FaithInventoryRepository } from "../items/repository";
import { createInventoryMutation } from "../items/validation";
import type { FaithItemsService } from "../items";
import type { FaithProfessionService } from "../professions";
import type { FaithRegistryService } from "../faith";
import { FaithCoreError } from "../errors";
import type { KeyedLockService } from "../lock";
import type { FaithCoreBusinessData, FaithCoreUserData, InventoryMutation, UserValueDelta } from "../types";
import { assertBusinessName, cloneBusinessRecord } from "./validation";
import { assertUid } from "./validation";
import type { FaithUsersService } from "./users";
import { normalizeFaiths } from "./users";
import type { CoreDatabase, FaithTransactionService } from "./transaction";
import type { FaithAuditService, FaithTransactionOptions } from "./audit";
import type { FaithCurrency, FaithMoney, FaithWallet } from "../economy";

export interface FaithAtomicUserApi {
  get(): Promise<FaithCoreUserData>;
  change(delta: UserValueDelta): Promise<FaithCoreUserData>;
  setFaiths(faiths: readonly string[]): Promise<FaithCoreUserData>;
  abandonFaith(newFaith: string): Promise<FaithCoreUserData>;
  setProfession(profession: string | null): Promise<FaithCoreUserData>;
}

export interface FaithAtomicItemsApi {
  getQuantity(item: string): Promise<number>;
  getStacks(): Promise<readonly import("../types").InventoryStack[]>;
  give(item: string, quantity?: number): Promise<InventoryMutation>;
  take(item: string, quantity?: number): Promise<InventoryMutation>;
  setQuantity(item: string, quantity: number): Promise<InventoryMutation>;
}

export interface FaithAtomicBusinessDataApi {
  get(): Promise<FaithCoreBusinessData>;
  set(data: { private?: Record<string, unknown>; public?: Record<string, unknown> }): Promise<FaithCoreBusinessData>;
}

export interface FaithAtomicScope {
  readonly uid: number;
  readonly users: FaithAtomicUserApi;
  readonly items: FaithAtomicItemsApi;
  readonly data: FaithAtomicBusinessDataApi;
  readonly economy: FaithAtomicEconomyApi;
  afterCommit(callback: () => void | Promise<void>): void;
  afterRollback(callback: (error: unknown) => void | Promise<void>): void;
}

export interface FaithAtomicEconomyApi {
  getWallet(): Promise<FaithWallet>;
  canAfford(cost: Readonly<FaithMoney>): Promise<boolean>;
  pay(cost: Readonly<FaithMoney>): Promise<FaithCoreUserData>;
  /** 固定值入账，用于退款、奖池返还或已在事务外计算过加成的奖励。 */
  creditFixed(amount: Readonly<FaithMoney>): Promise<FaithCoreUserData>;
}

/** 仅向 Business 暴露白名单操作，绝不泄露 Koishi Database/Transaction。 */
export class FaithBusinessTransactionService {
  private inventory = new FaithInventoryRepository();

  constructor(
    private transactions: FaithTransactionService,
    private locks: KeyedLockService,
    private hooks: FaithHooksService,
    private users: FaithUsersService,
    private items: FaithItemsService,
    private professions: FaithProfessionService,
    private audit: FaithAuditService,
    private faiths: FaithRegistryService,
  ) {}

  async run<T>(business: string, uid: number, task: (scope: FaithAtomicScope) => Promise<T>, options: FaithTransactionOptions = {}): Promise<T> {
    return this.runMany(business, [uid], async (scopes) => task(scopes.get(uid)!), options);
  }

  async runMany<T>(business: string, uids: readonly number[], task: (scopes: ReadonlyMap<number, FaithAtomicScope>) => Promise<T>, options: FaithTransactionOptions = {}): Promise<T> {
    assertBusinessName(business);
    const uniqueUids = [...new Set(uids)].sort((a, b) => a - b);
    if (!uniqueUids.length || uniqueUids.length > 32) throw new Error("原子事务 UID 数量必须是 1-32");
    uniqueUids.forEach(assertUid);
    if (typeof task !== "function") throw new TypeError("原子事务任务必须是函数");
    const mutations: InventoryMutation[] = [];
    const userChanges: Array<{ before: FaithCoreUserData; after: FaithCoreUserData; delta: UserValueDelta }> = [];
    const postEvents: Array<{ event: string; payload: unknown }> = [];
    const afterCommit: Array<() => void | Promise<void>> = [], afterRollback: Array<(error: unknown) => void | Promise<void>> = [];
    let result: T;
    try {
      result = await this.locks.runMany(uniqueUids.map((uid) => `uid:${uid}`), () => this.transactions.run(async (database) => {
        for (const uid of uniqueUids) await this.users.require(uid, database);
        const transactionId = await this.audit.begin(database, { ...options, business });
        const state = { active: true };
        try {
          const scopes = new Map(uniqueUids.map((uid) => [uid, this.createScope(database, business, uid, mutations, userChanges, postEvents, state, afterCommit, afterRollback)]));
          const output = await task(scopes);
          for (const change of userChanges) for (const [key, delta] of Object.entries(change.delta)) if (delta) await this.audit.entry(database, transactionId, change.after.uid, key, Number(change.before[key as keyof FaithCoreUserData]), Number(change.after[key as keyof FaithCoreUserData]));
          for (const mutation of mutations) await this.audit.entry(database, transactionId, mutation.uid, `item:${mutation.item_id}`, mutation.before, mutation.after);
          return output;
        } finally { state.active = false; }
      }));
    } catch (error) {
      const failures: unknown[] = [];
      for (const callback of afterRollback) try { await callback(error); } catch (callbackError) { failures.push(callbackError); }
      if (failures.length) throw new AggregateError([error, ...failures], "事务失败，且回滚回调执行异常", { cause: error });
      throw error;
    }
    for (const change of userChanges) await this.hooks.emit("user/values-changed", { uid: change.after.uid, ...change });
    for (const item of postEvents) await this.hooks.emit(item.event, item.payload);
    for (const mutation of mutations) await this.hooks.emit("inventory/changed", mutation);
    for (const callback of afterCommit) await callback();
    return result;
  }

  private createScope(
    database: CoreDatabase,
    business: string,
    uid: number,
    mutations: InventoryMutation[],
    userChanges: Array<{ before: FaithCoreUserData; after: FaithCoreUserData; delta: UserValueDelta }>,
    postEvents: Array<{ event: string; payload: unknown }>,
    state: { active: boolean },
    afterCommit: Array<() => void | Promise<void>>,
    afterRollback: Array<(error: unknown) => void | Promise<void>>,
  ): FaithAtomicScope {
    const ensureActive = () => {
      if (!state.active) throw new Error("原子事务作用域已经结束");
    };
    const users: FaithAtomicUserApi = Object.freeze({
      get: () => { ensureActive(); return this.users.require(uid, database); },
      change: async (delta: UserValueDelta) => {
        ensureActive();
        const entries = Object.entries(delta);
        if (!entries.length) throw new Error("数值变更不能为空");
        const before = await this.users.require(uid, database);
        const after = { ...before };
        for (const [key, value] of entries) {
          if (!USER_VALUE_FIELDS.has(key)) throw new Error(`不允许修改用户数值字段：${key}`);
          if (!Number.isFinite(value)) throw new Error(`数值变更必须是有限数字：${key}`);
          (after as unknown as Record<string, number>)[key] += value as number;
        }
        validateValues(after);
        if (after.gold < 0) throw new FaithCoreError("INSUFFICIENT_BALANCE", "金币余额不足", { uid });
        if (after.abandon_count < 0 || !Number.isSafeInteger(after.abandon_count)) throw new Error("弃誓次数不能为负数且必须是安全整数");
        ensureActive();
        const { uid: _uid, ...patch } = after;
        await assertUserWrite(database, valueQuery(before), patch);
        userChanges.push({ before, after, delta: { ...delta } });
        return after;
      },
      setFaiths: async (faiths: readonly string[]) => {
        ensureActive();
        const normalized = normalizeFaiths(faiths), before = await this.users.require(uid, database);
        for (const faith of normalized) this.faiths.require(faith);
        ensureActive();
        const after = { ...before, faiths: normalized };
        await assertUserWrite(database, { uid, faiths: before.faiths }, { faiths: normalized });
        const oldFaith = before.faiths[0] ?? null, newFaith = normalized[0] ?? null;
        if (oldFaith !== newFaith) {
          if (oldFaith) await this.faiths.adjustBelieverCount(database, oldFaith, -1);
          if (newFaith) await this.faiths.adjustBelieverCount(database, newFaith, 1);
          afterCommit.push(async () => { if (oldFaith) await this.faiths.refreshCount(oldFaith); if (newFaith) await this.faiths.refreshCount(newFaith); });
        }
        postEvents.push({ event: "user/faiths-changed", payload: { uid, before, after, oldFaith: before.faiths[0] ?? null, newFaith: normalized[0] ?? null } });
        return after;
      },
      abandonFaith: async (newFaith: string) => {
        ensureActive();
        const before = await this.users.require(uid, database), normalized = normalizeFaiths([newFaith, ...before.faiths.slice(1).filter((item) => item !== newFaith.trim())]);
        this.faiths.require(newFaith);
        if (!before.faiths[0]) throw new Error("用户当前没有信仰");
        if (before.faiths[0] === normalized[0]) throw new Error(`当前信仰已经是：${normalized[0]}`);
        ensureActive();
        const after = { ...before, faiths: normalized, abandon_count: before.abandon_count + 1 };
        await assertUserWrite(database, { uid, faiths: before.faiths, abandon_count: before.abandon_count }, { faiths: normalized, abandon_count: after.abandon_count });
        await this.faiths.adjustBelieverCount(database, before.faiths[0], -1);
        await this.faiths.adjustBelieverCount(database, normalized[0], 1);
        afterCommit.push(() => Promise.all([this.faiths.refreshCount(before.faiths[0]), this.faiths.refreshCount(normalized[0])]).then(() => undefined));
        const payload = { uid, before, after, oldFaith: before.faiths[0], newFaith: normalized[0] };
        postEvents.push({ event: "user/faiths-changed", payload }, { event: "user/faith-changed", payload });
        userChanges.push({ before, after, delta: { abandon_count: 1 } });
        return after;
      },
      setProfession: async (profession: string | null) => {
        ensureActive();
        const target = profession === null ? null : this.professions.require(profession), before = await this.users.require(uid, database);
        ensureActive();
        const after = { ...before, profession_id: target?.id ?? "" };
        await assertUserWrite(database, { uid, profession_id: before.profession_id }, { profession_id: after.profession_id });
        postEvents.push({ event: "user/profession-changed", payload: { uid, before, after, profession: target } });
        return after;
      },
    });
    const mutate = async (itemKey: string, calculate: (current: number) => number) => {
      ensureActive();
      const item = this.items.require(itemKey);
      const row = await this.inventory.entry(database, uid, item.item_id), current = row?.quantity ?? 0;
      ensureActive();
      const mutation = createInventoryMutation(uid, item, current, calculate(current));
      await this.inventory.writeKnown(database, mutation, row);
      mutations.push(mutation);
      return mutation;
    };
    const items: FaithAtomicItemsApi = Object.freeze({
      getQuantity: async (key: string) => {
        ensureActive();
        const item = this.items.require(key);
        return this.inventory.quantity(database, uid, item.item_id);
      },
      getStacks: async () => {
        ensureActive();
        const rows = await this.inventory.stacks(database, uid);
        ensureActive();
        return Object.freeze(rows.map((row) => {
          if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0) throw new FaithCoreError("DATA_INTEGRITY_ERROR", `背包物品数量无效：${row.item_id}`, { uid, itemId: row.item_id, quantity: row.quantity });
          return Object.freeze({ item_id: row.item_id, quantity: row.quantity });
        }));
      },
      give: (key: string, quantity = 1) => mutate(key, (current) => current + positive(quantity)),
      take: (key: string, quantity = 1) => mutate(key, (current) => current - positive(quantity)),
      setQuantity: (key: string, quantity: number) => mutate(key, () => nonNegative(quantity)),
    });
    const economy: FaithAtomicEconomyApi = Object.freeze({
      getWallet: async () => atomicWallet(await users.get()),
      canAfford: async (cost) => {
        const normalized = atomicMoney(cost), current = atomicWallet(await users.get());
        return ECONOMY_CURRENCIES.every((currency) => current[currency] >= (normalized[currency] ?? 0));
      },
      pay: async (cost) => {
        const normalized = atomicMoney(cost), current = atomicWallet(await users.get());
        const missing = ECONOMY_CURRENCIES.filter((currency) => current[currency] < (normalized[currency] ?? 0));
        if (missing.length) throw new FaithCoreError("INSUFFICIENT_BALANCE", "货币余额不足", { uid, missing, wallet: current, cost: { ...normalized } });
        return users.change(Object.fromEntries(Object.entries(normalized).map(([key, value]) => [key, -value])) as UserValueDelta);
      },
      creditFixed: (amount) => users.change(atomicMoney(amount) as UserValueDelta),
    });
    const getData = async () => {
      ensureActive();
      const [existing] = await database.get("faith_core_business", { uid, business });
      ensureActive();
      if (existing) return existing;
      try { return await database.create("faith_core_business", { uid, business, private: {}, public: {} }); }
      catch (error) {
        const [created] = await database.get("faith_core_business", { uid, business });
        if (created) return created;
        throw error;
      }
    };
    const data: FaithAtomicBusinessDataApi = Object.freeze({
      get: getData,
      set: async (next) => {
        ensureActive();
        if (next.private === undefined && next.public === undefined) throw new Error("业务数据更新不能为空");
        const row = await getData();
        ensureActive();
        const result = await database.set("faith_core_business", { id: row.id, private: row.private, public: row.public }, {
          private: next.private === undefined ? row.private : cloneBusinessRecord(next.private),
          public: next.public === undefined ? row.public : cloneBusinessRecord(next.public),
        });
        if (result.matched !== 1) throw new FaithCoreError("TRANSACTION_CONFLICT", "业务数据已被其他实例修改，请重试", { uid, business });
        const [updated] = await database.get("faith_core_business", { id: row.id });
        return updated;
      },
    });
    return Object.freeze({
      uid, users, items, economy, data,
      afterCommit(callback: () => void | Promise<void>) { ensureActive(); if (typeof callback !== "function") throw new TypeError("afterCommit 必须是函数"); afterCommit.push(callback); },
      afterRollback(callback: (error: unknown) => void | Promise<void>) { ensureActive(); if (typeof callback !== "function") throw new TypeError("afterRollback 必须是函数"); afterRollback.push(callback); },
    });
  }
}

const USER_VALUE_FIELDS = new Set(["gold", "ascension_score", "audience_score", "audience_rank", "abandon_count"]);
const ECONOMY_CURRENCIES = ["gold", "ascension_score"] as const;
function atomicMoney(input: Readonly<FaithMoney>): Readonly<FaithMoney> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new FaithCoreError("VALIDATION_FAILED", "货币数量必须是对象");
  const result: FaithMoney = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ECONOMY_CURRENCIES.includes(key as FaithCurrency) || !Number.isSafeInteger(value) || value < 0) throw new FaithCoreError("VALIDATION_FAILED", `货币数量无效：${key}`);
    if (value === 0) continue;
    result[key as FaithCurrency] = value;
  }
  if (!Object.keys(result).length) throw new FaithCoreError("VALIDATION_FAILED", "货币数量不能为空");
  return Object.freeze(result);
}
function atomicWallet(user: FaithCoreUserData): FaithWallet { return Object.freeze({ uid: user.uid, gold: user.gold, ascension_score: user.ascension_score }); }
function valueQuery(user: FaithCoreUserData) { return { uid: user.uid, gold: user.gold, ascension_score: user.ascension_score, audience_score: user.audience_score, audience_rank: user.audience_rank, abandon_count: user.abandon_count }; }
function validateValues(user: FaithCoreUserData) {
  for (const key of USER_VALUE_FIELDS) if (!Number.isFinite(user[key as keyof UserValueDelta]) || Math.abs(user[key as keyof UserValueDelta]) > Number.MAX_SAFE_INTEGER) throw new FaithCoreError("VALIDATION_FAILED", `数值运算溢出或超出安全范围：${key}`);
  if (!Number.isSafeInteger(user.audience_rank) || user.audience_rank < 0) throw new FaithCoreError("VALIDATION_FAILED", "觐见之梯必须是非负安全整数");
}
async function assertUserWrite(database: CoreDatabase, query: Record<string, unknown>, patch: Record<string, unknown>) {
  const result = await database.set("faith_core_users_data", query as never, patch as never);
  if (result.matched !== 1) throw new FaithCoreError("TRANSACTION_CONFLICT", "用户数据已被其他实例修改，请重试", { uid: Number(query.uid) });
}

function positive(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("数量必须是正安全整数");
  return value;
}

function nonNegative(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("数量必须是非负安全整数");
  return value;
}
