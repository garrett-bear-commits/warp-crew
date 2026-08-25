// @vitest-environment happy-dom
// Admin inspector (ADR-021, §7): source hygiene, textContent-only rendering, images by magic
// bytes, and the built index.html shape (no inline script/style, relative asset URLs only).
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  el,
  text,
  table,
  jsonTree,
  keyValue,
  sniffImage,
  safeImageDataUrl,
  decodeBase64Prefix,
} from '../../admin-inspector/src/render.ts';
import { adminClient, describeFailure, normalizeOrigin } from '../../admin-inspector/src/api.ts';

const here = dirname(fileURLToPath(import.meta.url));
const inspectorDir = resolve(here, '..', '..', 'admin-inspector');
const srcDir = resolve(inspectorDir, 'src');
const distDir = resolve(inspectorDir, 'dist');

function sourceFiles(): Array<{ path: string; src: string }> {
  const files = readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => resolve(srcDir, f));
  files.push(resolve(inspectorDir, 'index.html'), resolve(inspectorDir, 'styles.css'));
  return files.map((path) => ({ path, src: readFileSync(path, 'utf8') }));
}

describe('inspector source hygiene', () => {
  it('organizes operator work into focused task workspaces', () => {
    const html = readFileSync(resolve(inspectorDir, 'index.html'), 'utf8');
    for (const view of ['setup', 'support', 'liveops', 'safety', 'audit']) {
      expect(html).toContain(`data-view="${view}"`);
      expect(html).toContain(`data-view-panel="${view}"`);
    }
    expect(html.match(/data-view-panel=/g)).toHaveLength(5);
    expect(html).toContain('aria-current="page"');
  });

  it('never parses HTML strings (no innerHTML/outerHTML/insertAdjacentHTML/document.write)', () => {
    for (const { path, src } of sourceFiles()) {
      for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
        expect(src.includes(bad), `${path} contains ${bad}`).toBe(false);
      }
    }
  });

  it('never reads the wall clock (Date.now) — times come from responses (ADR-009)', () => {
    for (const { path, src } of sourceFiles()) {
      expect(src.includes('Date.now('), `${path} calls Date.now()`).toBe(false);
      expect(/new Date\(\s*\)/.test(src), `${path} calls new Date() without argument`).toBe(false);
    }
  });

  it('has no external URLs other than the default local origin', () => {
    const allowed = new Set(['http://localhost:8080']);
    for (const { path, src } of sourceFiles()) {
      const urls = src.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [];
      for (const u of urls) expect(allowed.has(u), `${path} references ${u}`).toBe(true);
    }
  });

  it('never persists credentials (no localStorage/sessionStorage/cookies)', () => {
    for (const { path, src } of sourceFiles()) {
      for (const bad of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB']) {
        expect(src.includes(bad), `${path} touches ${bad}`).toBe(false);
      }
    }
  });

  it('imports contracts as types only (values solely from @foundation/contracts/enums)', () => {
    for (const { path, src } of sourceFiles()) {
      if (!path.endsWith('.ts')) continue;
      const imports = src.match(/^import[^;]+from\s+'@foundation\/[^']+';/gm) ?? [];
      for (const line of imports) {
        const ok = /^import type /.test(line) || /from '@foundation\/contracts\/enums'/.test(line);
        expect(ok, `${path}: ${line}`).toBe(true);
        expect(line.includes('@foundation/server')).toBe(false);
      }
    }
  });
});

