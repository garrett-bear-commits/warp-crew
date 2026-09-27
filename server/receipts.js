// Jest purchase receipts. Ported from Barrowdeep (server/src/domain/purchaseReceipt.ts).
//
//   - HS256 with the same base64 shared secret as the player token.
//   - Only the signed string is trusted. Player id, SKU, token and price all
//     come from inside the verified payload, never from the request body.
//   - A completed purchase may be retried much later, so receipts are not
//     expired from `iat`; the database's unique provider token is the replay guard.
//   - `purchase` (from beginPurchase) or `purchases` (getIncompletePurchases).
//   - A signed price of 0 is a Jest sandbox purchase.

import { createHmac, timingSafeEqual } from 'node:crypto';

const b64urlToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function verifyPurchaseReceipts(token, secretB64, gameId) {
  if (!secretB64) return { ok: false, reason: 'no_secret' };
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, sig] = parts;
  let header, payload;
  try {
    header = JSON.parse(b64urlToBuf(h).toString('utf8'));
    payload = JSON.parse(b64urlToBuf(p).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (header.alg !== 'HS256') return { ok: false, reason: 'bad_alg' };
  const expected = createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`${h}.${p}`).digest();
  const actual = b64urlToBuf(sig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, reason: 'bad_signature' };
  // A receipt signed for another game must never buy anything here.
  if (!gameId || payload.aud !== gameId) return { ok: false, reason: 'wrong_audience' };
  const raw = payload.purchase ? [payload.purchase] : payload.purchases;
  if (!Array.isArray(raw) || !raw.length || typeof payload.sub !== 'string' || !payload.sub) return { ok: false, reason: 'malformed_purchase' };
  const purchases = [];
  for (const item of raw) {
    if (typeof item?.purchaseToken !== 'string' || !item.purchaseToken
      || typeof item.productSku !== 'string' || !item.productSku
      || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)
      || !(item.completedAt === null || item.completedAt === undefined || (typeof item.completedAt === 'number' && Number.isFinite(item.completedAt)))) {
      return { ok: false, reason: 'malformed_purchase' };
    }
    purchases.push({
      playerId: payload.sub,
      purchaseToken: item.purchaseToken,
      productSku: item.productSku,
      createdAt: item.createdAt,
      completedAt: item.completedAt ?? null,
      ...(Number.isFinite(item.price) ? { price: item.price } : {}),
      ...(typeof item.currency === 'string' && item.currency ? { currency: item.currency } : {}),
    });
  }
  return { ok: true, purchases };
}

/** Only the signed receipt classifies money. */
export function classifyReceipt(receipt) {
  if (receipt.price === 0) return 'sandbox';
  if (Number.isFinite(receipt.price) && receipt.price > 0) return 'paid';
  return 'unclassified';
}
