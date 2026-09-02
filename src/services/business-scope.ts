import { Model } from "koishi";
import type { BusinessModelFields } from "../database";
import type { FaithLifecycleScope } from "../lifecycle";
import type { FaithLifecycleService } from "../lifecycle";
import type { FaithBusinessDataService } from "./business-data";
import { assertBusinessName } from "./validation";
import { createBusinessBonusesApi, createBusinessBulkApi, createBusinessEconomyApi, createBusinessEffectsApi, createBusinessHooksApi, createBusinessItemsApi, createBusinessPermissionsApi, createBusinessProfessionsApi, type FaithBusinessBonusesApi, type FaithBusinessBulkApi, type FaithBusinessEconomyApi, type FaithBusinessEffectsApi, type FaithBusinessFaithsApi, type FaithBusinessHooksApi, type FaithBusinessIdentitiesApi, type FaithBusinessItemsApi, type FaithBusinessPermissionsApi, type FaithBusinessProfessionsApi, type FaithBusinessSharedApis, type FaithBusinessUsersApi } from "./business-scope-api";
import type { FaithHooksService } from "../hooks";
import type { FaithBonusService } from "../bonus";
import type { FaithBusinessTransactionService, FaithAtomicScope } from "./business-transaction";

export class FaithBusinessCoreScope {
  #businessData: FaithBusinessDataService;
  #registerModel: (
    name: string,
    fields: BusinessModelFields,
    config?: Partial<Model.Config>,
  ) => string;
  readonly lifecycle: FaithLifecycleScope;
  readonly users: Readonly<FaithBusinessUsersApi>;
  readonly items: Readonly<FaithBusinessItemsApi>;
  readonly permissions: Readonly<FaithBusinessPermissionsApi>;
  readonly hooks: Readonly<FaithBusinessHooksApi>;
  readonly bonuses: Readonly<FaithBusinessBonusesApi>;
  readonly professions: Readonly<FaithBusinessProfessionsApi>;
  readonly identities: Readonly<FaithBusinessIdentitiesApi>;
  readonly faiths: Readonly<FaithBusinessFaithsApi>;
  readonly transaction: FaithBusinessAtomicTransactionApi;
  readonly effects: Readonly<FaithBusinessEffectsApi>;
  readonly bulk: Readonly<FaithBusinessBulkApi>;
  readonly economy: Readonly<FaithBusinessEconomyApi>;
  readonly gameDay: Readonly<{ currentDate(now?: Date): string }>;
  readonly data: Readonly<{
    get(uid: number): ReturnType<FaithBusinessDataService["get"]>;
    set(uid: number, value: { private?: Record<string, unknown>; public?: Record<string, unknown> }): ReturnType<FaithBusinessDataService["set"]>;
  }>;

  constructor(
    lifecycle: FaithLifecycleService,
    readonly name: string,
    apis: FaithBusinessSharedApis,
    hooks: FaithHooksService,
    bonuses: FaithBonusService,
    professions: import("../professions").FaithProfessionService,
    businessData: FaithBusinessDataService,
    transactions: FaithBusinessTransactionService,
    gameDay: import("../lifecycle").FaithGameDayService,
    registerModel: (
      name: string,
      fields: BusinessModelFields,
      config?: Partial<Model.Config>,
    ) => string,
  ) {
    assertBusinessName(name);
    this.lifecycle = lifecycle.scope(`business:${name}`);
    this.users = apis.users;
    this.items = createBusinessItemsApi(apis.items, name);
    this.permissions = createBusinessPermissionsApi(apis.permissions, name);
    this.hooks = createBusinessHooksApi(hooks, name);
    this.bonuses = createBusinessBonusesApi(bonuses, name);
    this.professions = createBusinessProfessionsApi(professions, name);
    this.identities = apis.identities;
    this.faiths = apis.faiths;
    this.effects = createBusinessEffectsApi(apis.effects, name);
    this.bulk = createBusinessBulkApi(apis.bulk, name);
    this.economy = createBusinessEconomyApi(apis.economy, name);
    this.gameDay = Object.freeze({ currentDate: (now?: Date) => gameDay.getDate(now) });
    this.transaction = Object.freeze({
      run: <T>(uid: number, task: (scope: FaithAtomicScope) => Promise<T>, options?: import("./audit").FaithTransactionOptions) =>
        transactions.run(this.name, uid, task, options),
      runMany: <T>(uids: readonly number[], task: (scopes: ReadonlyMap<number, FaithAtomicScope>) => Promise<T>, options?: import("./audit").FaithTransactionOptions) =>
        transactions.runMany(this.name, uids, task, options),
    });
    this.#businessData = businessData;
    this.#registerModel = registerModel;
    this.data = Object.freeze({
      get: (uid: number) => this.#businessData.get(uid, this.name),
      set: (uid: number, value: { private?: Record<string, unknown>; public?: Record<string, unknown> }) => this.#businessData.set(uid, this.name, value),
    });
    this.lifecycle.defer(async () => {
      hooks.removeOwner(`business:${name}`); bonuses.removeOwner(`business:${name}`);
      apis.permissions.removeOwner(`business:${name}`);
    });
  }

  registerTable(fields: BusinessModelFields, config: Partial<Model.Config> = {}) {
    return this.#registerModel(this.name, fields, config);
  }
}

export interface FaithBusinessAtomicTransactionApi {
  run<T>(uid: number, task: (scope: FaithAtomicScope) => Promise<T>, options?: import("./audit").FaithTransactionOptions): Promise<T>;
  runMany<T>(uids: readonly number[], task: (scopes: ReadonlyMap<number, FaithAtomicScope>) => Promise<T>, options?: import("./audit").FaithTransactionOptions): Promise<T>;
}
