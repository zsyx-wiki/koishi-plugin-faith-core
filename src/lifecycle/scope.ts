import type { FaithLifecycleService } from "./service";
import { CallbackDisposable } from "./disposable";
import type {
  FaithDisposable,
  FaithLifecycleHandler,
  LifecycleRegistrationOptions,
} from "./types";

export class FaithLifecycleScope implements FaithDisposable {
  disposed = false;
  #resources: FaithDisposable[] = [];
  #lifecycle: FaithLifecycleService;

  constructor(
    readonly name: string,
    lifecycle: FaithLifecycleService,
  ) { this.#lifecycle = lifecycle; }

  onInit(handler: FaithLifecycleHandler, options: LifecycleRegistrationOptions = {}) {
    return this.track(this.#lifecycle.onInit(handler, { ...options, name: options.name ?? this.name }));
  }

  onReady(handler: FaithLifecycleHandler, options: LifecycleRegistrationOptions = {}) {
    return this.track(this.#lifecycle.onReady(handler, { ...options, name: options.name ?? this.name }));
  }

  onReload(handler: FaithLifecycleHandler, options: LifecycleRegistrationOptions = {}) {
    return this.track(this.#lifecycle.onReload(handler, { ...options, name: options.name ?? this.name }));
  }

  onDispose(handler: FaithLifecycleHandler, options: LifecycleRegistrationOptions = {}) {
    return this.track(this.#lifecycle.onDispose(handler, { ...options, name: options.name ?? this.name }));
  }

  onGameDay(handler: FaithLifecycleHandler<import("./types").FaithGameDayEvent>, options: LifecycleRegistrationOptions = {}) {
    return this.track(this.#lifecycle.onGameDay(handler, { ...options, name: options.name ?? this.name }));
  }

  defer(disposer: (() => void | Promise<void>) | FaithDisposable) {
    const resource = typeof disposer === "function" ? new CallbackDisposable(disposer) : disposer;
    return this.track(resource);
  }

  track<T extends FaithDisposable>(resource: T): T {
    if (this.disposed) throw new Error(`生命周期作用域已卸载：${this.name}`);
    this.#resources.push(resource);
    return resource;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const resources = this.#resources.splice(0).reverse();
    const errors: unknown[] = [];
    for (const resource of resources) {
      try { await resource.dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `卸载生命周期作用域失败：${this.name}`);
  }
}
