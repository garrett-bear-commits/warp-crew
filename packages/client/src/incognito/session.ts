// Disposable operator sessions: a retained save is handed from a trusted operator window to a
// game window, decoded through the game's codec, and seeded in an in-memory slot.  This module
// deliberately has no fetch, credentials, or durable-storage access.  The caller must spread
// `incognitoClientOptions(session)` into createGameClient and use a no-op platform adapter.
import { mintId } from '../ids.ts';
import type { SaveCodec, TrialResult } from '../storage/codec.ts';
import { utf8Bytes } from '../storage/codec.ts';
import {
  createSlot,
  slotKey,
  writeLastKnownPlayerId,
  ENVELOPE_FORMAT,
  type CacheEnvelope,
} from '../storage/envelope.ts';
import {
  createStorage,
  memoryStorage,
  type StorageLike,
  type StorageTier,
} from '../storage/tiers.ts';

/** Versioned, cross-window protocol. Blob and credentials are never URL parameters. */
export const INCOGNITO_PROTOCOL = 'foundation-incognito-v1' as const;
/** Admin blob reads return canonical decoded JSON, bounded by the server's default maxBlobBytes. */
export const DEFAULT_INCOGNITO_MAX_BLOB_BYTES = 512 * 1024;
const SESSION_PARAM = 'foundationIncognito';
const ADMIN_ORIGIN_PARAM = 'foundationAdminOrigin';
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{15,95}$/;

export interface IncognitoSessionRequest {
  readonly sessionId: string;
  /** Exact origin of the operator console allowed to supply the retained blob. */
  readonly adminOrigin: string;
}

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

/** A retained snapshot.  This object may cross `postMessage`, never a URL. */
export interface IncognitoSnapshot {
  readonly protocol: typeof INCOGNITO_PROTOCOL;
  readonly kind: 'snapshot';
  readonly sessionId: string;
  /** Original player identity, informational only; it is never used as this session's identity. */
  readonly playerKey: string;
  readonly seq: number;
  readonly generation: number;
  /** Admin blob reads are canonical JSON; compressed wire saves are never transferred here. */
  readonly enc: 'json';
  readonly blob: string;
  /** Original server timestamp when available; not trusted for simulation. */
  readonly savedAt?: number;
}

export interface IncognitoMessageEvent {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}

export interface IncognitoMessageHost {
  readonly opener: unknown;
  addEventListener(type: 'message', listener: (event: IncognitoMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: IncognitoMessageEvent) => void): void;
}

export interface IncognitoOpener {
  postMessage(
    message: IncognitoReadyMessage | IncognitoLoadedMessage | IncognitoFailedMessage,
    targetOrigin: string,
  ): void;
}

export class IncognitoSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncognitoSnapshotError';
  }
}

function exactOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const local =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.origin !== value)
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function mintSecureSessionId(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (!crypto || typeof crypto.getRandomValues !== 'function')
    throw new IncognitoSnapshotError('secure randomness is unavailable');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

function validNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Make a one-time request. `adminOrigin` is canonicalised to its exact origin. */
export function createIncognitoSessionRequest(o: {
  adminOrigin: string;
  sessionId?: string;
}): IncognitoSessionRequest {
  const adminOrigin = exactOrigin(o.adminOrigin);
  const sessionId = o.sessionId ?? mintSecureSessionId();
  if (!adminOrigin)
    throw new IncognitoSnapshotError('adminOrigin must be exact https (or localhost http)');
  if (!validSessionId(sessionId)) throw new IncognitoSnapshotError('invalid incognito session id');
  return { adminOrigin, sessionId };
}

/**
 * Put the routing parameters in the URL fragment, never a query string (so they stay out of
 * server and normal referrer logs). Snapshot data and credentials are never accepted here.
 */
export function createIncognitoSessionUrl(
  clientUrl: string,
  request: IncognitoSessionRequest,
): string {
  const checked = createIncognitoSessionRequest(request);
  let url: URL;
  try {
    url = new URL(clientUrl);
  } catch {
    throw new IncognitoSnapshotError('clientUrl must be absolute');
  }
  const localhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) ||
    url.username ||
    url.password
  )
    throw new IncognitoSnapshotError(
      'clientUrl must be https (or localhost http) without credentials',
    );
  // Deliberately replace the fragment: the app must read this from location.hash before routing.
  // Keeping a pre-existing fragment risks an accidental router/parser ambiguity.
  url.hash = new URLSearchParams({
    [SESSION_PARAM]: checked.sessionId,
    [ADMIN_ORIGIN_PARAM]: checked.adminOrigin,
  }).toString();
  return url.toString();
}

