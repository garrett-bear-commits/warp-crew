// Per-game configuration (§11 game.config.ts + policy.ts). Composed in apps/server/games/<id>/.
import type {
  AchievementsDocument,
  DailyRewardsDocument,
  FlagDefinition,
  GrantReward,
  JournalMode,
  Summary,
} from '@foundation/contracts';
import type { BlobLimits } from '../codec/blob.ts';

export interface CatalogPack {
  sku: string;
  packKey: string;
  /**
   * Premium currency granted for a paid purchase (server fact). For a bundle (`rewards`) this is
   * the premium currency inside the bundle (what `purchase_transactions.granted` records).
   */
  baseAmount: number;
  /** First purchase of this pack doubles (per-pack promotion keyed by pack id). Not for bundles. */
  firstPurchaseMultiplier?: number;
  title?: string;
  /**
   * Bundle pack (ADR-035): one delivery grants exactly these rewards, in the game's grant
   * vocabulary (`GamePolicy.grantRewardProblem` must accept them), instead of `baseAmount`
   * premium alone. Boot refuses a bundle whose premium differs from `baseAmount`.
   */
  rewards?: GrantReward[];
  /**
   * Sold once per player (ADR-035). The first minted paid purchase owns it; any later receipt for
   * it (paid or sandbox) is recorded with `duplicateOf` for support to refund and granted nothing.
   * Sandbox purchases never make it owned.
   */
  oneTime?: boolean;
}

/** A subscription SKU the game knows (ADR-035). Perks are the game's; the server only verifies. */
export interface SubscriptionSku {
  sku: string;
  title?: string;
}

/**
 * Subscriptions (ADR-035): Jest's signed subscription list is verified per request and nothing
 * is stored. Sandbox subscriptions are active only with `purchases.mintSandbox: 'on'`.
 */
export interface SubscriptionsConfig {
  skus: SubscriptionSku[];
  /** How old a signed list may be (from its `iat`). Default and ceiling: 24 h. */
  maxAgeSec?: number;
}

export interface BoardConfig {
  boardKey: string;
  scoreMin: number;
  scoreMax: number;
  maxElapsedMs: number;
  quarantineTopN: number;
  /** Summary-bounded score: score ≤ summary[key] * factor when present. */
  summaryBound?: { key: string; factor: number };
}

export interface RetentionConfig {
  keepRecent: number;
  keepDailyDays: number;
  keepGenerations: number;
  refusedBlobsPerHour: number;
}

export interface FeatureFlagsConfig {
  achievements: boolean;
  leaderboards: boolean;
  inbox: boolean;
  liveops: boolean;
  telemetry: boolean;
  journal: boolean;
  purchases: boolean;
  grants: boolean;
  qa: boolean;
  /** Daily reward claim + status without the achievements evaluator (on with `achievements`). */
  daily?: boolean;
  /** Verify signed subscription lists (`GameConfig.subscriptions`, ADR-035). */
  subscriptions?: boolean;
}

export interface GameConfig {
  gameId: string;
  features: FeatureFlagsConfig;
  catalog: CatalogPack[];
  boards: BoardConfig[];
  /** Origins allowed by CORS in addition to CLIENT_ORIGINS. */
  origins: string[];
  retention: RetentionConfig;
  /** Depth ratchet plausibility: max progress increase per hour before a write is quarantined (progress_jump). */
  maxProgressPerHour: number;
  journal: JournalMode;
  /** Schema versions this build knows; a write with a newer schema is quarantined (schema_unknown). */
  knownSchemaVersions: number[];
  /** Real premium minting from receipts (ADR-024). `mintSandbox` also mints signed sandbox receipts. */
  purchases: { mintPremium: 'on' | 'off'; mintSandbox?: 'on' | 'off' };
  /** Known subscription SKUs; required when `features.subscriptions` (ADR-035). */
  subscriptions?: SubscriptionsConfig;
  blobLimits: BlobLimits;
  maxTokenAgeSec: number;
  /** In-bundle content defaults (published documents override, ADR-012). */
  content: { achievements: AchievementsDocument; dailyRewards: DailyRewardsDocument };
  flags: FlagDefinition[];
  /** Per-player daily budget for integrity events. */
  integrityDailyBudget: number;
  journalDailyEntryBudget: number;
  /** Rewards for a placement by rank (server fact after review). */
  placementRewards?: Array<{ upTo: number; rewards: GrantReward[] }>;
  minBuildVersion: string;
}

