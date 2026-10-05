import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, connect } from '@foundation/testkit/pg';
import {
  migrateUp,
  checkSchema,
  describeSchema,
  listMigrations,
  schemaHead,
  repairChecksums,
  migrationsBefore,
  n1CompatLine,
  exactHeadMatches,
} from '../../src/db/migrate.ts';
import { setupPg, type PgHarness } from './helpers.ts';
import { Outbox } from '../../src/outbox/index.ts';
import { fixedClock } from '../../src/clock/index.ts';
import { createJobRunner, type JobDef } from '../../src/jobs/index.ts';
import { createPgLimiter } from '../../src/limits/index.ts';
import { mintGrant } from '../../src/rewards/mint.ts';

function writeMigrationsDir(files: ReturnType<typeof listMigrations>): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundation-migrations-'));
  for (const migration of files) writeFileSync(join(dir, migration.name), migration.sql);
  return dir;
}

function priorMigrationsDir(beforeOrdinal = 15): string {
  return writeMigrationsDir(migrationsBefore(listMigrations(), beforeOrdinal));
}

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
        expect(st).toMatchObject({
          ok: true,
          state: 'match',
          pending: [],
          mismatched: [],
          ahead: [],
        });
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
        expect(d1).not.toMatch(/[\t ]+$/m);
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

  it('canonicalises legacy purchase grant keys without losing claims, references, or audit keys', async () => {
    const t = await createTestDatabase('legacy_purchase_grants');
    const priorDir = priorMigrationsDir();
    try {
      await migrateUp(t.url, { dir: priorDir });
      const sql = connect(t.url, { max: 1 });
      try {
        const providerToken = 'legacy-provider-token-'.repeat(14);
        const legacyKey = `purchase:${providerToken}`;
        const canonicalKey = `purchase:${createHash('sha256').update(providerToken).digest('hex')}`;
        const commandId = randomUUID();
        const grant = await sql<{ id: string }[]>`
          INSERT INTO grants
            (player_key, grant_key, source, rewards, premium_amount, reason, actor, command_id)
          VALUES
            ('legacy-buyer', ${legacyKey}, 'purchase', '[{"kind":"premium_currency","amount":100}]', 100, 'legacy purchase', 'player', ${commandId})
          RETURNING id`;
        await sql`
          INSERT INTO purchase_transactions
            (provider_token, player_key, sku, pack_key, base_amount, granted, price, currency,
             classification, created_at, completed_at, source, command_id, grant_key, sandbox)
          VALUES
            (${providerToken}, 'legacy-buyer', 'gems_100', 'handful', 100, 100, 4.99, 'USD',
             'paid', now(), now(), 'live_receipt', ${commandId}, ${legacyKey}, false)`;
        await sql`
          INSERT INTO grant_claims (grant_id, player_key, command_id)
          VALUES (${grant[0]!.id}, 'legacy-buyer', ${randomUUID()})`;
        await sql`
          INSERT INTO support_messages
            (player_key, title, body, grant_key, reason, actor, command_id)
          VALUES
            ('legacy-buyer', 'Purchase', 'Recovered', ${legacyKey}, 'legacy', 'support', ${randomUUID()})`;
        await sql`
          INSERT INTO announcements
            (announcement_id, title, body, starts_at, grant_key, actor, reason)
          VALUES ('legacy-purchase', 'Purchase', 'Recovered', now(), ${legacyKey}, 'support', 'legacy')`;
        await sql`
          INSERT INTO achievement_progress
            (player_key, achievement_id, content_version, unlocked, grant_key, progress)
          VALUES ('legacy-buyer', 'legacy-achievement', 1, true, ${legacyKey}, '{}')`;
        await sql`
          INSERT INTO achievement_unlocks
            (player_key, achievement_id, content_version, grant_key, command_id)
          VALUES ('legacy-buyer', 'legacy-achievement', 1, ${legacyKey}, ${randomUUID()})`;
        await sql`
          INSERT INTO daily_claims (player_key, day, ladder_day, grant_key, command_id)
          VALUES ('legacy-buyer', current_date, 1, ${legacyKey}, ${randomUUID()})`;
        await sql`
          INSERT INTO leaderboard_placements
            (receipt_id, board_key, season_key, player_key, rank, score, state, grant_key)
          VALUES ('legacy-placement', 'board', 'season', 'legacy-buyer', 1, 10, 'confirmed', ${legacyKey})`;
        await sql`
          INSERT INTO commands
            (scope_key, command_id, type, actor, request_hash, status, result, retention)
          VALUES
            ('legacy-buyer', ${randomUUID()}, 'purchases.verify', 'player', 'hash', 'done',
             ${sql.json({ purchase: { grantKey: legacyKey } })}, '90d')`;
        await sql`
          INSERT INTO outbox (kind, player_key, payload, command_id)
          VALUES ('purchase.recorded', 'legacy-buyer', ${sql.json({ grantKey: legacyKey })}, ${commandId})`;

        const migrated = await migrateUp(t.url);
        expect(migrated.applied).toEqual([
          '0015_legacy_purchase_grant_keys.sql',
          '0016_sandbox_purchase_grants.sql',
          '0017_players_first_build.sql',
          '0018_purchase_one_time_packs.sql',
        ]);
        const keys = await sql<
          { purchase_key: string; grant_key: string; grant_id: string; alias_key: string }[]
        >`
          SELECT p.grant_key AS purchase_key, g.grant_key, g.id AS grant_id, a.alias_key
          FROM purchase_transactions p
          JOIN grants g ON g.player_key = p.player_key AND g.grant_key = p.grant_key
          JOIN grant_key_aliases a ON a.grant_id = g.id
          WHERE p.provider_token = ${providerToken}`;
        expect(keys).toEqual([
          {
            purchase_key: canonicalKey,
            grant_key: canonicalKey,
            grant_id: grant[0]!.id,
            alias_key: legacyKey,
          },
        ]);
        const claim = await sql<{ grant_id: string }[]>`
          SELECT grant_id FROM grant_claims WHERE player_key = 'legacy-buyer'`;
        expect(claim).toEqual([{ grant_id: grant[0]!.id }]);
        const refs = await sql<
          {
            support: string;
            announcement: string;
            progress: string;
            unlock: string;
            daily: string;
            placement: string;
          }[]
        >`
          SELECT
            (SELECT grant_key FROM support_messages WHERE player_key = 'legacy-buyer') AS support,
            (SELECT grant_key FROM announcements WHERE announcement_id = 'legacy-purchase') AS announcement,
            (SELECT grant_key FROM achievement_progress WHERE player_key = 'legacy-buyer') AS progress,
            (SELECT grant_key FROM achievement_unlocks WHERE player_key = 'legacy-buyer') AS unlock,
            (SELECT grant_key FROM daily_claims WHERE player_key = 'legacy-buyer') AS daily,
            (SELECT grant_key FROM leaderboard_placements WHERE receipt_id = 'legacy-placement') AS placement`;
        expect(refs[0]).toEqual({
          support: canonicalKey,
          announcement: canonicalKey,
          progress: canonicalKey,
          unlock: canonicalKey,
          daily: canonicalKey,
          placement: canonicalKey,
        });
        const audit = await sql<{ command_key: string; outbox_key: string }[]>`
          SELECT
            (SELECT result #>> '{purchase,grantKey}' FROM commands WHERE request_hash = 'hash') AS command_key,
            (SELECT payload ->> 'grantKey' FROM outbox WHERE kind = 'purchase.recorded') AS outbox_key`;
        expect(audit).toEqual([{ command_key: legacyKey, outbox_key: legacyKey }]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      rmSync(priorDir, { recursive: true, force: true });
      await t.drop();
    }
  });

  it('aborts the legacy purchase grant migration atomically when historical keys disagree', async () => {
    const t = await createTestDatabase('invalid_legacy_purchase_grants');
    const priorDir = priorMigrationsDir();
    try {
      await migrateUp(t.url, { dir: priorDir });
      const sql = connect(t.url, { max: 1 });
      try {
        const providerToken = 'provider-token-'.repeat(20);
        const inconsistentKey = `purchase:${'different-token-'.repeat(20)}`;
        await sql`
          INSERT INTO grants (player_key, grant_key, source, rewards, reason, actor)
          VALUES ('invalid-legacy-buyer', ${inconsistentKey}, 'purchase', '[]', 'legacy', 'player')`;
        await sql`
          INSERT INTO purchase_transactions
            (provider_token, player_key, sku, base_amount, granted, classification, created_at,
             source, grant_key, sandbox)
          VALUES
            (${providerToken}, 'invalid-legacy-buyer', 'gems_100', 100, 0, 'unclassified',
             now(), 'live_receipt', ${inconsistentKey}, false)`;

        await expect(migrateUp(t.url)).rejects.toThrow(
          /long transaction key does not match provider token/,
        );
        const unchanged = await sql<{ grant_key: string; aliases: string | null }[]>`
          SELECT grant_key, to_regclass('public.grant_key_aliases')::text AS aliases
          FROM purchase_transactions WHERE provider_token = ${providerToken}`;
        expect(unchanged).toEqual([{ grant_key: inconsistentKey, aliases: null }]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      rmSync(priorDir, { recursive: true, force: true });
      await t.drop();
    }
  });

  it('aborts the legacy purchase grant migration on a canonical key collision', async () => {
    const t = await createTestDatabase('collision_legacy_purchase_grants');
    const priorDir = priorMigrationsDir();
    try {
      await migrateUp(t.url, { dir: priorDir });
      const sql = connect(t.url, { max: 1 });
      try {
        const providerToken = 'collision-provider-token-'.repeat(12);
        const legacyKey = `purchase:${providerToken}`;
        const canonicalKey = `purchase:${createHash('sha256').update(providerToken).digest('hex')}`;
        await sql`
          INSERT INTO grants (player_key, grant_key, source, rewards, reason, actor)
          VALUES ('collision-buyer', ${canonicalKey}, 'purchase', '[]', 'existing', 'player')`;
        await sql`
          INSERT INTO grants (player_key, grant_key, source, rewards, reason, actor)
          VALUES ('collision-buyer', ${legacyKey}, 'purchase', '[]', 'legacy', 'player')`;
        await sql`
          INSERT INTO purchase_transactions
            (provider_token, player_key, sku, base_amount, granted, classification, created_at,
             source, grant_key, sandbox)
          VALUES
            (${providerToken}, 'collision-buyer', 'gems_100', 100, 0, 'unclassified',
             now(), 'live_receipt', ${legacyKey}, false)`;

        await expect(migrateUp(t.url)).rejects.toThrow(/canonical grant key collision/);
        const unchanged = await sql<{ grant_key: string; aliases: string | null }[]>`
          SELECT grant_key, to_regclass('public.grant_key_aliases')::text AS aliases
          FROM purchase_transactions WHERE provider_token = ${providerToken}`;
        expect(unchanged).toEqual([{ grant_key: legacyKey, aliases: null }]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      rmSync(priorDir, { recursive: true, force: true });
      await t.drop();
    }
  });

  it('boot check: this image matches at 0018; a declared next extra is ahead here and exact-head-incompatible', async () => {
    const t = await createTestDatabase('schema_n1');
    const extraDir = writeMigrationsDir(listMigrations());
    writeFileSync(join(extraDir, '0019_n1_probe.sql'), `${n1CompatLine(18)}\nSELECT 1;\n`);
    try {
      await migrateUp(t.url);
      const sql = connect(t.url, { max: 1 });
      try {
        const atHead = await checkSchema(sql);
        expect(atHead).toMatchObject({ ok: true, state: 'match', pending: [], mismatched: [] });
        expect(
          exactHeadMatches(
            listMigrations().map((m) => ({ name: m.name, checksum: m.checksum })),
            await sql<
              { name: string; checksum: string }[]
            >`SELECT name, checksum FROM schema_migrations ORDER BY name`,
          ),
        ).toBe(true);

        await migrateUp(t.url, { dir: extraDir });
        const n1 = await checkSchema(sql);
        expect(n1.ok).toBe(true);
        expect(n1.state).toBe('ahead');
        expect(n1.ahead).toEqual(['0019_n1_probe.sql']);
        expect(
          exactHeadMatches(
            listMigrations().map((m) => ({ name: m.name, checksum: m.checksum })),
            await sql<
              { name: string; checksum: string }[]
            >`SELECT name, checksum FROM schema_migrations ORDER BY name`,
          ),
        ).toBe(false);

        await sql`UPDATE schema_migrations SET checksum = 'deadbeef' WHERE name LIKE '0003%'`;
        const bad = await checkSchema(sql);
        expect(bad.ok).toBe(false);
        expect(bad.state).toBe('mismatched');
        expect(bad.mismatched).toEqual(['0003_saves.sql']);
        await repairChecksums(t.url);
        const afterRepair = await checkSchema(sql);
        expect(afterRepair).toMatchObject({ ok: true, state: 'ahead' });

        writeFileSync(join(extraDir, '0019_n1_probe.sql'), `${n1CompatLine(17)}\nSELECT 1;\n`);
        await expect(repairChecksums(t.url, extraDir)).rejects.toThrow(/does not match stored/);
        expect(await checkSchema(sql)).toMatchObject({ ok: true, state: 'ahead' });

        writeFileSync(
          join(extraDir, '0019_n1_probe.sql'),
          `${n1CompatLine(18)}\nSELECT 1; -- repaired\n`,
        );
        await repairChecksums(t.url, extraDir);
        const afterExtraRepair = await checkSchema(sql);
        expect(afterExtraRepair).toMatchObject({
          ok: true,
          state: 'ahead',
          ahead: ['0019_n1_probe.sql'],
        });

        await sql`INSERT INTO schema_migrations (name, checksum) VALUES ('0020_ghost.sql', 'x')`;
        const over = await checkSchema(sql);
        expect(over.ok).toBe(false);
        expect(over.state).toBe('incompatible');
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      rmSync(extraDir, { recursive: true, force: true });
      await t.drop();
    }
  });

  it('--repair refuses an applied file that gained an n1 marker without a declaration', async () => {
    const t = await createTestDatabase('repair_n1_gain');
    const extraDir = writeMigrationsDir(listMigrations());
    writeFileSync(join(extraDir, '0019_gain.sql'), 'SELECT 1;\n');
    try {
      await migrateUp(t.url, { dir: extraDir });
      writeFileSync(join(extraDir, '0019_gain.sql'), `${n1CompatLine(18)}\nSELECT 1;\n`);
      await expect(repairChecksums(t.url, extraDir)).rejects.toThrow(/no schema_n1_compat row/);
    } finally {
      rmSync(extraDir, { recursive: true, force: true });
      await t.drop();
    }
  });

  it('migrateUp refuses a gapped disk ordinal chain before running SQL', async () => {
    const t = await createTestDatabase('mig_gap');
    const gapDir = writeMigrationsDir(listMigrations());
    try {
      await migrateUp(t.url, { dir: gapDir });
      writeFileSync(join(gapDir, '0020_gap.sql'), 'SELECT 1;\n');
      await expect(migrateUp(t.url, { dir: gapDir })).rejects.toThrow(/contiguous ordinal chain/);
      const sql = connect(t.url, { max: 1 });
      try {
        const extra = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM schema_migrations WHERE name = '0020_gap.sql'`;
        expect(extra[0]!.n).toBe(0);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      rmSync(gapDir, { recursive: true, force: true });
      await t.drop();
    }
  });

  it('the 0016 image still boots on a database migrated to 0017 (image rollback)', async () => {
    const t = await createTestDatabase('rollback_0017');
    const image0016 = priorMigrationsDir(17);
    const image0017 = priorMigrationsDir(18);
    try {
      await migrateUp(t.url, { dir: image0017 });
      const sql = connect(t.url, { max: 1 });
      try {
        expect(await checkSchema(sql, image0016)).toMatchObject({
          ok: true,
          state: 'ahead',
          ahead: ['0017_players_first_build.sql'],
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      rmSync(image0016, { recursive: true, force: true });
      rmSync(image0017, { recursive: true, force: true });
      await t.drop();
    }
  });

  it('the 0017 image still boots on a database migrated to 0018 (image rollback)', async () => {
    const t = await createTestDatabase('rollback_0018');
    const image0017 = priorMigrationsDir(18);
    try {
      await migrateUp(t.url);
      const sql = connect(t.url, { max: 1 });
      try {
        expect(await checkSchema(sql, image0017)).toMatchObject({
          ok: true,
          state: 'ahead',
          ahead: ['0018_purchase_one_time_packs.sql'],
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      rmSync(image0017, { recursive: true, force: true });
      await t.drop();
    }
  });

  it('migrateUp refuses applied rows that are not a prefix of disk files', async () => {
    const t = await createTestDatabase('mig_prefix');
    const priorDir = priorMigrationsDir(15);
    try {
      await migrateUp(t.url, { dir: priorDir });
      const sql = connect(t.url, { max: 1 });
      await sql`INSERT INTO schema_migrations (name, checksum) VALUES ('0015_wrong.sql', 'x')`;
      await sql.end({ timeout: 5 });
      await expect(migrateUp(t.url)).rejects.toThrow(/not a prefix/);
    } finally {
      rmSync(priorDir, { recursive: true, force: true });
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
  it('a first failure warns and a dead letter reports, each once and grouped per consumer', async () => {
    const reports: Array<{ context: unknown; fingerprint?: string[] }> = [];
    const outbox = new Outbox(h.db, clock, { maxAttempts: 2, backoffMs: () => 0 }, undefined, {
      captureException: (_e, context, o) =>
        void reports.push({ context, ...(o?.fingerprint ? { fingerprint: o.fingerprint } : {}) }),
    });
    outbox.register({
      name: 'doomed',
      kinds: ['doom'],
      async handle() {
        throw new Error('consumer down');
      },
    });
    const id = await h.db.tx((tx) => outbox.emit(tx, { kind: 'doom', payload: {} }));
    expect(await outbox.drain()).toMatchObject({ failed: 1, dead: 0 });
    const firstFailure = {
      context: { outboxId: id, kind: 'doom', consumer: 'doomed', attempts: 1 },
      fingerprint: ['outbox-retry', 'doomed'],
    };
    expect(reports).toEqual([firstFailure]);
    expect(await outbox.drain()).toMatchObject({ dead: 1 });
    expect(await outbox.drain()).toMatchObject({ dead: 0 });
    expect(reports).toEqual([
      firstFailure,
      {
        context: { outboxId: id, kind: 'doom', consumer: 'doomed', attempts: 2 },
        fingerprint: ['outbox-dead-letter', 'doomed'],
      },
    ]);
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
  it('jobs: scheduled jobs catch up on boot from job_runs (stale or never run), not from uptime', async () => {
    const H = 3_600_000;
    const id = randomUUID().slice(0, 8);
    const [stale, fresh, never] = [`stale-${id}`, `fresh-${id}`, `never-${id}`];
    const ran: string[] = [];
    const def = (name: string, intervalMs: number): JobDef => ({
      name,
      intervalMs,
      run: async () => void ran.push(name),
    });
    await h.root`INSERT INTO job_runs (name, started_at, finished_at, ok) VALUES
      (${stale}, ${new Date(clock.now() - 25 * H)}, ${new Date(clock.now() - 25 * H)}, true),
      (${fresh}, ${new Date(clock.now() - H)}, ${new Date(clock.now() - H)}, true)`;
    const runner = createJobRunner(h.db, clock, [
      def(stale, 24 * H),
      def(fresh, 24 * H),
      def(never, 7 * 24 * H),
    ]);
    runner.start();
    try {
      for (let i = 0; i < 100 && ran.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
      expect(ran.sort()).toEqual([never, stale].sort());
      expect(await runner.runDue(fresh)).toMatchObject({ ran: false, skipped: 'not_due' });
    } finally {
      runner.stop();
    }
    const rows = await h.root<
      { name: string; ok: boolean }[]
    >`SELECT name, ok FROM job_runs WHERE name = ANY(${[stale, fresh, never]}) AND started_at = ${new Date(clock.now())}`;
    expect(rows.map((r) => r.name).sort()).toEqual([never, stale].sort());
  });
  it('jobs: two replicas racing a due job run it once, and the loser sees the committed heartbeat', async () => {
    const name = `race-${randomUUID().slice(0, 8)}`;
    let runs = 0;
    const def = (): JobDef => ({
      name,
      intervalMs: 3_600_000,
      async run() {
        runs++;
        await new Promise((r) => setTimeout(r, 150));
      },
    });
    const a = createJobRunner(h.db, clock, [def()]);
    const b = createJobRunner(h.db, clock, [def()]);
    const [ra, rb] = await Promise.all([a.runDue(name), b.runDue(name)]);
    expect([ra.ran, rb.ran].filter(Boolean)).toEqual([true]);
    expect([ra, rb].find((r) => !r.ran)?.skipped).toBe('locked');
    // the next tick on either replica reads the winner's heartbeat under the lock
    expect(await b.runDue(name)).toMatchObject({ ran: false, skipped: 'not_due' });
    expect(await a.runDue(name)).toMatchObject({ ran: false, skipped: 'not_due' });
    clock.advance(3_600_000);
    expect((await b.runDue(name)).ran).toBe(true);
    expect(runs).toBe(2);
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
