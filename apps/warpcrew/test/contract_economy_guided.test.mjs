// Siege damage resets at local midnight; the evidence and these assertions are pinned to UTC.
process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import { simulateFreePlayer30Days, reconcileLedger, runEconomySeedSet, renderEconomyMarkdown, GUIDED_STRATEGIES, EXPLORE_STRATEGIES } from '../src/sim/contractEconomy.js';
import { hasLane } from '../src/data/sectorMaps.js';
import { WALL_BY_ID, SIEGE_SEGMENT } from '../src/systems/walls.js';
import { buildSkipGems, UPGRADE_BUILD } from '../src/systems/hangar.js';
import { RALLY } from '../src/systems/gemSinks.js';

const startAt = Date.UTC(2026, 8, 22, 12);
const sim = (strategy, sessionOrder = 'fights-first', seed = 990001) => simulateFreePlayer30Days({ seed, strategy, startAt, flow: 'guided', sessionOrder });

function checkRun(run) {
  const label = `${run.strategy}/${run.sessionOrder}/${run.seed}`;
  assert.deepEqual(reconcileLedger(run), { ok: true, differences: {} }, label);
  // Script-5 first session through production transitions; walls apply from career day 3.
  assert.ok(run.days[0].actions.some(a => a.action === 'captain-choose' && a.ok), label);
  assert.ok(run.days[0].actions.some(a => a.action === 'tutorial-register-skip' && a.ok), label);
  assert.equal(run.walls.spur?.arrivalDay, 3, `${label}: first wall on day 3`);
  for (const day of run.days.slice(0, 2)) assert.ok(!day.offers.some(o => o.id.startsWith('offer_wall_')), `${label}: no wall before day 3`);

  // Every day's gem movement is explained by its ledger buckets.
  for (const day of run.days) {
    const sources = Object.values(day.rewardsBySource).reduce((sum, v) => sum + v.gems, 0);
    const sinks = Object.values(day.costsByAction).reduce((sum, v) => sum + v.gems, 0);
    assert.equal(day.endWallet.gems - day.startWallet.gems, sources - sinks, `${label} day ${day.day} gems`);
  }
  // Gem ledger: earned - spent = net, sinks classify every spend, policy is respected.
  assert.equal(run.gems.earned - run.gems.spent, run.finalWallet.gems - run.initialWallet.gems, label);
  assert.equal(Object.values(run.gems.spentBySink).reduce((a, b) => a + b, 0), run.gems.spent, label);
  const policy = GUIDED_STRATEGIES[run.strategy].gems;
  if (policy === 'never') assert.equal(run.gems.spent, 0, `${label}: cautious never spends gems`);
  if (policy !== 'all') assert.equal(run.gems.spentBySink.drydock_skip, 0, `${label}: only ambitious skips`);
  assert.equal(run.metrics.rallies.free <= 1, true, `${label}: one free Rally per captain`);
  assert.equal(run.gems.spentBySink.rally, run.metrics.rallies.paid * RALLY.gems, label);
  const broken = Object.values(run.walls).filter(w => w.fellOnDay).length;
  assert.equal(run.gems.earnedBySource['wall:contract-claim'] || 0, 20 * broken, `${label}: +20 gems per takedown`);

  // Wall attempts: a segment is at most 42 hull; damage holds within a day and resets on the next.
  assert.ok(run.wallAttempts.length > 0, `${label}: the wall is attempted`);
  assert.equal(run.wallAttempts[0].day, 3, `${label}: attacked on arrival`);
  let previous = null;
  for (const attempt of run.wallAttempts) {
    const pool = WALL_BY_ID[attempt.wall].pool;
    assert.ok(attempt.segment <= SIEGE_SEGMENT && attempt.dealt <= attempt.segment, label);
    const sameDay = previous && previous.wall === attempt.wall && previous.day === attempt.day;
    assert.equal(attempt.remainingBefore, sameDay ? previous.remainingAfter : pool, `${label}: day ${attempt.day} siege carry-over`);
    assert.equal(attempt.segment, Math.min(SIEGE_SEGMENT, attempt.remainingBefore), label);
    if (attempt.nearMissLoss) assert.ok(!attempt.success && attempt.segment - attempt.dealt <= attempt.segment * RALLY.nearMissPct, label);
    if (attempt.defeated) {
      assert.equal(attempt.remainingAfter, 0, label);
      assert.ok(attempt.rewards.gems >= 20, `${label}: takedown pays gems`);
      assert.equal(run.walls[attempt.wall].fellOnDay, attempt.day, label);
    }
    previous = attempt;
  }
  // Explore: jumps follow lit lanes, events are resolved, fights are claimed, the ledger names every Explore delta.
  const jumps = run.days.flatMap(d => d.explore?.jumps || []);
  assert.equal(run.explore.jumps, jumps.length, label);
  for (const jump of jumps) {
    assert.ok(hasLane(jump.from, jump.to) || jump.to === 'station_home', `${label}: ${jump.from} -> ${jump.to} follows a lane`);
    if (jump.kind === 'event') assert.ok(jump.choice, `${label}: event resolved`);
    assert.ok(!jump.unsettled, `${label}: Explore fight settled`);
  }
  for (const day of run.days) {
    const x = day.explore;
    if (!x) continue;
    const limits = EXPLORE_STRATEGIES[run.strategy];
    assert.ok(x.jumps.length <= limits.maxJumps, label);
    for (const jump of x.jumps) assert.ok(day.costsByAction['explore:travel-to']?.fuel > 0, `${label}: jump fuel ledgered`);
  }
  assert.equal(run.explore.events + jumps.filter(j => j.kind !== 'event').length, run.explore.jumps, label);
  for (const wall of Object.values(run.walls)) {
    const attempts = run.wallAttempts.filter(a => a.wall === wall.id);
    assert.equal(wall.attempts, attempts.length, label);
    assert.equal(wall.nearMissLosses, attempts.filter(a => a.nearMissLoss).length, label);
    assert.equal(wall.fellOnDay != null, attempts.some(a => a.defeated), label);
  }

  // Drydock: one build at a time, only above level 3, finished by the clock via prepareSession or a paid skip.
  for (const [i, build] of run.builds.entries()) {
    assert.ok(build.targetLevel > UPGRADE_BUILD.instantThrough, label);
    if (build.skippedFor != null) {
      assert.equal(build.skippedFor, buildSkipGems(build.endAt - build.startedAt), label);
      continue;
    }
    const done = run.days.find(d => d.buildCompleted?.startedAt === build.startedAt && d.buildCompleted.system === build.system);
    const next = run.builds[i + 1];
    if (done) {
      assert.ok(done.buildCompleted.completedAt >= build.endAt && done.day > build.day, `${label}: build waits for its clock`);
      if (next) assert.ok(next.startedAt >= done.buildCompleted.completedAt, `${label}: single drydock`);
    } else assert.equal(next, undefined, `${label}: only the last build may still be running`);
  }
}

