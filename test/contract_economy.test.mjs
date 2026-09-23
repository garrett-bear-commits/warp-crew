import assert from 'node:assert/strict';
import { STRATEGIES, simulateFreePlayer30Days, reconcileLedger } from '../src/sim/contractEconomy.js';
import { createNewPlayer } from '../src/systems/player.js';
import { startExpedition, resolveExpedition, applyExpeditionResult } from '../src/systems/expedition.js';

const startAt = Date.UTC(2026, 8, 22, 12);
for (const strategy of Object.keys(STRATEGIES)) {
  const a = simulateFreePlayer30Days({ seed: 4219, strategy, startAt });
  const b = simulateFreePlayer30Days({ seed: 4219, strategy, startAt });
  assert.deepEqual(a, b, strategy);
  assert.equal(a.days.length, 30);
  for (const key of ['ads', 'purchases', 'skips', 'forceComplete']) assert.equal(a.policy[key], false);
  assert.deepEqual(reconcileLedger(a), { ok: true, differences: {} });
  assert.ok(a.days.every((day, index) => day.now === startAt + index * 86400000));
  assert.equal(a.days[0].completedContracts, 2, 'tutorial plus resumed normal contract');
  assert.equal(a.days[0].completedExpeditions, 0, 'no artificial day-one completion');
  assert.equal(a.days[1].completedExpeditions, 1, 'natural prior-day return');
  assert.ok(a.days.every(day => day.actions.filter(x => x.action === 'exp-start' && x.ok).length <= 1));
  for (const day of a.days) {
    for (const injury of day.injuries) assert.ok(injury.until > day.now && injury.until < day.now + 86400000);
    for (const currency of ['credits', 'fuel', 'gems', 'medals', 'reputation']) {
      const sources = Object.values(day.rewardsBySource).reduce((sum, values) => sum + values[currency], 0);
      const sinks = Object.values(day.costsByAction).reduce((sum, values) => sum + values[currency], 0);
      assert.equal(day.endWallet[currency] - day.startWallet[currency], sources - sinks);
    }
    if (day.contract?.outcome) {
      for (const [currency, amount] of Object.entries(day.contract.outcome.rewards)) {
        assert.ok((day.rewardsBySource['contract-claim']?.[currency] || 0) >= amount);
      }
    }
  }
  const broken = structuredClone(a);
  broken.finalWallet.credits += 1;
  assert.deepEqual(reconcileLedger(broken), { ok: false, differences: { credits: 1 } });
}
// Injury deadlines must use the injected clock; claiming consumes the active job.
let player = createNewPlayer({ now: startAt, rng: () => 0.1 });
const ids = player.crew.map(c => c.instanceId);
const job = startExpedition({ planetId: 'dustfall', crewInstanceIds: ids, minutes: 15, startedAt: startAt, successChance: 0 });
player = { ...player, activeExpedition: job, crew: player.crew.map(c => ({ ...c, status: 'expedition' })) };
assert.equal(resolveExpedition(job, { player, now: startAt, rng: () => 0.99 }).ready, false);
const now = startAt + 86400000;
const result = resolveExpedition(job, { player, now, rng: () => 0.99 });
const claimed = applyExpeditionResult(player, result, { now });
assert.equal(claimed.ok, true);
assert.equal(claimed.player.activeExpedition, null);
assert.ok(claimed.player.crew.every(c => c.injuredUntil === now + 18 * 60000));
assert.equal(applyExpeditionResult(claimed.player, result, { now }).ok, false);
console.log('contract_economy.test.mjs OK');
