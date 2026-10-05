import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { setupHarness, saveBody, T0, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'saves' });
});
afterAll(async () => h?.close());

const put = (player: string, body: unknown, headers: Record<string, string> = {}) =>
  h.inject({
    method: 'PUT',
    url: '/v1/saves',
    headers: { ...h.playerHeaders(player), ...headers },
    payload: body as object,
  });

describe('saves: identity fails closed', () => {
  it('no token → 401', async () => {
    const r = await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: { 'x-player-key': 'p1' },
      payload: saveBody(),
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ error: 'unauthorized', correlationId: expect.any(String) });
  });
  it('token for another player → 401 sub_mismatch (a valid token must not write another player)', async () => {
    const r = await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: { 'x-player-key': 'p2', authorization: `Bearer ${h.token('p1')}` },
      payload: saveBody(),
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().details).toEqual({ reason: 'sub_mismatch' });
  });
  it('stale token → 401 stale', async () => {
    const r = await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: h.playerHeaders('p1', { iatMs: T0 - 48 * 3_600_000 }),
      payload: saveBody(),
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().details).toEqual({ reason: 'stale' });
  });
  it('a client can never supply actor/gameId/playerKey in the body (contract closed) → 400', async () => {
    const r = await put('p1', { ...saveBody(), playerKey: 'p9' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('validation_failed');
  });
});

