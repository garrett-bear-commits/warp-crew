// foundation manifest-check --manifest <file> --game <id> --env <env> [--schema-head <h>] [--contract-version <v>]
// foundation manifest-write --game <id> --env <env> --schema-head <h> --out <file> [--now <ms>] [--contract-version <v>]
// §8: restore/import validates the manifest against an EXPLICIT destination and refuses (exit 2) on mismatch.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { makeManifest, validateManifestAgainst } from '../manifest.ts';
import { readContractVersion } from '../deploy.ts';
import { opt, optInt, optMaybe, parseArgs, type Io } from '../args.ts';

export const usageCheck =
  'manifest-check --manifest <file> --game <id> --env <env> [--schema-head <h>] [--contract-version <v>]';
export const usageWrite =
  'manifest-write --game <id> --env <env> --schema-head <h> --out <file> [--now <epochMs>] [--contract-version <v>]';

export async function runCheck(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const file = resolve(opt(args, 'manifest'));
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    io.log(`manifest-check: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const schemaHead = optMaybe(args, 'schema-head');
  const contractVersion = optMaybe(args, 'contract-version') ?? readContractVersion();
  const v = validateManifestAgainst(parsed, {
    game: opt(args, 'game'),
    env: opt(args, 'env'),
    ...(schemaHead ? { schemaHead } : {}),
    contractVersion,
  });
  if (v.manifest)
    io.log(
      `manifest: game=${v.manifest.game} env=${v.manifest.env} takenAt=${v.manifest.takenAt} schemaHead=${v.manifest.schemaHead} contractVersion=${v.manifest.contractVersion}`,
    );
  for (const w of v.warnings) io.log(`warning: ${w}`);
  if (!v.ok) {
    for (const r of v.refusals) io.log(r);
    io.log('manifest-check: REFUSED (nothing was written)');
    return 2;
  }
  io.log(`manifest-check: OK for destination game=${opt(args, 'game')} env=${opt(args, 'env')}`);
  return 0;
}

export async function runWrite(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const out = resolve(opt(args, 'out'));
  const now = optInt(args, 'now');
  const m = makeManifest({
    game: opt(args, 'game'),
    env: opt(args, 'env'),
    schemaHead: opt(args, 'schema-head'),
    contractVersion: optMaybe(args, 'contract-version') ?? readContractVersion(),
    takenAt: now ?? Date.now(),
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
  io.log(`wrote ${out}`);
  return 0;
}
