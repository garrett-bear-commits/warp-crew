// A stand-in Cloudflare Access team for tests: locally generated RSA keys, their JWKS
// as `<team>/cdn-cgi/access/certs` serves it, and RS256 application tokens shaped like Access's
// (a user login carries `email`, a service token `common_name` and an empty `sub`).
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

export const CF_TEST_TEAM = 'https://foundation-test.cloudflareaccess.com';
export const CF_TEST_AUD = 'a1'.repeat(32);

export interface CfTestKey {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

export function cfTestKey(kid: string): CfTestKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}

/** The certs endpoint's body: `keys` plus the PEM fields Access also sends (ignored). */
export function cfTestJwks(...keys: CfTestKey[]): Record<string, unknown> {
  return { keys: keys.map((k) => k.jwk), public_cert: { kid: keys[0]?.kid, cert: 'unused' } };
}

export interface CfTestTokenOpts {
  nowMs: number;
  /** Signs with this key; the header still names `kid` (default key.kid). */
  key: CfTestKey;
  kid?: string;
  alg?: string;
  aud?: string | string[];
  iss?: string;
  /** Seconds after now; default 1 hour. */
  ttlSec?: number;
  nbfOffsetSec?: number;
  /** A service token (common_name = client id) instead of a login. */
  service?: string;
  email?: string;
}

const b64url = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');

export function cfTestToken(o: CfTestTokenOpts): string {
  const now = Math.floor(o.nowMs / 1000);
  const claims: Record<string, unknown> = {
    aud: o.aud ?? [CF_TEST_AUD],
    iss: o.iss ?? CF_TEST_TEAM,
    iat: now,
    nbf: now + (o.nbfOffsetSec ?? 0),
    exp: now + (o.ttlSec ?? 3600),
    type: 'app',
    ...(o.service
      ? { common_name: o.service, sub: '' }
      : { email: o.email ?? 'owner@example.test', sub: 'user-1', identity_nonce: 'n' }),
  };
  const head = b64url({ alg: o.alg ?? 'RS256', kid: o.kid ?? o.key.kid, typ: 'JWT' });
  const body = b64url(claims);
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), o.key.privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
}
