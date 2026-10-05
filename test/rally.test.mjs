import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { generateContractBoard, acceptContract, previewContractAction, commitContractAction } from '../src/systems/contracts.js';
import { applyEncounterAction } from '../src/systems/encounterState.js';
import { startEncounter, advanceEncounter, rallyEligible } from '../src/systems/autoCombat.js';
import { shouldAutoAdvanceFight } from '../src/systems/fightPacing.js';
import { sessionModels } from '../src/systems/sessionLoop.js';
import { renderShipEncounter } from '../src/ui/contractView.js';
import { RALLY } from '../src/systems/gemSinks.js';

const now = Date.UTC(2030, 8, 22, 12);
const clone = value => JSON.parse(JSON.stringify(value));
const outputs = { helm: 100, shields: 100, weapons: 100, engineering: 100 };

// Pure reducer: a near-miss loss becomes 'downed'; Rally restores 12 hull once; concede settles the loss.
function brink(enemyHull) {
  let state = startEncounter({ acceptanceId: 'a', encounterId: 'pirate_wing', kind: 'normal', seed: 3, threat: 1.2, outputs });
  state = advanceEncounter(state).state;
  state = advanceEncounter(state).state;
  return { ...state, hull: 2, shield: 0, enemy: { ...state.enemy, hull: enemyHull } };
}
const down = advanceEncounter(brink(5));
assert.equal(down.state.phase, 'downed');
assert.equal(down.state.result, null);
assert.ok(down.events.some(event => event.type === 'downed'));
assert.equal(advanceEncounter(down.state).reason, 'downed', 'the clock cannot advance a downed crew');
assert.equal(advanceEncounter(brink(30)).state.result, 'loss', 'far from the kill there is no Rally');
const rallied = advanceEncounter(down.state, 'rally');
assert.ok(rallied.state.phase === 'combat' || rallied.state.result === 'win', 'Rally resumes the fight (and can finish it)');
assert.ok(rallied.state.hull >= 12);
assert.equal(rallied.state.rally.used, true);
assert.equal(rallyEligible({ ...rallied.state, hull: 1 }), false, 'one Rally per fight');
const conceded = advanceEncounter(down.state, 'concede');
assert.equal(conceded.state.result, 'loss');
assert.deepEqual(advanceEncounter(clone(down.state), 'rally'), rallied, 'deterministic');

// Contract integration: first Rally free, later ones cost gems, pacing pauses while downed.
function contractFight(flags = {}, gems = 0) {
  let player = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
  player = { ...player, flags: { ...player.flags, ...flags }, tutorial: { ...player.tutorial, completed: true, phase: 'done' },
    wallet: { ...player.wallet, fuel: 10, gems } };
  player = { ...player, contractBoard: generateContractBoard(player, now) };
  player = acceptContract(player, player.contractBoard.offers.find(o => o.profile === 'risky').id, now).player;
  for (const id of ['launch', 'push']) player = commitContractAction(player, previewContractAction(player, { id }, now), { now, rng: () => 0 }).player;
  for (let i = 0; i < 2; i++) {
    const { acceptanceId, revision } = player.activeEncounter;
    player = applyEncounterAction(player, { acceptanceId, revision }, now).player;
  }
  const e = clone(player.activeEncounter);
  // Push to the brink while keeping beat/revision history intact: hull 2, no shield,
  // the enemy one hit from breaking and its guns about to fire (v3 FTL-lite fight).
  e.hull = 2;
  e.shields.layers = 0;
  e.enemy.hull = 3;
  e.weapons.forEach(w => { w.chargeMs = 0; });
  e.enemy.weapons.forEach(w => { w.progressMs = w.chargeMs - 10; });
  e.crew.forEach(c => { c.room = null; c.station = null; });
  player = { ...player, activeEncounter: e };
  const { acceptanceId, revision } = player.activeEncounter;
  return applyEncounterAction(player, { acceptanceId, revision }, now).player;
}
{
  const player = contractFight();
  assert.equal(player.activeEncounter.phase, 'downed');
  assert.deepEqual(migratePlayer(clone(player)).activeEncounter, player.activeEncounter, 'downed survives reload');
  assert.equal(shouldAutoAdvanceFight(player), false, 'the fight clock waits for the captain');
  const html = renderShipEncounter(sessionModels(player, {}, now).activeContractView);
  assert.match(html, /Hull failing/);
  assert.match(html, /data-order="rally"[^>]*>Rally<span>Free this time/);
  assert.match(html, /data-order="concede"/);
  const { acceptanceId, revision } = player.activeEncounter;
  const free = applyEncounterAction(player, { acceptanceId, revision, order: 'rally' }, now);
  assert.equal(free.ok, true, free.reason);
  assert.equal(free.player.wallet.gems, 0);
  assert.equal(free.player.flags.rallyFreeUsed, true);
}
{
  const broke = contractFight({ rallyFreeUsed: true }, 10);
  const ident = { acceptanceId: broke.activeEncounter.acceptanceId, revision: broke.activeEncounter.revision };
  assert.equal(applyEncounterAction(broke, { ...ident, order: 'rally' }, now).reason, 'not_enough_gems');
  assert.match(renderShipEncounter(sessionModels(broke, {}, now).activeContractView), new RegExp(`data-order="rally"[^>]*disabled>Rally<span>${RALLY.gems} gems`));
  const paid = contractFight({ rallyFreeUsed: true }, 100);
  const paidIdent = { acceptanceId: paid.activeEncounter.acceptanceId, revision: paid.activeEncounter.revision };
  const rally = applyEncounterAction(paid, { ...paidIdent, order: 'rally' }, now);
  assert.equal(rally.ok, true);
  assert.equal(rally.player.wallet.gems, 100 - RALLY.gems);
  const concede = applyEncounterAction(paid, { ...paidIdent, order: 'concede' }, now);
  assert.equal(concede.player.activeContract.stage, 'return', 'conceding settles the salvage');
  assert.equal(concede.player.activeContract.result.success, false);
}

console.log('rally.test.mjs OK');
