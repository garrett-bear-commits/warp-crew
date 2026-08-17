import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDatabase, connect } from '@foundation/testkit/pg';
import {
  migrateUp,
  checkSchema,
  describeSchema,
  listMigrations,
  schemaHead,
  repairChecksums,
} from '../../src/db/migrate.ts';
import { setupPg, type PgHarness } from './helpers.ts';
import { Outbox } from '../../src/outbox/index.ts';
import { fixedClock } from '../../src/clock/index.ts';
import { createJobRunner } from '../../src/jobs/index.ts';
import { createPgLimiter } from '../../src/limits/index.ts';
import { mintGrant } from '../../src/rewards/mint.ts';

describe('migrations from empty (§9): checksummed, locked, idempotent, boot check refuses drift', () => {
  it('applies every file once, records checksums, second run is a no-op, head is stable, roles + fences exist', async () => {
    const t = await createTestDatabase('mig');
    try {
      const first = await migrateUp(t.url);
      expect(first.applied.length).toBe(listMigrations().length);
      expect(first.skipped).toEqual([]);
      const second = await migrateUp(t.url);
      expect(second.applied).toEqual([]);
      expect(second.skipped.length).toBe(first.applied.length);
      expect(second.head).toBe(first.head);
      expect(first.head).toBe(schemaHead(listMigrations()));
      const sql = connect(t.url, { max: 1 });
      try {
        const st = await checkSchema(sql);
        expect(st).toMatchObject({ ok: true, pending: [], mismatched: [] });
        // tamper: pretend a file changed → boot check refuses
        await sql`UPDATE schema_migrations SET checksum = 'deadbeef' WHERE name LIKE '0003%'`;
        const bad = await checkSchema(sql);
        expect(bad.ok).toBe(false);
        expect(bad.mismatched).toEqual(['0003_saves.sql']);
        await expect(migrateUp(t.url)).rejects.toThrow(/checksum mismatch/);
        // --repair re-records the checksum (documented ops step)
        const repaired = await repairChecksums(t.url);
        expect(repaired).toEqual(['0003_saves.sql']);
        expect((await checkSchema(sql)).ok).toBe(true);
        // schema description (for --check) is deterministic and mentions the fences + SECURITY DEFINER functions
        const d1 = await describeSchema(sql);
        const d2 = await describeSchema(sql);
        expect(d1).toBe(d2);
        expect(d1).toMatch(/fn prune_save_blobs secdef=true/);
        expect(d1).toMatch(/fn erase_player secdef=true/);
        expect(d1).toMatch(/trg save_snapshots.save_snapshots_fence/);
        expect(d1).not.toMatch(/game_id/);
        const roles = await sql<
          { rolname: string }[]
        >`SELECT rolname FROM pg_roles WHERE rolname IN ('foundation_app', 'foundation_migrator') ORDER BY 1`;
        expect(roles.map((r) => r.rolname)).toEqual(['foundation_app', 'foundation_migrator']);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await t.drop();
    }
  });
  it('a missing migration file for an applied row is refused', async () => {
    const t = await createTestDatabase('mig2');
    try {
      await migrateUp(t.url);
      const sql = connect(t.url, { max: 1 });
      await sql`INSERT INTO schema_migrations (name, checksum) VALUES ('9999_ghost.sql', 'x')`;
      await sql.end({ timeout: 5 });
      await expect(migrateUp(t.url)).rejects.toThrow(/missing on disk/);
    } finally {
      await t.drop();
    }
  });
});

describe('outbox: crash mid-drain, lease expiry, at-least-once + idempotent redelivery; jobs; pg limiter', () => {
  let h: PgHarness;
  const clock = fixedClock(1_786_924_800_000);
  beforeAll(async () => {
    h = await setupPg('infra');
  });
  afterAll(async () => h?.close());

  it('a consumer that crashes after side effects but before ack is redelivered after the lease expires; the deterministic commandId dedupes', async () => {
    const outbox = new Outbox(h.db, clock, { leaseMs: 10_000, maxAttempts: 5 });
    const seen: string[] = [];
    let crashOnce = true;
    outbox.register({
      name: 'crashy',
      kinds: ['evt'],
      async handle(msg, { deterministicCommandId }) {
        seen.push(deterministicCommandId);
        if (crashOnce) {
          crashOnce = false;
          throw new Error('process died mid-handler'); // simulates SIGTERM before finalise
        }
        void msg;
      },
    });
    await h.db.tx(async (tx) => outbox.emit(tx, { kind: 'evt', payload: { x: 1 } }));
    const d1 = await outbox.drain();
    expect(d1).toMatchObject({ delivered: 0, failed: 1 });
    // simulate a crashed leaseholder: state 'leased' with an expired lease
    await h.root`UPDATE outbox_deliveries SET state = 'leased', lease_until = ${new Date(clock.now() - 60_000)}, next_attempt_at = ${new Date(clock.now() - 60_000)} WHERE consumer = 'crashy'`;
    const d2 = await outbox.drain();
    expect(d2).toMatchObject({ delivered: 1 });
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]); // same deterministic id both times → the reaction command is idempotent by construction
    const stats = await outbox.stats();
    expect(stats).toMatchObject({ pending: 0, deadLetters: 0 });
  });
  it('emit inside a transaction that rolls back leaves no outbox row (the outbox is written in the originating tx)', async () => {
    const outbox = new Outbox(h.db, clock);
    outbox.register({ name: 'noop', kinds: '*', async handle() {} });
    await expect(
      h.db.tx(async (tx) => {
        await outbox.emit(tx, { kind: 'evt', payload: { y: 1 } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow(/rollback/);
    const rows = await h.root`SELECT count(*)::int AS n FROM outbox WHERE payload->>'y' = '1'`;
    expect(rows[0]!.n).toBe(0);
  });
  it('jobs: per-job advisory lock skips concurrent runs; heartbeat rows record ok/error/duration', async () => {
    let running = 0;
    let maxConcurrent = 0;
    const runner = createJobRunner(h.db, clock, [
      {
        name: 'slow',
        intervalMs: 60_000,
        async run() {
          running++;
          maxConcurrent = Math.max(maxConcurrent, running);
          await new Promise((r) => setTimeout(r, 200));
          running--;
          return { did: 'work' };
        },
      },
      {
        name: 'boom',
        intervalMs: 60_000,
        async run() {
          throw new Error('kaput');
        },
      },
    ]);
    const other = createJobRunner(h.db, clock, [
      {
        name: 'slow',
        intervalMs: 60_000,
        async run() {
          running++;
          maxConcurrent = Math.max(maxConcurrent, running);
          await new Promise((r) => setTimeout(r, 200));
          running--;
          return null;
        },
      },
    ]);
    const [a, b] = await Promise.all([runner.runNow('slow'), other.runNow('slow')]);
    expect([a.ran, b.ran].filter(Boolean).length).toBe(1);
    expect(maxConcurrent).toBe(1);
    const failed = await runner.runNow('boom');
    expect(failed).toMatchObject({ ran: true, ok: false, error: 'kaput' });
    const rows =
      await h.root`SELECT name, ok, error, duration_ms IS NOT NULL AS timed FROM job_runs ORDER BY id`;
    expect(rows.find((r) => r.name === 'slow')).toMatchObject({ ok: true, timed: true });
    expect(rows.find((r) => r.name === 'boom')).toMatchObject({ ok: false, error: 'kaput' });
  });
  it('pg rate limiter: fixed windows survive across connections; sweep drops old windows', async () => {
    const l = createPgLimiter(h.db.sql, clock, { b: { limit: 2, windowMs: 60_000 } });
    expect((await l.hit('k', 'b')).allowed).toBe(true);
    expect((await l.hit('k', 'b')).allowed).toBe(true);
    expect((await l.hit('k', 'b')).allowed).toBe(false);
    clock.advance(60_000);
    expect((await l.hit('k', 'b')).allowed).toBe(true);
    clock.advance(3 * 60 * 60_000);
    expect(await l.sweep()).toBeGreaterThan(0);
  });
  it('mintGrant is idempotent by grantKey and a raw duplicate insert raises (never swallowed)', async () => {
    const key = `k-${randomUUID()}`;
    const a = await h.db.tx((tx) =>
      mintGrant(tx, {
        playerKey: 'mp',
        grantKey: key,
        source: 'admin',
        rewards: [{ kind: 'premium_currency', amount: 5 }],
        reason: 'r',
        actor: 'test',
        commandId: null,
      }),
    );
    const b = await h.db.tx((tx) =>
      mintGrant(tx, {
        playerKey: 'mp',
        grantKey: key,
        source: 'admin',
        rewards: [{ kind: 'premium_currency', amount: 99 }],
        reason: 'r',
        actor: 'test',
        commandId: null,
      }),
    );
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.grant.rewards).toEqual([{ kind: 'premium_currency', amount: 5 }]);
    await expect(
      h.db
        .sql`INSERT INTO grants (player_key, grant_key, source, rewards, reason, actor) VALUES ('mp', ${key}, 'admin', '[]', 'r', 't')`,
    ).rejects.toThrow(/duplicate key/);
    // client-claim budget caps premium
    const c = await h.db.tx((tx) =>
      mintGrant(tx, {
        playerKey: 'mp2',
        grantKey: 'c1',
        source: 'achievement',
        rewards: [{ kind: 'premium_currency', amount: 40 }],
        reason: 'r',
        actor: 'test',
        commandId: null,
        claimSourced: true,
        claimBudget: 50,
      }),
    );
    const d = await h.db.tx((tx) =>
      mintGrant(tx, {
        playerKey: 'mp2',
        grantKey: 'c2',
        source: 'achievement',
        rewards: [
          { kind: 'premium_currency', amount: 40 },
          { kind: 'cosmetic', cosmeticId: 'x' },
        ],
        reason: 'r',
        actor: 'test',
        commandId: null,
        claimSourced: true,
        claimBudget: 50,
      }),
    );
    expect(c.cappedBy).toBe(0);
    expect(d.cappedBy).toBe(30);
    expect(d.grant.rewards).toEqual([
      { kind: 'premium_currency', amount: 10 },
      { kind: 'cosmetic', cosmeticId: 'x' },
    ]);
  });
});
