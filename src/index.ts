import { Context } from "koishi";
import { Config as ConfigSchema, type Config as CoreConfig } from "../config";
import { registerCoreModels } from "./database";
import { CORE_SERVICE_ORDER, FaithCoreService } from "./service";

export const name = "faith-core";
export const inject = ["database"] as const;
export const Config = ConfigSchema;
export type Config = CoreConfig;

declare module "koishi" {
  interface Context {
    faithCore: FaithCoreService;
  }
}

export async function apply(ctx: Context, config: Config) {
  const logger = ctx.logger("faith-core");
  const startedAt = Date.now();
  registerCoreModels(ctx);
  logger.debug("数据库模型已注册");
  const core = new FaithCoreService(ctx, config);
  ctx.set("faithCore", core);
  await core.lifecycle.init();
  logger.info(`Core 初始化完成（${Date.now() - startedAt}ms，API ${core.apiVersion}）`);
  logger.debug(`服务层级：${CORE_SERVICE_ORDER.join(" → ")}`);
}

export * from "./types";
export { normalizeCoreConfig } from "./config-validation";
export * from "./database";
export * from "./data/items";
export * from "./data/easterEggs";
export * from "./items";
export * from "./hooks";
export * from "./bonus";
export * from "./economy";
export * from "./professions";
export * from "./faith";
export * from "./data/faiths";
export * from "./data/professions";
export * from "./lifecycle";
export * from "./lock";
export * from "./permissions";
export * from "./services";
export * from "./service";
export * from "./errors";
export * from "./effects";
export * from "./integrity";
export * from "./health";
