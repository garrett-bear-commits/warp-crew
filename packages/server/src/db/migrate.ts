// Migrator (§4.2): run as a deployment step with the migrator role; one tx per file; SHA-256
// checksums; pg_advisory_lock around the run; lock_timeout 3s; application boot only checks
// schema head + checksums and refuses to serve on mismatch or pending files.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { sha256Hex } from './canonical.ts';
import { MIGRATIONS_DIR } from './migrations/index.ts';

export interface MigrationFile {
  name: string;
  checksum: string;
  sql: string;
}

export function listMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(resolve(dir, name), 'utf8');
      return { name, checksum: sha256Hex(sql), sql };
    });
}

/** Schema head = sha256 over "name:checksum" lines of all applied migrations. */
export function schemaHead(files: Array<{ name: string; checksum: string }>): string {
  return sha256Hex(files.map((f) => `${f.name}:${f.checksum}`).join('\n'));
}

async function ensureTable(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms INTEGER
  )`;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  head: string;
}

/** Apply pending migrations. Throws on checksum mismatch of an already-applied file. */
export async function migrateUp(
  url: string,
  opts: { dir?: string; log?: (m: string) => void; lockTimeoutMs?: number } = {},
): Promise<MigrateResult> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const log = opts.log ?? (() => {});
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await sql.unsafe(`SET lock_timeout = '${opts.lockTimeoutMs ?? 3000}ms'`);
    await sql`SELECT pg_advisory_lock(4, 1)`;
    try {
      await ensureTable(sql);
      const files = listMigrations(opts.dir);
      const rows = await sql<
        { name: string; checksum: string }[]
      >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
      const done = new Map(rows.map((r) => [r.name, r.checksum]));
      // applied rows must be a prefix of files, with matching checksums
      for (const r of rows) {
        const f = files.find((x) => x.name === r.name);
        if (!f) throw new Error(`migration ${r.name} is applied but missing on disk`);
        if (f.checksum !== r.checksum)
          throw new Error(
            `checksum mismatch for ${r.name} (applied ${r.checksum.slice(0, 12)}, disk ${f.checksum.slice(0, 12)}); see --repair in docs/runbooks/migrations.md`,
          );
      }
      for (const f of files) {
        if (done.has(f.name)) {
          skipped.push(f.name);
          continue;
        }
        const t0 = process.hrtime.bigint();
        await sql.begin(async (tx) => {
          await tx.unsafe(f.sql);
          const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
          await tx`INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES (${f.name}, ${f.checksum}, ${ms})`;
        });
        applied.push(f.name);
        log(`applied ${f.name}`);
      }
      // the app role reads schema_migrations at boot (head + checksum check)
      await sql`GRANT SELECT ON schema_migrations TO foundation_app`;
      const all = await sql<
        { name: string; checksum: string }[]
      >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
      return { applied, skipped, head: schemaHead(all) };
    } finally {
      await sql`SELECT pg_advisory_unlock(4, 1)`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface SchemaStatus {
  ok: boolean;
  head: string | null;
  expectedHead: string;
  pending: string[];
  mismatched: string[];
  missingTable: boolean;
}

/** Boot check: schema head + checksums; refuse to serve on mismatch or pending files. */
export async function checkSchema(sql: Sql, dir = MIGRATIONS_DIR): Promise<SchemaStatus> {
  const files = listMigrations(dir);
  const expectedHead = schemaHead(files);
  const exists = await sql<
    { ok: boolean }[]
  >`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`;
  if (!exists[0]?.ok)
    return {
      ok: false,
      head: null,
      expectedHead,
      pending: files.map((f) => f.name),
      mismatched: [],
      missingTable: true,
    };
  const rows = await sql<
    { name: string; checksum: string }[]
  >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
  const done = new Map(rows.map((r) => [r.name, r.checksum]));
  const pending = files.filter((f) => !done.has(f.name)).map((f) => f.name);
  const mismatched = files
    .filter((f) => done.has(f.name) && done.get(f.name) !== f.checksum)
    .map((f) => f.name);
  const head = schemaHead(rows);
  return {
    ok: pending.length === 0 && mismatched.length === 0 && head === expectedHead,
    head,
    expectedHead,
    pending,
    mismatched,
    missingTable: false,
  };
}

/** --repair: re-record checksums for applied migrations whose file changed (documented, ops-only). */
export async function repairChecksums(url: string, dir = MIGRATIONS_DIR): Promise<string[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await ensureTable(sql);
    const files = listMigrations(dir);
    const rows = await sql<
      { name: string; checksum: string }[]
    >`SELECT name, checksum FROM schema_migrations`;
    const repaired: string[] = [];
    for (const r of rows) {
      const f = files.find((x) => x.name === r.name);
      if (f && f.checksum !== r.checksum) {
        await sql`UPDATE schema_migrations SET checksum = ${f.checksum} WHERE name = ${r.name}`;
        repaired.push(r.name);
      }
    }
    return repaired;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Dump a normalised description of the schema (tables, columns, constraints, indexes, functions) for --check. */
export async function describeSchema(sql: Sql): Promise<string> {
  const cols = await sql<
    {
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }[]
  >`
    SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY table_name, ordinal_position`;
  const cons = await sql<{ conrelid: string; conname: string; def: string }[]>`
    SELECT conrelid::regclass::text AS conrelid, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`;
  const idx = await sql<
    { indexname: string; indexdef: string }[]
  >`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`;
  const fns = await sql<
    { proname: string; prosecdef: boolean }[]
  >`SELECT proname, prosecdef FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname`;
  const trg = await sql<
    { tgname: string; tgrelid: string }[]
  >`SELECT tgname, tgrelid::regclass::text AS tgrelid FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgrelid::regclass::text, tgname`;
  const lines: string[] = [];
  for (const c of cols)
    lines.push(
      `col ${c.table_name}.${c.column_name} ${c.data_type} ${c.is_nullable} ${c.column_default ?? ''}`,
    );
  for (const c of cons) lines.push(`con ${c.conrelid}.${c.conname} ${c.def}`);
  for (const i of idx) lines.push(`idx ${i.indexname} ${i.indexdef}`);
  for (const f of fns) lines.push(`fn ${f.proname} secdef=${f.prosecdef}`);
  for (const t of trg) lines.push(`trg ${t.tgrelid}.${t.tgname}`);
  return lines.join('\n') + '\n';
}
