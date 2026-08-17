// foundation deploy-static --dist <dir> --out <dir> --game <id> --env <env> --build <version>
//   [--now <ms>] [--verify]   (ADR-023 / §10)
import { resolve } from 'node:path';
import { deployStatic, readContractVersion, verifyRelease } from '../deploy.ts';
import { flag, opt, optInt, optMaybe, parseArgs, type Io } from '../args.ts';

export const usage =
  'deploy-static --dist <dir> --out <dir> --game <id> --env <prod|lab|dev> --build <version> [--now <epochMs>] [--contract-version <v>] [--verify]';

export async function run(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const out = resolve(opt(args, 'out'));
  if (flag(args, 'verify')) {
    const v = verifyRelease(out);
    io.log(`verify ${out}: release ${v.releaseId ?? '?'} ${v.ok ? 'OK' : 'FAILED'}`);
    for (const p of v.problems) io.log(`  ${p}`);
    return v.ok ? 0 : 1;
  }
  const dist = resolve(opt(args, 'dist'));
  const now = optInt(args, 'now');
  const takenAt = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
  const r = deployStatic({
    dist,
    out,
    game: opt(args, 'game'),
    env: opt(args, 'env'),
    buildVersion: opt(args, 'build'),
    contractVersion: optMaybe(args, 'contract-version') ?? readContractVersion(),
    takenAt,
  });
  io.log(
    `${r.reused ? 'reused' : 'wrote'} release ${r.manifest.releaseId} (${Object.keys(r.manifest.files).length} files) → ${r.releaseDir}`,
  );
  io.log(`index.html + manifest.json + headers.json swapped in ${out}`);
  if (r.previousReleases.length) io.log(`history kept under v/: ${r.previousReleases.join(', ')}`);
  return 0;
}
