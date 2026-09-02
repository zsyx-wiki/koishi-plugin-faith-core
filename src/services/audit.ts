import { randomUUID } from "node:crypto";
import type { FaithCoreLedgerEntry, FaithCoreTransactionRow } from "../types";
import { FaithCoreError } from "../errors";
import type { CoreDatabase } from "./transaction";
import { cloneBusinessRecord } from "./validation";

export interface FaithTransactionOptions {
  idempotencyKey?: string; business?: string; source?: string; operatorUid?: number; metadata?: Record<string, unknown>;
}

export class FaithAuditService {
  constructor(private database: CoreDatabase) {}
  async begin(database: CoreDatabase, options: FaithTransactionOptions = {}) {
    const transactionId = randomUUID(), idempotencyKey = options.idempotencyKey?.trim() || `auto:${transactionId}`;
    if (idempotencyKey.length > 255) throw new FaithCoreError("VALIDATION_FAILED", "幂等键不能超过 255 字符");
    const business = options.business ?? "core", source = options.source ?? "unspecified";
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(business) || !source.trim() || source.length > 128) throw new FaithCoreError("VALIDATION_FAILED", "事务 business 或 source 无效");
    const metadata = cloneBusinessRecord(options.metadata ?? {});
    try {
      await database.create("faith_core_transactions", {
        transaction_id: transactionId, idempotency_key: idempotencyKey, business,
        source, operator_uid: options.operatorUid ?? 0, metadata, created_at: new Date(),
      });
    } catch (error) {
      const [existing] = await database.get("faith_core_transactions", { idempotency_key: idempotencyKey });
      if (existing) throw new FaithCoreError("IDEMPOTENCY_CONFLICT", "相同幂等键的请求已经处理。", { transactionId: existing.transaction_id, idempotencyKey });
      throw error;
    }
    return transactionId;
  }

  entry(database: CoreDatabase, transactionId: string, uid: number, resource: string, before: number, after: number) {
    return database.create("faith_core_ledger", { transaction_id: transactionId, uid, resource, before, delta: after - before, after, created_at: new Date() });
  }

  async get(transactionId: string): Promise<{ transaction: FaithCoreTransactionRow; entries: FaithCoreLedgerEntry[] } | null> {
    const [transaction] = await this.database.get("faith_core_transactions", { transaction_id: transactionId });
    if (!transaction) return null;
    const entries = await this.database.get("faith_core_ledger", { transaction_id: transactionId });
    return { transaction, entries };
  }
  list(uid: number, limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new FaithCoreError("VALIDATION_FAILED", "流水 limit 必须是 1-500");
    return this.database.get("faith_core_ledger", { uid }, { limit, sort: { id: "desc" } });
  }
}
