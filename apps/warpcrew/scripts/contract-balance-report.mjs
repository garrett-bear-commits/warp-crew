import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildCombatBalanceMatrix } from '../src/sim/contractBalance.js';

// The evidence page (docs/qa/2026-09-22-encounter-balance-evidence.md) shows this matrix too; it is written by
// contract-economy-report.mjs, which already runs the 30-day seed set the page needs. Running that set here as
// well doubled test:balance's longest step.
const matrix = buildCombatBalanceMatrix();
const outputs = [
  ['docs/qa/artifacts/encounter-balance-matrix.json', JSON.stringify(matrix, null, 2) + '\n'],
];

for (const [path, content] of outputs) {
  await mkdir(dirname(path), { recursive: true });
  const previous = await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous !== content) await writeFile(path, content);
  console.log(`${previous === content ? 'unchanged' : 'wrote'} ${path}`);
}
console.log(`${matrix.encounters.length} encounters, ${matrix.rows.length} rows, ${matrix.rows.filter(row => !row.enabled).length} disabled`);
