import type { FaithBonusService } from "../bonus";
import { FaithCoreError } from "../errors";
import type { FaithBusinessTransactionService } from "../services/transaction";
import type { FaithUsersService } from "../services/users";
import type { FaithCoreUserData, UserValueDelta } from "../types";
import { cloneBusinessRecord } from "../services/validation";
import type { FaithCurrency, FaithEconomyChangeResult, FaithEconomyOptions, FaithMoney, FaithRewardOptions, FaithRewardPreview, FaithTransferResult, FaithWallet } from "./types";

const CURRENCIES = ["gold", "ascension_score"] as const;

/** Faith 真实玩法使用的双货币服务，不提供动态币种注册。 */
export class FaithEconomyService {
  constructor(
    private users: FaithUsersService,
    private bonuses: FaithBonusService,
    private transactions: FaithBusinessTransactionService,
  ) {}

  async getWallet(uid: number): Promise<FaithWallet> {
    return wallet(await this.users.require(uid));
  }

  async canAfford(uid: number, cost: Readonly<FaithMoney>) {
    const normalized = normalizePositiveMoney(cost, "费用", true), current = await this.getWallet(uid);
    return requestedCurrencies(normalized).every((currency) => current[currency] >= normalized[currency]!);
  }

  async requireFunds(uid: number, cost: Readonly<FaithMoney>) {
    const normalized = normalizePositiveMoney(cost, "费用", true), current = await this.getWallet(uid);
    assertAffordable(current, normalized);
    return current;
  }

  /** 门票、购买、押注及组合费用；不应用加成，余额检查与扣除同事务完成。 */
  async pay(uid: number, cost: Readonly<FaithMoney>, options: FaithEconomyOptions): Promise<FaithEconomyChangeResult> {
    const requested = normalizePositiveMoney(cost, "费用");
    return this.changeFixed(uid, requested, negate(requested), options, true);
  }

  /** 玩法产出；默认应用 v2 正向奖励加成。 */
  async reward(uid: number, amount: Readonly<FaithMoney>, options: FaithRewardOptions): Promise<FaithEconomyChangeResult> {
    const requested = normalizePositiveMoney(amount, "奖励");
    const preview = options.applyBonuses === false
      ? Object.freeze({ uid, requested, applied: requested, calculations: Object.freeze({}) })
      : await this.previewReward(uid, requested, options.source, options.metadata);
    return this.changeFixed(uid, requested, preview.applied, options, false);
  }

  /** 退票、取消下注、奖池本金返还；固定原值，不应用奖励加成。 */
  refund(uid: number, amount: Readonly<FaithMoney>, options: FaithEconomyOptions) {
    const requested = normalizePositiveMoney(amount, "退款");
    return this.changeFixed(uid, requested, requested, options, false);
  }

  /** 玩家间直接转移，不产生加成，也不会增发货币。 */
  async transfer(fromUid: number, toUid: number, amount: Readonly<FaithMoney>, options: FaithEconomyOptions): Promise<FaithTransferResult> {
    if (fromUid === toUid) throw new FaithCoreError("VALIDATION_FAILED", "付款方与收款方不能相同");
    const normalized = normalizePositiveMoney(amount, "转账金额"), audit = auditOptions(options);
    const result = await this.transactions.runMany("core_economy", [fromUid, toUid], async (scopes) => {
      const fromScope = scopes.get(fromUid)!, toScope = scopes.get(toUid)!;
      const [fromBefore, toBefore] = await Promise.all([fromScope.users.get(), toScope.users.get()]);
      assertAffordable(wallet(fromBefore), normalized);
      const fromUser = await fromScope.users.change(negate(normalized));
      const toUser = await toScope.users.change(normalized);
      return { fromBefore, toBefore, fromUser, toUser };
    }, audit);
    return Object.freeze({
      amount: normalized,
      from: changeResult(fromUid, normalized, negate(normalized), result.fromBefore, result.fromUser),
      to: changeResult(toUid, normalized, normalized, result.toBefore, result.toUser),
    });
  }

