import type { Context } from "koishi";
import type { FaithHooksService } from "../hooks";
import type { KeyedLockService } from "../lock";
import type { FaithTransactionService } from "../services/transaction";
import type { FaithUsersService } from "../services/users";
import { FaithProfessionRegistry } from "./registry";
import { FaithCoreError } from "../errors";

export class FaithProfessionService extends FaithProfessionRegistry {
  constructor(private ctx: Context, private transactions: FaithTransactionService, private locks: KeyedLockService, private users: FaithUsersService, private hooks: FaithHooksService) { super(); }
  async getUserProfession(uid: number) { const user = await this.users.require(uid); return user.profession_id ? this.get(user.profession_id) ?? null : null; }
  async setUserProfession(uid: number, profession: string | null) {
    const target = profession === null ? null : this.require(profession);
    const result = await this.locks.run(`uid:${uid}`, () => this.transactions.run(async (database) => {
      const before = await this.users.require(uid, database);
      const write = await database.set("faith_core_users_data", { uid, profession_id: before.profession_id }, { profession_id: target?.id ?? "" });
      if (write.matched !== 1) throw new FaithCoreError("TRANSACTION_CONFLICT", "职业数据已被其他实例修改，请重试", { uid });
      return { before, after: { ...before, profession_id: target?.id ?? "" }, profession: target };
    }));
    await this.hooks.emit("user/profession-changed", { uid, ...result });
    return result.after;
  }
}
