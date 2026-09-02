export const CORE_ERROR_CATALOG = {
  USER_NOT_FOUND: "用户不存在。", USER_DISABLED: "用户已被停用。", IDENTITY_NOT_FOUND: "身份不存在。",
  IDENTITY_ALREADY_BOUND: "身份已绑定其他用户。", UID_EXHAUSTED: "UID 已耗尽。",
  INSUFFICIENT_BALANCE: "余额不足。", ITEM_NOT_FOUND: "物品不存在。", ITEM_INSUFFICIENT: "物品数量不足。",
  ITEM_LIMIT_EXCEEDED: "物品超过持有上限。", PERMISSION_DENIED: "权限不足。",
  TRANSACTION_CONFLICT: "事务冲突。", IDEMPOTENCY_CONFLICT: "请求已经处理。",
  VALIDATION_FAILED: "输入数据无效。", LIFECYCLE_FAILED: "生命周期执行失败。",
  DATA_INTEGRITY_ERROR: "数据完整性异常。",
  NOT_FOUND: "资源不存在。", CONFLICT: "资源状态冲突。", INTERNAL_ERROR: "Core 内部错误。",
} as const;
export type FaithCoreErrorCode = keyof typeof CORE_ERROR_CATALOG;

export class FaithCoreError extends Error {
  constructor(readonly code: FaithCoreErrorCode, message: string = CORE_ERROR_CATALOG[code], readonly details?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, options); this.name = "FaithCoreError";
  }
}

export function coreError(code: FaithCoreErrorCode, message?: string, details?: Record<string, unknown>) {
  return new FaithCoreError(code, message, details);
}