  async previewReward(uid: number, amount: Readonly<FaithMoney>, source: string, metadata?: Readonly<Record<string, unknown>>): Promise<FaithRewardPreview> {
    const requested = normalizePositiveMoney(amount, "奖励"), applied: FaithMoney = {}, calculations: Partial<Record<FaithCurrency, Awaited<ReturnType<FaithBonusService["calculate"]>>>> = {};
    validateSource(source);
    const safeMetadata = cloneBusinessRecord(metadata ?? {});
    const user = await this.users.require(uid);
    const currencies = CURRENCIES.filter((currency) => requested[currency] !== undefined);
    const resolved = await Promise.all(currencies.map((currency) => this.bonuses.calculateForUser(user, { uid, type: currency, baseValue: requested[currency]!, source, metadata: safeMetadata })));
    for (let index = 0; index < currencies.length; index++) {
      const currency = currencies[index];
      const value = requested[currency];
      if (value === undefined) continue;
      const calculation = resolved[index];
      if (!Number.isSafeInteger(calculation.finalValue) || calculation.finalValue < 0) throw new FaithCoreError("VALIDATION_FAILED", `加成后的${currency}奖励无效`);
      applied[currency] = calculation.finalValue; calculations[currency] = calculation;
    }
    return Object.freeze({ uid, requested, applied: Object.freeze(applied), calculations: Object.freeze(calculations) });
  }

  private async changeFixed(uid: number, requested: Readonly<FaithMoney>, applied: Readonly<FaithMoney>, options: FaithEconomyOptions, checkFunds: boolean) {
    const result = await this.transactions.run("core_economy", uid, async (scope) => {
      const before = await scope.users.get();
      if (checkFunds) assertAffordable(wallet(before), requested);
      const user = await scope.users.change(applied as UserValueDelta);
      return { before, user };
    }, auditOptions(options));
    return changeResult(uid, requested, applied, result.before, result.user);
  }
}

function normalizePositiveMoney(input: Readonly<FaithMoney>, label: string, allowEmpty = false): Readonly<FaithMoney> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new FaithCoreError("VALIDATION_FAILED", `${label}必须是货币对象`);
  const result: FaithMoney = {};
  for (const [key, value] of Object.entries(input)) {
    if (!CURRENCIES.includes(key as FaithCurrency)) throw new FaithCoreError("VALIDATION_FAILED", `不支持的货币：${key}`);
    if (!Number.isSafeInteger(value) || value < 0) throw new FaithCoreError("VALIDATION_FAILED", `${label}必须是非负安全整数：${key}`);
    if (value === 0) continue;
    result[key as FaithCurrency] = value;
  }
  if (!allowEmpty && !Object.keys(result).length) throw new FaithCoreError("VALIDATION_FAILED", `${label}不能为空`);
  return Object.freeze(result);
}
function wallet(user: FaithCoreUserData): FaithWallet { return Object.freeze({ uid: user.uid, gold: user.gold, ascension_score: user.ascension_score }); }
function assertAffordable(current: FaithWallet, cost: Readonly<FaithMoney>) {
  const missing = requestedCurrencies(cost).filter((currency) => current[currency] < cost[currency]!);
  if (missing.length) throw new FaithCoreError("INSUFFICIENT_BALANCE", "货币余额不足", { uid: current.uid, missing, wallet: current, cost: { ...cost } });
}
function requestedCurrencies(value: Readonly<FaithMoney>) { return CURRENCIES.filter((currency) => value[currency] !== undefined); }
function negate(value: Readonly<FaithMoney>): Readonly<FaithMoney> { return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, -amount])) as FaithMoney); }
function auditOptions(options: FaithEconomyOptions) {
  if (!options) throw new FaithCoreError("VALIDATION_FAILED", "经济操作选项不能为空");
  validateSource(options.source);
  return { idempotencyKey: options.idempotencyKey, source: options.source, operatorUid: options.operatorUid, metadata: cloneBusinessRecord(options.metadata ?? {}) };
}
function validateSource(source: string) {
  if (typeof source !== "string" || source.length > 128 || !/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(source)) throw new FaithCoreError("VALIDATION_FAILED", "经济操作 source 必须使用 business.action 格式");
}
function changeResult(uid: number, requested: Readonly<FaithMoney>, applied: Readonly<FaithMoney>, before: FaithCoreUserData, user: FaithCoreUserData): FaithEconomyChangeResult {
  return Object.freeze({ uid, requested, applied, before: wallet(before), after: wallet(user), user });
}
