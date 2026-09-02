import type { FaithDefinition } from "../types";

export class FaithRegistryServiceBase {
  protected registry = new Map<string, Readonly<FaithDefinition>>();
  register(definition: FaithDefinition, options: { override?: boolean } = {}) {
    const item = validateFaith(definition);
    if (!options.override && this.registry.has(item.name)) throw new Error(`信仰已注册：${item.name}`);
    this.registry.set(item.name, item); return item;
  }
  registerMany(definitions: readonly FaithDefinition[]) { return definitions.map((item) => this.register(item)); }
  unregister(name: string) { return this.registry.delete(name.trim()); }
  get(name: string) { return this.registry.get(name.trim()); }
  require(name: string) { const item = this.get(name); if (!item) throw new Error(`信仰不存在：${name}`); return item; }
  has(name: string) { return !!this.get(name); }
  all() { return [...this.registry.values()]; }
  byPath(path: string) { const result: Readonly<FaithDefinition>[] = []; for (const item of this.registry.values()) if (item.path === path) result.push(item); return result; }
  clear() { this.registry.clear(); }
}

function validateFaith(value: FaithDefinition): Readonly<FaithDefinition> {
  if (!value || typeof value !== "object") throw new TypeError("信仰定义必须是对象");
  for (const key of ["name", "path"] as const) if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 64) throw new Error(`信仰字段无效：${key}`);
  if (value.type !== "fixed" && value.type !== "dynamic") throw new Error("信仰类型无效");
  if (!Number.isSafeInteger(value.believer_count) || value.believer_count < 0) throw new Error("信徒数量无效");
  return Object.freeze({ ...value, name: value.name.trim(), path: value.path.trim(), custom_professions: Object.freeze({ ...(value.custom_professions ?? {}) }), metadata: Object.freeze({ ...(value.metadata ?? {}) }) });
}
