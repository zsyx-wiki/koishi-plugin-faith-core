import type { FaithItemDefinition, ItemQuery } from "../types";
import { validateItemDefinition } from "./validation";
import { FaithCoreError } from "../errors";

export class FaithItemRegistry {
  private registryRevision = 0;
  get revision() { return this.registryRevision; }
  protected readonly definitions = new Map<string, Readonly<FaithItemDefinition>>();
  protected readonly itemIdsByName = new Map<string, string>();
  protected readonly owners = new Map<string, string>();

  register(input: FaithItemDefinition, options: { replace?: boolean; owner?: string } = {}) {
    const current = this.definitions.get(input.item_id), owner = options.owner ?? "external";
    if (current && this.owners.get(input.item_id) === owner && sameDefinition(current, input)) return current;
    this.assertCanRegister(input, options);
    if (current && current.name !== input.name) this.itemIdsByName.delete(current.name);
    const item = Object.freeze({
      ...input,
      actions: input.actions ? Object.freeze([...input.actions]) as unknown as string[] : undefined,
      openable: input.openable ? freezeOpenable(input.openable) : undefined,
    });
    this.definitions.set(item.item_id, item);
    this.registryRevision++;
    this.itemIdsByName.set(item.name, item.item_id);
    this.owners.set(item.item_id, options.owner ?? "external");
    return item;
  }

  registerMany(inputs: readonly FaithItemDefinition[], options: { replace?: boolean; owner?: string } = {}) {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const item of inputs) {
      if (seenIds.has(item.item_id) || seenNames.has(item.name)) {
        throw new Error(`批量注册中存在重复物品：${item.item_id} / ${item.name}`);
      }
      seenIds.add(item.item_id);
      seenNames.add(item.name);
      this.assertCanRegister(item, options);
    }
    return inputs.map((item) => this.register(item, options));
  }

  get(itemId: string) { return this.definitions.get(itemId); }
  getByName(name: string) {
    const itemId = this.itemIdsByName.get(name);
    return itemId ? this.definitions.get(itemId) : undefined;
  }
  resolve(itemIdOrName: string) { return this.get(itemIdOrName) ?? this.getByName(itemIdOrName); }
  require(itemIdOrName: string) {
    const item = this.resolve(itemIdOrName);
    if (!item) throw new FaithCoreError("ITEM_NOT_FOUND", `未注册物品：${itemIdOrName}`, { item: itemIdOrName });
    return item;
  }
  has(itemIdOrName: string) { return !!this.resolve(itemIdOrName); }
  all() { return [...this.definitions.values()]; }
  list(query: ItemQuery = {}) {
    const name = query.name?.toLocaleLowerCase();
    return [...this.definitions.values()].filter((item) =>
      (query.type === undefined || item.type === query.type) &&
      (query.level === undefined || item.level === query.level) &&
      (query.marketable === undefined || item.marketable === query.marketable) &&
      (query.obtainable === undefined || item.obtainable === query.obtainable) &&
      (name === undefined || item.name.toLocaleLowerCase().includes(name)));
  }
  obtainable() { return this.list({ obtainable: true }); }
  marketable() { return this.list({ marketable: true }); }

  protected removeDefinition(itemId: string) {
    const item = this.definitions.get(itemId);
    if (!item) return false;
    this.definitions.delete(itemId);
    this.registryRevision++;
    this.itemIdsByName.delete(item.name);
    this.owners.delete(itemId);
    return true;
  }

  clear() {
    this.registryRevision++;
    this.definitions.clear();
    this.itemIdsByName.clear();
    this.owners.clear();
  }

  protected ownerOf(itemId: string) { return this.owners.get(itemId); }

  private assertCanRegister(item: FaithItemDefinition, options: { replace?: boolean; owner?: string }) {
    validateItemDefinition(item);
    const currentById = this.definitions.get(item.item_id);
    const currentIdByName = this.itemIdsByName.get(item.name);
    if (!options.replace && (currentById || currentIdByName)) {
      throw new Error(`物品 ID 或名称已注册：${item.item_id} / ${item.name}`);
    }
    if (currentById && this.owners.get(item.item_id) !== (options.owner ?? "external")) {
      throw new Error(`物品 ${item.item_id} 归 ${this.owners.get(item.item_id)} 所有，不能由 ${options.owner ?? "external"} 覆盖`);
    }
    if (currentIdByName && currentIdByName !== item.item_id) {
      throw new Error(`物品名称已被其他 ID 使用：${item.name}`);
    }
  }
}

function freezeOpenable(value: NonNullable<FaithItemDefinition["openable"]>) {
  return Object.freeze({
    guaranteed: value.guaranteed ? Object.freeze({ ...value.guaranteed }) : undefined,
    independentDrops: value.independentDrops ? Object.freeze(value.independentDrops.map((entry) => Object.freeze({ ...entry }))) : undefined,
    randomDrop: value.randomDrop ? Object.freeze({
      ...value.randomDrop,
      goldRange: value.randomDrop.goldRange ? Object.freeze([value.randomDrop.goldRange[0], value.randomDrop.goldRange[1]]) as readonly [number, number] : undefined,
      itemPool: Object.freeze(value.randomDrop.itemPool.map((entry) => Object.freeze({ ...entry }))),
    }) : undefined,
  });
}

function sameDefinition(current: Readonly<FaithItemDefinition>, input: FaithItemDefinition) {
  return JSON.stringify(current) === JSON.stringify(input);
}
