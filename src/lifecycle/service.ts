import { Context } from "koishi";
import { CallbackDisposable } from "./disposable";
import { FaithLifecycleScope } from "./scope";
import type {
  FaithDisposable,
  FaithLifecycleHandler,
  FaithLifecycleStage,
  FaithLifecycleState,
  LifecycleRegistration,
  LifecycleRegistrationOptions,
} from "./types";

const COMPLETED_STAGE_STATES: Partial<Record<FaithLifecycleStage, FaithLifecycleState[]>> = {
  init: ["initialized", "readying", "ready", "reloading", "disposing", "disposed"],
  ready: ["ready", "reloading", "disposing", "disposed"],
  dispose: ["disposed"],
};

export class FaithLifecycleService {
  state: FaithLifecycleState = "created";
  private sequence = 0;
  private handlers = new Map<FaithLifecycleStage, Map<number, LifecycleRegistration>>();
  private scopes = new Set<FaithLifecycleScope>();
  private resources: FaithDisposable[] = [];
  private readonly logger;

  constructor(private ctx: Context) {
    this.logger = ctx.logger("cocofaith-core-lifecycle");
    ctx.on("ready", () => this.ready());
    ctx.on("dispose", () => this.dispose());
  }

  onInit(handler: FaithLifecycleHandler, options?: LifecycleRegistrationOptions) {
    return this.on("init", handler, options);
  }
  onReady(handler: FaithLifecycleHandler, options?: LifecycleRegistrationOptions) {
    return this.on("ready", handler, options);
  }
  onReload(handler: FaithLifecycleHandler, options?: LifecycleRegistrationOptions) {
    return this.on("reload", handler, options);
  }
  onDispose(handler: FaithLifecycleHandler, options?: LifecycleRegistrationOptions) {
    return this.on("dispose", handler, options);
  }
  onGameDay(handler: FaithLifecycleHandler<import("./types").FaithGameDayEvent>, options?: LifecycleRegistrationOptions) {
    return this.on("game-day", handler, { critical: true, ...options });
  }

  dispatchGameDay(event: import("./types").FaithGameDayEvent) {
    if (this.state !== "ready" && this.state !== "readying") throw new Error(`当前状态不能触发游戏日：${this.state}`);
    return this.dispatch("game-day", Object.freeze(event));
  }

  on(
    stage: FaithLifecycleStage,
    handler: FaithLifecycleHandler,
    options: LifecycleRegistrationOptions = {},
  ): FaithDisposable {
    if (typeof handler !== "function") throw new TypeError("生命周期处理器必须是函数");
    if (this.state === "disposed" || this.state === "disposing") throw new Error("CoCoFaith Core 正在或已经卸载");
    const registration: LifecycleRegistration = {
      id: ++this.sequence,
      handler,
      name: options.name ?? "anonymous",
      priority: options.priority ?? 0,
      critical: options.critical ?? false,
      active: true,
      order: this.sequence,
    };
    const handlers = this.handlers.get(stage) ?? new Map();
    handlers.set(registration.id, registration);
    this.handlers.set(stage, handlers);
    const disposable = new CallbackDisposable(() => {
      registration.active = false;
      handlers.delete(registration.id);
    });
    if (COMPLETED_STAGE_STATES[stage]?.includes(this.state)) {
      queueMicrotask(() => {
        if (registration.active) void this.invoke(stage, registration, undefined).catch(() => {});
      });
    }
    return disposable;
  }

  scope(name: string) {
    if (!name.trim()) throw new Error("生命周期作用域名称不能为空");
    if (this.state === "disposed" || this.state === "disposing") throw new Error("CoCoFaith Core 正在卸载");
    const scope = new FaithLifecycleScope(name, this);
    this.scopes.add(scope);
    scope.defer(() => { this.scopes.delete(scope); });
    return scope;
  }

  defer(disposer: (() => void | Promise<void>) | FaithDisposable) {
    if (this.state === "disposed" || this.state === "disposing") throw new Error("CoCoFaith Core 正在或已经卸载");
    const resource = typeof disposer === "function" ? new CallbackDisposable(disposer) : disposer;
    this.resources.push(resource);
    return resource;
  }

  async init() {
    if (this.state !== "created") return;
    this.state = "initializing";
    try {
      await this.dispatch("init");
      this.state = "initialized";
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }

  async ready() {
    if (this.state === "created") await this.init();
    if (this.state !== "initialized") return;
    this.state = "readying";
    try {
      await this.dispatch("ready");
      this.state = "ready";
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }

  async reload(payload?: unknown) {
    if (this.state !== "ready") throw new Error(`当前状态不能 reload：${this.state}`);
    this.state = "reloading";
    try { await this.dispatch("reload", payload); } finally { this.state = "ready"; }
  }

  async dispose() {
    if (this.state === "disposed" || this.state === "disposing") return;
    this.state = "disposing";
    const errors: unknown[] = [];
    try { await this.dispatch("dispose"); } catch (error) { errors.push(error); }
    for (const scope of [...this.scopes].reverse()) {
      try { await scope.dispose(); } catch (error) { errors.push(error); }
    }
    for (const resource of this.resources.splice(0).reverse()) {
      try { await resource.dispose(); } catch (error) { errors.push(error); }
    }
    this.handlers.clear();
    this.state = "disposed";
    if (errors.length) {
      const error = new AggregateError(errors, "CoCoFaith Core 生命周期卸载失败");
      this.logger.error(error);
    }
  }

  private async dispatch(stage: FaithLifecycleStage, payload?: unknown) {
    const registrations = [...(this.handlers.get(stage)?.values() ?? [])]
      .filter((entry) => entry.active)
      .sort((a, b) => a.priority - b.priority || a.order - b.order);
    const criticalErrors: unknown[] = [];
    const startedAt = Date.now();
    this.logger.debug(`开始阶段 ${stage}（${registrations.length} 个处理器）`);
    for (const registration of registrations) {
      try { await this.invoke(stage, registration, payload); }
      catch (error) {
        if (registration.critical) criticalErrors.push(error);
      }
    }
    this.logger.debug(`完成阶段 ${stage}（${Date.now() - startedAt}ms）`);
    if (criticalErrors.length) throw new AggregateError(criticalErrors, `Faith 生命周期 ${stage} 失败`);
  }

  private async invoke(stage: FaithLifecycleStage, registration: LifecycleRegistration, payload: unknown) {
    try {
      await registration.handler(payload);
    } catch (error) {
      this.logger.error(`生命周期 ${stage} 处理器失败：${registration.name}`, error);
      throw error;
    }
  }
}
