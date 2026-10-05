// @vitest-environment happy-dom
// Admin inspector (ADR-021, §7): source hygiene, textContent-only rendering, images by magic
// bytes, and the built index.html shape (no inline script/style, relative asset URLs only).
import { beforeAll, describe, it, expect, vi } from 'vitest';
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
import { ROUTE_BY_ID } from '@foundation/contracts/routes';
import { environmentFor, parseHosts } from '../../admin-inspector/src/env.ts';
import { absTime, fmtBytes, fmtInt, relTime } from '../../admin-inspector/src/format.ts';
import {
  failureMessage,
  restorePlan,
  restorePlanText,
  resultMessage,
  rewardsText,
  signInError,
  writeSummary,
} from '../../admin-inspector/src/plans.ts';
import { detailText } from '../../admin-inspector/src/players.ts';
import { adjustmentFromFields, PREMIUM_LABEL } from '../../admin-inspector/src/purchases.ts';
import {
  bindRewardFields,
  rewardsFromFields,
  withRewards,
} from '../../admin-inspector/src/rewards.ts';
import type { GrantVocabulary } from '../../games/grant-vocabulary.ts';
import { accessFor, CAPABILITY_SCOPES, type Capability } from '../../admin-inspector/src/scopes.ts';
import { runWrite, type WriteSlot } from '../../admin-inspector/src/writes.ts';
import {
  buildIncognitoTarget,
  createIncognitoSessionId,
  incognitoSnapshot,
  INCOGNITO_PROTOCOL,
  isIncognitoFailed,
  isIncognitoLoaded,
  isIncognitoReady,
} from '../../admin-inspector/src/incognito.ts';

