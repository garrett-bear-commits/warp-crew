// Usage: node --experimental-strip-types scripts/openapi-diff.ts [--against <git-ref>]
// Without --against, uses the last released tag (`git describe --tags --abbrev=0`); when no tag
// exists it exits 0 with an explicit "no released tag" line — the check is unavailable, not passed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { diffOpenApi } from '../src/openapi-diff.ts';

const here = dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--against');
let ref = i >= 0 ? process.argv[i + 1] : undefined;
if (!ref) {
  try {
    ref = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { encoding: 'utf8' }).trim();
  } catch {
    console.log(
      'openapi-diff: no released tag exists yet — nothing to diff against (unavailable, not passed)',
    );
    process.exit(0);
  }
}
const oldRaw = execFileSync('git', ['show', `${ref}:packages/contracts/openapi.json`], {
  encoding: 'utf8',
});
const oldDoc = JSON.parse(oldRaw) as Record<string, unknown>;
const newDoc = JSON.parse(readFileSync(resolve(here, '..', 'openapi.json'), 'utf8')) as Record<
  string,
  unknown
>;
const breaking = diffOpenApi(oldDoc, newDoc);
if (breaking.length) {
  console.error(`openapi-diff: ${breaking.length} breaking change(s) vs ${ref}:`);
  for (const b of breaking) console.error(`  ${b.kind} ${b.where}: ${b.detail}`);
  process.exit(1);
}
console.log(`openapi-diff: no breaking changes vs ${ref}`);
