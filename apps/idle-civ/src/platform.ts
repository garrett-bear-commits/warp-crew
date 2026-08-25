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
import type { RuntimeConfig } from './runtime-config.ts';

export function createPlatform(cfg: RuntimeConfig, clock: Clock): PlatformAdapter {
  switch (cfg.platform) {
    case 'jest':
      return createJestPlatform({ now: clock.now });
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
          now: () => clock.now(),
          sandboxPurchases: true,
          products: [],
        },
      );
      return {
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
    }
  }
}
