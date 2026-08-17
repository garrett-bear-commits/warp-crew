import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, Response, StringEnum, Uuid } from './common.ts';
import { PLACEMENT_STATES, SEASON_STATUSES, SUBMISSION_VISIBILITIES } from './enums.ts';
import { Summary } from './saves.ts';

export const SeasonStatusSchema = StringEnum(SEASON_STATUSES);
export const SubmissionVisibilitySchema = StringEnum(SUBMISSION_VISIBILITIES);
export const PlacementStateSchema = StringEnum(PLACEMENT_STATES);

export const BoardKey = Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' });
export const SeasonKey = Type.String({ minLength: 1, maxLength: 64 });

/** POST /v1/leaderboards/:board/start {commandId, runId} — server stamps started_at and issues the seed. */
export const RunStartBody = Mutation({ runId: Uuid }, { $id: 'RunStartBody' });
export type RunStartBody = Static<typeof RunStartBody>;

export const RunStartResult = Response(
  {
    runId: Uuid,
    seasonKey: SeasonKey,
    rulesVersion: Type.String(),
    startedAt: EpochMs,
    /** Server-issued seed for verified runs (§7). */
    seed: Type.String(),
    duplicate: Type.Boolean(),
  },
  { $id: 'RunStartResult' },
);
export type RunStartResult = Static<typeof RunStartResult>;

/** Level-3 replay proof (interface only in v1). */
export const RunProof = Type.Object(
  {
    seed: Type.String(),
    buildVersion: Type.String(),
    inputs: Type.Array(Type.Unknown(), { maxItems: 10000 }),
  },
  { $id: 'RunProof' },
);
export type RunProof = Static<typeof RunProof>;

/** POST /v1/leaderboards/:board/submit {commandId, runId, score, proof?} */
export const RunSubmitBody = Mutation(
  {
    runId: Uuid,
    score: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    summary: Type.Optional(Summary),
    proof: Type.Optional(RunProof),
  },
  { $id: 'RunSubmitBody' },
);
export type RunSubmitBody = Static<typeof RunSubmitBody>;

export const RunSubmitResult = Response(
  {
    outcome: StringEnum([
      'accepted',
      'accepted_quarantined',
      'duplicate',
      'rejected_season_inactive',
      'rejected_rules_mismatch',
      'rejected_out_of_range',
      'rejected_duration',
      'rejected_unknown_run',
      'rejected_boards_hidden',
    ] as const),
    visibility: Type.Optional(SubmissionVisibilitySchema),
    rank: Type.Optional(NonNegInt),
    verificationLevel: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
  },
  { $id: 'RunSubmitResult' },
);
export type RunSubmitResult = Static<typeof RunSubmitResult>;

export const BoardEntry = Type.Object({
  rank: NonNegInt,
  displayName: Type.String(),
  score: NonNegInt,
  submittedAt: EpochMs,
});

/** GET /v1/leaderboards/:board/top (public, no ids) */
export const BoardTopResponse = Response(
  {
    board: BoardKey,
    seasonKey: Type.Optional(SeasonKey),
    status: SeasonStatusSchema,
    endsAt: Type.Optional(EpochMs),
    entries: Type.Array(BoardEntry),
  },
  { $id: 'BoardTopResponse' },
);
export type BoardTopResponse = Static<typeof BoardTopResponse>;

/** GET /v1/leaderboards/:board/me */
export const BoardMeResponse = Response(
  {
    board: BoardKey,
    seasonKey: Type.Optional(SeasonKey),
    best: Type.Optional(
      Type.Object({
        score: NonNegInt,
        rank: Type.Optional(NonNegInt),
        visibility: SubmissionVisibilitySchema,
      }),
    ),
    placements: Type.Array(
      Type.Object({
        receiptId: Type.String(),
        seasonKey: SeasonKey,
        rank: NonNegInt,
        state: PlacementStateSchema,
        grantKey: Type.Optional(Type.String()),
      }),
    ),
    displayName: Type.String(),
    boardsHidden: Type.Boolean(),
  },
  { $id: 'BoardMeResponse' },
);
export type BoardMeResponse = Static<typeof BoardMeResponse>;

/** POST /v1/leaderboards/placements/claim {commandId, receiptId} */
export const PlacementClaimBody = Mutation(
  { receiptId: Type.String({ minLength: 1, maxLength: 128 }) },
  { $id: 'PlacementClaimBody' },
);
export type PlacementClaimBody = Static<typeof PlacementClaimBody>;

export const PlacementClaimResult = Response(
  {
    outcome: StringEnum([
      'claimed',
      'already_claimed',
      'not_found',
      'provisional',
      'voided',
    ] as const),
    grantKey: Type.Optional(Type.String()),
    duplicate: Type.Boolean(),
  },
  { $id: 'PlacementClaimResult' },
);
export type PlacementClaimResult = Static<typeof PlacementClaimResult>;

/** POST /v1/leaderboards/name {commandId, displayName} — moderated names. */
export const DisplayNameBody = Mutation(
  { displayName: Type.String({ minLength: 1, maxLength: 24 }) },
  { $id: 'DisplayNameBody' },
);
export type DisplayNameBody = Static<typeof DisplayNameBody>;

export const DisplayNameResult = Response(
  { displayName: Type.String(), moderated: Type.Boolean() },
  { $id: 'DisplayNameResult' },
);

export const BoardParams = Type.Object({ board: BoardKey });

// ─── Admin ────────────────────────────────────────────────────────

export const SeasonUpsertBody = Mutation(
  {
    board: BoardKey,
    seasonKey: SeasonKey,
    rulesVersion: Type.String({ minLength: 1, maxLength: 32 }),
    status: SeasonStatusSchema,
    startsAt: Type.Optional(EpochMs),
    endsAt: Type.Optional(EpochMs),
    scoreMin: NonNegInt,
    scoreMax: NonNegInt,
    maxElapsedMs: Type.Integer({ minimum: 1 }),
    quarantineTopN: NonNegInt,
    /** Placement reward tiers: rank ≤ upTo → reward grants. */
    rewards: Type.Optional(
      Type.Array(
        Type.Object({ upTo: NonNegInt, rewards: Type.Array(Type.Unknown(), { maxItems: 20 }) }),
      ),
    ),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'SeasonUpsertBody' },
);
export type SeasonUpsertBody = Static<typeof SeasonUpsertBody>;

export const SubmissionReviewBody = Mutation(
  {
    submissionId: NonNegInt,
    action: StringEnum(['approve', 'reject'] as const),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'SubmissionReviewBody' },
);
export type SubmissionReviewBody = Static<typeof SubmissionReviewBody>;
