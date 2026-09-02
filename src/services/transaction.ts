import { Context } from "koishi";
import type { FaithHooksService } from "../hooks";
import { AsyncLocalStorage } from "node:async_hooks";

export type CoreDatabase = Context["database"];

export class FaithTransactionService {
  private sequence = 0;
  private hookDispatch = new AsyncLocalStorage<boolean>();
  private transactionContext = new AsyncLocalStorage<CoreDatabase>();
  private sqliteTail: Promise<unknown> = Promise.resolve();
  constructor(private ctx: Context, private hooks?: FaithHooksService) {}

  async run<T>(task: (database: CoreDatabase) => Promise<T>): Promise<T> {
    const current = this.transactionContext.getStore();
    if (current) return task(current);
    if (this.usesSqlite()) {
      const queued = this.sqliteTail.catch(() => undefined).then(() => this.runRoot(task));
      this.sqliteTail = queued.catch(() => undefined);
      return queued;
    }
    return this.runRoot(task);
  }

  private async runRoot<T>(task: (database: CoreDatabase) => Promise<T>): Promise<T> {
    const id = `tx-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`, startedAt = Date.now();
    await this.notify("transaction/before", Object.freeze({ id, startedAt }));
    try {
      const result = await (this.ctx.database.transact((database) => this.transactionContext.run(database, () => task(database))) as Promise<T>);
      await this.notify("transaction/committed", Object.freeze({ id, startedAt, duration: Date.now() - startedAt }));
      return result;
    } catch (error) {
      await this.notify("transaction/rolled-back", Object.freeze({ id, startedAt, duration: Date.now() - startedAt, error }));
      throw error;
    }
  }

  private usesSqlite() {
    return this.ctx.database.drivers.some((driver) => {
      const name = (driver.constructor as { name?: string }).name?.toLowerCase();
      return name === "sqlite" || name === "sqlitedriver";
    });
  }

  private async notify(event: string, payload: unknown) {
    if (!this.hooks || this.hookDispatch.getStore()) return;
    await this.hookDispatch.run(true, () => this.hooks!.emit(event, payload));
  }
}
