// Acceptance: no TODO/placeholder/skipped tests in shipped code. A conditional skip
// (`test.skip(cond, reason)`) is an environment gate, not a skipped test; unconditional
// forms (a title, `true`, no args, or the first argument on the next line) still fail.
import { relative } from 'node:path';
import { repoRoot, walk, read } from '../paths.ts';
import type { GuardResult } from './run-all.ts';

const CODE = /\.(ts|tsx|js|sql|md|html)$/;

export function guardNoPlaceholders(): GuardResult {
  const root = repoRoot();
  const violations: string[] = [];
  const files = walk(
    root,
    (p) =>
      CODE.test(p) &&
      !p.endsWith('/docs/architecture-v1.md') &&
      !p.endsWith('/docs/architecture-v1.formatted.md') &&
      !p.includes('/tooling/src/guards/'),
  );
  for (const f of files) {
    const rel = relative(root, f);
    const src = read(f);
    src.split('\n').forEach((line, i) => {
      if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line))
        violations.push(`${rel}:${i + 1} ${line.trim().slice(0, 80)}`);
      if (/\b(it|test|describe)\.(skip|todo)\(\s*(['"`)]|true\b|$)/.test(line))
        violations.push(`${rel}:${i + 1} skipped/todo test`);
      if (/\bxit\(|\bxdescribe\(/.test(line)) violations.push(`${rel}:${i + 1} skipped test`);
      if (/not implemented/i.test(line) && !/refuse|throws|error/i.test(line))
        violations.push(`${rel}:${i + 1} "not implemented" placeholder`);
    });
  }
  return {
    name: 'no-placeholders',
    ok: violations.length === 0,
    violations,
    note: `${files.length} files scanned`,
  };
}
