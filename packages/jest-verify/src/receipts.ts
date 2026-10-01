// PaymentsVerifier: verifies a Jest-signed purchase receipt. The signed JWS is the ONLY input —
// no sku/price/token is ever read from the request body (ADR-007).
import type { ReceiptFailure } from '@foundation/contracts/enums';
import { hs256MatchesAny, parseJws } from './jws.ts';

export interface VerifiedReceipt {
  playerId: string;
  purchaseToken: string;
  productSku: string;
  createdAt: number;
  completedAt: number | null;
  /** Present in the signed direct-checkout receipt; absent → unclassified, never paid. */
  price?: number;
  currency?: string;
  /** Signed Jest provenance: true for sandbox/simulator, false when absent on a live receipt. */
  sandbox: boolean;
}

export type ReceiptResult =
  | { ok: true; playerId: string; purchases: VerifiedReceipt[] }
  | {
      ok: false;
      reason: ReceiptFailure;
      /** For `malformed_purchase`: the field that failed (`purchases[2].price`, `sub`). */
      field?: string;
    };

export interface PaymentsVerifier {
  verifyReceipt(jws: string, gameId: string): ReceiptResult;
}

const MAX_PROVIDER_TOKEN_LENGTH = 2048;
const MAX_SKU_LENGTH = 256;
const MAX_EPOCH_MS = 8_640_000_000_000_000;
// purchase_transactions.price is NUMERIC(12,2): ten integer digits and two fractional digits.
const MAX_STORED_PRICE = 9_999_999_999.99;

function validEpochMs(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_EPOCH_MS
  );
}

/** A verified receipt, or the name of the first field that failed (`malformed_purchase` says
 *  only that one did; the field says which, for logs and Sentry). */
function readPurchase(sub: string, raw: unknown): VerifiedReceipt | string {
  if (!raw || typeof raw !== 'object') return 'not an object';
  const p = raw as Record<string, unknown>;
  if (
    typeof p.purchaseToken !== 'string' ||
    p.purchaseToken.length === 0 ||
    p.purchaseToken.length > MAX_PROVIDER_TOKEN_LENGTH
  )
    return 'purchaseToken';
  if (
    typeof p.productSku !== 'string' ||
    p.productSku.length === 0 ||
    p.productSku.length > MAX_SKU_LENGTH
  )
    return 'productSku';
  if (!validEpochMs(p.createdAt)) return 'createdAt';
  if (!(p.completedAt === null || (validEpochMs(p.completedAt) && p.completedAt >= p.createdAt)))
    return 'completedAt';
  if (p.sandbox !== undefined && p.sandbox !== true) return 'sandbox';
  if (
    p.price !== undefined &&
    !(
      typeof p.price === 'number' &&
      Number.isFinite(p.price) &&
      p.price >= 0 &&
      p.price <= MAX_STORED_PRICE
    )
  )
    return 'price';
  if (
    p.currency !== undefined &&
    !(typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency))
  )
    return 'currency';
  if (
    p.credits !== undefined &&
    !(typeof p.credits === 'number' && Number.isFinite(p.credits) && p.credits >= 0)
  )
    return 'credits';
  const out: VerifiedReceipt = {
    playerId: sub,
    purchaseToken: p.purchaseToken,
    productSku: p.productSku,
    createdAt: p.createdAt,
    completedAt: p.completedAt as number | null,
    sandbox: p.sandbox === true,
  };
  if (typeof p.price === 'number') out.price = p.price;
  if (typeof p.currency === 'string') out.currency = p.currency;
  return out;
}

/** The purchases of a verified payload, or why they are malformed (shared by both verifiers). */
function readPayloadPurchases(payload: Record<string, unknown>): ReceiptResult {
  const malformed = (field: string): ReceiptResult => ({
    ok: false,
    reason: 'malformed_purchase',
    field,
  });
  const sub = payload.sub;
  if (typeof sub !== 'string' || !sub || sub.length > 128) return malformed('sub');
  const hasPurchase = payload.purchase !== undefined;
  const hasPurchases = payload.purchases !== undefined;
  if (hasPurchase === hasPurchases)
    return malformed(hasPurchase ? 'purchase and purchases' : 'no purchase or purchases');
  const raw = hasPurchase
    ? [payload.purchase]
    : Array.isArray(payload.purchases)
      ? payload.purchases
      : null;
  if (!raw) return malformed('purchases (not an array)');
  if (raw.length > 50) return malformed(`purchases (${raw.length} > 50)`);
  const purchases: VerifiedReceipt[] = [];
  for (const [i, r] of raw.entries()) {
    const v = readPurchase(sub, r);
    if (typeof v === 'string')
      return malformed(hasPurchase ? `purchase.${v}` : `purchases[${i}].${v}`);
    purchases.push(v);
  }
  // Keep the signed subject even when there are no purchases to recover.
  return { ok: true, playerId: sub, purchases };
}

export function createJestPaymentsVerifier(opts: {
  secretsB64: readonly string[];
}): PaymentsVerifier {
  return {
    verifyReceipt(jws, gameId) {
      const secrets = opts.secretsB64.filter((s) => typeof s === 'string' && s.length > 0);
      if (secrets.length === 0) return { ok: false, reason: 'no_secret' };
      const parsed = parseJws(jws);
      if (!parsed.ok) return { ok: false, reason: 'malformed' };
      if (parsed.header.alg !== 'HS256') return { ok: false, reason: 'bad_alg' };
      if (hs256MatchesAny(parsed.signingInput, parsed.signature, secrets) < 0)
        return { ok: false, reason: 'bad_signature' };
      const p = parsed.payload;
      if (!gameId || p.aud !== gameId) return { ok: false, reason: 'wrong_audience' };
      return readPayloadPurchases(p);
    },
  };
}

/** Mock receipts: `mockreceipt.<base64url(json)>` where json = {aud, sub, purchase|purchases}. Verified structurally; still fails closed on garbage/aud. */
export function createMockPaymentsVerifier(): PaymentsVerifier {
  return {
    verifyReceipt(jws, gameId) {
      if (typeof jws !== 'string' || !jws.startsWith('mockreceipt.'))
        return { ok: false, reason: 'malformed' };
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(
          Buffer.from(
            jws.slice('mockreceipt.'.length).replace(/-/g, '+').replace(/_/g, '/'),
            'base64',
          ).toString('utf8'),
        ) as Record<string, unknown>;
      } catch {
        return { ok: false, reason: 'malformed' };
      }
      if (!gameId || payload.aud !== gameId) return { ok: false, reason: 'wrong_audience' };
      return readPayloadPurchases(payload);
    },
  };
}

export function mintMockReceipt(payload: {
  aud: string;
  sub: string;
  purchase?: Record<string, unknown>;
  purchases?: Record<string, unknown>[];
}): string {
  return (
    'mockreceipt.' +
    Buffer.from(JSON.stringify(payload))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  );
}
