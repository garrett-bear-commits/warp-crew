// deploy-static (ADR-023 / §10): hashed immutable v/<id>/ layout, in-place hash-verified swap,
// history kept, --verify catches tampering.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planRelease,
  rewriteIndexHtml,
  deployStatic,
  verifyRelease,
  hashDir,
  sha256Hex,
  readContractVersion,
  HEADERS_POLICY,
  cliMain,
} from '../src/index.ts';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'foundation-deploy-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function makeDist(dir: string, jsBody = 'console.log(1)'): void {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const jsHash = sha256Hex(jsBody).slice(0, 8);
  writeFileSync(join(dir, 'assets', `index-${jsHash}.js`), jsBody);
  writeFileSync(join(dir, 'assets', 'index-abc.css'), 'body{margin:0}');
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html><head><script type="module" src="./assets/index-${jsHash}.js"></script><link rel="stylesheet" href="/assets/index-abc.css"></head><body></body></html>`,
  );
}

describe('planRelease', () => {
  it('is content-addressed (takenAt excluded) and sorts files', () => {
    const files = { 'b.js': 'bb', 'a.js': 'aa' };
    const a = planRelease({
      game: 'g',
      env: 'lab',
      buildVersion: '1',
      contractVersion: '1.0.0',
      takenAt: 't1',
      files,
    });
    const b = planRelease({
      game: 'g',
      env: 'lab',
      buildVersion: '1',
      contractVersion: '1.0.0',
      takenAt: 't2',
      files,
    });
    expect(a.releaseId).toBe(b.releaseId);
    expect(a.releaseId).toMatch(/^[0-9a-f]{12}$/);
    expect(Object.keys(a.files)).toEqual(['a.js', 'b.js']);
    const c = planRelease({ ...a, files: { ...files, 'c.js': 'cc' } });
    expect(c.releaseId).not.toBe(a.releaseId);
  });

  it('readContractVersion reads CONTRACT_VERSION via regex', () => {
    expect(readContractVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('rewriteIndexHtml', () => {
  it('points ./, / and bare asset refs into v/<id>/ preserving the prefix', () => {
    const html = `<script src="./assets/a.js"></script><link href="/assets/b.css"><img src="assets/c.png"><a href="https://x.test/assets/a.js">`;
    const out = rewriteIndexHtml(html, 'abc123', [
      'assets/a.js',
      'assets/b.css',
      'assets/c.png',
      'index.html',
    ]);
    expect(out).toContain('src="./v/abc123/assets/a.js"');
    expect(out).toContain('href="/v/abc123/assets/b.css"');
    expect(out).toContain('src="v/abc123/assets/c.png"');
    expect(out).toContain('href="https://x.test/assets/a.js"');
  });
});

describe('deployStatic', () => {
  it('writes v/<id>/, manifest, headers, rewritten index.html; verify passes', () => {
    const dist = join(tmp, 'dist');
    const out = join(tmp, 'out');
    makeDist(dist);
    const r = deployStatic({
      dist,
      out,
      game: 'template',
      env: 'lab',
      buildVersion: '1.2.3',
      contractVersion: '1.0.0',
      takenAt: '2026-08-17T00:00:00.000Z',
    });
    expect(r.reused).toBe(false);
    const id = r.manifest.releaseId;
    expect(existsSync(join(out, 'v', id, 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'v', id, 'manifest.json'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      game: 'template',
      env: 'lab',
      buildVersion: '1.2.3',
      contractVersion: '1.0.0',
      releaseId: id,
    });
    expect(Object.keys(manifest.files).sort()).toEqual(Object.keys(hashDir(dist)).sort());
    const headers = JSON.parse(readFileSync(join(out, 'headers.json'), 'utf8'));
    expect(headers).toEqual(HEADERS_POLICY);
    expect(headers['/v/*']['cache-control']).toContain('immutable');
    expect(headers['/index.html']['cache-control']).toBe('no-cache');
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).toContain(`src="./v/${id}/assets/index-`);
    expect(html).toContain(`href="/v/${id}/assets/index-abc.css"`);
    const v = verifyRelease(out);
    expect(v.ok, v.problems.join('\n')).toBe(true);
  });

  it('keeps history under v/ and swaps index.html to the new release', () => {
    const dist = join(tmp, 'dist');
    const out = join(tmp, 'out');
    makeDist(dist, 'console.log(1)');
    const first = deployStatic({
      dist,
      out,
      game: 'g',
      env: 'lab',
      buildVersion: '1',
      contractVersion: '1.0.0',
      takenAt: 't',
    });
    rmSync(dist, { recursive: true });
    makeDist(dist, 'console.log(2)');
    const second = deployStatic({
      dist,
      out,
      game: 'g',
      env: 'lab',
      buildVersion: '2',
      contractVersion: '1.0.0',
      takenAt: 't',
    });
    expect(second.manifest.releaseId).not.toBe(first.manifest.releaseId);
    expect(second.previousReleases).toEqual([first.manifest.releaseId]);
    expect(readdirSync(join(out, 'v')).sort()).toEqual(
      [first.manifest.releaseId, second.manifest.releaseId].sort(),
    );
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain(
      `v/${second.manifest.releaseId}/`,
    );
    // redeploying the identical build reuses the release
    const again = deployStatic({
      dist,
      out,
      game: 'g',
      env: 'lab',
      buildVersion: '2',
      contractVersion: '1.0.0',
      takenAt: 't',
    });
    expect(again.reused).toBe(true);
    expect(again.manifest.releaseId).toBe(second.manifest.releaseId);
  });

  it('--verify fails when a released asset is tampered with', async () => {
    const dist = join(tmp, 'dist');
    const out = join(tmp, 'out');
    makeDist(dist);
    const r = deployStatic({
      dist,
      out,
      game: 'g',
      env: 'lab',
      buildVersion: '1',
      contractVersion: '1.0.0',
      takenAt: 't',
    });
    const css = join(out, 'v', r.manifest.releaseId, 'assets', 'index-abc.css');
    writeFileSync(css, 'body{margin:1px}');
    const v = verifyRelease(out);
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toMatch(/index-abc\.css: expected/);
    const lines: string[] = [];
    const code = await cliMain(['deploy-static', '--out', out, '--verify'], {
      log: (l) => lines.push(l),
      error: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('FAILED');
  });

  it('CLI: deploy-static writes a release and refuses without index.html', async () => {
    const dist = join(tmp, 'dist');
    const out = join(tmp, 'out');
    makeDist(dist);
    const lines: string[] = [];
    const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
    const code = await cliMain(
      [
        'deploy-static',
        '--dist',
        dist,
        '--out',
        out,
        '--game',
        'g',
        '--env',
        'lab',
        '--build',
        '9',
        '--now',
        '1700000000000',
      ],
      io,
    );
    expect(code, lines.join('\n')).toBe(0);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.takenAt).toBe(new Date(1700000000000).toISOString());
    expect(manifest.contractVersion).toBe(readContractVersion());
    const empty = join(tmp, 'empty');
    mkdirSync(empty);
    const bad = await cliMain(
      [
        'deploy-static',
        '--dist',
        empty,
        '--out',
        out,
        '--game',
        'g',
        '--env',
        'lab',
        '--build',
        '9',
      ],
      io,
    );
    expect(bad).toBe(1);
    expect(lines.join('\n')).toContain('no index.html');
    const missing = await cliMain(['deploy-static', '--dist', dist], io);
    expect(missing).toBe(1);
    expect(lines.join('\n')).toContain('--out <value> is required');
  });
});
