// Regression tests for the audit findings (server side): F3 save tombstones keep semantics,
// F5 atomic code capacity, F6 outbox lease tokens, F7 replay in the command tx, F8
// pendingQuarantine on empty responses, F4 DR markers + isolated restore + erasure replay.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, enableAppRole, connect } from '@foundation/testkit/pg';
import {
  migrateUp,
  createDb,
  Outbox,
  fixedClock,
  verifyLiveIntegrity,
  verifyIsolatedRestore,
  markRestoreVerified,
  exportErasures,
  writeErasureExport,
  readErasureExport,
  replayErasures,
  listMigrations,
  schemaHead,
} from '@foundation/server';
import { replaySaveResult, saveFromTombstone } from '@foundation/server/features/saves/server';
import { setupHarness, saveBody, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'audit' });
});
afterAll(async () => h?.close());

const put = (player: string, body: unknown) =>
  h.inject({
    method: 'PUT',
    url: '/v1/saves',
    headers: h.playerHeaders(player),
    payload: body as object,
  });
const post = (player: string, url: string, body: unknown, opts: { registered?: boolean } = {}) =>
  h.inject({
    method: 'POST',
    url,
    headers: h.playerHeaders(player, opts),
    payload: body as object,
  });
const admin = (url: string, body: unknown) =>
  h.inject({ method: 'POST', url, headers: h.adminHeaders(), payload: body as object });

async function ageAndPrune(commandId: string) {
  await h.root`UPDATE commands SET received_at = now() - interval '8 days' WHERE command_id = ${commandId}`;
  await h.db.sql`SELECT apply_retention()`;
  const gone = await h.root`SELECT 1 FROM commands WHERE command_id = ${commandId}`;
  expect(gone.length).toBe(0);
}

