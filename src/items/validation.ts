import type { FaithItemDefinition, InventoryMutation } from "../types";
import { FaithCoreError } from "../errors";

export function validateItemDefinition(item: FaithItemDefinition) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(item.item_id)) throw new Error(`非法 item_id：${item.item_id}`);
  for (const field of ["name", "type", "level", "description"] as const) {
    if (typeof item[field] !== "string" || (field !== "description" && !item[field].trim())) {
      throw new Error(`物品 ${item.item_id} 缺少 ${field}`);
    }
  }
  if (item.name.length > 255) throw new Error(`物品 ${item.item_id} 的名称过长`);
  if (!Number.isInteger(item.max_quantity) || item.max_quantity < 0) {
    throw new Error(`物品 ${item.item_id} 的 max_quantity 必须是非负整数`);
  }
  if (!Number.isFinite(item.price) || item.price < 0) throw new Error(`物品 ${item.item_id} 的 price 必须是非负数`);
  if (!item.marketable && item.price !== 0) throw new Error(`不可出售物品 ${item.item_id} 的 price 必须为 0`);
  if (item.actions && !item.actions.every((action) => typeof action === "string")) {
    throw new Error(`物品 ${item.item_id} 的 actions 必须是字符串数组`);
  }
}

export function assertPositiveQuantity(quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new FaithCoreError("VALIDATION_FAILED", "物品数量必须是正安全整数");
}

export function assertNonNegativeQuantity(quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new FaithCoreError("VALIDATION_FAILED", "物品数量必须是非负安全整数");
}

export function createInventoryMutation(
  uid: number,
  item: Readonly<FaithItemDefinition>,
  before: number,
  after: number,
): InventoryMutation {
  if (after < 0) throw new FaithCoreError("ITEM_INSUFFICIENT", `物品 ${item.name} 数量不足`, { itemId: item.item_id, before, requestedDelta: after - before });
  assertNonNegativeQuantity(after);
  if (item.max_quantity > 0 && after > item.max_quantity) {
    throw new FaithCoreError("ITEM_LIMIT_EXCEEDED", `物品 ${item.name} 超过持有上限 ${item.max_quantity}`, { itemId: item.item_id, maximum: item.max_quantity });
  }
  return { uid, item_id: item.item_id, before, after, delta: after - before };
}
