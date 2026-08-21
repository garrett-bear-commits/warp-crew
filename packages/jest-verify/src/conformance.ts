// Conformance suite for provider verifiers (§4.3 "a conformance suite drives the mock through every
// path a real provider must pass"). Framework-agnostic: returns named cases with a boolean check;
// the vitest wrapper in test/ turns each into `it(...)`. Both the Jest and mock verifiers must pass.
import type { IdentityVerifier, TokenResult } from './identity.ts';
import type { PaymentsVerifier, ReceiptResult } from './receipts.ts';

export interface ConformanceCase {
  name: string;
  run(): boolean | Promise<boolean>;
}

export interface IdentityMinter {
  /** Mint a valid token for playerId at iatMs for gameId. */
  valid(playerId: string, iatMs: number, gameId: string, registered?: boolean): string;
  /** Mint a token whose signature does not verify (wrong secret / tampered). */
  badSignature(playerId: string, iatMs: number, gameId: string): string;
  /** Mint a token for a different audience. */
  wrongAudience(playerId: string, iatMs: number): string;
  /** Mint with a non-HS256 alg header (e.g. none / RS256), if the format has one. */
  badAlg?(playerId: string, iatMs: number, gameId: string): string;
}

export function identityConformance(
  v: IdentityVerifier,
  mint: IdentityMinter,
  opts: { gameId: string; now: number; maxAgeMs: number },
): ConformanceCase[] {
  const { gameId, now, maxAgeMs } = opts;
  const ok = (r: TokenResult) => r.ok;
  const fails = (r: TokenResult, reason: string) => !r.ok && r.reason === reason;
  const cases: ConformanceCase[] = [
    {
      name: 'valid token for the claimed key verifies',
      run: () => ok(v.verify(mint.valid('p1', now, gameId), 'p1', gameId, now)),
    },
    {
      name: 'guest (registered=false) verifies as a normal player',
      run: () => {
        const r = v.verify(mint.valid('p1', now, gameId, false), 'p1', gameId, now);
        return r.ok && r.player.registered === false;
      },
    },
    {
      name: 'registered flag survives',
      run: () => {
        const r = v.verify(mint.valid('p1', now, gameId, true), 'p1', gameId, now);
        return r.ok && r.player.registered === true;
      },
    },
    {
      name: 'claimed key ≠ token subject → sub_mismatch (a valid token must not write another player)',
      run: () => fails(v.verify(mint.valid('p1', now, gameId), 'p2', gameId, now), 'sub_mismatch'),
    },
    {
      name: 'empty token → malformed',
      run: () => fails(v.verify('', 'p1', gameId, now), 'malformed'),
    },
    {
      name: 'garbage token → malformed',
      run: () => fails(v.verify('not.a.token.at.all', 'p1', gameId, now), 'malformed'),
    },
    {
      name: 'bad signature → bad_signature',
      run: () =>
        fails(v.verify(mint.badSignature('p1', now, gameId), 'p1', gameId, now), 'bad_signature'),
    },
    {
      name: 'wrong audience → wrong_audience',
      run: () =>
        fails(v.verify(mint.wrongAudience('p1', now), 'p1', gameId, now), 'wrong_audience'),
    },
    {
      name: 'stale token (older than max age) → stale',
      run: () =>
        fails(
          v.verify(mint.valid('p1', now - maxAgeMs - 1000, gameId), 'p1', gameId, now),
          'stale',
        ),
    },
    {
      name: 'future-dated token beyond skew → stale',
      run: () =>
        fails(v.verify(mint.valid('p1', now + 10 * 60_000, gameId), 'p1', gameId, now), 'stale'),
    },
    {
      name: 'token just inside the age window verifies',
      run: () => ok(v.verify(mint.valid('p1', now - maxAgeMs + 60_000, gameId), 'p1', gameId, now)),
    },
    {
      name: 'empty gameId fails closed (no_secret)',
      run: () => !v.verify(mint.valid('p1', now, gameId), 'p1', '', now).ok,
    },
    {
      name: 'iatMs is reported for step-up decisions',
      run: () => {
        const r = v.verify(mint.valid('p1', now - 60_000, gameId), 'p1', gameId, now);
        return r.ok && Math.abs(r.player.iatMs - (now - 60_000)) < 1000;
      },
    },
  ];
  if (mint.badAlg)
    cases.push({
      name: 'non-HS256 alg header → bad_alg (alg pinned)',
      run: () => fails(v.verify(mint.badAlg!('p1', now, gameId), 'p1', gameId, now), 'bad_alg'),
    });
  return cases;
}