describe('F3 save tombstones retain the original semantics (row and > 7 d tombstone)', () => {
  it('pure replay: anchored → duplicate; refused/quarantined replay unchanged; tombstone round-trips every field', () => {
    const anchored = {
      disposition: 'anchored' as const,
      seq: 3,
      generation: 1,
      currentProgress: 30,
      blobSha256: 'a'.repeat(64),
    };
    expect(replaySaveResult(anchored)).toEqual({ ...anchored, disposition: 'duplicate' });
    const refused = {
      disposition: 'stored_refused' as const,
      reason: 'progress_regression' as const,
      seq: 4,
      generation: 1,
      currentProgress: 30,
      blobSha256: 'b'.repeat(64),
      divergent: { headSeq: 3, headWriterAt: 1 },
    };
    expect(replaySaveResult(refused)).toEqual(refused);
    const quarantined = {
      disposition: 'stored_quarantined' as const,
      flags: ['progress_jump' as const],
      seq: 5,
      generation: 1,
      currentProgress: 30,
      blobSha256: 'c'.repeat(64),
    };
    expect(replaySaveResult(quarantined)).toEqual(quarantined);
    expect(saveFromTombstone(JSON.stringify(refused))).toEqual(refused);
    expect(saveFromTombstone(JSON.stringify(quarantined))).toEqual(quarantined);
    expect(saveFromTombstone(JSON.stringify(anchored))).toEqual({
      ...anchored,
      disposition: 'duplicate',
    });
  });
  it('a refused write retried after > 7 days still replays stored_refused with reason/seq/divergence, never duplicate', async () => {
    await put('t3', saveBody({ progress: 100 }, { v: 1, counter: 100, gold: 1 }));
    const body = saveBody(
      { progress: 50, sessionId: '9b2d5c1e-8f0a-4c7b-a1d2-3e4f5a6b7c8d', baseSeq: 0 },
      { v: 1, counter: 50, gold: 1 },
    );
    const first = await put('t3', body);
    expect(first.json()).toMatchObject({
      disposition: 'stored_refused',
      reason: 'progress_regression',
    });
    expect(first.json().divergent).toBeDefined();
    const again = await put('t3', body);
    expect(again.json()).toMatchObject({
      disposition: 'stored_refused',
      reason: 'progress_regression',
      seq: first.json().seq,
      generation: 0,
      currentProgress: 100,
    });
    expect(again.json().divergent).toEqual(first.json().divergent);
    await ageAndPrune(body.commandId);
    const late = await put('t3', body);
    expect(late.json()).toMatchObject({
      disposition: 'stored_refused',
      reason: 'progress_regression',
      seq: first.json().seq,
      generation: 0,
      currentProgress: 100,
      blobSha256: first.json().blobSha256,
    });
    expect(late.json().divergent).toEqual(first.json().divergent);
    const rows =
      await h.root`SELECT count(*)::int AS n FROM save_snapshots WHERE player_key = 't3'`;
    expect(rows[0]!.n).toBe(2);
  });
  it('a quarantined write retried after > 7 days still replays stored_quarantined with its flags', async () => {
    const body = saveBody({ progress: 200, schemaVersion: 9 }, { v: 9, counter: 200, gold: 1 });
    const first = await put('t3', body);
    expect(first.json()).toMatchObject({
      disposition: 'stored_quarantined',
      flags: ['schema_unknown'],
    });
    await ageAndPrune(body.commandId);
    const late = await put('t3', body);
    expect(late.json()).toMatchObject({
      disposition: 'stored_quarantined',
      flags: ['schema_unknown'],
      seq: first.json().seq,
      currentProgress: 100,
    });
    // and the pending review is still visible
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current?meta=1',
      headers: h.playerHeaders('t3'),
    });
    expect(cur.json().pendingQuarantine).toMatchObject({ seq: first.json().seq, progress: 200 });
  });
  it('an anchored write retried after > 7 days replays duplicate with the original seq/hash', async () => {
    const body = saveBody({ progress: 300 }, { v: 1, counter: 300, gold: 1 });
    const first = await put('t3', body);
    expect(first.json().disposition).toBe('anchored');
    await ageAndPrune(body.commandId);
    const late = await put('t3', body);
    expect(late.json()).toMatchObject({
      disposition: 'duplicate',
      seq: first.json().seq,
      generation: 0,
      currentProgress: 300,
      blobSha256: first.json().blobSha256,
    });
    expect(late.json().reason).toBeUndefined();
  });
});

describe('F8 pendingQuarantine survives an empty/no-anchor response', () => {
  it('a player whose only write is quarantined: current → empty:true + pendingQuarantine (a storage-empty second device learns about it)', async () => {
    const q = await put(
      'onlyq',
      saveBody({ progress: 10, schemaVersion: 9 }, { v: 9, counter: 10, gold: 1 }),
    );
    expect(q.json().disposition).toBe('stored_quarantined');
    const cur = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: h.playerHeaders('onlyq'),
    });
    expect(cur.json()).toMatchObject({
      empty: true,
      generation: 0,
      pendingQuarantine: { seq: q.json().seq, progress: 10, flags: ['schema_unknown'] },
    });
    expect(cur.json().snapshot).toBeUndefined();
    const meta = await h.inject({
      method: 'GET',
      url: '/v1/saves/current?meta=1',
      headers: h.playerHeaders('onlyq'),
    });
    expect(meta.json().pendingQuarantine).toBeDefined();
  });
});

