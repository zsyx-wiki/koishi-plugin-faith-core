import { Context } from "koishi";
import { FaithHooksService } from "../hooks";
import { KeyedLockService } from "../lock";
import { FaithTransactionService } from "../services/transaction";
import { FaithUsersService } from "../services/users";
import type { FaithAuditService } from "../services/audit";
import type { FaithOpenResult, InventoryItem, InventoryMutation, InventoryStack } from "../types";
import type { FaithItemDefinition } from "../types";
import { FaithCoreError } from "../errors";
import { FaithItemRegistry } from "./registry";
import { CORE_ITEM_LEVELS, FaithItemLevelRegistry } from "./levels";
import { FaithInventoryRepository } from "./repository";
import {
  assertNonNegativeQuantity,
  assertPositiveQuantity,
  createInventoryMutation,
} from "./validation";

export class FaithItemsService extends FaithItemRegistry {
  private repository = new FaithInventoryRepository();
  private lootPools = new Map<string, readonly Readonly<FaithItemDefinition>[]>()
  readonly levels = new FaithItemLevelRegistry();

  constructor(
    private ctx: Context,
    private transactions: FaithTransactionService,
    private locks: KeyedLockService,
    private hooks: FaithHooksService,
    private users: FaithUsersService,
    private audit: FaithAuditService,
  ) { super(); this.levels.registerMany(CORE_ITEM_LEVELS, { owner: "core" }); }

  override register(input: FaithItemDefinition, options: { replace?: boolean; owner?: string } = {}) {
    this.levels.require(input.level);
    const result = super.register(input, options); this.lootPools.clear(); return result;
  }
  override registerMany(inputs: readonly FaithItemDefinition[], options: { replace?: boolean; owner?: string } = {}) {
    for (const input of inputs) this.levels.require(input.level);
    const result = super.registerMany(inputs, options); this.lootPools.clear(); return result;
  }

  isOpenable(itemIdOrName: string) { return !!this.resolve(itemIdOrName)?.openable; }

  rollOpenable(itemIdOrName: string, random: () => number = Math.random): FaithOpenResult {
    const item = this.require(itemIdOrName), rule = item.openable;
    if (!rule) throw new FaithCoreError("VALIDATION_FAILED", `物品 ${item.name} 不能打开`, { itemId: item.item_id });
    const currencies = { gold: 0, ascension_score: 0, audience_score: 0, ...(rule.guaranteed ?? {}) };
    const rewards: Record<string, number> = {};
    for (const drop of rule.independentDrops ?? []) if (safeRandom(random) < drop.chance) add(rewards, this.require(drop.item).item_id, drop.quantity ?? 1);
    const randomized = rule.randomDrop;
    if (randomized?.goldRange) currencies.gold += randomInt(random, randomized.goldRange[0], randomized.goldRange[1]);
    for (let count = 0; count < (randomized?.itemCount ?? 1); count++) {
      if (!randomized) break;
      const level = weightedPick(randomized.itemPool, random);
      let pool = this.lootPools.get(level);
      if (!pool) {
        pool = Object.freeze(this.list({ level, obtainable: true }).filter((candidate) => !candidate.openable));
        this.lootPools.set(level, pool);
      }
      if (pool.length) add(rewards, pool[Math.floor(safeRandom(random) * pool.length)].item_id, 1);
    }
    return Object.freeze({ currencies: Object.freeze(currencies), items: Object.freeze(rewards) });
  }

  async unregister(itemId: string, owner?: string) {
    const item = this.get(itemId);
    if (!item) return false;
    if (owner && this.ownerOf(itemId) !== owner) throw new Error(`物品 ${itemId} 不属于 ${owner}`);
    if (await this.repository.hasAny(this.ctx.database, itemId)) {
      throw new Error(`物品 ${itemId} 仍存在于用户背包，不能取消注册`);
    }
    const removed = this.removeDefinition(itemId); if (removed) this.lootPools.clear(); return removed;
  }

  async removeOwner(owner: string) {
    const itemIds = this.all().filter((item) => this.ownerOf(item.item_id) === owner).map((item) => item.item_id);
    let removed = 0;
    for (const itemId of itemIds) if (await this.unregister(itemId, owner)) removed++;
    return removed;
  }

