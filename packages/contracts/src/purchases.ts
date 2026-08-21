import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, Response, StringEnum } from './common.ts';
import { PURCHASE_ADJUSTMENT_KINDS, PURCHASE_CLASSIFICATIONS } from './enums.ts';
import { GrantKey } from './grants.ts';

export const PurchaseClassificationSchema = StringEnum(PURCHASE_CLASSIFICATIONS);
export const PurchaseAdjustmentKindSchema = StringEnum(PURCHASE_ADJUSTMENT_KINDS);
export const PurchaseCompletionSchema = StringEnum(['ready', 'withhold'] as const);

/** POST /v1/purchases/verify {commandId, purchaseSigned} — the signed receipt is the only input (§1, ADR-007). */
export const PurchaseVerifyBody = Mutation(
  {
    purchaseSigned: Type.String({ minLength: 1, maxLength: 16384 }),
  },
  { $id: 'PurchaseVerifyBody' },
);
export type PurchaseVerifyBody = Static<typeof PurchaseVerifyBody>;

export const PurchaseRecord = Type.Object(
  {
    id: NonNegInt,
    sku: Type.String(),
    packKey: Type.Optional(Type.String()),
    classification: PurchaseClassificationSchema,
    /** Premium value granted (0 unless classification=paid and minting enabled). */
    granted: NonNegInt,
    /** Grant key created for this purchase, when a grant was minted. */
    grantKey: Type.Optional(GrantKey),
    price: Type.Optional(Type.Number()),
    currency: Type.Optional(Type.String()),
    /** Signed sandbox provenance; null only for legacy/imported rows where it was not retained. */
    sandbox: Type.Union([Type.Boolean(), Type.Null()]),
    createdAt: EpochMs,
    completedAt: Type.Union([EpochMs, Type.Null()]),
    recordedAt: EpochMs,
  },
  { $id: 'PurchaseRecord' },
);
export type PurchaseRecord = Static<typeof PurchaseRecord>;

export const PurchaseVerifyResult = Response(
  {
    /** Verified provider token; present for recorded/duplicate results and authoritative for completion. */
    purchaseToken: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    outcome: StringEnum(['recorded', 'duplicate', 'rejected'] as const),
    reason: Type.Optional(Type.String()),
    purchase: Type.Optional(PurchaseRecord),
    completion: PurchaseCompletionSchema,
  },
  { $id: 'PurchaseVerifyResult' },
);
export type PurchaseVerifyResult = Static<typeof PurchaseVerifyResult>;

/** POST /v1/purchases/verify-batch — verifies the signed recovery page as one atomic command. */
export const PurchaseBatchVerifyBody = Mutation(
  {
    purchasesSigned: Type.String({ minLength: 1, maxLength: 131072 }),
  },
  { $id: 'PurchaseBatchVerifyBody' },
);
export type PurchaseBatchVerifyBody = Static<typeof PurchaseBatchVerifyBody>;

export const PurchaseVerification = Type.Object(
  {
    purchaseToken: Type.String({ minLength: 1, maxLength: 2048 }),
    outcome: StringEnum(['recorded', 'duplicate', 'rejected'] as const),
    reason: Type.Optional(Type.String()),
    purchase: Type.Optional(PurchaseRecord),
    completion: PurchaseCompletionSchema,
  },
  { $id: 'PurchaseVerification' },
);
export type PurchaseVerification = Static<typeof PurchaseVerification>;

export const PurchaseBatchVerifyResult = Response(
  {
    outcome: StringEnum(['processed', 'rejected'] as const),
    reason: Type.Optional(Type.String()),
    results: Type.Array(PurchaseVerification, { maxItems: 50 }),
  },
  { $id: 'PurchaseBatchVerifyResult' },
);
export type PurchaseBatchVerifyResult = Static<typeof PurchaseBatchVerifyResult>;

export const PurchaseAdjustment = Type.Object(
  {
    id: NonNegInt,
    kind: PurchaseAdjustmentKindSchema,
    /** Signed premium delta: negative for refunds. Negative adjustments always reference an admin action. */
    delta: Type.Integer(),
    reason: Type.String(),
    adminActionId: Type.Optional(NonNegInt),
    transactionId: Type.Optional(NonNegInt),
    recordedAt: EpochMs,
    acked: Type.Boolean(),
  },
  { $id: 'PurchaseAdjustment' },
);
export type PurchaseAdjustment = Static<typeof PurchaseAdjustment>;

/** GET /v1/purchases/mine */
export const PurchasesMineResponse = Response(
  {
    purchases: Type.Array(PurchaseRecord),
    /** Unconditional boot instructions applied before play (§7). */
    pendingAdjustments: Type.Array(PurchaseAdjustment),
    entitlement: NonNegInt,
    purchasesDisabled: Type.Boolean(),
    /** This player may start checkout: delivery is ready and purchase verification is not paused. */
    checkoutEnabled: Type.Boolean(),
  },
  { $id: 'PurchasesMineResponse' },
);
export type PurchasesMineResponse = Static<typeof PurchasesMineResponse>;

/** POST /v1/purchases/adjustments/ack {commandId, adjustmentIds[]} */
export const AdjustmentsAckBody = Mutation(
  {
    adjustmentIds: Type.Array(NonNegInt, { minItems: 1, maxItems: 100 }),
  },
  { $id: 'AdjustmentsAckBody' },
);
export type AdjustmentsAckBody = Static<typeof AdjustmentsAckBody>;

export const AdjustmentsAckResult = Response(
  { acked: Type.Array(NonNegInt) },
  { $id: 'AdjustmentsAckResult' },
);
export type AdjustmentsAckResult = Static<typeof AdjustmentsAckResult>;
