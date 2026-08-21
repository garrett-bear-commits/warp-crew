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
  extraChecksum: string;
  prefixHead: string;
  resultHead: string;
  /** Image expectedHead that may boot with this extra. Not a chain: N-2 extras do not qualify. */
  compatibleWithHead: string;
  /** Last ordinal of that image; durable, not inferred from a migrateUp batch. */
  compatibleWithOrdinal: number;
}

/** `-- foundation-n1-compatible-with-ordinal: 15` */
export function n1CompatLine(ordinal: number): string {
  return `-- foundation-n1-compatible-with-ordinal: ${ordinal}`;
}

export function n1MarkerOrdinals(sql: string): number[] {
  const out: number[] = [];
  for (const line of sql.split(/\r?\n/)) {
    const m = /^-- foundation-n1-compatible-with-ordinal:\s*(\d+)\s*$/.exec(line.trim());
    if (m) out.push(Number(m[1]));
  }
  return out;
}

export function n1CompatibleWithOrdinal(sql: string): number | null {
  const marks = n1MarkerOrdinals(sql);
  if (marks.length === 0) return null;
  if (marks.length > 1)
    throw new Error(
      `expected exactly one foundation-n1-compatible-with-ordinal marker, found ${marks.length}`,
    );
  return marks[0]!;
}

export function isN1CompatibleSql(sql: string): boolean {
  return n1MarkerOrdinals(sql).length === 1;
}

