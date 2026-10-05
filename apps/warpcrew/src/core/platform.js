// Platform selection for the core client (the core's PlatformAdapter is the one switch point):
//   jest  inside the Jest shell with a server configured: the core's Jest provider owns identity
//         (signed player token), payments and the KV mirror. It shares Warp Crew's single
//         JestSDK.init (src/shared/platform.js) instead of initialising the SDK a second time.
//   mock  everywhere else (dev, the GitHub Pages QA build, tests): the core's mock provider, exactly
//         as the template game uses it. With no server it never touches the network and its local
//         checkout delivers the products.js grant on the device; with a server (which must run the
//         mock identity and payments verifiers) its tokens and receipts are signed `sandbox: true`.
// Warp Crew's own SDK bridge (src/shared/platform.js) keeps the parts the core does not model:
// loading progress, analytics events, notifications, the registration overlay and subscriptions.
import {
  consoleErrorSink,
  createJestPlatform,
  createMockPlatform,
  documentLifecycle,
} from '@foundation/client';
import { MOCK_PRODUCTS } from '../shared/platform.js';

/**
 * @param {{ kind: 'jest' | 'mock', gameId: string, playerId: string, now: () => number,
 *   sdk?: object | null, sdkInit?: () => Promise<unknown>, localStorage?: unknown,
 *   lifecycle?: import('@foundation/client').LifecycleProvider }} o
 * @returns {import('@foundation/client').PlatformAdapter}
 */
export function createWarpcrewPlatform(o) {
  if (o.kind === 'jest') {
    const sdk = o.sdk ?? globalThis.window?.JestSDK ?? null;
    // One SDK, one init: the core's provider awaits the init Warp Crew already started.
    const shared = sdk && o.sdkInit
      ? new Proxy(sdk, { get: (target, key) => (key === 'init' ? () => o.sdkInit().then(() => undefined) : target[key]) })
      : sdk;
    return createJestPlatform({ sdk: shared, autoLoginReminders: false, now: o.now });
  }
  const mock = createMockPlatform(
    {},
    {
      gameId: o.gameId,
      playerId: o.playerId,
      registered: false,
      now: o.now,
      // The local checkout is explicitly signed sandbox; price never classifies it (ADR-024).
      sandboxPurchases: true,
      products: MOCK_PRODUCTS.map((p) => ({ sku: p.sku, title: p.name, price: p.price, currency: p.currency })),
    },
  );
  return {
    name: mock.name,
    identity: mock.identity,
    kv: mock.kv,
    payments: mock.payments,
    notifications: mock.notifications,
    share: mock.share,
    screenshots: mock.screenshots,
    analytics: mock.analytics,
    loading: mock.loading,
    lifecycle: o.lifecycle ?? documentLifecycle(),
    entryPayload: mock.entryPayload,
    errors: consoleErrorSink(),
  };
}