// These tests exercise the inspector against the template game's vocabulary (gems, gold); the
// shipped pointer (game-grants.ts) names this repository's game.
vi.mock('../../admin-inspector/src/game-grants.ts', async () => ({
  grantVocabulary: (await import('../../games/template/grants.ts')).templateGrants,
}));

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
  it('keeps the console in an inert template behind a three-field sign-in card', () => {
    const html = readFileSync(resolve(inspectorDir, 'index.html'), 'utf8');
    const template = /<template id="app-template">([\s\S]*)<\/template>/.exec(html)?.[1] ?? '';
    const outside = html.replace(template, '');
    expect(template.length).toBeGreaterThan(0);
    for (const view of ['players', 'liveops', 'audit']) {
      expect(template).toContain(`data-view="${view}"`);
      expect(template).toContain(`data-view-panel="${view}"`);
    }
    expect(template.match(/data-view-panel=/g)).toHaveLength(3);
    // Outside the template: the sign-in card only (key id, secret, Sign in).
    expect(outside.match(/<form\b/g)).toHaveLength(1);
    expect(outside.match(/<input\b/g)).toHaveLength(2);
    expect(outside).toContain('name="keyId"');
    expect(outside).toContain('name="secret"');
    expect(outside).not.toMatch(/data-view|<nav\b/);
    // API origin and game URL are not operator settings any more.
    expect(html).not.toMatch(/name="(origin|clientUrl)"/);
    expect(html).toContain('Game admin');
    expect(html).not.toMatch(/Game Foundation|Operator console/);
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
    const allowed = new Set(['http://localhost:8080', 'http://localhost:5173']);
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

  it('names no game: only game-grants.ts picks the grant vocabulary', () => {
    for (const { path, src } of sourceFiles()) {
      if (!path.endsWith('.ts') || path.endsWith('game-grants.ts')) continue;
      for (const [, from] of src.matchAll(/from '(\.\.\/\.\.\/games\/[^']+)'/g))
        expect(from, path).toBe('../../games/grant-vocabulary.ts');
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
    // Behind Cloudflare Access the page's own origin needs its Access cookie; no other origin
    // ever gets cookies.
    expect(seen[0]!.init.credentials).toBe('same-origin');

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

describe('incognito takeover protocol', () => {
  const sessionId = '00000000-0000-4000-8000-000000000000';

  it('adds only a session and exact admin origin to the game URL', () => {
    const target = buildIncognitoTarget(
      'http://localhost:5173/game?build=qa#tab=overview',
      sessionId,
      'http://localhost:8080',
    );
    expect(target).not.toBeNull();
    const parsed = new URL(target!.url);
    expect(target!.origin).toBe('http://localhost:5173');
    expect(parsed.pathname).toBe('/game');
    expect(parsed.searchParams.get('build')).toBe('qa');
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    expect(fragment.get('tab')).toBeNull();
    expect(fragment.get('foundationIncognito')).toBe(sessionId);
    expect(fragment.get('foundationAdminOrigin')).toBe('http://localhost:8080');
    expect(parsed.search).not.toContain('secret');
    expect(parsed.search).not.toContain('blob');
  });

  it('rejects unsafe targets and validates source messages by session', () => {
    expect(
      buildIncognitoTarget('javascript:alert(1)', sessionId, 'http://localhost:8080'),
    ).toBeNull();
    expect(buildIncognitoTarget('http://localhost:5173', '', 'http://localhost:8080')).toBeNull();
    expect(buildIncognitoTarget('http://localhost:5173', sessionId, 'null')).toBeNull();
    // An operator who types the inspector's own URL as the game client gets refused, not a
    // popup of the inspector.
    expect(
      buildIncognitoTarget('https://admin.example/', sessionId, 'https://admin.example'),
    ).toBeNull();
    expect(
      buildIncognitoTarget('https://game.example', sessionId, 'http://operator.example'),
    ).toBeNull();
    expect(
      buildIncognitoTarget('http://game.example', sessionId, 'http://localhost:8080'),
    ).toBeNull();
    expect(
      buildIncognitoTarget('https://user:secret@game.example', sessionId, 'http://localhost:8080'),
    ).toBeNull();
    expect(
      isIncognitoReady({ protocol: INCOGNITO_PROTOCOL, kind: 'ready', sessionId: 's' }, 's'),
    ).toBe(true);
    expect(
      isIncognitoReady({ protocol: INCOGNITO_PROTOCOL, kind: 'ready', sessionId: 'other' }, 's'),
    ).toBe(false);
    expect(
      isIncognitoLoaded({ protocol: INCOGNITO_PROTOCOL, kind: 'loaded', sessionId: 's' }, 's'),
    ).toBe(true);
    expect(
      isIncognitoLoaded({ protocol: INCOGNITO_PROTOCOL, kind: 'ready', sessionId: 's' }, 's'),
    ).toBe(false);
    expect(
      isIncognitoFailed({ protocol: INCOGNITO_PROTOCOL, kind: 'failed', sessionId: 's' }, 's'),
    ).toBe(true);
  });

  it('mints a cryptographically sourced session id and fails closed without crypto', () => {
    const generated = createIncognitoSessionId();
    expect(generated).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{15,95}$/);
    expect(createIncognitoSessionId(null)).toBeNull();
  });

  it('constructs a complete snapshot message for postMessage only', () => {
    expect(incognitoSnapshot('s', 'player-1', 7, 2, 'json', '{"coins":3}')).toEqual({
      protocol: INCOGNITO_PROTOCOL,
      kind: 'snapshot',
      sessionId: 's',
      playerKey: 'player-1',
      seq: 7,
      generation: 2,
      enc: 'json',
      blob: '{"coins":3}',
    });
  });
});

describe('environment badge from the hostname', () => {
  it("names the build's production hosts, then staging, local and prod hosts; else unknown", () => {
    const prod = parseHosts(' Admin.Example.com., ops.example.com ,');
    expect(prod).toEqual(['admin.example.com', 'ops.example.com']);
    expect(environmentFor('admin.example.com', prod)).toEqual({
      kind: 'production',
      label: 'Production',
    });
    expect(environmentFor('ADMIN.example.com.', prod).kind).toBe('production');
    expect(environmentFor('ops.example.com', prod).kind).toBe('production');
    expect(environmentFor('example.com', prod).kind).toBe('unknown');
    expect(environmentFor('admin.example.com.evil.example', prod).kind).toBe('unknown');
    // A platform service name (here Railway's generated domain) still names its environment.
    expect(environmentFor('admin-production-77f1.up.railway.app', []).kind).toBe('production');
    expect(environmentFor('admin-prod.example.net', []).kind).toBe('production');
    expect(environmentFor('admin-staging-0ad2.up.railway.app', [])).toEqual({
      kind: 'staging',
      label: 'Staging',
    });
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'admin.localhost'])
      expect(environmentFor(host, prod), host).toEqual({ kind: 'local', label: 'Local' });
  });

  it('the production hosts are optional at build time', () => {
    expect(parseHosts(undefined)).toEqual([]);
    expect(parseHosts(' , ')).toEqual([]);
    expect(environmentFor('admin.example.com', parseHosts(undefined))).toEqual({
      kind: 'unknown',
      label: 'Unknown env',
    });
  });
});

describe('scopes → visible capabilities', () => {
  const all = Object.keys(CAPABILITY_SCOPES) as Capability[];
  const visible = (scopes: string[]) => all.filter((c) => accessFor(scopes).can(c));

  it('a read-only key sees players, saves, the save viewer, incognito and audit, no writes', () => {
    const a = accessFor(['read']);
    expect(a.workspaces).toEqual(['players', 'audit']);
    expect(visible(['read']).sort()).toEqual(
      ['audit', 'incognito', 'players', 'saveViewer'].sort(),
    );
  });

  it('the issued write key sees every workspace and every write', () => {
    const write = ['read', 'support', 'grant', 'publish', 'restore'];
    expect(accessFor(write).workspaces).toEqual(['players', 'liveops', 'audit']);
    expect(visible(write).sort()).toEqual([...all].sort());
  });

  it('player writes need read too; live ops need only their own scope', () => {
    expect(visible(['support'])).toEqual([]);
    expect(accessFor(['support']).workspaces).toEqual([]);
    expect(visible(['read', 'restore']).sort()).toEqual(
      ['audit', 'incognito', 'players', 'restore', 'saveReview', 'saveViewer'].sort(),
    );
    expect(accessFor(['publish']).workspaces).toEqual(['liveops']);
    expect(visible(['publish']).sort()).toEqual(['publishContent', 'publishFlag']);
    expect(visible(['grant'])).toEqual(['cohortGrant']);
  });

  it('Mint grant and Fix purchase need read and grant', () => {
    for (const scopes of [['read'], ['read', 'support'], ['read', 'restore'], ['grant']]) {
      expect(accessFor(scopes).can('grant'), scopes.join()).toBe(false);
      expect(accessFor(scopes).can('adjustPurchase'), scopes.join()).toBe(false);
    }
    expect(visible(['read', 'grant']).sort()).toEqual(
      [
        'adjustPurchase',
        'audit',
        'cohortGrant',
        'grant',
        'incognito',
        'players',
        'saveViewer',
      ].sort(),
    );
  });

  it('drops unknown scopes and orders the rest like ADMIN_SCOPES', () => {
    expect(accessFor(['restore', 'root', 'read']).scopes).toEqual(['read', 'restore']);
    expect(accessFor([]).workspaces).toEqual([]);
    expect(accessFor(['erase']).workspaces).toEqual([]);
  });

  it('each capability includes the scope its admin route requires', () => {
    const routes: Record<Capability, string[]> = {
      players: ['admin.player', 'admin.timeline', 'admin.history'],
      saveViewer: ['admin.blob'],
      incognito: ['admin.blob'],
      audit: ['admin.actions', 'admin.deadLetters'],
      letter: ['admin.letter'],
      playerFlag: ['admin.playerFlag'],
      grant: ['admin.grant'],
      adjustPurchase: ['admin.adjustment'],
      restore: ['admin.restore'],
      saveReview: ['admin.reviewSave'],
      deadLetterReplay: ['admin.outboxReplay', 'admin.deadLetters'],
      publishFlag: ['admin.publishFlag'],
      publishContent: ['admin.publishContent'],
      cohortGrant: ['admin.cohortGrant'],
    };
    for (const [cap, ids] of Object.entries(routes) as Array<[Capability, string[]]>) {
      for (const id of ids) {
        const scope = ROUTE_BY_ID.get(id)?.adminScope;
        expect(scope, id).toBeDefined();
        expect(CAPABILITY_SCOPES[cap] as readonly string[], `${cap} → ${id}`).toContain(scope);
      }
    }
  });
});

describe('restore plan (modelled on the CLI dry run)', () => {
  const savedAt = Date.UTC(2026, 8, 30, 20, 48, 0);
  const anchor = { seq: 148, progress: 17400 } as never;
  const target = {
    seq: 146,
    generation: 2,
    progress: 17300,
    disposition: 'anchored',
    savedAt,
    hasBlob: true,
  } as const;

  it('states now, target and the effect with the expected generation from the overview', () => {
    const plan = restorePlan({ generation: 2, anchor, erased: false }, target);
    expect(plan.now).toBe('generation 2, anchor seq 148 · progress 17400');
    expect(plan.target).toBe(
      'seq 146 · generation 2 · progress 17300 · anchored · saved 2026-09-30 20:48:00 UTC',
    );
    expect(plan.effect).toBe('opens generation 3 seeded from seq 146; generation 2 is kept');
    expect(plan.expectedGeneration).toBe(2);
    expect(plan.refusal).toBeNull();
    expect(restorePlanText(plan).split('\n')).toEqual([
      'now: generation 2, anchor seq 148 · progress 17400',
      `target: ${plan.target}`,
      'effect: opens generation 3 seeded from seq 146; generation 2 is kept',
    ]);
  });

  it('handles a player without an anchor and labels quarantined targets', () => {
    const plan = restorePlan(
      { generation: 0, erased: false },
      { ...target, generation: 0, disposition: 'stored_quarantined' },
    );
    expect(plan.now).toBe('generation 0, no anchored save');
    expect(plan.target).toContain('· quarantined ·');
    expect(plan.effect).toBe('opens generation 1 seeded from seq 146; generation 0 is kept');
  });

  it('refuses a pruned target and an erased player', () => {
    expect(
      restorePlan({ generation: 2, anchor, erased: false }, { ...target, hasBlob: false }).refusal,
    ).toBe('Save seq 146 is pruned; it cannot seed a restore.');
    expect(restorePlan({ generation: 2, anchor, erased: true }, target).refusal).toBe(
      'The player is erased.',
    );
  });
});

describe('write summaries, results and failures', () => {
  it('summarises a write before it is sent; risky ones are danger-styled', () => {
    const letter = writeSummary('letter', {
      playerKey: 'p-1',
      title: 'Hi',
      body: 'Body',
      reason: 'SUP-1',
    });
    expect(letter.title).toBe('Send a letter to p-1');
    expect(letter.rows).toContainEqual(['Reason', 'SUP-1']);
    expect(letter.danger).toBe(false);
    const grant = writeSummary('grant', {
      playerKey: 'p-1',
      grantKey: 'g-1',
      rewards: [
        { kind: 'premium_currency', amount: 1 },
        { kind: 'soft_currency', currency: 'gold', amount: 1500 },
      ],
      reason: 'r',
    });
    expect(grant.rows).toContainEqual(['Rewards', '+1 Gem (free) · +1,500 Gold']);
    expect(writeSummary('cohortGrant', { dryRun: true }).danger).toBe(false);
    expect(writeSummary('cohortGrant', { dryRun: false }).danger).toBe(true);
    expect(writeSummary('publishContent', { env: 'prod', document: {} }).danger).toBe(true);
    expect(writeSummary('restore', { playerKey: 'p', seq: 3 }).danger).toBe(true);
  });

  it('turns responses into sentences', () => {
    expect(resultMessage('cohortGrant', { matched: 1200, minted: 0, dryRun: true }, {})).toBe(
      'Dry run: 1,200 players match. Nothing minted.',
    );
    expect(
      resultMessage('restore', { generation: 3, seedSeq: 146, duplicate: false }, { seq: 146 }),
    ).toBe('Generation 3 opened from seq 146.');
    expect(resultMessage('grant', { grantKey: 'g', duplicate: true }, { playerKey: 'p' })).toBe(
      'Grant g already existed; nothing new minted.',
    );
  });

  it('explains sign-in failures, including an expired Access session', () => {
    const env = (error: unknown) => error as never;
    expect(signInError({ status: 401, error: env({ error: 'unauthorized' }) }, 'local')).toBe(
      'Key ID or secret not accepted.',
    );
    expect(signInError({ status: 0, error: null }, 'production')).toMatch(
      /Access session expired, reload the page to sign in again/,
    );
    expect(signInError({ status: 0, error: null }, 'local')).toBe(
      'No response from the admin API.',
    );
    expect(
      signInError(
        {
          status: 403,
          error: env({ error: 'forbidden', details: { reason: 'cf_access_expired' } }),
        },
        'production',
      ),
    ).toBe('Access session expired. Reload the page to sign in again.');
    expect(signInError({ status: 403, error: null }, 'production')).toMatch(/Reload the page/);
    expect(signInError({ status: 429, error: env({ error: 'rate_limited' }) }, 'staging')).toMatch(
      /Too many attempts/,
    );
  });

  it('explains write failures (missing scope, stale generation)', () => {
    expect(
      failureMessage(
        {
          status: 403,
          error: { error: 'forbidden', correlationId: 'c', details: { required: 'restore' } },
        },
        'staging',
      ),
    ).toBe('Not allowed: needs the restore scope.');
    expect(
      failureMessage(
        { status: 409, error: { error: 'stale_generation', correlationId: 'c' } },
        'staging',
      ),
    ).toMatch(/generation changed/);
  });
});

// A vocabulary with a choice field, beside the template's gems + gold (game-grants.ts).
const crates: GrantVocabulary = {
  premiumName: 'crystals',
  fields: [
    {
      kind: 'amount',
      name: 'crystals',
      label: 'Crystal',
      note: 'free',
      max: 500,
      reward: { kind: 'premium_currency' },
    },
    {
      kind: 'choice',
      name: 'crate',
      label: 'Crate',
      max: 3,
      options: [
        { value: 'wood', label: 'Wooden', reward: { kind: 'item', itemId: 'crate:wood' } },
        { value: 'iron', label: 'Iron', reward: { kind: 'item', itemId: 'crate:iron' } },
      ],
    },
  ],
};

describe('grant reward fields', () => {
  const both = [
    { kind: 'premium_currency', amount: 100 },
    { kind: 'soft_currency', currency: 'gold', amount: 5000 },
  ];

  it('builds the exact rewards JSON from the fields in vocabulary order; empty or 0 is none', () => {
    expect(rewardsFromFields({ gold: 5000, gems: 100 })).toEqual(both);
    expect(rewardsFromFields({ gems: 0, gold: 1 })).toEqual([
      { kind: 'soft_currency', currency: 'gold', amount: 1 },
    ]);
    expect(withRewards({ grantKey: 'g-1', gems: 100, gold: 5000 })).toEqual({
      grantKey: 'g-1',
      rewards: both,
    });
    // A choice field gives one pick of the chosen option.
    expect(rewardsFromFields({ crystals: 5, crate: 'iron' }, crates)).toEqual([
      { kind: 'premium_currency', amount: 5 },
      { kind: 'item', itemId: 'crate:iron', qty: 1 },
    ]);
    expect(rewardsFromFields({ crystals: '', crate: 'wood' }, crates)).toEqual([
      { kind: 'item', itemId: 'crate:wood', qty: 1 },
    ]);
  });

  it('refuses an empty, over-limit or unsupported form', () => {
    expect(() => rewardsFromFields({})).toThrow('Add at least one reward.');
    expect(() => rewardsFromFields({ gems: 0, gold: 0 })).toThrow('Add at least one reward.');
    expect(() => rewardsFromFields({ crystals: '', crate: '' }, crates)).toThrow(
      'Add at least one reward.',
    );
    expect(() => rewardsFromFields({ gems: 100_001 })).toThrow('Gems must be at most 100,000.');
    expect(() => rewardsFromFields({ gold: 1_000_000_001 })).toThrow(
      'Gold must be at most 1,000,000,000.',
    );
    expect(() => rewardsFromFields({ gems: 1.5 })).toThrow('Gems must be a whole number ≥ 0.');
    expect(() => rewardsFromFields({ crystals: 501 }, crates)).toThrow(
      'Crystals must be at most 500.',
    );
    expect(() => rewardsFromFields({ crate: 'gold' }, crates)).toThrow('Unknown crate "gold".');
  });

  it('Advanced (JSON) is read and checked the way the game reads it', () => {
    const json = (raw: string, v?: GrantVocabulary) =>
      withRewards({ rewardsAdvanced: true, rewards: raw }, v);
    expect(json(JSON.stringify(both))).toEqual({ rewards: both });
    expect(() => json('[{"kind":"cosmetic","cosmeticId":"hat"}]')).toThrow(
      'Rewards: reward 1: unsupported kind "cosmetic".',
    );
    expect(() => json('[{"kind":"item","itemId":"chest","qty":1}]')).toThrow(
      'Rewards: reward 1: unsupported item "chest".',
    );
    expect(() => json('[{"kind":"premium_currency","amount":100001}]')).toThrow(
      'Rewards: more than 100000 gems.',
    );
    expect(() => json('[{"kind":"item","itemId":"crate:iron","qty":4}]', crates)).toThrow(
      'Rewards: more than 3 crates.',
    );
    expect(() => json('[]')).toThrow('Rewards: no rewards.');
    expect(() => json('[{')).toThrow('Rewards must be valid JSON.');
    expect(() => json('  ')).toThrow('Rewards is required.');
  });

  it('the confirm step and timelines read the rewards as the game applies them', () => {
    const plan = writeSummary(
      'grant',
      withRewards({ playerKey: 'p-1', grantKey: 'g-1', gems: 100, gold: 5000, reason: 'r' }),
    );
    expect(plan.rows).toContainEqual(['Rewards', '+100 Gems (free) · +5,000 Gold']);
    expect(
      rewardsText(
        [
          { kind: 'item', itemId: 'crate:iron', qty: 2 },
          { kind: 'premium_currency', amount: 5 },
        ],
        crates,
      ),
    ).toBe('+5 Crystals (free) · 2 Iron Crates');
    // Anything the game does not apply keeps the raw listing.
    expect(rewardsText([{ kind: 'cosmetic', cosmeticId: 'hat' }])).toBe('cosmetic hat');
    expect(rewardsText([{ kind: 'item', itemId: 'chest', qty: 2 }])).toBe('2 × chest');
  });

  it('renders one input per vocabulary field and swaps them for JSON under Advanced', () => {
    const form = el('form', { id: 'form-test' }, [
      el('div', { class: 'field-row', 'data-reward-fields': '' }),
      el('label', { 'data-reward-json': '' }, [el('textarea', { name: 'rewards' })]),
      el('input', { name: 'rewardsAdvanced', type: 'checkbox' }),
    ]);
    bindRewardFields(form, crates);
    const box = form.querySelector('[data-reward-fields]') as HTMLElement;
    const crystals = form.elements.namedItem('crystals') as HTMLInputElement;
    expect([crystals.type, crystals.min, crystals.step]).toEqual(['number', '0', '1']);
    expect(box.querySelector('.field-label')?.firstChild?.textContent).toBe('Crystals');
    expect(box.querySelector('.field-label i')?.textContent).toBe('free');
    const crate = form.elements.namedItem('crate') as HTMLSelectElement;
    expect(Array.from(crate.options).map((o) => [o.value, o.textContent])).toEqual([
      ['', 'None'],
      ['wood', 'Wooden'],
      ['iron', 'Iron'],
    ]);
    crystals.value = '5';
    crate.value = 'wood';
    const advanced = form.elements.namedItem('rewardsAdvanced') as HTMLInputElement;
    advanced.checked = true;
    advanced.dispatchEvent(new Event('change'));
    expect(box.hidden).toBe(true);
    expect(crystals.disabled).toBe(true);
    expect(JSON.parse((form.elements.namedItem('rewards') as HTMLTextAreaElement).value)).toEqual([
      { kind: 'premium_currency', amount: 5 },
      { kind: 'item', itemId: 'crate:wood', qty: 1 },
    ]);
  });

  it('refuses a vocabulary field that would shadow one of the form inputs', () => {
    const form = el('form', { id: 'form-test' }, [
      el('div', { 'data-reward-fields': '' }),
      el('label', { 'data-reward-json': '' }, [el('textarea', { name: 'rewards' })]),
      el('input', { name: 'rewardsAdvanced', type: 'checkbox' }),
      el('input', { name: 'reason' }),
    ]);
    const clash: GrantVocabulary = {
      ...crates,
      fields: [{ ...crates.fields[0]!, name: 'reason' }],
    };
    expect(() => bindRewardFields(form, clash)).toThrow(
      'grant field "reason" collides with a form-test input',
    );
  });
});

describe('Fix purchase', () => {
  const base = { reason: 'SUP-9', ticketRef: 'T-9' };

  it('credit and refund take a positive amount; a refund is sent negative', () => {
    expect(
      adjustmentFromFields({ ...base, kind: 'make_good', amount: '300', transactionId: 42 }),
    ).toEqual({
      kind: 'make_good',
      delta: 300,
      reason: 'SUP-9',
      transactionId: 42,
      ticketRef: 'T-9',
    });
    expect(adjustmentFromFields({ kind: 'refund', amount: '300', reason: 'r' })).toEqual({
      kind: 'refund',
      delta: -300,
      reason: 'r',
    });
    // The amount is named after the game's premium currency (template: gems).
    expect(PREMIUM_LABEL).toBe('Gems');
    for (const amount of ['0', '-5', '1.5', '1000001'])
      expect(() => adjustmentFromFields({ kind: 'refund', amount, reason: 'r' }), amount).toThrow(
        'Gems must be a whole number from 1 to 1,000,000.',
      );
  });

  it('a correction is a signed, non-zero delta', () => {
    expect(adjustmentFromFields({ kind: 'correction', amount: '-50', reason: 'r' })).toEqual({
      kind: 'correction',
      delta: -50,
      reason: 'r',
    });
    expect(adjustmentFromFields({ kind: 'correction', amount: '50', reason: 'r' }).delta).toBe(50);
    for (const amount of ['0', '-1000001', '2.5'])
      expect(
        () => adjustmentFromFields({ kind: 'correction', amount, reason: 'r' }),
        amount,
      ).toThrow('Gems must be a non-zero whole number within ±1,000,000.');
    expect(() => adjustmentFromFields({ kind: 'grant', amount: '5', reason: 'r' })).toThrow(
      'Choose credit, refund or correction.',
    );
  });

  it('states what the game does for each kind', () => {
    const plan = (p: Record<string, unknown>, strikes?: number) =>
      writeSummary('adjustPurchase', { playerKey: 'p-1', reason: 'r', ...p }, { strikes });
    const credit = plan({ kind: 'make_good', delta: 300, transactionId: 42 }, 0);
    expect(credit.title).toBe('Credit a purchase');
    expect(credit.confirm).toBe('Credit gems');
    expect(credit.rows).toEqual([
      ['Player', 'p-1'],
      ['Effect', '+300 gems (make good), applied when the game next starts'],
      ['Transaction', '42'],
      ['Reason', 'r'],
    ]);
    expect(credit.danger).toBe(false);

    const refund = plan({ kind: 'refund', delta: -300, ticketRef: 'T-9' }, 0);
    expect(refund.rows).toEqual([
      ['Player', 'p-1'],
      ['Effect', '−300 gems (refund), applied when the game next starts'],
      ['Strike', 'Adds a refund strike (1/3)'],
      ['Ticket', 'T-9'],
      ['Reason', 'r'],
    ]);
    expect(refund.danger).toBe(true);
    expect(refund.confirm).toBe('Refund');
    expect(plan({ kind: 'refund', delta: -300 }, 2).rows).toContainEqual([
      'Strike',
      'Adds a refund strike (3/3); the 3rd strike turns purchases off (purchases_disabled)',
    ]);
    expect(plan({ kind: 'refund', delta: -300 }).rows).toContainEqual([
      'Strike',
      'Adds a refund strike; the 3rd strike turns purchases off (purchases_disabled)',
    ]);

    const up = plan({ kind: 'correction', delta: 50 });
    expect(up.title).toBe('Correct gems');
    expect(up.rows).toContainEqual([
      'Effect',
      '+50 gems (correction), applied when the game next starts',
    ]);
    const down = plan({ kind: 'correction', delta: -50 }, 2);
    expect(down.rows).toContainEqual([
      'Effect',
      '−50 gems (correction), applied when the game next starts; no strike',
    ]);
    expect(down.rows.map(([k]) => k)).not.toContain('Strike');
    expect(down.danger).toBe(true);
    expect(
      resultMessage('adjustPurchase', { adjustmentId: 7, duplicate: false }, { playerKey: 'p-1' }),
    ).toBe('Adjustment #7 recorded for p-1.');
  });
});

describe('write retries keep the commandId exactly', () => {
  function harness(statuses: number[]) {
    const sent: Array<Record<string, unknown>> = [];
    const api = {
      post: async (_path: string, body: unknown) => {
        sent.push(body as Record<string, unknown>);
        const status = statuses.shift() ?? 200;
        return status === 200
          ? { ok: true as const, status, body: { ok: true, serverNow: 1, requestId: 'r' } }
          : { ok: false as const, status, error: null };
      },
    };
    const deps = {
      api: api as never,
      connected: () => true,
      failure: (r: { status: number }) => `failed ${r.status}`,
      dialog: null as never,
    };
    const events: string[] = [];
    let retry: (() => void) | undefined;
    const report = {
      pending: () => events.push('pending'),
      ok: (m: string) => events.push(`ok ${m}`),
      fail: (m: string, _raw: unknown, r?: () => void) => {
        retry = r;
        events.push(`fail ${m}${r ? ' (retry)' : ''}`);
      },
    };
    return { sent, deps, events, report, retry: () => retry };
  }

  it('a network error or 5xx keeps it for the retry; an answer forgets it', async () => {
    const h = harness([0, 503, 200]);
    const slot: WriteSlot = {};
    await runWrite(h.deps, slot, h.report, 'letter', '/admin/v1/letters', { playerKey: 'p' });
    const first = h.sent[0]!.commandId;
    expect(slot.commandId).toBe(first);
    expect(h.events.at(-1)).toBe('fail failed 0 (retry)');
    h.retry()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.sent[1]!.commandId).toBe(first);
    expect(h.events.at(-1)).toBe('fail failed 503 (retry)');
    h.retry()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.sent[2]!.commandId).toBe(first);
    expect(h.events.at(-1)).toBe('ok Letter sent to p.');
    expect(slot.commandId).toBeUndefined();
  });

  it('a 4xx is definitive: no retry, and the next confirm mints a new commandId', async () => {
    const h = harness([409, 200]);
    const slot: WriteSlot = {};
    await runWrite(h.deps, slot, h.report, 'restore', '/admin/v1/players/restore', { seq: 1 });
    expect(h.events.at(-1)).toBe('fail failed 409');
    expect(slot.commandId).toBeUndefined();
    await runWrite(h.deps, slot, h.report, 'restore', '/admin/v1/players/restore', { seq: 1 });
    expect(h.sent[1]!.commandId).not.toBe(h.sent[0]!.commandId);
  });
});

