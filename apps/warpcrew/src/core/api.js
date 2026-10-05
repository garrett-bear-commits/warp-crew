// The core API calls Warp Crew makes beside the save sync (which the core client makes itself):
// purchases, grants and subscriptions. One authenticated fetch helper (the core's createApi, with
// `x-player-key` and the platform token) that also feeds every `serverNow` to the clock, so
// trustedNow() is server-anchored while online. Routes mirror
// packages/server/src/features/{purchases,grants,subscriptions}/client.ts.
import { createApi, mintId } from '@foundation/client';

/**
 * @param {{ baseUrl: string, clock: import('@foundation/client').Clock,
 *   auth: () => import('@foundation/client').ClientAuth | null, refreshAuth?: () => Promise<boolean>,
 *   fetch?: typeof fetch }} o
 */
export function createWarpcrewApi(o) {
  const base = createApi({
    baseUrl: o.baseUrl,
    auth: o.auth,
    ...(o.refreshAuth ? { refreshAuth: o.refreshAuth } : {}),
    ...(o.fetch ? { fetch: o.fetch } : {}),
    requestId: mintId,
  });
  /** @type {import('@foundation/client').Api} */
  const api = {
    baseUrl: base.baseUrl,
    async call(method, path, body, opts) {
      const sentAt = o.clock.deviceNow();
      const r = await base.call(method, path, body, opts);
      if (r.ok && r.body && typeof r.body.serverNow === 'number') o.clock.observe(sentAt, o.clock.deviceNow(), r.body.serverNow);
      return r;
    },
  };
  return {
    api,
    purchases: {
      verify: (purchaseSigned) => api.call('POST', '/v1/purchases/verify', { commandId: mintId(), purchaseSigned }),
      verifyBatch: (purchasesSigned) => api.call('POST', '/v1/purchases/verify-batch', { commandId: mintId(), purchasesSigned }),
      /** One-time SKUs this player owns. No answer, no one-time checkout (ADR-035). */
      owned: () => api.call('GET', '/v1/purchases/owned'),
    },
    grants: {
      pending: () => api.call('GET', '/v1/grants/pending'),
      claim: (grantKey) => api.call('POST', '/v1/grants/claim', { commandId: mintId(), grantKey }),
    },
    subscriptions: {
      verify: (subscriptionsSigned) => api.call('POST', '/v1/subscriptions/verify', { commandId: mintId(), subscriptionsSigned }),
    },
  };
}
