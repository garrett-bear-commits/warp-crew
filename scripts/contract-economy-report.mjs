import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runEconomySeedSet, renderEconomyMarkdown } from '../src/sim/contractEconomy.js';
import { buildCombatBalanceMatrix, renderCombatBalanceMarkdown } from '../src/sim/contractBalance.js';

const report = runEconomySeedSet();
if (report.runs.some(run => !run.reconciliation.ok)) throw new Error('Economy ledger failed conservation');
const outputs = [
  ['docs/qa/artifacts/contract-economy-30-day.json', JSON.stringify(report, null, 2) + '\n'],
  ['docs/qa/2026-09-22-encounter-balance-evidence.md', renderCombatBalanceMarkdown(buildCombatBalanceMatrix()) + '\n' + renderEconomyMarkdown(report)],
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
console.log(`${report.runs.length} runs, 30 days each, all ledgers reconciled`);