describe('display formatting', () => {
  const now = Date.UTC(2026, 9, 1, 15, 0, 0);
  it('relative times come from the response clock, absolute times are UTC', () => {
    expect(relTime(now - 10_000, now)).toBe('just now');
    expect(relTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(relTime(now - 3 * 86_400_000, now)).toBe('3 days ago');
    expect(relTime(now + 2 * 3_600_000, now)).toBe('in 2 h');
    expect(absTime(now)).toBe('2026-10-01 15:00:00 UTC');
    expect(fmtInt(1234567)).toBe('1,234,567');
    expect(fmtBytes(19_500)).toBe('19 KB');
  });

  it('timeline details read as one line', () => {
    expect(
      detailText({ generation: 2, flags: ['progress_jump'], reason: 'important', bytes: 19500 }),
    ).toBe('generation 2 · flags progress_jump · reason important · bytes 19 KB');
    expect(detailText({ detail: { from: 1, to: 2 }, build: 'v1' })).toBe(
      'from 1 · to 2 · build v1',
    );
    expect(detailText(undefined)).toBe('');
  });
});

describe('sign-in gate', () => {
  type Reply = { status: number; body: unknown } | 'network';
  const seen: Array<{ url: string; init: RequestInit }> = [];
  let reply: Reply = 'network';
  const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
  const consoleNodes = () => document.querySelectorAll('nav, [data-view-panel], .app').length;
  const signIn = async (keyId: string, secret: string) => {
    ($('input[name="keyId"]') as HTMLInputElement).value = keyId;
    ($('input[name="secret"]') as HTMLInputElement).value = secret;
    ($('#signin-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 10));
  };
  const session = (keyId: string, scopes: string[]): Reply => ({
    status: 200,
    body: { keyId, scopes, serverNow: 1, requestId: 'req_1' },
  });
  const overview = {
    playerKey: 'p-1',
    registered: true,
    generation: 1,
    generationKind: 'normal',
    entitlement: 0,
    paidCount: 2,
    flags: [],
    strikes: 2,
    grantsPending: 0,
    erased: false,
  };
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const setValue = (form: HTMLFormElement, name: string, value: string) => {
    const input = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const submit = (form: HTMLFormElement) =>
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  const planRows = () =>
    Array.from(document.querySelectorAll('.dialog .plan dt')).map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
  const confirmDialog = async () => {
    submit($('.dialog form') as HTMLFormElement);
    await tick();
  };
  const postBody = (path: string) => {
    const call = seen.filter((c) => c.url.endsWith(path)).at(-1);
    return call ? (JSON.parse(String(call.init.body)) as Record<string, unknown>) : null;
  };
  const loadPlayer = async () => {
    ($('#player-search') as HTMLInputElement).value = 'p-1';
    submit($('[data-lookup]') as HTMLFormElement);
    await tick();
  };

  beforeAll(async () => {
    const html = readFileSync(resolve(inspectorDir, 'index.html'), 'utf8');
    const body = /<body>([\s\S]*)<\/body>/.exec(html)![1]!;
    document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    globalThis.location.hash = '#audit';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      const path = new URL(String(url)).pathname;
      const meta = { serverNow: 1, requestId: 'req_2' };
      // The audit view and the player tabs load lists: answer them empty.
      const r: Reply =
        path === '/admin/v1/session'
          ? reply
          : path === '/admin/v1/players/p-1'
            ? { status: 200, body: { ...overview, ...meta } }
            : path === '/admin/v1/grants'
              ? { status: 200, body: { grantKey: 'g-1', duplicate: false, ...meta } }
              : path === '/admin/v1/purchases/adjustments'
                ? { status: 200, body: { adjustmentId: 7, duplicate: false, ...meta } }
                : { status: 200, body: { items: [], ...meta } };
      if (r === 'network') throw new TypeError('blocked');
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    await import('../../admin-inspector/src/main.ts');
  });

  it('signed out, only the sign-in card exists (a hash reveals nothing)', () => {
    expect(consoleNodes()).toBe(0);
    expect(Array.from(document.querySelectorAll('form')).map((f) => f.id)).toEqual(['signin-form']);
    expect($('[data-env-badge]')?.textContent).toMatch(/Local|Unknown env/);
    expect(seen).toHaveLength(0);
  });

  it('verifies the key at this origin and shows inline errors', async () => {
    reply = { status: 401, body: { error: 'unauthorized', correlationId: 'c' } };
    await signIn('staging-read-1', 'wrong');
    expect(seen[0]!.url).toBe(`${globalThis.location.origin}/admin/v1/session`);
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers['x-admin-key-id']).toBe('staging-read-1');
    expect(seen[0]!.init.credentials).toBe('same-origin');
    expect($('#signin-error')?.textContent).toBe('Key ID or secret not accepted.');
    expect(($('input[name="secret"]') as HTMLInputElement).value).toBe('');
    expect(consoleNodes()).toBe(0);

    reply = 'network';
    await signIn('staging-read-1', 'secret');
    expect($('#signin-error')?.hidden).toBe(false);
    expect(consoleNodes()).toBe(0);
  });

  it('a read-only key gets players and audit without any write form', async () => {
    reply = session('staging-read-1', ['read']);
    await signIn('staging-read-1', 'secret-1');
    expect($('.app')).not.toBeNull();
    expect($('#signin')?.hidden).toBe(true);
    const nav = Array.from(document.querySelectorAll<HTMLElement>('[data-view]')).map(
      (n) => n.dataset.view,
    );
    expect(nav).toEqual(['players', 'audit']);
    for (const id of [
      'form-letter',
      'form-grant',
      'form-adjust',
      'form-flag',
      'form-publish-flag',
      'form-cohort',
    ])
      expect(document.getElementById(id), id).toBeNull();
    expect($('[data-player-actions]')).toBeNull();
    expect($('#replay-reason')).toBeNull();
    expect($('[data-session-key]')?.textContent).toBe('staging-read-1');
    expect(document.body.innerHTML).not.toContain('secret-1');
    expect(($('input[name="secret"]') as HTMLInputElement).value).toBe('');
  });

  it('sign out removes the console and clears the hash', () => {
    ($('[data-signout]') as HTMLButtonElement).click();
    expect(consoleNodes()).toBe(0);
    expect($('#signin')?.hidden).toBe(false);
    expect(globalThis.location.hash).toBe('');
  });

  it('a write key lands on the view in the hash with its forms', async () => {
    globalThis.location.hash = '#liveops';
    reply = session('staging-write-1', ['read', 'support', 'grant', 'publish', 'restore']);
    await signIn('staging-write-1', 'secret-2');
    const current = $('[aria-current="page"]') as HTMLElement;
    expect(current.dataset.view).toBe('liveops');
    for (const id of [
      'form-letter',
      'form-grant',
      'form-adjust',
      'form-flag',
      'form-publish-flag',
      'form-cohort',
    ])
      expect(document.getElementById(id), id).not.toBeNull();
    ($('[data-signout]') as HTMLButtonElement).click();
  });

  it('a key without grant sees neither Mint grant nor Fix purchase', async () => {
    globalThis.location.hash = '#players';
    reply = session('staging-support-1', ['read', 'support']);
    await signIn('staging-support-1', 'secret-3');
    expect(document.getElementById('form-letter')).not.toBeNull();
    for (const id of ['form-grant', 'act-grant', 'form-adjust', 'act-adjust'])
      expect(document.getElementById(id), id).toBeNull();
    ($('[data-signout]') as HTMLButtonElement).click();
  });

  it('a read+grant key mints a grant from the reward fields', async () => {
    globalThis.location.hash = '#players';
    reply = session('staging-grant-1', ['read', 'grant']);
    await signIn('staging-grant-1', 'secret-4');
    expect(document.getElementById('act-grant')).not.toBeNull();
    expect(document.getElementById('act-adjust')).not.toBeNull();
    expect(document.getElementById('form-letter')).toBeNull();
    await loadPlayer();
    ($('#act-grant') as HTMLButtonElement).click();
    const form = $('#form-grant') as HTMLFormElement;
    expect(form.hidden).toBe(false);
    // The reward inputs come from the game's vocabulary (template: gems, gold).
    const rewardInputs = form.querySelectorAll<HTMLInputElement>('[data-reward-fields] input');
    expect(Array.from(rewardInputs).map((i) => [i.name, i.type])).toEqual([
      ['gems', 'number'],
      ['gold', 'number'],
    ]);
    setValue(form, 'grantKey', 'g-1');
    setValue(form, 'reason', 'SUP-1');
    // Nothing to give: refused inline, no dialog.
    submit(form);
    expect(form.querySelector('output.result')?.textContent).toBe('Add at least one reward.');
    expect(($('.dialog') as HTMLDialogElement).open).toBe(false);
    setValue(form, 'gems', '100');
    setValue(form, 'gold', '5000');
    submit(form);
    expect(planRows()).toContainEqual(['Rewards', '+100 Gems (free) · +5,000 Gold']);
    await confirmDialog();
    expect(postBody('/admin/v1/grants')).toEqual({
      commandId: expect.any(String),
      playerKey: 'p-1',
      grantKey: 'g-1',
      reason: 'SUP-1',
      rewards: [
        { kind: 'premium_currency', amount: 100 },
        { kind: 'soft_currency', currency: 'gold', amount: 5000 },
      ],
    });
    ($('.dialog') as HTMLDialogElement).close();
  });

  it('Advanced (JSON) swaps the fields for the raw rewards', async () => {
    const form = $('#form-grant') as HTMLFormElement;
    const advanced = form.elements.namedItem('rewardsAdvanced') as HTMLInputElement;
    advanced.checked = true;
    advanced.dispatchEvent(new Event('change', { bubbles: true }));
    const textarea = form.elements.namedItem('rewards') as HTMLTextAreaElement;
    expect(($('#form-grant [data-reward-fields]') as HTMLElement).hidden).toBe(true);
    expect(textarea.disabled).toBe(false);
    expect(JSON.parse(textarea.value)).toEqual([
      { kind: 'premium_currency', amount: 100 },
      { kind: 'soft_currency', currency: 'gold', amount: 5000 },
    ]);
    setValue(form, 'rewards', '[{"kind":"premium_currency","amount":5,"wallet":"paid"}]');
    submit(form);
    expect(form.querySelector('output.result')?.textContent).toBe(
      'Rewards: reward 1: unsupported kind "premium_currency".',
    );
    setValue(form, 'rewards', '[{"kind":"soft_currency","currency":"gold","amount":5000}]');
    submit(form);
    expect(planRows()).toContainEqual(['Rewards', '+5,000 Gold']);
    ($('.dialog') as HTMLDialogElement).close();
  });

  it('Fix purchase sends a refund negative and warns of the 3rd strike', async () => {
    ($('#act-adjust') as HTMLButtonElement).click();
    const form = $('#form-adjust') as HTMLFormElement;
    expect(form.hidden).toBe(false);
    expect(($('#form-grant') as HTMLFormElement).hidden).toBe(true);
    const refund = form.querySelector<HTMLInputElement>('input[value="refund"]')!;
    refund.checked = true;
    refund.dispatchEvent(new Event('change', { bubbles: true }));
    expect(form.querySelector('[data-adjust-unit]')?.textContent).toBe('Gems');
    expect(form.querySelector('[data-adjust-hint]')?.textContent).toBe('to remove');
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Review refund');
    setValue(form, 'amount', '300');
    setValue(form, 'transactionId', '42');
    setValue(form, 'reason', 'Chargeback');
    submit(form);
    expect(planRows()).toEqual([
      ['Player', 'p-1'],
      ['Effect', '−300 gems (refund), applied when the game next starts'],
      [
        'Strike',
        'Adds a refund strike (3/3); the 3rd strike turns purchases off (purchases_disabled)',
      ],
      ['Transaction', '42'],
      ['Reason', 'Chargeback'],
    ]);
    expect(($('.dialog') as HTMLDialogElement).classList.contains('dialog-danger')).toBe(true);
    await confirmDialog();
    expect(postBody('/admin/v1/purchases/adjustments')).toEqual({
      commandId: expect.any(String),
      playerKey: 'p-1',
      kind: 'refund',
      delta: -300,
      reason: 'Chargeback',
      transactionId: 42,
    });
    expect($('.dialog .result-ok')?.textContent).toBe('Adjustment #7 recorded for p-1.');
    ($('.dialog') as HTMLDialogElement).close();
  });

  it('a correction is signed and takes no transaction', async () => {
    const form = $('#form-adjust') as HTMLFormElement;
    const correction = form.querySelector<HTMLInputElement>('input[value="correction"]')!;
    correction.checked = true;
    correction.dispatchEvent(new Event('change', { bubbles: true }));
    expect((form.querySelector('[data-adjust-transaction]') as HTMLElement).hidden).toBe(true);
    setValue(form, 'amount', '-50');
    setValue(form, 'transactionId', '42');
    setValue(form, 'reason', 'Fix');
    submit(form);
    expect(planRows()).toContainEqual([
      'Effect',
      '−50 gems (correction), applied when the game next starts; no strike',
    ]);
    await confirmDialog();
    expect(postBody('/admin/v1/purchases/adjustments')).toEqual({
      commandId: expect.any(String),
      playerKey: 'p-1',
      kind: 'correction',
      delta: -50,
      reason: 'Fix',
    });
    ($('.dialog') as HTMLDialogElement).close();
    ($('[data-signout]') as HTMLButtonElement).click();
  });

  it('the cohort grant takes the same reward fields', async () => {
    globalThis.location.hash = '#liveops';
    reply = session('staging-cohort-1', ['grant']);
    await signIn('staging-cohort-1', 'secret-5');
    const form = $('#form-cohort') as HTMLFormElement;
    setValue(form, 'grantKeyPrefix', 'outage-');
    setValue(form, 'reason', 'Outage');
    setValue(form, 'gold', '5000');
    submit(form);
    expect(planRows()).toContainEqual(['Rewards', '+5,000 Gold']);
    await confirmDialog();
    expect(postBody('/admin/v1/grants/cohort')).toMatchObject({
      grantKeyPrefix: 'outage-',
      dryRun: true,
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 5000 }],
    });
    ($('.dialog') as HTMLDialogElement).close();
    ($('[data-signout]') as HTMLButtonElement).click();
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
