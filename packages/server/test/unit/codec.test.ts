import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { decodeBlob, encodeGzipB64, DEFAULT_BLOB_LIMITS } from '../../src/codec/blob.ts';

const limits = {
  ...DEFAULT_BLOB_LIMITS,
  maxEncodedBytes: 64 * 1024,
  maxBlobBytes: 128 * 1024,
  maxExpansionRatio: 20,
  decodeBudgetMs: 200,
};

describe('blob codec: independent limits, streaming inflate, canonical bytes/sha', () => {
  it('json round-trips and canonicalises (bytes/sha refer to canonical JSON, not the wire form)', async () => {
    const r = await decodeBlob('json', '{ "b": 1,\n "a": [1, 2] }', limits);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.json).toBe('{"b":1,"a":[1,2]}');
    expect(r.bytes).toBe(r.json.length);
    expect(r.encBytes).toBeGreaterThan(r.bytes);
  });
  it('gzip+b64 round-trips', async () => {
    const json = JSON.stringify({ v: 1, counter: 3, gold: 4 });
    const r = await decodeBlob('gzip+b64', encodeGzipB64(json), limits);
    expect(r.ok && r.json).toBe(json);
  });
  it('encoded limit is enforced before any decoding', async () => {
    const r = await decodeBlob('json', '{"a":"' + 'x'.repeat(70 * 1024) + '"}', limits);
    expect(r).toMatchObject({ ok: false, reason: 'blob_too_large' });
  });
  it('decompression bomb: expansion ratio > 20× aborts mid-stream (never allocates the whole thing)', async () => {
    const bomb = gzipSync(Buffer.alloc(4 * 1024 * 1024, 0x30)).toString('base64');
    expect(bomb.length).toBeLessThan(limits.maxEncodedBytes);
    const r = await decodeBlob('gzip+b64', bomb, limits);
    expect(r).toMatchObject({ ok: false, reason: 'blob_too_large' });
  });
  it('decoded size cap holds even at a low ratio', async () => {
    const big = JSON.stringify({ pad: 'a'.repeat(200 * 1024) }); // low ratio, > maxBlobBytes
    const r = await decodeBlob('gzip+b64', gzipSync(Buffer.from(big)).toString('base64'), {
      ...limits,
      maxEncodedBytes: 512 * 1024,
      maxExpansionRatio: 1000,
    });
    expect(r).toMatchObject({ ok: false, reason: 'blob_too_large' });
  });
  it('malformed inputs are refused, never thrown: bad base64, bad gzip, bad json, non-object', async () => {
    expect(await decodeBlob('gzip+b64', '!!!', limits)).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
    expect(
      await decodeBlob('gzip+b64', Buffer.from('not gzip at all').toString('base64'), limits),
    ).toMatchObject({ ok: false, reason: 'malformed' });
    expect(await decodeBlob('json', '{nope', limits)).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
    expect(await decodeBlob('json', '[1,2]', limits)).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
    expect(await decodeBlob('json', 'null', limits)).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
  });
  it('decode-time budget aborts', async () => {
    let t = 0;
    const slowNow = () => (t += 500); // every call advances 500 ms
    const r = await decodeBlob(
      'gzip+b64',
      encodeGzipB64(JSON.stringify({ a: 'x'.repeat(50_000) })),
      { ...limits, decodeBudgetMs: 100 },
      slowNow,
    );
    expect(r).toMatchObject({ ok: false, reason: 'blob_too_large' });
  });
});
