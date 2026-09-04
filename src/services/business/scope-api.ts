import type { FaithHooksService } from "../../hooks";
import type { FaithBonusService } from "../../bonus";
import type { FaithItemsService } from "../../items";
import type { FaithPermissionsService } from "../../permissions";
import type { FaithUsersService } from "../users";
import type { FaithProfessionService } from "../../professions";
import type { FaithIdentityService } from "../identity";
import type { FaithRegistryService } from "../../faith";
import type { FaithEffectsService, CreateFaithEffect } from "../../effects";
import type { BonusCalculation, BonusProvider, BonusProviderOptions, BonusRequest } from "../../bonus";
import type { FaithCoreUserData, FaithDefinition, FaithEffectRow, FaithItemDefinition, FaithItemLevelDefinition, FaithOpenResult, FaithProfessionDefinition, IdentityInput, InventoryItem, InventoryMutation, InventoryStack, ItemQuery, UserValueDelta } from "../../types";
import type { FaithDisposable } from "../../lifecycle";
import type { CoreDatabase } from "../transaction";
import type { FaithBulkOperationsService, FaithBulkOptions, FaithBulkResult } from "../users";
import type { FaithEconomyService, FaithEconomyOptions, FaithMoney, FaithRewardOptions, FaithRewardPreview, FaithWallet, FaithEconomyChangeResult, FaithTransferResult } from "../../economy";

