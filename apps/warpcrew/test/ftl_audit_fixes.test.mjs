import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { generateContractBoard, acceptContract, previewContractAction, commitContractAction } from '../src/systems/contracts.js';
import { applyEncounterAction } from '../src/systems/encounterState.js';
import { resolveSimulatedCombatPayout } from '../src/systems/contractRewards.js';
import { prepareSession, sessionModels } from '../src/systems/sessionLoop.js';
import { currentWall } from '../src/systems/walls.js';

const now = Date.UTC(2030, 8, 22, 12);
const clone = value => JSON.parse(JSON.stringify(value));
function fight() {
  let player = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
  player = { ...player, tutorial: { ...player.tutorial, completed: true, phase: 'done' }, wallet: { ...player.wallet, fuel: 10 } };
  player = { ...player, contractBoard: generateContractBoard(player, now) };
  player = acceptContract(player, player.contractBoard.offers.find(o => o.profile === 'risky').id, now).player;
  for (const id of ['launch', 'push']) player = commitContractAction(player, previewContractAction(player, { id }, now), { now, rng: () => 0.5 }).player;
  return player;
}

// A saved fight's crew must be crew who launched with the contract.
{
  const player = fight();
  assert.equal(player.activeEncounter.version, 3);
  const forged = clone(player);
  forged.activeEncounter.crew = [{ id: 'stranger', role: 'gunner', station: 'weapons', room: 'weapons', manualUntil: 0 }];
  const { acceptanceId, revision } = forged.activeEncounter;
  assert.equal(applyEncounterAction(forged, { acceptanceId, revision }, now).ok, false);
  assert.equal(migratePlayer(clone(forged)).activeContract, null, 'a forged crew cannot load');
  assert.notEqual(migratePlayer(clone(player)).activeContract, null, 'the real crew still loads');
}

// Whether a wall falls comes from the siege record, not the fight snapshot.
{
  const day3 = now + 2 * 86_400_000;
  const base = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
  let player = prepareSession({ ...base, createdAt: now, tutorial: { ...base.tutorial, completed: true, phase: 'done' },
    wallet: { ...base.wallet, fuel: 10 }, stats: { ...base.stats, contractsCompleted: 6 } }, day3);
  const wall = currentWall(player, day3);
  assert.ok(wall, 'a wall is on the board');
  const offer = player.contractBoard.offers.find(o => o.wall);
  player = acceptContract(player, offer.id, day3).player;
  for (const id of ['launch', 'push']) player = commitContractAction(player, previewContractAction(player, { id }, day3), { now: day3, rng: () => 0 }).player;
  const won = { ...clone(player.activeEncounter), result: 'win', phase: 'complete', beat: 10, revision: 10 };
  won.enemy.hull = 0;
  won.enemy.remainingBefore = 1; // edited to look like the last segment
  const payout = resolveSimulatedCombatPayout(player, player.activeContract, won, day3);
  assert.equal(payout.result.wall.defeated, false, 'a forged remainingBefore cannot break the wall');
}

// Reward bands are cached between fight beats (they simulate whole fights).
{
  const player = prepareSession({ ...createNewPlayer({ tutorialScript: 4, now }), tutorial: { script: 3, completed: true, phase: 'done' } }, now);
  const a = sessionModels(player, {}, now).contractBoard.offers[0].rewardBand;
  const b = sessionModels(player, {}, now + 1000).contractBoard.offers[0].rewardBand;
  assert.equal(a, b, 'same board, same minute: the cached band is reused');
}
console.log('ftl_audit_fixes.test.mjs OK');
