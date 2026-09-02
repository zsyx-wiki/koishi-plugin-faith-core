export const UID_MIN = 10_000_000;
export const UID_MAX = 99_999_999;

export interface FaithCoreConfig {
  registration: {
    initialGold: number;
  };
  gameDay: {
    enabled: boolean;
    timezone: string;
    rolloverHour: number;
    rolloverMinute: number;
    checkIntervalSeconds: number;
    lockTimeoutSeconds: number;
    runOnStartup: boolean;
  };
}

export type FaithAdapter = "onebot" | "qqbot" | (string & {});
export type IdentityType =
  | "qq_account"
  | "qqbot_user_openid"
  | "qqbot_member_openid"
  | (string & {});
export type IdentityScope =
  | "global"
  | "private_chat"
  | "group_chat"
  | (string & {});

export interface FaithCoreUserIdentity {
  id: number;
  uid: number;
  adapter: FaithAdapter;
  type: IdentityType;
  value: string;
  scope: IdentityScope;
  scope_value: string;
}

export interface IdentityInput {
  adapter: FaithAdapter;
  type: IdentityType;
  value: string;
  scope: IdentityScope;
  scopeValue?: string;
}

export interface FaithCoreUserData {
  uid: number;
  /** 第一个元素恒为当前信仰，后续元素为融合信仰。 */
  faiths: string[];
  abandon_count: number;
  profession_id: string;
  gold: number;
  ascension_score: number;
  audience_score: number;
  audience_rank: number;
  status: "active" | "disabled" | "closed";
  status_reason: string;
  created_at: Date;
  updated_at: Date;
}

export interface FaithCoreTransactionRow {
  id: number; transaction_id: string; idempotency_key: string; business: string; source: string;
  operator_uid: number; metadata: Record<string, unknown>; created_at: Date;
}
export interface FaithCoreLedgerEntry {
  id: number; transaction_id: string; uid: number; resource: string;
  before: number; delta: number; after: number; created_at: Date;
}
export interface FaithPermissionGrant {
  id: number; uid: number; permission: string; scope: string; scope_value: string;
  granted_by: number; expires_at: Date | null; created_at: Date;
}
export interface FaithEffectRow {
  id: number; owner: string; target_type: "user" | "faith" | "global"; target: string; value_type: string;
  modifier: number; fixed_bonus: number; source: string; starts_at: Date; expires_at: Date | null;
  metadata: Record<string, unknown>;
}

export interface FaithItemLevelDefinition {
  id: string; name: string; rank: number; color?: string; weight?: number; metadata?: Readonly<Record<string, unknown>>;
}

export interface FaithCoreInventoryRow {
  id: number;
  uid: number;
  item_id: string;
  quantity: number;
}

export interface FaithCoreBusinessData {
  id: number;
  uid: number;
  business: string;
  private: Record<string, unknown>;
  public: Record<string, unknown>;
}

export interface FaithCoreUidSequence {
  id: number;
  next_uid: number;
}

export interface FaithItemDefinition {
  item_id: string;
  name: string;
  type: string;
  level: string;
  description: string;
  max_quantity: number;
  marketable: boolean;
  price: number;
  obtainable: boolean;
  actions?: string[];
}

export interface ItemQuery {
  type?: string;
  level?: string;
  marketable?: boolean;
  obtainable?: boolean;
  name?: string;
}

export interface InventoryItem {
  uid: number;
  item_id: string;
  quantity: number;
  item: Readonly<FaithItemDefinition>;
}

/** 不加载物品定义的轻量背包条目，适合判定持有物和数量。 */
export interface InventoryStack {
  item_id: string;
  quantity: number;
}

export interface InventoryMutation {
  uid: number;
  item_id: string;
  before: number;
  after: number;
  delta: number;
}

export interface UserValueDelta {
  gold?: number;
  ascension_score?: number;
  audience_score?: number;
  audience_rank?: number;
  abandon_count?: number;
}

export interface FaithProfessionDefinition {
  id: string;
  name: string;
  type: string;
  faith: string;
  description?: string;
  source?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface FaithDefinition {
  name: string;
  path: string;
  type: "fixed" | "dynamic";
  creator_uid?: number;
  believer_count: number;
  prayer_word?: string;
  custom_professions?: Record<string, string>;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface FaithCoreFaithRow {
  id: number;
  name: string;
  path: string;
  type: "dynamic";
  creator_uid: number;
  believer_count: number;
  prayer_word: string;
  custom_professions: Record<string, string>;
  metadata: Record<string, unknown>;
  created_at: Date;
}
