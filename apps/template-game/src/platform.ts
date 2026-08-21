// Platform selection (§5.3, ADR-013 "provider switch = one implementation"): mock (dev/e2e — the
// server runs the mock identity/payments verifiers), jest (window.JestSDK), standalone (QA token).
// The mock platform's simulated lifecycle is replaced by the document's real visibility/pagehide
// events so the teardown path (§5.2 beacon) is exercised for real in the browser.
import {
  consoleErrorSink,
  createJestPlatform,
  createMockPlatform,
  createStandalonePlatform,
  documentLifecycle,
  mintMockToken,
  type Clock,
  type PlatformAdapter,
} from '@foundation/client';
import { CATALOG, type GameConfig } from './config.ts';

export function createPlatform(cfg: GameConfig, clock: Clock): PlatformAdapter {
  switch (cfg.platform) {
    case 'jest':
      return createJestPlatform({
        autoLoginReminders: cfg.autoLoginReminders,
        now: clock.now,
      });
    case 'standalone':
      return createStandalonePlatform({
        playerId: cfg.playerId,
        token: cfg.token ?? mintMockToken(cfg.playerId, clock.now(), cfg.registered),
        registered: cfg.registered,
        ...(cfg.token === null
          ? {
              refreshToken: async () => mintMockToken(cfg.playerId, clock.now(), cfg.registered),
            }
          : {}),
      });
    case 'mock': {
      const mock = createMockPlatform(
        {},
        {
          gameId: cfg.gameId,
          playerId: cfg.playerId,
          registered: cfg.registered,
          // tokens are minted on demand with a server-anchored iat (step-up needs iat ≤ 5 min)
          now: () => clock.now(),
          // Local checkout is explicitly signed as sandbox; price is never used as the classifier.
          sandboxPurchases: true,
          products: CATALOG.map((c) => ({ sku: c.sku, title: c.title, price: 0, currency: 'USD' })),
        },
      );
      const platform: PlatformAdapter = {
        name: mock.name,
        identity: mock.identity,
        kv: mock.kv,
        payments: mock.payments,
        notifications: mock.notifications,
        share: mock.share,
        analytics: mock.analytics,
        loading: mock.loading,
        lifecycle: documentLifecycle(),
        entryPayload: mock.entryPayload,
        errors: consoleErrorSink(),
      };
      return platform;
    }
  }
}
