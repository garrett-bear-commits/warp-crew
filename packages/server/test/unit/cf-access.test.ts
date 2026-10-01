// Cloudflare Access tokens on admin requests: RS256 against the team's JWKS, the
// application's aud, the team's iss, exp/nbf with skew; keys cached and re-read for a new kid.
import { describe, expect, it } from 'vitest';
import {
  CF_TEST_AUD,
  CF_TEST_TEAM,
  cfTestJwks,
  cfTestKey,
  cfTestToken,
  type CfTestKey,
} from '@foundation/testkit';
import { createCfAccessVerifier, signingKeys } from '../../src/auth/cf-access.ts';
import { AppError } from '../../src/errors.ts';
import { ConfigError, loadConfig, parseCfAccess } from '../../src/config.ts';

const NOW = 1_790_000_000_000;
const k1 = cfTestKey('kid-1');
const k2 = cfTestKey('kid-2');
const CERTS = `${CF_TEST_TEAM}/cdn-cgi/access/certs`;

/** A fake certs endpoint serving `keys()`; counts reads; `down` makes it fail. */
function certs(keys: () => CfTestKey[]) {
  const s = { reads: 0, down: false, urls: [] as string[] };
  const fetch = (async (url: string) => {
    s.reads++;
    s.urls.push(url);
    if (s.down) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(cfTestJwks(...keys())), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return Object.assign(s, { fetch });
}

const config = { teamDomain: CF_TEST_TEAM, audiences: [CF_TEST_AUD] };

async function refusal(p: Promise<unknown>): Promise<{ status: number; reason: unknown }> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  const a = e as AppError;
  return { status: a.status, reason: (a.details as { reason?: unknown } | undefined)?.reason };
}

describe('Cloudflare Access token verification', () => {
  it('accepts a login and a service token from the team for this application', async () => {
    const c = certs(() => [k1]);
    const v = createCfAccessVerifier(config, { fetch: c.fetch });
    await expect(v.verify(cfTestToken({ nowMs: NOW, key: k1 }), NOW)).resolves.toEqual({
      kind: 'user',
      name: 'owner@example.test',
    });
    await expect(
      v.verify(cfTestToken({ nowMs: NOW, key: k1, service: 'abc.access' }), NOW),
    ).resolves.toEqual({ kind: 'service', name: 'abc.access' });
    // A bare-string aud and a token among several audiences pass too.
    await v.verify(cfTestToken({ nowMs: NOW, key: k1, aud: CF_TEST_AUD }), NOW);
    await v.verify(cfTestToken({ nowMs: NOW, key: k1, aud: ['other', CF_TEST_AUD] }), NOW);
    expect(c.urls).toEqual([CERTS]);
  });

  it('refuses a missing, malformed, unsigned, foreign or out-of-date token with 403', async () => {
    const v = createCfAccessVerifier(config, { fetch: certs(() => [k1]).fetch });
    const cases: Array<[string | undefined, string]> = [
      [undefined, 'cf_access_missing'],
      ['', 'cf_access_missing'],
      ['not-a-jwt', 'cf_access_malformed'],
      ['a.b.c', 'cf_access_malformed'],
      [cfTestToken({ nowMs: NOW, key: k1, alg: 'HS256' }), 'cf_access_bad_alg'],
      [cfTestToken({ nowMs: NOW, key: k1, alg: 'none' }), 'cf_access_bad_alg'],
      // Signed by another key under the team's kid.
      [cfTestToken({ nowMs: NOW, key: k2, kid: 'kid-1' }), 'cf_access_bad_signature'],
      [cfTestToken({ nowMs: NOW, key: k1, aud: ['b2'.repeat(32)] }), 'cf_access_wrong_audience'],
      [cfTestToken({ nowMs: NOW, key: k1, aud: [] }), 'cf_access_wrong_audience'],
      [
        cfTestToken({ nowMs: NOW, key: k1, iss: 'https://other.cloudflareaccess.com' }),
        'cf_access_wrong_issuer',
      ],
      [cfTestToken({ nowMs: NOW, key: k1, iss: `${CF_TEST_TEAM}/` }), 'cf_access_wrong_issuer'],
      [cfTestToken({ nowMs: NOW - 3_700_000, key: k1 }), 'cf_access_expired'],
      [cfTestToken({ nowMs: NOW, key: k1, nbfOffsetSec: 120 }), 'cf_access_not_yet_valid'],
    ];
    for (const [token, reason] of cases)
      expect(await refusal(v.verify(token, NOW)), String(token)).toEqual({ status: 403, reason });
    // A tampered payload keeps the header and signature: the signature no longer matches.
    const [h, , s] = cfTestToken({ nowMs: NOW, key: k1 }).split('.');
    const forged = Buffer.from(
      JSON.stringify({ aud: [CF_TEST_AUD], iss: CF_TEST_TEAM, exp: NOW / 1000 + 60 }),
    ).toString('base64url');
    expect(await refusal(v.verify(`${h}.${forged}.${s}`, NOW))).toEqual({
      status: 403,
      reason: 'cf_access_bad_signature',
    });
  });

  it('allows 30 s of clock skew on exp and nbf', async () => {
    const v = createCfAccessVerifier(config, { fetch: certs(() => [k1]).fetch });
    const token = cfTestToken({ nowMs: NOW, key: k1, ttlSec: 60 });
    await v.verify(token, NOW + 89_000);
    expect((await refusal(v.verify(token, NOW + 91_000))).reason).toBe('cf_access_expired');
    await v.verify(cfTestToken({ nowMs: NOW, key: k1, nbfOffsetSec: 25 }), NOW);
  });

  it('caches the keys, re-reads them for an unknown kid (rotation) at most every 10 s', async () => {
    let published = [k1];
    const c = certs(() => published);
    const v = createCfAccessVerifier(config, { fetch: c.fetch });
    await v.verify(cfTestToken({ nowMs: NOW, key: k1 }), NOW);
    await v.verify(cfTestToken({ nowMs: NOW, key: k1 }), NOW + 5_000);
    expect(c.reads).toBe(1);
    // Cloudflare starts signing with a new key before we have read it: one re-read finds it.
    published = [k2, k1];
    await expect(
      v.verify(cfTestToken({ nowMs: NOW, key: k2 }), NOW + 20_000),
    ).resolves.toMatchObject({
      kind: 'user',
    });
    expect(c.reads).toBe(2);
    // A forged kid re-reads once per 10 s, never per request.
    const stranger = cfTestKey('kid-forged');
    for (const at of [NOW + 21_000, NOW + 22_000, NOW + 25_000])
      expect((await refusal(v.verify(cfTestToken({ nowMs: at, key: stranger }), at))).reason).toBe(
        'cf_access_unknown_key',
      );
    expect(c.reads).toBe(2);
    await refusal(v.verify(cfTestToken({ nowMs: NOW + 31_000, key: stranger }), NOW + 31_000));
    expect(c.reads).toBe(3);
  });

  it('re-reads known keys hourly; a key Cloudflare dropped stops verifying', async () => {
    let published = [k1, k2];
    const c = certs(() => published);
    const v = createCfAccessVerifier(config, { fetch: c.fetch });
    await v.verify(cfTestToken({ nowMs: NOW, key: k1 }), NOW);
    published = [k2];
    const later = NOW + 60 * 60_000;
    expect((await refusal(v.verify(cfTestToken({ nowMs: later, key: k1 }), later))).reason).toBe(
      'cf_access_unknown_key',
    );
    expect(c.reads).toBe(2);
    await v.verify(cfTestToken({ nowMs: later, key: k2 }), later);
  });

  it('keeps its last keys while Cloudflare is unreachable; never read is a 503', async () => {
    const c = certs(() => [k1]);
    const errors: unknown[] = [];
    const v = createCfAccessVerifier(config, {
      fetch: c.fetch,
      onKeysError: (e) => errors.push(e),
    });
    c.down = true;
    expect(await refusal(v.verify(cfTestToken({ nowMs: NOW, key: k1 }), NOW))).toEqual({
      status: 503,
      reason: undefined,
    });
    expect(errors).toHaveLength(1);
    c.down = false;
    await v.verify(cfTestToken({ nowMs: NOW + 10_000, key: k1 }), NOW + 10_000);
    c.down = true;
    const later = NOW + 2 * 60 * 60_000;
    await v.verify(cfTestToken({ nowMs: later, key: k1 }), later);
    expect(errors).toHaveLength(2);
  });

  it('reads only RS256 signing keys from the JWKS', () => {
    const keys = signingKeys({
      keys: [
        k1.jwk,
        { ...k2.jwk, use: 'enc' },
        { ...k2.jwk, kid: 'kid-es', alg: 'ES256' },
        { kty: 'RSA', kid: 'broken', e: 'AQAB' },
        { kty: 'EC', kid: 'ec' },
        null,
      ],
    });
    expect([...keys.keys()]).toEqual(['kid-1']);
    expect(signingKeys({}).size).toBe(0);
  });
});

describe('Cloudflare Access configuration', () => {
  const base = {
    DATABASE_URL: 'postgres://x:y@localhost:5432/db',
    GAME_ID: 'template',
    GAME_ENV: 'dev',
    IDENTITY_PROVIDER: 'mock',
    PAYMENTS_PROVIDER: 'mock',
    ADMIN_KEYS: JSON.stringify({ k1: { secretSha256: 'ab'.repeat(32), scopes: ['read'] } }),
    OPS_SECRET: 'x'.repeat(20),
    RATE_LIMIT_STORE: 'memory',
  };

  it('is off when both variables are unset, and needs both to be on', () => {
    expect(loadConfig(base).cfAccess).toBeUndefined();
    expect(
      loadConfig({
        ...base,
        CF_ACCESS_TEAM_DOMAIN: `${CF_TEST_TEAM}/`,
        CF_ACCESS_AUD: ` ${CF_TEST_AUD.toUpperCase()} `,
      }).cfAccess,
    ).toEqual({ teamDomain: CF_TEST_TEAM, audiences: [CF_TEST_AUD] });
    expect(() => loadConfig({ ...base, CF_ACCESS_TEAM_DOMAIN: CF_TEST_TEAM })).toThrow(
      /must be set together/,
    );
    expect(() => loadConfig({ ...base, CF_ACCESS_AUD: CF_TEST_AUD })).toThrow(
      /must be set together/,
    );
  });

  it('refuses a team domain that is not an https origin and an AUD that is not a tag', () => {
    for (const team of [
      'example-team.cloudflareaccess.com',
      'http://example-team.cloudflareaccess.com',
      `${CF_TEST_TEAM}/cdn-cgi/access/certs`,
    ])
      expect(() => parseCfAccess(team, CF_TEST_AUD), team).toThrow(ConfigError);
    expect(() => parseCfAccess(CF_TEST_TEAM, 'my-app')).toThrow(/AUD tag/);
    expect(parseCfAccess(CF_TEST_TEAM, `${CF_TEST_AUD},${'b2'.repeat(32)}`)?.audiences).toEqual([
      CF_TEST_AUD,
      'b2'.repeat(32),
    ]);
  });
});
