// Save codec (§11 "codec (defineSave with numbered migrations)", §5.2). The blob is canonical
// JSON `{"schemaVersion":n,"state":...}`; migrations are numbered k → k+1; trialDeserialize never
// throws (restore, boot adopt and KV break-glass all go through it). Encoding on the wire is
// `json` by default; `gzip+b64` is optional and feature-detected (CompressionStream) — never required.
import type { SaveEncoding } from '@foundation/contracts/enums';

export type TrialResult<S> =
  | { ok: true; state: S; schemaVersion: number; migrated: boolean }
  | {
      ok: false;
      reason:
        | 'not_json'
        | 'not_object'
        | 'bad_schema_version'
        | 'newer_schema'
        | 'missing_migration'
        | 'migration_failed'
        | 'decode_failed'
        | 'invalid_state';
      message?: string;
    };

export interface SaveCodec<S> {
  readonly schemaVersion: number;
  /** State → JSON-able value (identity by default). */
  toJSON(state: S): unknown;
  /** JSON-able value at the CURRENT schema version → S (identity by default). May throw. */
  fromJSON(raw: unknown): S;
  /** Encode a state as the canonical blob string at the current schema version. */
  encode(state: S): string;
  /** Decode a blob string, migrating older schema versions forward. Throws on failure. */
  decode(blob: string): S;
  /** Same as decode but never throws. */
  trialDeserialize(blob: string): TrialResult<S>;
  /** Migrate a raw value from `fromVersion` to the current version (used by the local slot). */
  migrate(raw: unknown, fromVersion: number): TrialResult<S>;
}

export interface DefineSaveOptions<S> {
  schemaVersion: number;
  /** migrations[k] converts a raw value at schema k into schema k+1. */
  migrations?: Record<number, (old: unknown) => unknown>;
  encode?: (state: S) => unknown;
  decode?: (raw: unknown) => S;
  /** Optional structural check on the decoded state (invalid → trial error `invalid_state`). */
  validate?: (state: S) => boolean;
}

export function defineSave<S>(o: DefineSaveOptions<S>): SaveCodec<S> {
  if (!Number.isInteger(o.schemaVersion) || o.schemaVersion < 1)
    throw new Error('defineSave: schemaVersion must be a positive integer');
  const migrations = o.migrations ?? {};
  const toJSON = o.encode ?? ((s: S) => s as unknown);
  const fromJSON = o.decode ?? ((r: unknown) => r as S);

  const migrate = (raw: unknown, fromVersion: number): TrialResult<S> => {
    if (!Number.isInteger(fromVersion) || fromVersion < 1)
      return { ok: false, reason: 'bad_schema_version' };
    if (fromVersion > o.schemaVersion)
      return {
        ok: false,
        reason: 'newer_schema',
        message: `blob schema ${fromVersion} > codec ${o.schemaVersion}`,
      };
    let cur = raw;
    for (let v = fromVersion; v < o.schemaVersion; v++) {
      const m = migrations[v];
      if (!m)
        return { ok: false, reason: 'missing_migration', message: `no migration ${v}→${v + 1}` };
      try {
        cur = m(cur);
      } catch (e) {
        return {
          ok: false,
          reason: 'migration_failed',
          message: `${v}→${v + 1}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
    let state: S;
    try {
      state = fromJSON(cur);
    } catch (e) {
      return {
        ok: false,
        reason: 'decode_failed',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    if (o.validate) {
      let valid = false;
      try {
        valid = o.validate(state);
      } catch {
        valid = false;
      }
      if (!valid) return { ok: false, reason: 'invalid_state' };
    }
    return {
      ok: true,
      state,
      schemaVersion: o.schemaVersion,
      migrated: fromVersion !== o.schemaVersion,
    };
  };

  const trialDeserialize = (blob: string): TrialResult<S> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(blob);
    } catch {
      return { ok: false, reason: 'not_json' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ok: false, reason: 'not_object' };
    const env = parsed as { schemaVersion?: unknown; state?: unknown };
    if (typeof env.schemaVersion !== 'number') return { ok: false, reason: 'bad_schema_version' };
    if (!('state' in env)) return { ok: false, reason: 'not_object', message: 'missing state' };
    return migrate(env.state, env.schemaVersion);
  };

  return {
    schemaVersion: o.schemaVersion,
    toJSON,
    fromJSON,
    encode: (state) => JSON.stringify({ schemaVersion: o.schemaVersion, state: toJSON(state) }),
    decode(blob) {
      const r = trialDeserialize(blob);
      if (!r.ok) throw new Error(`decode failed: ${r.reason}${r.message ? ` (${r.message})` : ''}`);
      return r.state;
    },
    trialDeserialize,
    migrate,
  };
}

/** Byte length of a UTF-8 string without node Buffer. */
export function utf8Bytes(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3;
  }
  return n;
}

export interface WireBlob {
  enc: SaveEncoding;
  blob: string;
  /** Canonical decoded byte length (what the server records as `bytes`). */
  bytes: number;
  encBytes: number;
}

type CompressionStreamCtor = new (format: 'gzip') => {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

function compressionStreams(): {
  Compression: CompressionStreamCtor | null;
  Decompression: CompressionStreamCtor | null;
} {
  const g = globalThis as {
    CompressionStream?: CompressionStreamCtor;
    DecompressionStream?: CompressionStreamCtor;
  };
  return {
    Compression: typeof g.CompressionStream === 'function' ? g.CompressionStream : null,
    Decompression: typeof g.DecompressionStream === 'function' ? g.DecompressionStream : null,
  };
}

/** gzip+b64 is available only when the platform ships CompressionStream. */
export function gzipSupported(): boolean {
  const s = compressionStreams();
  return s.Compression !== null && s.Decompression !== null && typeof btoa === 'function';
}

async function pipeThrough(bytes: Uint8Array, Ctor: CompressionStreamCtor): Promise<Uint8Array> {
  const stream = new Ctor('gzip');
  const writer = stream.writable.getWriter();
  const done = new Response(stream.readable).arrayBuffer();
  // observe the read side so a decode failure surfaces once (through the await below), never as
  // an unhandled rejection when the write side throws first
  done.catch(() => undefined);
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await done);
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encode a canonical JSON blob for the wire. `json` unless gzip is requested AND supported AND
 * the payload is at least `minGzipBytes` (small blobs do not shrink). Never throws: falls back to json.
 */
export async function encodeForWire(
  json: string,
  opts: { gzip?: boolean; minGzipBytes?: number } = {},
): Promise<WireBlob> {
  const bytes = utf8Bytes(json);
  const plain: WireBlob = { enc: 'json', blob: json, bytes, encBytes: bytes };
  if (!opts.gzip || !gzipSupported() || bytes < (opts.minGzipBytes ?? 1024)) return plain;
  try {
    const { Compression } = compressionStreams();
    const gz = await pipeThrough(new TextEncoder().encode(json), Compression!);
    const b64 = bytesToB64(gz);
    if (b64.length >= json.length) return plain;
    return { enc: 'gzip+b64', blob: b64, bytes, encBytes: b64.length };
  } catch {
    return plain;
  }
}

/** Decode a wire blob back to the canonical JSON string. Throws on unsupported/invalid input. */
export async function decodeFromWire(enc: SaveEncoding, blob: string): Promise<string> {
  if (enc === 'json') return blob;
  const { Decompression } = compressionStreams();
  if (!Decompression) throw new Error('gzip+b64 blob but DecompressionStream is unavailable');
  const out = await pipeThrough(b64ToBytes(blob), Decompression);
  return new TextDecoder().decode(out);
}