/** Parse the two protocol parameters from a game window's `location.hash`. */
export function readIncognitoSessionRequest(hash: string): IncognitoSessionRequest | null {
  // Requiring `#` makes accidentally passing location.search fail closed.
  if (!hash.startsWith('#')) return null;
  const params = new URLSearchParams(hash.slice(1));
  const sessionId = params.get(SESSION_PARAM);
  const adminOrigin = params.get(ADMIN_ORIGIN_PARAM);
  if (!sessionId || !adminOrigin) return null;
  try {
    return createIncognitoSessionRequest({ sessionId, adminOrigin });
  } catch {
    return null;
  }
}

export function incognitoReadyMessage(request: IncognitoSessionRequest): IncognitoReadyMessage {
  const checked = createIncognitoSessionRequest(request);
  return { protocol: INCOGNITO_PROTOCOL, kind: 'ready', sessionId: checked.sessionId };
}

/** Announce readiness to the opener. Returns false when this window was not opened by the console. */
export function announceIncognitoReady(
  request: IncognitoSessionRequest,
  opener: IncognitoOpener | null | undefined = (globalThis as { opener?: IncognitoOpener | null })
    .opener,
): boolean {
  if (!opener) return false;
  const checked = createIncognitoSessionRequest(request);
  opener.postMessage(incognitoReadyMessage(checked), checked.adminOrigin);
  return true;
}

/** Acknowledge only after the game decoded the snapshot and completed its in-memory boot. */
export function announceIncognitoLoaded(
  request: IncognitoSessionRequest,
  opener: IncognitoOpener | null | undefined = (globalThis as { opener?: IncognitoOpener | null })
    .opener,
): boolean {
  if (!opener) return false;
  const checked = createIncognitoSessionRequest(request);
  opener.postMessage(
    { protocol: INCOGNITO_PROTOCOL, kind: 'loaded', sessionId: checked.sessionId },
    checked.adminOrigin,
  );
  return true;
}

/** Report a fail-closed launch without sending the decoder error or any snapshot metadata. */
export function announceIncognitoFailed(
  request: IncognitoSessionRequest,
  opener: IncognitoOpener | null | undefined = (
    globalThis as {
      opener?: IncognitoOpener | null;
    }
  ).opener,
): boolean {
  if (!opener) return false;
  const checked = createIncognitoSessionRequest(request);
  opener.postMessage(
    { protocol: INCOGNITO_PROTOCOL, kind: 'failed', sessionId: checked.sessionId },
    checked.adminOrigin,
  );
  return true;
}

function snapshotFrom(data: unknown): IncognitoSnapshot | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (
    d.protocol !== INCOGNITO_PROTOCOL ||
    d.kind !== 'snapshot' ||
    !validSessionId(d.sessionId) ||
    typeof d.playerKey !== 'string' ||
    d.playerKey.length === 0 ||
    d.playerKey.length > 128 ||
    !validNonNegativeSafeInteger(d.seq) ||
    !validNonNegativeSafeInteger(d.generation) ||
    d.enc !== 'json' ||
    typeof d.blob !== 'string'
  )
    return null;
  if (d.savedAt !== undefined && !validNonNegativeSafeInteger(d.savedAt)) return null;
  return {
    protocol: INCOGNITO_PROTOCOL,
    kind: 'snapshot',
    sessionId: d.sessionId,
    playerKey: d.playerKey,
    seq: d.seq,
    generation: d.generation,
    enc: d.enc,
    blob: d.blob,
    ...(d.savedAt === undefined ? {} : { savedAt: d.savedAt }),
  };
}

