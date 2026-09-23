import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildCombatBalanceMatrix, renderCombatBalanceMarkdown } from '../src/sim/contractBalance.js';
import { runEconomySeedSet, renderEconomyMarkdown } from '../src/sim/contractEconomy.js';

const matrix = buildCombatBalanceMatrix();
const runtimeEvidence = await readFile('docs/qa/2026-09-22-encounter-runtime-evidence.md', 'utf8');
const outputs = [
  ['docs/qa/artifacts/encounter-balance-matrix.json', JSON.stringify(matrix, null, 2) + '\n'],
  ['docs/qa/2026-09-22-encounter-balance-evidence.md', renderCombatBalanceMarkdown(matrix) + '\n' + renderEconomyMarkdown(runEconomySeedSet()) + '\n' + runtimeEvidence],
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
