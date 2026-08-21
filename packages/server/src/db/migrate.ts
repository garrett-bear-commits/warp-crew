// Migrator (§4.2): run as a deployment step with the migrator role; one tx per file; SHA-256
// checksums; pg_advisory_lock around the run; lock_timeout 3s; application boot checks applied
// rows against this image's files and refuses on pending known files, checksum mismatch, a broken
// ordinal chain, or extras that are not a declared N-1 chain in schema_n1_compat.
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

export type SchemaState =
  'match' | 'pending' | 'mismatched' | 'ahead' | 'incompatible' | 'missing_table';

export interface SchemaCompatibility {
  state: Exclude<SchemaState, 'missing_table'>;
  ok: boolean;
  pending: string[];
  mismatched: string[];
  ahead: string[];
}

export interface SchemaN1Declaration {
  extraName: string;
  prefixHead: string;
}

/** Marker line a migration includes so migrateUp records it in schema_n1_compat. */
export const N1_COMPAT_MARKER = '-- foundation-n1-compatible';

export function isN1CompatibleSql(sql: string): boolean {
  return sql.split(/\r?\n/).some((line) => line.trim() === N1_COMPAT_MARKER);
}

/** Unique ordinals that increase by exactly one. Duplicate or skipped NNNN prefixes fail. */
export function isUniqueContiguousChain(names: string[]): boolean {
  if (names.length === 0) return true;
  const parsed = names.map((name) => ({ name, n: migrationOrdinal(name) }));
  if (parsed.some((p) => p.n === null)) return false;
  const nums = parsed.map((p) => p.n as number);
  if (new Set(nums).size !== nums.length) return false;
  const sorted = [...parsed].sort(
    (a, b) => (a.n as number) - (b.n as number) || a.name.localeCompare(b.name),
  );
  for (let i = 1; i < sorted.length; i++)
    if ((sorted[i]!.n as number) !== (sorted[i - 1]!.n as number) + 1) return false;
  return true;
}

function declaredN1Chain(
  files: Array<{ name: string; checksum: string }>,
  applied: Array<{ name: string; checksum: string }>,
  declared: readonly SchemaN1Declaration[],
): boolean {
  const decl = new Map(declared.map((d) => [d.extraName, d.prefixHead]));
  const fileNames = new Set(files.map((f) => f.name));
  let running = applied.filter((a) => fileNames.has(a.name));
  const extras = applied.filter((a) => !fileNames.has(a.name));
  if (extras.length === 0) return false;
  for (const extra of extras) {
    if (decl.get(extra.name) !== schemaHead(running)) return false;
    running = [...running, extra];
  }
  return true;
}

/**
 * Boot compatibility of disk files vs applied rows. Pending known files and checksum
 * mismatches always refuse. `ahead` is bootable only when extras are a unique contiguous
 * chain recorded in schema_n1_compat with prefix_head equal to the running head. Skipped or
 * duplicate ordinals are incompatible even when names otherwise match.
 */
export function evaluateSchemaCompatibility(
  files: Array<{ name: string; checksum: string }>,
  applied: Array<{ name: string; checksum: string }>,
  declared: readonly SchemaN1Declaration[] = [],
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
  const refuse = (state: 'mismatched' | 'pending' | 'incompatible'): SchemaCompatibility => ({
    state,
    ok: false,
    pending,
    mismatched,
    ahead,
  });
  if (!isUniqueContiguousChain(files.map((f) => f.name))) return refuse('incompatible');
  if (mismatched.length) return refuse('mismatched');
  if (pending.length) return refuse('pending');
  if (!isUniqueContiguousChain(applied.map((a) => a.name))) return refuse('incompatible');
  if (ahead.length === 0) return { state: 'match', ok: true, pending, mismatched, ahead };
  if (declaredN1Chain(files, applied, declared))
    return { state: 'ahead', ok: true, pending, mismatched, ahead };
  return refuse('incompatible');
}

/** Isolated restore / DR: the restored copy must be this image's exact head, not merely bootable. */
export function schemaIsExactHead(st: { ok: boolean; state: SchemaState }): boolean {
  return st.ok && st.state === 'match';
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
      const appliedSoFar: Array<{ name: string; checksum: string }> = [...rows];
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
        const prefixHead = schemaHead(appliedSoFar);
        await sql.begin(async (tx) => {
          await tx.unsafe(f.sql);
          if (isN1CompatibleSql(f.sql))
            await tx`INSERT INTO schema_n1_compat (extra_name, prefix_head) VALUES (${f.name}, ${prefixHead})`;
          const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
          await tx`INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES (${f.name}, ${f.checksum}, ${ms})`;
        });
        appliedSoFar.push({ name: f.name, checksum: f.checksum });
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
  const declared = await loadN1Declarations(sql);
  const compat = evaluateSchemaCompatibility(files, rows, declared);
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

async function loadN1Declarations(sql: Sql): Promise<SchemaN1Declaration[]> {
  const exists = await sql<
    { ok: boolean }[]
  >`SELECT to_regclass('public.schema_n1_compat') IS NOT NULL AS ok`;
  if (!exists[0]?.ok) return [];
  const rows = await sql<
    { extra_name: string; prefix_head: string }[]
  >`SELECT extra_name, prefix_head FROM schema_n1_compat`;
  return rows.map((r) => ({ extraName: r.extra_name, prefixHead: r.prefix_head }));
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