/**
 * Verify an incoming snapshot before it is decoded.  Both the opener object and exact configured
 * origin must match; accepting a same-origin sibling or a matching payload from another window is
 * intentionally impossible.
 */
export function validateIncognitoSnapshotMessage(
  event: IncognitoMessageEvent,
  o: { request: IncognitoSessionRequest; opener: unknown },
): IncognitoSnapshot | null {
  const request = createIncognitoSessionRequest(o.request);
  if (!o.opener || event.source !== o.opener || event.origin !== request.adminOrigin) return null;
  const snapshot = snapshotFrom(event.data);
  return snapshot && snapshot.sessionId === request.sessionId ? snapshot : null;
}

/** Wait for exactly one trusted operator snapshot, then unregister the listener. */
export function waitForIncognitoSnapshot(
  request: IncognitoSessionRequest,
  o: {
    host?: IncognitoMessageHost;
    opener?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<IncognitoSnapshot> {
  const checked = createIncognitoSessionRequest(request);
  const host = o.host ?? (globalThis as unknown as IncognitoMessageHost | undefined) ?? undefined;
  const opener = o.opener === undefined ? host?.opener : o.opener;
  if (!host || !opener)
    return Promise.reject(new IncognitoSnapshotError('incognito opener unavailable'));
  const timeoutMs = o.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    return Promise.reject(new IncognitoSnapshotError('timeoutMs must be non-negative'));
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const done = (): void => {
      host.removeEventListener('message', onMessage);
      if (timeout !== null) clearTimeout(timeout);
    };
    const onMessage = (event: IncognitoMessageEvent): void => {
      const snapshot = validateIncognitoSnapshotMessage(event, { request: checked, opener });
      if (!snapshot) return;
      done();
      resolve(snapshot);
    };
    host.addEventListener('message', onMessage);
    timeout = setTimeout(() => {
      done();
      reject(new IncognitoSnapshotError('timed out waiting for trusted incognito snapshot'));
    }, timeoutMs);
  });
}

export interface IncognitoSession<S> {
  /** Distinct from the retained save's playerKey, so it cannot affect that player's slot or auth. */
  readonly playerId: string;
  readonly state: S;
  readonly envelope: CacheEnvelope<S>;
  /** A fresh Map-backed StorageLike; it is never browser localStorage. */
  readonly localStorage: StorageLike;
  readonly storage: StorageTier;
  readonly source: Readonly<
    Pick<IncognitoSnapshot, 'playerKey' | 'seq' | 'generation' | 'savedAt'>
  >;
  /** Drop the only two seeded keys before closing the window, if desired. */
  dispose(): void;
}

export interface SeedIncognitoSnapshotOptions<S> {
  gameId: string;
  codec: SaveCodec<S>;
  snapshot: IncognitoSnapshot;
  progressOf(state: S): number;
  /** Injectable for deterministic tests. Defaults to Date.now(). */
  now?: () => number;
  /** Canonical JSON cap, checked before JSON parse. */
  maxBlobBytes?: number;
}

function deserializeError<S>(result: TrialResult<S>): IncognitoSnapshotError {
  return new IncognitoSnapshotError(
    `retained snapshot cannot be decoded${result.ok ? '' : `: ${result.reason}${result.message ? ` (${result.message})` : ''}`}`,
  );
}

/**
 * Decode/migrate a retained blob and seed a disposable slot.  Its synthetic player id guarantees
 * it cannot replace the actual player slot even if this game origin has normal local storage.
 */