describe('F5 code redemption reserves capacity atomically across players', () => {
  it('max=1: two distinct players redeeming concurrently → exactly one redeemed, one exhausted, one grant', async () => {
    for (let round = 0; round < 5; round++) {
      const campaignId = `race-${round}`;
      const code = `RACE-CODE-${round}-ABCDEFG`;
      await admin('/admin/v1/codes/campaigns', {
        commandId: h.uuid(),
        campaignId,
        codes: [code],
        rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 1 }],
        maxRedemptionsPerCode: 1,
        registeredOnly: false,
        reason: 'race',
      });
      const [a, b, c] = await Promise.all([
        post(`ra-${round}`, '/v1/codes/redeem', { commandId: h.uuid(), code }),
        post(`rb-${round}`, '/v1/codes/redeem', { commandId: h.uuid(), code }),
        post(`rc-${round}`, '/v1/codes/redeem', { commandId: h.uuid(), code }),
      ]);
      const outcomes = [a, b, c].map((r) => r.json().outcome).sort();
      expect(outcomes).toEqual(['exhausted', 'exhausted', 'redeemed']);
      const grants =
        await h.root`SELECT count(*)::int AS n FROM grants WHERE grant_key LIKE ${`code:${campaignId}:%`}`;
      expect(grants[0]!.n).toBe(1);
      const red =
        await h.root`SELECT redemptions FROM codes c JOIN code_campaigns k ON k.campaign_id = c.campaign_id WHERE k.campaign_id = ${campaignId}`;
      expect(red[0]!.redemptions).toBe(1);
    }
  });
});

describe('F6 outbox lease tokens: two workers, lease expiry, stale finalisation', () => {
  const clock = fixedClock(1_786_924_800_000);
  it('two workers draining the same rows never double-deliver; a stale holder cannot finalise', async () => {
    const t = await createTestDatabase('lease');
    await migrateUp(t.url);
    await enableAppRole(t.url, t.name, 'foundation_app_test');
    const u = new URL(t.url);
    u.username = 'foundation_app';
    u.password = 'foundation_app_test';
    const dbA = createDb(u.toString(), { max: 4 });
    const dbB = createDb(u.toString(), { max: 4 });
    const root = connect(t.url, { max: 1 });
    try {
      const delivered: string[] = [];
      const mk = (db: typeof dbA, name: string) => {
        const o = new Outbox(db, clock, { leaseMs: 10_000, batch: 50 });
        o.register({
          name: 'w',
          kinds: ['evt'],
          async handle(msg) {
            delivered.push(`${name}:${msg.id}`);
          },
        });
        return o;
      };
      const A = mk(dbA, 'A');
      const B = mk(dbB, 'B');
      await dbA.tx(async (tx) => {
        for (let i = 0; i < 40; i++) await A.emit(tx, { kind: 'evt', payload: { i } });
      });
      const [ra, rb] = await Promise.all([A.drain(), B.drain()]);
      expect(ra.delivered + rb.delivered).toBe(40);
      expect(new Set(delivered.map((d) => d.split(':')[1])).size).toBe(40);
      expect(ra.stale + rb.stale).toBe(0);
      const st = await root`SELECT state, count(*)::int AS n FROM outbox_deliveries GROUP BY state`;
      expect(st).toEqual([{ state: 'delivered', n: 40 }]);

      // stale finalisation: worker A leases a row, its lease expires, worker B re-leases and delivers;
      // A's late finalisation must be refused (lease_token mismatch) and counted as stale.
      let holdA: (() => void) | null = null;
      const slow = new Outbox(dbA, clock, { leaseMs: 5_000, batch: 1 });
      slow.register({
        name: 'slow',
        kinds: ['slow'],
        async handle() {
          await new Promise<void>((r) => (holdA = r));
        },
      });
      const fast = new Outbox(dbB, clock, { leaseMs: 5_000, batch: 1 });
      fast.register({ name: 'slow', kinds: ['slow'], async handle() {} });
      await dbA.tx((tx) => slow.emit(tx, { kind: 'slow', payload: {} }));
      const aDrain = slow.drain();
      // wait until A holds the lease
      for (let i = 0; i < 50 && holdA === null; i++) await new Promise((r) => setTimeout(r, 10));
      expect(holdA).not.toBeNull();
      // lease expires; B takes over and delivers
      clock.advance(6_000);
      const rb2 = await fast.drain();
      expect(rb2.delivered).toBe(1);
      const afterB =
        await root`SELECT state, lease_token FROM outbox_deliveries d JOIN outbox o ON o.id = d.outbox_id WHERE o.kind = 'slow'`;
      expect(afterB[0]).toMatchObject({ state: 'delivered', lease_token: null });
      // A finishes late: its token no longer matches → stale, row stays delivered exactly once
      holdA!();
      const ra2 = await aDrain;
      expect(ra2).toMatchObject({ delivered: 0, stale: 1 });
      const final =
        await root`SELECT state FROM outbox_deliveries d JOIN outbox o ON o.id = d.outbox_id WHERE o.kind = 'slow'`;
      expect(final).toEqual([{ state: 'delivered' }]);
    } finally {
      await dbA.end();
      await dbB.end();
      await root.end({ timeout: 5 });
      await t.drop();
    }
  });
});

