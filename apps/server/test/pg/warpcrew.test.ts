// Warp Crew's legacy server tests (apps/warpcrew/server/test/server.test.js), replayed against the
// core server running the warpcrew game config with real Jest HS256 verification. Each block
// names the legacy behaviour it keeps; where the core answers differently (200 + outcome instead
// of 400, deepest-wins instead of baseSeq-wins), the comment says so (ADR-035, ADR-006).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mintPlayerToken, randomSecretB64, signHs256 } from '@foundation/testkit';
import { setupHarness, saveBody, T0, type Harness } from './harness.ts';
import { warpcrewGame } from '../../games/warpcrew/game.config.ts';
import { warpcrewPolicy } from '../../games/warpcrew/policy.ts';
import type { GameConfig } from '@foundation/server';

const GAME = 'game-warp-crew';
const SECRET = randomSecretB64();

async function warpcrew(prefix: string, purchases: GameConfig['purchases']): Promise<Harness> {
  return setupHarness({
    prefix,
    game: { ...warpcrewGame, gameId: GAME, purchases },
    policy: warpcrewPolicy,
    config: {
      gameId: GAME,
      identityProvider: 'jest',
      paymentsProvider: 'jest',
      jestSecrets: [SECRET],
    },
  });
}

let off: Harness; // as shipped: minting off
let on: Harness; // paid delivery on, sandbox off
let sandbox: Harness; // paid and sandbox delivery on
beforeAll(async () => {
  off = await warpcrew('wc_off', { mintPremium: 'off' });
  on = await warpcrew('wc_on', { mintPremium: 'on' });
  sandbox = await warpcrew('wc_sbx', { mintPremium: 'on', mintSandbox: 'on' });
});
afterAll(async () => {
  await off?.close();
  await on?.close();
  await sandbox?.close();
});

const token = (player: string, o: { iatMs?: number; aud?: string; secret?: string } = {}) =>
  mintPlayerToken({
    playerId: player,
    gameId: o.aud ?? GAME,
    secretB64: o.secret ?? SECRET,
    nowMs: o.iatMs ?? T0,
    registered: true,
  });
const headers = (player: string, bearer = token(player)) => ({
  'x-player-key': player,
  authorization: `Bearer ${bearer}`,
});
const get = (h: Harness, player: string, url: string) =>
  h.inject({ method: 'GET', url, headers: headers(player) });
const post = (h: Harness, player: string, url: string, body: object) =>
  h.inject({ method: 'POST', url, headers: headers(player), payload: body });

interface Purchase {
  token: string;
  sku: string;
  price?: number;
  sandbox?: true;
}
const purchase = (p: Purchase) => ({
  purchaseToken: p.token,
  productSku: p.sku,
  createdAt: T0,
  completedAt: null,
  price: p.price ?? 4.99,
  currency: 'USD',
  ...(p.sandbox ? { sandbox: true } : {}),
});
const receipt = (
  player: string,
  p: Purchase,
  o: { aud?: string; alg?: string; secret?: string } = {},
) =>
  signHs256({ aud: o.aud ?? GAME, sub: player, purchase: purchase(p) }, o.secret ?? SECRET, {
    alg: o.alg ?? 'HS256',
    typ: 'JWT',
  });
const verify = (h: Harness, player: string, purchaseSigned: string) =>
  post(h, player, '/v1/purchases/verify', { commandId: randomUUID(), purchaseSigned });
const buy = (h: Harness, player: string, p: Purchase) => verify(h, player, receipt(player, p));
const owned = async (h: Harness, player: string) =>
  ((await get(h, player, '/v1/purchases/owned')).json() as { oneTime: string[] }).oneTime;
const pending = async (h: Harness, player: string) =>
  (
    (await get(h, player, '/v1/grants/pending')).json() as {
      grants: { grantKey: string; rewards: unknown[] }[];
    }
  ).grants;

