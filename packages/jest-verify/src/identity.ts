// IdentityVerifier: verifies the platform's signed player token and binds it to the claimed key.
// Fails CLOSED: no secret → no_secret (503 at the route), never open.
import type { IdentityFailure } from '@foundation/contracts/enums';
import { hs256MatchesAny, parseJws } from './jws.ts';

export interface VerifiedPlayer {
  playerId: string;
  registered: boolean;
  /** Token issue time in ms (for step-up checks). */
  iatMs: number;
  /** Which secret in the rotation list verified this token. */
  secretIndex: number;
}

export type TokenResult =
  { ok: true; player: VerifiedPlayer } | { ok: false; reason: IdentityFailure };

export interface IdentityVerifier {
  verify(token: string, claimedKey: string, gameId: string, now: number): TokenResult;
}

export interface JestIdentityOptions {
  /** Base64-encoded HS256 secrets, newest first (rotation list). */
  secretsB64: readonly string[];
  /** Max token age from iat (ms). Jest issues no exp; default 24h. */
  maxTokenAgeMs?: number;
  /** Tolerated future skew (ms). Default 5 min. */
  maxFutureSkewMs?: number;
}

export const DEFAULT_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_FUTURE_SKEW_MS = 5 * 60_000;

/**
 * Jest HS256 verifier. Every claim rule here came from a day lost in Barrowdeep:
 * alg pinned; aud == GAME_ID mandatory; sub/player.playerId agree and equal the claimed key;
 * iat window both directions; no exp exists so age is enforced from iat.
 */
export function createJestIdentityVerifier(opts: JestIdentityOptions): IdentityVerifier {
  const maxAge = opts.maxTokenAgeMs ?? DEFAULT_TOKEN_MAX_AGE_MS;
  const skew = opts.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
  return {
    verify(token, claimedKey, gameId, now) {
      const secrets = opts.secretsB64.filter((s) => typeof s === 'string' && s.length > 0);
      if (secrets.length === 0) return { ok: false, reason: 'no_secret' };
      if (!gameId) return { ok: false, reason: 'no_secret' };
      const parsed = parseJws(token);
      if (!parsed.ok) return { ok: false, reason: 'malformed' };
      if (parsed.header.alg !== 'HS256') return { ok: false, reason: 'bad_alg' };
      const idx = hs256MatchesAny(parsed.signingInput, parsed.signature, secrets);
      if (idx < 0) return { ok: false, reason: 'bad_signature' };
      const p = parsed.payload;
      // aud == GAME_ID is MANDATORY (a token minted for another game must not authenticate here).
      if (p.aud !== gameId) return { ok: false, reason: 'wrong_audience' };
      const iatRaw = p.iat;
      const iatMs =
        typeof iatRaw === 'number' && Number.isFinite(iatRaw)
          ? iatRaw > 1e11
            ? iatRaw
            : iatRaw * 1000
          : NaN;
      if (!Number.isFinite(iatMs)) return { ok: false, reason: 'malformed' };
      if (now - iatMs > maxAge || iatMs - now > skew) return { ok: false, reason: 'stale' };
      const player = p.player as { playerId?: unknown; registered?: unknown } | undefined;
      const fromPlayer = typeof player?.playerId === 'string' ? player.playerId : undefined;
      const sub = typeof p.sub === 'string' ? p.sub : undefined;
      const playerId = fromPlayer ?? sub;
      if (!playerId) return { ok: false, reason: 'malformed' };
      if (fromPlayer && sub && fromPlayer !== sub) return { ok: false, reason: 'sub_mismatch' };
      if (playerId !== claimedKey) return { ok: false, reason: 'sub_mismatch' };
      return {
        ok: true,
        player: { playerId, registered: player?.registered === true, iatMs, secretIndex: idx },
      };
    },
  };
}

/**
 * Mock verifier for tests and the standalone/dev platform: tokens are `mock.<playerId>.<iatMs>[.registered]`.
 * Still fails closed on empty/garbage and enforces claimed-key binding and the iat window.
 */
export function createMockIdentityVerifier(
  opts: { maxTokenAgeMs?: number; maxFutureSkewMs?: number; disabled?: boolean } = {},
): IdentityVerifier {
  const maxAge = opts.maxTokenAgeMs ?? DEFAULT_TOKEN_MAX_AGE_MS;
  const skew = opts.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
  return {
    verify(token, claimedKey, gameId, now) {
      if (opts.disabled) return { ok: false, reason: 'no_secret' };
      if (!gameId) return { ok: false, reason: 'no_secret' };
      if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
      const parts = token.split('.');
      if (parts[0] !== 'mock' || parts.length < 3) return { ok: false, reason: 'malformed' };
      const playerId = parts[1]!;
      const iatMs = Number(parts[2]);
      if (!playerId || !Number.isFinite(iatMs)) return { ok: false, reason: 'malformed' };
      if (now - iatMs > maxAge || iatMs - now > skew) return { ok: false, reason: 'stale' };
      if (playerId !== claimedKey) return { ok: false, reason: 'sub_mismatch' };
      return {
        ok: true,
        player: { playerId, registered: parts[3] === 'registered', iatMs, secretIndex: 0 },
      };
    },
  };
}

export function mintMockToken(playerId: string, iatMs: number, registered = false): string {
  return `mock.${playerId}.${iatMs}${registered ? '.registered' : ''}`;
}
