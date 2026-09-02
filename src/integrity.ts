import type { Context } from "koishi";
import type { FaithItemsService } from "./items";
import type { FaithProfessionService } from "./professions";
import type { FaithRegistryService } from "./faith";

export interface IntegrityIssue { code: string; message: string; uid?: number; recordId?: number; }
export class FaithIntegrityService {
  constructor(private ctx: Context, private items: FaithItemsService, private professions: FaithProfessionService, private faiths: FaithRegistryService) {}
  async check(): Promise<IntegrityIssue[]> {
    const [users, identities, inventory, business] = await Promise.all([
      this.ctx.database.get("faith_core_users_data", {}), this.ctx.database.get("faith_core_users", {}),
      this.ctx.database.get("faith_core_users_inventory", {}), this.ctx.database.get("faith_core_business", {}),
    ]);
    const uids = new Set(users.map((user) => user.uid)), issues: IntegrityIssue[] = [];
    for (const row of identities) if (!uids.has(row.uid)) issues.push({ code: "ORPHAN_IDENTITY", message: `身份 ${row.id} 指向不存在 UID`, uid: row.uid, recordId: row.id });
    for (const row of business) if (!uids.has(row.uid)) issues.push({ code: "ORPHAN_BUSINESS_DATA", message: `业务数据 ${row.id} 指向不存在 UID`, uid: row.uid, recordId: row.id });
    for (const row of inventory) {
      if (!uids.has(row.uid)) issues.push({ code: "ORPHAN_INVENTORY", message: `背包记录 ${row.id} 指向不存在 UID`, uid: row.uid, recordId: row.id });
      if (!this.items.get(row.item_id)) issues.push({ code: "UNKNOWN_ITEM", message: `背包包含未注册物品 ${row.item_id}`, uid: row.uid, recordId: row.id });
      if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0) issues.push({ code: "INVALID_QUANTITY", message: `背包数量无效：${row.quantity}`, uid: row.uid, recordId: row.id });
      const item = this.items.get(row.item_id); if (item?.max_quantity && row.quantity > item.max_quantity) issues.push({ code: "ITEM_LIMIT_EXCEEDED", message: `${item.name} 超过上限`, uid: row.uid, recordId: row.id });
    }
    for (const user of users) {
      if (user.faiths.some((faith) => !this.faiths.has(faith))) issues.push({ code: "UNKNOWN_FAITH", message: "用户包含未注册信仰", uid: user.uid });
      const profession = user.profession_id ? this.professions.get(user.profession_id) : undefined;
      if (user.profession_id && !profession) issues.push({ code: "UNKNOWN_PROFESSION", message: `用户职业不存在：${user.profession_id}`, uid: user.uid });
      if (profession && user.faiths[0] && profession.faith !== user.faiths[0]) issues.push({ code: "PROFESSION_FAITH_MISMATCH", message: "职业与当前信仰不匹配", uid: user.uid });
    }
    for (const mismatch of await this.faiths.verifyBelieverCounts()) issues.push({ code: "BELIEVER_COUNT_MISMATCH", message: `${mismatch.faith}: ${mismatch.stored} != ${mismatch.actual}` });
    return issues;
  }
  async repair(options: { recountFaiths?: boolean; removeInvalidInventory?: boolean; cleanupExpired?: boolean } = {}) {
    const actions: string[] = [];
    if (options.recountFaiths) { await this.faiths.recountBelievers(); actions.push("recountFaiths"); }
    if (options.removeInvalidInventory) {
      const rows = await this.ctx.database.get("faith_core_users_inventory", {});
      for (const row of rows) if (!this.items.get(row.item_id) || !Number.isSafeInteger(row.quantity) || row.quantity <= 0) await this.ctx.database.remove("faith_core_users_inventory", { id: row.id });
      actions.push("removeInvalidInventory");
    }
    if (options.cleanupExpired) { await this.ctx.database.remove("faith_core_effects", { expires_at: { $lt: new Date() } }); await this.ctx.database.remove("faith_core_permission_grants", { expires_at: { $lt: new Date() } }); actions.push("cleanupExpired"); }
    return { actions, remaining: await this.check() };
  }
}
