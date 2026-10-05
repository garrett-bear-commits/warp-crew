// foundation new-feature --name <name>   (ADR-013 three entry points; satisfies the feature-shape guard)
import { resolve } from 'node:path';
import { displayPath, scaffoldFeature } from '../scaffold.ts';
import { opt, optMaybe, parseArgs, type Io } from '../args.ts';

export const usage = 'new-feature --name <name> [--dir <features dir>]';

export async function run(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const dir = optMaybe(args, 'dir');
  const r = scaffoldFeature({
    name: opt(args, 'name'),
    ...(dir ? { featuresDir: resolve(dir) } : {}),
  });
  io.log(`scaffolded ${displayPath(r.dir)}:`);
  for (const f of r.files) io.log(`  ${displayPath(f)}`);
  io.log('');
  io.log('Composition root (packages/server/src/server.ts) — add:');
  for (const l of r.compositionLines) io.log(`  ${l}`);
  io.log(
    'Then: declare commands (defineCommand), routes (route()), and re-export types from contract.ts.',
  );
  return 0;
}