export async function seedIncognitoSnapshot<S>(
  o: SeedIncognitoSnapshotOptions<S>,
): Promise<IncognitoSession<S>> {
  if (!o.gameId) throw new IncognitoSnapshotError('gameId is required');
  const snapshot = snapshotFrom(o.snapshot);
  if (!snapshot) throw new IncognitoSnapshotError('invalid retained snapshot');
  const maxBlobBytes = o.maxBlobBytes ?? DEFAULT_INCOGNITO_MAX_BLOB_BYTES;
  if (!Number.isInteger(maxBlobBytes) || maxBlobBytes < 1)
    throw new IncognitoSnapshotError('maxBlobBytes must be a positive integer');
  if (utf8Bytes(snapshot.blob) > maxBlobBytes)
    throw new IncognitoSnapshotError(
      `retained snapshot exceeds canonical blob limit (${maxBlobBytes} bytes)`,
    );
  const decoded = o.codec.trialDeserialize(snapshot.blob);
  if (!decoded.ok) throw deserializeError(decoded);
  let progress: number;
  try {
    progress = o.progressOf(decoded.state);
  } catch (error) {
    throw new IncognitoSnapshotError(
      `progressOf failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Number.isSafeInteger(progress) || progress < 0)
    throw new IncognitoSnapshotError('progressOf must return a non-negative safe integer');
  const now = o.now ?? Date.now;
  const savedAt = now();
  if (!validNonNegativeSafeInteger(savedAt))
    throw new IncognitoSnapshotError('now must return a non-negative safe integer');
  const playerId = `incognito-${snapshot.sessionId}`;
  const localStorage = memoryStorage();
  const storage = createStorage({ localStorage });
  const envelope: CacheEnvelope<S> = {
    format: ENVELOPE_FORMAT,
    gameId: o.gameId,
    playerId,
    schemaVersion: o.codec.schemaVersion,
    generation: snapshot.generation,
    state: decoded.state,
    progress,
    savedAt,
    dirty: false,
    lastAckedSeq: snapshot.seq,
    sessionId: mintId(),
    clientSeq: 0,
    ratchetFloor: { playerId, generation: snapshot.generation, progress },
    lastVerdict: null,
    lastSyncedAt: null,
  };
  const slot = createSlot(storage, slotKey(o.gameId, playerId), o.codec, {
    gameId: o.gameId,
    playerId,
  });
  const written = slot.write(envelope);
  if (!written.ok)
    throw new IncognitoSnapshotError(`incognito memory seed failed: ${written.reason}`);
  writeLastKnownPlayerId(storage, o.gameId, playerId);
  return {
    playerId,
    state: decoded.state,
    envelope,
    localStorage,
    storage,
    source: {
      playerKey: snapshot.playerKey,
      seq: snapshot.seq,
      generation: snapshot.generation,
      ...(snapshot.savedAt === undefined ? {} : { savedAt: snapshot.savedAt }),
    },
    dispose() {
      storage.remove(slot.key);
      // The last-known marker lives only in this isolated memory store, but clear it for a prompt
      // teardown as well.
      for (const key of storage.keys(`foundation:${o.gameId}:lastKnownPlayerId`))
        storage.remove(key);
    },
  };
}

/** Exact createGameClient overrides for a snapshot session. Spread these after normal config. */
export function incognitoClientOptions(session: IncognitoSession<unknown>): {
  fetch: typeof fetch;
  localStorage: StorageLike;
  sync: { enabled: false };
  kvMirror: 'off';
  journal: 'off';
  locks: null;
  channel: null;
  sendBeacon: null;
  spool: null;
  requestPersist: false;
} {
  return {
    // This must be supplied even though sync is disabled: integrity/error paths are deliberately
    // unable to fall through to global fetch.
    fetch: incognitoFetch,
    localStorage: session.localStorage,
    sync: { enabled: false },
    kvMirror: 'off',
    journal: 'off',
    locks: null,
    channel: null,
    sendBeacon: null,
    spool: null,
    requestPersist: false,
  };
}

/** Fail closed without consulting global fetch. Safe to inject into createGameClient. */
export const incognitoFetch: typeof fetch = (() =>
  Promise.reject(
    new IncognitoSnapshotError('network is disabled for incognito save sessions'),
  )) as typeof fetch;
