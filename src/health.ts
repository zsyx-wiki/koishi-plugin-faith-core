import type { Context } from "koishi";
import type { FaithCoreService } from "./service";

export class FaithHealthService {
  constructor(private ctx: Context, private core: FaithCoreService) {}
  async check() {
    let database: "ok" | "error" = "ok";
    try { await this.ctx.database.get("faith_core_uid_sequence", { id: 1 }, { fields: ["id"], limit: 1 }); } catch { database = "error"; }
    return {
      ok: database === "ok" && !["failed", "disposed"].includes(this.core.lifecycle.state), database,
      lifecycle: this.core.lifecycle.state, gameDay: await this.core.gameDay.status(), locks: this.core.locks.size,
      hooks: this.core.hooks.count(), bonusProviders: this.core.bonuses.size, items: this.core.items.all().length,
      itemLevels: this.core.items.levels.all().length, professions: this.core.professions.all().length, faiths: this.core.faiths.all().length,
    };
  }
}