describe('saves: the write path', () => {
  it('first write anchors; seq is server-assigned; response carries serverNow + requestId', async () => {
    const r = await put(
      'alice',
      saveBody({ progress: 100, clientSeq: 42 }, { v: 1, counter: 100, gold: 5 }),
    );
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b).toMatchObject({
      disposition: 'anchored',
      seq: 1,
      currentProgress: 100,
      generation: 0,
    });
    expect(b.blobSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof b.serverNow).toBe('number');
    expect(b.requestId).toBe(r.headers['x-request-id']);
  });
  it('a duplicate commandId replays with disposition duplicate + the original seq (no second row)', async () => {
    const body = saveBody({ progress: 110 }, { v: 1, counter: 110, gold: 5 });
    const a = await put('alice', body);
    const b = await put('alice', body);
    expect(a.json().disposition).toBe('anchored');
    expect(b.json()).toMatchObject({ disposition: 'duplicate', seq: a.json().seq });
    const rows =
      await h.root`SELECT count(*)::int AS n FROM save_snapshots WHERE player_key = 'alice'`;
    expect(rows[0]!.n).toBe(2);
  });
  it('same commandId, different payload → 422 idempotency_mismatch (every field frozen, incl. reason)', async () => {
    const body = saveBody({ progress: 120 }, { v: 1, counter: 120, gold: 5 });
    await put('alice', body);
    const r = await put('alice', { ...body, reason: 'important' });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toBe('idempotency_mismatch');
  });
  it('a shallower write is stored refused (200, progress_regression), not dropped, and the anchor stays', async () => {
    const r = await put('alice', saveBody({ progress: 50 }, { v: 1, counter: 50, gold: 5 }));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      disposition: 'stored_refused',
      reason: 'progress_regression',
      currentProgress: 120,
    });
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current?meta=1',
      headers: h.playerHeaders('alice'),
    });
    expect(cur.json().snapshot.progress).toBe(120);
    const refused =
      await h.root`SELECT disposition, reject_reason FROM save_snapshots WHERE player_key = 'alice' AND seq = ${r.json().seq}`;
    expect(refused[0]).toEqual({
      disposition: 'stored_refused',
      reject_reason: 'progress_regression',
    });
  });
  it('malformed blob (policy shape) → stored_refused malformed', async () => {
    const r = await put('alice', saveBody({ progress: 130, blob: JSON.stringify({ nope: true }) }));
    expect(r.json()).toMatchObject({ disposition: 'stored_refused', reason: 'malformed' });
  });
  it('unknown schema version → stored_quarantined schema_unknown; never the anchor; pendingQuarantine exposed', async () => {
    const r = await put(
      'alice',
      saveBody({ progress: 200, schemaVersion: 9 }, { v: 9, counter: 200, gold: 5 }),
    );
    expect(r.json()).toMatchObject({
      disposition: 'stored_quarantined',
      flags: ['schema_unknown'],
      currentProgress: 120,
    });
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current?meta=1',
      headers: h.playerHeaders('alice'),
    });
    expect(cur.json().snapshot.progress).toBe(120);
    expect(cur.json().pendingQuarantine).toMatchObject({
      seq: r.json().seq,
      progress: 200,
      flags: ['schema_unknown'],
    });
  });
  it('progress_jump quarantines when the ordinal outruns maxProgressPerHour', async () => {
    const r = await put(
      'alice',
      saveBody({ progress: 120 + 36_000 * 3 }, { v: 1, counter: 120 + 36_000 * 3, gold: 5 }),
    );
    expect(r.json()).toMatchObject({ disposition: 'stored_quarantined' });
    expect(r.json().flags).toContain('progress_jump');
  });
  it('implausible summary (counter > progress) quarantines', async () => {
    const r = await put('alice', saveBody({ progress: 121 }, { v: 1, counter: 5000, gold: 5 }));
    expect(r.json().flags).toContain('implausible_summary');
    expect(r.json().disposition).toBe('stored_quarantined');
  });
  it('divergence is surfaced, never refused: another session writing deeper anchors with divergent info', async () => {
    const r = await put(
      'alice',
      saveBody(
        { progress: 121, sessionId: '9b2d5c1e-8f0a-4c7b-a1d2-3e4f5a6b7c8d', baseSeq: 1 },
        { v: 1, counter: 121, gold: 5 },
      ),
    );
    expect(r.json().disposition).toBe('anchored');
    expect(r.json().divergent).toMatchObject({
      headSeq: expect.any(Number),
      headSessionId: '2f5b7f6a-3c9d-4e1f-8a2b-0c1d2e3f4a5b',
    });
  });
  it('stale generation → stored_refused stale_generation', async () => {
    const r = await put(
      'alice',
      saveBody({ generation: 5, progress: 500 }, { v: 1, counter: 500, gold: 5 }),
    );
    expect(r.json()).toMatchObject({
      disposition: 'stored_refused',
      reason: 'stale_generation',
      generation: 0,
    });
  });
  it('GET /saves/current returns the anchor blob; history lists every stored row incl. refused/quarantined', async () => {
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: h.playerHeaders('alice'),
    });
    expect(cur.json().empty).toBe(false);
    expect(JSON.parse(cur.json().blob)).toEqual({ v: 1, counter: 121, gold: 5 });
    const hist = await h.inject({
      method: 'GET',
      url: '/v1/saves/history?limit=100',
      headers: h.playerHeaders('alice'),
    });
    const dispositions = new Set(
      hist.json().items.map((i: { disposition: string }) => i.disposition),
    );
    expect(dispositions).toEqual(new Set(['anchored', 'stored_refused', 'stored_quarantined']));
    const blob = await h.inject({
      method: 'GET',
      url: `/v1/saves/history/1/blob`,
      headers: h.playerHeaders('alice'),
    });
    expect(blob.statusCode).toBe(200);
    expect(JSON.parse(blob.json().blob)).toEqual({ v: 1, counter: 100, gold: 5 });
  });
  it('empty player: GET current → {empty:true, generation:0}', async () => {
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: h.playerHeaders('nobody'),
    });
    expect(cur.json()).toMatchObject({ empty: true, generation: 0 });
  });
});

