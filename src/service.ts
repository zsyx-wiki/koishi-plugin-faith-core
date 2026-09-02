import { Context, Service } from "koishi";
import { CORE_EASTER_EGGS } from "./data/easterEggs";
import { CORE_ITEMS } from "./data/items";
import { CORE_OPENABLE_ITEMS } from "./data/openable-items";
import { registerBusinessModel, type BusinessModelFields } from "./database";
import { FaithHooksService } from "./hooks";
import { FaithBonusService } from "./bonus";
import { CORE_PROFESSIONS } from "./data/professions";
import { FaithProfessionService } from "./professions";
import { FaithRegistryService } from "./faith";
import { FaithItemsService } from "./items";
import { FaithLifecycleService } from "./lifecycle";
import { FaithGameDayService } from "./lifecycle";
import { KeyedLockService } from "./lock";
import { FaithPermissionsService } from "./permissions";
import { FaithEffectsService } from "./effects";
import { FaithIntegrityService } from "./integrity";
import { FaithHealthService } from "./health";
import { FaithEconomyService } from "./economy";
import { normalizeCoreConfig } from "./config-validation";
import { FaithCoreError } from "./errors";
import {
  FaithBusinessDataService,
  FaithBusinessTransactionService,
  FaithBusinessCoreScope,
  createBusinessSharedApis,
  FaithIdentityService,
  FaithTransactionService,
  FaithUidService,
  FaithUsersService,
  FaithAuditService,
  FaithBulkOperationsService,
} from "./services";
import type { FaithCoreConfig, FaithItemDefinition, IdentityInput } from "./types";

export const CORE_SERVICE_ORDER = [
  "lifecycle",
  "hooks",
  "locks",
  "permissions",
  "transactions",
  "uids",
  "users",
  "bonuses",
  "identities",
  "businessData",
  "items",
  "professions",
  "faiths",
  "economy",
  "bulk",
] as const;

export interface FaithAdapterIdentityApi {
  normalize(identity: IdentityInput): ReturnType<FaithIdentityService["normalize"]>;
  resolve(identity: IdentityInput): Promise<number | null>;
  bind(uid: number, identity: IdentityInput): Promise<boolean>;
}

/**
 * Faith Core 的稳定公共门面。具体实现按职责拆入各 service，门面只负责编排、
 * 生命周期和少量向后兼容委托。
 */
export class FaithCoreService extends Service {
  readonly apiVersion = "3.0";
  private readonly capabilitySet = new Set([
    "transactions.idempotency", "transactions.multi-uid", "transactions.ledger", "transactions.callbacks",
    "permissions.persistent", "items.levels", "effects.persistent", "lifecycle.game-day", "integrity.check",
    "bulk.idempotent", "inventory.lightweight", "config.reload",
  ]);
  readonly capabilities = Object.freeze({
    has: (capability: string) => this.capabilitySet.has(capability),
    all: () => Object.freeze([...this.capabilitySet]),
  });
  readonly lifecycle: FaithLifecycleService;
  readonly gameDay: FaithGameDayService;
  readonly hooks: FaithHooksService;
  readonly bonuses: FaithBonusService;
  readonly professions: FaithProfessionService;
  readonly faiths: FaithRegistryService;
  readonly locks = new KeyedLockService();
  readonly permissions: FaithPermissionsService;
  private readonly transactions: FaithTransactionService;
  private readonly uids = new FaithUidService();
  readonly users: FaithUsersService;
  private readonly identities: FaithIdentityService;
  readonly adapter: Readonly<FaithAdapterIdentityApi>;
  private readonly businessData: FaithBusinessDataService;
  private readonly businessTransactions: FaithBusinessTransactionService;
  readonly items: FaithItemsService;
  readonly audit: FaithAuditService;
  readonly effects: FaithEffectsService;
  readonly integrity: FaithIntegrityService;
  readonly health: FaithHealthService;
  readonly bulk: FaithBulkOperationsService;
  readonly economy: FaithEconomyService;
  private readonly businessApis;

  declare config: Readonly<FaithCoreConfig>;

  constructor(ctx: Context, config: Readonly<FaithCoreConfig>) {
    super(ctx, "faithCore", true);
    this.config = normalizeCoreConfig(config);
    this.lifecycle = new FaithLifecycleService(ctx);
    this.permissions = new FaithPermissionsService(ctx);
    this.audit = new FaithAuditService(ctx.database);
    this.effects = new FaithEffectsService(ctx);
    this.hooks = new FaithHooksService(ctx);
    this.gameDay = new FaithGameDayService(ctx, this.config.gameDay, this.lifecycle, this.locks, this.hooks);
    this.transactions = new FaithTransactionService(ctx, this.hooks);
    this.users = new FaithUsersService(ctx, this.transactions, this.locks, this.hooks, this.audit);
    this.bonuses = new FaithBonusService(this.users, this.hooks);
    this.bonuses.registerProvider(this.effects.provider, { id: "core:persistent-effects", owner: "core", priority: -10_000 });
    this.users.attachBonuses(this.bonuses);
    this.identities = new FaithIdentityService(
      ctx,
      this.transactions,
      this.locks,
      this.hooks,
      this.uids,
      this.users,
    );
    this.adapter = Object.freeze({
      normalize: (identity: IdentityInput) => this.identities.normalize(identity),
      resolve: (identity: IdentityInput) => this.identities.resolve(identity),
      bind: (uid: number, identity: IdentityInput) => this.identities.bind(uid, identity),
    });
    this.businessData = new FaithBusinessDataService(ctx, this.transactions, this.locks, this.users);
    this.items = new FaithItemsService(ctx, this.transactions, this.locks, this.hooks, this.users, this.audit);
    this.professions = new FaithProfessionService(ctx, this.transactions, this.locks, this.users, this.hooks);
    this.professions.registerMany(CORE_PROFESSIONS, { owner: "core" });
    this.faiths = new FaithRegistryService(ctx, this.identities, this.users, this.professions, this.locks, this.hooks, this.config.registration.initialGold, this.audit);
    this.users.attachFaiths(this.faiths);
    this.integrity = new FaithIntegrityService(ctx, this.items, this.professions, this.faiths);
    this.health = new FaithHealthService(ctx, this);
    this.businessTransactions = new FaithBusinessTransactionService(
      this.transactions, this.locks, this.hooks, this.users, this.items, this.professions, this.audit, this.faiths,
    );
    this.economy = new FaithEconomyService(this.users, this.bonuses, this.businessTransactions);
    this.bulk = new FaithBulkOperationsService(ctx, this.users, this.items, this.businessTransactions);
    this.businessApis = createBusinessSharedApis(this.users, this.items, this.permissions, this.bonuses, this.identities, this.faiths, this.effects, this.bulk, this.economy);
    this.registerBuiltInItems();
    this.registerCoreLifecycle();
  }

