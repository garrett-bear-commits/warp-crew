// purchases contract entry (isomorphic): types + closed enums re-exported from @foundation/contracts.
export type {
  PurchaseVerifyBody,
  PurchaseVerifyResult,
  PurchaseBatchVerifyBody,
  PurchaseBatchVerifyResult,
  PurchaseVerification,
  PurchasesMineResponse,
  PurchasesOwnedResponse,
  AdjustmentsAckBody,
  AdjustmentsAckResult,
  PurchaseRecord,
  PurchaseAdjustment,
} from '@foundation/contracts';
export { PURCHASE_CLASSIFICATIONS, type PurchaseClassification } from '@foundation/contracts/enums';
