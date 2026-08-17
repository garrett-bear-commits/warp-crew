// foundation preflight --env-file <path>   (mirrors packages/server/src/config.ts refusals)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatChecklist, parseEnvFile, preflightEnv } from '../preflight.ts';
import { opt, parseArgs, type Io } from '../args.ts';

export const usage = 'preflight --env-file <path>';

export async function run(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const file = resolve(opt(args, 'env-file'));
  const env = parseEnvFile(readFileSync(file, 'utf8'));
  const r = preflightEnv(env);
  io.log(`preflight ${file}`);
  for (const l of formatChecklist(r)) io.log(l);
  return r.ok ? 0 : 1;
}
