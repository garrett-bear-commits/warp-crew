// Runtime configuration for the core client. Build-time inputs (Vite env):
//   VITE_WARPCREW_SERVER   the core API, compiled in (https, or http on localhost). Unset (the
//                          GitHub Pages QA build): no server, the game plays fully offline on the
//                          local mock, as before the port.
//   VITE_WARPCREW_GAME_ID  the save namespace and the mock receipt audience (default 'warpcrew');
//                          the server's GAME_ID is the Jest audience for real tokens.
//   VITE_BUILD_VERSION     sent as x-build-version (default the package version).
// Development builds only (import.meta.env.DEV): `?server=<url>` (remembered) points the client at
// another server and `?player=<id>` picks the mock player. Production builds ignore both and clear
// a remembered override, so a crafted link can never redirect a Jest token or inject saves.

const SERVER_KEY = 'wc.server';
const PLAYER_KEY = 'warpcrew:playerId';
const PLAYER_ID = /^[A-Za-z0-9_-]{1,120}$/;

const viteEnv = /** @type {Record<string, unknown>} */ (import.meta.env || {});

/** https anywhere, or http on a loopback host. */
export function acceptableServer(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || (local && url.protocol === 'http:');
  } catch {
    return false;
  }
}

const trim = (url) => url.replace(/\/+$/, '');

function safeStorage(storage) {
  return {
    get(key) { try { return storage?.getItem(key) ?? null; } catch { return null; } },
    set(key, value) { try { storage?.setItem(key, value); } catch { /* blocked */ } },
    remove(key) { try { storage?.removeItem(key); } catch { /* blocked */ } },
  };
}

function randomId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * @param {{ env?: Record<string, unknown>, search?: string, storage?: Storage | null, dev?: boolean }} [o]
 * @returns {{ serverUrl: string | null, gameId: string, buildVersion: string, mockPlayerId: string, dev: boolean }}
 */
export function readConfig(o = {}) {
  const env = o.env ?? viteEnv;
  const dev = o.dev ?? env.DEV === true;
  const store = safeStorage(o.storage === undefined ? globalThis.localStorage : o.storage);
  const params = new URLSearchParams(o.search ?? globalThis.location?.search ?? '');
  const compiled = typeof env.VITE_WARPCREW_SERVER === 'string' ? env.VITE_WARPCREW_SERVER : '';

  let serverUrl = null;
  if (!dev) {
    store.remove(SERVER_KEY);
    serverUrl = compiled && acceptableServer(compiled) ? trim(compiled) : null;
  } else {
    const param = params.get('server');
    if (param === 'off') store.remove(SERVER_KEY);
    else if (param && acceptableServer(param)) store.set(SERVER_KEY, trim(param));
    const configured = store.get(SERVER_KEY) || compiled;
    serverUrl = configured && acceptableServer(configured) ? trim(configured) : null;
  }

  let mockPlayerId = dev && PLAYER_ID.test(params.get('player') || '') ? params.get('player') : store.get(PLAYER_KEY);
  if (!mockPlayerId || !PLAYER_ID.test(mockPlayerId)) {
    mockPlayerId = randomId();
    store.set(PLAYER_KEY, mockPlayerId);
  }

  return {
    serverUrl,
    gameId: typeof env.VITE_WARPCREW_GAME_ID === 'string' && env.VITE_WARPCREW_GAME_ID ? env.VITE_WARPCREW_GAME_ID : 'warpcrew',
    buildVersion: typeof env.VITE_BUILD_VERSION === 'string' && env.VITE_BUILD_VERSION ? env.VITE_BUILD_VERSION : '0.1.0',
    mockPlayerId,
    dev,
  };
}
