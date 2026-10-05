// CI guards (§3 rules, ADR-003, ADR-009, ADR-013). Each guard returns a list of violations;
// the process exits non-zero if any guard fails. Run: `pnpm guards`.
import { guardSqlNoTenancy } from './sql-no-tenancy.ts';
import { guardBundlesBrowserSafe } from './bundle-browser-safe.ts';
import { guardMutationCommandId } from './mutation-command-id.ts';
import { guardFeatureShape } from './feature-shape.ts';
import { guardNoSecrets } from './no-secrets.ts';
import { guardNoPlaceholders } from './no-placeholders.ts';
import { repoRoot } from '../paths.ts';

export interface GuardResult {
  name: string;
  ok: boolean;
  violations: string[];
  note?: string;
}

const GUARDS: Array<() => GuardResult> = [
  guardMutationCommandId,
  guardSqlNoTenancy,
  guardBundlesBrowserSafe,
  guardFeatureShape,
  guardNoSecrets,
  guardNoPlaceholders,
];

let failed = false;
for (const g of GUARDS) {
  const r = g();
  const status = r.ok ? 'PASS' : 'FAIL';
  console.log(`[guard] ${status} ${r.name}${r.note ? ` — ${r.note}` : ''}`);
  for (const v of r.violations) console.log(`         ${v}`);
  if (!r.ok) failed = true;
}
console.log(`[guard] root=${repoRoot()}`);
process.exit(failed ? 1 : 0);
