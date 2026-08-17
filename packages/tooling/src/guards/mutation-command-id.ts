// §6: every mutation body carries commandId. Iterates the route registry (the contracts test does
// too; this guard makes it visible in CI output and independent of the vitest run).
import type { GuardResult } from './run-all.ts';
import { ROUTES, isMutation } from '@foundation/contracts/routes';

export function guardMutationCommandId(): GuardResult {
  const violations: string[] = [];
  let mutations = 0;
  for (const r of ROUTES) {
    if (!isMutation(r)) continue;
    mutations++;
    const body = r.body as unknown as
      { properties?: Record<string, unknown>; required?: string[] } | undefined;
    const ok =
      !!body?.properties &&
      'commandId' in body.properties &&
      (body.required ?? []).includes('commandId');
    if (!ok) violations.push(`${r.id} ${r.method} ${r.path}: body lacks required commandId`);
  }
  return {
    name: 'mutation-command-id (§6)',
    ok: violations.length === 0,
    violations,
    note: `${mutations} mutations checked`,
  };
}
