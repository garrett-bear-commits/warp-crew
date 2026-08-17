import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, PlayerKey, Response, StringEnum } from './common.ts';
import { GrantReward, GrantKey } from './grants.ts';
import { SnapshotMeta } from './saves.ts';
import { PLAYER_FLAG_KINDS } from './enums.ts';
import { SegmentPredicate } from './liveops.ts';

export const PlayerFlagKindSchema = StringEnum(PLAYER_FLAG_KINDS);

/** Admin: mint a grant for one player (scope grant). Business key = grantKey. */
export const AdminGrantBody = Mutation(
  {
    playerKey: PlayerKey,
    grantKey: GrantKey,
    rewards: Type.Array(GrantReward, { minItems: 1, maxItems: 20 }),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
    ticketRef: Type.Optional(Type.String({ maxLength: 128 })),
    title: Type.Optional(Type.String({ maxLength: 200 })),
    body: Type.Optional(Type.String({ maxLength: 2000 })),
    expiresAt: Type.Optional(EpochMs),
  },
  { $id: 'AdminGrantBody' },
);
export type AdminGrantBody = Static<typeof AdminGrantBody>;

/** Admin: mint for a cohort (segment predicate); dryRun returns the count only. */
export const AdminCohortGrantBody = Mutation(
  {
    grantKeyPrefix: Type.String({ minLength: 1, maxLength: 120 }),
    predicate: SegmentPredicate,
    rewards: Type.Array(GrantReward, { minItems: 1, maxItems: 20 }),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
    ticketRef: Type.Optional(Type.String({ maxLength: 128 })),
    dryRun: Type.Boolean(),
    title: Type.Optional(Type.String({ maxLength: 200 })),
    body: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { $id: 'AdminCohortGrantBody' },
);
export type AdminCohortGrantBody = Static<typeof AdminCohortGrantBody>;

export const AdminCohortGrantResult = Response(
  { matched: NonNegInt, minted: NonNegInt, dryRun: Type.Boolean(), duplicate: Type.Boolean() },
  { $id: 'AdminCohortGrantResult' },
);
export type AdminCohortGrantResult = Static<typeof AdminCohortGrantResult>;

export const AdminGrantResult = Response(
  { grantKey: GrantKey, duplicate: Type.Boolean() },
  { $id: 'AdminGrantResult' },
);
export type AdminGrantResult = Static<typeof AdminGrantResult>;

/** Admin: restore a player to a seq (scope restore) → new generation kind admin_restore. */
export const AdminRestoreBody = Mutation(
  {
    playerKey: PlayerKey,
    seq: NonNegInt,
    expectedGeneration: NonNegInt,
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'AdminRestoreBody' },
);
export type AdminRestoreBody = Static<typeof AdminRestoreBody>;

/** Admin: promote/reject a quarantined save (terminal review). */
export const AdminSaveReviewBody = Mutation(
  {
    playerKey: PlayerKey,
    seq: NonNegInt,
    action: StringEnum(['promote', 'reject'] as const),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'AdminSaveReviewBody' },
);
export type AdminSaveReviewBody = Static<typeof AdminSaveReviewBody>;

export const AdminSaveReviewResult = Response(
  {
    outcome: StringEnum([
      'promoted',
      'rejected',
      'review_final',
      'not_found',
      'not_eligible',
    ] as const),
    anchorSeq: Type.Optional(NonNegInt),
    duplicate: Type.Boolean(),
  },
  { $id: 'AdminSaveReviewResult' },
);
export type AdminSaveReviewResult = Static<typeof AdminSaveReviewResult>;

/** Admin: erase a player (scope erase) → generation kind erased + erasure ledger row. */
export const AdminEraseBody = Mutation(
  {
    playerKey: PlayerKey,
    reason: Type.String({ minLength: 1, maxLength: 512 }),
    ticketRef: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { $id: 'AdminEraseBody' },
);
export type AdminEraseBody = Static<typeof AdminEraseBody>;

export const AdminEraseResult = Response(
  { generation: NonNegInt, erasedRows: NonNegInt, duplicate: Type.Boolean() },
  { $id: 'AdminEraseResult' },
);
export type AdminEraseResult = Static<typeof AdminEraseResult>;

/** Admin: player flag (purchases_disabled, boards_hidden, grants_frozen). */
export const AdminPlayerFlagBody = Mutation(
  {
    playerKey: PlayerKey,
    flag: PlayerFlagKindSchema,
    enabled: Type.Boolean(),
    until: Type.Optional(EpochMs),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'AdminPlayerFlagBody' },
);
export type AdminPlayerFlagBody = Static<typeof AdminPlayerFlagBody>;

/** Admin: purchase adjustment (refund / make_good / correction). Negative deltas require an admin action. */
export const AdminAdjustmentBody = Mutation(
  {
    playerKey: PlayerKey,
    kind: StringEnum(['refund', 'make_good', 'correction'] as const),
    delta: Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 }),
    transactionId: Type.Optional(NonNegInt),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
    ticketRef: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { $id: 'AdminAdjustmentBody' },
);
export type AdminAdjustmentBody = Static<typeof AdminAdjustmentBody>;

export const AdminAdjustmentResult = Response(
  { adjustmentId: NonNegInt, duplicate: Type.Boolean() },
  { $id: 'AdminAdjustmentResult' },
);

/** Admin: code campaign. */
export const AdminCodeCampaignBody = Mutation(
  {
    campaignId: Type.String({ minLength: 1, maxLength: 64 }),
    codes: Type.Array(Type.String({ minLength: 8, maxLength: 64 }), {
      minItems: 1,
      maxItems: 1000,
    }),
    rewards: Type.Array(GrantReward, { minItems: 1, maxItems: 20 }),
    maxRedemptionsPerCode: Type.Integer({ minimum: 1 }),
    registeredOnly: Type.Boolean(),
    expiresAt: Type.Optional(EpochMs),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'AdminCodeCampaignBody' },
);
export type AdminCodeCampaignBody = Static<typeof AdminCodeCampaignBody>;

export const AdminCodeCampaignResult = Response(
  { campaignId: Type.String(), codes: NonNegInt, duplicate: Type.Boolean() },
  { $id: 'AdminCodeCampaignResult' },
);

/** Admin: replay an outbox row for one consumer. */
export const AdminOutboxReplayBody = Mutation(
  {
    outboxId: NonNegInt,
    consumer: Type.String({ minLength: 1, maxLength: 64 }),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'AdminOutboxReplayBody' },
);
export type AdminOutboxReplayBody = Static<typeof AdminOutboxReplayBody>;

/** Admin: rebuild a projection that is a pure function of ledgers. */
export const AdminRebuildProjectionBody = Mutation(
  {
    projection: StringEnum([
      'players_overview',
      'entitlements',
      'leaderboard_entries',
      'achievement_progress',
    ] as const),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'AdminRebuildProjectionBody' },
);
export type AdminRebuildProjectionBody = Static<typeof AdminRebuildProjectionBody>;

export const AdminRebuildProjectionResult = Response(
  { projection: Type.String(), rows: NonNegInt, duplicate: Type.Boolean() },
  { $id: 'AdminRebuildProjectionResult' },
);

/** Admin: player overview (read). */
export const PlayerOverview = Response(
  {
    playerKey: PlayerKey,
    firstSeenAt: Type.Optional(EpochMs),
    lastSeenAt: Type.Optional(EpochMs),
    registered: Type.Boolean(),
    lastBuildVersion: Type.Optional(Type.String()),
    generation: NonNegInt,
    generationKind: Type.String(),
    anchor: Type.Optional(SnapshotMeta),
    pendingQuarantine: Type.Optional(SnapshotMeta),
    entitlement: NonNegInt,
    paidCount: NonNegInt,
    flags: Type.Array(
      Type.Object({
        flag: PlayerFlagKindSchema,
        until: Type.Optional(EpochMs),
        reason: Type.String(),
      }),
    ),
    strikes: NonNegInt,
    grantsPending: NonNegInt,
    erased: Type.Boolean(),
  },
  { $id: 'PlayerOverview' },
);
export type PlayerOverview = Static<typeof PlayerOverview>;

/** Inspector timeline = UNION view over ledgers. */
export const TimelineItem = Type.Object({
  at: EpochMs,
  kind: Type.String(),
  ref: Type.String(),
  summary: Type.String(),
  detail: Type.Optional(Type.Unknown()),
});
export const TimelineResponse = Response(
  { playerKey: PlayerKey, items: Type.Array(TimelineItem) },
  { $id: 'TimelineResponse' },
);
export type TimelineResponse = Static<typeof TimelineResponse>;

export const AdminPlayerParams = Type.Object({ playerKey: PlayerKey });

export const AdminActionRecord = Type.Object({
  id: NonNegInt,
  adminKeyId: Type.String(),
  scope: Type.String(),
  commandType: Type.String(),
  commandId: Type.String(),
  target: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String()),
  at: EpochMs,
  outcome: Type.String(),
});
export const AdminActionsResponse = Response(
  { items: Type.Array(AdminActionRecord) },
  { $id: 'AdminActionsResponse' },
);

