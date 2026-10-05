import assert from 'node:assert/strict';
import { startEncounter, advanceEncounter } from '../src/systems/autoCombat.js';
import { FIGHT_BEAT_MS, beatDelayMs, shouldAutoAdvanceFight } from '../src/systems/fightPacing.js';
import { createGuidedBeatScheduler } from '../src/ui/guidedBeatScheduler.js';

function beatsToFinish(kind, encounterId, outputs) {
  let state = startEncounter({ acceptanceId: 'a', encounterId, kind, seed: 7, outputs });
  let beats = 0;
  while (!state.result && beats < 60) {
    const open = state.orderWindow?.availableOrders || [];
    const order = open.includes('target_weapons') ? 'target_weapons' : open.includes('brace') ? 'brace' : null;
    state = advanceEncounter(state, order).state;
    beats += 1;
  }
  return beats;
}

const starter = { helm: 100, shields: 100, weapons: 100, engineering: 100 };
const outputs = [starter, { ...starter, weapons: 110 }, { ...starter, weapons: 120 }];

// Tutorial fight: the first beat is the captain's order; the rest play on the clock.
// With 3-4 s to read the tell and order, total lands around 15-20 s.
for (const o of outputs) {
  const auto = (beatsToFinish('guided', 'pirate_scout', o) - 1) * FIGHT_BEAT_MS.guided;
  assert.ok(auto >= 11000 && auto <= 17000, `guided auto time ${auto}ms outside 11-17s`);
}

// Normal fights at starter-to-early outputs land in the 30-60 s band.
for (const id of ['pirate_scout', 'pirate_wing']) {
  for (const o of outputs) {
    const total = beatsToFinish('normal', id, o) * FIGHT_BEAT_MS.normal;
    assert.ok(total >= 30000 && total <= 60000, `${id} normal fight ${total}ms outside 30-60s`);
  }
}

assert.equal(beatDelayMs({ kind: 'normal' }), FIGHT_BEAT_MS.normal);
assert.equal(beatDelayMs({ kind: 'guided' }), FIGHT_BEAT_MS.guided);

// Normal fights advance without a manual tap; finished fights stop.
const fight = startEncounter({ acceptanceId: 'n1', encounterId: 'pirate_wing', kind: 'normal', seed: 1, outputs: starter });
const player = { tutorial: { script: 5, phase: 'done', completed: true }, activeEncounter: fight };
assert.equal(shouldAutoAdvanceFight(player), true);
assert.equal(shouldAutoAdvanceFight({ ...player, activeEncounter: { ...fight, result: 'win' } }), false);

// The scheduler uses the pacing delay and holds while paused.
const timers = [];
let paused = true;
let advanced = 0;
const scheduler = createGuidedBeatScheduler({
  getPlayer: () => player,
  isBattlePlaying: () => false,
  isPaused: () => paused,
  advance: async () => { advanced += 1; return { ok: false }; },
  setTimer: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
  clearTimer: () => {},
  pausePollMs: 500,
});
assert.equal(scheduler.schedule(), true);
assert.equal(timers.at(-1).ms, FIGHT_BEAT_MS.normal, 'normal beats wait the normal tempo');
await timers.at(-1).callback();
assert.equal(advanced, 0, 'no beat while paused');
assert.equal(timers.at(-1).ms, 500, 'paused fights poll for resume');
paused = false;
await timers.at(-1).callback();
assert.equal(timers.at(-1).ms, FIGHT_BEAT_MS.normal, 'resume restarts a full beat');
await timers.at(-1).callback();
assert.equal(advanced, 1);

console.log('fight_pacing.test.mjs OK');