/** A Warp Crew player as the client codec writes it. */
const player = (
  stats: { jumps?: number; combatsWon?: number; expeditions?: number; contractsCompleted?: number },
  extra: Record<string, unknown> = {},
) => ({
  version: 9,
  captainName: 'Vex',
  wallet: { credits: 80, fuel: 6, gems: 0, medals: 0, reputation: 0 },
  stats: { jumps: 0, combatsWon: 0, expeditions: 0, contractsCompleted: 0, ...stats },
  ...extra,
});
const depth = (s: Parameters<typeof player>[0]) =>
  (s.jumps ?? 0) + (s.combatsWon ?? 0) + (s.expeditions ?? 0) + (s.contractsCompleted ?? 0);
const DEVICE_A = '0f8c1a52-4a3e-4c55-9d2e-1b7f0e6a9c01';
const DEVICE_B = '7d2e9b14-6c0f-4f8a-b3d1-5e4a2c9f8b02';
const write = (
  h: Harness,
  who: string,
  o: {
    stats: Parameters<typeof player>[0];
    session: string;
    baseSeq: number;
    clientSeq?: number;
    progress?: number;
    version?: number;
    blob?: string;
  },
) =>
  h.inject({
    method: 'PUT',
    url: '/v1/saves',
    headers: headers(who),
    payload: saveBody({
      sessionId: o.session,
      baseSeq: o.baseSeq,
      clientSeq: o.clientSeq ?? o.baseSeq + 1,
      progress: o.progress ?? depth(o.stats),
      schemaVersion: o.version ?? 9,
      blob:
        o.blob ??
        JSON.stringify({
          schemaVersion: o.version ?? 9,
          state: player(o.stats, o.version ? { version: o.version } : {}),
        }),
    }),
  });

describe('identity is required and verified (legacy: identity is required and verified)', () => {
  it('refuses a missing, forged, foreign, other-player or stale token', async () => {
    const url = '/v1/saves/current';
    const no = await off.inject({ method: 'GET', url });
    expect(no.statusCode).toBe(401);
    const forged = token('pilot1').replace(/.$/, 'A');
    const reasons = async (h: Record<string, string>) => {
      const r = await off.inject({ method: 'GET', url, headers: h });
      expect(r.statusCode).toBe(401);
      return (r.json() as { details?: { reason?: string } }).details?.reason;
    };
    expect(await reasons(headers('pilot1', 'nope'))).toBe('malformed');
    expect(await reasons(headers('pilot1', forged))).toBe('bad_signature');
    expect(await reasons(headers('pilot1', token('pilot1', { aud: 'another-game' })))).toBe(
      'wrong_audience',
    );
    expect(await reasons(headers('pilot2', token('pilot1')))).toBe('sub_mismatch');
    expect(await reasons(headers('pilot1', token('pilot1', { iatMs: T0 - 25 * 3_600_000 })))).toBe(
      'stale',
    );
    expect((await get(off, 'pilot1', url)).statusCode).toBe(200);
  });
});

