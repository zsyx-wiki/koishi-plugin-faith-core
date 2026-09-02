import type { FaithProfessionDefinition } from "../types";

export class FaithProfessionRegistry {
  private definitions = new Map<string, Readonly<FaithProfessionDefinition>>();
  private names = new Map<string, string>();
  private owners = new Map<string, string>();

  register(definition: FaithProfessionDefinition, options: { override?: boolean; owner?: string } = {}) {
    const item = validateProfession(definition), existing = this.definitions.get(item.id), nameOwner = this.names.get(item.name);
    const owner = options.owner ?? "external", existingOwner = this.owners.get(item.id);
    if (existing && existingOwner === owner && JSON.stringify(existing) === JSON.stringify(item)) return existing;
    if (!options.override && existing) throw new Error(`职业 ID 已注册：${item.id}`);
    if (existing && existingOwner !== owner) throw new Error(`职业 ${item.id} 归 ${existingOwner} 所有，${owner} 不能覆盖`);
    if (nameOwner && nameOwner !== item.id) throw new Error(`职业名称已由 ${nameOwner} 使用：${item.name}`);
    if (existing && existing.name !== item.name) this.names.delete(existing.name);
    this.definitions.set(item.id, item); this.names.set(item.name, item.id);
    this.owners.set(item.id, owner);
    return item;
  }
  registerMany(items: readonly FaithProfessionDefinition[], options: { override?: boolean; owner?: string } = {}) {
    const registered: Readonly<FaithProfessionDefinition>[] = [];
    try { for (const item of items) registered.push(this.register(item, options)); }
    catch (error) { for (const item of registered) this.unregister(item.id, options.owner); throw error; }
    return registered;
  }
  unregister(id: string, owner?: string) { const item = this.definitions.get(id); if (!item) return false; if (owner && this.owners.get(id) !== owner) throw new Error(`职业 ${id} 不属于 ${owner}`); this.definitions.delete(id); this.names.delete(item.name); this.owners.delete(id); return true; }
  removeOwner(owner: string) { let count = 0; for (const [id, value] of [...this.owners]) if (value === owner) { this.unregister(id, owner); count++; } return count; }
  get(id: string) { return this.definitions.get(id); }
  getByName(name: string) { const id = this.names.get(name.trim()); return id ? this.definitions.get(id) : undefined; }
  resolve(idOrName: string) { return this.get(idOrName) ?? this.getByName(idOrName); }
  require(idOrName: string) { const item = this.resolve(idOrName); if (!item) throw new Error(`职业不存在：${idOrName}`); return item; }
  all() { return [...this.definitions.values()]; }
  list(query: { faith?: string; type?: string; source?: string } = {}) { return this.all().filter((item) => (!query.faith || item.faith === query.faith) && (!query.type || item.type === query.type) && (!query.source || item.source === query.source)); }
  clear() { this.definitions.clear(); this.names.clear(); this.owners.clear(); }
}

function validateProfession(value: FaithProfessionDefinition) {
  if (!value || typeof value !== "object") throw new TypeError("职业定义必须是对象");
  for (const key of ["id", "name", "type", "faith"] as const) {
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 128 || /[\u0000-\u001f\u007f]/.test(value[key])) throw new Error(`职业字段无效：${key}`);
  }
  return Object.freeze({ ...value, id: value.id.trim(), name: value.name.trim(), type: value.type.trim(), faith: value.faith.trim(), metadata: value.metadata ? Object.freeze({ ...value.metadata }) : undefined });
}
