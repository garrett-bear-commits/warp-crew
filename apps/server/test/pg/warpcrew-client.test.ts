// End to end: the Warp Crew client (apps/warpcrew/src/core, the same modules the browser runs)
// against the core server with the warpcrew game config on real Postgres, mock identity and mock
// payments, minting off as shipped. The client's fetch is routed into the server (app.inject), so
// every request goes through the real routes, auth, policy and database.
//
// Covered: a new player saves and the server holds it; a reload keeps it; a new device restores it
// from the server; a second device with a deeper save wins (a clean device adopts it, a dirty one
// is asked and the server never takes the shallower save); a sandbox purchase is refused while
// minting is off and grants nothing; a one-time pack asks the ownership query before checkout.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, type Harness } from './harness.ts';
import { warpcrewGame } from '../../games/warpcrew/game.config.ts';
import { warpcrewPolicy } from '../../games/warpcrew/policy.ts';

const GAME = 'warpcrew';
const SERVER = 'http://warpcrew.test';

interface WarpcrewPlayer {
  captainName: string;
  wallet: Record<string, number>;
  stats: Record<string, number>;
  oneTimePurchases?: string[];
}
interface Wc {
  boot(o?: { fresh?: boolean; onBootState?: (s: { phase: string }) => void }): Promise<{
    decision: { action: string; reason: string };
  }>;
  commit(p: WarpcrewPlayer, reason?: string, priority?: string): boolean;
  save(priority?: string): Promise<void>;
  state(): WarpcrewPlayer;
  progress(): number;
  purchases: {
    buy(sku: string): Promise<{ ok: boolean; reason?: string }>;
    refreshOwned(): Promise<{ ok: boolean; oneTime: string[] }>;
    claimPending(): Promise<{ ok: boolean; claimed: unknown[] }>;
  };
  platform: { payments: { begin(sku: string): Promise<unknown> } };
  client: {
    destroy(): void;
    bootMachine: { resolvePrompt(c: 'keep_local' | 'adopt_remote'): void };
    sync: { status(): { kind: string } };
  };
}
interface Helper {
  nodeWarpcrew(o: {
    serverUrl: string;
    playerId: string;
    gameId: string;
    fetch: typeof fetch;
    now: () => number;
    localStorage?: unknown;
  }): { wc: Wc; localStorage: unknown };
}
interface ClientPkg {
  memoryStorage(): unknown;
}

let h: Harness;
let helper: Helper;
let pkg: ClientPkg;
const requests: string[] = [];

/** fetch → app.inject, so the client talks to the real routes without a socket. */
const injectFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const method = (init?.method ?? 'GET') as 'GET' | 'POST' | 'PUT';
  requests.push(`${method} ${url.pathname}`);
  const res = await h.inject({
    method,
    url: url.pathname + url.search,
    headers: (init?.headers ?? {}) as Record<string, string>,
    ...(init?.body !== undefined ? { payload: init.body as string } : {}),
  });
  return new Response(res.statusCode === 204 ? null : res.payload, {
    status: res.statusCode,
    headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') },
  });
};

beforeAll(async () => {
  h = await setupHarness({
    prefix: 'wc_client',
    game: { ...warpcrewGame, gameId: GAME, purchases: { mintPremium: 'off' } },
    policy: warpcrewPolicy,
    config: { gameId: GAME, identityProvider: 'mock', paymentsProvider: 'mock' },
  });
  helper = (await import(
    new URL('../../../warpcrew/test/helpers/coreClient.mjs', import.meta.url).href
  )) as Helper;
  pkg = (await import(
    new URL('../../../warpcrew/node_modules/@foundation/client/src/index.ts', import.meta.url).href
  )) as ClientPkg;
});
afterAll(async () => {
  await h?.close();
});

const device = (playerId: string, localStorage?: unknown) =>
  helper.nodeWarpcrew({
    serverUrl: SERVER,
    playerId,
    gameId: GAME,
    fetch: injectFetch,
    now: () => h.clock.now(),
    ...(localStorage ? { localStorage } : {}),
  });

const serverHead = async (playerId: string) => {
  const r = await h.inject({
    method: 'GET',
    url: '/v1/saves/current',
    headers: h.playerHeaders(playerId),
  });
  expect(r.statusCode).toBe(200);
  return r.json() as { snapshot?: { progress: number; seq: number; schemaVersion: number } | null };
};

const play = (wc: Wc, jumps: number, captainName?: string) =>
  wc.commit(
    {
      ...wc.state(),
      ...(captainName ? { captainName } : {}),
      stats: { ...wc.state().stats, jumps },
    },
    'test',
    'immediate',
  );