describe('render helpers use textContent (markup stays inert)', () => {
  it('text() renders a <script> string as text, not as an element', () => {
    const node = text('div', '<script>alert(1)</script><img src=x onerror=alert(1)>');
    document.body.appendChild(node);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(node.textContent).toContain('<script>');
    expect(node.childNodes.length).toBe(1);
    expect(node.firstChild?.nodeType).toBe(3); // TEXT_NODE
    node.remove();
  });

  it('el() children strings become text nodes and attrs never become event handlers', () => {
    const node = el('span', { class: 'x', 'data-k': '<b>' }, ['<b>bold</b>']);
    expect(node.querySelector('b')).toBeNull();
    expect(node.textContent).toBe('<b>bold</b>');
    expect(node.getAttribute('data-k')).toBe('<b>');
    expect(node.className).toBe('x');
  });

  it('table() and keyValue() keep cell content as text', () => {
    const t = table<{ a: string }>(
      [{ header: '<th>', cell: (r) => r.a }],
      [{ a: '<script>x</script>' }],
    );
    expect(t.querySelectorAll('script').length).toBe(0);
    expect(t.querySelector('th')?.textContent).toBe('<th>');
    expect(t.querySelector('td')?.textContent).toBe('<script>x</script>');
    const kv = keyValue([['k', '<img src=x>']]);
    expect(kv.querySelector('img')).toBeNull();
    expect(kv.querySelector('dd')?.textContent).toBe('<img src=x>');
  });

  it('jsonTree() renders nested values without creating markup from strings', () => {
    const tree = jsonTree({
      name: '<script>evil()</script>',
      list: [1, 'two', { three: true }],
      nested: { html: '<iframe src="x"></iframe>' },
    });
    expect(tree.querySelectorAll('script').length).toBe(0);
    expect(tree.querySelectorAll('iframe').length).toBe(0);
    expect(tree.textContent).toContain('<script>evil()</script>');
    expect(tree.querySelectorAll('details').length).toBeGreaterThanOrEqual(3);
  });

  it('jsonTree() falls back to <pre> text for huge documents', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 6000; i++) big[`k${i}`] = i;
    const tree = jsonTree(big);
    expect(tree.tagName.toLowerCase()).toBe('pre');
    expect(tree.textContent).toContain('"k5999": 5999');
  });
});

describe('images by magic bytes', () => {
  const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
  const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
  const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0];
  const WEBP = [
    0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  ];

  it('sniffImage recognises PNG/JPEG/GIF/WebP and rejects everything else', () => {
    expect(sniffImage(Uint8Array.from(PNG))).toBe('png');
    expect(sniffImage(Uint8Array.from(JPEG))).toBe('jpeg');
    expect(sniffImage(Uint8Array.from(GIF))).toBe('gif');
    expect(sniffImage(Uint8Array.from(WEBP))).toBe('webp');
    expect(
      sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])),
    ).toBeNull(); // RIFF WAVE
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="x"></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<html>'))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    expect(sniffImage(Uint8Array.from([0x89, 0x50]))).toBeNull(); // truncated PNG
  });

  it('decodeBase64Prefix decodes only a bounded prefix and rejects garbage', () => {
    const bytes = decodeBase64Prefix(b64(PNG), 8);
    expect(bytes).not.toBeNull();
    expect(Array.from(bytes!.slice(0, 8))).toEqual(PNG.slice(0, 8));
    expect(decodeBase64Prefix('!!!not base64!!!')).toBeNull();
  });

  it('safeImageDataUrl accepts data URLs whose bytes match and normalises the mime', () => {
    expect(safeImageDataUrl(`data:image/png;base64,${b64(PNG)}`)).toBe(
      `data:image/png;base64,${b64(PNG)}`,
    );
    // mislabelled but real JPEG bytes → normalised to the sniffed type
    expect(safeImageDataUrl(`data:image/png;base64,${b64(JPEG)}`)).toBe(
      `data:image/jpeg;base64,${b64(JPEG)}`,
    );
    expect(safeImageDataUrl(`data:image/gif;base64,${b64(GIF)}`)).toMatch(/^data:image\/gif;/);
    expect(safeImageDataUrl(`data:image/webp;base64,${b64(WEBP)}`)).toMatch(/^data:image\/webp;/);
  });

  it('safeImageDataUrl refuses SVG, HTML, text and non-data URLs', () => {
    const svg = Buffer.from('<svg xmlns="x" onload="alert(1)"></svg>').toString('base64');
    expect(safeImageDataUrl(`data:image/svg+xml;base64,${svg}`)).toBeNull();
    expect(safeImageDataUrl(`data:image/png;base64,${svg}`)).toBeNull();
    expect(safeImageDataUrl('data:text/html;base64,PGh0bWw+')).toBeNull();
    expect(safeImageDataUrl('data:image/png,notbase64')).toBeNull();
    expect(safeImageDataUrl('javascript:alert(1)')).toBeNull();
    expect(safeImageDataUrl('plain text')).toBeNull();
    expect(safeImageDataUrl(`data:image/png;base64,${b64(PNG)} trailing`)).toBeNull();
  });

  it('jsonTree renders a verified image and leaves unverifiable data URLs as text', () => {
    const good = `data:image/png;base64,${b64(PNG)}`;
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
    const tree = jsonTree({ good, svg });
    const imgs = tree.querySelectorAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0]!.getAttribute('src')).toBe(good);
    expect(tree.textContent).toContain(svg);
  });
});

