import type { FaithCoreUserData } from "../types";
export type BonusValueType = "gold" | "ascension_score" | "audience_score" | (string & {});
export interface BonusContribution { source: string; type: BonusValueType; modifier?: number; fixedBonus?: number; detail?: string; expiresAt?: Date; metadata?: Readonly<Record<string, unknown>>; }
export interface BonusRequest { uid: number; type: BonusValueType; baseValue: number; source?: string; metadata?: Readonly<Record<string, unknown>>; }
export interface BonusProviderContext extends BonusRequest { readonly user: Omit<Readonly<FaithCoreUserData>, "faiths"> & { readonly faiths: readonly string[] }; readonly faiths: readonly string[]; readonly currentFaith: string | null; }
export type BonusProvider = (context: BonusProviderContext) => BonusContribution | readonly BonusContribution[] | null | undefined | Promise<BonusContribution | readonly BonusContribution[] | null | undefined>;
export interface BonusProviderOptions { id: string; owner?: string; priority?: number; types?: readonly BonusValueType[]; }
export interface BonusCalculation extends BonusRequest { multiplier: number; fixedBonus: number; finalValue: number; contributions: readonly BonusContribution[]; failures: readonly { provider: string; error: unknown }[]; }
