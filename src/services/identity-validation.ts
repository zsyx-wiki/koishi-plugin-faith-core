import type { IdentityInput } from "../types";

const SAFE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

export function normalizeIdentity(identity: IdentityInput) {
  const adapter = identity.adapter.trim();
  const type = identity.type.trim();
  const value = identity.value.trim();
  const scope = identity.scope.trim();
  const scopeValue = identity.scopeValue?.trim() ?? "";
  if (!SAFE_NAME.test(adapter)) throw new Error(`非法 adapter：${adapter}`);
  if (!SAFE_NAME.test(type)) throw new Error(`非法身份 type：${type}`);
  if (!SAFE_NAME.test(scope)) throw new Error(`非法身份 scope：${scope}`);
  if (!value || value.length > 255) throw new Error("身份 value 长度必须为 1-255");
  if (scopeValue.length > 255) throw new Error("身份 scopeValue 不能超过 255 字符");
  if (scope === "global" && scopeValue) throw new Error("global 身份不得设置 scopeValue");
  if (type === "qq_account" && scope !== "global") throw new Error("qq_account 的作用域必须为 global");
  if (type === "qqbot_user_openid" && scope !== "private_chat") {
    throw new Error("qqbot_user_openid 的作用域必须为 private_chat");
  }
  if (type === "qqbot_member_openid" && (scope !== "group_chat" || !scopeValue)) {
    throw new Error("qqbot_member_openid 必须提供 group_chat 与 group_openid");
  }
  return { adapter, type, value, scope, scopeValue };
}
