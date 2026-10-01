// Cloudflare Access in front of the production admin origin. Access lets a request
// through only for an operator's login or the admin CLI's service token, and then signs it: an
// application token in `Cf-Access-Jwt-Assertion` (RS256 under the team's keys at
// `<team domain>/cdn-cgi/access/certs`, `iss` the team domain, `aud` the application's AUD tag).
// A user token carries `email`, a service token `common_name` (its client id) and an empty `sub`.
// A hosted service is often also reachable on its platform name (e.g. *.up.railway.app), which
// skips Access, so with CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD set the API refuses every admin
// request whose token it cannot verify. Unset (staging, local) nothing is checked.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { AppError } from '../errors.ts';

/** The request header Access adds to every request it lets through (lowercase, as Node has it). */
export const CF_ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

export interface CfAccessConfig {
  /** `https://<team>.cloudflareaccess.com`: the tokens' `iss`, and where the signing keys are. */
  teamDomain: string;
  /** The Access application's AUD tag (more than one while an application is replaced). */
  audiences: string[];
}

export type CfAccessRejection =
  | 'missing'
  | 'malformed'
  | 'bad_alg'
  | 'unknown_key'
  | 'bad_signature'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'not_yet_valid';

/** Who Access let through: a person's login (email) or a service token (its client id). */
export interface CfAccessIdentity {
  kind: 'user' | 'service';
  name: string;
}

export interface CfAccessVerifier {
  /** The identity on a valid token; a 403 `forbidden` (details.reason) otherwise. A 503
   *  `retry_later` when Cloudflare's keys were never readable. */
  verify(token: string | undefined, nowMs: number): Promise<CfAccessIdentity>;
}

export interface CfAccessOptions {
  fetch?: typeof fetch;
  /** Known keys are re-read after this long, so a key Cloudflare drops stops verifying. */
  maxKeyAgeMs?: number;
  /** Key reads are at most this frequent: a token with a forged kid cannot hammer Cloudflare. */
  minRefetchMs?: number;
  /** Clock skew allowed on `exp` and `nbf`. */
  skewSec?: number;
  timeoutMs?: number;
  /** Told when the keys could not be read (the verifier keeps its last good keys). */
  onKeysError?: (error: unknown) => void;
}

const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_CHARS = 16 * 1024;

export function cfAccessCertsUrl(teamDomain: string): string {
  return `${teamDomain}/cdn-cgi/access/certs`;
}

function rejection(reason: CfAccessRejection): AppError {
  return new AppError(
    'forbidden',
    reason === 'missing'
      ? 'Cloudflare Access token required'
      : `Cloudflare Access token rejected (${reason})`,
    { reason: `cf_access_${reason}` },
  );
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** RS256 signing keys by kid from a JWKS body; other key types and broken entries are skipped. */
export function signingKeys(body: unknown): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  const list = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) return keys;
  for (const jwk of list as unknown[]) {
    if (!jwk || typeof jwk !== 'object') continue;
    const { kid, kty, use, alg } = jwk as Record<string, unknown>;
    if (typeof kid !== 'string' || !kid || kty !== 'RSA') continue;
    if ((use !== undefined && use !== 'sig') || (alg !== undefined && alg !== 'RS256')) continue;
    try {
      keys.set(kid, createPublicKey({ key: jwk as never, format: 'jwk' }));
    } catch {
      // A malformed entry never hides the good ones.
    }
  }
  return keys;
}

export function createCfAccessVerifier(
  config: CfAccessConfig,
  o: CfAccessOptions = {},
): CfAccessVerifier {
  const doFetch = o.fetch ?? globalThis.fetch;
  const maxKeyAgeMs = o.maxKeyAgeMs ?? 60 * 60_000;
  const minRefetchMs = o.minRefetchMs ?? 10_000;
  const skewSec = o.skewSec ?? 30;
  const timeoutMs = o.timeoutMs ?? 5_000;
  const certsUrl = cfAccessCertsUrl(config.teamDomain);

  let keys: Map<string, KeyObject> | null = null;
  let fetchedAt = -Infinity;
  let attemptedAt = -Infinity;
  let inflight: Promise<void> | null = null;

  async function readKeys(): Promise<Map<string, KeyObject>> {
    const res = await doFetch(certsUrl, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${certsUrl} answered HTTP ${res.status}`);
    const found = signingKeys(await res.json());
    if (!found.size) throw new Error(`${certsUrl} has no RS256 signing key`);
    return found;
  }

  /** One read at a time; concurrent requests share it. */
  function refresh(now: number): Promise<void> {
    if (!inflight) {
      attemptedAt = now;
      inflight = readKeys()
        .then((found) => {
          keys = found;
          fetchedAt = now;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  async function keyFor(kid: string, now: number): Promise<KeyObject> {
    const known = keys?.get(kid);
    if (known && now - fetchedAt < maxKeyAgeMs) return known;
    // Stale keys, or a kid we have not seen (Cloudflare rotates its key every 6 weeks).
    if (inflight || now - attemptedAt >= minRefetchMs) {
      try {
        await refresh(now);
      } catch (error) {
        o.onKeysError?.(error);
      }
    }
    const key = keys?.get(kid);
    if (key) return key;
    if (!keys) throw new AppError('retry_later', 'Cloudflare Access signing keys are unavailable');
    throw rejection('unknown_key');
  }

  return {
    async verify(token, nowMs) {
      if (!token) throw rejection('missing');
      if (token.length > MAX_TOKEN_CHARS || !TOKEN.test(token)) throw rejection('malformed');
      const [h, p, s] = token.split('.') as [string, string, string];
      const header = decodeJson(h);
      const claims = decodeJson(p);
      if (!header || !claims) throw rejection('malformed');
      if (header.alg !== 'RS256') throw rejection('bad_alg');
      if (typeof header.kid !== 'string' || !header.kid) throw rejection('malformed');
      const key = await keyFor(header.kid, nowMs);
      let signed = false;
      try {
        signed = verifySignature(
          'sha256',
          Buffer.from(`${h}.${p}`),
          key,
          Buffer.from(s, 'base64url'),
        );
      } catch {
        signed = false;
      }
      if (!signed) throw rejection('bad_signature');
      if (claims.iss !== config.teamDomain) throw rejection('wrong_issuer');
      const aud = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
      if (
        !Array.isArray(aud) ||
        !aud.some((a) => typeof a === 'string' && config.audiences.includes(a))
      )
        throw rejection('wrong_audience');
      const nowSec = nowMs / 1000;
      if (typeof claims.exp !== 'number') throw rejection('malformed');
      if (nowSec > claims.exp + skewSec) throw rejection('expired');
      if (typeof claims.nbf === 'number' && nowSec + skewSec < claims.nbf)
        throw rejection('not_yet_valid');
      if (typeof claims.common_name === 'string' && claims.common_name)
        return { kind: 'service', name: claims.common_name };
      const email = typeof claims.email === 'string' ? claims.email : '';
      return { kind: 'user', name: email || (typeof claims.sub === 'string' ? claims.sub : '') };
    },
  };
}
