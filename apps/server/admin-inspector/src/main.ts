// Admin inspector entry (ADR-021): plain forms over the admin API. No framework, no runtime deps.
// Credentials are held in a module variable (memory only). Every write body carries a commandId
// minted on submit and reused verbatim when the user retries after a network error (§6).
import type {
  AdminActionRecord,
  AdminActionsResponse,
  OutboxDeadLetter,
  OutboxDeadLettersResponse,
  PlayerOverview,
  SaveBlobResponse,
  SaveHistoryResponse,
  SnapshotMeta,
  TimelineItem,
  TimelineResponse,
} from '@foundation/contracts';
import { CONTENT_ENVS, CONTENT_KINDS, PLAYER_FLAG_KINDS } from '@foundation/contracts/enums';
import {
  adminClient,
  describeFailure,
  normalizeOrigin,
  type AdminResult,
  type Connection,
} from './api.ts';
import {
  append,
  clear,
  el,
  fmtTime,
  fmtValue,
  jsonTree,
  keyValue,
  pill,
  replace,
  table,
  text,
} from './render.ts';
import {
  buildIncognitoTarget,
  createIncognitoSessionId,
  incognitoSnapshot,
  isIncognitoFailed,
  isIncognitoLoaded,
  isIncognitoReady,
} from './incognito.ts';

// ─── DOM lookups ───────────────────────────────────────────────────

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const statusEl = byId<HTMLParagraphElement>('status');
const connectForm = byId<HTMLFormElement>('connect-form');
const lookupForm = byId<HTMLFormElement>('lookup-form');
const overviewEl = byId<HTMLDivElement>('overview');
const timelineEl = byId<HTMLDivElement>('timeline');
const savesEl = byId<HTMLDivElement>('saves');
const blobEl = byId<HTMLDivElement>('blob');
const actionsEl = byId<HTMLDivElement>('actions');
const deadLettersEl = byId<HTMLDivElement>('dead-letters');
const deadLettersForm = byId<HTMLFormElement>('dead-letters-form');
const incognitoForm = byId<HTMLFormElement>('incognito-form');

type ViewName = 'setup' | 'support' | 'liveops' | 'safety' | 'audit';

const navItems = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
const viewPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-view-panel]'));
const viewAliases: Record<string, ViewName> = {
  setup: 'setup',
  connect: 'setup',
  support: 'support',
  player: 'support',
  liveops: 'liveops',
  writes: 'support',
  safety: 'safety',
  audit: 'audit',
  ops: 'audit',
  outbox: 'audit',
};

function viewFromHash(): ViewName {
  return viewAliases[globalThis.location.hash.slice(1)] ?? 'setup';
}

function setView(view: ViewName, updateHash = true): void {
  for (const panel of viewPanels) panel.hidden = panel.dataset.viewPanel !== view;
  for (const item of navItems) {
    const selected = item.dataset.view === view;
    if (selected) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  if (updateHash && globalThis.location.hash !== `#${view}`)
    globalThis.history.replaceState(null, '', `#${view}`);
  const workspace = document.querySelector<HTMLElement>('.workspace');
  workspace?.scrollTo({ top: 0, behavior: 'auto' });
}

for (const item of navItems)
  item.addEventListener('click', () => setView(item.dataset.view as ViewName));
globalThis.addEventListener('hashchange', () => setView(viewFromHash(), false));
setView(viewFromHash(), false);

// ─── Connection (memory only) ──────────────────────────────────────

let connection: Connection | null = null;
const api = adminClient(() => connection);

function setStatus(msg: string, tone: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = `status ${tone}`.trim();
}

function connected(): boolean {
  if (connection) return true;
  setStatus('Enter the API origin and admin credentials first.', 'err');
  setView('setup');
  return false;
}

connectForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const fd = new FormData(connectForm);
  const origin = normalizeOrigin(String(fd.get('origin') ?? ''));
  const clientUrl = String(fd.get('clientUrl') ?? '').trim();
  const keyId = String(fd.get('keyId') ?? '').trim();
  const secret = String(fd.get('secret') ?? '');
  const clientTarget = buildIncognitoTarget(
    clientUrl,
    '00000000-0000-4000-8000-000000000000',
    globalThis.location.origin,
  );
  if (!origin || !clientTarget || !keyId || !secret) {
    setStatus(
      'API origin, HTTPS game client URL (or localhost HTTP), key id and secret are required.',
      'err',
    );
    return;
  }
  connection = { origin, clientUrl, keyId, secret };
  setStatus(
    `API ${origin} · disposable snapshots open only at ${clientTarget.origin} · key "${keyId}" is held in memory only.`,
    'ok',
  );
  setView('support');
});