describe('F7 admin outbox replay rides the command transaction', () => {
  it('works with PG_POOL=1 (no second connection) and rolls back atomically with the command', async () => {
    const t = await createTestDatabase('replay1');
    await migrateUp(t.url);
    await enableAppRole(t.url, t.name, 'foundation_app_test');
    const u = new URL(t.url);
    u.username = 'foundation_app';
    u.password = 'foundation_app_test';
    const db1 = createDb(u.toString(), { max: 1 });
    const root = connect(t.url, { max: 1 });
    const clock = fixedClock(1_786_924_800_000);
    try {
      const outbox = new Outbox(db1, clock, { maxAttempts: 1 });
      outbox.register({
        name: 'boom',
        kinds: ['x'],
        async handle() {
          throw new Error('down');
        },
      });
      await db1.tx((tx) => outbox.emit(tx, { kind: 'x', payload: {} }));
      const d = await outbox.drain();
      expect(d.dead).toBe(1);
      const id = (await root`SELECT outbox_id FROM outbox_dead_letters`)[0]!.outbox_id;
      // replay inside a single-connection transaction: must not deadlock/timeout on the pool
      const ok = await Promise.race([
        db1.tx((tx) => outbox.replayInTx(tx, Number(id), 'boom', 'admin:test')),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 8_000)),
      ]);
      expect(ok).toBe(true);
      const st = await root`SELECT state, attempts FROM outbox_deliveries WHERE outbox_id = ${id}`;
      expect(st[0]).toEqual({ state: 'pending', attempts: 0 });
      // atomicity: a replay whose enclosing tx rolls back leaves the dead letter untouched
      await outbox.drain();
      expect(
        (
          await root`SELECT count(*)::int AS n FROM outbox_dead_letters WHERE replayed_at IS NULL`
        )[0]!.n,
      ).toBe(1);
      await expect(
        db1.tx(async (tx) => {
          await outbox.replayInTx(tx, Number(id), 'boom', 'admin:test');
          throw new Error('rollback');
        }),
      ).rejects.toThrow(/rollback/);
      const dl =
        await root`SELECT count(*)::int AS n FROM outbox_dead_letters WHERE replayed_at IS NULL`;
      expect(dl[0]!.n).toBe(1);
      const st2 = await root`SELECT state FROM outbox_deliveries WHERE outbox_id = ${id}`;
      expect(st2[0]!.state).toBe('dead');
    } finally {
      await db1.end();
      await root.end({ timeout: 5 });
      await t.drop();
    }
  });
  it('the admin route replays inside its command and is audited', async () => {
    h.server.ctx.outbox.register({
      name: 'audit.dead',
      kinds: ['audit.evt'],
      async handle() {
        throw new Error('nope');
      },
    });
    await h.db.tx((tx) => h.server.ctx.outbox.emit(tx, { kind: 'audit.evt', payload: {} }));
    for (let i = 0; i < 12; i++) {
      await h.drainOutbox();
      h.clock.advance(60 * 60_000);
    }
    const id = (
      await h.root`SELECT outbox_id FROM outbox_dead_letters WHERE consumer = 'audit.dead'`
    )[0]!.outbox_id;
    const cid = h.uuid();
    const r = await admin('/admin/v1/outbox/replay', {
      commandId: cid,
      outboxId: Number(id),
      consumer: 'audit.dead',
      reason: 'fixed',
    });
    expect(r.statusCode).toBe(200);
    const audit = await h.root`SELECT outcome FROM admin_actions WHERE command_id = ${cid}`;
    expect(audit[0]).toEqual({ outcome: 'ok' });
    const st =
      await h.root`SELECT state FROM outbox_deliveries WHERE outbox_id = ${id} AND consumer = 'audit.dead'`;
    expect(st[0]!.state).toBe('pending');
  });
});

