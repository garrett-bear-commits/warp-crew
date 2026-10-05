// A Warp Crew core client wired for node: memory storage, no Web Locks (this tab leads), no
// broadcast channel, memory journal spool, a manual frame scheduler, a still lifecycle and an
// injected clock. `fetch` points it at a server (the end-to-end check) or leaves it offline.
import { createClock, manualScheduler, memorySpool, memoryStorage } from '@foundation/client';
import { createWarpcrew } from '../../src/core/client.js';

export const stillLifecycle = () => ({
  visible: () => true,
  onHide: () => () => {},
  onShow: () => () => {},
  onExitRequested: () => () => {},
  onVisibilityChange: () => () => {},
  onPageHide: () => () => {},
});

/**
 * @param {{ serverUrl?: string | null, playerId?: string, gameId?: string, localStorage?: any,
 *   fetch?: typeof fetch, now?: () => number, sync?: Record<string, number> }} [o]
 */
export function nodeWarpcrew(o = {}) {
  const now = o.now ?? (() => Date.now());
  const clock = createClock({ deviceNow: now, monotonic: now });
  const localStorage = o.localStorage ?? memoryStorage();
  const wc = createWarpcrew({
    config: {
      serverUrl: o.serverUrl ?? null,
      gameId: o.gameId ?? 'warpcrew',
      buildVersion: '1.0.0-test',
      mockPlayerId: o.playerId ?? 'wc-test-player',
      dev: true,
    },
    clock,
    localStorage,
    locks: null,
    channel: null,
    spool: memorySpool(),
    sendBeacon: null,
    requestPersist: false,
    scheduler: manualScheduler(),
    lifecycle: stillLifecycle(),
    reload: () => {},
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.sync ? { sync: o.sync } : {}),
  });
  return { wc, localStorage, clock };
}