byId<HTMLButtonElement>('forget').addEventListener('click', () => {
  connection = null;
  connectForm.reset();
  setStatus('Credentials forgotten.', '');
  setView('setup');
});

// ─── Result reporting ──────────────────────────────────────────────

function stripMeta(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { serverNow: _s, requestId: _r, ...rest } = body as Record<string, unknown>;
  return rest;
}

function noteServerNow(body: unknown): void {
  const now = (body as { serverNow?: unknown } | null)?.serverNow;
  if (typeof now === 'number' && connection)
    setStatus(`Connected to ${connection.origin} · server time ${fmtTime(now)}`, 'ok');
}

function showResult(out: HTMLElement, tone: 'ok' | 'err' | 'warn', msg: string): void {
  out.textContent = msg;
  out.className = `result ${tone}`;
}

// ─── Writes with commandId reuse ───────────────────────────────────

interface WriteSlot {
  commandId?: string | undefined;
}

/**
 * POST a write. The slot keeps the commandId across retries: a network failure (status 0) or a
 * 5xx leaves the commandId in place and offers a retry button; a definitive answer (2xx / 4xx)
 * clears it so the next submit mints a fresh command.
 */
async function runWrite(
  slot: WriteSlot,
  out: HTMLElement,
  path: string,
  payload: Record<string, unknown>,
  onOk?: (body: unknown) => void,
): Promise<void> {
  if (!connected()) {
    showResult(out, 'err', 'Not connected.');
    return;
  }
  const commandId = slot.commandId ?? crypto.randomUUID();
  slot.commandId = commandId;
  showResult(out, 'warn', `Sending… commandId ${commandId}`);
  const res: AdminResult<unknown> = await api.post(path, { commandId, ...payload });
  if (res.ok) {
    slot.commandId = undefined;
    noteServerNow(res.body);
    showResult(out, 'ok', `OK · commandId ${commandId}\n${JSON.stringify(stripMeta(res.body))}`);
    onOk?.(res.body);
    return;
  }
  const retryable = res.status === 0 || res.status >= 500;
  if (!retryable) slot.commandId = undefined;
  showResult(out, 'err', `${describeFailure(res)}\ncommandId ${commandId}`);
  if (retryable) {
    const retry = el('button', { type: 'button', class: 'small' }, ['Retry (same commandId)']);
    retry.addEventListener('click', () => void runWrite(slot, out, path, payload, onOk));
    append(out, [' ', retry]);
  }
}

type FieldKind =
  | 'string'
  | 'optional-string'
  | 'int'
  | 'optional-int'
  | 'bool'
  | 'optional-bool'
  | 'json'
  | 'flag-value';

interface FieldSpec {
  name: string;
  kind: FieldKind;
}

class FormError extends Error {}

function parseFlagValue(raw: string): boolean | number | string {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  return raw;
}