export const OutboxDeadLetter = Type.Object({
  id: NonNegInt,
  outboxId: NonNegInt,
  consumer: Type.String(),
  kind: Type.String(),
  attempts: NonNegInt,
  lastError: Type.String(),
  deadAt: EpochMs,
  replayedAt: Type.Optional(EpochMs),
});
export const OutboxDeadLettersResponse = Response(
  { items: Type.Array(OutboxDeadLetter) },
  { $id: 'OutboxDeadLettersResponse' },
);

/** Lab-only: mint a qa_ identity token. */
export const QaMintBody = Mutation(
  {
    playerId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 64, pattern: '^qa_[a-z0-9_-]+$' }),
    ),
    registered: Type.Optional(Type.Boolean()),
  },
  { $id: 'QaMintBody' },
);
export type QaMintBody = Static<typeof QaMintBody>;
export const QaMintResult = Response(
  { playerKey: PlayerKey, token: Type.String(), expiresAt: EpochMs },
  { $id: 'QaMintResult' },
);
export type QaMintResult = Static<typeof QaMintResult>;

/** Lab-only: import a sanitised snapshot as a lineage seed for a qa_ identity. Manifest required. */
export const QaImportBody = Mutation(
  {
    playerKey: Type.String({ pattern: '^qa_[a-z0-9_-]+$', maxLength: 64 }),
    manifest: Type.Object({
      game: Type.String(),
      env: Type.String(),
      takenAt: EpochMs,
      schemaHead: Type.String(),
      contractVersion: Type.String(),
    }),
    snapshot: Type.Object({
      progress: NonNegInt,
      schemaVersion: Type.Integer({ minimum: 1 }),
      buildVersion: Type.String({ maxLength: 64 }),
      enc: StringEnum(['json', 'gzip+b64'] as const),
      blob: Type.String({ minLength: 2 }),
    }),
  },
  { $id: 'QaImportBody' },
);
export type QaImportBody = Static<typeof QaImportBody>;
export const QaImportResult = Response(
  { generation: NonNegInt, seq: NonNegInt, duplicate: Type.Boolean() },
  { $id: 'QaImportResult' },
);
