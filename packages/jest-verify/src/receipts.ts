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
  { ok: true; purchases: VerifiedReceipt[] } | { ok: false; reason: ReceiptFailure };

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

function readPurchase(sub: string, raw: unknown): VerifiedReceipt | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (
    typeof p.purchaseToken !== 'string' ||
    p.purchaseToken.length === 0 ||
    p.purchaseToken.length > MAX_PROVIDER_TOKEN_LENGTH
  )
    return null;
  if (
    typeof p.productSku !== 'string' ||
    p.productSku.length === 0 ||
    p.productSku.length > MAX_SKU_LENGTH
  )
    return null;
  if (!validEpochMs(p.createdAt)) return null;
  if (!(p.completedAt === null || (validEpochMs(p.completedAt) && p.completedAt >= p.createdAt)))
    return null;
  if (p.sandbox !== undefined && p.sandbox !== true) return null;
  if (
    p.price !== undefined &&
    !(
      typeof p.price === 'number' &&
      Number.isFinite(p.price) &&
      p.price >= 0 &&
      p.price <= MAX_STORED_PRICE
    )
  )
    return null;
  if (
    p.currency !== undefined &&
    !(typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency))
  )
    return null;
  if (
    p.credits !== undefined &&
    !(typeof p.credits === 'number' && Number.isFinite(p.credits) && p.credits >= 0)
  )
    return null;
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
      if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128)
        return { ok: false, reason: 'malformed_purchase' };
      const hasPurchase = p.purchase !== undefined;
      const hasPurchases = p.purchases !== undefined;
      if (hasPurchase === hasPurchases) return { ok: false, reason: 'malformed_purchase' };
      const raw = hasPurchase ? [p.purchase] : Array.isArray(p.purchases) ? p.purchases : null;
      if (!raw || raw.length === 0 || raw.length > 50)
        return { ok: false, reason: 'malformed_purchase' };
      const purchases: VerifiedReceipt[] = [];
      for (const r of raw) {
        const v = readPurchase(p.sub, r);
        if (!v) return { ok: false, reason: 'malformed_purchase' };
        purchases.push(v);
      }
      return { ok: true, purchases };
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
      if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128)
        return { ok: false, reason: 'malformed_purchase' };
      const hasPurchase = payload.purchase !== undefined;
      const hasPurchases = payload.purchases !== undefined;
      if (hasPurchase === hasPurchases) return { ok: false, reason: 'malformed_purchase' };
      const raw = hasPurchase
        ? [payload.purchase]
        : Array.isArray(payload.purchases)
          ? payload.purchases
          : null;
      if (!raw || raw.length === 0 || raw.length > 50)
        return { ok: false, reason: 'malformed_purchase' };
      const purchases: VerifiedReceipt[] = [];
      for (const r of raw) {
        const v = readPurchase(payload.sub, r);
        if (!v) return { ok: false, reason: 'malformed_purchase' };
        purchases.push(v);
      }
      return { ok: true, purchases };
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