/** Read a form into a JSON body according to the field specs (throws FormError on bad input). */
function readForm(form: HTMLFormElement, spec: FieldSpec[]): Record<string, unknown> {
  const fd = new FormData(form);
  const out: Record<string, unknown> = {};
  for (const f of spec) {
    const raw = fd.get(f.name);
    const str = typeof raw === 'string' ? raw : '';
    switch (f.kind) {
      case 'string':
        if (!str.trim()) throw new FormError(`${f.name} is required`);
        out[f.name] = str;
        break;
      case 'optional-string':
        if (str.trim()) out[f.name] = str;
        break;
      case 'int': {
        const n = Number(str);
        if (!Number.isInteger(n) || n < 0) throw new FormError(`${f.name} must be an integer ≥ 0`);
        out[f.name] = n;
        break;
      }
      case 'optional-int': {
        if (!str.trim()) break;
        const n = Number(str);
        if (!Number.isInteger(n) || n < 0) throw new FormError(`${f.name} must be an integer ≥ 0`);
        out[f.name] = n;
        break;
      }
      case 'bool':
        out[f.name] = raw !== null;
        break;
      case 'optional-bool':
        if (raw !== null) out[f.name] = true;
        break;
      case 'json':
        try {
          out[f.name] = JSON.parse(str);
        } catch {
          throw new FormError(`${f.name} must be valid JSON`);
        }
        break;
      case 'flag-value':
        out[f.name] = parseFlagValue(str);
        break;
    }
  }
  return out;
}

const formSlots = new WeakMap<HTMLFormElement, WriteSlot>();

function bindWriteForm(id: string, spec: FieldSpec[], onOk?: (body: unknown) => void): void {
  const form = byId<HTMLFormElement>(id);
  const path = form.dataset.path;
  if (!path) throw new Error(`${id} lacks data-path`);
  const out = form.querySelector('output.result') as HTMLElement;
  formSlots.set(form, {});
  // Editing the form means a different command: forget the pending commandId.
  form.addEventListener('input', () => {
    const slot = formSlots.get(form);
    if (slot) slot.commandId = undefined;
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const slot = formSlots.get(form) ?? {};
    let payload: Record<string, unknown>;
    try {
      payload = readForm(form, spec);
    } catch (e) {
      showResult(out, 'err', e instanceof Error ? e.message : String(e));
      return;
    }
    void runWrite(slot, out, path, payload, onOk);
  });
}

// ─── Player lookup ─────────────────────────────────────────────────

let loadedPlayerKey = '';

function prefillPlayerInputs(playerKey: string): void {
  for (const input of Array.from(
    document.querySelectorAll<HTMLInputElement>('input[data-player]'),
  )) {
    if (!input.value || input.value === loadedPlayerKey) input.value = playerKey;
  }
  loadedPlayerKey = playerKey;
}

function renderOverview(o: PlayerOverview): void {
  const pairs: Array<[string, unknown]> = [
    ['playerKey', o.playerKey],
    ['registered', o.registered],
    ['erased', o.erased],
    ['firstSeenAt', fmtTime(o.firstSeenAt)],
    ['lastSeenAt', fmtTime(o.lastSeenAt)],
    ['lastBuildVersion', o.lastBuildVersion ?? ''],
    ['generation', `${o.generation} (${o.generationKind})`],
    ['anchor seq', o.anchor ? `${o.anchor.seq} · progress ${o.anchor.progress}` : 'none'],
    [
      'pending quarantine',
      o.pendingQuarantine
        ? `seq ${o.pendingQuarantine.seq} · progress ${o.pendingQuarantine.progress}`
        : 'none',
    ],
    ['entitlement', o.entitlement],
    ['paidCount', o.paidCount],
    ['strikes', o.strikes],
    ['grantsPending', o.grantsPending],
    [
      'flags',
      o.flags.length
        ? o.flags.map((f) => `${f.flag}${f.until ? ` until ${fmtTime(f.until)}` : ''}`).join(', ')
        : 'none',
    ],
  ];
  replace(overviewEl, [keyValue(pairs)]);
}

function renderTimeline(items: TimelineItem[]): void {
  if (!items.length) {
    replace(timelineEl, [text('p', 'No timeline items.', 'hint')]);
    return;
  }
  replace(timelineEl, [
    table<TimelineItem>(
      [
        { header: 'at', cell: (i) => fmtTime(i.at) },
        { header: 'kind', cell: (i) => i.kind },
        { header: 'ref', cell: (i) => i.ref },
        { header: 'summary', cell: (i) => i.summary, wrap: true },
        {
          header: 'detail',
          cell: (i) => (i.detail === undefined ? '' : fmtValue(i.detail)),
          wrap: true,
        },
      ],
      items,
    ),
  ]);
}

