// Subscription list verification (ADR-035): Jest's signed subscription data (`signed` from
// getSubscriptions, or `subscriptionSigned` from beginSubscription / claimRetentionOffer). The
// signed JWS is the ONLY input. Ported from Warp Crew's legacy server (server/subscriptions.js).
//
//   - HS256 with the same base64 shared secret(s) as player tokens; alg pinned.
//   - `aud` is the game id; `sub` must be the calling player (a list for player A never unlocks B).
//   - A list can be replayed after the player cancels, so `iat` is REQUIRED and must be recent
//     (default 24 h, 5 min future skew). The client re-reads the list on every boot.
//   - Nothing about entitlement is decided here: the server feature keeps known SKUs and applies
//     the sandbox gate.
import type { SubscriptionFailure } from '@foundation/contracts/enums';
import { hs256MatchesAny, parseJws } from './jws.ts';
import { DEFAULT_FUTURE_SKEW_MS } from './identity.ts';

export const DEFAULT_SUBSCRIPTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface VerifiedSubscription {
  sku: string;
  /** Jest's status string as signed (`active`, `expired`, ...). */
  status: string;
  /** Signed sandbox provenance. */
  sandbox: boolean;
  trialEligible: boolean;
  retentionOffer: { price: number; durationPeriods: number | null } | null;
  /** The signed catalog terms, so a shop shows what Jest will bill. */
  price: number | null;
  currency: string | null;
  billingPeriod: 'weekly' | 'monthly' | 'yearly' | null;
}

export type SubscriptionsResult =
  | { ok: true; playerId: string; issuedAtMs: number; subscriptions: VerifiedSubscription[] }
  | { ok: false; reason: SubscriptionFailure };

export interface SubscriptionCheck {
  gameId: string;
  /** The authenticated caller: the list's `sub` must equal it. */
  playerKey: string;
  now: number;
  /** Max list age from `iat` (ms). Default 24 h. */
  maxAgeMs?: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const PERIODS = new Set(['weekly', 'monthly', 'yearly']);

function readItem(raw: unknown): VerifiedSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.sku !== 'string' || !o.sku || o.sku.length > 256) return null;
  const offer = o.retentionOffer as Record<string, unknown> | null | undefined;
  return {
    sku: o.sku,
    status: typeof o.status === 'string' ? o.status.slice(0, 64) : 'unknown',
    sandbox: o.sandbox === true,
    trialEligible: o.trialEligible === true,
    retentionOffer:
      offer && typeof offer === 'object' && finite(offer.price)
        ? {
            price: offer.price,
            durationPeriods: finite(offer.durationPeriods) ? offer.durationPeriods : null,
          }
        : null,
    price: finite(o.price) ? o.price : null,
    currency: typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency) ? o.currency : null,
    billingPeriod: PERIODS.has(o.billingPeriod as string)
      ? (o.billingPeriod as VerifiedSubscription['billingPeriod'])
      : null,
  };
}

/** Claims shared by the Jest and mock verifiers, after the signature (or mock framing) holds. */
export function readSubscriptionPayload(
  p: Record<string, unknown>,
  check: SubscriptionCheck,
): SubscriptionsResult {
  if (!check.gameId || p.aud !== check.gameId) return { ok: false, reason: 'wrong_audience' };
  if (typeof p.sub !== 'string' || !p.sub || p.sub !== check.playerKey)
    return { ok: false, reason: 'sub_mismatch' };
  // Every proof must say when it was signed, or an old "active" list could be replayed forever.
  const iatMs = finite(p.iat) ? (p.iat > 1e11 ? p.iat : p.iat * 1000) : NaN;
  if (!Number.isFinite(iatMs)) return { ok: false, reason: 'no_iat' };
  const maxAge = check.maxAgeMs ?? DEFAULT_SUBSCRIPTION_MAX_AGE_MS;
  if (check.now - iatMs > maxAge || iatMs - check.now > DEFAULT_FUTURE_SKEW_MS)
    return { ok: false, reason: 'stale' };
  const raw = p.subscription !== undefined ? [p.subscription] : p.subscriptions;
  if (!Array.isArray(raw) || raw.length > 100)
    return { ok: false, reason: 'malformed_subscription' };
  const subscriptions: VerifiedSubscription[] = [];
  for (const item of raw) {
    const v = readItem(item);
    if (v) subscriptions.push(v);
  }
  return { ok: true, playerId: p.sub, issuedAtMs: iatMs, subscriptions };
}

export interface SubscriptionsVerifier {
  verifySubscriptions(jws: string, check: SubscriptionCheck): SubscriptionsResult;
}

export function createJestSubscriptionsVerifier(opts: {
  secretsB64: readonly string[];
}): SubscriptionsVerifier {
  return {
    verifySubscriptions(jws, check) {
      const secrets = opts.secretsB64.filter((s) => typeof s === 'string' && s.length > 0);
      if (secrets.length === 0) return { ok: false, reason: 'no_secret' };
      const parsed = parseJws(jws);
      if (!parsed.ok) return { ok: false, reason: 'malformed' };
      if (parsed.header.alg !== 'HS256') return { ok: false, reason: 'bad_alg' };
      if (hs256MatchesAny(parsed.signingInput, parsed.signature, secrets) < 0)
        return { ok: false, reason: 'bad_signature' };
      return readSubscriptionPayload(parsed.payload, check);
    },
  };
}

/** Mock lists: `mocksubs.<base64url(json)>` with the Jest payload shape. Same claim checks. */
export function createMockSubscriptionsVerifier(): SubscriptionsVerifier {
  return {
    verifySubscriptions(jws, check) {
      if (typeof jws !== 'string' || !jws.startsWith('mocksubs.'))
        return { ok: false, reason: 'malformed' };
      let payload: unknown;
      try {
        payload = JSON.parse(
          Buffer.from(
            jws.slice('mocksubs.'.length).replace(/-/g, '+').replace(/_/g, '/'),
            'base64',
          ).toString('utf8'),
        );
      } catch {
        return { ok: false, reason: 'malformed' };
      }
      if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
      return readSubscriptionPayload(payload as Record<string, unknown>, check);
    },
  };
}

export function mintMockSubscriptions(payload: Record<string, unknown>): string {
  return (
    'mocksubs.' +
    Buffer.from(JSON.stringify(payload))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  );
}
