import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, saveBody, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'lineage' });
});
afterAll(async () => h?.close());

const put = (player: string, body: unknown) =>
  h.inject({
    method: 'PUT',
    url: '/v1/saves',
    headers: h.playerHeaders(player),
    payload: body as object,
  });
const post = (player: string, url: string, body: unknown, opts: { iatMs?: number } = {}) =>
  h.inject({
    method: 'POST',
    url,
    headers: h.playerHeaders(player, opts),
    payload: body as object,
  });

describe('lineage: generations are the only way backwards', () => {
  it('restart: CAS on expectedGeneration (409 stale_generation), restartId is a business key (duplicate returns the same generation)', async () => {
    await put('gen', saveBody({ progress: 100 }, { v: 1, counter: 100, gold: 1 }));
    const restartId = h.uuid();
    const r1 = await post('gen', '/v1/lineage/restart', {
      commandId: h.uuid(),
      restartId,
      expectedGeneration: 0,
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({
      generation: 1,
      kind: 'restart',
      entitlement: 0,
      duplicate: false,
    });
    // same restartId with a NEW commandId → duplicate (business key), no second generation
    const r2 = await post('gen', '/v1/lineage/restart', {
      commandId: h.uuid(),
      restartId,
      expectedGeneration: 1,
    });
    expect(r2.json()).toMatchObject({ generation: 1, duplicate: true });
    // stale CAS
    const r3 = await post('gen', '/v1/lineage/restart', {
      commandId: h.uuid(),
      restartId: h.uuid(),
      expectedGeneration: 0,
    });
    expect(r3.statusCode).toBe(409);
    expect(r3.json()).toMatchObject({ error: 'stale_generation', details: { generation: 1 } });
    // the old-generation write is refused as stale_generation; a generation-1 write anchors from any depth (deeper-only resets per generation)
    const stale = await put(
      'gen',
      saveBody({ generation: 0, progress: 200 }, { v: 1, counter: 200, gold: 1 }),
    );
    expect(stale.json()).toMatchObject({
      disposition: 'stored_refused',
      reason: 'stale_generation',
      generation: 1,
    });
    const fresh = await put(
      'gen',
      saveBody({ generation: 1, progress: 1 }, { v: 1, counter: 1, gold: 1 }),
    );
    expect(fresh.json()).toMatchObject({
      disposition: 'anchored',
      generation: 1,
      currentProgress: 1,
    });
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current?meta=1',
      headers: h.playerHeaders('gen'),
    });
    expect(cur.json().lineage).toMatchObject({ generation: 1, kind: 'restart' });
  });
  it('value commands step up: a token older than 5 minutes cannot restart', async () => {
    const r = await post(
      'gen',
      '/v1/lineage/restart',
      { commandId: h.uuid(), restartId: h.uuid(), expectedGeneration: 1 },
      { iatMs: h.clock.now() - 6 * 60_000 },
    );
    expect(r.statusCode).toBe(401);
    expect(r.json().details).toEqual({ stepUp: true });
  });
  it('lineage CAS under concurrency: 10 concurrent restarts with distinct restartIds → exactly one wins, the rest 409', async () => {
    await put('cas', saveBody({ progress: 5 }, { v: 1, counter: 5, gold: 1 }));
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        post('cas', '/v1/lineage/restart', {
          commandId: h.uuid(),
          restartId: h.uuid(),
          expectedGeneration: 0,
        }),
      ),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 200).length).toBe(1);
    expect(codes.filter((c) => c === 409).length).toBe(9);
    const gens = await h.root`SELECT count(*)::int AS n FROM generations WHERE player_key = 'cas'`;
    expect(gens[0]!.n).toBe(2);
  });
  it('player restore-to-point: new generation seeded from seq; the seed row is anchored in the new generation', async () => {
    await put('rst', saveBody({ progress: 10 }, { v: 1, counter: 10, gold: 1 }));
    const two = await put('rst', saveBody({ progress: 20 }, { v: 1, counter: 20, gold: 1 }));
    await put('rst', saveBody({ progress: 30 }, { v: 1, counter: 30, gold: 1 }));
    const r = await post('rst', '/v1/lineage/restoreToSeq', {
      commandId: h.uuid(),
      seq: two.json().seq,
      expectedGeneration: 0,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      generation: 1,
      kind: 'player_restore',
      seedSeq: two.json().seq,
    });
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: h.playerHeaders('rst'),
    });
    expect(cur.json().generation).toBe(1);
    expect(JSON.parse(cur.json().blob)).toEqual({ v: 1, counter: 20, gold: 1 });
    expect(cur.json().snapshot.progress).toBe(20);
    // the old generation is untouched (no same-generation rollback)
    const old =
      await h.root`SELECT max(progress)::int AS p FROM save_snapshots WHERE player_key = 'rst' AND generation = 0 AND disposition = 'anchored'`;
    expect(old[0]!.p).toBe(30);
    // restoring to a pruned/absent seq → 404
    const bad = await post('rst', '/v1/lineage/restoreToSeq', {
      commandId: h.uuid(),
      seq: 999,
      expectedGeneration: 1,
    });
    expect(bad.statusCode).toBe(404);
  });
  it('reattach is operator-enabled: refused by default, then opens the client generation seeded from the client snapshot', async () => {
    await put('ra', saveBody({ progress: 10 }, { v: 1, counter: 10, gold: 1 }));
    const snapshot = {
      progress: 50,
      schemaVersion: 1,
      buildVersion: '1.0.0',
      enc: 'json',
      blob: JSON.stringify({ v: 1, counter: 50, gold: 9 }),
      savedAt: h.clock.now(),
    };
    const denied = await post('ra', '/v1/lineage/reattach', {
      commandId: h.uuid(),
      clientGeneration: 2,
      expectedServerGeneration: 0,
      snapshot,
    });
    expect(denied.statusCode).toBe(403);
    await h.root`INSERT INTO liveops_settings (key, value, reason, actor) VALUES ('reattach_enabled', 'true', 'test', 'test')`;
    await h.server.ctx.liveops.refresh();
    const ok = await post('ra', '/v1/lineage/reattach', {
      commandId: h.uuid(),
      clientGeneration: 2,
      expectedServerGeneration: 0,
      snapshot,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ generation: 2, kind: 'reattach' });
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: h.playerHeaders('ra'),
    });
    expect(cur.json().generation).toBe(2);
    expect(JSON.parse(cur.json().blob)).toEqual({ v: 1, counter: 50, gold: 9 });
  });
  it('admin restore opens an admin_restore generation and is audited', async () => {
    await put('adm', saveBody({ progress: 10 }, { v: 1, counter: 10, gold: 1 }));
    await put('adm', saveBody({ progress: 20 }, { v: 1, counter: 20, gold: 1 }));
    const cid = h.uuid();
    const r = await h.inject({
      method: 'POST',
      url: '/admin/v1/players/restore',
      headers: h.adminHeaders(),
      payload: {
        commandId: cid,
        playerKey: 'adm',
        seq: 1,
        expectedGeneration: 0,
        reason: 'support ticket 42',
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ generation: 1, kind: 'admin_restore', seedSeq: 1 });
    const audit =
      await h.root`SELECT command_type, target, reason FROM admin_actions WHERE command_id = ${cid}`;
    expect(audit[0]).toEqual({
      command_type: 'lineage.adminRestore',
      target: 'adm',
      reason: 'support ticket 42',
    });
    // Idempotency-Key header maps to commandId for admin writes
    const r2 = await h.inject({
      method: 'POST',
      url: '/admin/v1/players/restore',
      headers: { ...h.adminHeaders(), 'idempotency-key': cid },
      payload: { playerKey: 'adm', seq: 1, expectedGeneration: 0, reason: 'support ticket 42' },
    });
    expect(r2.json()).toMatchObject({ generation: 1, duplicate: true });
    const stale = await h.inject({
      method: 'POST',
      url: '/admin/v1/players/restore',
      headers: h.adminHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'adm',
        seq: 1,
        expectedGeneration: 0,
        reason: 'x',
      },
    });
    expect(stale.statusCode).toBe(409);
  });
  it('erase: generation kind erased + erasure ledger row + blobs gone; the client sees erased; a read-only key cannot erase', async () => {
    await put('gone', saveBody({ progress: 10 }, { v: 1, counter: 10, gold: 1 }));
    const denied = await h.inject({
      method: 'POST',
      url: '/admin/v1/players/erase',
      headers: h.adminHeaders('reader'),
      payload: { commandId: h.uuid(), playerKey: 'gone', reason: 'gdpr' },
    });
    expect(denied.statusCode).toBe(403);
    const r = await h.inject({
      method: 'POST',
      url: '/admin/v1/players/erase',
      headers: h.adminHeaders(),
      payload: { commandId: h.uuid(), playerKey: 'gone', reason: 'gdpr request', ticketRef: 'T-1' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ generation: 1 });
    const blobs =
      await h.root`SELECT count(*)::int AS n FROM save_blobs b JOIN save_snapshots s ON s.id = b.save_id WHERE s.player_key = 'gone'`;
    expect(blobs[0]!.n).toBe(0);
    const er = await h.root`SELECT reason, ticket_ref FROM erasures WHERE player_key = 'gone'`;
    expect(er[0]).toEqual({ reason: 'gdpr request', ticket_ref: 'T-1' });
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: h.playerHeaders('gone'),
    });
    expect(cur.json()).toMatchObject({ empty: true, erased: true, generation: 1 });
    const w = await put(
      'gone',
      saveBody({ generation: 1, progress: 1 }, { v: 1, counter: 1, gold: 1 }),
    );
    expect(w.statusCode).toBe(403);
    expect(w.json().details).toEqual({ erased: true });
  });
  it('QA import (lab): manifest for another game/env is refused before writing; matching manifest seeds a generation', async () => {
    const snapshot = {
      progress: 77,
      schemaVersion: 1,
      buildVersion: '1.0.0',
      enc: 'json',
      blob: JSON.stringify({ v: 1, counter: 77, gold: 3, playerName: 'secret' }),
    };
    const bad = await h.inject({
      method: 'POST',
      url: '/qa/v1/saves/import',
      headers: h.opsHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'qa_import1',
        manifest: {
          game: 'other',
          env: 'prod',
          takenAt: h.clock.now(),
          schemaHead: 'x',
          contractVersion: '1.0.0',
        },
        snapshot,
      },
    });
    expect(bad.statusCode).toBe(403);
    const badEnv = await h.inject({
      method: 'POST',
      url: '/qa/v1/saves/import',
      headers: h.opsHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'qa_import1',
        manifest: {
          game: 'template',
          env: 'prod',
          takenAt: h.clock.now(),
          schemaHead: 'x',
          contractVersion: '1.0.0',
        },
        snapshot,
      },
    });
    expect(badEnv.statusCode).toBe(403);
    const rows =
      await h.root`SELECT count(*)::int AS n FROM save_snapshots WHERE player_key = 'qa_import1'`;
    expect(rows[0]!.n).toBe(0);
    const ok = await h.inject({
      method: 'POST',
      url: '/qa/v1/saves/import',
      headers: h.opsHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'qa_import1',
        manifest: {
          game: 'template',
          env: 'lab',
          takenAt: h.clock.now(),
          schemaHead: 'x',
          contractVersion: '1.0.0',
        },
        snapshot,
      },
    });
    expect(ok.statusCode).toBe(200);
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: h.playerHeaders('qa_import1'),
    });
    // sanitised: playerName stripped by policy.sanitizeForQa
    expect(JSON.parse(cur.json().blob)).toEqual({ v: 1, counter: 77, gold: 3 });
    // qa mint route works in lab and requires the ops secret
    const mint = await h.inject({
      method: 'POST',
      url: '/qa/v1/identity/mint',
      headers: h.opsHeaders(),
      payload: { commandId: h.uuid(), playerId: 'qa_smoke' },
    });
    expect(mint.statusCode).toBe(200);
    expect(mint.json().token).toMatch(/^mock\.qa_smoke\./);
    const noSecret = await h.inject({
      method: 'POST',
      url: '/qa/v1/identity/mint',
      payload: { commandId: h.uuid() },
    });
    expect(noSecret.statusCode).toBe(401);
  });
});