  /** 返回背包条目及完整物品定义，适合渲染详情。 */
  async getInventoryEntries(uid: number): Promise<InventoryItem[]> {
    const [, rows] = await Promise.all([this.users.require(uid), this.repository.rows(this.ctx.database, uid)]);
    return rows.map((row) => {
      const item = this.get(row.item_id);
      if (!item) throw new FaithCoreError("DATA_INTEGRITY_ERROR", `背包包含未注册物品：${row.item_id}`, { uid, itemId: row.item_id, rowId: row.id });
      if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0) throw new FaithCoreError("DATA_INTEGRITY_ERROR", `背包物品数量无效：${row.item_id}`, { uid, itemId: row.item_id, quantity: row.quantity });
      return { uid, item_id: row.item_id, quantity: row.quantity, item };
    });
  }

  /** 兼容旧名；新代码应使用 getInventoryEntries() 明确其包含定义。 */
  getInventory(uid: number) { return this.getInventoryEntries(uid); }

  /** 只读取 item_id 和 quantity，不实例化/附加物品定义。 */
  async getInventoryStacks(uid: number): Promise<InventoryStack[]> {
    const [, rows] = await Promise.all([this.users.require(uid), this.repository.stacks(this.ctx.database, uid)]);
    return rows.map((row) => {
      if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0) throw new FaithCoreError("DATA_INTEGRITY_ERROR", `背包物品数量无效：${row.item_id}`, { uid, itemId: row.item_id, quantity: row.quantity });
      return Object.freeze({ item_id: row.item_id, quantity: row.quantity });
    });
  }

  async getInventorySnapshot(uid: number) {
    const inventory = await this.getInventoryEntries(uid);
    return Object.freeze(Object.fromEntries(inventory.map((entry) => [entry.item_id, Object.freeze(entry)]))) as Readonly<Record<string, InventoryItem>>;
  }

  async listInventory(uid: number, options: { type?: string; level?: string; offset?: number; limit?: number } = {}) {
    const items = (await this.getInventoryEntries(uid)).filter(({ item }) =>
      (!options.type || item.type === options.type) && (!options.level || item.level === options.level));
    const offset = options.offset ?? 0, limit = options.limit ?? 500;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("背包分页参数无效");
    return items.slice(offset, offset + limit);
  }

  async countHolders(itemIdOrName: string) { const item = this.require(itemIdOrName); return (await this.ctx.database.get("faith_core_users_inventory", { item_id: item.item_id }, { fields: ["id"] })).length; }
  async listHolders(itemIdOrName: string, options: { offset?: number; limit?: number } = {}) {
    const item = this.require(itemIdOrName), offset = options.offset ?? 0, limit = options.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("持有者分页参数无效");
    return this.ctx.database.get("faith_core_users_inventory", { item_id: item.item_id }, { offset, limit, sort: { uid: "asc" } });
  }

  async getQuantity(uid: number, itemIdOrName: string) {
    const item = this.require(itemIdOrName);
    const [, quantity] = await Promise.all([this.users.require(uid), this.repository.quantity(this.ctx.database, uid, item.item_id)]);
    return quantity;
  }

  async hasQuantity(uid: number, itemIdOrName: string, quantity = 1) {
    assertPositiveQuantity(quantity);
    return (await this.getQuantity(uid, itemIdOrName)) >= quantity;
  }

  async canReceive(uid: number, itemIdOrName: string, quantity = 1) {
    assertPositiveQuantity(quantity);
    const item = this.require(itemIdOrName);
    const current = await this.getQuantity(uid, item.item_id);
    return item.max_quantity === 0 || current + quantity <= item.max_quantity;
  }

  give(uid: number, item: string, quantity = 1) {
    assertPositiveQuantity(quantity);
    return this.mutateOne(uid, item, (current) => current + quantity);
  }
  take(uid: number, item: string, quantity = 1) {
    assertPositiveQuantity(quantity);
    return this.mutateOne(uid, item, (current) => current - quantity);
  }
  setQuantity(uid: number, item: string, quantity: number) {
    assertNonNegativeQuantity(quantity);
    return this.mutateOne(uid, item, () => quantity);
  }
  giveMany(uid: number, quantities: Record<string, number>) {
    return this.mutateMany(uid, quantities, 1);
  }
  takeMany(uid: number, quantities: Record<string, number>) {
    return this.mutateMany(uid, quantities, -1);
  }

  async transfer(fromUid: number, toUid: number, itemIdOrName: string, quantity = 1) {
    if (fromUid === toUid) throw new Error("物品转出和转入 UID 不能相同");
    assertPositiveQuantity(quantity);
    const item = this.require(itemIdOrName);
    const mutations = await this.locks.runMany([`uid:${fromUid}`, `uid:${toUid}`], () =>
      this.transactions.run(async (database) => {
        const transactionId = await this.audit.begin(database, { source: "items.transfer" });
        await this.users.require(fromUid, database);
        await this.users.require(toUid, database);
        const fromRow = await this.repository.entry(database, fromUid, item.item_id);
        const toRow = await this.repository.entry(database, toUid, item.item_id);
        const from = fromRow?.quantity ?? 0, to = toRow?.quantity ?? 0;
        const result = [
          createInventoryMutation(fromUid, item, from, from - quantity),
          createInventoryMutation(toUid, item, to, to + quantity),
        ];
        await this.repository.writeKnown(database, result[0], fromRow);
        await this.repository.writeKnown(database, result[1], toRow);
        for (const mutation of result) await this.audit.entry(database, transactionId, mutation.uid, `item:${mutation.item_id}`, mutation.before, mutation.after);
        return result;
      }));
    await this.emitMutations(mutations);
    return { from: mutations[0], to: mutations[1] };
  }

  private async mutateOne(uid: number, itemIdOrName: string, calculate: (current: number) => number) {
    const item = this.require(itemIdOrName);
    const mutation = await this.locks.run(`uid:${uid}`, () =>
      this.transactions.run(async (database) => {
        const transactionId = await this.audit.begin(database, { source: "items.mutate" });
        await this.users.require(uid, database);
        const row = await this.repository.entry(database, uid, item.item_id), current = row?.quantity ?? 0;
        const result = createInventoryMutation(uid, item, current, calculate(current));
        await this.repository.writeKnown(database, result, row);
        await this.audit.entry(database, transactionId, uid, `item:${result.item_id}`, result.before, result.after);
        return result;
      }));
    await this.emitMutations([mutation]);
    return mutation;
  }

  private async mutateMany(uid: number, quantities: Record<string, number>, direction: 1 | -1) {
    const entries = Object.entries(quantities);
    if (!entries.length) return [];
    const resolved = entries.map(([key, quantity]) => {
      assertPositiveQuantity(quantity);
      return [this.require(key), quantity] as const;
    });
    if (new Set(resolved.map(([item]) => item.item_id)).size !== resolved.length) {
      throw new Error("批量物品操作包含重复物品");
    }
    const mutations = await this.locks.run(`uid:${uid}`, () =>
      this.transactions.run(async (database) => {
        const transactionId = await this.audit.begin(database, { source: "items.mutate-many" });
        await this.users.require(uid, database);
        const rows = await this.repository.entries(database, uid, resolved.map(([item]) => item.item_id));
        const rowsByItem = new Map(rows.map((row) => [row.item_id, row]));
        const result: InventoryMutation[] = [];
        for (const [item, quantity] of resolved) {
          const current = rowsByItem.get(item.item_id)?.quantity ?? 0;
          result.push(createInventoryMutation(uid, item, current, current + quantity * direction));
        }
        for (const mutation of result) await this.repository.writeKnown(database, mutation, rowsByItem.get(mutation.item_id) ?? null);
        for (const mutation of result) await this.audit.entry(database, transactionId, uid, `item:${mutation.item_id}`, mutation.before, mutation.after);
        return result;
      }));
    await this.emitMutations(mutations);
    return mutations;
  }

  private async emitMutations(mutations: InventoryMutation[]) {
    for (const mutation of mutations) await this.hooks.emit("inventory/changed", mutation);
  }
}

function safeRandom(random: () => number) { const value = random(); if (!Number.isFinite(value) || value < 0 || value >= 1) throw new FaithCoreError("VALIDATION_FAILED", "随机数生成器必须返回 [0, 1) 范围内的有限数值"); return value; }
function randomInt(random: () => number, min: number, max: number) { return Math.floor(safeRandom(random) * (max - min + 1)) + min; }
function weightedPick(entries: readonly { level: string; weight: number }[], random: () => number) { const total = entries.reduce((sum, entry) => sum + entry.weight, 0); let value = safeRandom(random) * total; for (const entry of entries) { value -= entry.weight; if (value < 0) return entry.level; } return entries[entries.length - 1].level; }
function add(target: Record<string, number>, item: string, quantity: number) { target[item] = (target[item] ?? 0) + quantity; }
