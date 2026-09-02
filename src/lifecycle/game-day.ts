import { Context, Time } from "koishi";
import type { FaithCoreConfig } from "../types";
import type { KeyedLockService } from "../lock";
import type { FaithLifecycleService } from "./service";
import type { FaithGameDayEvent } from "./types";
import type { FaithHooksService } from "../hooks";

const LAST_GAME_DAY_KEY = "last_game_day";
const GAME_DAY_LOCK_KEY = "game_day_lock";

/** 只负责可靠地产生游戏日事件；签到、商店等具体重置逻辑仍由 Business 注册。 */
export class FaithGameDayService {
  private timer?: () => void;
  private formatter: Intl.DateTimeFormat;
  private readonly logger;
  private running = false;
  private lastError?: string;

  constructor(
    private ctx: Context,
    private configState: Readonly<FaithCoreConfig["gameDay"]>,
    private lifecycle: FaithLifecycleService,
    private locks: KeyedLockService,
    private hooks: FaithHooksService,
  ) {
    assertConfig(configState);
    this.logger = ctx.logger("faith-core-game-day");
    this.formatter = createFormatter(configState.timezone);
  }

  get config() { return this.configState; }

  getDate(now = new Date()) {
    const parts = Object.fromEntries(this.formatter.formatToParts(now).map((part) => [part.type, part.value]));
    const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
    const beforeRollover = Number(parts.hour) < this.config.rolloverHour ||
      (Number(parts.hour) === this.config.rolloverHour && Number(parts.minute) < this.config.rolloverMinute);
    if (beforeRollover) date.setUTCDate(date.getUTCDate() - 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  start(runStartup = true) {
    if (!this.config.enabled || this.timer) return;
    if (runStartup && this.config.runOnStartup) this.ctx.setTimeout(
      () => this.run("startup").catch((error) => this.logger.error("启动游戏日任务失败", error)), 0,
    );
    this.timer = this.ctx.setInterval(
      () => this.run("scheduler").catch((error) => this.logger.error("游戏日任务失败", error)),
      this.config.checkIntervalSeconds * Time.second,
    );
  }


  async reconfigure(config: Readonly<FaithCoreConfig["gameDay"]>) {
    assertConfig(config);
    await this.locks.run("core:game-day", async () => {
      this.stop();
      this.configState = config;
      this.formatter = createFormatter(config.timezone);
      this.start(false);
    });
  }

  stop() {
    this.timer?.();
    this.timer = undefined;
  }

  run(source: FaithGameDayEvent["source"] = "manual", now = new Date()) {
    return this.locks.run("core:game-day", () => this.runLocked(source, now));
  }
  async status() {
    const [completed] = await this.ctx.database.get("faith_core_lifecycle", { key: LAST_GAME_DAY_KEY }, { fields: ["value"] });
    return { enabled: this.config.enabled, running: this.running, currentDate: this.getDate(), lastCompleted: typeof completed?.value?.date === "string" ? completed.value.date : null, lastError: this.lastError };
  }
  retry() { return this.run("manual"); }
  async force(now = new Date()) { await this.ctx.database.remove("faith_core_lifecycle", { key: LAST_GAME_DAY_KEY }); return this.run("manual", now); }

  private async runLocked(source: FaithGameDayEvent["source"], now: Date) {
    const date = this.getDate(now);
    const [completed] = await this.ctx.database.get("faith_core_lifecycle", { key: LAST_GAME_DAY_KEY });
    const previousDate = typeof completed?.value?.date === "string" ? completed.value.date : null;
    if (previousDate === date) return false;
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    if (!await this.acquireLock(date, token, now)) return false;
    const event = { date, previousDate, triggeredAt: now, source } as const;
    this.running = true; this.lastError = undefined;
    try {
      await this.hooks.emitStrict("game-day/before", event);
      await this.lifecycle.dispatchGameDay(event);
      await this.ctx.database.upsert("faith_core_lifecycle", [{ key: LAST_GAME_DAY_KEY, value: { date }, updated_at: new Date() }], ["key"]);
      await this.hooks.emit("game-day/completed", event);
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.hooks.emit("game-day/failed", { ...event, error });
      throw error;
    } finally {
      this.running = false;
      // Koishi 支持 JSON 路径查询，但动态 JSON 字段无法在 Tables 类型中静态展开。
      await this.ctx.database.remove("faith_core_lifecycle", { key: GAME_DAY_LOCK_KEY, "value.token": token } as never);
    }
  }

  private async acquireLock(date: string, token: string, now: Date) {
    const expiresAt = now.getTime() + this.config.lockTimeoutSeconds * 1_000;
    try {
      await this.ctx.database.create("faith_core_lifecycle", { key: GAME_DAY_LOCK_KEY, value: { date, token, expiresAt }, updated_at: now });
      return true;
    } catch {
      // 条件更新是原子的：只有仍处于超时状态的实例能接管，避免“删除再创建”竞态。
      const staleBefore = new Date(now.getTime() - this.config.lockTimeoutSeconds * 1_000);
      const result = await this.ctx.database.set(
        "faith_core_lifecycle",
        { key: GAME_DAY_LOCK_KEY, updated_at: { $lt: staleBefore } },
        { value: { date, token, expiresAt }, updated_at: now },
      );
      return result.matched === 1;
    }
  }
}

function assertConfig(config: FaithCoreConfig["gameDay"]) {
  try { new Intl.DateTimeFormat("en", { timeZone: config.timezone }); }
  catch { throw new Error(`无效时区：${config.timezone}`); }
  if (!Number.isInteger(config.rolloverHour) || config.rolloverHour < 0 || config.rolloverHour > 23) throw new Error("游戏日小时必须为 0-23");
  if (!Number.isInteger(config.rolloverMinute) || config.rolloverMinute < 0 || config.rolloverMinute > 59) throw new Error("游戏日分钟必须为 0-59");
  if (!Number.isSafeInteger(config.checkIntervalSeconds) || config.checkIntervalSeconds < 10 || config.checkIntervalSeconds > 3_600) throw new Error("游戏日检查间隔必须为 10-3600 秒");
  if (!Number.isSafeInteger(config.lockTimeoutSeconds) || config.lockTimeoutSeconds < 60 || config.lockTimeoutSeconds > 86_400) throw new Error("游戏日锁超时必须为 60-86400 秒");
}
function createFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
