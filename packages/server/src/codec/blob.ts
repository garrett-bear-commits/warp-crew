// Encoded blobs (§4.2): decoded under independent limits — encoded ≤ maxEncodedBytes, decoded ≤
// maxBlobBytes, expansion ratio ≤ 20×, streaming inflate with a byte counter and a decode-time
// budget that aborts. bytes and blob_sha256 always refer to the canonical decoded UTF-8 JSON.
import { createGunzip, gzipSync } from 'node:zlib';
import { sha256Hex } from '../db/canonical.ts';
import type { SaveEncoding } from '@foundation/contracts/enums';

export interface BlobLimits {
  maxEncodedBytes: number;
  maxBlobBytes: number;
  maxExpansionRatio: number;
  decodeBudgetMs: number;
}

export const DEFAULT_BLOB_LIMITS: BlobLimits = {
  maxEncodedBytes: 256 * 1024,
  maxBlobBytes: 512 * 1024,
  maxExpansionRatio: 20,
  decodeBudgetMs: 200,
};

export type DecodeFailure = 'blob_too_large' | 'malformed';

export type DecodeResult =
  | { ok: true; json: string; bytes: number; encBytes: number; sha256: string; value: unknown }
  | { ok: false; reason: DecodeFailure; detail: string };

/**
 * Decode + canonicalise a blob. For enc=json the input IS the JSON; for gzip+b64 the base64 is
 * decoded and inflated in a stream with a byte counter that aborts past the limit or the ratio.
 * The value is parsed and re-serialised (JSON.stringify) so `bytes`/`sha256` are canonical.
 */
export async function decodeBlob(
  enc: SaveEncoding,
  blob: string,
  limits: BlobLimits = DEFAULT_BLOB_LIMITS,
  now: () => number = () => Number(process.hrtime.bigint() / 1_000_000n),
): Promise<DecodeResult> {
  const encBytes = Buffer.byteLength(blob, 'utf8');
  if (encBytes > limits.maxEncodedBytes)
    return {
      ok: false,
      reason: 'blob_too_large',
      detail: `encoded ${encBytes} > ${limits.maxEncodedBytes}`,
    };
  let json: string;
  if (enc === 'json') {
    if (encBytes > limits.maxBlobBytes)
      return {
        ok: false,
        reason: 'blob_too_large',
        detail: `decoded ${encBytes} > ${limits.maxBlobBytes}`,
      };
    json = blob;
  } else {
    let compressed: Buffer;
    try {
      compressed = Buffer.from(blob, 'base64');
    } catch {
      return { ok: false, reason: 'malformed', detail: 'base64' };
    }
    if (compressed.length === 0) return { ok: false, reason: 'malformed', detail: 'empty' };
    const cap = Math.min(limits.maxBlobBytes, compressed.length * limits.maxExpansionRatio);
    const inflated = await inflateBounded(compressed, cap, limits.decodeBudgetMs, now);
    if (!inflated.ok) return { ok: false, reason: inflated.reason, detail: inflated.detail };
    json = inflated.buf.toString('utf8');
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'malformed', detail: 'json' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, reason: 'malformed', detail: 'blob must be a JSON object' };
  const canonical = JSON.stringify(value);
  const bytes = Buffer.byteLength(canonical, 'utf8');
  if (bytes > limits.maxBlobBytes)
    return {
      ok: false,
      reason: 'blob_too_large',
      detail: `canonical ${bytes} > ${limits.maxBlobBytes}`,
    };
  return { ok: true, json: canonical, bytes, encBytes, sha256: sha256Hex(canonical), value };
}

function inflateBounded(
  input: Buffer,
  cap: number,
  budgetMs: number,
  now: () => number,
): Promise<{ ok: true; buf: Buffer } | { ok: false; reason: DecodeFailure; detail: string }> {
  return new Promise((resolve) => {
    const gunzip = createGunzip({ chunkSize: 16 * 1024 });
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const start = now();
    const finish = (
      r: { ok: true; buf: Buffer } | { ok: false; reason: DecodeFailure; detail: string },
    ) => {
      if (done) return;
      done = true;
      gunzip.removeAllListeners();
      gunzip.destroy();
      resolve(r);
    };
    gunzip.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap)
        return finish({
          ok: false,
          reason: 'blob_too_large',
          detail: `inflated > ${cap} (ratio/size cap)`,
        });
      if (now() - start > budgetMs)
        return finish({
          ok: false,
          reason: 'blob_too_large',
          detail: `decode budget ${budgetMs}ms exceeded`,
        });
      chunks.push(chunk);
    });
    gunzip.on('error', (e: Error) =>
      finish({ ok: false, reason: 'malformed', detail: `gzip: ${e.message}` }),
    );
    gunzip.on('end', () => finish({ ok: true, buf: Buffer.concat(chunks, total) }));
    // feed in slices so the byte counter can abort mid-stream even for a single huge member
    let off = 0;
    const step = () => {
      if (done) return;
      const end = Math.min(input.length, off + 16 * 1024);
      gunzip.write(input.subarray(off, end));
      off = end;
      if (off < input.length) setImmediate(step);
      else gunzip.end();
    };
    step();
  });
}

/** Encode helper (server-side restore/reattach paths and tests). */
export function encodeGzipB64(json: string): string {
  return gzipSync(Buffer.from(json, 'utf8')).toString('base64');
}
