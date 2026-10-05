// grants client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type {
  GrantClaimBody,
  GrantClaimResult,
  GrantClaimBatchBody,
  GrantClaimBatchResult,
  GrantsPendingResponse,
  CodeRedeemBody,
  CodeRedeemResult,
} from '@foundation/contracts';
export function grantsClient(api: Api) {
  return {
    pending: () => api.call<GrantsPendingResponse>('GET', '/v1/grants/pending'),
    claim: (body: GrantClaimBody) => api.call<GrantClaimResult>('POST', '/v1/grants/claim', body),
    claimBatch: (body: GrantClaimBatchBody) =>
      api.call<GrantClaimBatchResult>('POST', '/v1/grants/claim-batch', body),
    redeemCode: (body: CodeRedeemBody) =>
      api.call<CodeRedeemResult>('POST', '/v1/codes/redeem', body),
  };
}
