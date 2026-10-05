// check-health: injected fetch; non-zero on 503 / not ready; ops secret header; fleet lookup.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkHealth } from '../src/index.ts';
import { run as runCheckHealth } from '../src/commands/check-health.ts';

type Route = { status: number; body: unknown };

function fakeFetch(
  routes: Record<string, Route>,
  seen: Array<{ url: string; headers: Record<string, string> }> = [],
) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
    const path = new URL(url).pathname + new URL(url).search;
    const r = routes[path];
    if (!r) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const READY = {
  status: 'ready',
  serverNow: 1,
  contractVersion: '1.0.0',
  checks: {
    db: true,
    migrationsAtHead: true,
    schemaHead: '0007',
    secretsPresent: true,
    secretByteLengths: [32],
    adminKeyCount: 1,
  },
  gameId: 'template',
  env: 'lab',
  buildVersion: '1.2.3',
};
const OPS_OK = {
  status: 'ok',
  serverNow: 1,
  windowMinutes: 15,
  outbox: { pending: 0, lagSeconds: 0, deadLetters: 0 },
  saves: { anchored: 10, quarantined: 0, refused: 0, pendingReviews: 0 },
  issues: [],
  restoreVerifiedAt: 1_700_000_000_000,
};

describe('checkHealth', () => {
  it('passes when ready + ops 200 and sends the ops secret header', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const f = fakeFetch(
      {
        '/health/ready': { status: 200, body: READY },
        '/health/ops?assert=page': { status: 200, body: OPS_OK },
      },
      seen,
    );
    const r = await checkHealth({
      url: 'http://api.test/',
      assert: 'page',
      opsSecret: 'ops-secret-value-16+',
      fetch: f,
    });
    expect(r.ok).toBe(true);
    expect(seen[0]!.url).toBe('http://api.test/health/ready');
    expect(seen[1]!.url).toBe('http://api.test/health/ops?assert=page');
    expect(seen[1]!.headers['x-ops-secret']).toBe('ops-secret-value-16+');
    expect(r.lines.join('\n')).toMatch(
      /ready: HTTP 200 status=ready game=template env=lab build=1.2.3/,
    );
    expect(r.lines.join('\n')).toMatch(/\[ok\]\s+db/);
    expect(r.lines.join('\n')).toMatch(/restoreVerifiedAt=2023-11-14T22:13:20.000Z/);
  });

  it('fails on not_ready (503) and on ops assert 503, listing issues', async () => {
    const notReady = {
      ...READY,
      status: 'not_ready',
      checks: { ...READY.checks, migrationsAtHead: false },
    };
    const r1 = await checkHealth({
      url: 'http://api.test',
      fetch: fakeFetch({ '/health/ready': { status: 503, body: notReady } }),
    });
    expect(r1.ok).toBe(false);
    expect(r1.lines.join('\n')).toMatch(/\[FAIL\] migrationsAtHead/);

    const paged = {
      ...OPS_OK,
      status: 'page',
      issues: [{ tier: 'page', code: 'outbox_dead_letters', message: '3 dead letters' }],
    };
    const r2 = await checkHealth({
      url: 'http://api.test',
      assert: 'page',
      fetch: fakeFetch({
        '/health/ready': { status: 200, body: READY },
        '/health/ops?assert=page': { status: 503, body: paged },
      }),
    });
    expect(r2.ok).toBe(false);
    expect(r2.lines.join('\n')).toContain('[page] outbox_dead_letters 3 dead letters');
  });

  it('reports unreachable servers as failures', async () => {
    const f = (async () => {
      throw new TypeError('ECONNREFUSED');
    }) as typeof fetch;
    const r = await checkHealth({ url: 'http://api.test', fetch: f });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toMatch(/unreachable/);
  });

  it('CLI resolves --fleet <name> from a fleet file and validates --assert', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'foundation-health-'));
    try {
      const fleetFile = join(tmp, 'fleet.json');
      writeFileSync(
        fleetFile,
        JSON.stringify({
          fleet: [
            {
              name: 'g-lab',
              game: 'g',
              env: 'lab',
              apiUrl: 'http://api.test',
              staticUrl: 'http://static.test',
            },
          ],
        }),
      );
      const lines: string[] = [];
      const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
      const f = fakeFetch({
        '/health/ready': { status: 200, body: READY },
        '/health/ops?assert=warn': { status: 200, body: OPS_OK },
      });
      expect(
        await runCheckHealth(
          ['--fleet', 'g-lab', '--fleet-file', fleetFile, '--assert', 'warn'],
          io,
          f,
        ),
      ).toBe(0);
      expect(lines.join('\n')).toContain('check-health: OK');
      await expect(
        runCheckHealth(['--url', 'http://api.test', '--assert', 'nope'], io, f),
      ).rejects.toThrow(/--assert must be page or warn/);
      await expect(
        runCheckHealth(['--fleet', 'missing', '--fleet-file', fleetFile], io, f),
      ).rejects.toThrow(/not found/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
