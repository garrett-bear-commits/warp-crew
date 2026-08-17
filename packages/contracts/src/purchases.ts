import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, Response, StringEnum } from './common.ts';
import { PURCHASE_ADJUSTMENT_KINDS, PURCHASE_CLASSIFICATIONS } from './enums.ts';

export const PurchaseClassificationSchema = StringEnum(PURCHASE_CLASSIFICATIONS);
export const PurchaseAdjustmentKindSchema = StringEnum(PURCHASE_ADJUSTMENT_KINDS);

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
    grantKey: Type.Optional(Type.String()),
    price: Type.Optional(Type.Number()),
    currency: Type.Optional(Type.String()),
    createdAt: EpochMs,
    completedAt: Type.Union([EpochMs, Type.Null()]),
    recordedAt: EpochMs,
  },
  { $id: 'PurchaseRecord' },
);
export type PurchaseRecord = Static<typeof PurchaseRecord>;

export const PurchaseVerifyResult = Response(
  {
    outcome: StringEnum(['recorded', 'duplicate', 'rejected'] as const),
    reason: Type.Optional(Type.String()),
    purchase: Type.Optional(PurchaseRecord),
  },
  { $id: 'PurchaseVerifyResult' },
);
export type PurchaseVerifyResult = Static<typeof PurchaseVerifyResult>;

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
