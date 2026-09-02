import type { Context } from "koishi";
import { CallbackDisposable } from "./lifecycle/disposable";
import { FaithCoreError } from "./errors";
import { assertUid } from "./services/validation";

export interface PermissionContext { uid: number; permission: string; data?: Record<string, unknown>; scope?: string; scopeValue?: string; }
export type PermissionPolicy = (context: PermissionContext) => boolean | Promise<boolean>;
interface PermissionEntry { policy: PermissionPolicy; owner: string; }

export class FaithPermissionsService {
  private policies = new Map<string, Set<PermissionEntry>>();
  private readonly logger;
  constructor(private ctx: Context) { this.logger = ctx.logger("faith-core-permissions"); }
  register(permission: string, policy: PermissionPolicy, options: { owner?: string } = {}) {
    validatePermission(permission);
    if (typeof policy !== "function") throw new TypeError("权限策略必须是函数");
    const policies = this.policies.get(permission) ?? new Set(), entry = { policy, owner: options.owner ?? "external" };
    policies.add(entry); this.policies.set(permission, policies);
    return new CallbackDisposable(() => { policies.delete(entry); if (!policies.size) this.policies.delete(permission); });
  }
  async check(uid: number, permission: string, data?: Record<string, unknown>, scope = "global", scopeValue = "") {
    assertUid(uid); validatePermission(permission);
    const now = new Date(), grants = await this.ctx.database.get("faith_core_permission_grants", { uid, permission }, { fields: ["scope", "scope_value", "expires_at"] });
    if (grants.some((grant) => (!grant.expires_at || grant.expires_at > now) && (grant.scope === "global" || (grant.scope === scope && grant.scope_value === scopeValue)))) return true;
    const policies = this.policies.get(permission);
    if (!policies?.size) return false;
    validateScope(scope, scopeValue);
    const context = Object.freeze({ uid, permission, data, scope, scopeValue });
    for (const entry of policies) {
      try { if (await entry.policy(context)) return true; }
      catch (error) { this.logger.error(`权限策略执行失败：${permission}/${entry.owner}`, error); }
    }
    return false;
  }
  async grant(uid: number, permission: string, options: { scope?: string; scopeValue?: string; grantedBy?: number; expiresAt?: Date | null } = {}) {
    assertUid(uid); validatePermission(permission);
    if (!(await this.ctx.database.get("faith_core_users_data", { uid }, { fields: ["uid"], limit: 1 })).length) throw new FaithCoreError("USER_NOT_FOUND", `UID 不存在：${uid}`, { uid });
    const scope = options.scope ?? "global", scopeValue = options.scopeValue ?? "";
    validateScope(scope, scopeValue);
    if (options.expiresAt && !Number.isFinite(options.expiresAt.getTime())) throw new FaithCoreError("VALIDATION_FAILED", "权限到期时间无效");
    if (options.grantedBy !== undefined && options.grantedBy !== 0) assertUid(options.grantedBy);
    await this.ctx.database.upsert("faith_core_permission_grants", [{ uid, permission, scope, scope_value: scopeValue, granted_by: options.grantedBy ?? 0, expires_at: options.expiresAt ?? null, created_at: new Date() }], ["uid", "permission", "scope", "scope_value"]);
  }
  revoke(uid: number, permission: string, scope = "global", scopeValue = "") { assertUid(uid); validatePermission(permission); validateScope(scope, scopeValue); return this.ctx.database.remove("faith_core_permission_grants", { uid, permission, scope, scope_value: scopeValue }); }
  list(uid: number) { assertUid(uid); return this.ctx.database.get("faith_core_permission_grants", { uid }); }
  cleanupExpired(now = new Date()) { return this.ctx.database.remove("faith_core_permission_grants", { expires_at: { $lt: now } }); }
  removeOwner(owner: string) { let removed = 0; for (const [permission, policies] of this.policies) { for (const entry of policies) if (entry.owner === owner) { policies.delete(entry); removed++; } if (!policies.size) this.policies.delete(permission); } return removed; }
  countPolicies() { return [...this.policies.values()].reduce((sum, entries) => sum + entries.size, 0); }
  clear() { this.policies.clear(); }
}
function validatePermission(value: string) { if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(value)) throw new FaithCoreError("VALIDATION_FAILED", `非法权限名称：${value}`); }
function validateScope(scope: string, scopeValue: string) { if (!/^[a-z][a-z0-9_.:-]{0,63}$/.test(scope) || scopeValue.length > 255 || (scope === "global" && scopeValue)) throw new FaithCoreError("VALIDATION_FAILED", "权限作用域无效"); }