describe('saves: append-only, server sequence, deepest save kept (legacy: insert-only saves)', () => {
  it('assigns seq on the server, keeps refused writes, and a conflict keeps the deeper save', async () => {
    const a1 = (
      await write(off, 'saver', { stats: { jumps: 4 }, session: DEVICE_A, baseSeq: 0 })
    ).json();
    expect(a1).toMatchObject({ disposition: 'anchored', seq: 1, currentProgress: 4 });
    // The client repeating its own clientSeq never chooses the server's sequence.
    const a2 = (
      await write(off, 'saver', {
        stats: { jumps: 9, contractsCompleted: 3 },
        session: DEVICE_A,
        baseSeq: 1,
        clientSeq: 1,
      })
    ).json();
    expect(a2).toMatchObject({ disposition: 'anchored', seq: 2, currentProgress: 12 });

    // Device B never synced and is shallower: stored (never dropped), refused, never current.
    // (Legacy refused any stale base as `stale_base`; the core refuses only a shallower one.)
    const b1 = (
      await write(off, 'saver', { stats: { jumps: 2 }, session: DEVICE_B, baseSeq: 0 })
    ).json();
    expect(b1).toMatchObject({
      disposition: 'stored_refused',
      reason: 'progress_regression',
      seq: 3,
      currentProgress: 12,
      divergent: { headSeq: 2, headSessionId: DEVICE_A },
    });
    const current = (await get(off, 'saver', '/v1/saves/current')).json() as {
      snapshot: { seq: number; progress: number };
      blob: string;
    };
    expect(current.snapshot).toMatchObject({ seq: 2, progress: 12 });
    expect(JSON.parse(current.blob).state.stats.contractsCompleted).toBe(3);
    const kept = await off.root<{ disposition: string; n: number }[]>`
      SELECT s.disposition, (SELECT count(*)::int FROM save_blobs b WHERE b.save_id = s.id) AS n
      FROM save_snapshots s WHERE s.player_key = 'saver' AND s.seq = 3`;
    expect(kept).toEqual([{ disposition: 'stored_refused', n: 1 }]);

    // Device B played deeper: the deeper save wins even from a stale base, and says so.
    const b2 = (
      await write(off, 'saver', {
        stats: { jumps: 15, combatsWon: 2 },
        session: DEVICE_B,
        baseSeq: 0,
      })
    ).json();
    expect(b2).toMatchObject({
      disposition: 'anchored',
      seq: 4,
      currentProgress: 17,
      divergent: { headSeq: 2 },
    });
    // Device A, now shallower than the anchor, is refused until it reconciles.
    const a3 = (
      await write(off, 'saver', {
        stats: { jumps: 10, contractsCompleted: 3 },
        session: DEVICE_A,
        baseSeq: 2,
      })
    ).json();
    expect(a3).toMatchObject({ disposition: 'stored_refused', reason: 'progress_regression' });
    expect(
      ((await get(off, 'saver', '/v1/saves/current')).json() as { snapshot: { seq: number } })
        .snapshot.seq,
    ).toBe(4);
  });

  it('refuses a malformed save, quarantines a future schema or an inflated progress claim', async () => {
    await write(off, 'shapes', { stats: { jumps: 3 }, session: DEVICE_A, baseSeq: 0 });
    const bad = (
      await write(off, 'shapes', {
        stats: { jumps: 4 },
        session: DEVICE_A,
        baseSeq: 1,
        blob: JSON.stringify({ player: {} }),
      })
    ).json();
    expect(bad).toMatchObject({ disposition: 'stored_refused', reason: 'malformed' });
    const future = (
      await write(off, 'shapes', {
        stats: { jumps: 5 },
        session: DEVICE_A,
        baseSeq: 1,
        version: 10,
      })
    ).json();
    expect(future.disposition).toBe('stored_quarantined');
    expect(future.flags).toContain('schema_unknown');
    const inflated = (
      await write(off, 'shapes', {
        stats: { jumps: 6 },
        session: DEVICE_A,
        baseSeq: 1,
        progress: 50,
      })
    ).json();
    expect(inflated.disposition).toBe('stored_quarantined');
    expect(inflated.flags).toContain('implausible_summary');
    expect(
      ((await get(off, 'shapes', '/v1/saves/current')).json() as { snapshot: { seq: number } })
        .snapshot.seq,
    ).toBe(1);
    // A legacy-wrapped save ({player, savedAt}) is still read.
    const legacy = (
      await write(off, 'shapes', {
        stats: { jumps: 7 },
        session: DEVICE_A,
        baseSeq: 1,
        blob: JSON.stringify({ player: player({ jumps: 7 }), savedAt: T0 }),
      })
    ).json();
    expect(legacy).toMatchObject({ disposition: 'anchored', currentProgress: 7 });
  });

  it('players never see each other’s saves', async () => {
    expect((await get(off, 'someone-else', '/v1/saves/current')).json()).toMatchObject({
      empty: true,
    });
  });
});

describe('purchases with minting off (as shipped, ADR-024)', () => {
  it('a verified paid receipt is withheld, not recorded, and checkout stays closed', async () => {
    const r = (await buy(off, 'buyer', { token: 'off-1', sku: 'wc_gems_m' })).json();
    expect(r).toMatchObject({
      outcome: 'rejected',
      reason: 'delivery_unavailable',
      completion: 'withhold',
    });
    const mine = (await get(off, 'buyer', '/v1/purchases/mine')).json();
    expect(mine).toMatchObject({ purchases: [], checkoutEnabled: false });
  });
  it('a sandbox receipt is recorded, grants nothing and never owns a one-time pack', async () => {
    const r = (
      await buy(off, 'sbx', { token: 'off-s1', sku: 'wc_starter_kit', price: 0, sandbox: true })
    ).json();
    expect(r).toMatchObject({
      outcome: 'recorded',
      completion: 'withhold',
      purchase: { classification: 'sandbox', granted: 0, sandbox: true },
    });
    expect(r.purchase.grantKey).toBeUndefined();
    expect(await owned(off, 'sbx')).toEqual([]);
  });
});

