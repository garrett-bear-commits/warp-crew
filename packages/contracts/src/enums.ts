// Closed enums shared by browser and server. This module MUST stay free of the TypeBox
// runtime and of node builtins: browser bundles import values from here, and only
// types from the schema modules (rule §3 "browser bundles contain zero TypeBox runtime").

export const CONTRACT_VERSION = '1.0.0' as const;

/** Every stored write has exactly one disposition (§1, ADR-006). */
export const SAVE_DISPOSITIONS = [
  'anchored',
  'stored_quarantined',
  'stored_refused',
  'duplicate',
] as const;
export type SaveDisposition = (typeof SAVE_DISPOSITIONS)[number];

/** Why a write was refused (disposition = stored_refused). Refusals are 200 + reason (ADR-019). */
export const SAVE_REFUSAL_REASONS = [
  'progress_regression',
  'stale_generation',
  'malformed',
  'blob_too_large',
] as const;
export type SaveRefusalReason = (typeof SAVE_REFUSAL_REASONS)[number];

/** Flags may accompany any stored disposition (§7). */
export const SAVE_FLAGS = [
  'progress_jump',
  'implausible_summary',
  'schema_unknown',
  'schema_downgrade',
  'clock_skew',
] as const;
export type SaveFlag = (typeof SAVE_FLAGS)[number];

export const SAVE_REASONS = [
  'autosave',
  'timer',
  'teardown',
  'important',
  'restore',
  'boot-retry',
] as const;
export type SaveReason = (typeof SAVE_REASONS)[number];

export const SAVE_ENCODINGS = ['json', 'gzip+b64'] as const;
export type SaveEncoding = (typeof SAVE_ENCODINGS)[number];

/** Client-side sync verdicts (§5.2). Only `synced` shows "saved to cloud". */
export const SYNC_VERDICTS = [
  'synced',
  'synced_quarantined',
  'synced_divergent',
  'duplicate',
  'refused_regression',
  'refused_stale_generation',
  'refused_malformed',
  'unauthorized',
  'update_required',
  'throttled',
  'rejected_transport',
  'unreachable',
  'server_behind',
  'erased',
  'no_token',
  'disabled',
] as const;
export type SyncVerdict = (typeof SYNC_VERDICTS)[number];

export const GENERATION_KINDS = [
  'initial',
  'restart',
  'admin_restore',
  'player_restore',
  'reattach',
  'erased',
] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

export const SAVE_REVIEW_ACTIONS = ['promote', 'reject'] as const;
export type SaveReviewAction = (typeof SAVE_REVIEW_ACTIONS)[number];

/** Closed ErrorCode union (§4.2, §6). 4xx are transport/auth/contract/precondition only. */
export const ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'idempotency_mismatch',
  'stale_generation',
  'review_final',
  'build_too_old',
  'rate_limited',
  'payload_too_large',
  'retry_later',
  'not_configured',
  'purchases_disabled',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const PURCHASE_CLASSIFICATIONS = ['paid', 'sandbox', 'unclassified', 'unsupported'] as const;
export type PurchaseClassification = (typeof PURCHASE_CLASSIFICATIONS)[number];

export const PURCHASE_ADJUSTMENT_KINDS = ['refund', 'make_good', 'correction'] as const;
export type PurchaseAdjustmentKind = (typeof PURCHASE_ADJUSTMENT_KINDS)[number];

/** Grants are the one reward primitive (§1). Payload kinds are a closed union. */
export const GRANT_REWARD_KINDS = [
  'soft_currency',
  'premium_currency',
  'item',
  'cosmetic',
] as const;
export type GrantRewardKind = (typeof GRANT_REWARD_KINDS)[number];

export const GRANT_SOURCES = [
  'admin',
  'cohort',
  'purchase',
  'achievement',
  'code',
  'placement',
  'daily_reward',
  'system',
] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

export const CRITERION_SOURCES = ['server_fact', 'client_claim'] as const;
export type CriterionSource = (typeof CRITERION_SOURCES)[number];

export const ADMIN_SCOPES = ['read', 'support', 'grant', 'publish', 'restore', 'erase'] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number];

export const ACTORS = ['player', 'admin', 'ops', 'job', 'system'] as const;
export type ActorKind = (typeof ACTORS)[number];

export const GAME_ENVS = ['prod', 'lab', 'dev'] as const;
export type GameEnv = (typeof GAME_ENVS)[number];

export const SEASON_STATUSES = ['draft', 'active', 'closed'] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export const SUBMISSION_VISIBILITIES = ['visible', 'quarantined', 'hidden', 'rejected'] as const;
export type SubmissionVisibility = (typeof SUBMISSION_VISIBILITIES)[number];

export const PLACEMENT_STATES = ['provisional', 'confirmed', 'voided'] as const;
export type PlacementState = (typeof PLACEMENT_STATES)[number];

export const CONTENT_ENVS = ['lab', 'prod'] as const;
export type ContentEnv = (typeof CONTENT_ENVS)[number];

export const CONTENT_KINDS = [
  'achievements',
  'quests',
  'daily_rewards',
  'offers',
  'announcements',
  'notification_copy',
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const FLAG_TYPES = ['boolean', 'number', 'string'] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

export const JOURNAL_MODES = ['on', 'errors_only', 'off'] as const;
export type JournalMode = (typeof JOURNAL_MODES)[number];

export const JOURNAL_ENTRY_KINDS = ['action', 'settle', 'gap'] as const;
export type JournalEntryKind = (typeof JOURNAL_ENTRY_KINDS)[number];

export const INTEGRITY_EVENT_KINDS = [
  'game_error',
  'storage_blocked',
  'save_backstop_unreachable',
  'clock_skew',
  'progress_jump_client',
  'restore_used',
  'kv_break_glass_read',
  'identity_switch',
] as const;
export type IntegrityEventKind = (typeof INTEGRITY_EVENT_KINDS)[number];

export const FEEDBACK_STATUSES = ['new', 'triaged', 'resolved'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const PLAYER_FLAG_KINDS = ['purchases_disabled', 'boards_hidden', 'grants_frozen'] as const;
export type PlayerFlagKind = (typeof PLAYER_FLAG_KINDS)[number];

export const IDENTITY_FAILURES = [
  'no_secret',
  'malformed',
  'bad_alg',
  'bad_signature',
  'stale',
  'wrong_audience',
  'sub_mismatch',
] as const;
export type IdentityFailure = (typeof IDENTITY_FAILURES)[number];

export const RECEIPT_FAILURES = [
  'no_secret',
  'malformed',
  'bad_alg',
  'bad_signature',
  'wrong_audience',
  'malformed_purchase',
] as const;
export type ReceiptFailure = (typeof RECEIPT_FAILURES)[number];

/** Header names (§6). */
export const HEADERS = {
  playerKey: 'x-player-key',
  authorization: 'authorization',
  requestId: 'x-request-id',
  adminKeyId: 'x-admin-key-id',
  adminSecret: 'x-admin-secret',
  idempotencyKey: 'idempotency-key',
  opsSecret: 'x-ops-secret',
  buildVersion: 'x-build-version',
} as const;

/** Blob and decode limits are policy; these are the hard ceilings the contract advertises. */
export const LIMITS = {
  beaconMaxBytes: 64 * 1024,
  journalMaxBytesPerCall: 16 * 1024,
  journalRingBytes: 32 * 1024,
  integrityEventsPerCall: 20,
  maxExpansionRatio: 20,
  safeIntMax: Number.MAX_SAFE_INTEGER,
} as const;
