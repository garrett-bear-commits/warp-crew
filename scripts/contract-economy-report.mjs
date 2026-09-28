// Siege damage resets at local midnight; pin the evidence to UTC so it is identical on every machine.
process.env.TZ = 'UTC';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runEconomySeedSet, renderEconomyMarkdown } from '../src/sim/contractEconomy.js';
import { buildCombatBalanceMatrix, renderCombatBalanceMarkdown } from '../src/sim/contractBalance.js';

const report = runEconomySeedSet();
const guidedRuns = [...report.guided.runs, ...report.guidedAwayFirst.runs];
if ([...report.runs, ...guidedRuns].some(run => !run.reconciliation.ok)) throw new Error('Economy ledger failed conservation');
const runtimeEvidence = await readFile('docs/qa/2026-09-22-encounter-runtime-evidence.md', 'utf8');
const outputs = [
  ['docs/qa/artifacts/contract-economy-30-day.json', JSON.stringify(report, null, 2) + '\n'],
  ['docs/qa/2026-09-22-encounter-balance-evidence.md', renderCombatBalanceMarkdown(buildCombatBalanceMatrix()) + '\n' + renderEconomyMarkdown(report) + '\n' + runtimeEvidence],
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
console.log(`${report.runs.length} baseline + ${guidedRuns.length} guided runs, 30 days each, all ledgers reconciled`);
