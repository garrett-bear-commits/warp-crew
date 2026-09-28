// Jest signed subscription data (`signed` from getSubscriptions, or
// `subscriptionSigned` from beginSubscription / claimRetentionOffer).
//
//   - HS256 with the same base64 shared secret as the player token.
//   - `aud` is the game id and `sub` must be the calling player; a signed list
//     for player A must never unlock player B.
//   - A list can be replayed after the player cancels, so when `iat` is present
//     it must be recent. The client re-reads the list on every boot.
//   - Sandbox subscriptions carry `sandbox: true`; they unlock only where
//     sandbox granting is switched on (QA), like sandbox purchases.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { validSecret } from './auth.js';
import { SUBSCRIPTION_DEFS } from '../src/data/products.js';

export const SUBSCRIPTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const b64urlToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function verifySubscriptions(token, { secret, gameId, playerId, now, grantSandbox = false }) {
  if (!secret || !validSecret(secret)) return { ok: false, reason: 'no_secret' };
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
  const expected = createHmac('sha256', Buffer.from(secret, 'base64')).update(`${h}.${p}`).digest();
  const actual = b64urlToBuf(sig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, reason: 'bad_signature' };
  if (!gameId || payload.aud !== gameId) return { ok: false, reason: 'wrong_audience' };
  if (typeof payload.sub !== 'string' || payload.sub !== playerId) return { ok: false, reason: 'player_mismatch' };
  if (payload.iat !== undefined) {
    const iatMs = typeof payload.iat === 'number' ? (payload.iat > 1e11 ? payload.iat : payload.iat * 1000) : NaN;
    if (!Number.isFinite(iatMs) || now - iatMs > SUBSCRIPTION_MAX_AGE_MS || iatMs - now > 5 * 60_000) return { ok: false, reason: 'stale' };
  }
  const raw = payload.subscription ? [payload.subscription] : payload.subscriptions;
  if (!Array.isArray(raw)) return { ok: false, reason: 'malformed_subscription' };
  const subscriptions = [];
  for (const item of raw) {
    if (typeof item?.sku !== 'string' || !SUBSCRIPTION_DEFS[item.sku]) continue;
    const sandbox = item.sandbox === true;
    subscriptions.push({
      sku: item.sku,
      active: item.status === 'active' && (!sandbox || grantSandbox),
      sandbox,
      trialEligible: item.trialEligible === true,
      retentionOffer: item.retentionOffer && Number.isFinite(item.retentionOffer.price)
        ? { price: item.retentionOffer.price, durationPeriods: item.retentionOffer.durationPeriods } : null,
    });
  }
  return { ok: true, subscriptions };
}
