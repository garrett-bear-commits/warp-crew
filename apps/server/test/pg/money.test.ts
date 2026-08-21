import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, saveBody, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'money' });
});
afterAll(async () => h?.close());

const post = (
  player: string,
  url: string,
  body: unknown,
  opts: { iatMs?: number; registered?: boolean } = {},
) =>
  h.inject({
    method: 'POST',
    url,
    headers: h.playerHeaders(player, opts),
    payload: body as object,
  });
const admin = (url: string, body: unknown, key = 'full') =>
  h.inject({ method: 'POST', url, headers: h.adminHeaders(key), payload: body as object });

describe('purchases: money is signed facts only (ADR-007, ADR-024)', () => {
  it('signed sandbox receipt is recorded and never mints (schema CHECK); duplicate provider token → duplicate', async () => {
    const receipt = h.receipt({
      playerKey: 'buyer',
      token: 'tok-sandbox-1',
      sku: 'gems_100',
      price: 0,
      currency: 'USD',
      sandbox: true,
    });
    const r = await post('buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: receipt,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      purchaseToken: 'tok-sandbox-1',
      outcome: 'recorded',
      purchase: { sku: 'gems_100', packKey: 'handful', classification: 'sandbox', granted: 0 },
    });
    const again = await post('buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: receipt,
    });
    expect(again.json()).toMatchObject({
      purchaseToken: 'tok-sandbox-1',
      outcome: 'duplicate',
      purchase: { id: r.json().purchase.id },
    });
    await expect(
      h.root`UPDATE purchase_transactions SET granted = 5 WHERE provider_token = 'tok-sandbox-1'`,
    ).rejects.toThrow(/ledger_fence|check constraint/);
    await expect(
      h.root`UPDATE purchase_transactions SET classification = 'paid' WHERE provider_token = 'tok-sandbox-1'`,
    ).rejects.toThrow(/ledger_fence|sandbox_not_paid|check constraint/);
  });
  it('signed sandbox provenance overrides a positive simulator price and withholds completion', async () => {
    const r = await post('simulator-buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'simulator-buyer',
        token: 'tok-simulator-positive',
        sku: 'gems_100',
        price: 4.99,
        currency: 'USD',
        sandbox: true,
      }),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      outcome: 'recorded',
      completion: 'withhold',
      purchase: {
        classification: 'sandbox',
        sandbox: true,
        price: 4.99,
        currency: 'USD',
        granted: 0,
      },
    });
  });
  it('does not infer sandbox or paid value from price without valid signed provenance', async () => {
    const zero = await post('classification-buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'classification-buyer',
        token: 'tok-zero-live',
        sku: 'gems_100',
        price: 0,
        currency: 'USD',
      }),
    });
    expect(zero.json()).toMatchObject({
      completion: 'withhold',
      purchase: { classification: 'unclassified', sandbox: false, granted: 0 },
    });

    const invalidCurrency = await post('classification-buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'classification-buyer',
        token: 'tok-invalid-currency',
        sku: 'gems_100',
        price: 4.99,
        currency: 'ZZZ',
      }),
    });
    expect(invalidCurrency.json()).toMatchObject({
      completion: 'withhold',
      purchase: { classification: 'unclassified', sandbox: false, granted: 0 },
    });

    const unsupportedSandbox = await post('classification-buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'classification-buyer',
        token: 'tok-unsupported-sandbox',
        sku: 'unknown_sku',
        price: 4.99,
        currency: 'USD',
        sandbox: true,
      }),
    });
    expect(unsupportedSandbox.json()).toMatchObject({
      completion: 'withhold',
      purchase: { classification: 'unsupported', sandbox: true, granted: 0 },
    });
  });
  it('keeps legacy sandbox provenance nullable while every new verified receipt writes a boolean', async () => {
    await h.root`
      INSERT INTO purchase_transactions
        (provider_token, player_key, sku, base_amount, granted, classification, created_at, source)
      VALUES
        ('legacy-provenance-token', 'legacy-provenance', 'gems_100', 100, 0, 'unclassified', now(), 'financials_import')`;
    const mine = await h.inject({
      method: 'GET',
      url: '/v1/purchases/mine',
      headers: h.playerHeaders('legacy-provenance'),
    });
    expect(mine.json().purchases).toMatchObject([{ sandbox: null }]);
  });
  it('verifies a signed recovery batch atomically and returns one completion decision per token', async () => {
    const h2 = await setupHarness({
      prefix: 'purchase_batch',
      game: { purchases: { mintPremium: 'on' } },
    });
    try {
      const r = await h2.inject({
        method: 'POST',
        url: '/v1/purchases/verify-batch',
        headers: h2.playerHeaders('batch-buyer'),
        payload: {
          commandId: h2.uuid(),
          purchasesSigned: h2.receiptBatch({
            playerKey: 'batch-buyer',
            purchases: [
              { token: 'batch-paid', sku: 'gems_100', price: 4.99, currency: 'USD' },
              {
                token: 'batch-sandbox',
                sku: 'gems_550',
                price: 4.99,
                currency: 'USD',
                sandbox: true,
              },
            ],
          }),
        },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({
        outcome: 'processed',
        results: [
          {
            purchaseToken: 'batch-paid',
            outcome: 'recorded',
            completion: 'ready',
            purchase: { classification: 'paid', sandbox: false, granted: 200 },
          },
          {
            purchaseToken: 'batch-sandbox',
            outcome: 'recorded',
            completion: 'withhold',
            purchase: { classification: 'sandbox', sandbox: true, granted: 0 },
          },
        ],
      });
    } finally {
      await h2.close();
    }
  });
  it('deduplicates repeated tokens in one signed batch and preserves provider-token idempotency', async () => {
    const h2 = await setupHarness({
      prefix: 'purchase_batch_dup',
      game: { purchases: { mintPremium: 'on' } },
    });
    try {
      const purchasesSigned = h2.receiptBatch({
        playerKey: 'batch-duplicate',
        purchases: [
          { token: 'same-token', sku: 'gems_100', price: 4.99, currency: 'USD' },
          { token: 'same-token', sku: 'gems_100', price: 4.99, currency: 'USD' },
        ],
      });
      const commandId = h2.uuid();
      const send = (id: string) =>
        h2.inject({
          method: 'POST',
          url: '/v1/purchases/verify-batch',
          headers: h2.playerHeaders('batch-duplicate'),
          payload: { commandId: id, purchasesSigned },
        });

      const first = await send(commandId);
      expect(first.json().results).toMatchObject([
        { purchaseToken: 'same-token', outcome: 'recorded', completion: 'ready' },
      ]);
      const sameCommandReplay = await send(commandId);
      expect(sameCommandReplay.json().results).toEqual(first.json().results);
      const newCommandReplay = await send(h2.uuid());
      expect(newCommandReplay.json().results).toMatchObject([
        { purchaseToken: 'same-token', outcome: 'duplicate', completion: 'ready' },
      ]);

      const mine = await h2.inject({
        method: 'GET',
        url: '/v1/purchases/mine',
        headers: h2.playerHeaders('batch-duplicate'),
      });
      expect(mine.json().purchases).toHaveLength(1);
      expect(mine.json().entitlement).toBe(200);
    } finally {
      await h2.close();
    }
  });

  it('returns per-token duplicate/recorded results for a mixed recovery page', async () => {
    const playerKey = 'batch-mixed';
    await post(playerKey, '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey,
        token: 'mixed-existing',
        sku: 'gems_100',
        price: 4.99,
        currency: 'USD',
      }),
    });

    const batch = await h.inject({
      method: 'POST',
      url: '/v1/purchases/verify-batch',
      headers: h.playerHeaders(playerKey),
      payload: {
        commandId: h.uuid(),
        purchasesSigned: h.receiptBatch({
          playerKey,
          purchases: [
            { token: 'mixed-existing', sku: 'gems_100', price: 4.99, currency: 'USD' },
            { token: 'mixed-new', sku: 'gems_550', price: 4.99, currency: 'USD' },
          ],
        }),
      },
    });
    expect(batch.json()).toMatchObject({
      outcome: 'processed',
      results: [
        { purchaseToken: 'mixed-existing', outcome: 'duplicate', completion: 'withhold' },
        { purchaseToken: 'mixed-new', outcome: 'recorded', completion: 'withhold' },
      ],
    });
  });

  it('sorts batch token locks so cross-player races cannot split ownership', async () => {
    const h2 = await setupHarness({ prefix: 'purchase_batch_race' });
    try {
      const send = (playerKey: string, tokens: string[]) =>
        h2.inject({
          method: 'POST',
          url: '/v1/purchases/verify-batch',
          headers: h2.playerHeaders(playerKey),
          payload: {
            commandId: h2.uuid(),
            purchasesSigned: h2.receiptBatch({
              playerKey,
              purchases: tokens.map((token) => ({
                token,
                sku: 'gems_100',
                price: 0,
                currency: 'USD',
                sandbox: true as const,
              })),
            }),
          },
        });
      const [a, b] = await Promise.all([
        send('batch-racer-a', ['race-token-a', 'race-token-b']),
        send('batch-racer-b', ['race-token-b', 'race-token-a']),
      ]);
      const outcomes = [a.json(), b.json()].map((body) =>
        body.results.map((result: { outcome: string }) => result.outcome),
      );
      expect(outcomes).toContainEqual(['recorded', 'recorded']);
      expect(outcomes).toContainEqual(['rejected', 'rejected']);
    } finally {
      await h2.close();
    }
  });
  it('requires a fresh step-up identity token for direct and batch purchase verification', async () => {
    const staleHeaders = h.playerHeaders('step-up-buyer', {
      iatMs: h.clock.now() - 10 * 60_000,
    });
    const direct = await h.inject({
      method: 'POST',
      url: '/v1/purchases/verify',
      headers: staleHeaders,
      payload: {
        commandId: h.uuid(),
        purchaseSigned: h.receipt({
          playerKey: 'step-up-buyer',
          token: 'step-up-direct',
          sku: 'gems_100',
          price: 4.99,
          currency: 'USD',
        }),
      },
    });
    expect(direct.statusCode).toBe(401);
    expect(direct.json()).toMatchObject({ error: 'unauthorized', details: { stepUp: true } });

    const batch = await h.inject({
      method: 'POST',
      url: '/v1/purchases/verify-batch',
      headers: staleHeaders,
      payload: {
        commandId: h.uuid(),
        purchasesSigned: h.receiptBatch({
          playerKey: 'step-up-buyer',
          purchases: [{ token: 'step-up-batch', sku: 'gems_100', price: 4.99, currency: 'USD' }],
        }),
      },
    });
    expect(batch.statusCode).toBe(401);
    expect(batch.json()).toMatchObject({ error: 'unauthorized', details: { stepUp: true } });
  });
  it('rejects an unsafe signed batch before recording any durable row', async () => {
    const playerKey = 'batch-rollback';
    const failed = await h.inject({
      method: 'POST',
      url: '/v1/purchases/verify-batch',
      headers: h.playerHeaders(playerKey),
      payload: {
        commandId: h.uuid(),
        purchasesSigned: h.receiptBatch({
          playerKey,
          purchases: [
            {
              token: 'batch-before-failure',
              sku: 'gems_100',
              price: 0,
              currency: 'USD',
              sandbox: true,
            },
            {
              token: 'batch-overflow',
              sku: 'gems_100',
              price: 1e20,
              currency: 'USD',
            },
          ],
        }),
      },
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({
      outcome: 'rejected',
      reason: 'malformed_purchase',
      results: [],
    });
    const mine = await h.inject({
      method: 'GET',
      url: '/v1/purchases/mine',
      headers: h.playerHeaders(playerKey),
    });
    expect(mine.json().purchases).toEqual([]);
  });
  it('concurrent duplicate receipt verify (§9): one recorded, the rest duplicate, one ledger row', async () => {
    const receipt = h.receipt({ playerKey: 'racer', token: 'tok-race', sku: 'gems_100', price: 0 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        post('racer', '/v1/purchases/verify', { commandId: h.uuid(), purchaseSigned: receipt }),
      ),
    );
    const outcomes = results.map((r) => r.json().outcome);
    expect(outcomes.filter((o) => o === 'recorded').length).toBe(1);
    expect(outcomes.filter((o) => o === 'duplicate').length).toBe(5);
    const rows =
      await h.root`SELECT count(*)::int AS n FROM purchase_transactions WHERE provider_token = 'tok-race'`;
    expect(rows[0]!.n).toBe(1);
  });
  it('paid receipt with mintPremium=off (default, ADR-024): classified paid, granted 0, no grant minted', async () => {
    const r = await post('buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'buyer',
        token: 'tok-paid-1',
        sku: 'gems_100',
        price: 4.99,
        currency: 'USD',
      }),
    });
    expect(r.json()).toMatchObject({
      outcome: 'recorded',
      completion: 'withhold',
      purchase: { classification: 'paid', granted: 0 },
    });
    expect(r.json().purchase.grantKey).toBeUndefined();
    const grants =
      await h.root`SELECT count(*)::int AS n FROM grants WHERE player_key = 'buyer' AND source = 'purchase'`;
    expect(grants[0]!.n).toBe(0);
  });
  it('receipt without price → unclassified (never paid); unknown SKU → unsupported', async () => {
    const a = await post('buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({ playerKey: 'buyer', token: 'tok-noprice', sku: 'gems_100' }),
    });
    expect(a.json().purchase.classification).toBe('unclassified');
    const b = await post('buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'buyer',
        token: 'tok-unknown',
        sku: 'nope',
        price: 1,
      }),
    });
    expect(b.json().purchase.classification).toBe('unsupported');
  });
  it('bad receipt / wrong audience / other player → rejected with reason (200), nothing recorded', async () => {
    const before = (await h.root`SELECT count(*)::int AS n FROM purchase_transactions`)[0]!.n;
    const bad = await post('buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: 'garbage',
    });
    expect(bad.json()).toMatchObject({ outcome: 'rejected', reason: 'malformed' });
    const aud = await post('buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'buyer',
        token: 'tok-aud',
        sku: 'gems_100',
        price: 1,
        aud: 'other-game',
      }),
    });
    expect(aud.json()).toMatchObject({ outcome: 'rejected', reason: 'wrong_audience' });
    const other = await post('buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'someone-else',
        token: 'tok-other',
        sku: 'gems_100',
        price: 1,
      }),
    });
    expect(other.json()).toMatchObject({ outcome: 'rejected', reason: 'sub_mismatch' });
    const after = (await h.root`SELECT count(*)::int AS n FROM purchase_transactions`)[0]!.n;
    expect(after).toBe(before);
  });
  it('/purchases/mine lists purchases; adjustments are boot instructions acked by the client; refunds strike', async () => {
    const adj = await admin('/admin/v1/purchases/adjustments', {
      commandId: h.uuid(),
      playerKey: 'buyer',
      kind: 'refund',
      delta: -100,
      reason: 'chargeback',
      ticketRef: 'CB-1',
    });
    expect(adj.statusCode).toBe(200);
    const mine = await h.inject({
      method: 'GET',
      url: '/v1/purchases/mine',
      headers: h.playerHeaders('buyer'),
    });
    expect(mine.json().purchases.length).toBe(4);
    expect(mine.json().pendingAdjustments).toHaveLength(1);
    expect(mine.json().pendingAdjustments[0]).toMatchObject({
      kind: 'refund',
      delta: -100,
      acked: false,
      adminActionId: expect.any(Number),
    });
    const ack = await post('buyer', '/v1/purchases/adjustments/ack', {
      commandId: h.uuid(),
      adjustmentIds: [mine.json().pendingAdjustments[0].id],
    });
    expect(ack.json().acked).toEqual([mine.json().pendingAdjustments[0].id]);
    const mine2 = await h.inject({
      method: 'GET',
      url: '/v1/purchases/mine',
      headers: h.playerHeaders('buyer'),
    });
    expect(mine2.json().pendingAdjustments).toHaveLength(0);
    const strikes =
      await h.root`SELECT count(*)::int AS n FROM player_strikes WHERE player_key = 'buyer'`;
    expect(strikes[0]!.n).toBe(1);
    // negative adjustments must reference an admin action (schema CHECK)
    await expect(
      h.root`INSERT INTO purchase_adjustments (player_key, kind, delta, reason, command_id) VALUES ('buyer', 'refund', -5, 'x', gen_random_uuid())`,
    ).rejects.toThrow(/check constraint/);
  });
  it('3 refund strikes auto-disable purchases; purchases_disabled players get 403 purchases_disabled', async () => {
    await admin('/admin/v1/purchases/adjustments', {
      commandId: h.uuid(),
      playerKey: 'buyer',
      kind: 'refund',
      delta: -1,
      reason: 'cb2',
    });
    await admin('/admin/v1/purchases/adjustments', {
      commandId: h.uuid(),
      playerKey: 'buyer',
      kind: 'refund',
      delta: -1,
      reason: 'cb3',
    });
    const r = await post('buyer', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'buyer',
        token: 'tok-blocked',
        sku: 'gems_100',
        price: 1,
      }),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('purchases_disabled');
    const mine = await h.inject({
      method: 'GET',
      url: '/v1/purchases/mine',
      headers: h.playerHeaders('buyer'),
    });
    expect(mine.json().purchasesDisabled).toBe(true);
  });
  it('mintPremium=on mints a purchase grant with the first-purchase multiplier; entitlement flows into a restart', async () => {
    const h2 = await setupHarness({ prefix: 'mint', game: { purchases: { mintPremium: 'on' } } });
    try {
      const r = await h2.inject({
        method: 'POST',
        url: '/v1/purchases/verify',
        headers: h2.playerHeaders('payer'),
        payload: {
          commandId: h2.uuid(),
          purchaseSigned: h2.receipt({
            playerKey: 'payer',
            token: 'tok-p1',
            sku: 'gems_100',
            price: 4.99,
            currency: 'USD',
          }),
        },
      });
      expect(r.json()).toMatchObject({
        outcome: 'recorded',
        completion: 'ready',
        purchase: { classification: 'paid', granted: 200, grantKey: 'purchase:tok-p1' },
      });
      const r2 = await h2.inject({
        method: 'POST',
        url: '/v1/purchases/verify',
        headers: h2.playerHeaders('payer'),
        payload: {
          commandId: h2.uuid(),
          purchaseSigned: h2.receipt({
            playerKey: 'payer',
            token: 'tok-p2',
            sku: 'gems_100',
            price: 4.99,
            currency: 'USD',
          }),
        },
      });
      expect(r2.json().purchase.granted).toBe(100);
      const pending = await h2.inject({
        method: 'GET',
        url: '/v1/grants/pending',
        headers: h2.playerHeaders('payer'),
      });
      expect(
        pending
          .json()
          .grants.map((g: { grantKey: string }) => g.grantKey)
          .sort(),
      ).toEqual(['purchase:tok-p1', 'purchase:tok-p2']);
      const claim = await h2.inject({
        method: 'POST',
        url: '/v1/grants/claim',
        headers: h2.playerHeaders('payer'),
        payload: { commandId: h2.uuid(), grantKey: 'purchase:tok-p1' },
      });
      expect(claim.json()).toMatchObject({
        outcome: 'claimed',
        grant: { rewards: [{ kind: 'premium_currency', amount: 200 }] },
      });
      const restart = await h2.inject({
        method: 'POST',
        url: '/v1/lineage/restart',
        headers: h2.playerHeaders('payer'),
        payload: { commandId: h2.uuid(), restartId: h2.uuid(), expectedGeneration: 0 },
      });
      expect(restart.json()).toMatchObject({ kind: 'restart', entitlement: 300 });
      // sandbox still never mints even with minting on
      const sb = await h2.inject({
        method: 'POST',
        url: '/v1/purchases/verify',
        headers: h2.playerHeaders('payer'),
        payload: {
          commandId: h2.uuid(),
          purchaseSigned: h2.receipt({
            playerKey: 'payer',
            token: 'tok-sb',
            sku: 'gems_100',
            price: 0,
            currency: 'USD',
            sandbox: true,
          }),
        },
      });
      expect(sb.json()).toMatchObject({
        completion: 'withhold',
        purchase: { classification: 'sandbox', sandbox: true, granted: 0 },
      });
    } finally {
      await h2.close();
    }
  });
});