describe('purchases: signed receipt only, idempotent, one-time enforced (legacy purchases test)', () => {
  it('a gem pack grants its gems once; a replay never grants twice', async () => {
    const first = (await buy(on, 'buyer', { token: 'tok-1', sku: 'wc_gems_m' })).json();
    expect(first).toMatchObject({
      purchaseToken: 'tok-1',
      outcome: 'recorded',
      completion: 'ready',
      purchase: { sku: 'wc_gems_m', classification: 'paid', granted: 280 },
    });
    const replay = (await buy(on, 'buyer', { token: 'tok-1', sku: 'wc_gems_m' })).json();
    expect(replay).toMatchObject({ outcome: 'duplicate', purchase: { id: first.purchase.id } });
    const grants = await pending(on, 'buyer');
    expect(grants).toEqual([
      expect.objectContaining({
        grantKey: first.purchase.grantKey,
        rewards: [{ kind: 'premium_currency', amount: 280 }],
      }),
    ]);
  });

  it('receipts cannot be forged, used by another player, come from another game or pick their alg', async () => {
    const forged = receipt('buyer', { token: 'tok-x', sku: 'wc_gems_xxl' }).replace(/.$/, 'A');
    expect((await verify(on, 'buyer', forged)).json()).toMatchObject({
      outcome: 'rejected',
      reason: 'bad_signature',
    });
    // (Legacy answered 403 receipt_player_mismatch; the core records nothing and says sub_mismatch.)
    expect(
      (await verify(on, 'thief', receipt('buyer', { token: 'tok-y', sku: 'wc_gems_s' }))).json(),
    ).toMatchObject({ outcome: 'rejected', reason: 'sub_mismatch', completion: 'withhold' });
    expect(
      (
        await verify(
          on,
          'buyer',
          receipt('buyer', { token: 'tok-z', sku: 'wc_gems_s' }, { aud: 'nope' }),
        )
      ).json(),
    ).toMatchObject({ outcome: 'rejected', reason: 'wrong_audience' });
    expect(
      (
        await verify(
          on,
          'buyer',
          receipt('buyer', { token: 'tok-n', sku: 'wc_gems_s' }, { alg: 'none' }),
        )
      ).json(),
    ).toMatchObject({ outcome: 'rejected', reason: 'bad_alg' });
    const rows = await on.root<{ n: number }[]>`
      SELECT count(*)::int AS n FROM purchase_transactions WHERE provider_token IN ('tok-x', 'tok-y', 'tok-z', 'tok-n')`;
    expect(rows[0]!.n).toBe(0);
  });

  it('the starter kit delivers its bundle once; a second payment is recorded for refund, never granted', async () => {
    const kit = (await buy(on, 'buyer', { token: 'kit-1', sku: 'wc_starter_kit' })).json();
    expect(kit).toMatchObject({
      outcome: 'recorded',
      completion: 'ready',
      purchase: { sku: 'wc_starter_kit', classification: 'paid', granted: 250 },
    });
    const grant = (await pending(on, 'buyer')).find((g) => g.grantKey === kit.purchase.grantKey);
    expect(grant?.rewards).toEqual([
      { kind: 'soft_currency', currency: 'fuel', amount: 10 },
      { kind: 'premium_currency', amount: 250 },
      { kind: 'soft_currency', currency: 'medals', amount: 50 },
      { kind: 'soft_currency', currency: 'credits', amount: 800 },
    ]);
    expect(await owned(on, 'buyer')).toEqual(['wc_starter_kit']);

    const dup = (await buy(on, 'buyer', { token: 'kit-2', sku: 'wc_starter_kit' })).json();
    expect(dup).toMatchObject({
      outcome: 'recorded',
      // Completes with Jest: nothing will ever be delivered for it; support refunds the row.
      completion: 'ready',
      purchase: { classification: 'paid', granted: 0, duplicateOf: kit.purchase.id },
    });
    expect(dup.purchase.grantKey).toBeUndefined();
    // Replaying the duplicate stays a duplicate that completes.
    expect(
      (await buy(on, 'buyer', { token: 'kit-2', sku: 'wc_starter_kit' })).json(),
    ).toMatchObject({
      outcome: 'duplicate',
      completion: 'ready',
      purchase: { duplicateOf: kit.purchase.id },
    });
    const grants = await on.root<{ n: number }[]>`
      SELECT count(*)::int AS n FROM grants WHERE player_key = 'buyer' AND reason = 'purchase wc_starter_kit'`;
    expect(grants[0]!.n).toBe(1);
    // One-time is per player.
    expect(
      (await buy(on, 'buyer2', { token: 'kit-3', sku: 'wc_starter_kit' })).json(),
    ).toMatchObject({ outcome: 'recorded', purchase: { granted: 250 } });
    // A duplicate payment is not a purchase for spend-based facts; entitlement counts only grants.
    const mine = (await get(on, 'buyer', '/v1/purchases/mine')).json();
    expect(mine.entitlement).toBe(280 + 250);
  });

  it('a wall pack delivers gems, medals, credits, fuel and drydock finishes', async () => {
    const wall = (await buy(on, 'waller', { token: 'w-1', sku: 'wc_wall_crown' })).json();
    expect(wall.purchase).toMatchObject({ granted: 950, packKey: 'wall_crown' });
    const [grant] = await pending(on, 'waller');
    expect(grant!.rewards).toEqual([
      { kind: 'premium_currency', amount: 950 },
      { kind: 'soft_currency', currency: 'medals', amount: 280 },
      { kind: 'soft_currency', currency: 'credits', amount: 12000 },
      { kind: 'soft_currency', currency: 'fuel', amount: 10 },
      { kind: 'item', itemId: 'drydockFinishes', qty: 3 },
    ]);
  });

  it('unknown SKUs are recorded and grant nothing; a sandbox receipt is withheld here', async () => {
    expect((await buy(on, 'buyer', { token: 'tok-u', sku: 'not_a_product' })).json()).toMatchObject(
      {
        outcome: 'recorded',
        completion: 'withhold',
        purchase: { classification: 'unsupported', granted: 0 },
      },
    );
    expect(
      (
        await buy(on, 'buyer', { token: 'tok-s', sku: 'wc_gems_s', price: 0, sandbox: true })
      ).json(),
    ).toMatchObject({
      completion: 'withhold',
      purchase: { classification: 'sandbox', granted: 0 },
    });
  });

  it('a refused sandbox receipt never owns a one-time pack: the real purchase still grants', async () => {
    await buy(on, 'sbx', { token: 'kit-s0', sku: 'wc_starter_kit', price: 0, sandbox: true });
    expect(await owned(on, 'sbx')).toEqual([]);
    expect((await buy(on, 'sbx', { token: 'kit-s1', sku: 'wc_starter_kit' })).json()).toMatchObject(
      { purchase: { granted: 250 } },
    );
    expect(await owned(on, 'sbx')).toEqual(['wc_starter_kit']);
  });

  it('incomplete-purchase batches record every receipt', async () => {
    const page = signHs256(
      {
        aud: GAME,
        sub: 'batcher',
        purchases: [
          purchase({ token: 'b-1', sku: 'wc_gems_s' }),
          purchase({ token: 'b-2', sku: 'wc_wall_spur' }),
        ],
      },
      SECRET,
    );
    const r = (
      await post(on, 'batcher', '/v1/purchases/verify-batch', {
        commandId: randomUUID(),
        purchasesSigned: page,
      })
    ).json();
    expect(r.outcome).toBe('processed');
    expect(r.results.map((x: { purchase: { granted: number } }) => x.purchase.granted)).toEqual([
      100, 300,
    ]);
    expect(await owned(on, 'batcher')).toEqual(['wc_wall_spur']);
  });

  it('concurrent payments for one one-time pack grant exactly once', async () => {
    const racers = await Promise.all(
      ['r-1', 'r-2', 'r-3'].map((t) => buy(on, 'racer', { token: t, sku: 'wc_wall_veil' })),
    );
    const results = racers.map(
      (r) => r.json() as { purchase: { granted: number; duplicateOf?: number } },
    );
    expect(results.filter((r) => r.purchase.granted === 450)).toHaveLength(1);
    expect(results.filter((r) => r.purchase.duplicateOf !== undefined)).toHaveLength(2);
    expect(await owned(on, 'racer')).toEqual(['wc_wall_veil']);
  });

  it('the ledger is never updated in place and the database refuses a second owner row', async () => {
    await expect(
      on.root`UPDATE purchase_transactions SET duplicate_of = NULL WHERE provider_token = 'kit-2'`,
    ).rejects.toThrow(/ledger_fence/);
    await expect(on.root`
      INSERT INTO purchase_transactions
        (provider_token, player_key, sku, pack_key, base_amount, granted, classification, created_at, source, grant_key, one_time)
      VALUES ('forged-owner', 'buyer', 'wc_starter_kit', 'starter_kit', 250, 0, 'paid', now(), 'live_receipt', 'purchase:forged', true)`).rejects.toThrow(
      /purchase_transactions_one_time_once/,
    );
    await expect(on.root`
      INSERT INTO purchase_transactions
        (provider_token, player_key, sku, base_amount, granted, classification, created_at, source, grant_key, duplicate_of)
      VALUES ('forged-dup', 'nobody', 'wc_gems_s', 100, 100, 'paid', now(), 'live_receipt', 'purchase:x', 1)`).rejects.toThrow(
      /purchase_transactions_duplicate_grants_nothing/,
    );
  });

  it('the ownership query needs the player: no answer means no checkout', async () => {
    expect((await on.inject({ method: 'GET', url: '/v1/purchases/owned' })).statusCode).toBe(401);
    expect(await owned(on, 'nobody-yet')).toEqual([]);
  });
});

