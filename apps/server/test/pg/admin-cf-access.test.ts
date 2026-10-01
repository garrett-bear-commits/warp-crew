// A production admin origin can sit behind Cloudflare Access. The admin service is often also
// reachable on its own platform domain, which skips Access, so with CF_ACCESS_* set the API
// itself refuses an admin request without a valid Access token, before the key check.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { FastifyInstance } from 'fastify';
import { CF_TEST_AUD, CF_TEST_TEAM, cfTestJwks, cfTestKey, cfTestToken } from '@foundation/testkit';
import { buildAdminOrigin } from '../../src/admin-static.ts';
import { setupHarness, ADMIN_SECRET, T0, type Harness } from './harness.ts';

const key = cfTestKey('team-key-1');
const certReads: string[] = [];
const certsFetch = (async (url: string) => {
  certReads.push(url);
  return new Response(JSON.stringify(cfTestJwks(key)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as unknown as typeof fetch;

const logLines: Array<Record<string, unknown>> = [];
const log = pino(
  { level: 'info' },
  { write: (line: string) => void logLines.push(JSON.parse(line) as Record<string, unknown>) },
);

let h: Harness;
let plain: Harness;
let admin: FastifyInstance;
let dist: string;

beforeAll(async () => {
  h = await setupHarness({
    prefix: 'cfaccess',
    cfAccess: { teamDomain: CF_TEST_TEAM, audiences: [CF_TEST_AUD] },
    cfAccessFetch: certsFetch,
    log,
  });
  plain = await setupHarness({ prefix: 'cfaccess_off' });
  dist = mkdtempSync(join(tmpdir(), 'admin-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Operator console</title>');
  admin = (await buildAdminOrigin(h.config, pino({ level: 'silent' }), {
    api: h.server,
    distDir: dist,
  }))!;
  await admin.ready();
});
afterAll(async () => {
  await admin?.close();
  await h?.close();
  await plain?.close();
  rmSync(dist, { recursive: true, force: true });
});

const login = () => cfTestToken({ nowMs: T0, key });
const reader = { 'x-admin-key-id': 'reader', 'x-admin-secret': ADMIN_SECRET };
const actions = (headers: Record<string, string>, ip = '198.51.100.20') =>
  h.inject({ method: 'GET', url: '/admin/v1/actions', headers, remoteAddress: ip });

describe('admin API behind Cloudflare Access', () => {
  it('serves a request carrying an Access login or service token and a valid key', async () => {
    const user = await actions({ ...reader, 'cf-access-jwt-assertion': login() });
    expect(user.statusCode).toBe(200);
    const service = await actions({
      ...reader,
      'cf-access-jwt-assertion': cfTestToken({ nowMs: T0, key, service: 'cli.access' }),
    });
    expect(service.statusCode).toBe(200);
    // Access lets the request through; the admin key is still required.
    const badKey = await actions({
      'x-admin-key-id': 'reader',
      'x-admin-secret': 'wrong',
      'cf-access-jwt-assertion': login(),
    });
    expect(badKey.statusCode).toBe(401);
    expect(certReads).toEqual([`${CF_TEST_TEAM}/cdn-cgi/access/certs`]);
  });

  it('refuses a request without a valid token with a 403 envelope, logged as a warning', async () => {
    logLines.length = 0;
    const cases: Array<[Record<string, string>, string]> = [
      [{}, 'cf_access_missing'],
      [{ 'cf-access-jwt-assertion': 'garbage' }, 'cf_access_malformed'],
      [
        { 'cf-access-jwt-assertion': cfTestToken({ nowMs: T0, key, aud: ['b2'.repeat(32)] }) },
        'cf_access_wrong_audience',
      ],
      [
        {
          'cf-access-jwt-assertion': cfTestToken({
            nowMs: T0,
            key,
            iss: 'https://other.cloudflareaccess.com',
          }),
        },
        'cf_access_wrong_issuer',
      ],
      [
        { 'cf-access-jwt-assertion': cfTestToken({ nowMs: T0 - 2 * 3_600_000, key }) },
        'cf_access_expired',
      ],
      [
        { 'cf-access-jwt-assertion': cfTestToken({ nowMs: T0, key: cfTestKey('team-key-1') }) },
        'cf_access_bad_signature',
      ],
    ];
    for (const [extra, reason] of cases) {
      const r = await actions({ ...reader, 'x-request-id': `cf-${reason}`, ...extra });
      expect(r.statusCode, reason).toBe(403);
      expect(r.json()).toEqual({
        error: 'forbidden',
        message: expect.stringMatching(/^Cloudflare Access token (required|rejected)/),
        correlationId: `cf-${reason}`,
        serverNow: T0,
        details: { reason },
      });
    }
    const refused = logLines.filter((l) => l.msg === 'request refused');
    expect(refused).toHaveLength(cases.length);
    for (const l of refused) expect(l).toMatchObject({ level: 40, status: 403, code: 'forbidden' });
  });

  it("counts refusals toward the operator's ip.authfail, like a bad key", async () => {
    for (let i = 0; i < 60; i++)
      expect((await actions(reader, '203.0.113.40')).statusCode).toBe(403);
    const limited = await actions(reader, '203.0.113.40');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'rate_limited' });
    // Another address is unaffected; only failures count, so a valid token still passes.
    expect((await actions(reader, '203.0.113.41')).statusCode).toBe(403);
    const ok = await actions({ ...reader, 'cf-access-jwt-assertion': login() }, '203.0.113.40');
    expect(ok.statusCode).toBe(200);
  });

  it('the in-process admin origin forwards the Access token like the admin service', async () => {
    const via = (extra: Record<string, string>) =>
      admin.inject({
        method: 'GET',
        url: '/admin/v1/actions',
        headers: { ...reader, 'x-real-ip': '198.51.100.30', ...extra },
      });
    expect((await via({ 'cf-access-jwt-assertion': login() })).statusCode).toBe(200);
    const missing = await via({});
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toMatchObject({ details: { reason: 'cf_access_missing' } });
  });

  it('checks nothing when CF_ACCESS_* are unset (staging, local)', async () => {
    const r = await plain.inject({
      method: 'GET',
      url: '/admin/v1/actions',
      headers: plain.adminHeaders('reader'),
    });
    expect(r.statusCode).toBe(200);
    expect(plain.server.ctx.cfAccess).toBeNull();
  });
});