export interface FaithBusinessUsersApi {
  get(uid: number): Promise<FaithCoreUserData | null>;
  require(uid: number): Promise<FaithCoreUserData>;
  currentFaith(user: FaithCoreUserData): string | null;
}
export interface FaithBusinessItemsApi {
  register(definition: FaithItemDefinition, options?: { replace?: boolean }): Readonly<FaithItemDefinition>;
  registerMany(definitions: readonly FaithItemDefinition[], options?: { replace?: boolean }): Readonly<FaithItemDefinition>[];
  unregister(itemId: string): Promise<boolean>;
  get(itemId: string): Readonly<FaithItemDefinition> | undefined;
  getByName(name: string): Readonly<FaithItemDefinition> | undefined;
  resolve(itemIdOrName: string): Readonly<FaithItemDefinition> | undefined;
  require(itemIdOrName: string): Readonly<FaithItemDefinition>;
  has(itemIdOrName: string): boolean;
  all(): Readonly<FaithItemDefinition>[];
  list(query?: ItemQuery): Readonly<FaithItemDefinition>[];
  obtainable(): Readonly<FaithItemDefinition>[];
  marketable(): Readonly<FaithItemDefinition>[];
  isOpenable(itemIdOrName: string): boolean;
  rollOpenable(itemIdOrName: string, random?: () => number): FaithOpenResult;
  getInventoryEntries(uid: number): Promise<InventoryItem[]>;
  getInventoryStacks(uid: number): Promise<InventoryStack[]>;
  getInventorySnapshot(uid: number): Promise<Readonly<Record<string, InventoryItem>>>;
  listInventory(uid: number, options?: { type?: string; level?: string; offset?: number; limit?: number }): Promise<InventoryItem[]>;
  getQuantity(uid: number, itemIdOrName: string): Promise<number>;
  hasQuantity(uid: number, itemIdOrName: string, quantity?: number): Promise<boolean>;
  canReceive(uid: number, itemIdOrName: string, quantity?: number): Promise<boolean>;
  readonly levels: FaithBusinessItemLevelsApi;
}
export interface FaithBusinessItemLevelsApi {
  register(definition: FaithItemLevelDefinition, options?: { replace?: boolean }): Readonly<FaithItemLevelDefinition>;
  registerMany(definitions: readonly FaithItemLevelDefinition[], options?: { replace?: boolean }): Readonly<FaithItemLevelDefinition>[];
  get(id: string): Readonly<FaithItemLevelDefinition> | undefined;
  require(id: string): Readonly<FaithItemLevelDefinition>;
  all(): Readonly<FaithItemLevelDefinition>[];
  compare(a: string, b: string): number;
}
export interface FaithBusinessPermissionsApi {
  register(permission: string, policy: import("../../permissions").PermissionPolicy): FaithDisposable;
  check(uid: number, permission: string, data?: Record<string, unknown>, scope?: string, scopeValue?: string): Promise<boolean>;
}
export interface FaithBusinessProfessionsApi {
  register(definition: FaithProfessionDefinition, options?: { override?: boolean }): Readonly<FaithProfessionDefinition>;
  registerMany(definitions: readonly FaithProfessionDefinition[], options?: { override?: boolean }): Readonly<FaithProfessionDefinition>[];
  unregister(id: string): boolean;
  get(id: string): Readonly<FaithProfessionDefinition> | undefined;
  getByName(name: string): Readonly<FaithProfessionDefinition> | undefined;
  resolve(idOrName: string): Readonly<FaithProfessionDefinition> | undefined;
  require(idOrName: string): Readonly<FaithProfessionDefinition>;
  all(): Readonly<FaithProfessionDefinition>[];
  list(query?: { faith?: string; type?: string; source?: string }): Readonly<FaithProfessionDefinition>[];
  getUserProfession(uid: number): Promise<Readonly<FaithProfessionDefinition> | null>;
}
export interface FaithBusinessIdentitiesApi { resolve(input: IdentityInput): Promise<number | null>; }
export interface FaithBusinessFaithsApi {
  get(name: string): Readonly<FaithDefinition> | undefined;
  require(name: string): Readonly<FaithDefinition>;
  has(name: string): boolean;
  all(): Readonly<FaithDefinition>[];
  byPath(path: string): Readonly<FaithDefinition>[];
  registerUser(identity: IdentityInput, faithName: string, initialGold?: number): Promise<FaithCoreUserData>;
  registerDynamic(input: { name: string; path: string; creatorUid: number; prayerWord?: string; metadata?: Record<string, unknown> }): Promise<Readonly<FaithDefinition>>;
  setPrayerWord(name: string, word: string): Promise<Readonly<FaithDefinition>>;
  setCustomProfession(name: string, type: string, professionName: string): Promise<Readonly<FaithDefinition>>;
}
export interface FaithBusinessHooksApi {
  on<T, R = void>(event: string, handler: import("../../hooks").FaithHookHandler<T, R>, options?: import("../../hooks").FaithHookOptions): FaithDisposable;
  emit<T>(event: string, payload: T): Promise<import("../../hooks").FaithHookReport<void>>;
}
export interface FaithBusinessBonusesApi {
  calculate(request: BonusRequest): Promise<BonusCalculation>;
  overview(uid: number, types?: readonly string[], baseValue?: number): Promise<BonusCalculation[]>;
  registerProvider(provider: BonusProvider, options: Omit<BonusProviderOptions, "owner">): FaithDisposable;
}
export interface FaithBusinessEffectsApi {
  create(input: Omit<CreateFaithEffect, "owner">): Promise<FaithEffectRow>;
  remove(id: number): Promise<unknown>;
  list(query?: Parameters<FaithEffectsService["list"]>[0]): Promise<FaithEffectRow[]>;
}
export interface FaithBusinessBulkApi {
  incrementValuesForAll(delta: Readonly<UserValueDelta>, options: FaithBulkOptions): Promise<FaithBulkResult>;
  giveItemToAll(itemIdOrName: string, quantity: number, options: FaithBulkOptions): Promise<FaithBulkResult>;
}
export interface FaithBusinessEconomyOptions extends Omit<FaithEconomyOptions, "source"> { action: string; }
export interface FaithBusinessRewardOptions extends Omit<FaithRewardOptions, "source"> { action: string; }
export interface FaithBusinessEconomyApi {
  getWallet(uid: number): Promise<FaithWallet>;
  canAfford(uid: number, cost: Readonly<FaithMoney>): Promise<boolean>;
  requireFunds(uid: number, cost: Readonly<FaithMoney>): Promise<FaithWallet>;
  pay(uid: number, cost: Readonly<FaithMoney>, options: FaithBusinessEconomyOptions): Promise<FaithEconomyChangeResult>;
  reward(uid: number, amount: Readonly<FaithMoney>, options: FaithBusinessRewardOptions): Promise<FaithEconomyChangeResult>;
  refund(uid: number, amount: Readonly<FaithMoney>, options: FaithBusinessEconomyOptions): Promise<FaithEconomyChangeResult>;
  transfer(fromUid: number, toUid: number, amount: Readonly<FaithMoney>, options: FaithBusinessEconomyOptions): Promise<FaithTransferResult>;
  previewReward(uid: number, amount: Readonly<FaithMoney>, action: string, metadata?: Readonly<Record<string, unknown>>): Promise<FaithRewardPreview>;
}

export function createBusinessUsersApi(service: FaithUsersService): Readonly<FaithBusinessUsersApi> {
  return Object.freeze({
    get: (uid: number) => service.get(uid),
    require: (uid: number) => service.require(uid),
    currentFaith: (user: FaithCoreUserData) => service.currentFaith(user),
  });
}

