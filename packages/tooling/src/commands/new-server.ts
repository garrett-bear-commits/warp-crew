// foundation new-server --game <id> [--dir apps/server/games]   (§10 scaffold games/<id>/)
import { resolve } from 'node:path';
import { displayPath, scaffoldGameServer } from '../scaffold.ts';
import { opt, optMaybe, parseArgs, type Io } from '../args.ts';

export const usage = 'new-server --game <id> [--dir <games dir>] [--template-dir <dir>]';

export async function run(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const dir = optMaybe(args, 'dir');
  const templateDir = optMaybe(args, 'template-dir');
  const r = scaffoldGameServer({
    gameId: opt(args, 'game'),
    ...(dir ? { gamesDir: resolve(dir) } : {}),
    ...(templateDir ? { templateDir: resolve(templateDir) } : {}),
  });
  io.log(`scaffolded ${displayPath(r.dir)}:`);
  for (const f of r.files) io.log(`  ${displayPath(f)}`);
  io.log('');
  io.log('Add to apps/server/src/games.ts (not automated on purpose — review the config first):');
  for (const l of r.importLines) io.log(`  ${l}`);
  io.log(`  GAMES map entry:`);
  io.log(`  ${r.registryLine}`);
  io.log('');
  for (const l of r.checklist) io.log(l);
  return 0;
}
