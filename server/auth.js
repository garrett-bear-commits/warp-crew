// Who is calling. Jest's signed player token, checked on every request.
//
// Ported from Ninefold (server/auth.js), itself ported from Barrowdeep's server,
// written against Jest's own answers about the token (2026-08-06). The facts
// that matter, kept here so nobody relearns them:
//
//   - HS256 with a SYMMETRIC shared secret from the Developer Console. There is
//     no public key and no JWKS endpoint.
//   - That secret is BASE64-ENCODED in the console; decode it before use.
//   - There is NO `exp`. Freshness is enforced from `iat`, 24h like Jest's docs.
//   - Check `aud` (the game id) and that the token's player is the caller.
//   - Guests have tokens too (`registered: false`). That is normal.
//   - The Simulator returns the literal `mock-signed-player-jwt`, which fails
//     real verification. Do not debug a verifier against it.
//
// Hand-rolled on purpose: one algorithm, one key, four claims.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PLAYER_ID = /^[A-Za-z0-9_-]{3,128}$/;

/** A usable Jest shared secret: canonical base64 of at least 16 bytes (128 bits). */
export function validSecret(secretB64) {
  if (typeof secretB64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(secretB64)) return false;
  const key = Buffer.from(secretB64, 'base64');
  return key.length >= 16 && key.toString('base64').replace(/=+$/, '') === secretB64.replace(/=+$/, '');
}

const b64urlToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verify a token for `claimedPlayerId`.
 * @returns {{ok:true, player:{playerId:string, registered:boolean}} | {ok:false, reason:string}}
 */
export function verifyPlayerToken(token, claimedPlayerId, secretB64, gameId, now) {
  // No secret means nothing can be verified. Fail CLOSED: an endpoint that
  // accepts everything when misconfigured looks like it is working.
  if (!secretB64 || !validSecret(secretB64)) return { ok: false, reason: 'no_secret' };
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
  // Pinned: trusting the token's own `alg` is the classic JWT hole.
  if (header.alg !== 'HS256') return { ok: false, reason: 'bad_alg' };

  const expected = createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`${h}.${p}`).digest();
  const actual = b64urlToBuf(sig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Always required: a token for another game must never authenticate here.
  if (!gameId || payload.aud !== gameId) return { ok: false, reason: 'wrong_audience' };

  const iatMs = typeof payload.iat === 'number' ? (payload.iat > 1e11 ? payload.iat : payload.iat * 1000) : NaN;
  if (!Number.isFinite(iatMs)) return { ok: false, reason: 'malformed' };
  if (now - iatMs > TOKEN_MAX_AGE_MS || iatMs - now > 5 * 60_000) return { ok: false, reason: 'stale' };

  const playerId = payload.player?.playerId ?? payload.sub;
  if (!playerId) return { ok: false, reason: 'malformed' };
  if (payload.sub && payload.player?.playerId && payload.sub !== payload.player.playerId) {
    return { ok: false, reason: 'sub_mismatch' };
  }
  if (playerId !== claimedPlayerId) return { ok: false, reason: 'sub_mismatch' };
  return { ok: true, player: { playerId, registered: Boolean(payload.player?.registered) } };
}

/**
 * Authenticate a request. Headers: `x-player-id`, and `authorization: Bearer
 * <token>` from `JestSDK.getPlayerSigned()`.
 *
 * `devAuth` trusts `x-player-id` alone. It exists for local runs and the QA
 * link before the Jest secret is configured, and it must never be on in a
 * deployment real players reach — anyone could act as anyone.
 */
export function authenticate(headers, { secret, gameId, devAuth, now }) {
  const playerId = headers['x-player-id'];
  if (typeof playerId !== 'string' || !PLAYER_ID.test(playerId)) return { ok: false, reason: 'no_player' };
  if (devAuth) return { ok: true, player: { playerId, registered: false } };
  const m = /^Bearer (.+)$/.exec(headers.authorization ?? '');
  if (!m) return { ok: false, reason: 'no_token' };
  return verifyPlayerToken(m[1], playerId, secret, gameId, now);
}
