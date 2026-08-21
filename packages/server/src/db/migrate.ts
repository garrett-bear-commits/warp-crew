// Migrator (§4.2): run as a deployment step with the migrator role; one tx per file; SHA-256
// checksums; pg_advisory_lock around the run; lock_timeout 3s; application boot checks applied
// rows against this image's files and refuses on pending known files, checksum mismatch, or an
// applied suffix outside the N-1 window (SCHEMA_COMPAT_AHEAD).
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

/** Leading `NNNN` of a migration file name. Null when the name is not `NNNN_*.sql`. */
export function migrationOrdinal(name: string): number | null {
  const m = /^(\d{4})_/.exec(name);
  return m ? Number(m[1]) : null;
}

/** Files whose numeric prefix is strictly less than `ordinal`. Used to build pre-N fixtures. */
export function migrationsBefore<T extends { name: string }>(
  files: readonly T[],
  ordinal: number,
): T[] {
  return files.filter((f) => {
    const n = migrationOrdinal(f.name);
    return n !== null && n < ordinal;
  });
}

/**
 * How many extra applied files a previous image may see and still boot. Two covers one
 * expand + validate pair shipped in a single release (N-1 image rollback). A third extra
 * file, a gap, or a non-next ordinal is incompatible.
 */
export const SCHEMA_COMPAT_AHEAD = 2;

export type SchemaState =
  'match' | 'pending' | 'mismatched' | 'ahead' | 'incompatible' | 'missing_table';

export interface SchemaCompatibility {
  state: Exclude<SchemaState, 'missing_table'>;
  ok: boolean;
  pending: string[];
  mismatched: string[];
  ahead: string[];
}

function isSupportedAhead(files: Array<{ name: string }>, ahead: string[]): boolean {
  if (ahead.length === 0 || ahead.length > SCHEMA_COMPAT_AHEAD) return false;
  const ordinals = files
    .map((f) => migrationOrdinal(f.name))
    .filter((n): n is number => n !== null);
  const last = ordinals.length === 0 ? 0 : Math.max(...ordinals);
  const extra = ahead.map(migrationOrdinal);
  if (extra.some((n) => n === null)) return false;
  const sorted = extra.filter((n): n is number => n !== null).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) if (sorted[i] !== last + i + 1) return false;
  return true;
}

/**
 * Boot compatibility of disk files vs applied rows. Pending known files and checksum
 * mismatches always refuse. A contiguous next-ordinal suffix of length ≤ SCHEMA_COMPAT_AHEAD
 * is the supported N-1 window (`ahead`, bootable). Anything else is `incompatible`.
 */
export function evaluateSchemaCompatibility(
  files: Array<{ name: string; checksum: string }>,
  applied: Array<{ name: string; checksum: string }>,
): SchemaCompatibility {
  const fileByName = new Map(files.map((f) => [f.name, f]));
  const appliedNames = new Set(applied.map((a) => a.name));
  const pending = files.filter((f) => !appliedNames.has(f.name)).map((f) => f.name);
  const mismatched = applied
    .filter((a) => {
      const f = fileByName.get(a.name);
      return f !== undefined && f.checksum !== a.checksum;
    })
    .map((a) => a.name);
  const ahead = applied.filter((a) => !fileByName.has(a.name)).map((a) => a.name);
  if (mismatched.length) return { state: 'mismatched', ok: false, pending, mismatched, ahead };
  if (pending.length) return { state: 'pending', ok: false, pending, mismatched, ahead };
  if (ahead.length === 0) return { state: 'match', ok: true, pending, mismatched, ahead };
  if (isSupportedAhead(files, ahead))
    return { state: 'ahead', ok: true, pending, mismatched, ahead };
  return { state: 'incompatible', ok: false, pending, mismatched, ahead };
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
  state: SchemaState;
  head: string | null;
  expectedHead: string;
  pending: string[];
  mismatched: string[];
  ahead: string[];
  missingTable: boolean;
}

/** Boot check: refuse on pending known files, checksum mismatch, or an unsupported applied suffix. */
export async function checkSchema(sql: Sql, dir = MIGRATIONS_DIR): Promise<SchemaStatus> {
  const files = listMigrations(dir);
  const expectedHead = schemaHead(files);
  const exists = await sql<
    { ok: boolean }[]
  >`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`;
  if (!exists[0]?.ok)
    return {
      ok: false,
      state: 'missing_table',
      head: null,
      expectedHead,
      pending: files.map((f) => f.name),
      mismatched: [],
      ahead: [],
      missingTable: true,
    };
  const rows = await sql<
    { name: string; checksum: string }[]
  >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
  const compat = evaluateSchemaCompatibility(files, rows);
  return {
    ok: compat.ok,
    state: compat.state,
    head: schemaHead(rows),
    expectedHead,
    pending: compat.pending,
    mismatched: compat.mismatched,
    ahead: compat.ahead,
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
      `col ${c.table_name}.${c.column_name} ${c.data_type} ${c.is_nullable} ${c.column_default ?? ''}`.trimEnd(),
    );
  for (const c of cons) lines.push(`con ${c.conrelid}.${c.conname} ${c.def}`);
  for (const i of idx) lines.push(`idx ${i.indexname} ${i.indexdef}`);
  for (const f of fns) lines.push(`fn ${f.proname} secdef=${f.prosecdef}`);
  for (const t of trg) lines.push(`trg ${t.tgrelid}.${t.tgname}`);
  return lines.join('\n') + '\n';
}