// Deterministic and conservation-checked.
assert.deepEqual(sim('balanced'), sim('balanced'));
const runs = [sim('cautious'), sim('balanced'), sim('ambitious'), sim('balanced', 'away-first')];
runs.forEach(checkRun);
assert.ok(runs[2].gems.spentBySink.drydock_skip > 0, 'ambitious spends gems on drydock skips');
assert.ok(runs[0].builds.some(b => b.skippedFor == null), 'cautious waits on the build clock');
// With the away team out, a later wall stands for several days: the reset path is exercised.
assert.ok(Object.values(runs[3].walls).some(w => w.attemptDays >= 2), 'a multi-day siege is simulated');
assert.ok(runs[3].wallAttempts.some(a => a.day > 3 && a.remainingBefore === WALL_BY_ID[a.wall].pool
  && runs[3].wallAttempts.some(b => b.wall === a.wall && b.day === a.day - 1)), 'damage resets on the next day');
assert.throws(() => simulateFreePlayer30Days({ seed: 1, strategy: 'balanced', flow: 'guided', sessionOrder: 'later' }), /session order/);
// Every strategy travels the map: jumps, events and Explore fights all happen in 30 days.
for (const run of runs.slice(0, 3)) {
  assert.ok(run.explore.jumps > 0 && run.explore.events > 0, `${run.strategy} explores`);
  assert.ok(run.explore.earned.credits > 0, `${run.strategy} earns credits exploring`);
}
assert.ok(runs[2].explore.jumps >= runs[0].explore.jumps, 'ambitious jumps at least as often as cautious');

// The evidence renderer adds the guided section and keeps the baseline table.
const report = runEconomySeedSet({ seeds: [4219], startAt });
const markdown = renderEconomyMarkdown(report);
assert.ok(markdown.startsWith('## 30-day free-player economy'));
assert.match(markdown, /## 30-day guided-flow economy: siege walls, gems, timed drydock/);
assert.match(markdown, /\| balanced \| First wall fell on day \|/);
assert.match(markdown, /### Explore per run \(fights-first\)/);
assert.match(markdown, /\| balanced \| Explore net credits \|/);
assert.match(markdown, /Conservation: 3\/3 guided runs PASS \(fights-first\), 3\/3 PASS \(away-first\)/);
assert.equal(report.runs.length, 3);
assert.ok(report.runs.every(run => !run.flow && !run.walls), 'the script-3 baseline stays untouched');
console.log('contract_economy_guided.test.mjs OK');
