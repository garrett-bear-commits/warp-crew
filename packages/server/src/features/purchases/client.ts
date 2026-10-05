// purchases client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type {
  PurchaseVerifyBody,
  PurchaseVerifyResult,
  PurchaseBatchVerifyBody,
  PurchaseBatchVerifyResult,
  PurchasesMineResponse,
  PurchasesOwnedResponse,
  AdjustmentsAckBody,
  AdjustmentsAckResult,
} from '@foundation/contracts';
export function purchasesClient(api: Api) {
  return {
    verify: (body: PurchaseVerifyBody) =>
      api.call<PurchaseVerifyResult>('POST', '/v1/purchases/verify', body),
    verifyBatch: (body: PurchaseBatchVerifyBody) =>
      api.call<PurchaseBatchVerifyResult>('POST', '/v1/purchases/verify-batch', body),
    mine: () => api.call<PurchasesMineResponse>('GET', '/v1/purchases/mine'),
    /** One-time SKUs this player owns; when it fails, do not open a one-time checkout (ADR-035). */
    owned: () => api.call<PurchasesOwnedResponse>('GET', '/v1/purchases/owned'),
    ackAdjustments: (body: AdjustmentsAckBody) =>
      api.call<AdjustmentsAckResult>('POST', '/v1/purchases/adjustments/ack', body),
  };
}