describe('sandbox delivery on (mintSandbox, ADR-024): delivers, never owns', () => {
  it('sandbox kits deliver the bundle every time and the pack stays unowned until a paid one', async () => {
    for (const t of ['qa-k1', 'qa-k2']) {
      const r = (
        await buy(sandbox, 'qa-tester', {
          token: t,
          sku: 'wc_starter_kit',
          price: 0,
          sandbox: true,
        })
      ).json();
      expect(r).toMatchObject({
        completion: 'ready',
        purchase: { classification: 'sandbox', granted: 250 },
      });
    }
    expect(await owned(sandbox, 'qa-tester')).toEqual([]);
    expect(
      (await buy(sandbox, 'qa-tester', { token: 'qa-k3', sku: 'wc_starter_kit' })).json(),
    ).toMatchObject({ purchase: { classification: 'paid', granted: 250 } });
    expect(await owned(sandbox, 'qa-tester')).toEqual(['wc_starter_kit']);
    const after = (
      await buy(sandbox, 'qa-tester', {
        token: 'qa-k4',
        sku: 'wc_starter_kit',
        price: 0,
        sandbox: true,
      })
    ).json();
    expect(after.purchase).toMatchObject({
      classification: 'sandbox',
      granted: 0,
      duplicateOf: expect.any(Number),
    });
    // Sandbox deliveries never count as paid entitlement.
    expect((await get(sandbox, 'qa-tester', '/v1/purchases/mine')).json().entitlement).toBe(250);
  });
});

