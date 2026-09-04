import { Context } from "koishi";
import { CallbackDisposable } from "./lifecycle/disposable";
import type { FaithCoreUserData, InventoryMutation } from "./types";
import type { FaithGameDayEvent } from "./lifecycle";

/** 可通过 TypeScript declaration merging 扩展。 */
export interface FaithCoreHookMap {
  "user/created": { uid: number };
  "user/registered": { uid: number; faith: string; user: FaithCoreUserData };
  "user/values-changed": { uid: number; before: FaithCoreUserData; after: FaithCoreUserData; delta?: Record<string, number> };
  "inventory/changed": InventoryMutation;
  "game-day/before": FaithGameDayEvent;
  "game-day/completed": FaithGameDayEvent;
  "game-day/failed": FaithGameDayEvent & { error: unknown };
}
export type FaithCoreHookName = keyof FaithCoreHookMap;

export interface FaithHookOptions { id?: string; owner?: string; priority?: number; once?: boolean; timeout?: number; }
export interface FaithHookContext { readonly event: string; readonly handlerId: string; readonly owner: string; readonly signal: AbortSignal; }
export type FaithHookHandler<T = unknown, R = void> = (payload: T, context: FaithHookContext) => R | Promise<R>;
export interface FaithHookFailure { handlerId: string; owner: string; error: unknown; }
export interface FaithHookReport<R = unknown> { event: string; invoked: number; results: R[]; failures: FaithHookFailure[]; }
interface HookEntry { id: string; owner: string; priority: number; order: number; once: boolean; timeout: number; handler: FaithHookHandler; }

/** 支持广播、bail、waterfall 的安全 Hook 总线。单处理器失败不会中断其他处理器。 */
export class FaithHooksService {
  private handlers = new Map<string, Map<string, HookEntry>>();
  private orderedHandlers = new Map<string, readonly HookEntry[]>();
  private order = 0;
  private readonly logger;
  constructor(ctx: Context) { this.logger = ctx.logger("cocofaith-core-hooks"); }

  onCore<K extends FaithCoreHookName>(event: K, handler: FaithHookHandler<FaithCoreHookMap[K]>, options: FaithHookOptions = {}) {
    return this.on(event, handler, options);
  }
  emitCore<K extends FaithCoreHookName>(event: K, payload: FaithCoreHookMap[K]) { return this.emit(event, payload); }

