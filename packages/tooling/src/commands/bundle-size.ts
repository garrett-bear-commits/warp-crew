// foundation bundle-size --dist <dir> --max-bytes <n>   (also: bundle-size <dist> <n>)
import { resolve } from 'node:path';
import { checkBundleSize } from '../bundle-size.ts';
import { UsageError, optMaybe, parseArgs, type Io } from '../args.ts';

export const usage = 'bundle-size --dist <dir> --max-bytes <n>  (or positional: <dist> <n>)';

export async function run(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const dist = optMaybe(args, 'dist') ?? args.positionals[0];
  const maxRaw = optMaybe(args, 'max-bytes') ?? args.positionals[1];
  const max = Number(maxRaw);
  if (!dist || !Number.isFinite(max) || max <= 0) throw new UsageError(usage);
  const r = checkBundleSize(resolve(dist), max);
  for (const l of r.lines) io.log(l);
  return r.ok ? 0 : 1;
}
