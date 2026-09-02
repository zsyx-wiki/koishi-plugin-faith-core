import { Schema } from "koishi";
import type { FaithCoreConfig } from "./src/types";

export const Config: Schema<FaithCoreConfig> = Schema.object({
  registration: Schema.object({
    initialGold: numberInput(300, "新用户注册时获得的初始金币。默认 300，范围 0-1000000000。"),
  }).default({ initialGold: 300 }).description("注册设置。"),
  gameDay: Schema.object({
    enabled: Schema.boolean().default(true).description("启用统一游戏日调度。"),
    timezone: Schema.string().default("Asia/Shanghai").description("IANA 时区。默认 Asia/Shanghai。"),
    rolloverHour: numberInput(7, "游戏日切换小时。默认 7，范围 0-23。"),
    rolloverMinute: numberInput(30, "游戏日切换分钟。默认 30，范围 0-59。"),
    checkIntervalSeconds: numberInput(60, "检查间隔（秒）。默认 60，范围 10-3600。"),
    lockTimeoutSeconds: numberInput(1800, "跨实例任务锁超时（秒）。默认 1800，范围 60-86400。"),
    runOnStartup: Schema.boolean().default(true).description("启动时补执行当前游戏日任务。"),
  }).default({ enabled: true, timezone: "Asia/Shanghai", rolloverHour: 7, rolloverMinute: 30, checkIntervalSeconds: 60, lockTimeoutSeconds: 1800, runOnStartup: true }).description("游戏日设置。默认按北京时间 07:30 切换。"),
});

function numberInput(value: number, description: string) {
  return Schema.number().default(value).description(description);
}

export type Config = FaithCoreConfig;
