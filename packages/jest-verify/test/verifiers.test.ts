import { describe, expect, it } from 'vitest';
import { mintPlayerToken, mintReceipt, randomSecretB64, signHs256 } from '@foundation/testkit';
import {
  createJestIdentityVerifier,
  createJestPaymentsVerifier,
  createMockIdentityVerifier,
  createMockPaymentsVerifier,
  identityConformance,
  mintMockReceipt,
  mintMockToken,
  paymentsConformance,
  DEFAULT_TOKEN_MAX_AGE_MS,
  type ConformanceCase,
} from '../src/index.ts';

const GAME = 'template';
const NOW = 1_755_475_200_000;
const secret = randomSecretB64();
const oldSecret = randomSecretB64();
const otherSecret = randomSecretB64();

function runCases(cases: ConformanceCase[]) {
  for (const c of cases) it(c.name, async () => expect(await c.run(), c.name).toBe(true));
}

describe('Jest identity verifier — conformance', () => {
  const v = createJestIdentityVerifier({ secretsB64: [secret, oldSecret] });
  runCases(
    identityConformance(
      v,
      {
        valid: (playerId, iatMs, gameId, registered) =>
          mintPlayerToken({
            playerId,
            gameId,
            secretB64: secret,
            nowMs: iatMs,
            registered: registered ?? false,
          }),
        badSignature: (playerId, iatMs, gameId) =>
          mintPlayerToken({ playerId, gameId, secretB64: otherSecret, nowMs: iatMs }),
        wrongAudience: (playerId, iatMs) =>
          mintPlayerToken({ playerId, gameId: 'other-game', secretB64: secret, nowMs: iatMs }),
        badAlg: (playerId, iatMs, gameId) =>
          mintPlayerToken({ playerId, gameId, secretB64: secret, nowMs: iatMs, alg: 'none' }),
      },
      { gameId: GAME, now: NOW, maxAgeMs: DEFAULT_TOKEN_MAX_AGE_MS },
    ),
  );
  it('accepts a token signed by an older secret in the rotation list and reports its index', () => {
    const r = v.verify(
      mintPlayerToken({ playerId: 'p1', gameId: GAME, secretB64: oldSecret, nowMs: NOW }),
      'p1',
      GAME,
      NOW,
    );
    expect(r.ok && r.player.secretIndex).toBe(1);
  });
  it('no secret configured → no_secret (fail closed, never open)', () => {
    const empty = createJestIdentityVerifier({ secretsB64: [] });
    const r = empty.verify(
      mintPlayerToken({ playerId: 'p1', gameId: GAME, secretB64: secret, nowMs: NOW }),
      'p1',
      GAME,
      NOW,
    );
    expect(r).toEqual({ ok: false, reason: 'no_secret' });
  });
  it('missing aud → wrong_audience (aud is mandatory)', () => {
    const r = v.verify(
      mintPlayerToken({ playerId: 'p1', gameId: GAME, secretB64: secret, nowMs: NOW, aud: null }),
      'p1',
      GAME,
      NOW,
    );
    expect(r).toEqual({ ok: false, reason: 'wrong_audience' });
  });
  it('sub disagreeing with player.playerId → sub_mismatch', () => {
    const r = v.verify(
      mintPlayerToken({ playerId: 'p1', gameId: GAME, secretB64: secret, nowMs: NOW, sub: 'p2' }),
      'p1',
      GAME,
      NOW,
    );
    expect(r).toEqual({ ok: false, reason: 'sub_mismatch' });
  });
  it('iat in milliseconds is tolerated', () => {
    const r = v.verify(
      mintPlayerToken({ playerId: 'p1', gameId: GAME, secretB64: secret, nowMs: NOW, iatSec: NOW }),
      'p1',
      GAME,
      NOW,
    );
    expect(r.ok).toBe(true);
  });
  it('missing iat → malformed', () => {
    const t = signHs256({ player: { playerId: 'p1' }, aud: GAME, sub: 'p1' }, secret);
    expect(v.verify(t, 'p1', GAME, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });
  it('per-game maxTokenAgeSec is honoured', () => {
    const short = createJestIdentityVerifier({ secretsB64: [secret], maxTokenAgeMs: 60_000 });
    const r = short.verify(
      mintPlayerToken({ playerId: 'p1', gameId: GAME, secretB64: secret, nowMs: NOW - 120_000 }),
      'p1',
      GAME,
      NOW,
    );
    expect(r).toEqual({ ok: false, reason: 'stale' });
  });
});

describe('mock identity verifier — same conformance', () => {
  const v = createMockIdentityVerifier();
  runCases(
    identityConformance(
      v,
      {
        valid: (playerId, iatMs, _gameId, registered) => mintMockToken(playerId, iatMs, registered),
        badSignature: () => 'mock.p1.notanumber',
        wrongAudience: (playerId, iatMs) => `mock.${playerId}.${iatMs}.registered.aud`,
      },
      { gameId: GAME, now: NOW, maxAgeMs: DEFAULT_TOKEN_MAX_AGE_MS },
    ).filter((c) => !/bad signature|wrong audience/.test(c.name)),
  );
  it('mock has no signature/audience concept: documents the two skipped cases explicitly', () => {
    // A mock token cannot be forged-vs-genuine; the mock verifier is dev/lab only and config refuses it in prod.
    expect(v.verify('mock.p1.notanumber', 'p1', GAME, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
  it('disabled mock fails closed', () => {
    expect(
      createMockIdentityVerifier({ disabled: true }).verify(
        mintMockToken('p1', NOW),
        'p1',
        GAME,
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'no_secret' });
  });
});

describe('Jest payments verifier — conformance', () => {
  const v = createJestPaymentsVerifier({ secretsB64: [secret, oldSecret] });
  runCases(
    paymentsConformance(
      v,
      {
        valid: (o) =>
          mintReceipt({
            playerId: o.playerId,
            gameId: o.gameId,
            secretB64: secret,
            purchaseToken: o.purchaseToken,
            productSku: o.sku,
            createdAt: NOW,
            ...(o.price !== undefined ? { price: o.price } : {}),
            ...(o.currency !== undefined ? { currency: o.currency } : {}),
            ...(o.completedAt !== undefined ? { completedAt: o.completedAt } : {}),
            ...(o.batch ? { batch: true } : {}),
          }),
        badSignature: (o) =>
          mintReceipt({
            playerId: o.playerId,
            gameId: o.gameId,
            secretB64: otherSecret,
            purchaseToken: o.purchaseToken,
            productSku: o.sku,
            createdAt: NOW,
          }),
        wrongAudience: (o) =>
          mintReceipt({
            playerId: o.playerId,
            gameId: 'other-game',
            secretB64: secret,
            purchaseToken: o.purchaseToken,
            productSku: o.sku,
            createdAt: NOW,
          }),
        malformedPurchase: (o) =>
          signHs256(
            { aud: o.gameId, sub: o.playerId, purchase: { productSku: 'gems_200' } },
            secret,
          ),
      },
      { gameId: GAME },
    ),
  );
  it('no secret → no_secret', () => {
    expect(createJestPaymentsVerifier({ secretsB64: [] }).verifyReceipt('a.b.c', GAME)).toEqual({
      ok: false,
      reason: 'no_secret',
    });
  });
  it('alg none → bad_alg', () => {
    const t = signHs256(
      {
        aud: GAME,
        sub: 'p1',
        purchase: { purchaseToken: 't', productSku: 's', createdAt: 1, completedAt: null },
      },
      secret,
      { alg: 'none' },
    );
    expect(v.verifyReceipt(t, GAME)).toEqual({ ok: false, reason: 'bad_alg' });
  });
});

describe('mock payments verifier — same conformance', () => {
  const v = createMockPaymentsVerifier();
  runCases(
    paymentsConformance(
      v,
      {
        valid: (o) =>
          mintMockReceipt({
            aud: o.gameId,
            sub: o.playerId,
            ...(o.batch
              ? {
                  purchases: [
                    {
                      purchaseToken: o.purchaseToken,
                      productSku: o.sku,
                      createdAt: NOW,
                      completedAt: NOW + 1,
                    },
                  ],
                }
              : {
                  purchase: {
                    purchaseToken: o.purchaseToken,
                    productSku: o.sku,
                    createdAt: NOW,
                    completedAt: o.completedAt === undefined ? NOW + 1 : o.completedAt,
                    ...(o.price !== undefined ? { price: o.price } : {}),
                    ...(o.currency !== undefined ? { currency: o.currency } : {}),
                  },
                }),
          }),
        badSignature: () => 'mockreceipt.!!!',
        wrongAudience: (o) =>
          mintMockReceipt({
            aud: 'other-game',
            sub: o.playerId,
            purchase: {
              purchaseToken: o.purchaseToken,
              productSku: o.sku,
              createdAt: NOW,
              completedAt: null,
            },
          }),
        malformedPurchase: (o) =>
          mintMockReceipt({ aud: o.gameId, sub: o.playerId, purchase: { productSku: 'x' } }),
      },
      { gameId: GAME },
    ).filter((c) => !/bad signature/.test(c.name)),
  );
  it('mock garbage after prefix → malformed (documents the skipped bad-signature case)', () => {
    expect(v.verifyReceipt('mockreceipt.!!!', GAME).ok).toBe(false);
  });
});