export interface ReceiptMinter {
  valid(o: {
    playerId: string;
    gameId: string;
    purchaseToken: string;
    sku: string;
    price?: number;
    currency?: string;
    sandbox?: true;
    completedAt?: number | null;
    batch?: boolean;
  }): string;
  badSignature(o: { playerId: string; gameId: string; purchaseToken: string; sku: string }): string;
  wrongAudience(o: { playerId: string; purchaseToken: string; sku: string }): string;
  malformedPurchase(o: { playerId: string; gameId: string }): string;
}

export function paymentsConformance(
  v: PaymentsVerifier,
  mint: ReceiptMinter,
  opts: { gameId: string },
): ConformanceCase[] {
  const { gameId } = opts;
  const okOne = (r: ReceiptResult) => r.ok && r.purchases.length === 1;
  const fails = (r: ReceiptResult, reason: string) => !r.ok && r.reason === reason;
  return [
    {
      name: 'valid direct-checkout receipt verifies with all facts from the JWS',
      run: () => {
        const r = v.verifyReceipt(
          mint.valid({
            playerId: 'p1',
            gameId,
            purchaseToken: 'tok1',
            sku: 'gems_200',
            price: 4.99,
            currency: 'USD',
          }),
          gameId,
        );
        return (
          okOne(r) &&
          r.ok &&
          r.purchases[0]!.purchaseToken === 'tok1' &&
          r.purchases[0]!.productSku === 'gems_200' &&
          r.purchases[0]!.price === 4.99 &&
          r.purchases[0]!.playerId === 'p1'
        );
      },
    },
    {
      name: 'signed sandbox provenance survives a positive simulator price',
      run: () => {
        const r = v.verifyReceipt(
          mint.valid({
            playerId: 'p1',
            gameId,
            purchaseToken: 'tok2',
            sku: 'gems_200',
            price: 4.99,
            currency: 'USD',
            sandbox: true,
          }),
          gameId,
        );
        return okOne(r) && r.ok && r.purchases[0]!.sandbox === true;
      },
    },
    {
      name: 'receipt without price verifies with price undefined (never guessed)',
      run: () => {
        const r = v.verifyReceipt(
          mint.valid({ playerId: 'p1', gameId, purchaseToken: 'tok3', sku: 'gems_200' }),
          gameId,
        );
        return okOne(r) && r.ok && r.purchases[0]!.price === undefined;
      },
    },
    {
      name: 'batch receipt (purchases[]) verifies',
      run: () =>
        okOne(
          v.verifyReceipt(
            mint.valid({
              playerId: 'p1',
              gameId,
              purchaseToken: 'tok4',
              sku: 'gems_200',
              batch: true,
            }),
            gameId,
          ),
        ),
    },
    {
      name: 'incomplete purchase (completedAt null) verifies',
      run: () =>
        okOne(
          v.verifyReceipt(
            mint.valid({
              playerId: 'p1',
              gameId,
              purchaseToken: 'tok5',
              sku: 'gems_200',
              completedAt: null,
            }),
            gameId,
          ),
        ),
    },
    {
      name: 'bad signature → bad_signature',
      run: () =>
        fails(
          v.verifyReceipt(
            mint.badSignature({ playerId: 'p1', gameId, purchaseToken: 'tok6', sku: 'gems_200' }),
            gameId,
          ),
          'bad_signature',
        ),
    },
    {
      name: 'wrong audience → wrong_audience',
      run: () =>
        fails(
          v.verifyReceipt(
            mint.wrongAudience({ playerId: 'p1', purchaseToken: 'tok7', sku: 'gems_200' }),
            gameId,
          ),
          'wrong_audience',
        ),
    },
    {
      name: 'malformed purchase payload → malformed_purchase',
      run: () =>
        fails(
          v.verifyReceipt(mint.malformedPurchase({ playerId: 'p1', gameId }), gameId),
          'malformed_purchase',
        ),
    },
    {
      name: 'garbage → malformed',
      run: () => fails(v.verifyReceipt('garbage', gameId), 'malformed'),
    },
    {
      name: 'empty gameId fails closed',
      run: () =>
        !v.verifyReceipt(
          mint.valid({ playerId: 'p1', gameId, purchaseToken: 'tok8', sku: 'gems_200' }),
          '',
        ).ok,
    },
  ];
}
