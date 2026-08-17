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

/** Daily reward document (published content). */
export const DailyRewardsDocument = Type.Object(
  {
    version: NonNegInt,
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

/** POST /v1/daily/claim {commandId} — server-stamped daily claim (server_fact); mints a grant. */
export const DailyClaimBody = Mutation({}, { $id: 'DailyClaimBody' });
export type DailyClaimBody = Static<typeof DailyClaimBody>;
export const DailyClaimResult = Response(
  {
    outcome: StringEnum(['claimed', 'already_claimed_today', 'duplicate'] as const),
    day: Type.Integer({ minimum: 1 }),
    grantKey: Type.Optional(Type.String()),
    nextEligibleAt: EpochMs,
  },
  { $id: 'DailyClaimResult' },
);
export type DailyClaimResult = Static<typeof DailyClaimResult>;