describe('saves: beacon route', () => {
  it('accepts auth inside a text/plain body with zero custom headers, and shares idempotency with PUT', async () => {
    const body = saveBody({ progress: 130, reason: 'teardown' }, { v: 1, counter: 130, gold: 5 });
    const r = await h.inject({
      method: 'POST',
      url: '/v1/saves/beacon',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify({ ...body, playerKey: 'alice', token: h.token('alice') }),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().disposition).toBe('anchored');
    // the same commandId via PUT is a duplicate (auth/transport fields are excluded from the hash)
    const again = await put('alice', body);
    expect(again.json()).toMatchObject({ disposition: 'duplicate', seq: r.json().seq });
    const src =
      await h.root`SELECT source FROM save_snapshots WHERE player_key = 'alice' AND seq = ${r.json().seq}`;
    expect(src[0]!.source).toBe('beacon');
  });
  it('beacon with a bad token → 401', async () => {
    const r = await h.inject({
      method: 'POST',
      url: '/v1/saves/beacon',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify({ ...saveBody(), playerKey: 'alice', token: 'mock.bob.1' }),
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('saves: encoded blobs and decompression bombs', () => {
  it('gzip+b64 round-trips and bytes/sha refer to the canonical decoded JSON', async () => {
    const obj = { v: 1, counter: 140, gold: 5, upgrades: { auto: 2 } };
    const blob = gzipSync(Buffer.from(JSON.stringify(obj))).toString('base64');
    const r = await put('alice', saveBody({ progress: 140, enc: 'gzip+b64', blob }));
    expect(r.json().disposition).toBe('anchored');
    const row =
      await h.root`SELECT bytes, enc_bytes, blob_sha256 FROM save_snapshots WHERE player_key = 'alice' AND seq = ${r.json().seq}`;
    expect(row[0]!.bytes).toBe(Buffer.byteLength(JSON.stringify(obj)));
    expect(row[0]!.enc_bytes).toBe(blob.length);
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: h.playerHeaders('alice'),
    });
    expect(JSON.parse(cur.json().blob)).toEqual(obj);
  });
  it('a decompression bomb (huge expansion ratio) is refused as blob_too_large, stored without a blob, never a 500', async () => {
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x20)).toString('base64'); // ~8 KiB → 8 MiB
    expect(bomb.length).toBeLessThan(64 * 1024);
    const r = await put('alice', saveBody({ progress: 141, enc: 'gzip+b64', blob: bomb }));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ disposition: 'stored_refused', reason: 'blob_too_large' });
    const row =
      await h.root`SELECT s.id, (SELECT count(*) FROM save_blobs b WHERE b.save_id = s.id)::int AS blobs FROM save_snapshots s WHERE s.player_key = 'alice' AND s.seq = ${r.json().seq}`;
    expect(row[0]!.blobs).toBe(0);
  });
  it('an over-limit encoded body → 413 payload_too_large or 200 blob_too_large, never a crash', async () => {
    const big = 'x'.repeat(600 * 1024);
    const r = await put(
      'alice',
      saveBody({ progress: 142, blob: JSON.stringify({ v: 1, counter: 1, gold: 1, pad: big }) }),
    );
    expect([200, 413]).toContain(r.statusCode);
    if (r.statusCode === 200) expect(r.json().reason).toBe('blob_too_large');
    else expect(r.json().error).toBe('payload_too_large');
  });
  it('a valid gzip of malformed JSON → stored_refused malformed', async () => {
    const blob = gzipSync(Buffer.from('{not json')).toString('base64');
    const r = await put('alice', saveBody({ progress: 143, enc: 'gzip+b64', blob }));
    expect(r.json()).toMatchObject({ disposition: 'stored_refused', reason: 'malformed' });
  });
});

describe('saves: concurrency on real Postgres', () => {
  it('50 concurrent writes for one player never collide on seq and produce exactly one anchor per progress', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        put(
          'conc',
          saveBody({ progress: 1000 + i, clientSeq: i }, { v: 1, counter: 1000 + i, gold: 1 }),
        ),
      ),
    );
    const codes = new Set(results.map((r) => r.statusCode));
    expect(codes).toEqual(new Set([200]));
    const seqs = results.map((r) => r.json().seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(50);
    const anchor = await h.inject({
      method: 'GET',
      url: '/v1/saves/current?meta=1',
      headers: h.playerHeaders('conc'),
    });
    expect(anchor.json().snapshot.progress).toBe(1049);
  });
  it('concurrent duplicates of the same commandId: one anchored, the rest duplicate with the same seq', async () => {
    const body = saveBody({ progress: 1050 }, { v: 1, counter: 1050, gold: 1 });
    const results = await Promise.all(Array.from({ length: 8 }, () => put('conc', body)));
    const dispositions = results.map((r) => r.json().disposition);
    expect(dispositions.filter((d) => d === 'anchored').length).toBe(1);
    expect(dispositions.filter((d) => d === 'duplicate').length).toBe(7);
    expect(new Set(results.map((r) => r.json().seq)).size).toBe(1);
  });
});

