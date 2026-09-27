// @ts-nocheck
/**
 * Save and purchase server client. Enabled only when a server is configured:
 * `?server=<url>` (remembered) or VITE_WARPCREW_SERVER at build time.
 * Identity is Jest's signed player token; outside Jest a random dev id is used,
 * which only a dev-auth server accepts.
 */
import { getPlayerSigned } from './platform.js';

const SERVER_KEY = 'wc.server';
const DEV_ID_KEY = 'wc.devPlayerId';
const TIMEOUT_MS = 8000;

function storage() {
  try { return window.localStorage; } catch { return null; }
}

/**
 * Production talks only to the server compiled in at build time. A `?server=`
 * override exists for development builds only; anywhere else it is ignored and
 * any remembered override is cleared, so a crafted link cannot redirect the
 * player's Jest token or inject saves and grants.
 */
function devOverridesAllowed() {
  return Boolean(import.meta.env?.DEV) || import.meta.env?.VITE_ALLOW_SERVER_OVERRIDE === '1';
}

function acceptableServer(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || (local && url.protocol === 'http:');
  } catch {
    return false;
  }
}

export function serverUrl() {
  const store = storage();
  // Node-only test hook: `process` does not exist in browsers.
  const compiled = import.meta.env?.VITE_WARPCREW_SERVER || globalThis.process?.env?.WARPCREW_TEST_SERVER || '';
  if (!devOverridesAllowed()) {
    store?.removeItem(SERVER_KEY);
    return compiled && acceptableServer(compiled) ? compiled.replace(/\/+$/, '') : null;
  }
  try {
    const param = new URL(window.location.href).searchParams.get('server');
    if (param && acceptableServer(param)) store?.setItem(SERVER_KEY, param.replace(/\/+$/, ''));
  } catch { /* no window */ }
  const configured = store?.getItem(SERVER_KEY) || compiled;
  return configured && acceptableServer(configured) ? configured.replace(/\/+$/, '') : null;
}

export function cloudEnabled() {
  return Boolean(serverUrl());
}

async function identity() {
  const signed = await getPlayerSigned();
  if (signed) return { playerId: signed.playerId, headers: { 'x-player-id': signed.playerId, authorization: `Bearer ${signed.token}` } };
  const store = storage();
  let devId = store?.getItem(DEV_ID_KEY);
  if (!devId) {
    devId = `dev_${Math.random().toString(36).slice(2, 12)}`;
    store?.setItem(DEV_ID_KEY, devId);
  }
  return { playerId: devId, headers: { 'x-player-id': devId } };
}

async function request(method, path, body, { keepalive = false } = {}) {
  const base = serverUrl();
  if (!base) return { ok: false, reason: 'no_server' };
  const { headers } = await identity();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
      keepalive,
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? { ok: true, data } : { ok: false, status: response.status, reason: data.error || `http_${response.status}` };
  } catch (e) {
    return { ok: false, reason: 'network', error: String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Server clock offset, learned from every response. Monetized timers (drydock
// builds, offer windows, siege resets) use it while online so a device clock
// that is simply wrong cannot finish builds. Offline, the device clock is all
// there is; that limit is documented in server/README.md.
let clockOffsetMs = 0;
function learnClock(result) {
  const serverNow = result?.data?.serverNow;
  if (result?.ok && Number.isFinite(serverNow)) clockOffsetMs = serverNow - Date.now();
  return result;
}

export function trustedNow() {
  return Date.now() + clockOffsetMs;
}

export const fetchCloudSave = async () => learnClock(await request('GET', '/v1/saves/current'));

export async function pushCloudSave(player, { savedAt = trustedNow(), clientSeq = null, keepalive = false, archive = false } = {}) {
  const { cloudDirty, ...clean } = player;
  return learnClock(await request('PUT', '/v1/saves', {
    blob: JSON.stringify({ player: clean, savedAt }),
    savedAt,
    clientSeq,
    baseSeq: Number.isSafeInteger(player.cloudSeq) ? player.cloudSeq : null,
    ...(archive ? { archive: true } : {}),
  }, { keepalive }));
}

export const verifyReceipt = (receipt) => request('POST', '/v1/purchases/verify', { receipt });