  /** 原子更新运行时配置；失败时恢复注册默认值、游戏日调度器及公开配置快照。 */
  async reloadConfig(input: FaithCoreConfig) {
    const next = normalizeCoreConfig(input);
    return this.locks.run("core:config-reload", async () => {
      if (sameConfig(this.config, next)) return this.config;
      const previous = this.config;
      try {
        await this.applyRuntimeConfig(next);
        await this.lifecycle.reload(Object.freeze({ type: "core-config", previous, current: next }));
        return this.config;
      } catch (error) {
        try { await this.applyRuntimeConfig(previous); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], "Core 配置更新及回滚均失败"); }
        throw new FaithCoreError("LIFECYCLE_FAILED", "Core 配置 reload 失败，已恢复旧配置", { cause: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  private async applyRuntimeConfig(config: Readonly<FaithCoreConfig>) {
    if (!sameGameDay(this.config.gameDay, config.gameDay)) await this.gameDay.reconfigure(config.gameDay);
    this.faiths.configureRegistration(config.registration.initialGold);
    this.config = config;
  }

  private registerBuiltInItems() {
    this.items.registerMany([
      ...(CORE_ITEMS as unknown as FaithItemDefinition[]),
      ...(CORE_EASTER_EGGS as unknown as FaithItemDefinition[]),
      ...(CORE_OPENABLE_ITEMS as unknown as FaithItemDefinition[]),
    ], { owner: "core" });
  }

  private registerCoreLifecycle() {
    this.lifecycle.onReady(
      () => this.transactions.run((database) => this.uids.initialize(database)),
      { name: "core.uid-sequence", priority: -10_000, critical: true },
    );
    this.lifecycle.onReady(() => this.faiths.load(), { name: "core.faith-registry", priority: -9_000, critical: true });
    this.lifecycle.onReady(() => this.gameDay.start(), { name: "core.game-day", priority: -8_000, critical: true });
    this.lifecycle.onGameDay(async () => {
      await this.effects.cleanupExpired();
      await this.permissions.cleanupExpired();
    }, { name: "core.expired-resources", priority: -10_000, critical: true });
    this.lifecycle.defer(async () => {
      this.gameDay.stop();
      await this.locks.drain();
      this.hooks.clear();
      this.permissions.clear();
      this.bonuses.clear();
      this.professions.clear();
      this.faiths.clear();
      this.items.clear();
    });
  }

  /** 管理接口不向 Adapter 门面暴露；解绑只移除映射，不级联删除用户资产。 */
  listIdentities(uid: number) { return this.identities.list(uid); }
  unbindIdentity(uid: number, identity: IdentityInput) { return this.identities.unbind(uid, identity); }
  private registerBusinessTable(name: string, fields: BusinessModelFields, config = {}) {
    const allowed = ["created", "initializing", "initialized", "readying"];
    if (!allowed.includes(this.lifecycle.state)) {
      throw new Error(`业务表只能在 init/ready 初始化阶段注册，当前状态：${this.lifecycle.state}`);
    }
    return registerBusinessModel(this.ctx, name, fields, config);
  }
  createBusinessScope(name: string) {
    return new FaithBusinessCoreScope(
      this.lifecycle,
      name,
      this.businessApis,
      this.hooks,
      this.bonuses,
      this.professions,
      this.businessData,
      this.businessTransactions,
      this.gameDay,
      (business, fields, config) => this.registerBusinessTable(business, fields, config),
    );
  }
}

function sameGameDay(a: FaithCoreConfig["gameDay"], b: FaithCoreConfig["gameDay"]) {
  return a.enabled === b.enabled && a.timezone === b.timezone && a.rolloverHour === b.rolloverHour && a.rolloverMinute === b.rolloverMinute && a.checkIntervalSeconds === b.checkIntervalSeconds && a.lockTimeoutSeconds === b.lockTimeoutSeconds && a.runOnStartup === b.runOnStartup;
}
function sameConfig(a: FaithCoreConfig, b: FaithCoreConfig) {
  return a.registration.initialGold === b.registration.initialGold && sameGameDay(a.gameDay, b.gameDay);
}