export interface BlobPolicyResult {
  ok: boolean;
  reason?: string;
  /** Extracted declared summary scalars (the only fields the server may read). */
  summary?: Summary;
  schemaVersion?: number;
}

export interface GamePolicy {
  /** Validate a decoded blob (shape only, cheap) and extract the summary. */
  validateBlob(value: unknown): BlobPolicyResult;
  /** Sanitise a blob for QA import (strip identifiers). */
  sanitizeForQa(value: unknown): unknown;
  /** Plausibility of a summary given progress (implausible_summary flag). */
  summaryPlausible?(summary: Summary, progress: number): boolean;
  /** Maximum earnable premium for a progress ordinal (impossible-gem check). */
  maxEarnablePremium?(progress: number): number;
  /**
   * Summary keys the nightly economy anomaly job z-scores. Omitted: every
   * numeric summary key. Declare it when the summary also carries analytics
   * scalars (timestamps, lifetime counters) that are skewed by nature.
   */
  anomalyKeys?: readonly string[];
  /**
   * Why the game could not apply these grant rewards, or null when it can. Admin and cohort
   * grants are refused at mint time with this reason (`validation_failed`), so a typo never
   * mints a grant the game would refuse. Omitted: every reward the contract allows.
   */
  grantRewardProblem?(rewards: readonly GrantReward[]): string | null;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  keepRecent: 20,
  keepDailyDays: 30,
  keepGenerations: 3,
  refusedBlobsPerHour: 5,
};

/** Ceiling for `subscriptions.maxAgeSec`: an older signed list could be replayed after a cancel. */
export const SUBSCRIPTION_MAX_AGE_SEC = 24 * 3600;

const premiumIn = (rewards: readonly GrantReward[]): number =>
  rewards.reduce((n, r) => (r.kind === 'premium_currency' ? n + r.amount : n), 0);

/**
 * Why this game's catalog and subscription configuration cannot boot (ADR-035), or []. Bundles
 * must be grants the game can apply, one-time packs must be unambiguous, and subscriptions need
 * their SKUs. createServer refuses to start on any problem.
 */
export function gameConfigProblems(game: GameConfig, policy: GamePolicy): string[] {
  const problems: string[] = [];
  const skus = new Set<string>();
  for (const pack of game.catalog) {
    if (skus.has(pack.sku)) problems.push(`catalog ${pack.sku}: duplicate sku`);
    skus.add(pack.sku);
    if (!Number.isSafeInteger(pack.baseAmount) || pack.baseAmount < 0)
      problems.push(`catalog ${pack.sku}: baseAmount must be a non-negative integer`);
    if (pack.rewards === undefined) continue;
    if (pack.rewards.length === 0) problems.push(`catalog ${pack.sku}: a bundle needs rewards`);
    if ((pack.firstPurchaseMultiplier ?? 1) !== 1)
      problems.push(`catalog ${pack.sku}: a bundle cannot take a firstPurchaseMultiplier`);
    if (premiumIn(pack.rewards) !== pack.baseAmount)
      problems.push(
        `catalog ${pack.sku}: baseAmount ${pack.baseAmount} differs from the bundle's premium ${premiumIn(pack.rewards)}`,
      );
    const problem = policy.grantRewardProblem?.(pack.rewards) ?? null;
    if (problem) problems.push(`catalog ${pack.sku}: ${problem}`);
  }
  const subs = game.subscriptions;
  if (game.features.subscriptions) {
    if (!subs || subs.skus.length === 0)
      problems.push('features.subscriptions needs subscriptions.skus');
  }
  if (subs) {
    const seen = new Set<string>();
    for (const s of subs.skus) {
      if (!s.sku) problems.push('subscriptions: empty sku');
      if (seen.has(s.sku)) problems.push(`subscriptions ${s.sku}: duplicate sku`);
      seen.add(s.sku);
    }
    if (
      subs.maxAgeSec !== undefined &&
      !(
        Number.isSafeInteger(subs.maxAgeSec) &&
        subs.maxAgeSec > 0 &&
        subs.maxAgeSec <= SUBSCRIPTION_MAX_AGE_SEC
      )
    )
      problems.push(`subscriptions.maxAgeSec must be 1..${SUBSCRIPTION_MAX_AGE_SEC}`);
  }
  return problems;
}