describe('grants: the one reward primitive (ADR-008)', () => {
  it('admin mint → pending → claim → already_claimed; claim requires step-up; grantKey is idempotent', async () => {
    const mint = await admin('/admin/v1/grants', {
      commandId: h.uuid(),
      playerKey: 'gp',
      grantKey: 'admin:T-9:make-good',
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 500 }],
      reason: 'outage make-good',
      ticketRef: 'T-9',
    });
    expect(mint.json()).toMatchObject({ grantKey: 'admin:T-9:make-good', duplicate: false });
    const mintAgain = await admin('/admin/v1/grants', {
      commandId: h.uuid(),
      playerKey: 'gp',
      grantKey: 'admin:T-9:make-good',
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 999 }],
      reason: 'retry',
    });
    expect(mintAgain.json().duplicate).toBe(true);
    const pending = await h.inject({
      method: 'GET',
      url: '/v1/grants/pending',
      headers: h.playerHeaders('gp'),
    });
    expect(pending.json().grants).toHaveLength(1);
    expect(pending.json().grants[0].rewards).toEqual([
      { kind: 'soft_currency', currency: 'gold', amount: 500 },
    ]);
    const old = await post(
      'gp',
      '/v1/grants/claim',
      { commandId: h.uuid(), grantKey: 'admin:T-9:make-good' },
      { iatMs: h.clock.now() - 10 * 60_000 },
    );
    expect(old.statusCode).toBe(401);
    const cid = h.uuid();
    const claim = await post('gp', '/v1/grants/claim', {
      commandId: cid,
      grantKey: 'admin:T-9:make-good',
    });
    expect(claim.json()).toMatchObject({ outcome: 'claimed', duplicate: false });
    const replay = await post('gp', '/v1/grants/claim', {
      commandId: cid,
      grantKey: 'admin:T-9:make-good',
    });
    expect(replay.json()).toMatchObject({ outcome: 'claimed', duplicate: true });
    const again = await post('gp', '/v1/grants/claim', {
      commandId: h.uuid(),
      grantKey: 'admin:T-9:make-good',
    });
    expect(again.json().outcome).toBe('already_claimed');
    const missing = await post('gp', '/v1/grants/claim', { commandId: h.uuid(), grantKey: 'nope' });
    expect(missing.json().outcome).toBe('not_found');
    const readOnly = await admin(
      '/admin/v1/grants',
      {
        commandId: h.uuid(),
        playerKey: 'gp',
        grantKey: 'x',
        rewards: [{ kind: 'cosmetic', cosmeticId: 'c' }],
        reason: 'r',
      },
      'reader',
    );
    expect(readOnly.statusCode).toBe(403);
  });
  it('grants_frozen: claims refuse with frozen until the flag is lifted', async () => {
    await admin('/admin/v1/grants', {
      commandId: h.uuid(),
      playerKey: 'frozen',
      grantKey: 'g1',
      rewards: [{ kind: 'cosmetic', cosmeticId: 'hat' }],
      reason: 'r',
    });
    await admin('/admin/v1/players/flags', {
      commandId: h.uuid(),
      playerKey: 'frozen',
      flag: 'grants_frozen',
      enabled: true,
      reason: 'investigation',
    });
    const r = await post('frozen', '/v1/grants/claim', { commandId: h.uuid(), grantKey: 'g1' });
    expect(r.statusCode).toBe(403);
    await admin('/admin/v1/players/flags', {
      commandId: h.uuid(),
      playerKey: 'frozen',
      flag: 'grants_frozen',
      enabled: false,
      reason: 'cleared',
    });
    const ok = await post('frozen', '/v1/grants/claim', { commandId: h.uuid(), grantKey: 'g1' });
    expect(ok.json().outcome).toBe('claimed');
  });
  it('batch claim', async () => {
    for (const k of ['b1', 'b2'])
      await admin('/admin/v1/grants', {
        commandId: h.uuid(),
        playerKey: 'batch',
        grantKey: k,
        rewards: [{ kind: 'item', itemId: 'potion', qty: 1 }],
        reason: 'r',
      });
    const r = await post('batch', '/v1/grants/claim-batch', {
      commandId: h.uuid(),
      grantKeys: ['b1', 'b2', 'b3'],
    });
    expect(r.json().results).toEqual([
      { grantKey: 'b1', outcome: 'claimed' },
      { grantKey: 'b2', outcome: 'claimed' },
      { grantKey: 'b3', outcome: 'not_found' },
    ]);
  });
  it('code campaign: ≥ 40 bits after normalisation, redeem once per player, registered gate, exhaustion, bad-guess lock', async () => {
    const short = await admin('/admin/v1/codes/campaigns', {
      commandId: h.uuid(),
      campaignId: 'c-short',
      codes: ['abc-1234'],
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 10 }],
      maxRedemptionsPerCode: 5,
      registeredOnly: false,
      reason: 'r',
    });
    expect(short.statusCode).toBe(400);
    const c = await admin('/admin/v1/codes/campaigns', {
      commandId: h.uuid(),
      campaignId: 'welcome',
      codes: ['WELCOME-2026-ABCD', 'summer-2026-wxyz'],
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 10 }],
      maxRedemptionsPerCode: 1,
      registeredOnly: false,
      reason: 'launch',
    });
    expect(c.json()).toMatchObject({ campaignId: 'welcome', codes: 2 });
    const r = await post('coder', '/v1/codes/redeem', {
      commandId: h.uuid(),
      code: 'welcome 2026 abcd',
    });
    expect(r.json()).toMatchObject({
      outcome: 'redeemed',
      grant: { source: 'code', claimedAt: expect.any(Number) },
    });
    const again = await post('coder', '/v1/codes/redeem', {
      commandId: h.uuid(),
      code: 'WELCOME-2026-ABCD',
    });
    expect(again.json().outcome).toBe('already_redeemed');
    const other = await post('coder2', '/v1/codes/redeem', {
      commandId: h.uuid(),
      code: 'WELCOME-2026-ABCD',
    });
    expect(other.json().outcome).toBe('exhausted');
    const invalid = await post('coder2', '/v1/codes/redeem', {
      commandId: h.uuid(),
      code: 'NOPE-NOPE-NOPE',
    });
    expect(invalid.json().outcome).toBe('invalid');
    // registered gate
    await admin('/admin/v1/codes/campaigns', {
      commandId: h.uuid(),
      campaignId: 'vip',
      codes: ['VIP-ONLY-2026-XYZ'],
      rewards: [{ kind: 'cosmetic', cosmeticId: 'crown' }],
      maxRedemptionsPerCode: 100,
      registeredOnly: true,
      reason: 'vip',
    });
    const guest = await post('guest', '/v1/codes/redeem', {
      commandId: h.uuid(),
      code: 'VIP-ONLY-2026-XYZ',
    });
    expect(guest.json().outcome).toBe('registration_required');
    const reg = await post(
      'guest',
      '/v1/codes/redeem',
      { commandId: h.uuid(), code: 'VIP-ONLY-2026-XYZ' },
      { registered: true },
    );
    expect(reg.json().outcome).toBe('redeemed');
    // bad-guess lock per player after 10 wrong guesses in an hour
    for (let i = 0; i < 10; i++) {
      const g = await post('guesser', '/v1/codes/redeem', {
        commandId: h.uuid(),
        code: `WRONG-${i}-XXXXXXXX`,
      });
      expect(g.json().outcome).toBe('invalid');
      h.clock.advance(7_000); // stay under the per-minute rate limit; the bad-guess window is one hour
    }
    const locked = await post('guesser', '/v1/codes/redeem', {
      commandId: h.uuid(),
      code: 'summer-2026-wxyz',
    });
    expect(locked.json().outcome).toBe('locked');
  });
  it('cohort grant: dry-run counts, real run mints once per matched player, idempotent by prefix', async () => {
    // seed players via saves so the players projection has them
    for (const p of ['co1', 'co2', 'co3'])
      await h.inject({
        method: 'PUT',
        url: '/v1/saves',
        headers: h.playerHeaders(p),
        payload: saveBody(
          { progress: p === 'co3' ? 5 : 500 },
          { v: 1, counter: p === 'co3' ? 5 : 500, gold: 1 },
        ),
      });
    await h.root`UPDATE players SET seen_days = 3 WHERE player_key IN ('co1', 'co2')`;
    const predicate = {
      all: [
        { fact: 'seen_days', op: 'gte', value: 3 },
        { fact: 'progress', op: 'gte', value: 100 },
      ],
    };
    const dry = await admin('/admin/v1/grants/cohort', {
      commandId: h.uuid(),
      grantKeyPrefix: 'cohort:comp-1',
      predicate,
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 50 }],
      reason: 'compensation',
      dryRun: true,
    });
    expect(dry.json()).toMatchObject({ matched: 2, minted: 0, dryRun: true });
    const real = await admin('/admin/v1/grants/cohort', {
      commandId: h.uuid(),
      grantKeyPrefix: 'cohort:comp-1',
      predicate,
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 50 }],
      reason: 'compensation',
      dryRun: false,
    });
    expect(real.json()).toMatchObject({ matched: 2, minted: 2 });
    const rerun = await admin('/admin/v1/grants/cohort', {
      commandId: h.uuid(),
      grantKeyPrefix: 'cohort:comp-1',
      predicate,
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 50 }],
      reason: 'compensation',
      dryRun: false,
    });
    expect(rerun.json()).toMatchObject({ matched: 2, minted: 0 });
    const p1 = await h.inject({
      method: 'GET',
      url: '/v1/grants/pending',
      headers: h.playerHeaders('co1'),
    });
    expect(
      p1.json().grants.some((g: { grantKey: string }) => g.grantKey === 'cohort:comp-1:co1'),
    ).toBe(true);
    const p3 = await h.inject({
      method: 'GET',
      url: '/v1/grants/pending',
      headers: h.playerHeaders('co3'),
    });
    expect(p3.json().grants).toHaveLength(0);
  });
});
