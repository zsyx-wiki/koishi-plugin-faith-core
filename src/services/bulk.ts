import type { FaithItemsService } from "../items";
import type { FaithCoreUserData, UserValueDelta } from "../types";
import { FaithCoreError } from "../errors";
import type { FaithBusinessTransactionService } from "./business-transaction";
import type { FaithUsersService } from "./users";
import type { Context } from "koishi";
import { createHash } from "node:crypto";

export interface FaithBulkOptions {
  /** 调用方生成的稳定操作号；同一操作号重试不会重复发放。 */
  operationId: string;
  status?: FaithCoreUserData["status"] | "all";
  pageSize?: number;
  concurrency?: number;
  continueOnError?: boolean;
}

export interface FaithBulkFailure { uid: number; code: string; message: string; }
export interface FaithBulkResult {
  operationId: string;
  total: number;
  succeeded: number;
  skipped: number;
  failed: readonly FaithBulkFailure[];
}

/**
 * 跨全体用户操作不是单一大事务：每个 UID 独立原子提交，并以 operationId 幂等。
 * 这样不会长时间锁表，也允许中断后安全重试。
 */
export class FaithBulkOperationsService {
  constructor(
    private ctx: Context,
    private users: FaithUsersService,
    private items: FaithItemsService,
    private transactions: FaithBusinessTransactionService,
  ) {}

  incrementValuesForAll(delta: Readonly<UserValueDelta>, options: FaithBulkOptions) {
    const allowed = new Set(["gold", "ascension_score", "audience_score", "audience_rank", "abandon_count"]);
    for (const [field, value] of Object.entries(delta)) {
      if (!allowed.has(field)) throw new FaithCoreError("VALIDATION_FAILED", `不允许批量修改字段：${field}`);
      if (!Number.isFinite(value) || value <= 0) throw new FaithCoreError("VALIDATION_FAILED", `全体数值增量必须为正数：${field}`);
      if ((field === "audience_rank" || field === "abandon_count") && !Number.isSafeInteger(value)) throw new FaithCoreError("VALIDATION_FAILED", `${field} 增量必须是安全整数`);
    }
    if (!Object.keys(delta).length) throw new FaithCoreError("VALIDATION_FAILED", "全体数值增量不能为空");
    return this.run(options, "values", { delta: { ...delta } }, (uid, idempotencyKey) =>
      this.transactions.run("core_bulk", uid, (scope) => scope.users.change({ ...delta }), {
        idempotencyKey, source: "bulk.increment-values", metadata: { operationId: options.operationId },
      }));
  }

  giveItemToAll(itemIdOrName: string, quantity: number, options: FaithBulkOptions) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new FaithCoreError("VALIDATION_FAILED", "全体物品发放数量必须是正安全整数");
    const item = this.items.require(itemIdOrName);
    return this.run(options, `item:${item.item_id}`, { itemId: item.item_id, quantity }, (uid, idempotencyKey) =>
      this.transactions.run("core_bulk", uid, (scope) => scope.items.give(item.item_id, quantity), {
        idempotencyKey, source: "bulk.give-item", metadata: { operationId: options.operationId, itemId: item.item_id, quantity },
      }));
  }

  private async run(
    options: FaithBulkOptions,
    kind: string,
    payload: Record<string, unknown>,
    execute: (uid: number, idempotencyKey: string) => Promise<unknown>,
  ): Promise<FaithBulkResult> {
    const operationId = validateOperationId(options.operationId);
    const pageSize = integerInRange(options.pageSize ?? 100, 1, 500, "pageSize");
    const concurrency = integerInRange(options.concurrency ?? 4, 1, 16, "concurrency");
    const continueOnError = options.continueOnError ?? true;
    const status = options.status ?? "active";
    if (status !== "all" && !["active", "disabled", "closed"].includes(status)) throw new FaithCoreError("VALIDATION_FAILED", "全体操作用户状态无效");
    await this.ensureOperation(operationId, kind, { ...payload, status });
    let offset = 0, total = 0, succeeded = 0, skipped = 0;
    const failed: FaithBulkFailure[] = [];
    while (true) {
      const page = await this.users.list({ status: status === "all" ? undefined : status, offset, limit: pageSize });
      if (!page.length) break;
      total += page.length;
      let cursor = 0, stop = false;
      const worker = async () => {
        while (!stop) {
          const user = page[cursor++];
          if (!user) return;
          try {
            await execute(user.uid, createIdempotencyKey(operationId, kind, user.uid));
            succeeded++;
          } catch (error) {
            if (error instanceof FaithCoreError && error.code === "IDEMPOTENCY_CONFLICT") { skipped++; continue; }
            failed.push(toFailure(user.uid, error));
            if (!continueOnError) stop = true;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, page.length) }, worker));
      if (stop) break;
      offset += page.length;
      if (page.length < pageSize) break;
    }
    return Object.freeze({ operationId, total, succeeded, skipped, failed: Object.freeze(failed) });
  }

  private async ensureOperation(operationId: string, kind: string, payload: Record<string, unknown>) {
    const expected = JSON.stringify(payload);
    const [existing] = await this.ctx.database.get("faith_core_bulk_operations", { operation_id: operationId });
    if (existing) {
      if (existing.kind !== kind || JSON.stringify(existing.payload) !== expected) throw new FaithCoreError("CONFLICT", "operationId 已用于其他全体操作或参数不同", { operationId });
      return;
    }
    try { await this.ctx.database.create("faith_core_bulk_operations", { operation_id: operationId, kind, payload, created_at: new Date() }); }
    catch (error) {
      const [created] = await this.ctx.database.get("faith_core_bulk_operations", { operation_id: operationId });
      if (!created) throw error;
      if (created.kind !== kind || JSON.stringify(created.payload) !== expected) throw new FaithCoreError("CONFLICT", "operationId 已用于其他全体操作或参数不同", { operationId }, { cause: error });
    }
  }
}

function validateOperationId(value: string) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)) throw new FaithCoreError("VALIDATION_FAILED", "全体操作 operationId 必须是 1-128 位安全字符");
  return value;
}
function integerInRange(value: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new FaithCoreError("VALIDATION_FAILED", `${name} 必须在 ${min}-${max} 之间`);
  return value;
}
function toFailure(uid: number, error: unknown): FaithBulkFailure {
  return Object.freeze({ uid, code: error instanceof FaithCoreError ? error.code : "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) });
}
function createIdempotencyKey(operationId: string, kind: string, uid: number) {
  const digest = createHash("sha256").update(`${operationId}\0${kind}`).digest("hex");
  return `bulk:${digest}:${uid}`;
}
