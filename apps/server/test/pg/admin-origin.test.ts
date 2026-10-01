// Admin origin (ADR-021): the inspector's own origin forwards /admin/v1/* (only) into the
// API in-process, so support can reach the admin API without the API having a public domain.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildAdminOrigin, startAdminInspector } from '../../src/admin-static.ts';
import { setupHarness, saveBody, ADMIN_SECRET, type Harness } from './harness.ts';

let h: Harness;
let admin: FastifyInstance;
let dist: string;
const log = pino({ level: 'silent' });

beforeAll(async () => {
  h = await setupHarness({ prefix: 'adminorigin' });
  dist = mkdtempSync(join(tmpdir(), 'admin-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Operator console</title>');
  admin = (await buildAdminOrigin(h.config, log, { api: h.server, distDir: dist }))!;
  await admin.ready();
});
afterAll(async () => {
  await admin?.close();
  await h?.close();
  rmSync(dist, { recursive: true, force: true });
});

/** A request to the admin origin from an operator behind Railway's edge. */
const viaAdmin = (o: InjectOptions & { ip?: string }) => {
  const { ip, ...rest } = o;
  return admin.inject({
    ...rest,
    headers: { 'x-real-ip': ip ?? '198.51.100.10', ...(rest.headers ?? {}) },
  });
};
const put = (player: string, progress: number) =>
  h.inject({
    method: 'PUT',
    url: '/v1/saves',
    headers: h.playerHeaders(player),
    payload: saveBody({ progress }, { v: 1, counter: progress, gold: 1 }),
  });

describe('admin origin serves the inspector', () => {
  it('serves the page with a strict CSP whose connect-src is this origin', async () => {
    const r = await viaAdmin({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Operator console');
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toContain(`default-src 'none'`);
    expect(csp).toContain(`connect-src 'self'`);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(r.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'cache-control': 'no-store',
    });
  });

  it('keeps self in connect-src when PUBLIC_URL names another origin', async () => {
    const other = (await buildAdminOrigin(
      { ...h.config, publicUrl: 'https://staging.example.com/' },
      log,
      { api: h.server, distDir: dist },
    ))!;
    const r = await other.inject({ method: 'GET', url: '/' });
    expect(r.headers['content-security-policy']).toContain(
      `connect-src 'self' https://staging.example.com;`,
    );
    await other.close();
  });

  it('404s everything of the API outside /admin/v1/', async () => {
    const player = h.playerHeaders('nosy');
    const attempts: InjectOptions[] = [
      { method: 'GET', url: '/v1/saves/current', headers: player },
      { method: 'PUT', url: '/v1/saves', headers: player, payload: saveBody() },
      { method: 'GET', url: '/v1/config' },
      { method: 'GET', url: '/health' },
      { method: 'GET', url: '/health/ready' },
      { method: 'GET', url: '/health/ops', headers: h.opsHeaders() },
      { method: 'POST', url: '/qa/v1/identity/mint', headers: h.opsHeaders(), payload: {} },
      { method: 'GET', url: '/api/v1/config' },
      { method: 'GET', url: '/admin/v2/actions', headers: h.adminHeaders() },
      { method: 'GET', url: '/admin/v1/../../v1/config', headers: h.adminHeaders() },
      { method: 'GET', url: '/admin/v1/%2e%2e/%2E%2E/health/ops', headers: h.opsHeaders() },
      { method: 'GET', url: '/admin/actions', headers: h.adminHeaders() },
    ];
    for (const a of attempts) {
      const r = await viaAdmin(a);
      expect(r.statusCode, `${a.method} ${a.url}`).toBe(404);
      expect(r.json(), `${a.method} ${a.url}`).toMatchObject({ error: 'not_found' });
      expect(r.headers['cache-control']).toBe('no-store');
    }
    // Same requests straight to the API do answer: the 404s come from the admin origin.
    expect((await h.inject({ method: 'GET', url: '/v1/config' })).statusCode).toBe(200);
  });
});

describe('admin origin forwards /admin/v1 to the API', () => {
  it('a read-only key finds a player and reads profile, timeline, save history and a full save', async () => {
    expect((await put('sup1', 10)).statusCode).toBe(200);
    expect((await put('sup1', 20)).statusCode).toBe(200);
    const reader = h.adminHeaders('reader');
    // The inspector's sign-in check goes through the same forwarder.
    const session = await viaAdmin({ method: 'GET', url: '/admin/v1/session', headers: reader });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ keyId: 'reader', scopes: ['read'] });
    const profile = await viaAdmin({
      method: 'GET',
      url: '/admin/v1/players/sup1',
      headers: reader,
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.headers['cache-control']).toBe('no-store');
    expect(profile.json()).toMatchObject({ playerKey: 'sup1' });
    const timeline = await viaAdmin({
      method: 'GET',
      url: '/admin/v1/players/sup1/timeline',
      headers: reader,
    });
    expect(timeline.statusCode).toBe(200);
    const history = await viaAdmin({
      method: 'GET',
      url: '/admin/v1/players/sup1/saves?limit=1',
      headers: reader,
    });
    expect(history.statusCode).toBe(200);
    // The query string reaches the API: one item of two.
    expect(history.json().items).toHaveLength(1);
    const seq = history.json().items[0].seq as number;
    const blob = await viaAdmin({
      method: 'GET',
      url: `/admin/v1/players/sup1/saves/${seq}/blob`,
      headers: reader,
    });
    expect(blob.statusCode).toBe(200);
    expect(JSON.parse(blob.json().blob)).toEqual({ v: 1, counter: 20, gold: 1 });
  });

  it('a write key restores a save to an earlier point; it is audited; a read key is refused', async () => {
    await put('sup2', 10);
    await put('sup2', 20);
    const body = { playerKey: 'sup2', seq: 1, expectedGeneration: 0, reason: 'admin origin drill' };
    const denied = await viaAdmin({
      method: 'POST',
      url: '/admin/v1/players/restore',
      headers: h.adminHeaders('reader'),
      payload: { ...body, commandId: h.uuid() },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'forbidden', details: { required: 'restore' } });

    const commandId = h.uuid();
    const r = await viaAdmin({
      method: 'POST',
      url: '/admin/v1/players/restore',
      headers: { ...h.adminHeaders('full'), 'x-request-id': 'drill-restore-1' },
      payload: { ...body, commandId },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-request-id']).toBe('drill-restore-1');
    expect(r.json()).toMatchObject({ generation: 1, kind: 'admin_restore', seedSeq: 1 });
    const audit =
      await h.root`SELECT admin_key_id, command_type, target, reason, request_id FROM admin_actions WHERE command_id = ${commandId}`;
    expect(audit[0]).toEqual({
      admin_key_id: 'full',
      command_type: 'lineage.adminRestore',
      target: 'sup2',
      reason: 'admin origin drill',
      request_id: 'drill-restore-1',
    });
    const actions = await viaAdmin({
      method: 'GET',
      url: '/admin/v1/actions',
      headers: h.adminHeaders('reader'),
    });
    expect(actions.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ commandType: 'lineage.adminRestore', target: 'sup2' }),
      ]),
    );
    // Idempotency-Key reaches the API: the retry is the same command.
    const retry = await viaAdmin({
      method: 'POST',
      url: '/admin/v1/players/restore',
      headers: { ...h.adminHeaders('full'), 'idempotency-key': commandId },
      payload: body,
    });
    expect(retry.json()).toMatchObject({ generation: 1, duplicate: true });
    const current = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: h.playerHeaders('sup2'),
    });
    expect(current.json().generation).toBe(1);
    expect(JSON.parse(current.json().blob)).toEqual({ v: 1, counter: 10, gold: 1 });
  });

  it('a rejected key gets the API error envelope unchanged', async () => {
    const headers = {
      'x-admin-key-id': 'full',
      'x-admin-secret': 'wrong',
      'x-request-id': 'bad-1',
    };
    const direct = await h.inject({ method: 'GET', url: '/admin/v1/actions', headers });
    const r = await viaAdmin({
      method: 'GET',
      url: '/admin/v1/actions',
      headers,
      ip: '192.0.2.50',
    });
    expect(r.statusCode).toBe(401);
    expect(r.headers['content-type']).toBe(direct.headers['content-type']);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual(direct.json());
    expect(r.json()).toEqual({
      error: 'unauthorized',
      message: 'admin credentials rejected',
      correlationId: 'bad-1',
      serverNow: h.clock.now(),
    });
  });

  it("auth failures count against the operator's address, not the admin origin's", async () => {
    const bad = { 'x-admin-key-id': 'full', 'x-admin-secret': 'wrong' };
    const get = (ip: string | undefined, extra: Record<string, string> = {}, remote?: string) =>
      admin.inject({
        method: 'GET',
        url: '/admin/v1/actions',
        headers: { ...bad, ...(ip ? { 'x-real-ip': ip } : {}), ...extra },
        ...(remote ? { remoteAddress: remote } : {}),
      });
    for (let i = 0; i < 60; i++) expect((await get('203.0.113.7')).statusCode).toBe(401);
    const limited = await get('203.0.113.7');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'rate_limited' });
    // A spoofed X-Forwarded-For does not move the operator to another bucket.
    expect((await get('203.0.113.7', { 'x-forwarded-for': '203.0.113.99' })).statusCode).toBe(429);
    // Another operator, and one reaching the origin directly (no edge header), are unaffected.
    expect((await get('203.0.113.8')).statusCode).toBe(401);
    expect((await get(undefined, {}, '198.51.100.77')).statusCode).toBe(401);
    // A good key from the limited address still authenticates (only failures are counted).
    const ok = await admin.inject({
      method: 'GET',
      url: '/admin/v1/actions',
      headers: {
        'x-admin-key-id': 'reader',
        'x-admin-secret': ADMIN_SECRET,
        'x-real-ip': '203.0.113.7',
      },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('admin origin over HTTP', () => {
  it('listens on ADMIN_PORT and answers the page and a forwarded admin read', async () => {
    await put('http1', 10);
    const started = (await startAdminInspector(h.config, log, { api: h.server, distDir: dist }))!;
    try {
      const base = `http://127.0.0.1:${started.port}`;
      const page = await fetch(`${base}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain(`connect-src 'self'`);
      const profile = await fetch(`${base}/admin/v1/players/http1`, {
        headers: h.adminHeaders('reader'),
      });
      expect(profile.status).toBe(200);
      expect(profile.headers.get('cache-control')).toBe('no-store');
      expect(await profile.json()).toMatchObject({ playerKey: 'http1' });
      expect((await fetch(`${base}/v1/config`)).status).toBe(404);
    } finally {
      await started.close();
    }
  });
});