  on<T, R = void>(event: string, handler: FaithHookHandler<T, R>, options: FaithHookOptions = {}) {
    assertEvent(event);
    if (typeof handler !== "function") throw new TypeError("Hook 处理器必须是函数");
    const owner = normalizeOwner(options.owner ?? "external"), id = options.id ?? `${owner}:${++this.order}`;
    if (!/^[a-zA-Z0-9_.:/-]{1,160}$/.test(id)) throw new Error(`非法 Hook ID：${id}`);
    const timeout = options.timeout ?? 5_000;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 60_000) throw new Error("Hook timeout 必须是 0-60000 毫秒");
    const entries = this.handlers.get(event) ?? new Map<string, HookEntry>();
    if (entries.has(id)) throw new Error(`Hook 已注册：${event}/${id}`);
    if (entries.size >= 1_000) throw new Error(`Hook ${event} 的处理器数量已达上限`);
    entries.set(id, { id, owner, priority: finite(options.priority ?? 0), order: this.order, once: !!options.once, timeout, handler: handler as FaithHookHandler });
    this.handlers.set(event, entries);
    this.orderedHandlers.delete(event);
    return new CallbackDisposable(() => { this.off(event, id); });
  }

  off(event: string, handlerOrId: FaithHookHandler | string) {
    const entries = this.handlers.get(event);
    if (!entries) return false;
    let removed = false;
    if (typeof handlerOrId === "string") removed = entries.delete(handlerOrId);
    else for (const [id, entry] of entries) if (entry.handler === handlerOrId) { entries.delete(id); removed = true; }
    if (!entries.size) this.handlers.delete(event);
    if (removed) this.orderedHandlers.delete(event);
    return removed;
  }

  emit<T>(event: string, payload: T) { return this.run<T, void>(event, payload, "all"); }
  async emitStrict<T>(event: string, payload: T) {
    const report = await this.run<T, void>(event, payload, "all");
    if (report.failures.length) throw new AggregateError(report.failures.map((item) => item.error), `关键 Hook 执行失败：${event}`);
    return report;
  }
  async bail<T, R>(event: string, payload: T): Promise<R | undefined> {
    const report = await this.run<T, R>(event, payload, "bail");
    return report.results.find((result) => result !== undefined);
  }
  async bailStrict<T, R>(event: string, payload: T): Promise<R | undefined> {
    const report = await this.run<T, R>(event, payload, "bail");
    if (report.failures.length) throw new AggregateError(report.failures.map((item) => item.error), `关键 Hook 执行失败：${event}`);
    return report.results.find((result) => result !== undefined);
  }
  async waterfall<T>(event: string, initial: T): Promise<T> {
    assertEvent(event);
    let value = initial;
    for (const entry of this.snapshot(event)) {
      const result = await this.invoke<T, T | void>(event, entry, value);
      if (result.ok && result.value !== undefined) value = result.value as T;
    }
    return value;
  }
  async waterfallStrict<T>(event: string, initial: T): Promise<T> {
    assertEvent(event); let value = initial;
    for (const entry of this.snapshot(event)) {
      const result = await this.invoke<T, T | void>(event, entry, value);
      if (!result.ok) throw "error" in result ? result.error : new Error(`关键 Hook 执行失败：${event}`);
      if (result.value !== undefined) value = result.value as T;
    }
    return value;
  }

  count(event?: string) { return event ? this.handlers.get(event)?.size ?? 0 : [...this.handlers.values()].reduce((sum, item) => sum + item.size, 0); }
  removeOwner(owner: string) {
    let removed = 0;
    for (const [event, entries] of this.handlers) {
      for (const [id, entry] of entries) if (entry.owner === owner) { entries.delete(id); removed++; }
      if (!entries.size) this.handlers.delete(event);
      this.orderedHandlers.delete(event);
    }
    return removed;
  }
  clear() { this.handlers.clear(); this.orderedHandlers.clear(); }

  private async run<T, R>(event: string, payload: T, mode: "all" | "bail"): Promise<FaithHookReport<R>> {
    assertEvent(event);
    const results: R[] = [], failures: FaithHookFailure[] = [];
    let invoked = 0;
    for (const entry of this.snapshot(event)) {
      invoked++;
      const result = await this.invoke<T, R>(event, entry, payload);
      if (result.ok) { results.push(result.value); if (mode === "bail" && result.value !== undefined) break; }
      else failures.push({ handlerId: entry.id, owner: entry.owner, error: "error" in result ? result.error : new Error("未知 Hook 错误") });
    }
    return { event, invoked, results, failures };
  }
  private snapshot(event: string) {
    const cached = this.orderedHandlers.get(event);
    if (cached) return cached;
    const ordered = [...(this.handlers.get(event)?.values() ?? [])].sort((a, b) => a.priority - b.priority || a.order - b.order);
    this.orderedHandlers.set(event, ordered);
    return ordered;
  }
  private async invoke<T, R>(event: string, entry: HookEntry, payload: T): Promise<{ ok: true; value: R } | { ok: false; error: unknown }> {
    if (entry.once) this.off(event, entry.id);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = Promise.resolve(entry.handler(payload, Object.freeze({ event, handlerId: entry.id, owner: entry.owner, signal: controller.signal })) as R);
      const value = entry.timeout === 0 ? await work : await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error(`Hook 执行超时：${event}/${entry.id}`)); }, entry.timeout);
      })]);
      return { ok: true, value };
    } catch (error) {
      this.logger.error(`Hook 处理器失败：${event}/${entry.id}`, error);
      return { ok: false, error };
    } finally { if (timer) clearTimeout(timer); }
  }
}
function assertEvent(event: string) { if (!/^[a-z][a-z0-9_.:/-]{0,127}$/.test(event)) throw new Error(`非法 Hook 名称：${event}`); }
function normalizeOwner(owner: string) { if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(owner)) throw new Error(`非法 Hook owner：${owner}`); return owner; }
function finite(value: number) { if (!Number.isFinite(value)) throw new Error("Hook priority 必须是有限数字"); return value; }
