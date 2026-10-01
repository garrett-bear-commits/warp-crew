import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, Response, StringEnum } from './common.ts';
import { CRITERION_SOURCES } from './enums.ts';
import { GrantReward } from './grants.ts';

export const CriterionSourceSchema = StringEnum(CRITERION_SOURCES);

/**
 * Achievement definitions are published content documents (ADR-012). Every criterion carries a
 * source tag: server_fact (purchases, placements after review, seenDays, server-stamped claims)
 * vs client_claim (progress, summary scalars, journal events). Client-claim rewards are cosmetic /
 * soft or capped by a declared per-player lifetime budget (§7).
 */
export const Criterion = Type.Union(
  [
    Type.Object(
      {
        source: Type.Literal('server_fact'),
        fact: StringEnum([
          'purchases_paid_count',
          'placements_confirmed',
          'seen_days',
          'grants_claimed',
          'codes_redeemed',
        ] as const),
        op: StringEnum(['gte'] as const),
        value: NonNegInt,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        source: Type.Literal('client_claim'),
        fact: StringEnum(['progress', 'summary', 'journal_event_count'] as const),
        /** Summary key or journal event name; ignored for progress. */
        key: Type.Optional(Type.String({ maxLength: 64 })),
        op: StringEnum(['gte'] as const),
        value: NonNegInt,
      },
      { additionalProperties: false },
    ),
  ],
  { $id: 'Criterion' },
);
export type Criterion = Static<typeof Criterion>;

export const AchievementDefinition = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' }),
    title: Type.String({ maxLength: 120 }),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    criteria: Type.Array(Criterion, { minItems: 1, maxItems: 8 }),
    rewards: Type.Array(GrantReward, { maxItems: 8 }),
    /** Optional windowed availability (a "windowed achievement"). */
    window: Type.Optional(Type.Object({ startsAt: EpochMs, endsAt: EpochMs })),
    minBuildVersion: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { $id: 'AchievementDefinition', additionalProperties: false },
);
export type AchievementDefinition = Static<typeof AchievementDefinition>;

export const AchievementsDocument = Type.Object(
  {
    version: NonNegInt,
    /** Per-player lifetime premium budget for client_claim-sourced rewards. */
    clientClaimPremiumBudget: NonNegInt,
    achievements: Type.Array(AchievementDefinition, { maxItems: 500 }),
  },
  { $id: 'AchievementsDocument', additionalProperties: false },
);
export type AchievementsDocument = Static<typeof AchievementsDocument>;

export const AchievementProgress = Type.Object({
  id: Type.String(),
  unlocked: Type.Boolean(),
  unlockedAt: Type.Optional(EpochMs),
  grantKey: Type.Optional(Type.String()),
  progress: Type.Array(
    Type.Object({
      index: NonNegInt,
      current: NonNegInt,
      target: NonNegInt,
      source: CriterionSourceSchema,
    }),
  ),
});
export type AchievementProgress = Static<typeof AchievementProgress>;

/** GET /v1/achievements/me */
export const AchievementsMeResponse = Response(
  { version: NonNegInt, items: Type.Array(AchievementProgress) },
  { $id: 'AchievementsMeResponse' },
);
export type AchievementsMeResponse = Static<typeof AchievementsMeResponse>;

/** POST /v1/achievements/evaluate {commandId} — evaluate over ledgers + latest summary + journal; mints grants for unlocks. */
export const AchievementsEvaluateBody = Mutation({}, { $id: 'AchievementsEvaluateBody' });
export type AchievementsEvaluateBody = Static<typeof AchievementsEvaluateBody>;

export const AchievementsEvaluateResult = Response(
  {
    unlocked: Type.Array(Type.String()),
    items: Type.Array(AchievementProgress),
    duplicate: Type.Boolean(),
  },
  { $id: 'AchievementsEvaluateResult' },
);
export type AchievementsEvaluateResult = Static<typeof AchievementsEvaluateResult>;

/** Daily claim cadence: once per server UTC day (default) or a rolling 24 h from the last claim. */
export const DAILY_CADENCES = ['utc_day', 'rolling_24h'] as const;
export const DailyCadence = StringEnum(DAILY_CADENCES);
export type DailyCadence = Static<typeof DailyCadence>;

/**
 * Daily reward document (published content). `cadence` defaults to `utc_day`. `minProgress`
 * (optional) refuses a claim until the latest anchored save of the current generation reports at
 * least that progress ordinal.
 */
export const DailyRewardsDocument = Type.Object(
  {
    version: NonNegInt,
    cadence: Type.Optional(DailyCadence),
    minProgress: Type.Optional(NonNegInt),
    ladder: Type.Array(
      Type.Object({
        day: Type.Integer({ minimum: 1 }),
        rewards: Type.Array(GrantReward, { maxItems: 8 }),
      }),
      { minItems: 1, maxItems: 31 },
    ),
  },
  { $id: 'DailyRewardsDocument', additionalProperties: false },
);
export type DailyRewardsDocument = Static<typeof DailyRewardsDocument>;

/**
 * POST /v1/daily/claim {commandId} — server-stamped daily claim (server_fact); mints a grant.
 * `already_claimed_today` means "within the current period": the same server UTC day, or under
 * 24 h since the last claim in `rolling_24h` mode; it returns that claim's grantKey.
 * `not_eligible` means the anchored progress is below the document's `minProgress`. `rewards` is
 * the claim's grant payload whenever a grantKey is returned.
 */
export const DailyClaimBody = Mutation({}, { $id: 'DailyClaimBody' });
export type DailyClaimBody = Static<typeof DailyClaimBody>;
export const DailyClaimResult = Response(
  {
    outcome: StringEnum(['claimed', 'already_claimed_today', 'duplicate', 'not_eligible'] as const),
    day: Type.Integer({ minimum: 1 }),
    grantKey: Type.Optional(Type.String()),
    rewards: Type.Optional(Type.Array(GrantReward, { maxItems: 20 })),
    nextEligibleAt: EpochMs,
  },
  { $id: 'DailyClaimResult' },
);
export type DailyClaimResult = Static<typeof DailyClaimResult>;

/** One server-stamped daily claim of the player's current generation. */
export const DailyClaimRecord = Type.Object(
  {
    grantKey: Type.String(),
    at: EpochMs,
    rewards: Type.Array(GrantReward, { maxItems: 20 }),
    /** The grant was acknowledged through grants.claim. */
    acknowledged: Type.Boolean(),
  },
  { $id: 'DailyClaimRecord' },
);
export type DailyClaimRecord = Static<typeof DailyClaimRecord>;

/**
 * GET /v1/daily/status — eligibility decided on the server clock. `nextEligibleAt` is the
 * server-clock time the next claim opens (serverNow when ready). `claims` lists the newest (≤100)
 * claims of the player's current generation, newest first, so a client can apply grants it never
 * applied (lost response, reload, another device, an older save restored).
 */
export const DailyStatusResponse = Response(
  {
    cadence: DailyCadence,
    state: StringEnum(['ready', 'cooldown', 'not_eligible'] as const),
    nextEligibleAt: EpochMs,
    generation: NonNegInt,
    claims: Type.Array(DailyClaimRecord, { maxItems: 100 }),
  },
  { $id: 'DailyStatusResponse' },
);
export type DailyStatusResponse = Static<typeof DailyStatusResponse>;
