import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, Response, StringEnum } from './common.ts';
import { GRANT_REWARD_KINDS, GRANT_SOURCES } from './enums.ts';

export const GrantRewardKindSchema = StringEnum(GRANT_REWARD_KINDS);
export const GrantSourceSchema = StringEnum(GRANT_SOURCES);

/** Typed reward payload union (§4.3 grants). Premium value only originates from server facts. */
export const GrantReward = Type.Union(
  [
    Type.Object(
      {
        kind: Type.Literal('soft_currency'),
        currency: Type.String({ maxLength: 32 }),
        amount: NonNegInt,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      { kind: Type.Literal('premium_currency'), amount: NonNegInt },
      { additionalProperties: false },
    ),
    Type.Object(
      { kind: Type.Literal('item'), itemId: Type.String({ maxLength: 64 }), qty: NonNegInt },
      { additionalProperties: false },
    ),
    Type.Object(
      { kind: Type.Literal('cosmetic'), cosmeticId: Type.String({ maxLength: 64 }) },
      { additionalProperties: false },
    ),
  ],
  { $id: 'GrantReward' },
);
export type GrantReward = Static<typeof GrantReward>;

export const GrantKey = Type.String({ minLength: 1, maxLength: 200 });

export const Grant = Type.Object(
  {
    grantKey: GrantKey,
    source: GrantSourceSchema,
    rewards: Type.Array(GrantReward, { maxItems: 20 }),
    reason: Type.String(),
    ticketRef: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    createdAt: EpochMs,
    expiresAt: Type.Optional(EpochMs),
    claimedAt: Type.Optional(EpochMs),
  },
  { $id: 'Grant' },
);
export type Grant = Static<typeof Grant>;

/** GET /v1/grants/pending */
export const GrantsPendingResponse = Response(
  { grants: Type.Array(Grant), grantsFrozen: Type.Boolean() },
  { $id: 'GrantsPendingResponse' },
);
export type GrantsPendingResponse = Static<typeof GrantsPendingResponse>;

/** POST /v1/grants/claim {commandId, grantKey} (same payload on repeat) */
export const GrantClaimBody = Mutation({ grantKey: GrantKey }, { $id: 'GrantClaimBody' });
export type GrantClaimBody = Static<typeof GrantClaimBody>;

export const GrantClaimResult = Response(
  {
    outcome: StringEnum(['claimed', 'already_claimed', 'not_found', 'expired', 'frozen'] as const),
    grant: Type.Optional(Grant),
    duplicate: Type.Boolean(),
  },
  { $id: 'GrantClaimResult' },
);
export type GrantClaimResult = Static<typeof GrantClaimResult>;

/** POST /v1/grants/claim-batch {commandId, grantKeys[]} */
export const GrantClaimBatchBody = Mutation(
  { grantKeys: Type.Array(GrantKey, { minItems: 1, maxItems: 50 }) },
  { $id: 'GrantClaimBatchBody' },
);
export type GrantClaimBatchBody = Static<typeof GrantClaimBatchBody>;

export const GrantClaimBatchResult = Response(
  {
    results: Type.Array(
      Type.Object({
        grantKey: GrantKey,
        outcome: StringEnum([
          'claimed',
          'already_claimed',
          'not_found',
          'expired',
          'frozen',
        ] as const),
      }),
    ),
  },
  { $id: 'GrantClaimBatchResult' },
);
export type GrantClaimBatchResult = Static<typeof GrantClaimBatchResult>;

/** POST /v1/codes/redeem {commandId, code} */
export const CodeRedeemBody = Mutation(
  { code: Type.String({ minLength: 4, maxLength: 64 }) },
  { $id: 'CodeRedeemBody' },
);
export type CodeRedeemBody = Static<typeof CodeRedeemBody>;

export const CodeRedeemResult = Response(
  {
    outcome: StringEnum([
      'redeemed',
      'already_redeemed',
      'invalid',
      'expired',
      'exhausted',
      'locked',
      'registration_required',
    ] as const),
    grant: Type.Optional(Grant),
    duplicate: Type.Boolean(),
  },
  { $id: 'CodeRedeemResult' },
);
export type CodeRedeemResult = Static<typeof CodeRedeemResult>;
