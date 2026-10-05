// Auth (§4.2): requirePlayer (claimed key from header, Bearer provider token, verifier over the
// secret list; iat ≤ 5 min step-up for value commands; per-game maxTokenAgeSec), requireAdmin
// (key id + secret, timing-safe, scopes, Idempotency-Key = commandId, every call audited),
// requireOps. Identity fails closed: no_secret → 503, never open.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IdentityVerifier } from '@foundation/jest-verify';
import { HEADERS, type AdminScope } from '@foundation/contracts/enums';
import { AppError } from '../errors.ts';
import type { Actor } from '../cqrs/define.ts';
import type { AdminKey } from '../config.ts';

export interface HeaderBag {
  get(name: string): string | undefined;
}

export interface PlayerAuthResult {
  actor: Extract<Actor, { kind: 'player' }>;
  playerKey: string;
}

export function authenticatePlayer(
  verifier: IdentityVerifier,
  gameId: string,
  now: number,
  headers: HeaderBag,
): PlayerAuthResult {
  const claimed = headers.get(HEADERS.playerKey);
  const auth = headers.get(HEADERS.authorization);
  return authenticatePlayerFromParts(
    verifier,
    gameId,
    now,
    claimed,
    auth?.startsWith('Bearer ') ? auth.slice(7) : undefined,
  );
}

/** Beacon route: the same check with the parts taken from the body. */
export function authenticatePlayerFromParts(
  verifier: IdentityVerifier,
  gameId: string,
  now: number,
  claimedKey: string | undefined,
  token: string | undefined,
): PlayerAuthResult {
  if (!claimedKey || !token) throw new AppError('unauthorized', 'missing player key or token');
  if (claimedKey.length > 128) throw new AppError('unauthorized', 'player key too long');
  const r = verifier.verify(token, claimedKey, gameId, now);
  if (!r.ok) {
    if (r.reason === 'no_secret')
      throw new AppError(
        'not_configured',
        'identity verifier has no secret; refusing to authenticate',
        { reason: r.reason },
      );
    throw new AppError('unauthorized', `token rejected: ${r.reason}`, { reason: r.reason });
  }
  return {
    playerKey: r.player.playerId,
    actor: {
      kind: 'player',
      playerKey: r.player.playerId,
      registered: r.player.registered,
      tokenIatMs: r.player.iatMs,
    },
  };
}

export function sha256HexOf(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

export function authenticateAdmin(
  keys: readonly AdminKey[],
  headers: HeaderBag,
): Extract<Actor, { kind: 'admin' }> {
  const keyId = headers.get(HEADERS.adminKeyId);
  const secret = headers.get(HEADERS.adminSecret);
  if (!keyId || !secret) throw new AppError('unauthorized', 'admin key id and secret required');
  const key = keys.find((k) => k.keyId === keyId);
  // Compare against a real or dummy hash either way (constant work per request).
  const target = key?.secretSha256 ?? sha256HexOf('no-such-key');
  const ok = safeEqualHex(sha256HexOf(secret), target);
  if (!key || !ok) throw new AppError('unauthorized', 'admin credentials rejected');
  return { kind: 'admin', keyId: key.keyId, scopes: key.scopes };
}

export function requireScope(actor: Extract<Actor, { kind: 'admin' }>, scope: AdminScope): void {
  if (!actor.scopes.includes(scope))
    throw new AppError('forbidden', `admin scope ${scope} required`, { required: scope });
}

export function authenticateOps(
  opsSecret: string,
  headers: HeaderBag,
): Extract<Actor, { kind: 'ops' }> {
  const given = headers.get(HEADERS.opsSecret);
  if (!opsSecret) throw new AppError('not_configured', 'OPS_SECRET not configured');
  if (!given || !safeEqualHex(sha256HexOf(given), sha256HexOf(opsSecret)))
    throw new AppError('unauthorized', 'ops secret rejected');
  return { kind: 'ops' };
}
