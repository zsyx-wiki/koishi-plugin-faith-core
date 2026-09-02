import type { InventoryMutation } from "../types";
import type { CoreDatabase } from "../services/transaction";
import { FaithCoreError } from "../errors";

export class FaithInventoryRepository {
  async rows(database: CoreDatabase, uid: number) {
    return database.get("faith_core_users_inventory", { uid });
  }

  async stacks(database: CoreDatabase, uid: number) {
    return database.get("faith_core_users_inventory", { uid }, { fields: ["item_id", "quantity"], sort: { item_id: "asc" } });
  }

  async quantity(database: CoreDatabase, uid: number, itemId: string) {
    const row = await this.entry(database, uid, itemId);
    return row?.quantity ?? 0;
  }

  async entry(database: CoreDatabase, uid: number, itemId: string) {
    const [row] = await database.get("faith_core_users_inventory", { uid, item_id: itemId }, { fields: ["id", "quantity"], limit: 1 });
    return row ?? null;
  }

  entries(database: CoreDatabase, uid: number, itemIds: readonly string[]) {
    return itemIds.length ? database.get("faith_core_users_inventory", { uid, item_id: [...itemIds] }, { fields: ["id", "item_id", "quantity"] }) : Promise.resolve([]);
  }

  async hasAny(database: CoreDatabase, itemId: string) {
    const [row] = await database.get("faith_core_users_inventory", { item_id: itemId }, { fields: ["id"], limit: 1 });
    return !!row;
  }

  async write(database: CoreDatabase, mutation: InventoryMutation) {
    const row = await this.entry(database, mutation.uid, mutation.item_id);
    return this.writeKnown(database, mutation, row);
  }

  async writeKnown(database: CoreDatabase, mutation: InventoryMutation, row: { id: number; quantity: number } | null) {
    if (row && mutation.after === 0) {
      const result = await database.remove("faith_core_users_inventory", { id: row.id, quantity: mutation.before });
      if (result.matched !== 1) throw conflict(mutation);
    } else if (row) {
      const result = await database.set("faith_core_users_inventory", { id: row.id, quantity: mutation.before }, { quantity: mutation.after });
      if (result.matched !== 1) throw conflict(mutation);
    } else if (mutation.after > 0) {
      try {
        await database.create("faith_core_users_inventory", {
          uid: mutation.uid,
          item_id: mutation.item_id,
          quantity: mutation.after,
        });
      } catch (error) {
        if ((await database.get("faith_core_users_inventory", { uid: mutation.uid, item_id: mutation.item_id })).length) throw conflict(mutation, error);
        throw error;
      }
    }
  }
}

function conflict(mutation: InventoryMutation, cause?: unknown) {
  return new FaithCoreError("TRANSACTION_CONFLICT", "背包已被其他实例修改，请重试", { uid: mutation.uid, itemId: mutation.item_id }, { cause });
}