export function createBusinessItemsApi(service: FaithItemsService, business: string): Readonly<FaithBusinessItemsApi> {
  const owner = `business:${business}`;
  return Object.freeze({
    register: (definition: import("../../types").FaithItemDefinition, options: { replace?: boolean } = {}) => service.register(definition, { ...options, owner }),
    registerMany: (definitions: readonly import("../../types").FaithItemDefinition[], options: { replace?: boolean } = {}) => service.registerMany(definitions, { ...options, owner }),
    unregister: (itemId: string) => service.unregister(itemId, owner),
    get: (id: string) => service.get(id), getByName: (name: string) => service.getByName(name),
    resolve: (key: string) => service.resolve(key), require: (key: string) => service.require(key),
    has: (key: string) => service.has(key), all: () => service.all(), list: (query?: ItemQuery) => service.list(query),
    obtainable: () => service.obtainable(), marketable: () => service.marketable(),
    isOpenable: (key: string) => service.isOpenable(key), rollOpenable: (key: string, random?: () => number) => service.rollOpenable(key, random),
    getInventoryEntries: (uid: number) => service.getInventoryEntries(uid), getInventoryStacks: (uid: number) => service.getInventoryStacks(uid),
    getInventorySnapshot: (uid: number) => service.getInventorySnapshot(uid),
    listInventory: (uid: number, options?: { type?: string; level?: string; offset?: number; limit?: number }) => service.listInventory(uid, options),
    getQuantity: (uid: number, item: string) => service.getQuantity(uid, item),
    hasQuantity: (uid: number, item: string, quantity?: number) => service.hasQuantity(uid, item, quantity),
    canReceive: (uid: number, item: string, quantity?: number) => service.canReceive(uid, item, quantity),
    levels: Object.freeze({
      register: (definition: import("../../types").FaithItemLevelDefinition, options: { replace?: boolean } = {}) => service.levels.register(definition, { ...options, owner }),
      registerMany: (definitions: readonly import("../../types").FaithItemLevelDefinition[], options: { replace?: boolean } = {}) => service.levels.registerMany(definitions, { ...options, owner }),
      get: (id: string) => service.levels.get(id), require: (id: string) => service.levels.require(id),
      all: () => service.levels.all(), compare: (a: string, b: string) => service.levels.compare(a, b),
    }),
  });
}

export function createBusinessPermissionsApi(service: FaithPermissionsService, business: string): Readonly<FaithBusinessPermissionsApi> {
  return Object.freeze({
    register: (permission: string, policy: import("../../permissions").PermissionPolicy) =>
      service.register(permission, policy, { owner: `business:${business}` }),
    check: (uid, permission, data, scope, scopeValue) => service.check(uid, permission, data, scope, scopeValue),
  });
}

export function createBusinessProfessionsApi(service: FaithProfessionService, business: string): Readonly<FaithBusinessProfessionsApi> {
  const owner = `business:${business}`;
  return Object.freeze({
    register: (definition: import("../../types").FaithProfessionDefinition, options: { override?: boolean } = {}) => service.register(definition, { ...options, owner }),
    registerMany: (definitions: readonly import("../../types").FaithProfessionDefinition[], options: { override?: boolean } = {}) => service.registerMany(definitions, { ...options, owner }),
    unregister: (id: string) => service.unregister(id, owner),
    get: (id) => service.get(id), getByName: (name) => service.getByName(name), resolve: (key) => service.resolve(key), require: (key) => service.require(key),
    all: () => service.all(), list: (query) => service.list(query), getUserProfession: (uid) => service.getUserProfession(uid),
  });
}

export function createBusinessIdentitiesApi(service: FaithIdentityService): Readonly<FaithBusinessIdentitiesApi> {
  return Object.freeze({ resolve: (identity: IdentityInput) => service.resolve(identity) });
}

export function createBusinessFaithsApi(service: FaithRegistryService): Readonly<FaithBusinessFaithsApi> {
  return Object.freeze({
    get: (name) => service.get(name), require: (name) => service.require(name), has: (name) => service.has(name), all: () => service.all(), byPath: (path) => service.byPath(path),
    registerUser: (identity, faith, initialGold) => service.registerUser(identity, faith, initialGold), registerDynamic: (input) => service.registerDynamic(input), setPrayerWord: (name, word) => service.setPrayerWord(name, word),
    setCustomProfession: (name, type, profession) => service.setCustomProfession(name, type, profession),
  });
}