describe('Warp Crew client on the core server', () => {
  it('a new player saves, a reload keeps it, and a new device restores it from the server', async () => {
    const player = `wc-${h.uuid()}`;
    const storage = pkg.memoryStorage();
    const a = device(player, storage).wc;
    const booted = await a.boot();
    expect(booted.decision.action).toBe('start_new');
    expect(play(a, 3, 'Vex')).toBe(true);
    await a.save('immediate');
    const head = await serverHead(player);
    expect(head.snapshot?.progress).toBe(3);
    expect(head.snapshot?.schemaVersion).toBe(9);
    expect(requests).toContain('PUT /v1/saves');
    a.client.destroy();

    // reload on the same device: the local slot, confirmed by the server head
    const reload = device(player, storage).wc;
    expect((await reload.boot()).decision.action).toBe('keep_local');
    expect(reload.state().captainName).toBe('Vex');
    expect(reload.progress()).toBe(3);
    reload.client.destroy();

    // a new device: nothing local, the server's save is adopted
    const other = device(player).wc;
    expect((await other.boot()).decision).toMatchObject({
      action: 'adopt_remote',
      reason: 'no_local_remote_snapshot',
    });
    expect(other.state().captainName).toBe('Vex');
    expect(other.progress()).toBe(3);
    other.client.destroy();
  });

  it('a second device with a deeper save wins', async () => {
    const player = `wc-${h.uuid()}`;
    const phone = pkg.memoryStorage();
    const tablet = pkg.memoryStorage();
    const a = device(player, phone).wc;
    await a.boot();
    play(a, 2, 'Phone');
    await a.save('immediate');
    a.client.destroy();

    h.clock.advance(60 * 60_000);
    const b = device(player, tablet).wc;
    await b.boot();
    play(b, 8, 'Tablet');
    await b.save('immediate');
    b.client.destroy();
    expect((await serverHead(player)).snapshot?.progress).toBe(8);

    // the phone's copy is clean (acknowledged): the deeper server save is adopted at boot
    const again = device(player, phone).wc;
    expect((await again.boot()).decision).toMatchObject({
      action: 'adopt_remote',
      reason: 'remote_deeper_local_clean',
    });
    expect(again.state().captainName).toBe('Tablet');
    expect(again.progress()).toBe(8);

    // the phone plays on from a stale copy while the tablet moves deeper: the server keeps the
    // deeper save and refuses the shallower one
    h.clock.advance(60 * 60_000);
    const t2 = device(player, tablet).wc;
    await t2.boot();
    play(t2, 12);
    await t2.save('immediate');
    t2.client.destroy();
    play(again, 9);
    await again.save('immediate');
    expect((await serverHead(player)).snapshot?.progress).toBe(12);
    again.client.destroy();

    // next boot on the phone: its unsynced save is shallower, so the player is asked and the
    // deeper save is chosen
    const asked: string[] = [];
    const phoneBoot = device(player, phone).wc;
    const decision = await phoneBoot.boot({
      onBootState: (s) => {
        asked.push(s.phase);
        if (s.phase === 'prompt')
          queueMicrotask(() => phoneBoot.client.bootMachine.resolvePrompt('adopt_remote'));
      },
    });
    expect(asked).toContain('prompt');
    expect(decision.decision).toMatchObject({
      action: 'prompt',
      reason: 'remote_deeper_local_dirty',
    });
    expect(phoneBoot.progress()).toBe(12);
    phoneBoot.client.destroy();
  });

  it('a sandbox purchase is refused with minting off, and one-time packs ask ownership first', async () => {
    const player = `wc-${h.uuid()}`;
    const { wc } = device(player);
    await wc.boot();
    const gems = wc.state().wallet.gems ?? 0;

    requests.length = 0;
    const gemPack = await wc.purchases.buy('wc_gems_s');
    expect(gemPack.ok).toBe(false);
    // a signed sandbox receipt is recorded, never delivered while minting is off
    expect(gemPack.reason).toBe('withheld');
    expect(requests).toContain('POST /v1/purchases/verify');
    expect(requests).not.toContain('GET /v1/purchases/owned');
    expect(wc.state().wallet.gems ?? 0).toBe(gems);

    requests.length = 0;
    const starter = await wc.purchases.buy('wc_starter_kit');
    expect(starter).toEqual({ ok: false, reason: 'withheld' });
    // the ownership query answers before the checkout opens
    expect(requests.indexOf('GET /v1/purchases/owned')).toBeGreaterThanOrEqual(0);
    expect(requests.indexOf('GET /v1/purchases/owned')).toBeLessThan(
      requests.indexOf('POST /v1/purchases/verify'),
    );
    expect(await wc.purchases.refreshOwned()).toEqual({ ok: true, oneTime: [] });
    expect(wc.state().oneTimePurchases ?? []).toEqual([]);

    // nothing was minted, so nothing waits to be claimed
    expect(await wc.purchases.claimPending()).toEqual({ ok: true, claimed: [] });
    expect(wc.state().wallet.gems ?? 0).toBe(gems);
    wc.client.destroy();
  });
});
