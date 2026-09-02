import type { Context } from "koishi";
import type { BonusProvider } from "./bonus";
import type { FaithEffectRow } from "./types";
import { FaithCoreError } from "./errors";
import { cloneBusinessRecord } from "./services/validation";

export type CreateFaithEffect = Omit<FaithEffectRow, "id">;

export class FaithEffectsService {
  constructor(private ctx: Context) {}
  create(input: CreateFaithEffect) { validate(input); return this.ctx.database.create("faith_core_effects", { ...input, metadata: cloneBusinessRecord(input.metadata ?? {}) }); }
  async get(id: number) { validateId(id); const [row] = await this.ctx.database.get("faith_core_effects", { id }); return row ?? null; }
  remove(id: number) { validateId(id); return this.ctx.database.remove("faith_core_effects", { id }); }
  list(query: Partial<Pick<FaithEffectRow, "target_type" | "target" | "value_type">> = {}) { return this.ctx.database.get("faith_core_effects", query); }
  cleanupExpired(now = new Date()) { return this.ctx.database.remove("faith_core_effects", { expires_at: { $lt: now } }); }
  removeOwner(owner: string) { return this.ctx.database.remove("faith_core_effects", { owner }); }
  readonly provider: BonusProvider = async (context) => {
    const now = new Date();
    const targets = [String(context.uid), ...context.faiths, "*"];
    const candidates = await this.ctx.database.get("faith_core_effects", { value_type: context.type, starts_at: { $lte: now }, target: targets });
    return candidates.filter((effect) => (!effect.expires_at || effect.expires_at > now) && (
      (effect.target_type === "global" && effect.target === "*") ||
      (effect.target_type === "user" && effect.target === String(context.uid)) ||
      (effect.target_type === "faith" && context.faiths.includes(effect.target))
    )).map((effect) => ({ source: effect.source, type: context.type, modifier: effect.modifier, fixedBonus: effect.fixed_bonus, expiresAt: effect.expires_at ?? undefined, metadata: effect.metadata }));
  };
}
function validate(value: CreateFaithEffect) {
  if (!value || !/^[a-z][a-z0-9_.:-]{0,79}$/.test(value.owner)) throw new FaithCoreError("VALIDATION_FAILED", "效果 owner 无效");
  if (!value || !["user", "faith", "global"].includes(value.target_type) || !value.target || value.target.length > 128 || (value.target_type === "global" && value.target !== "*")) throw new FaithCoreError("VALIDATION_FAILED", "效果目标无效；global 效果 target 必须为 *");
  if (!/^[a-z][a-z0-9_.:/-]{0,63}$/.test(value.value_type) || !Number.isFinite(value.modifier) || Math.abs(value.modifier) > 100 || !Number.isFinite(value.fixed_bonus) || Math.abs(value.fixed_bonus) > Number.MAX_SAFE_INTEGER) throw new FaithCoreError("VALIDATION_FAILED", "效果数值无效或超出安全范围");
  if (!value.source?.trim() || value.source.length > 128 || !Number.isFinite(value.starts_at.getTime()) || (value.expires_at && !Number.isFinite(value.expires_at.getTime()))) throw new FaithCoreError("VALIDATION_FAILED", "效果时间或来源无效");
}
function validateId(id: number) { if (!Number.isSafeInteger(id) || id <= 0) throw new FaithCoreError("VALIDATION_FAILED", "效果 ID 无效"); }