export function createBusinessHooksApi(service: FaithHooksService, business: string): Readonly<FaithBusinessHooksApi> {
  return Object.freeze({
    on: <T, R = void>(event: string, handler: import("../../hooks").FaithHookHandler<T, R>, options: import("../../hooks").FaithHookOptions = {}) => {
      if (RESTRICTED_BUSINESS_HOOKS.has(event)) throw new Error(`Business 不能订阅可改变 Core 控制流的 Hook：${event}`);
      return service.on(event, handler, { ...options, owner: `business:${business}` });
    },
    emit: <T>(event: string, payload: T) => {
      if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(event)) throw new Error(`非法业务 Hook 名称：${event}`);
      return service.emit(`business/${business}/${event}`, payload);
    },
  });
}
export function createBusinessBonusesApi(service: FaithBonusService, business: string): Readonly<FaithBusinessBonusesApi> {
  return Object.freeze({
    calculate: (request: BonusRequest) => service.calculate(request),
    overview: (uid: number, types?: readonly string[], baseValue?: number) => service.overview(uid, types, baseValue),
    registerProvider: (provider: import("../../bonus").BonusProvider, options: Omit<import("../../bonus").BonusProviderOptions, "owner">) => service.registerProvider(provider, { ...options, owner: `business:${business}` }),
  });
}
export function createBusinessEffectsApi(service: FaithEffectsService, business: string): Readonly<FaithBusinessEffectsApi> {
  const owner = `business:${business}`;
  return Object.freeze({
    create: (input: Omit<CreateFaithEffect, "owner">) => service.create({ ...input, owner }),
    remove: async (id: number) => { const effect = await service.get(id); if (!effect || effect.owner !== owner) throw new Error("不能删除其他业务的效果"); return service.remove(id); },
    list: (query?: Parameters<FaithEffectsService["list"]>[0]) => service.list(query).then((rows) => rows.filter((row) => row.owner === owner)),
  });
}
export function createBusinessBulkApi(service: FaithBulkOperationsService, business: string): Readonly<FaithBusinessBulkApi> {
  const options = (value: FaithBulkOptions): FaithBulkOptions => {
    if (!value || typeof value.operationId !== "string" || value.operationId.length > 60) throw new Error("Business 全体操作 operationId 必须是最多 60 字符的字符串");
    return { ...value, operationId: `${business}:${value.operationId}` };
  };
  return Object.freeze({
    incrementValuesForAll: (delta, value) => service.incrementValuesForAll(delta, options(value)),
    giveItemToAll: (item, quantity, value) => service.giveItemToAll(item, quantity, options(value)),
  });
}
export function createBusinessEconomyApi(service: FaithEconomyService, business: string): Readonly<FaithBusinessEconomyApi> {
  const source = (action: string) => {
    if (typeof action !== "string" || action.length > 62 || !/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/.test(action)) throw new Error("经济操作 action 必须使用小写语义名称");
    return `${business}.${action}`;
  };
  const options = <T extends FaithBusinessEconomyOptions | FaithBusinessRewardOptions>(value: T) => {
    if (!value || typeof value !== "object") throw new Error("经济操作选项不能为空");
    const { action, ...rest } = value;
    return { ...rest, source: source(action) };
  };
  return Object.freeze({
    getWallet: (uid) => service.getWallet(uid), canAfford: (uid, cost) => service.canAfford(uid, cost), requireFunds: (uid, cost) => service.requireFunds(uid, cost),
    pay: (uid, cost, value) => service.pay(uid, cost, options(value)), reward: (uid, amount, value) => service.reward(uid, amount, options(value)),
    refund: (uid, amount, value) => service.refund(uid, amount, options(value)), transfer: (from, to, amount, value) => service.transfer(from, to, amount, options(value)),
    previewReward: (uid, amount, action, metadata) => service.previewReward(uid, amount, source(action), metadata),
  });
}

export function createBusinessSharedApis(
  users: FaithUsersService,
  items: FaithItemsService,
  permissions: FaithPermissionsService,
  bonuses: FaithBonusService,
  identities: FaithIdentityService,
  faiths: FaithRegistryService,
  effects: FaithEffectsService,
  bulk: FaithBulkOperationsService,
  economy: FaithEconomyService,
) {
  return Object.freeze({
    users: createBusinessUsersApi(users),
    items,
    permissions,
    identities: createBusinessIdentitiesApi(identities),
    faiths: createBusinessFaithsApi(faiths),
    effects,
    bulk,
    economy,
  });
}

export type FaithBusinessSharedApis = ReturnType<typeof createBusinessSharedApis>;

const RESTRICTED_BUSINESS_HOOKS = new Set([
  "identity/before-create-user", "identity/before-bind", "user/before-values-change",
  "transaction/before", "bonus/before-calculate", "bonus/contributions",
]);
