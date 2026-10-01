// Admin inspector entry (ADR-021). Signed out, the page is only the sign-in card; the console is
// an inert <template> cloned after GET /admin/v1/session verifies the key, showing only what the
// key's scopes can use, and removed again on sign-out. No framework, no runtime deps.
// Credentials are held in a module variable (memory only): never storage, the URL or logs.
import type { AdminSessionResponse, SaveBlobResponse } from '@foundation/contracts';
import { CONTENT_ENVS, CONTENT_KINDS, PLAYER_FLAG_KINDS } from '@foundation/contracts/enums';
import { adminClient, describeFailure, normalizeOrigin, type Connection } from './api.ts';
import { mountAudit, type AuditView } from './audit.ts';
import type { AppCtx } from './context.ts';
import { environmentFor } from './env.ts';
import {
  buildIncognitoTarget,
  createIncognitoSessionId,
  incognitoSnapshot,
  isIncognitoFailed,
  isIncognitoLoaded,
  isIncognitoReady,
} from './incognito.ts';
import { mountLiveops } from './liveops.ts';
import { failureMessage, signInError } from './plans.ts';
import { mountPlayers } from './players.ts';
import { el, replace } from './render.ts';
import { accessFor, type Workspace } from './scopes.ts';
import { emptyState, qs, toast, tonePill, type Tone } from './ui.ts';

// ─── DOM lookups ───────────────────────────────────────────────────

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const signinEl = byId<HTMLElement>('signin');
const signinForm = byId<HTMLFormElement>('signin-form');
const signinError = byId<HTMLParagraphElement>('signin-error');
const signinSubmit = byId<HTMLButtonElement>('signin-submit');
const appRoot = byId<HTMLDivElement>('app-root');
const appTemplate = byId<HTMLTemplateElement>('app-template');
const toastRegion = byId<HTMLDivElement>('toasts');
const keyInput = signinForm.elements.namedItem('keyId') as HTMLInputElement;
const secretInput = signinForm.elements.namedItem('secret') as HTMLInputElement;

// ─── Environment and connection (memory only) ──────────────────────

const env = environmentFor(globalThis.location.hostname);
document.documentElement.dataset.env = env.kind;

function paintBadges(scope: ParentNode): void {
  for (const badge of Array.from(scope.querySelectorAll<HTMLElement>('[data-env-badge]'))) {
    badge.textContent = env.label;
    badge.dataset.env = env.kind;
  }
}
paintBadges(document);

// The admin origin forwards /admin/v1 to the API, so the API origin is always this page's own.
const API_ORIGIN = normalizeOrigin(globalThis.location.origin);
// The inspector build bakes the game client URL for its environment (VITE_GAME_CLIENT_URL at
// `vite build`, optional); local development falls back to the Vite game dev server.
const GAME_CLIENT_URL =
  (import.meta as unknown as { env: Record<string, string | undefined> }).env
    .VITE_GAME_CLIENT_URL || 'http://localhost:5173';

let connection: Connection | null = null;
const api = adminClient(() => connection);

function notify(message: string, tone: Tone = 'info'): void {
  toast(toastRegion, message, tone);
}

function connected(): boolean {
  if (connection) return true;
  notify('Signed out.', 'warn');
  return false;
}

// ─── Sign-in ───────────────────────────────────────────────────────

function showSigninError(message: string | null): void {
  signinError.textContent = message ?? '';
  signinError.hidden = !message;
}

let signingIn = false;

signinForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  void signIn();
});

async function signIn(): Promise<void> {
  if (signingIn) return;
  const keyId = keyInput.value.trim();
  const secret = secretInput.value;
  if (!keyId || !secret) {
    showSigninError(!keyId ? 'Enter the admin key ID.' : 'Enter the admin secret.');
    (keyId ? secretInput : keyInput).focus();
    return;
  }
  const candidate: Connection = { origin: API_ORIGIN, clientUrl: GAME_CLIENT_URL, keyId, secret };
  signingIn = true;
  signinSubmit.disabled = true;
  signinSubmit.textContent = 'Signing in…';
  signinForm.setAttribute('aria-busy', 'true');
  showSigninError(null);
  const res = await adminClient(() => candidate).get<AdminSessionResponse>('/admin/v1/session');
  signingIn = false;
  signinSubmit.disabled = false;
  signinSubmit.textContent = 'Sign in';
  signinForm.removeAttribute('aria-busy');
  if (!res.ok) {
    showSigninError(signInError(res, env.kind));
    if (res.status === 401) {
      secretInput.value = '';
      secretInput.focus();
    }
    return;
  }
  if (res.body.keyId !== keyId) {
    showSigninError('The API answered for a different key.');
    return;
  }
  connection = candidate;
  // The secret now lives only in `connection`; drop it from the form.
  signinForm.reset();
  mount(res.body);
}

function signOut(message = 'Signed out.'): void {
  connection = null;
  mounted?.abort();
  mounted = null;
  replace(appRoot, []);
  document.body.classList.remove('signed-in');
  signinEl.hidden = false;
  signinForm.reset();
  showSigninError(null);
  globalThis.history.replaceState(
    null,
    '',
    globalThis.location.pathname + globalThis.location.search,
  );
  keyInput.focus();
  notify(message);
}

// ─── The console (after sign-in) ───────────────────────────────────

let mounted: AbortController | null = null;

const VIEW_ALIASES: Record<string, Workspace> = {
  players: 'players',
  player: 'players',
  support: 'players',
  safety: 'players',
  liveops: 'liveops',
  audit: 'audit',
  ops: 'audit',
  outbox: 'audit',
};

