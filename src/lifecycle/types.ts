export type FaithLifecycleStage = "init" | "ready" | "reload" | "game-day" | "dispose";
export type FaithLifecycleState =
  | "created"
  | "initializing"
  | "initialized"
  | "readying"
  | "ready"
  | "reloading"
  | "failed"
  | "disposing"
  | "disposed";

export type FaithLifecycleHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface FaithGameDayEvent {
  readonly date: string;
  readonly previousDate: string | null;
  readonly triggeredAt: Date;
  readonly source: "startup" | "scheduler" | "manual";
}

export interface FaithDisposable {
  readonly disposed: boolean;
  dispose(): void | Promise<void>;
}

export interface LifecycleRegistrationOptions {
  name?: string;
  priority?: number;
  critical?: boolean;
}

export interface LifecycleRegistration extends Required<LifecycleRegistrationOptions> {
  id: number;
  handler: FaithLifecycleHandler;
  active: boolean;
  order: number;
}
