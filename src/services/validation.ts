import { UID_MAX, UID_MIN } from "../types";

/** 防止单个用户/业务记录异常膨胀；这是安全上限，不是正常业务目标大小。 */
export const MAX_BUSINESS_RECORD_BYTES = 256 * 1024;

export function assertUid(uid: number) {
  if (!Number.isInteger(uid) || uid < UID_MIN || uid > UID_MAX) {
    throw new Error(`非法 UID：${uid}`);
  }
}

export function assertBusinessName(name: string) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
    throw new Error(`非法业务名称：${name}`);
  }
}

export function cloneBusinessRecord(value: Record<string, unknown>) {
  if (!isPlainObject(value)) {
    throw new TypeError("业务数据必须是普通对象");
  }
  assertJsonValue(value, new Set(), 0);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("业务数据必须可序列化为 JSON");
  if (Buffer.byteLength(serialized, "utf8") > MAX_BUSINESS_RECORD_BYTES) throw new Error("单个业务数据对象不能超过 256 KiB");
  return JSON.parse(serialized) as Record<string, unknown>;
}

const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: unknown, ancestors: Set<object>, depth: number): void {
  if (depth > 64) throw new TypeError("业务数据嵌套层级不能超过 64");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("业务数据不能包含非有限数字");
    return;
  }
  if (typeof value !== "object") throw new TypeError("业务数据包含不可序列化值");
  if (ancestors.has(value)) throw new TypeError("业务数据不能包含循环引用");
  if (!Array.isArray(value) && !isPlainObject(value)) throw new TypeError("业务数据只能包含普通对象和数组");
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) throw new TypeError(`业务数据包含禁止字段：${key}`);
    assertJsonValue(child, ancestors, depth + 1);
  }
  ancestors.delete(value);
}
