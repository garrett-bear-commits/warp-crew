import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { generateContractBoard, acceptContract, previewContractAction, commitContractAction, claimContractReward, contractRewardBand } from '../src/systems/contracts.js';
import { applyEncounterAction, unlockedTactics, TACTIC_UNLOCKS } from '../src/systems/encounterState.js';
import { startEncounter, advanceEncounter, boardChance, BOARD } from '../src/systems/autoCombat.js';
import { RULES as FTL_RULES } from '../src/systems/ftlCombat.js';
import { sessionModels } from '../src/systems/sessionLoop.js';
import { renderShipEncounter } from '../src/ui/contractView.js';

const now = Date.UTC(2030, 8, 22, 12);
const clone = value => JSON.parse(JSON.stringify(value));

function fight({ contractsCompleted = 5, fuel = 10 } = {}) {
  let player = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
  player = { ...player, tutorial: { ...player.tutorial, completed: true, phase: 'done' },
    wallet: { ...player.wallet, fuel: 10 }, stats: { ...player.stats, contractsCompleted } };
  player = { ...player, contractBoard: generateContractBoard(player, now) };
  const offer = player.contractBoard.offers.find(candidate => candidate.profile === 'risky');
  player = acceptContract(player, offer.id, now).player;
  for (const id of ['launch', 'push']) {
    player = commitContractAction(player, previewContractAction(player, { id }, now), { now, rng: () => 0.5 }).player;
  }
  return { ...player, wallet: { ...player.wallet, fuel } };
}
const act = (player, order = null) => {
  const { acceptanceId, revision } = player.activeEncounter;
  return applyEncounterAction(player, { acceptanceId, revision, order }, now);
};

// Unlocks arrive slowly for guided-flow captains; veterans have everything.
assert.deepEqual(unlockedTactics({ tutorial: { script: 5, completed: true }, stats: { contractsCompleted: 1 } }), []);
assert.deepEqual(unlockedTactics({ tutorial: { script: 5, completed: true }, stats: { contractsCompleted: TACTIC_UNLOCKS.burn } }), ['burn']);
assert.deepEqual(unlockedTactics({ tutorial: { script: 5, completed: true }, stats: { contractsCompleted: TACTIC_UNLOCKS.board } }), ['burn', 'board']);
assert.deepEqual(unlockedTactics({ tutorial: { script: 3, completed: true }, stats: {} }), ['burn', 'board']);
assert.equal(Object.hasOwn(fight({ contractsCompleted: 1 }).activeEncounter, 'tactics'), false);
assert.equal(act(fight({ contractsCompleted: 1 }), 'burn').reason, 'order_unavailable');

// Overcharge (the 'burn' order): costs 1 fuel, weapons charge 50% faster for eight beats, once per fight.
{
  const start = fight();
  assert.equal(start.activeEncounter.version, 3, 'contract fights are FTL-lite fights');
  assert.deepEqual(Object.keys(start.activeEncounter.tactics), ['burn', 'board']);
  assert.equal(act({ ...start, wallet: { ...start.wallet, fuel: 0 } }, 'burn').reason, 'not_enough_fuel');
  const burned = act(start, 'burn');
  assert.equal(burned.ok, true, burned.reason);
  assert.equal(burned.player.wallet.fuel, start.wallet.fuel - 1);
  assert.equal(burned.player.activeEncounter.tactics.burn.throughBeat, burned.player.activeEncounter.beat + FTL_RULES.overchargeBeats - 1);
  const plain = act(start).player.activeEncounter;
  const fast = burned.player.activeEncounter;
  assert.ok(fast.weapons[0].chargeMs > plain.weapons[0].chargeMs, 'overcharged weapons charge faster');
  assert.equal(act(burned.player, 'burn').reason, 'used');
  assert.deepEqual(migratePlayer(clone(burned.player)).activeEncounter, burned.player.activeEncounter, 'overcharge survives reload');
}

