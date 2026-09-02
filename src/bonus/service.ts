import { CallbackDisposable } from "../lifecycle/disposable";
import type { FaithHooksService } from "../hooks";
import type { FaithUsersService } from "../services/users";
import type { BonusCalculation, BonusContribution, BonusProvider, BonusProviderContext, BonusProviderOptions, BonusRequest } from "./types";
interface ProviderEntry { id: string; owner: string; priority: number; order: number; types?: ReadonlySet<string>; provider: BonusProvider; }

/** v2 兼容公式：所有 modifier 相加，所有 fixedBonus 相加，最终 Math.round。 */
export class FaithBonusService {
  private providers = new Map<string, ProviderEntry>();
  private orderedProviders?: readonly ProviderEntry[];
  private order = 0;
  constructor(private users: FaithUsersService, private hooks: FaithHooksService) {}
  registerProvider(provider: BonusProvider, options: BonusProviderOptions) {
    if (typeof provider !== "function") throw new TypeError("加成 Provider 必须是函数");
    if (!/^[a-z][a-z0-9_.:/-]{0,127}$/.test(options.id)) throw new Error(`非法 Provider ID：${options.id}`);
    if (this.providers.has(options.id)) throw new Error(`加成 Provider 已注册：${options.id}`);
    const entry: ProviderEntry = { id: options.id, owner: options.owner ?? "external", priority: finite(options.priority ?? 0), order: this.order++, types: options.types ? new Set(options.types.map(assertType)) : undefined, provider };
    this.providers.set(entry.id, entry);
    this.orderedProviders = undefined;
    return new CallbackDisposable(() => { this.providers.delete(entry.id); this.orderedProviders = undefined; });
  }
  removeProvider(id: string) { const removed = this.providers.delete(id); if (removed) this.orderedProviders = undefined; return removed; }
  removeOwner(owner: string) { let count = 0; for (const [id, item] of this.providers) if (item.owner === owner) { this.providers.delete(id); count++; } if (count) this.orderedProviders = undefined; return count; }
  listProviders() { return [...this.providers.values()].map(({ provider: _, types, ...item }) => ({ ...item, types: types ? [...types] : undefined })); }
  get size() { return this.providers.size; }
  async calculate(request: BonusRequest): Promise<BonusCalculation> {
    validateRequest(request);
    const prepared = await this.hooks.waterfall("bonus/before-calculate", Object.freeze({ ...request }));
    validateRequest(prepared);
    const user = await this.users.require(prepared.uid);
    return this.calculatePrepared(prepared, user);
  }
  async calculateForUser(user: Awaited<ReturnType<FaithUsersService["require"]>>, request: BonusRequest): Promise<BonusCalculation> {
    validateRequest(request);
    const prepared = await this.hooks.waterfall("bonus/before-calculate", Object.freeze({ ...request }));
    validateRequest(prepared);
    return this.calculatePrepared(prepared, prepared.uid === user.uid ? user : await this.users.require(prepared.uid));
  }
  private async calculatePrepared(prepared: BonusRequest, user: Awaited<ReturnType<FaithUsersService["require"]>>): Promise<BonusCalculation> {
    const context: BonusProviderContext = Object.freeze({ ...prepared, user: Object.freeze({ ...user, faiths: Object.freeze([...user.faiths]) }), faiths: Object.freeze([...user.faiths]), currentFaith: user.faiths[0] ?? null, metadata: prepared.metadata ? Object.freeze({ ...prepared.metadata }) : undefined });
    const active = prepared.baseValue > 0 ? this.ordered().filter((entry) => !entry.types || entry.types.has(prepared.type)) : [];
    const now = Date.now();
    const settled = await Promise.all(active.map(async (entry) => {
      try {
        const provided = await entry.provider(context), values: BonusContribution[] = [];
        for (const contribution of provided == null ? [] : Array.isArray(provided) ? provided : [provided]) {
          const normalized = normalizeContribution(contribution, prepared.type);
          if (!normalized.expiresAt || normalized.expiresAt.getTime() > now) values.push(normalized);
        }
        return { values };
      } catch (error) {
        await this.hooks.emit("bonus/provider-failed", Object.freeze({ provider: entry.id, uid: prepared.uid, type: prepared.type, error }));
        return { values: [] as BonusContribution[], failure: { provider: entry.id, error } };
      }
    }));
    const contributions = settled.flatMap((item) => item.values);
    const failures = settled.flatMap((item) => item.failure ? [item.failure] : []);
    const extended = await this.hooks.waterfall("bonus/contributions", contributions as readonly BonusContribution[]);
    const valid = [...extended].map((item) => normalizeContribution(item, prepared.type));
    const multiplier = valid.reduce((sum, item) => sum + (item.modifier ?? 0), 1), fixedBonus = valid.reduce((sum, item) => sum + (item.fixedBonus ?? 0), 0);
    const result: BonusCalculation = Object.freeze({ ...prepared, multiplier, fixedBonus, finalValue: prepared.baseValue <= 0 ? prepared.baseValue : Math.round(prepared.baseValue * multiplier + fixedBonus), contributions: Object.freeze(valid), failures: Object.freeze(failures) });
    await this.hooks.emit("bonus/after-calculate", result);
    return result;
  }
  async overview(uid: number, types: readonly string[] = ["gold", "ascension_score", "audience_score"], baseValue = 100) {
    if (!types.length || types.length > 64) throw new Error("加成概览类型数量必须是 1-64");
    const user = await this.users.require(uid);
    return Promise.all(types.map((type) => this.calculateForUser(user, { uid, type, baseValue, source: "bonus_overview" })));
  }
  clear() { this.providers.clear(); this.orderedProviders = undefined; }
  private ordered() { return this.orderedProviders ??= [...this.providers.values()].sort((a, b) => a.priority - b.priority || a.order - b.order); }
}
function validateRequest(value: BonusRequest) { if (!Number.isSafeInteger(value.uid)) throw new Error("加成 UID 必须是安全整数"); assertType(value.type); if (!Number.isFinite(value.baseValue)) throw new Error("加成基础值必须是有限数字"); if (value.source !== undefined && (typeof value.source !== "string" || value.source.length > 128)) throw new Error("加成 source 无效"); }
function normalizeContribution(value: BonusContribution, expectedType: string): BonusContribution {
  if (!value || typeof value !== "object" || value.type !== expectedType) throw new Error("加成贡献类型无效");
  if (typeof value.source !== "string" || !value.source.trim() || value.source.length > 128) throw new Error("加成来源无效");
  const modifier = value.modifier ?? 0, fixedBonus = value.fixedBonus ?? 0;
  if (!Number.isFinite(modifier) || !Number.isFinite(fixedBonus) || Math.abs(modifier) > 100 || Math.abs(fixedBonus) > 1e12) throw new Error("加成值无效或超过安全上限");
  const expiresAt = value.expiresAt === undefined ? undefined : new Date(value.expiresAt);
  if (expiresAt && !Number.isFinite(expiresAt.getTime())) throw new Error("加成到期时间无效");
  return Object.freeze({ ...value, source: value.source.trim(), modifier, fixedBonus, expiresAt });
}
function assertType(value: string) { if (typeof value !== "string" || !/^[a-z][a-z0-9_.:/-]{0,63}$/.test(value)) throw new Error(`非法加成类型：${value}`); return value; }
function finite(value: number) { if (!Number.isFinite(value)) throw new Error("Provider priority 必须是有限数字"); return value; }
