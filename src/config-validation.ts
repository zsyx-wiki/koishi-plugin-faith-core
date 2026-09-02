import { FaithCoreError } from "./errors";
import type { FaithCoreConfig } from "./types";

export function normalizeCoreConfig(input: FaithCoreConfig): Readonly<FaithCoreConfig> {
  if (!input || typeof input !== "object") throw new FaithCoreError("VALIDATION_FAILED", "Core 配置必须是对象");
  const initialGold = input.registration?.initialGold;
  if (!Number.isSafeInteger(initialGold) || initialGold < 0 || initialGold > 1_000_000_000) throw new FaithCoreError("VALIDATION_FAILED", "初始金币必须是 0-1000000000 的安全整数");
  const gameDay = input.gameDay;
  if (!gameDay || typeof gameDay !== "object") throw new FaithCoreError("VALIDATION_FAILED", "游戏日配置缺失");
  try { new Intl.DateTimeFormat("en", { timeZone: gameDay.timezone }); }
  catch { throw new FaithCoreError("VALIDATION_FAILED", `无效时区：${gameDay.timezone}`); }
  integer(gameDay.rolloverHour, 0, 23, "游戏日小时");
  integer(gameDay.rolloverMinute, 0, 59, "游戏日分钟");
  integer(gameDay.checkIntervalSeconds, 10, 3_600, "游戏日检查间隔");
  integer(gameDay.lockTimeoutSeconds, 60, 86_400, "游戏日锁超时");
  if (typeof gameDay.enabled !== "boolean" || typeof gameDay.runOnStartup !== "boolean") throw new FaithCoreError("VALIDATION_FAILED", "游戏日开关必须是布尔值");
  return Object.freeze({
    registration: Object.freeze({ initialGold }),
    gameDay: Object.freeze({ ...gameDay }),
  });
}

function integer(value: number, min: number, max: number, label: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new FaithCoreError("VALIDATION_FAILED", `${label}必须在 ${min}-${max} 之间`);
}
