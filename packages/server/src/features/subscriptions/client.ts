// subscriptions client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type { SubscriptionsVerifyBody, SubscriptionsVerifyResult } from '@foundation/contracts';
export function subscriptionsClient(api: Api) {
  return {
    /** Re-read on every boot; a verified entitlement carries `issuedAt` for the offline grace. */
    verify: (body: SubscriptionsVerifyBody) =>
      api.call<SubscriptionsVerifyResult>('POST', '/v1/subscriptions/verify', body),
  };
}