function fillSelect(root: ParentNode, name: string, values: readonly string[]): void {
  for (const sel of Array.from(
    root.querySelectorAll<HTMLSelectElement>(`select[data-options="${name}"]`),
  )) {
    for (const v of values) sel.appendChild(el('option', { value: v }, [v]));
  }
}

function mount(session: AdminSessionResponse): void {
  const access = accessFor(session.scopes);
  const controller = new AbortController();
  mounted = controller;
  const fragment = appTemplate.content.cloneNode(true) as DocumentFragment;
  const root = fragment.firstElementChild as HTMLElement;
  // Remove (not hide) everything this key's scopes cannot use.
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-cap]'))) {
    if (!access.can(node.dataset.cap as Parameters<typeof access.can>[0])) node.remove();
  }
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-view]'))) {
    if (!access.workspaces.includes(node.dataset.view as Workspace)) node.remove();
  }
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-view-panel]'))) {
    if (!access.workspaces.includes(node.dataset.viewPanel as Workspace)) node.remove();
  }
  paintBadges(root);
  qs(root, '[data-session-key]').textContent = session.keyId;
  replace(
    qs(root, '[data-session-scopes]'),
    access.scopes.map((s) => tonePill(s, s === 'read' ? 'neutral' : 'info')),
  );
  fillSelect(root, 'player-flags', PLAYER_FLAG_KINDS);
  fillSelect(root, 'content-kinds', CONTENT_KINDS);
  fillSelect(root, 'content-envs', CONTENT_ENVS);
  appRoot.appendChild(fragment);
  signinEl.hidden = true;
  document.body.classList.add('signed-in');

  const dialog = qs<HTMLDialogElement>(root, '[data-dialog]');
  const failure: AppCtx['failure'] = (r) => failureMessage(r, env.kind);
  const ctx: AppCtx = {
    root,
    api,
    env,
    access,
    signal: controller.signal,
    writes: { api, connected, failure, dialog },
    notify,
    failure,
    launchIncognito: (playerKey, seq) => void launchIncognito(playerKey, seq),
  };

  qs(root, '[data-signout]').addEventListener('click', () => signOut());

  if (access.workspaces.length === 0) {
    replace(qs(root, '.main'), [
      emptyState('Nothing to show', `Key scopes: ${session.scopes.join(', ') || 'none'}.`),
    ]);
    qs(root, '.rail').remove();
    return;
  }

  if (access.workspaces.includes('players')) mountPlayers(ctx);
  if (access.workspaces.includes('liveops')) mountLiveops(ctx);
  const audit: AuditView | null = access.workspaces.includes('audit') ? mountAudit(ctx) : null;

  const navItems = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-view]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-view-panel]'));
  const viewFromHash = (): Workspace => {
    const v = VIEW_ALIASES[globalThis.location.hash.slice(1)];
    return v && access.workspaces.includes(v) ? v : access.workspaces[0]!;
  };
  const setView = (view: Workspace, updateHash = true): void => {
    for (const panel of panels) panel.hidden = panel.dataset.viewPanel !== view;
    for (const item of navItems) {
      if (item.dataset.view === view) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    if (updateHash && globalThis.location.hash !== `#${view}`)
      globalThis.history.replaceState(null, '', `#${view}`);
    if (view === 'audit') audit?.show();
    globalThis.scrollTo({ top: 0, behavior: 'auto' });
  };
  for (const item of navItems)
    item.addEventListener('click', () => setView(item.dataset.view as Workspace));
  globalThis.addEventListener('hashchange', () => setView(viewFromHash(), false), {
    signal: controller.signal,
  });
  setView(viewFromHash(), false);
  if (viewFromHash() === 'players') root.querySelector<HTMLInputElement>('#player-search')?.focus();
}

// ─── Play incognito ────────────────────────────────────────────────

const INCOGNITO_TIMEOUT_MS = 30_000;

async function fetchSaveBlob(playerKey: string, seq: number) {
  return api.get<SaveBlobResponse>(
    `/admin/v1/players/${encodeURIComponent(playerKey)}/saves/${seq}/blob`,
  );
}

/**
 * Open a snapshot-seeded game window. The popup is opened before the first await so browsers do
 * not classify it as a popup-blocked background window. Credentials stay in the admin closure;
 * the snapshot is sent only after the child proves its exact origin and session ID.
 */
async function launchIncognito(playerKey: string, seq: number): Promise<void> {
  if (!connected()) return;
  const c = connection;
  if (!c) return;
  const adminOrigin = globalThis.location.origin;
  const sessionId = createIncognitoSessionId();
  if (!sessionId) {
    notify('Secure randomness is unavailable; refusing to open a snapshot session.', 'danger');
    return;
  }
  // Never the inspector's own origin; HTTPS (or localhost HTTP) only.
  const target = buildIncognitoTarget(c.clientUrl ?? '', sessionId, adminOrigin);
  if (!target) {
    notify('No usable game URL for this build (VITE_GAME_CLIENT_URL).', 'danger');
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
    notify(message, tone === 'ok' ? 'ok' : 'danger');
  };
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (!popup || event.source !== popup || event.origin !== target.origin) return;
    if (isIncognitoFailed(event.data, sessionId)) {
      finish('The game rejected the snapshot. See the game window.', 'err');
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
    finish('Popup blocked. Allow popups for this page, then try again.', 'err');
    return;
  }
  notify(`Opening seq ${seq} incognito…`);
  timeout.handle = globalThis.setTimeout(() => {
    finish('Incognito session timed out before the game confirmed it was loaded.', 'err', true);
  }, INCOGNITO_TIMEOUT_MS);
}

// Signed out on load: the card is the page. A hash only picks the view after sign-in.
keyInput.focus();