async function viewBlob(playerKey: string, seq: number): Promise<void> {
  replace(blobEl, [text('p', `Loading blob seq ${seq}…`, 'hint')]);
  const res = await fetchSaveBlob(playerKey, seq);
  if (!res.ok) {
    replace(blobEl, [text('p', describeFailure(res), 'result err')]);
    return;
  }
  noteServerNow(res.body);
  const { enc, blob, blobSha256, generation } = res.body;
  const head = keyValue([
    ['seq', seq],
    ['generation', generation],
    ['enc', enc],
    ['sha256', blobSha256],
    ['bytes (encoded)', blob.length],
  ]);
  const decoded = await decodeBlob(enc, blob);
  if (decoded.ok) replace(blobEl, [head, jsonTree(decoded.value)]);
  else
    replace(blobEl, [
      head,
      text('p', `Could not decode as JSON (${decoded.reason}); raw text below.`, 'hint'),
      text('pre', blob, 'raw'),
    ]);
}

async function fetchSaveBlob(
  playerKey: string,
  seq: number,
): Promise<AdminResult<SaveBlobResponse>> {
  return api.get<SaveBlobResponse>(
    `/admin/v1/players/${encodeURIComponent(playerKey)}/saves/${seq}/blob`,
  );
}

async function decodeBlob(
  enc: string,
  blob: string,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  try {
    if (enc === 'json') return { ok: true, value: JSON.parse(blob) };
    if (enc === 'gzip+b64') {
      const bin = atob(blob);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const json = await new Response(stream).text();
      return { ok: true, value: JSON.parse(json) };
    }
    return { ok: false, reason: `unknown encoding ${enc}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function renderSaves(playerKey: string, items: SnapshotMeta[]): void {
  if (!items.length) {
    replace(savesEl, [text('p', 'No saves.', 'hint')]);
    return;
  }
  replace(savesEl, [
    table<SnapshotMeta>(
      [
        { header: 'seq', cell: (s) => String(s.seq) },
        { header: 'gen', cell: (s) => String(s.generation) },
        { header: 'progress', cell: (s) => String(s.progress) },
        { header: 'disposition', cell: (s) => pill(s.disposition) },
        { header: 'flags', cell: (s) => s.flags.join(', ') },
        { header: 'reason', cell: (s) => s.reason },
        { header: 'schema', cell: (s) => String(s.schemaVersion) },
        { header: 'build', cell: (s) => s.buildVersion },
        { header: 'savedAt', cell: (s) => fmtTime(s.savedAt) },
        { header: 'receivedAt', cell: (s) => fmtTime(s.receivedAt) },
        { header: 'bytes', cell: (s) => String(s.bytes) },
        {
          header: 'review',
          cell: (s) => (s.review ? `${s.review.action} @ ${fmtTime(s.review.at)}` : ''),
        },
        {
          header: 'blob',
          cell: (s) => {
            if (!s.hasBlob) return 'none (pruned)';
            const view = el('button', { type: 'button', class: 'small' }, ['View']);
            view.addEventListener('click', () => void viewBlob(playerKey, s.seq));
            const play = el('button', { type: 'button', class: 'small button-secondary' }, [
              'Play incognito',
            ]);
            play.addEventListener('click', () => void launchIncognito(playerKey, s.seq));
            return [view, ' ', play];
          },
        },
      ],
      items,
    ),
  ]);
}

lookupForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!connected()) return;
  const playerKey = String(new FormData(lookupForm).get('playerKey') ?? '').trim();
  if (!playerKey) return;
  void loadPlayer(playerKey);
});

const INCOGNITO_TIMEOUT_MS = 30_000;

/**
 * Open a snapshot-seeded game window. The popup is opened before the first await so browsers do
 * not classify it as a popup-blocked background window. Credentials stay in the admin closure;
 * the snapshot is sent only after the child proves its exact origin and session ID.
 */
async function launchIncognito(playerKey: string, seq: number, out?: HTMLElement): Promise<void> {
  if (!connected()) {
    if (out) showResult(out, 'err', 'Not connected.');
    return;
  }
  const c = connection;
  if (!c) return;
  const adminOrigin = globalThis.location.origin;
  const sessionId = createIncognitoSessionId();
  if (!sessionId) {
    const message = 'Secure randomness is unavailable; refusing to open a snapshot session.';
    setStatus(message, 'err');
    if (out) showResult(out, 'err', message);
    return;
  }
  const target = buildIncognitoTarget(c.clientUrl ?? '', sessionId, adminOrigin);
  if (!target) {
    const message =
      'Use HTTPS for the inspector and game client (localhost HTTP is allowed for development).';
    setStatus(message, 'err');
    if (out) showResult(out, 'err', message);
    return;
  }

  let popup: Window | null = null;
  let phase: 'waiting' | 'fetching' | 'sent' | 'done' | 'failed' = 'waiting';
  const timeout: { handle?: ReturnType<typeof setTimeout> } = {};
  const finish = (message: string, tone: 'ok' | 'err', close = false): void => {
    if (phase === 'done' || phase === 'failed') return;
    phase = tone === 'ok' ? 'done' : 'failed';
    globalThis.removeEventListener('message', onMessage);
    if (timeout.handle !== undefined) globalThis.clearTimeout(timeout.handle);
    if (close) popup?.close();
    setStatus(message, tone);
    if (out) showResult(out, tone, message);
  };
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (!popup || event.source !== popup || event.origin !== target.origin) return;
    if (isIncognitoFailed(event.data, sessionId)) {
      finish(
        'The game rejected the disposable snapshot. Check the game window for details.',
        'err',
      );
      return;
    }
    if (isIncognitoLoaded(event.data, sessionId)) {
      finish(`Incognito session loaded · player ${playerKey} · seq ${seq}`, 'ok');
      return;
    }
    if (!isIncognitoReady(event.data, sessionId) || phase !== 'waiting') return;
    phase = 'fetching';
    void (async () => {
      const res = await fetchSaveBlob(playerKey, seq);
      if (!res.ok) {
        const message =
          res.status === 404
            ? `Save seq ${seq} is unavailable (the retained blob may have been pruned).`
            : `Could not load save seq ${seq}: ${describeFailure(res)}`;
        finish(message, 'err', true);
        return;
      }
      if (phase !== 'fetching') return;
      if (!popup || popup.closed) {
        finish('The incognito window closed before its snapshot could be sent.', 'err');
        return;
      }
      if (res.body.seq !== seq || res.body.enc !== 'json') {
        finish(
          'The save endpoint returned an unexpected snapshot identity or encoding.',
          'err',
          true,
        );
        return;
      }
      try {
        popup.postMessage(
          incognitoSnapshot(
            sessionId,
            playerKey,
            res.body.seq,
            res.body.generation,
            res.body.enc,
            res.body.blob,
          ),
          target.origin,
        );
        phase = 'sent';
      } catch {
        finish('The incognito window closed before its snapshot could be sent.', 'err', true);
      }
    })();
  };

  globalThis.addEventListener('message', onMessage);
  popup = globalThis.open(target.url, '_blank', 'popup,width=1200,height=900');
  if (!popup) {
    finish('Popup blocked. Allow popups for the inspector, then try again.', 'err');
    return;
  }
  timeout.handle = globalThis.setTimeout(() => {
    finish('Incognito session timed out before the game confirmed it was loaded.', 'err', true);
  }, INCOGNITO_TIMEOUT_MS);
}

incognitoForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const out = incognitoForm.querySelector('output.result') as HTMLElement;
  const fd = new FormData(incognitoForm);
  const playerKey = String(fd.get('playerKey') ?? '').trim();
  const rawSeq = String(fd.get('seq') ?? '').trim();
  const seq = Number(rawSeq);
  if (!playerKey || !Number.isSafeInteger(seq) || seq < 0) {
    showResult(out, 'err', 'Player key and a non-negative integer save sequence are required.');
    return;
  }
  void launchIncognito(playerKey, seq, out);
});

async function loadPlayer(playerKey: string): Promise<void> {
  const enc = encodeURIComponent(playerKey);
  replace(overviewEl, [text('p', 'Loading…', 'hint')]);
  clear(timelineEl);
  clear(savesEl);
  clear(blobEl);
  const [ov, tl, sv] = await Promise.all([
    api.get<PlayerOverview>(`/admin/v1/players/${enc}`),
    api.get<TimelineResponse>(`/admin/v1/players/${enc}/timeline`),
    api.get<SaveHistoryResponse>(`/admin/v1/players/${enc}/saves?limit=100`),
  ]);
  if (ov.ok) {
    noteServerNow(ov.body);
    renderOverview(ov.body);
    prefillPlayerInputs(playerKey);
  } else replace(overviewEl, [text('p', describeFailure(ov), 'result err')]);
  if (tl.ok) renderTimeline(tl.body.items);
  else replace(timelineEl, [text('p', describeFailure(tl), 'result err')]);
  if (sv.ok) renderSaves(playerKey, sv.body.items);
  else replace(savesEl, [text('p', describeFailure(sv), 'result err')]);
}

// ─── Write forms ───────────────────────────────────────────────────

function fillSelect(id: string, values: readonly string[]): void {
  const sel = byId<HTMLSelectElement>(id);
  for (const v of values) {
    const opt = el('option', { value: v }, [v]);
    sel.appendChild(opt);
  }
}
fillSelect('content-kind', CONTENT_KINDS);
fillSelect('content-env', CONTENT_ENVS);
fillSelect('player-flag-kind', PLAYER_FLAG_KINDS);

const S = (name: string, kind: FieldKind = 'string'): FieldSpec => ({ name, kind });

bindWriteForm('letter-form', [
  S('playerKey'),
  S('title'),
  S('body'),
  S('grantKey', 'optional-string'),
  S('ticketRef', 'optional-string'),
  S('reason'),
]);
bindWriteForm('grant-form', [
  S('playerKey'),
  S('grantKey'),
  S('rewards', 'json'),
  S('reason'),
  S('ticketRef', 'optional-string'),
  S('title', 'optional-string'),
  S('body', 'optional-string'),
  S('expiresAt', 'optional-int'),
]);
bindWriteForm('cohort-form', [
  S('grantKeyPrefix'),
  S('predicate', 'json'),
  S('rewards', 'json'),
  S('reason'),
  S('ticketRef', 'optional-string'),
  S('dryRun', 'bool'),
  S('title', 'optional-string'),
  S('body', 'optional-string'),
]);
bindWriteForm('flag-form', [
  S('key'),
  S('enabled', 'bool'),
  S('value', 'flag-value'),
  S('rolloutPercent', 'int'),
  S('segmentId', 'optional-string'),
  S('shadow', 'optional-bool'),
  S('reason'),
]);
bindWriteForm('content-form', [
  S('kind'),
  S('env'),
  S('document', 'json'),
  S('minBuildVersion', 'optional-string'),
  S('reason'),
]);
bindWriteForm(
  'restore-form',
  [S('playerKey'), S('seq', 'int'), S('expectedGeneration', 'int'), S('reason')],
  () => {
    if (loadedPlayerKey) void loadPlayer(loadedPlayerKey);
  },
);
bindWriteForm('review-form', [S('playerKey'), S('seq', 'int'), S('action'), S('reason')], () => {
  if (loadedPlayerKey) void loadPlayer(loadedPlayerKey);
});
bindWriteForm('player-flag-form', [
  S('playerKey'),
  S('flag'),
  S('enabled', 'bool'),
  S('until', 'optional-int'),
  S('reason'),
]);

// Sensible defaults for the JSON textareas (kept out of the HTML so the markup stays static).
const DEFAULT_REWARDS = '[{"kind":"soft_currency","currency":"gold","amount":100}]';
(byId<HTMLFormElement>('grant-form').elements.namedItem('rewards') as HTMLTextAreaElement).value =
  DEFAULT_REWARDS;
(byId<HTMLFormElement>('cohort-form').elements.namedItem('rewards') as HTMLTextAreaElement).value =
  DEFAULT_REWARDS;
(
  byId<HTMLFormElement>('cohort-form').elements.namedItem('predicate') as HTMLTextAreaElement
).value = '{"fact":"registered","op":"eq","value":true}';
(
  byId<HTMLFormElement>('content-form').elements.namedItem('document') as HTMLTextAreaElement
).value = '{"version":1}';

// ─── Admin actions ─────────────────────────────────────────────────

byId<HTMLButtonElement>('load-actions').addEventListener('click', () => void loadActions());

async function loadActions(): Promise<void> {
  if (!connected()) return;
  replace(actionsEl, [text('p', 'Loading…', 'hint')]);
  const res = await api.get<AdminActionsResponse>('/admin/v1/actions');
  if (!res.ok) {
    replace(actionsEl, [text('p', describeFailure(res), 'result err')]);
    return;
  }
  noteServerNow(res.body);
  if (!res.body.items.length) {
    replace(actionsEl, [text('p', 'No admin actions recorded.', 'hint')]);
    return;
  }
  replace(actionsEl, [
    table<AdminActionRecord>(
      [
        { header: 'id', cell: (a) => String(a.id) },
        { header: 'at', cell: (a) => fmtTime(a.at) },
        { header: 'key', cell: (a) => a.adminKeyId },
        { header: 'scope', cell: (a) => a.scope },
        { header: 'command', cell: (a) => a.commandType },
        { header: 'target', cell: (a) => a.target ?? '', wrap: true },
        { header: 'outcome', cell: (a) => a.outcome },
        { header: 'reason', cell: (a) => a.reason ?? '', wrap: true },
        { header: 'commandId', cell: (a) => a.commandId },
      ],
      res.body.items,
    ),
  ]);
}

// ─── Dead letters + replay ─────────────────────────────────────────

const replaySlots = new Map<number, WriteSlot>();

deadLettersForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  void loadDeadLetters();
});

async function loadDeadLetters(): Promise<void> {
  if (!connected()) return;
  replace(deadLettersEl, [text('p', 'Loading…', 'hint')]);
  const res = await api.get<OutboxDeadLettersResponse>('/admin/v1/outbox/dead-letters');
  if (!res.ok) {
    replace(deadLettersEl, [text('p', describeFailure(res), 'result err')]);
    return;
  }
  noteServerNow(res.body);
  if (!res.body.items.length) {
    replace(deadLettersEl, [text('p', 'No dead letters.', 'hint')]);
    return;
  }
  replace(deadLettersEl, [
    table<OutboxDeadLetter>(
      [
        { header: 'id', cell: (d) => String(d.id) },
        { header: 'outboxId', cell: (d) => String(d.outboxId) },
        { header: 'consumer', cell: (d) => d.consumer },
        { header: 'kind', cell: (d) => d.kind },
        { header: 'attempts', cell: (d) => String(d.attempts) },
        { header: 'lastError', cell: (d) => d.lastError, wrap: true },
        { header: 'deadAt', cell: (d) => fmtTime(d.deadAt) },
        { header: 'replayedAt', cell: (d) => (d.replayedAt ? fmtTime(d.replayedAt) : '') },
        {
          header: 'replay',
          cell: (d) => {
            const out = el('output', { class: 'result' });
            const b = el('button', { type: 'button', class: 'small' }, ['Replay']);
            b.addEventListener('click', () => {
              const reason = String(new FormData(deadLettersForm).get('reason') ?? '').trim();
              if (!reason) {
                showResult(out, 'err', 'Enter a replay reason above first.');
                return;
              }
              const slot = replaySlots.get(d.id) ?? {};
              replaySlots.set(d.id, slot);
              void runWrite(slot, out, '/admin/v1/outbox/replay', {
                outboxId: d.outboxId,
                consumer: d.consumer,
                reason,
              });
            });
            return el('div', {}, [b, out]);
          },
          wrap: true,
        },
      ],
      res.body.items,
    ),
  ]);
}

setStatus('Not connected. Credentials are kept in memory only.', '');
