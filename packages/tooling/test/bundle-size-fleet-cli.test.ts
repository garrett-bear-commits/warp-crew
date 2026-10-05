// bundle-size gate (§3), fleet.json shape (§8), CLI dispatch/usage.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import {
  measureBundle,
  checkBundleSize,
  runBundleSizeMain,
  validateFleet,
  loadFleet,
  cliMain,
  usageLines,
  parseArgs,
} from '../src/index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function withTmp<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), 'foundation-misc-'));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe('bundle-size', () => {
  it('sums gzip sizes of js/css only and gates on the budget', async () => {
    await withTmp((tmp) => {
      const dist = join(tmp, 'dist');
      mkdirSync(join(dist, 'assets'), { recursive: true });
      const js = 'x'.repeat(5000);
      const css = 'body{margin:0}'.repeat(50);
      writeFileSync(join(dist, 'assets', 'app.js'), js);
      writeFileSync(join(dist, 'assets', 'app.css'), css);
      writeFileSync(join(dist, 'index.html'), '<p>' + 'y'.repeat(10_000) + '</p>');
      writeFileSync(join(dist, 'assets', 'logo.png'), Buffer.alloc(20_000, 1));
      const r = measureBundle(dist);
      expect(r.files.map((f) => f.path).sort()).toEqual(['assets/app.css', 'assets/app.js']);
      const expected = gzipSync(js, { level: 9 }).length + gzipSync(css, { level: 9 }).length;
      expect(r.totalGzipBytes).toBe(expected);
      expect(checkBundleSize(dist, expected).ok).toBe(true);
      expect(checkBundleSize(dist, expected - 1).ok).toBe(false);
      expect(checkBundleSize(dist, expected - 1).lines.at(-1)).toMatch(/FAIL \(over by 1 B\)/);
      const lines: string[] = [];
      expect(runBundleSizeMain([dist, String(expected)], (l) => lines.push(l))).toBe(0);
      expect(runBundleSizeMain([dist, '1'], (l) => lines.push(l))).toBe(1);
      expect(runBundleSizeMain([], (l) => lines.push(l))).toBe(1);
      expect(runBundleSizeMain([join(tmp, 'nope'), '10'], (l) => lines.push(l))).toBe(1);
    });
  });

  it('CLI accepts --dist/--max-bytes and positionals; the standalone script path works for CI', async () => {
    await withTmp(async (tmp) => {
      const dist = join(tmp, 'dist');
      mkdirSync(dist);
      writeFileSync(join(dist, 'a.js'), 'const a = 1;');
      const io = { log: () => {}, error: () => {} };
      expect(await cliMain(['bundle-size', '--dist', dist, '--max-bytes', '600000'], io)).toBe(0);
      expect(await cliMain(['bundle-size', dist, '600000'], io)).toBe(0);
      expect(await cliMain(['bundle-size', dist, '1'], io)).toBe(1);
      expect(await cliMain(['bundle-size', dist], io)).toBe(1);
      const script = resolve(root, 'packages/tooling/src/bundle-size.ts');
      const out = execFileSync(
        process.execPath,
        ['--experimental-strip-types', script, dist, '600000'],
        { encoding: 'utf8' },
      );
      expect(out).toContain('bundle-size: OK');
    });
  });
});

describe('fleet.json', () => {
  it('the repo fleet.json validates and holds host-neutral fields only', () => {
    const r = loadFleet();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.fleet.some((e) => e.game === 'template')).toBe(true);
    const raw = readFileSync(resolve(root, 'fleet.json'), 'utf8');
    expect(raw).not.toMatch(/cloudflare|railway/i);
  });

  it('validateFleet reports shape problems', () => {
    expect(validateFleet({}).ok).toBe(false);
    const r = validateFleet({
      fleet: [
        {
          name: 'ok',
          game: 'g',
          env: 'lab',
          apiUrl: 'https://a.test',
          staticUrl: 'https://s.test',
        },
        {
          name: 'ok',
          game: 'G!',
          env: 'staging',
          apiUrl: 'ftp://x',
          staticUrl: 'nope',
          railwayProjectId: 'x',
        },
      ],
    });
    expect(r.ok).toBe(false);
    const p = r.problems.join('\n');
    expect(p).toMatch(/fleet\[1\]\.name "ok" duplicated/);
    expect(p).toMatch(/fleet\[1\]\.game must match/);
    expect(p).toMatch(/fleet\[1\]\.env must be prod\|lab\|dev/);
    expect(p).toMatch(/fleet\[1\]\.apiUrl must be an http\(s\) URL/);
    expect(p).toMatch(/fleet\[1\]\.staticUrl must be an http\(s\) URL/);
    expect(p).toMatch(/unknown fields: railwayProjectId/);
    expect(r.fleet.length).toBe(1);
  });

  it('CLI fleet --check', async () => {
    const lines: string[] = [];
    const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
    expect(await cliMain(['fleet', '--check'], io)).toBe(0);
    expect(lines.join('\n')).toMatch(/fleet: OK \(\d+ entries\)/);
    await withTmp(async (tmp) => {
      const f = join(tmp, 'fleet.json');
      writeFileSync(f, JSON.stringify({ fleet: [{ name: 'x' }] }));
      lines.length = 0;
      expect(await cliMain(['fleet', '--check', '--file', f], io)).toBe(1);
      expect(lines.join('\n')).toMatch(/problem:/);
    });
  });
});

describe('cli dispatch', () => {
  it('prints usage for no/unknown/help commands and parses args', async () => {
    const lines: string[] = [];
    const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
    expect(await cliMain([], io)).toBe(1);
    expect(await cliMain(['help'], io)).toBe(0);
    expect(await cliMain(['nope'], io)).toBe(1);
    expect(lines.join('\n')).toContain('unknown command: nope');
    for (const cmd of [
      'deploy-static',
      'zip',
      'check-health',
      'preflight',
      'new-server',
      'new-feature',
      'manifest-check',
      'manifest-write',
      'bundle-size',
      'fleet',
    ]) {
      expect(usageLines().join('\n')).toContain(`  ${cmd}`);
    }
    expect(parseArgs(['--a', '1', '--b=2', 'pos', '--flag', '--', '--notflag'])).toEqual({
      positionals: ['pos', '--notflag'],
      options: { a: '1', b: '2', flag: true },
    });
  });

  it('runs end-to-end through node --experimental-strip-types (pnpm foundation)', () => {
    const script = resolve(root, 'packages/tooling/src/cli.ts');
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', script, 'fleet', '--check'],
      { encoding: 'utf8', cwd: root },
    );
    expect(out).toContain('fleet: OK');
  });
});
