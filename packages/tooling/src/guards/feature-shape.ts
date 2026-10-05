// ADR-013: every feature folder has three entry points (contract / server / client) and the
// package exports map exposes exactly those. Cross-feature implementation imports are also
// checked here (belt) in addition to the ESLint rule (braces).
import { existsSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { repoRoot, walk, read } from '../paths.ts';
import type { GuardResult } from './run-all.ts';

export function guardFeatureShape(): GuardResult {
  const root = repoRoot();
  const featuresDir = resolve(root, 'packages/server/src/features');
  const violations: string[] = [];
  if (!existsSync(featuresDir))
    return {
      name: 'feature-shape (ADR-013)',
      ok: false,
      violations: ['packages/server/src/features missing'],
    };
  const features = readdirSync(featuresDir).filter((f) => !f.startsWith('.') && !f.endsWith('.ts'));
  for (const f of features) {
    for (const entry of ['contract.ts', 'server.ts', 'client.ts']) {
      if (!existsSync(resolve(featuresDir, f, entry)))
        violations.push(`feature ${f}: missing ${entry}`);
    }
    for (const file of walk(resolve(featuresDir, f), (p) => p.endsWith('.ts'))) {
      const src = read(file);
      const re =
        /from\s+['"](\.\.\/([^/.'"][^/'"]*)\/([^'"]+)|@foundation\/server\/features\/([^/'"]+)\/([^'"]+))['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const to = m[2] ?? m[4];
        const entry = (m[3] ?? m[5] ?? '').replace(/\.(ts|js)$/, '');
        if (!to || to === f) continue;
        if (entry !== 'contract')
          violations.push(
            `${relative(root, file)}: imports ${to}/${entry} (only contract allowed)`,
          );
      }
    }
    const client = read(resolve(featuresDir, f, 'client.ts'));
    if (
      /from\s+['"]node:/.test(client) ||
      /@sinclair\/typebox['"]/.test(client.replace(/import\s+type[^;]+;/g, ''))
    ) {
      violations.push(`feature ${f}: client.ts pulls node builtins or TypeBox runtime`);
    }
  }
  const pkg = JSON.parse(read(resolve(root, 'packages/server/package.json'))) as {
    exports: Record<string, string>;
  };
  for (const e of ['./features/*/contract', './features/*/server', './features/*/client']) {
    if (!pkg.exports[e]) violations.push(`packages/server exports map lacks ${e}`);
  }
  return {
    name: 'feature-shape (ADR-013)',
    ok: violations.length === 0,
    violations,
    note: `${features.length} features`,
  };
}
