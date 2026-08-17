// purchases client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type {
  PurchaseVerifyBody,
  PurchaseVerifyResult,
  PurchasesMineResponse,
  AdjustmentsAckBody,
  AdjustmentsAckResult,
} from '@foundation/contracts';
export function purchasesClient(api: Api) {
  return {
    verify: (body: PurchaseVerifyBody) =>
      api.call<PurchaseVerifyResult>('POST', '/v1/purchases/verify', body),
    mine: () => api.call<PurchasesMineResponse>('GET', '/v1/purchases/mine'),
    ackAdjustments: (body: AdjustmentsAckBody) =>
      api.call<AdjustmentsAckResult>('POST', '/v1/purchases/adjustments/ack', body),
  };
}
