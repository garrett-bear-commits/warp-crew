import assert from 'node:assert/strict';
import { buildCombatBalanceMatrix, renderCombatBalanceMarkdown } from '../src/sim/contractBalance.js';

const now = Date.UTC(2026, 8, 22, 12);
const matrix = buildCombatBalanceMatrix({ now });
assert.equal(matrix.schemaVersion, 1);
assert.equal(matrix.generatedAt, now);
assert.equal(matrix.encounters.length, 16);
assert.deepEqual(matrix.ratios, [0.75, 1, 1.25, 1.5]);
assert.equal(matrix.rows.length, 16 * 4 * 3);
for (const row of matrix.rows) {
  assert.ok(['brace', 'burn', 'board'].includes(row.orderId));
  assert.equal(row.enabled, true);
  assert.ok(row.winChance >= 0.1 && row.winChance <= 0.94);
  assert.ok(Number.isFinite(row.effectivePower));
  assert.ok(Number.isFinite(row.rubberBandedEnemyPower));
  assert.ok(Number.isFinite(row.fuel));
  for (const key of ['successRewards', 'failureRewards', 'expectedRewards']) {
    assert.deepEqual(Object.keys(row[key]), ['credits', 'medals', 'reputation', 'gems', 'fuel']);
  }
}
assert.deepEqual(buildCombatBalanceMatrix({ now }), matrix);
const scoutEven = matrix.rows.filter(row => row.encounterId === 'pirate_scout' && row.ratio === 1);
assert.equal(scoutEven.length, 3);
assert.equal(scoutEven.find(row => row.orderId === 'burn').fuel, 1);
assert.ok(scoutEven.find(row => row.orderId === 'board').successRewards.credits > scoutEven.find(row => row.orderId === 'brace').successRewards.credits);

const dry = buildCombatBalanceMatrix({ now, fuel: 0 });
assert.equal(dry.rows.length, 192);
assert.equal(dry.rows.filter(row => !row.enabled).length, 64);
for (const row of dry.rows.filter(row => !row.enabled)) {
  assert.equal(row.orderId, 'burn');
  assert.equal(row.reason, 'not_enough_fuel');
  assert.equal(row.winChance, null);
  assert.equal(row.expectedRewards, null);
}
const markdown = renderCombatBalanceMarkdown(matrix);
assert.ok(markdown.includes('Pirate Scout'));
assert.ok(markdown.includes('Brace'));
assert.ok(markdown.includes('Burn'));
assert.ok(markdown.includes('Board'));
assert.ok(renderCombatBalanceMarkdown(dry).includes('Disabled'));
console.log('contract_balance.test.mjs OK');
