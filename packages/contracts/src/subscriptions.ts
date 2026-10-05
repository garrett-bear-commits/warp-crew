import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, Response, StringEnum } from './common.ts';
import { SUBSCRIPTION_BILLING_PERIODS, SUBSCRIPTION_FAILURES } from './enums.ts';

/**
 * POST /v1/subscriptions/verify {commandId, subscriptionsSigned} (ADR-035): Jest's signed
 * subscription list (`signed` from getSubscriptions, or `subscriptionSigned` from checkout or a
 * retention claim) is the only input. Stateless: nothing is stored or granted.
 */
export const SubscriptionsVerifyBody = Mutation(
  { subscriptionsSigned: Type.String({ minLength: 1, maxLength: 65536 }) },
  { $id: 'SubscriptionsVerifyBody' },
);
export type SubscriptionsVerifyBody = Static<typeof SubscriptionsVerifyBody>;

export const SubscriptionEntitlement = Type.Object(
  {
    sku: Type.String({ minLength: 1, maxLength: 256 }),
    /** Pay this SKU's perks: Jest signed it `active` (a sandbox one only where sandbox delivery is on). */
    active: Type.Boolean(),
    /** Jest's signed status; null when the signed list does not name this SKU. */
    status: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    sandbox: Type.Boolean(),
    trialEligible: Type.Boolean(),
    retentionOffer: Type.Union([
      Type.Object({
        price: Type.Number(),
        durationPeriods: Type.Union([Type.Number(), Type.Null()]),
      }),
      Type.Null(),
    ]),
    /** The signed catalog terms, so a shop shows what Jest will bill. */
    price: Type.Union([Type.Number(), Type.Null()]),
    currency: Type.Union([Type.String(), Type.Null()]),
    billingPeriod: Type.Union([StringEnum(SUBSCRIPTION_BILLING_PERIODS), Type.Null()]),
  },
  { $id: 'SubscriptionEntitlement' },
);
export type SubscriptionEntitlement = Static<typeof SubscriptionEntitlement>;

export const SubscriptionsVerifyResult = Response(
  {
    outcome: StringEnum(['verified', 'rejected'] as const),
    reason: Type.Optional(StringEnum(SUBSCRIPTION_FAILURES)),
    /** When Jest signed the list: offline grace runs from here, not from when it was shown. */
    issuedAt: Type.Optional(EpochMs),
    /** One entry per SKU the game configures, in config order; empty when rejected. */
    subscriptions: Type.Array(SubscriptionEntitlement, { maxItems: 50 }),
  },
  { $id: 'SubscriptionsVerifyResult' },
);
export type SubscriptionsVerifyResult = Static<typeof SubscriptionsVerifyResult>;
