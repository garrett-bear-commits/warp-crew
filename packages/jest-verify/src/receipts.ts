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
}

export type ReceiptResult =
  { ok: true; purchases: VerifiedReceipt[] } | { ok: false; reason: ReceiptFailure };

export interface PaymentsVerifier {
  verifyReceipt(jws: string, gameId: string): ReceiptResult;
}

function readPurchase(sub: string, raw: unknown): VerifiedReceipt | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.purchaseToken !== 'string' || !p.purchaseToken) return null;
  if (typeof p.productSku !== 'string' || !p.productSku) return null;
  if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt)) return null;
  if (!(
    p.completedAt === null ||
    (typeof p.completedAt === 'number' && Number.isFinite(p.completedAt))
  ))
    return null;
  const out: VerifiedReceipt = {
    playerId: sub,
    purchaseToken: p.purchaseToken,
    productSku: p.productSku,
    createdAt: p.createdAt,
    completedAt: p.completedAt as number | null,
  };
  if (typeof p.price === 'number' && Number.isFinite(p.price)) out.price = p.price;
  if (typeof p.currency === 'string' && p.currency) out.currency = p.currency;
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
      if (typeof p.sub !== 'string' || !p.sub) return { ok: false, reason: 'malformed_purchase' };
      const raw = p.purchase ? [p.purchase] : Array.isArray(p.purchases) ? p.purchases : null;
      if (!raw || raw.length === 0) return { ok: false, reason: 'malformed_purchase' };
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
      if (typeof payload.sub !== 'string' || !payload.sub)
        return { ok: false, reason: 'malformed_purchase' };
      const raw = payload.purchase
        ? [payload.purchase]
        : Array.isArray(payload.purchases)
          ? payload.purchases
          : null;
      if (!raw || raw.length === 0) return { ok: false, reason: 'malformed_purchase' };
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
