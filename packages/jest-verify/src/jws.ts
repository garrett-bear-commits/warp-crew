// Shared HS256 JWS parsing/verification for Jest player tokens and receipts.
// Hand-rolled on purpose: one algorithm, one symmetric key, a handful of claims (see Barrowdeep
// playerToken.ts). alg is PINNED; the header never chooses the algorithm.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const b64urlToBuf = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export type JwsParse =
  | {
      ok: true;
      header: Record<string, unknown>;
      payload: Record<string, unknown>;
      signingInput: string;
      signature: Buffer;
    }
  | { ok: false; reason: 'malformed' };

export function parseJws(token: string): JwsParse {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts as [string, string, string];
  if (!h || !p || !s) return { ok: false, reason: 'malformed' };
  try {
    const header = JSON.parse(b64urlToBuf(h).toString('utf8')) as unknown;
    const payload = JSON.parse(b64urlToBuf(p).toString('utf8')) as unknown;
    if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object')
      return { ok: false, reason: 'malformed' };
    return {
      ok: true,
      header: header as Record<string, unknown>,
      payload: payload as Record<string, unknown>,
      signingInput: `${h}.${p}`,
      signature: b64urlToBuf(s),
    };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/** Constant-time HS256 check against ONE base64-encoded secret. */
export function hs256Matches(signingInput: string, signature: Buffer, secretB64: string): boolean {
  const expected = createHmac('sha256', Buffer.from(secretB64, 'base64'))
    .update(signingInput)
    .digest();
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(expected, signature);
}

/** Try each secret in the rotation list; return the index that matched or -1. */
export function hs256MatchesAny(
  signingInput: string,
  signature: Buffer,
  secretsB64: readonly string[],
): number {
  let matched = -1;
  for (let i = 0; i < secretsB64.length; i++) {
    // Evaluate every secret (no early exit) so timing does not reveal which slot matched.
    if (hs256Matches(signingInput, signature, secretsB64[i]!) && matched === -1) matched = i;
  }
  return matched;
}