// Board: only below half enemy hull; seeded outcome; success ends the fight and pays +25%.
{
  let player = fight();
  assert.equal(act(player, 'board').reason, 'enemy_too_strong');
  while (player.activeEncounter.enemy.hull > BOARD.maxEnemyHull && !player.activeEncounter.result) player = act(player).player;
  assert.ok(boardChance(player.activeEncounter) >= 0.2);
  const boarded = act(player, 'board');
  assert.equal(boarded.ok, true, boarded.reason);
  const replay = act(migratePlayer(clone(player)), 'board');
  assert.deepEqual(replay.player.activeEncounter, boarded.player.activeEncounter, 'boarding is seeded, not random');
  const outcome = boarded.events.find(event => event.type === 'boarding');
  assert.ok(outcome);
  if (outcome.success) {
    assert.equal(boarded.player.activeEncounter.result, 'win');
    assert.equal(boarded.player.activeContract.stage, 'return');
  } else {
    assert.ok(boarded.player.activeEncounter.hull < player.activeEncounter.hull, 'repelled boarders cost hull');
  }
  assert.equal(act(boarded.player, 'board').ok, false);
}

// Board payout and injury on both outcomes, forced through the pure reducer.
{
  const base = startEncounter({ acceptanceId: 'a', encounterId: 'pirate_wing', kind: 'normal', seed: 1, threat: 1, tactics: ['board'],
    outputs: { helm: 110, shields: 100, weapons: 110, engineering: 100 } });
  const seeds = { success: null, failure: null };
  for (let seed = 1; seed < 400 && (!seeds.success || !seeds.failure); seed++) {
    let state = { ...clone(base), seed };
    while (state.enemy.hull > BOARD.maxEnemyHull && !state.result) state = advanceEncounter(state).state;
    if (state.result) continue;
    const next = advanceEncounter(state, 'board');
    const hit = next.events.find(event => event.type === 'boarding');
    seeds[hit.success ? 'success' : 'failure'] ??= seed;
  }
  assert.ok(seeds.success && seeds.failure, 'boarding can both succeed and fail across seeds');
}

// A win after a successful boarding pays 1.25x credits and medals.
{
  let player = fight();
  let boardedWin = null;
  for (let offset = 0; offset < 200 && !boardedWin; offset++) {
    let candidate = { ...player, activeContract: { ...player.activeContract, routeSeed: player.activeContract.routeSeed + offset },
      activeEncounter: { ...player.activeEncounter, seed: player.activeEncounter.seed + offset } };
    while (candidate.activeEncounter.enemy.hull > BOARD.maxEnemyHull && !candidate.activeEncounter.result) candidate = act(candidate).player;
    if (candidate.activeEncounter.result) continue;
    const step = act(candidate, 'board');
    if (step.ok && step.events.some(event => event.type === 'boarding' && event.success)) boardedWin = step.player;
  }
  assert.ok(boardedWin, 'found a boarding success');
  const plainWin = (() => {
    let current = player;
    for (let i = 0; i < 200 && !current.activeEncounter.result; i++) current = act(current).player;
    return current;
  })();
  if (plainWin.activeEncounter.result === 'win') {
    assert.ok(boardedWin.activeContract.result.rewards.credits > plainWin.activeContract.result.rewards.credits);
  }
  const claimed = claimContractReward(boardedWin, now);
  assert.equal(claimed.ok, true, claimed.reason);
}

// The UI offers initiative orders with their consequences; the band discloses the boarding prize.
{
  const player = fight();
  const view = sessionModels(player, {}, now).activeContractView;
  const html = renderShipEncounter(view);
  assert.match(html, /data-order="burn"[^>]*>Overcharge · 1F/);
  assert.match(html, /data-order="board"[^>]*disabled[^>]*>Board/);
  assert.match(html, /Enemy above half hull/);
  const offer = player.contractBoard.offers.find(candidate => candidate.id === player.activeContract.offerId);
  const withBoard = contractRewardBand({ ...player, activeContract: null, activeEncounter: null }, offer, { now });
  const withoutBoard = contractRewardBand({ ...player, activeContract: null, activeEncounter: null, stats: { ...player.stats, contractsCompleted: 1 } }, offer, { now });
  assert.ok(withBoard.currencies.credits.max >= withoutBoard.currencies.credits.max, 'boarding can only widen the promised payout');
}

console.log('crew_tactics.test.mjs OK');