describe('subscriptions: signed list only, for this player, recent (legacy subscriptions test)', () => {
  const sub = (status: string, extra: Record<string, unknown> = {}) => ({
    sku: 'wc_sub_commission',
    status,
    trialEligible: false,
    introOffer: null,
    retentionOffer: null,
    price: 999,
    currency: 'USD',
    ...extra,
  });
  const list = (who: string, subs: unknown[], extra: Record<string, unknown> = {}) =>
    signHs256(
      { aud: GAME, sub: who, iat: Math.floor(T0 / 1000), subscriptions: subs, ...extra },
      SECRET,
    );
  const check = (h: Harness, who: string, subscriptionsSigned: string) =>
    post(h, who, '/v1/subscriptions/verify', { commandId: randomUUID(), subscriptionsSigned });

  it('an active signed list is the entitlement; other games’ SKUs are dropped', async () => {
    const r = await check(
      off,
      'subber',
      list('subber', [
        sub('active', { retentionOffer: { price: 599, durationPeriods: 2 } }),
        { sku: 'other_game_sku', status: 'active' },
      ]),
    );
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      outcome: 'verified',
      issuedAt: Math.floor(T0 / 1000) * 1000,
      subscriptions: [
        {
          sku: 'wc_sub_commission',
          active: true,
          status: 'active',
          sandbox: false,
          trialEligible: false,
          retentionOffer: { price: 599, durationPeriods: 2 },
          price: 999,
          currency: 'USD',
          billingPeriod: null,
        },
      ],
    });
  });
  it('a list without the SKU, or with it lapsed, is not entitled', async () => {
    expect((await check(off, 'subber', list('subber', []))).json().subscriptions).toEqual([
      expect.objectContaining({ sku: 'wc_sub_commission', active: false, status: null }),
    ]);
    expect(
      (await check(off, 'subber', list('subber', [sub('expired')]))).json().subscriptions[0],
    ).toMatchObject({ active: false, status: 'expired' });
  });
  it('refuses a list without iat, for another player, forged, foreign or stale', async () => {
    const reason = async (who: string, signed: string) =>
      ((await check(off, who, signed)).json() as { outcome: string; reason?: string }).reason;
    expect(
      await reason(
        'subber',
        signHs256({ aud: GAME, sub: 'subber', subscriptions: [sub('active')] }, SECRET),
      ),
    ).toBe('no_iat');
    expect(await reason('thief', list('subber', [sub('active')]))).toBe('sub_mismatch');
    expect(await reason('subber', list('subber', [sub('active')]).replace(/.$/, 'A'))).toBe(
      'bad_signature',
    );
    expect(await reason('subber', list('subber', [sub('active')], { aud: 'nope' }))).toBe(
      'wrong_audience',
    );
    const old = list('subber', [sub('active')], { iat: Math.floor((T0 - 25 * 3_600_000) / 1000) });
    expect(await reason('subber', old)).toBe('stale');
  });
  it('the checkout proof (`subscription`) works too', async () => {
    const single = signHs256(
      { aud: GAME, sub: 'subber', iat: Math.floor(T0 / 1000), subscription: sub('active') },
      SECRET,
    );
    expect((await check(off, 'subber', single)).json().subscriptions[0].active).toBe(true);
  });
  it('sandbox subscriptions are active only behind the sandbox gate', async () => {
    const signed = list('subber', [sub('active', { sandbox: true })]);
    expect((await check(off, 'subber', signed)).json().subscriptions[0]).toMatchObject({
      active: false,
      sandbox: true,
    });
    expect((await check(sandbox, 'subber', signed)).json().subscriptions[0]).toMatchObject({
      active: true,
      sandbox: true,
    });
  });
  it('stores nothing', async () => {
    const rows = await off.root<{ n: number }[]>`
      SELECT (SELECT count(*) FROM purchase_transactions WHERE player_key = 'subber')::int
           + (SELECT count(*) FROM grants WHERE player_key = 'subber')::int
           + (SELECT count(*) FROM commands WHERE scope_key = 'subber')::int AS n`;
    expect(rows[0]!.n).toBe(0);
  });
});

describe('misconfiguration fails closed (legacy: no secret)', () => {
  it('without a Jest secret no request authenticates', async () => {
    const h = await setupHarness({
      prefix: 'wc_nosecret',
      game: { ...warpcrewGame, gameId: GAME },
      policy: warpcrewPolicy,
      config: { gameId: GAME, identityProvider: 'mock', paymentsProvider: 'jest', jestSecrets: [] },
    });
    try {
      const r = await h.inject({
        method: 'POST',
        url: '/v1/subscriptions/verify',
        headers: h.playerHeaders('pilot1'),
        payload: { commandId: randomUUID(), subscriptionsSigned: 'a.b.c' },
      });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ error: 'not_configured' });
    } finally {
      await h.close();
    }
  });
});
