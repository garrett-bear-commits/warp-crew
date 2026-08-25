/** Browser-only protocol for opening a disposable, snapshot-seeded game session. */
export const INCOGNITO_PROTOCOL = 'foundation-incognito-v1' as const;

export interface IncognitoReadyMessage {
  readonly protocol: typeof INCOGNITO_PROTOCOL;
  readonly kind: 'ready';
  readonly sessionId: string;
}

export interface IncognitoLoadedMessage {
  readonly protocol: typeof INCOGNITO_PROTOCOL;
  readonly kind: 'loaded';
  readonly sessionId: string;
}

export interface IncognitoFailedMessage {
  readonly protocol: typeof INCOGNITO_PROTOCOL;
  readonly kind: 'failed';
  readonly sessionId: string;
}

export interface IncognitoSnapshotMessage {
  readonly protocol: typeof INCOGNITO_PROTOCOL;
  readonly kind: 'snapshot';
  readonly sessionId: string;
  readonly playerKey: string;
  readonly seq: number;
  readonly generation: number;
  readonly enc: 'json';
  readonly blob: string;
}

export interface IncognitoTarget {
  readonly url: string;
  readonly origin: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const local =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && local)) &&
      url.origin !== 'null' &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

const SESSION_PARAM = 'foundationIncognito';
const ADMIN_ORIGIN_PARAM = 'foundationAdminOrigin';
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{15,95}$/;

export function createIncognitoSessionId(
  secure: Pick<Crypto, 'getRandomValues' | 'randomUUID'> | null = globalThis.crypto,
): string | null {
  if (!secure) return null;
  if (typeof secure.randomUUID === 'function') return secure.randomUUID();
  if (typeof secure.getRandomValues !== 'function') return null;
  const bytes = secure.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isAllowedGameUrl(url: URL): boolean {
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

/** Validate and decorate a game URL without putting credentials or snapshot data in its query. */
export function buildIncognitoTarget(
  clientUrl: string,
  sessionId: string,
  adminOrigin: string,
): IncognitoTarget | null {
  if (!SESSION_ID.test(sessionId) || !isOrigin(adminOrigin)) return null;
  try {
    const url = new URL(clientUrl);
    if (!isAllowedGameUrl(url)) return null;
    // Replace, rather than merge with, an app-router fragment. This keeps the routing channel
    // unambiguous and guarantees it contains only the two non-sensitive handshake values.
    url.hash = new URLSearchParams({
      [SESSION_PARAM]: sessionId,
      [ADMIN_ORIGIN_PARAM]: new URL(adminOrigin).origin,
    }).toString();
    return { url: url.toString(), origin: url.origin };
  } catch {
    return null;
  }
}

export function isIncognitoReady(
  value: unknown,
  sessionId: string,
): value is IncognitoReadyMessage {
  const data = record(value);
  return (
    data?.protocol === INCOGNITO_PROTOCOL && data.kind === 'ready' && data.sessionId === sessionId
  );
}

export function isIncognitoLoaded(
  value: unknown,
  sessionId: string,
): value is IncognitoLoadedMessage {
  const data = record(value);
  return (
    data?.protocol === INCOGNITO_PROTOCOL && data.kind === 'loaded' && data.sessionId === sessionId
  );
}

export function isIncognitoFailed(
  value: unknown,
  sessionId: string,
): value is IncognitoFailedMessage {
  const data = record(value);
  return (
    data?.protocol === INCOGNITO_PROTOCOL && data.kind === 'failed' && data.sessionId === sessionId
  );
}

export function incognitoSnapshot(
  sessionId: string,
  playerKey: string,
  seq: number,
  generation: number,
  enc: 'json',
  blob: string,
): IncognitoSnapshotMessage {
  return {
    protocol: INCOGNITO_PROTOCOL,
    kind: 'snapshot',
    sessionId,
    playerKey,
    seq,
    generation,
    enc,
    blob,
  };
}