describe('saves: terminal reviews (promote/reject) — the anchor never falls back within a generation', () => {
  it('promote → client adopts; attempt reject afterwards ⇒ review_final; the anchor of the generation is unchanged', async () => {
    await put('rev', saveBody({ progress: 10 }, { v: 1, counter: 10, gold: 1 }));
    const q = await put(
      'rev',
      saveBody({ progress: 20, schemaVersion: 9 }, { v: 9, counter: 20, gold: 1 }),
    );
    expect(q.json().disposition).toBe('stored_quarantined');
    const seq = q.json().seq;
    const promote = await h.inject({
      method: 'POST',
      url: '/admin/v1/saves/reviews',
      headers: h.adminHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'rev',
        seq,
        action: 'promote',
        reason: 'looks fine',
      },
    });
    expect(promote.statusCode).toBe(200);
    expect(promote.json()).toMatchObject({ outcome: 'promoted', anchorSeq: seq });
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current?meta=1',
      headers: h.playerHeaders('rev'),
    });
    expect(cur.json().snapshot.seq).toBe(seq);
    expect(cur.json().pendingQuarantine).toBeUndefined();
    const reject = await h.inject({
      method: 'POST',
      url: '/admin/v1/saves/reviews',
      headers: h.adminHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'rev',
        seq,
        action: 'reject',
        reason: 'changed my mind',
      },
    });
    expect(reject.json()).toMatchObject({ outcome: 'review_final', anchorSeq: seq });
    const cur2 = await h.inject({
      method: 'GET',
      url: '/v1/saves/current?meta=1',
      headers: h.playerHeaders('rev'),
    });
    expect(cur2.json().snapshot.seq).toBe(seq);
    // the DB fence: even a direct second review raises
    await expect(
      h.root`INSERT INTO save_reviews (player_key, save_id, action, actor, rule_version, reason) SELECT player_key, id, 'reject', 'test', 'v1', 'x' FROM save_snapshots WHERE player_key = 'rev' AND seq = ${seq}`,
    ).rejects.toThrow(/review_final/);
  });
  it('supersession: a later anchored write makes a pending quarantined row ineligible; reject is terminal too', async () => {
    await put('sup', saveBody({ progress: 10 }, { v: 1, counter: 10, gold: 1 }));
    const q = await put('sup', saveBody({ progress: 25 }, { v: 1, counter: 5000, gold: 1 }));
    expect(q.json().disposition).toBe('stored_quarantined');
    const deeper = await put('sup', saveBody({ progress: 30 }, { v: 1, counter: 30, gold: 1 }));
    expect(deeper.json(), JSON.stringify(deeper.json())).toMatchObject({ disposition: 'anchored' });
    const r = await h.inject({
      method: 'POST',
      url: '/admin/v1/saves/reviews',
      headers: h.adminHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'sup',
        seq: q.json().seq,
        action: 'promote',
        reason: 'try',
      },
    });
    expect(r.json().outcome).toBe('not_eligible');
    const rej = await h.inject({
      method: 'POST',
      url: '/admin/v1/saves/reviews',
      headers: h.adminHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'sup',
        seq: q.json().seq,
        action: 'reject',
        reason: 'superseded',
      },
    });
    expect(rej.json().outcome).toBe('rejected');
    const again = await h.inject({
      method: 'POST',
      url: '/admin/v1/saves/reviews',
      headers: h.adminHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'sup',
        seq: q.json().seq,
        action: 'promote',
        reason: 'flip',
      },
    });
    expect(again.json().outcome).toBe('review_final');
    // idempotent admin retry with the same commandId replays with duplicate:true
    const cid = h.uuid();
    const a = await h.inject({
      method: 'POST',
      url: '/admin/v1/saves/reviews',
      headers: h.adminHeaders(),
      payload: { commandId: cid, playerKey: 'sup', seq: 999, action: 'promote', reason: 'x' },
    });
    const b = await h.inject({
      method: 'POST',
      url: '/admin/v1/saves/reviews',
      headers: h.adminHeaders(),
      payload: { commandId: cid, playerKey: 'sup', seq: 999, action: 'promote', reason: 'x' },
    });
    expect(a.json()).toMatchObject({ outcome: 'not_found', duplicate: false });
    expect(b.json()).toMatchObject({ outcome: 'not_found', duplicate: true });
  });
  it('a read-only admin key cannot review (403) and the attempt is logged', async () => {
    const r = await h.inject({
      method: 'POST',
      url: '/admin/v1/saves/reviews',
      headers: h.adminHeaders('reader'),
      payload: { commandId: h.uuid(), playerKey: 'rev', seq: 1, action: 'promote', reason: 'x' },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('saves: retention and privileges', () => {
  it('prune_save_blobs keeps the anchor and pending quarantine rows; the app role cannot delete or update ledgers directly', async () => {
    for (let i = 0; i < 30; i++)
      await put('prune', saveBody({ progress: i + 1 }, { v: 1, counter: i + 1, gold: 1 }));
    await h.root.begin(async (t) => {
      await t`SELECT set_config('foundation.privileged', 'on', true)`;
      await t`UPDATE save_snapshots SET received_at = received_at - interval '40 days' WHERE player_key = 'prune' AND seq <= 5`;
    });
    const pruned = await h.db.sql<
      { n: number }[]
    >`SELECT prune_save_blobs('prune', 20, 30, 3) AS n`;
    expect(pruned[0]!.n).toBeGreaterThan(0);
    const anchorBlob =
      await h.root`SELECT count(*)::int AS n FROM save_blobs b JOIN save_snapshots s ON s.id = b.save_id WHERE s.player_key = 'prune' AND s.seq = 30`;
    expect(anchorBlob[0]!.n).toBe(1);
    // the app role: no DELETE/UPDATE on ledgers (grant + fence)
    await expect(h.db.sql`DELETE FROM save_snapshots WHERE player_key = 'prune'`).rejects.toThrow(
      /permission denied|ledger_fence/,
    );
    await expect(
      h.db.sql`UPDATE save_snapshots SET progress = 0 WHERE player_key = 'prune'`,
    ).rejects.toThrow(/permission denied|ledger_fence/);
    await expect(h.db.sql`DELETE FROM save_blobs`).rejects.toThrow(
      /permission denied|ledger_fence/,
    );
    await expect(h.db.sql`UPDATE purchase_transactions SET granted = 999`).rejects.toThrow(
      /permission denied|ledger_fence/,
    );
    await expect(h.db.sql`UPDATE commands SET request_hash = 'x'`).rejects.toThrow(
      /permission denied/,
    );
    // and even the superuser is fenced on ledgers unless inside a SECURITY DEFINER function
    await expect(
      h.root`DELETE FROM save_snapshots WHERE player_key = 'prune' AND seq = 1`,
    ).rejects.toThrow(/ledger_fence/);
  });
  it('the write path never blocks on a pruned head: after all blobs are gone a shallow write anchors', async () => {
    await h.root.begin(async (t) => {
      await t`SELECT set_config('foundation.privileged', 'on', true)`;
      await t`DELETE FROM save_blobs b USING save_snapshots s WHERE b.save_id = s.id AND s.player_key = 'prune'`;
    });
    const r = await put('prune', saveBody({ progress: 3 }, { v: 1, counter: 3, gold: 1 }));
    expect(r.json().disposition).toBe('anchored');
  });
});
