import { Context, Field, Model } from "koishi";
import type {
  FaithCoreBusinessData,
  FaithCoreInventoryRow,
  FaithCoreUidSequence,
  FaithCoreUserData,
  FaithCoreUserIdentity,
  FaithCoreFaithRow,
  FaithCoreTransactionRow, FaithCoreLedgerEntry, FaithPermissionGrant, FaithEffectRow,
} from "../types";
import { assertBusinessName } from "../services/validation";

export function registerCoreModels(ctx: Context) {
  ctx.model.extend("faith_core_users", {
    id: "unsigned",
    uid: "unsigned",
    adapter: "string(32)",
    type: "string(64)",
    value: "string(255)",
    scope: "string(32)",
    scope_value: "string(255)",
  }, {
    primary: "id",
    autoInc: true,
    unique: [["adapter", "type", "value", "scope", "scope_value"]],
    indexes: ["uid", ["adapter", "value"]],
  });

  ctx.model.extend("faith_core_users_data", {
    uid: "unsigned",
    faiths: "json",
    abandon_count: "unsigned",
    profession_id: "string(128)",
    gold: "double",
    ascension_score: "double",
    audience_score: "double",
    audience_rank: "integer",
    status: "string(16)", status_reason: "string(255)", created_at: "timestamp", updated_at: "timestamp",
  }, { primary: "uid", indexes: ["status"] });

  ctx.model.extend("faith_core_users_inventory", {
    id: "unsigned",
    uid: "unsigned",
    item_id: "string(128)",
    quantity: "integer",
  }, {
    primary: "id",
    autoInc: true,
    unique: [["uid", "item_id"]],
    indexes: [["item_id", "uid"]],
  });

  ctx.model.extend("faith_core_business", {
    id: "unsigned",
    uid: "unsigned",
    business: "string(64)",
    private: "json",
    public: "json",
  }, {
    primary: "id",
    autoInc: true,
    unique: [["uid", "business"]],
    indexes: ["business"],
  });

  ctx.model.extend("faith_core_uid_sequence", {
    id: "unsigned",
    next_uid: "unsigned",
  }, { primary: "id" });

  ctx.model.extend("faith_core_faiths", {
    id: "unsigned", name: "string(64)", path: "string(64)", type: "string(16)", creator_uid: "unsigned",
    believer_count: "unsigned", prayer_word: "string(1024)", custom_professions: "json", metadata: "json", created_at: "timestamp",
  }, { primary: "id", autoInc: true, unique: ["name"], indexes: ["path"] });
  ctx.model.extend("faith_core_faith_stats", { name: "string(64)", believer_count: "unsigned", updated_at: "timestamp" }, { primary: "name" });

  ctx.model.extend("faith_core_lifecycle", {
    key: "string(64)", value: "json", updated_at: "timestamp",
  }, { primary: "key" });

  ctx.model.extend("faith_core_transactions", {
    id: "unsigned", transaction_id: "string(64)", idempotency_key: "string(255)", business: "string(64)",
    source: "string(128)", operator_uid: "unsigned", metadata: "json", created_at: "timestamp",
  }, { primary: "id", autoInc: true, unique: ["transaction_id", "idempotency_key"] });
  ctx.model.extend("faith_core_ledger", {
    id: "unsigned", transaction_id: "string(64)", uid: "unsigned", resource: "string(160)",
    before: "double", delta: "double", after: "double", created_at: "timestamp",
  }, { primary: "id", autoInc: true, indexes: [["uid", "created_at"], "transaction_id"] });
  ctx.model.extend("faith_core_permission_grants", {
    id: "unsigned", uid: "unsigned", permission: "string(128)", scope: "string(64)", scope_value: "string(255)",
    granted_by: "unsigned", expires_at: "timestamp", created_at: "timestamp",
  }, { primary: "id", autoInc: true, unique: [["uid", "permission", "scope", "scope_value"]], indexes: [["uid", "permission"], "permission", "expires_at"] });
  ctx.model.extend("faith_core_effects", {
    id: "unsigned", owner: "string(80)", target_type: "string(16)", target: "string(128)", value_type: "string(64)",
    modifier: "double", fixed_bonus: "double", source: "string(128)", starts_at: "timestamp", expires_at: "timestamp", metadata: "json",
  }, { primary: "id", autoInc: true, indexes: [["value_type", "target", "starts_at"], ["target_type", "target"], "owner", "expires_at"] });
  ctx.model.extend("faith_core_bulk_operations", {
    operation_id: "string(128)", kind: "string(128)", payload: "json", created_at: "timestamp",
  }, { primary: "operation_id" });
}

export type BusinessModelFields = Record<string, Field.Type | Field>;

export function registerBusinessModel(
  ctx: Context,
  business: string,
  fields: BusinessModelFields,
  config: Partial<Model.Config> = {},
): string {
  assertBusinessName(business);
  const table = `faith_business_${business}`;
  ctx.model.extend(table as never, fields as never, config);
  return table;
}

declare module "koishi" {
  interface Tables {
    faith_core_users: FaithCoreUserIdentity;
    faith_core_users_data: FaithCoreUserData;
    faith_core_users_inventory: FaithCoreInventoryRow;
    faith_core_business: FaithCoreBusinessData;
    faith_core_uid_sequence: FaithCoreUidSequence;
    faith_core_faiths: FaithCoreFaithRow;
    faith_core_faith_stats: { name: string; believer_count: number; updated_at: Date };
    faith_core_lifecycle: { key: string; value: Record<string, unknown>; updated_at: Date };
    faith_core_transactions: FaithCoreTransactionRow;
    faith_core_ledger: FaithCoreLedgerEntry;
    faith_core_permission_grants: FaithPermissionGrant;
    faith_core_effects: FaithEffectRow;
    faith_core_bulk_operations: { operation_id: string; kind: string; payload: Record<string, unknown>; created_at: Date };
  }
}
