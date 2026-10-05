// A whole deterministic world: FakeClock + fake timers + fakeFetch + ServerTruth + mock platform
// + a persistent memory localStorage that survives client "reloads" — the game client is built
// against it with every injectable wired, so flows can be driven step by step.
import { fakeFetch, FakeClock, type FakeFetch } from '@foundation/testkit';
import type { ProviderPathologies } from '../../src/providers/mock.ts';
import { createGameClient, type GameClient, type GameClientConfig } from '../../src/game-client.ts';
import { createMockPlatform } from '../../src/providers/mock.ts';
import { memoryStorage, type StorageLike } from '../../src/storage/tiers.ts';
import { memorySpool } from '../../src/storage/spool.ts';
import {
  boundClock,
  counterCodec,
  counterEngine,
  createFakeTimers,
  type CounterAction,
  type CounterEffect,
  type CounterState,
  type FakeTimers,
} from './fixtures.ts';
import { ServerTruth } from './server-model.ts';

export const START = 1_786_924_800_000;
export const GAME = 'game';

export type World = ReturnType<typeof makeWorld>;
export type Client = GameClient<CounterState, CounterAction, CounterEffect>;

export interface WorldOptions {
  playerId?: string;
  registered?: boolean;
  pathologies?: ProviderPathologies;
  autosaveMs?: number;
  pushMs?: number;
  headCheckMs?: number;
  localStorage?: StorageLike | null;
  maxProgressPerHour?: number;
}

export function makeWorld(o: WorldOptions = {}) {
  const clock = new FakeClock(START);
  const timers: FakeTimers = createFakeTimers(clock);
  const ff: FakeFetch = fakeFetch(clock.now);
  const server = new ServerTruth({
    gameId: GAME,
    now: clock.now,
    ...(o.maxProgressPerHour !== undefined ? { maxProgressPerHour: o.maxProgressPerHour } : {}),
  });
  server.mount(ff);
  const ls: StorageLike | null = o.localStorage === undefined ? memoryStorage() : o.localStorage;
  const beacons: { url: string; body: string }[] = [];
  let reloads = 0;
  const playerId = o.playerId ?? 'guest-1';

  const newClient = (
    over: Partial<GameClientConfig<CounterState, CounterAction, CounterEffect>> = {},
  ) => {
    const platform = createMockPlatform(o.pathologies ?? {}, {
      gameId: GAME,
      playerId,
      ...(o.registered !== undefined ? { registered: o.registered } : {}),
      now: clock.now,
      timers,
    });
    const client = createGameClient<CounterState, CounterAction, CounterEffect>({
      engine: counterEngine(),
      codec: counterCodec,
      platform,
      serverUrl: 'http://api.test',
      gameId: GAME,
      buildVersion: '1.0.0',
      journal: 'errors_only',
      loop: { tps: 10, scheduler: { request: () => null, cancel: () => {} } },
      fetch: ff.fetch,
      localStorage: ls,
      timers,
      clock: boundClock(clock),
      locks: null,
      channel: null,
      reload: () => {
        reloads++;
      },
      sendBeacon: (url, body) => {
        beacons.push({ url, body });
        return true;
      },
      spool: memorySpool(),
      requestPersist: false,
      seed: 1,
      sync: {
        autosaveMs: o.autosaveMs ?? 10_000,
        pushMs: o.pushMs ?? 60_000,
        headCheckMs: o.headCheckMs ?? 800,
      },
      ...over,
    });
    return { client, platform };
  };

  return {
    clock,
    timers,
    ff,
    server,
    ls,
    beacons,
    playerId,
    reloads: () => reloads,
    newClient,
    /** Deliver a beacon body to the server (the browser does this after unload). */
    async deliverBeacons(): Promise<void> {
      for (const b of beacons.splice(0)) {
        await ff.fetch(b.url, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: b.body,
        });
      }
    },
  };
}