/** On-disk extra SQL must still declare exactly the stored parent ordinal. */
export function requireMatchingN1Marker(sql: string, storedOrdinal: number): void {
  const marks = n1MarkerOrdinals(sql);
  if (marks.length !== 1)
    throw new Error(
      `expected exactly one foundation-n1-compatible-with-ordinal marker, found ${marks.length}`,
    );
  if (marks[0] !== storedOrdinal)
    throw new Error(
      `n1 marker ordinal ${marks[0]} does not match stored compatible_with_ordinal ${storedOrdinal}`,
    );
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

/**
 * c94bf5d boot rule: applied set equals disk files and heads match. A parent image with this
 * checker cannot consume extras; N-1 extras require a prior release that already shipped this
 * file's evaluateSchemaCompatibility.
 */
export function exactHeadMatches(
  files: Array<{ name: string; checksum: string }>,
  applied: Array<{ name: string; checksum: string }>,
): boolean {
  return (
    files.length === applied.length &&
    files.every((f, i) => f.name === applied[i]?.name && f.checksum === applied[i]?.checksum) &&
    schemaHead(files) === schemaHead(applied)
  );
}

/** Applied rows must be files[0..applied.length) in order, checksums included. */
export function appliedIsDiskPrefix(
  files: Array<{ name: string; checksum: string }>,
  applied: Array<{ name: string; checksum: string }>,
): { ok: true } | { ok: false; reason: string } {
  for (let i = 0; i < applied.length; i++) {
    const f = files[i];
    const a = applied[i]!;
    if (!f) return { ok: false, reason: `migration ${a.name} is applied but missing on disk` };
    if (f.name !== a.name)
      return {
        ok: false,
        reason: `applied rows are not a prefix of disk files (expected ${f.name}, found ${a.name})`,
      };
    if (f.checksum !== a.checksum)
      return {
        ok: false,
        reason: `checksum mismatch for ${a.name} (applied ${a.checksum.slice(0, 12)}, disk ${f.checksum.slice(0, 12)}); see --repair in docs/runbooks/migrations.md`,
      };
  }
  return { ok: true };
}

/** Build a declaration from applied rows (extra included) and an explicit parent-image ordinal. */
export function n1DeclarationFromApplied(
  extraName: string,
  applied: Array<{ name: string; checksum: string }>,
  compatibleWithOrdinal: number,
): SchemaN1Declaration {
  const idx = applied.findIndex((r) => r.name === extraName);
  if (idx < 0) throw new Error(`n1 extra ${extraName} is not in applied rows`);
  const extraOrd = migrationOrdinal(extraName);
  if (extraOrd === null || extraOrd <= compatibleWithOrdinal)
    throw new Error(
      `n1 extra ${extraName} must come after compatible-with-ordinal ${compatibleWithOrdinal}`,
    );
  const parent = applied.filter((r) => {
    const n = migrationOrdinal(r.name);
    return n !== null && n <= compatibleWithOrdinal;
  });
  const parentLast = parent.length ? migrationOrdinal(parent[parent.length - 1]!.name) : null;
  if (parentLast !== compatibleWithOrdinal)
    throw new Error(`n1 parent ordinal ${compatibleWithOrdinal} is not applied`);
  const prefix = applied.slice(0, idx);
  const result = applied.slice(0, idx + 1);
  return {
    extraName,
    extraChecksum: applied[idx]!.checksum,
    prefixHead: schemaHead(prefix),
    resultHead: schemaHead(result),
    compatibleWithHead: schemaHead(parent),
    compatibleWithOrdinal,
  };
}

function imageHeadOrdinal(files: Array<{ name: string }>): number | null {
  if (files.length === 0) return null;
  return migrationOrdinal(files[files.length - 1]!.name);
}

function declaredN1ForImage(
  files: Array<{ name: string; checksum: string }>,
  applied: Array<{ name: string; checksum: string }>,
  declared: readonly SchemaN1Declaration[],
): boolean {
  const decl = new Map(declared.map((d) => [d.extraName, d]));
  const fileNames = new Set(files.map((f) => f.name));
  const expectedHead = schemaHead(files);
  const headOrdinal = imageHeadOrdinal(files);
  if (headOrdinal === null) return false;
  let running = applied.filter((a) => fileNames.has(a.name));
  const extras = applied.filter((a) => !fileNames.has(a.name));
  if (extras.length === 0) return false;
  for (const extra of extras) {
    const d = decl.get(extra.name);
    if (!d) return false;
    if (d.extraChecksum !== extra.checksum) return false;
    if (d.compatibleWithOrdinal !== headOrdinal) return false;
    if (d.compatibleWithHead !== expectedHead) return false;
    if (d.prefixHead !== schemaHead(running)) return false;
    running = [...running, extra];
    if (d.resultHead !== schemaHead(running)) return false;
  }
  return true;
}

/**
 * Boot compatibility of disk files vs applied rows. Pending known files and checksum
 * mismatches always refuse. `ahead` is bootable only when every extra is declared for this
 * image's expectedHead (not a parent of a parent), extra checksums match, and ordinals are a
 * unique contiguous chain.
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
  if (declaredN1ForImage(files, applied, declared))
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
  await sql`CREATE TABLE IF NOT EXISTS schema_n1_compat (
    extra_name TEXT PRIMARY KEY,
    extra_checksum TEXT NOT NULL,
    prefix_head TEXT NOT NULL,
    result_head TEXT NOT NULL,
    compatible_with_head TEXT NOT NULL,
    compatible_with_ordinal INTEGER NOT NULL
  )`;
  await sql`ALTER TABLE schema_n1_compat ADD COLUMN IF NOT EXISTS compatible_with_ordinal INTEGER`;
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
      const prefix = appliedIsDiskPrefix(files, rows);
      if (!prefix.ok) throw new Error(prefix.reason);
      if (!isUniqueContiguousChain(files.map((f) => f.name)))
        throw new Error('disk migration files are not a unique contiguous ordinal chain');
      if (!isUniqueContiguousChain(rows.map((r) => r.name)))
        throw new Error('applied migrations are not a unique contiguous ordinal chain');
      let preview = [...appliedSoFar];
      for (const f of files) {
        if (done.has(f.name)) continue;
        preview = [...preview, { name: f.name, checksum: f.checksum }];
        const parentOrdinal = n1CompatibleWithOrdinal(f.sql);
        if (parentOrdinal !== null) n1DeclarationFromApplied(f.name, preview, parentOrdinal);
      }
      for (const f of files) {
        if (done.has(f.name)) {
          skipped.push(f.name);
          continue;
        }
        const t0 = process.hrtime.bigint();
        const parentOrdinal = n1CompatibleWithOrdinal(f.sql);
        const nextApplied = [...appliedSoFar, { name: f.name, checksum: f.checksum }];
        const n1 =
          parentOrdinal !== null
            ? n1DeclarationFromApplied(f.name, nextApplied, parentOrdinal)
            : null;
        await sql.begin(async (tx) => {
          await tx.unsafe(f.sql);
          if (n1)
            await tx`INSERT INTO schema_n1_compat
              (extra_name, extra_checksum, prefix_head, result_head, compatible_with_head, compatible_with_ordinal)
              VALUES (${n1.extraName}, ${n1.extraChecksum}, ${n1.prefixHead}, ${n1.resultHead}, ${n1.compatibleWithHead}, ${n1.compatibleWithOrdinal})`;
          const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
          await tx`INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES (${f.name}, ${f.checksum}, ${ms})`;
        });
        appliedSoFar.push({ name: f.name, checksum: f.checksum });
        applied.push(f.name);
        log(`applied ${f.name}`);
      }
      // the app role reads schema_migrations + n1 declarations at boot
      await sql`GRANT SELECT ON schema_migrations TO foundation_app`;
      await sql`GRANT SELECT ON schema_n1_compat TO foundation_app`;
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
    {
      extra_name: string;
      extra_checksum: string;
      prefix_head: string;
      result_head: string;
      compatible_with_head: string;
      compatible_with_ordinal: number;
    }[]
  >`SELECT extra_name, extra_checksum, prefix_head, result_head, compatible_with_head, compatible_with_ordinal FROM schema_n1_compat`;
  return rows.map((r) => ({
    extraName: r.extra_name,
    extraChecksum: r.extra_checksum,
    prefixHead: r.prefix_head,
    resultHead: r.result_head,
    compatibleWithHead: r.compatible_with_head,
    compatibleWithOrdinal: Number(r.compatible_with_ordinal),
  }));
}

async function refreshN1Declarations(sql: Sql, files: MigrationFile[]): Promise<void> {
  const exists = await sql<
    { ok: boolean }[]
  >`SELECT to_regclass('public.schema_n1_compat') IS NOT NULL AS ok`;
  if (!exists[0]?.ok) return;
  const applied = await sql<
    { name: string; checksum: string }[]
  >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
  const decls = await sql<
    { extra_name: string; compatible_with_ordinal: number | null }[]
  >`SELECT extra_name, compatible_with_ordinal FROM schema_n1_compat`;
  const byName = new Map(files.map((f) => [f.name, f]));
  for (const d of decls) {
    if (d.compatible_with_ordinal == null)
      throw new Error(
        `schema_n1_compat ${d.extra_name} has no compatible_with_ordinal; refuse --repair`,
      );
    const stored = Number(d.compatible_with_ordinal);
    const onDisk = byName.get(d.extra_name);
    if (onDisk) requireMatchingN1Marker(onDisk.sql, stored);
    const rec = n1DeclarationFromApplied(d.extra_name, applied, stored);
    await sql`UPDATE schema_n1_compat SET
      extra_checksum = ${rec.extraChecksum},
      prefix_head = ${rec.prefixHead},
      result_head = ${rec.resultHead},
      compatible_with_head = ${rec.compatibleWithHead}
      WHERE extra_name = ${rec.extraName}`;
  }
}

/** --repair: re-record checksums for applied migrations whose file changed (documented, ops-only). */
export async function repairChecksums(url: string, dir = MIGRATIONS_DIR): Promise<string[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`SELECT pg_advisory_lock(4, 1)`;
    try {
      await ensureTable(sql);
      await sql.unsafe('BEGIN');
      try {
        const files = listMigrations(dir);
        const rows = await sql<
          { name: string; checksum: string }[]
        >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
        const repaired: string[] = [];
        for (const r of rows) {
          const f = files.find((x) => x.name === r.name);
          if (f && f.checksum !== r.checksum) {
            await sql`UPDATE schema_migrations SET checksum = ${f.checksum} WHERE name = ${r.name}`;
            repaired.push(r.name);
          }
        }
        await refreshN1Declarations(sql, files);
        await sql.unsafe('COMMIT');
        return repaired;
      } catch (err) {
        await sql.unsafe('ROLLBACK');
        throw err;
      }
    } finally {
      await sql`SELECT pg_advisory_unlock(4, 1)`;
    }
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
    WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
      AND table_name <> 'schema_n1_compat'
    ORDER BY table_name, ordinal_position`;
  const cons = await sql<{ conrelid: string; conname: string; def: string }[]>`
    SELECT conrelid::regclass::text AS conrelid, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND conrelid::regclass::text <> 'schema_n1_compat'
    ORDER BY 1, 2`;
  const idx = await sql<
    { indexname: string; indexdef: string }[]
  >`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
      AND tablename <> 'schema_n1_compat' ORDER BY indexname`;
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
