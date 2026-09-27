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

export function serverUrl() {
  try {
    const param = new URL(window.location.href).searchParams.get('server');
    if (param && /^https?:\/\//.test(param)) storage()?.setItem(SERVER_KEY, param.replace(/\/+$/, ''));
  } catch { /* no window */ }
  const configured = storage()?.getItem(SERVER_KEY) || import.meta.env?.VITE_WARPCREW_SERVER || '';
  return configured ? configured.replace(/\/+$/, '') : null;
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

export const fetchCloudSave = () => request('GET', '/v1/saves/current');

export function pushCloudSave(player, { savedAt = Date.now(), clientSeq = null, keepalive = false, archive = false } = {}) {
  const { cloudDirty, ...clean } = player;
  return request('PUT', '/v1/saves', {
    blob: JSON.stringify({ player: clean, savedAt }),
    savedAt,
    clientSeq,
    baseSeq: Number.isSafeInteger(player.cloudSeq) ? player.cloudSeq : null,
    ...(archive ? { archive: true } : {}),
  }, { keepalive });
}

export const verifyReceipt = (receipt) => request('POST', '/v1/purchases/verify', { receipt });
