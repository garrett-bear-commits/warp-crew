// ADR-003: no game_id on any row/key/index/query, no tenancy, no RLS, no foundation_instance.
import { relative } from 'node:path';
import { repoRoot, walk, read } from '../paths.ts';
import type { GuardResult } from './run-all.ts';

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bgame_id\b/i, 'game_id column/reference'],
  [/\btenant(s|_id)?\b/i, 'tenant / tenant_id'],
  [/\bfoundation_instance\b/i, 'foundation_instance'],
  [/ROW\s+LEVEL\s+SECURITY/i, 'row level security'],
  [/\bCREATE\s+POLICY\b/i, 'RLS policy'],
];

export function guardSqlNoTenancy(): GuardResult {
  const root = repoRoot();
  const files = walk(
    root,
    (p) =>
      /\.(sql|ts|js)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.includes('/tooling/src/guards/'),
  );
  const violations: string[] = [];
  for (const f of files) {
    const src = read(f);
    // Only inspect SQL: .sql files entirely, and SQL-ish template literals in TS (heuristic: lines containing SQL keywords).
    const isSql = f.endsWith('.sql');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (
        !isSql &&
        !/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WHERE|FROM|TABLE|INDEX)\b/.test(line)
      )
        return;
      for (const [re, what] of FORBIDDEN) {
        if (re.test(line))
          violations.push(`${relative(root, f)}:${i + 1} ${what}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  return {
    name: 'sql-no-tenancy (ADR-003)',
    ok: violations.length === 0,
    violations,
    note: `${files.length} files scanned`,
  };
}
