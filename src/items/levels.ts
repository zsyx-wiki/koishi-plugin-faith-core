import type { FaithItemLevelDefinition } from "../types";

export class FaithItemLevelRegistry {
  private levels = new Map<string, Readonly<FaithItemLevelDefinition>>();
  private owners = new Map<string, string>();
  register(input: FaithItemLevelDefinition, options: { owner?: string; replace?: boolean } = {}) {
    if (!input || !/^[\p{L}\p{N}_-]{1,32}$/u.test(input.id) || !input.name?.trim() || !Number.isFinite(input.rank)) throw new Error("物品等级定义无效");
    const owner = options.owner ?? "external", existingOwner = this.owners.get(input.id);
    const existing = this.levels.get(input.id);
    if (existing && existingOwner === owner && JSON.stringify(existing) === JSON.stringify({ ...input, name: input.name.trim(), weight: input.weight ?? 1, metadata: input.metadata ?? {} })) return existing;
    if (this.levels.has(input.id) && !options.replace) throw new Error(`物品等级已注册：${input.id}`);
    if (existingOwner && existingOwner !== owner) throw new Error(`物品等级 ${input.id} 不属于 ${owner}`);
    const level = Object.freeze({ ...input, name: input.name.trim(), weight: input.weight ?? 1, metadata: Object.freeze({ ...(input.metadata ?? {}) }) });
    this.levels.set(level.id, level); this.owners.set(level.id, owner); return level;
  }
  registerMany(values: readonly FaithItemLevelDefinition[], options: { owner?: string; replace?: boolean } = {}) { return values.map((value) => this.register(value, options)); }
  get(id: string) { return this.levels.get(id); }
  require(id: string) { const value = this.get(id); if (!value) throw new Error(`未注册物品等级：${id}`); return value; }
  all() { return [...this.levels.values()].sort((a, b) => b.rank - a.rank); }
  compare(a: string, b: string) { return this.require(a).rank - this.require(b).rank; }
  removeOwner(owner: string) { let count = 0; for (const [id, value] of this.owners) if (value === owner) { this.owners.delete(id); this.levels.delete(id); count++; } return count; }
  clear() { this.levels.clear(); this.owners.clear(); }
}

export const CORE_ITEM_LEVELS: readonly FaithItemLevelDefinition[] = [
  { id: "D", name: "D", rank: 10 }, { id: "C", name: "C", rank: 20 }, { id: "B", name: "B", rank: 30 },
  { id: "A", name: "A", rank: 40 }, { id: "S", name: "S", rank: 50 }, { id: "SS", name: "SS", rank: 60 },
  { id: "SSS", name: "SSS", rank: 70 }, { id: "SP", name: "SP", rank: 80 }, { id: "彩蛋", name: "彩蛋", rank: 90 },
];