describe('admin api client', () => {
  it('sends admin headers, JSON body, and reports network failures as status 0', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true, serverNow: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const api = adminClient(
      () => ({ origin: 'http://localhost:8080/', keyId: 'k', secret: 's' }),
      fakeFetch,
    );
    const r = await api.post<{ ok: true }>('/admin/v1/letters', { commandId: 'c1', title: 't' });
    expect(r.ok).toBe(true);
    expect(seen[0]!.url).toBe('http://localhost:8080/admin/v1/letters');
    const h = seen[0]!.init.headers as Record<string, string>;
    expect(h['x-admin-key-id']).toBe('k');
    expect(h['x-admin-secret']).toBe('s');
    expect(h['content-type']).toBe('application/json');
    expect(JSON.parse(String(seen[0]!.init.body)).commandId).toBe('c1');

    const failing = adminClient(
      () => ({ origin: 'http://localhost:8080', keyId: 'k', secret: 's' }),
      (async () => {
        throw new TypeError('offline');
      }) as typeof fetch,
    );
    const f = await failing.get('/admin/v1/actions');
    expect(f.ok).toBe(false);
    if (!f.ok) {
      expect(f.status).toBe(0);
      expect(describeFailure(f)).toMatch(/network error/);
    }
    const noCreds = adminClient(() => null, fakeFetch);
    const n = await noCreds.get('/admin/v1/actions');
    expect(n.ok).toBe(false);
    expect(seen.length).toBe(1);
  });

  it('describeFailure surfaces the error envelope; normalizeOrigin trims slashes', () => {
    expect(
      describeFailure({
        status: 403,
        error: { error: 'forbidden', correlationId: 'abc', message: 'scope' } as never,
      }),
    ).toBe('HTTP 403 forbidden: scope [abc]');
    expect(normalizeOrigin(' http://localhost:8080/// ')).toBe('http://localhost:8080');
  });
});

describe('built index.html (CSP shape)', () => {
  const built = existsSync(resolve(distDir, 'index.html'));
  const html = built ? readFileSync(resolve(distDir, 'index.html'), 'utf8') : '';

  it('dist is present after `pnpm -F @foundation/app-server build` (checked when built)', () => {
    if (!built) {
      console.warn('admin-inspector/dist absent; run the build to exercise the index.html checks');
      return;
    }
    expect(html.length).toBeGreaterThan(0);
  });

  it('has no inline <script> bodies and no style= attributes', () => {
    if (!built) return;
    const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      const body = s.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
      expect(body.trim(), `inline script body: ${s.slice(0, 80)}`).toBe('');
      expect(/\ssrc=/.test(s)).toBe(true);
    }
    expect(/<style\b/i.test(html)).toBe(false);
    expect(/\sstyle\s*=/i.test(html)).toBe(false);
    expect(/\son[a-z]+\s*=/i.test(html)).toBe(false);
  });

  it('references only relative asset URLs', () => {
    if (!built) return;
    const refs = [...html.matchAll(/\s(?:src|href)=["']([^"']+)["']/gi)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      if (r.startsWith('#')) {
        expect(html, `missing anchor target ${r}`).toContain(`id="${r.slice(1)}"`);
        continue;
      }
      expect(/^https?:|^\/\//i.test(r), `absolute URL ${r}`).toBe(false);
      expect(r.startsWith('./') || !r.startsWith('/'), `root-absolute URL ${r}`).toBe(true);
      expect(existsSync(resolve(distDir, r)), `${r} missing from dist`).toBe(true);
    }
  });

  it('bundled assets carry no node builtins or TypeBox runtime', () => {
    if (!built) return;
    const assets = readdirSync(resolve(distDir, 'assets'));
    for (const a of assets.filter((f) => f.endsWith('.js'))) {
      const js = readFileSync(resolve(distDir, 'assets', a), 'utf8');
      expect(js.includes('node:')).toBe(false);
      expect(js.includes('@sinclair/typebox')).toBe(false);
      expect(js.includes('innerHTML')).toBe(false);
      expect(js.includes('localStorage')).toBe(false);
    }
  });
});
