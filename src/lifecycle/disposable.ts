import type { FaithDisposable } from "./types";

export class CallbackDisposable implements FaithDisposable {
  disposed = false;

  constructor(private callback: () => void | Promise<void>) {}

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await this.callback();
  }
}