describe('F4 DR: live integrity vs isolated restore; erasure export/replay', () => {
  it('the live self-check writes live_integrity_verified_at and never restore_verified_at', async () => {
    await put('dr1', saveBody({ progress: 5 }, { v: 1, counter: 5, gold: 1 }));
    const r = await verifyLiveIntegrity(h.db.sql, h.clock.now());
    expect(r.verified).toBe(true);
    const markers = await h.root`SELECT key FROM ops_markers ORDER BY key`;
    expect(markers.map((m) => m.key)).toContain('live_integrity_verified_at');
    expect(markers.map((m) => m.key)).not.toContain('restore_verified_at');
    const ops = await h.inject({ method: 'GET', url: '/health/ops', headers: h.opsHeaders() });
    expect(ops.json().liveIntegrityVerifiedAt).toBe(h.clock.now());
    expect(ops.json().restoreVerifiedAt).toBeUndefined();
    const job = h.server.jobs.names();
    expect(job).toContain('live.integrity');
    expect(job).not.toContain('restore.verify');
  });
  it('isolated restore verification refuses a wrong-target manifest, verifies a matching restored copy, replays erasures, and only then marks restore_verified_at', async () => {
    // "restored" database: a second database at head with a copy of a player's rows
    const restored = await createTestDatabase('restored');
    const dir = mkdtempSync(join(tmpdir(), 'dr-'));
    try {
      await migrateUp(restored.url);
      const rsql = connect(restored.url, { max: 1 });
      try {
        await put('dr2', saveBody({ progress: 7 }, { v: 1, counter: 7, gold: 2 }));
        await put('dr-erased', saveBody({ progress: 9 }, { v: 1, counter: 9, gold: 2 }));
        // copy generations + snapshots + blobs for both players into the restored copy (what a dump/restore yields)
        const gens =
          await h.root`SELECT player_key, generation, kind, actor FROM generations WHERE player_key IN ('dr2', 'dr-erased')`;
        for (const g of gens)
          await rsql`INSERT INTO generations (player_key, generation, kind, actor) VALUES (${g.player_key}, ${g.generation}, ${g.kind}, ${g.actor})`;
        const snaps =
          await h.root`SELECT s.*, b.blob FROM save_snapshots s JOIN save_blobs b ON b.save_id = s.id WHERE s.player_key IN ('dr2', 'dr-erased')`;
        for (const s of snaps) {
          const ins =
            await rsql`INSERT INTO save_snapshots (player_key, generation, seq, client_seq, base_seq, session_id, command_id, progress, saved_at, bytes, enc_bytes, blob_sha256, schema_version, build_version, source, disposition, flags, summary, enc, reason)
            VALUES (${s.player_key}, ${s.generation}, ${s.seq}, ${s.client_seq}, ${s.base_seq}, ${s.session_id}, ${s.command_id}, ${s.progress}, ${s.saved_at}, ${s.bytes}, ${s.enc_bytes}, ${s.blob_sha256}, ${s.schema_version}, ${s.build_version}, ${s.source}, ${s.disposition}, ${s.flags}, ${s.summary ? rsql.json(s.summary) : null}, ${s.enc}, ${s.reason}) RETURNING id`;
          await rsql`INSERT INTO save_blobs (save_id, blob) VALUES (${ins[0]!.id}, ${s.blob})`;
        }
        // erase one player on the LIVE db after the "backup" was taken → the tombstone must replay
        const er = await admin('/admin/v1/players/erase', {
          commandId: h.uuid(),
          playerKey: 'dr-erased',
          reason: 'gdpr',
          ticketRef: 'T-9',
        });
        expect(er.statusCode).toBe(200);
        const head = schemaHead(listMigrations());
        const manifest = {
          game: 'template',
          env: 'lab',
          takenAt: h.clock.now(),
          schemaHead: head,
          contractVersion: '1.0.0',
        };
        const exported = await exportErasures(h.db.sql, manifest);
        expect(exported.erasures.map((e) => e.playerKey)).toContain('dr-erased');
        const file = join(dir, 'erasures.jsonl');
        writeErasureExport(file, exported);
        const back = readErasureExport(file);
        expect(back.manifest).toEqual(manifest);
        expect(back.erasures).toEqual(exported.erasures);

        // wrong destination → refused before touching the restored DB
        const wrong = await verifyIsolatedRestore({
          restoredUrl: restored.url,
          manifest,
          destination: { game: 'other', env: 'lab' },
        });
        expect(wrong.ok).toBe(false);
        expect(wrong.checks.manifestMatchesDestination).toBe(false);
        const wrongEnv = await verifyIsolatedRestore({
          restoredUrl: restored.url,
          manifest,
          destination: { game: 'template', env: 'prod' },
        });
        expect(wrongEnv.ok).toBe(false);
        await expect(markRestoreVerified(h.db.sql, wrong, h.clock.now())).rejects.toThrow(
          /refusing/,
        );
        expect(
          (await h.root`SELECT 1 FROM ops_markers WHERE key = 'restore_verified_at'`).length,
        ).toBe(0);

        // matching destination: schema at head, blobs re-hash, anchors readable, erasures replayed
        const ok = await verifyIsolatedRestore({
          restoredUrl: restored.url,
          manifest,
          destination: { game: 'template', env: 'lab' },
          erasures: back.erasures,
        });
        expect(ok.problems).toEqual([]);
        expect(ok).toMatchObject({
          ok: true,
          checks: {
            manifestMatchesDestination: true,
            schemaAtHead: true,
            blobsSampled: 2,
            blobsOk: 2,
            anchorsReadable: true,
            erasuresReplayed: 1,
          },
        });
        const erasedBlobs =
          await rsql`SELECT count(*)::int AS n FROM save_blobs b JOIN save_snapshots s ON s.id = b.save_id WHERE s.player_key = 'dr-erased'`;
        expect(erasedBlobs[0]!.n).toBe(0);
        const keptBlobs =
          await rsql`SELECT count(*)::int AS n FROM save_blobs b JOIN save_snapshots s ON s.id = b.save_id WHERE s.player_key = 'dr2'`;
        expect(keptBlobs[0]!.n).toBe(1);
        // replay is idempotent
        const again = await replayErasures(rsql as never, back.erasures, 'test');
        expect(again).toMatchObject({ applied: 0, alreadyPresent: 1, failed: [] });
        // a tampered blob in the restored copy fails verification
        await rsql.begin(async (tx) => {
          await tx`SELECT set_config('foundation.privileged', 'on', true)`;
          await tx`UPDATE save_blobs SET blob = ${Buffer.from('{"v":1,"counter":7,"gold":999}')} WHERE save_id IN (SELECT id FROM save_snapshots WHERE player_key = 'dr2')`;
        });
        const bad = await verifyIsolatedRestore({
          restoredUrl: restored.url,
          manifest,
          destination: { game: 'template', env: 'lab' },
        });
        expect(bad.ok).toBe(false);
        expect(bad.problems.join(' ')).toMatch(/failed re-hash/);
        // only a passing report marks the live database
        await markRestoreVerified(h.db.sql, ok, h.clock.now());
        const ops = await h.inject({ method: 'GET', url: '/health/ops', headers: h.opsHeaders() });
        expect(ops.json().restoreVerifiedAt).toBe(h.clock.now());
      } finally {
        await rsql.end({ timeout: 5 });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await restored.drop();
    }
  });
});
