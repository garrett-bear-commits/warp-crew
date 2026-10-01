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
  /** Premium currency granted for a paid purchase (server fact). */
  baseAmount: number;
  /** First purchase of this pack doubles (per-pack promotion keyed by pack id). */
  firstPurchaseMultiplier?: number;
  title?: string;
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
