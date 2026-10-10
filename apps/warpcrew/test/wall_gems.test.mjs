// Siege-wall gems (balance pass 2026-10-09, docs/qa/2026-10-09-balance-pass.md "The Crown pays gems on every
// segment won"). A segment won before the wall falls pays the flagship's credits, medals and reputation as before,
// but none of its gems; the flagship's own gems are paid once, with the takedown gems, when the wall falls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { prepareSession } from '../src/systems/sessionLoop.js';
import { acceptContract, previewContractAction, commitContractAction, claimContractReward } from '../src/systems/contracts.js';
import { contractFightArgs, startCrewFight } from '../src/systems/encounterState.js';
import { resolveSimulatedCombatPayout } from '../src/systems/contractRewards.js';
import { WALLS, WALL_TAKEDOWN_GEMS, SIEGE_SEGMENT, currentWall, wallOffer } from '../src/systems/walls.js';
import { encounterById } from '../src/systems/combat.js';
import { localDayKey } from '../src/shared/time.js';
import { recomputeCrew } from '../src/data/crewRoster.js';
import { finishCrewFight } from './helpers/crewFight.mjs';

const DAY = 86400000;
const start = new Date(2030, 8, 20, 9).getTime();
const now = start + 20 * DAY;
const BEATEN = { spur: 'veil_opened', veil: 'ember_opened', ember: 'hollow_opened', hollow: 'crown_opened' };

/** A veteran guided captain standing before `wallId`: every earlier wall broken and its sector opened. */
function veteran(wallId) {
  const base = createNewPlayer({ tutorialScript: 4, now: start, rng: () => 0.1 });
  const extra = [['merc_kira', 'gunner'], ['merc_tink', 'engineer']].map(([id, role]) => ({ ...base.crew[0], instanceId: `${id}_vet`, templateId: id, role }));
  const before = WALLS.slice(0, WALLS.findIndex(wall => wall.id === wallId));
  const flags = Object.fromEntries(before.flatMap(wall => [[`wall_${wall.id}`, true], [BEATEN[wall.id], true]]));
  return prepareSession({ ...base, createdAt: start, crew: [...base.crew, ...extra].map(member => recomputeCrew({ ...member, level: 30 })), crewSlots: 4,
    tutorial: { ...base.tutorial, completed: true, phase: 'done' }, wallet: { ...base.wallet, fuel: 10, credits: 0, gems: 0 },
    ship: { ...base.ship, systems: { ...base.ship.systems, shields: 10, weapons: 10, engines: 10, sensors: 9 } },
    stationAssignments: { merc_kira_vet: 'weapons' }, flags: { ...base.flags, ...flags },
    stats: { ...base.stats, contractsCompleted: 30 } }, now);
}

/** A won attempt at `wall` with `remaining` hull left in today's pool, settled by the production payout. */
function settledWin(wall, remaining) {
  let player = veteran(wall.id);
  player = { ...player, siege: { ...(player.siege || {}), [wall.id]: { dayKey: localDayKey(now), damage: wall.pool - remaining, attempts: 1 } } };
  const offer = wallOffer(player, wall, now);
  const contract = { offerId: offer.id, profile: offer.profile, encounterId: wall.encounterId, destinationId: wall.destinationId,
    wall: { id: wall.id }, participantIds: player.crew.map(member => member.instanceId) };
  const fight = startCrewFight(player, { acceptanceId: 'wall-test', seed: 7, ...contractFightArgs(player, contract, now) }, now);
  assert.equal(fight.enemy.startHull, Math.min(SIEGE_SEGMENT, remaining));
  const won = { ...fight, beat: 30, revision: 30, eventIndex: 30, result: 'win', phase: 'complete', enemy: { ...fight.enemy, hull: 0 } };
  const { wall: _wall, ...plain } = contract;
  return { wall: resolveSimulatedCombatPayout(player, contract, won, now).result, plain: resolveSimulatedCombatPayout(player, plain, won, now).result };
}

test('every wall: a segment pays the flagship prize without gems; the fall pays the flagship gems once', () => {
  for (const wall of WALLS) {
    const listed = encounterById(wall.encounterId).rewards;
    const segment = settledWin(wall, wall.pool);
    assert.equal(segment.wall.wall.defeated, false, `${wall.id}: a first segment does not break the wall`);
    assert.equal(segment.wall.rewards.gems, 0, `${wall.id}: no gems for a segment`);
    assert.equal(segment.wall.rewardPresence.gems, false, `${wall.id}: and none promised`);
    for (const key of ['credits', 'medals', 'reputation']) {
      assert.equal(segment.wall.rewards[key], segment.plain.rewards[key], `${wall.id}: a segment pays the flagship's ${key} as before`);
    }
    // The flagship's normal prize (what a segment paid before) carries its listed gems.
    assert.equal(segment.plain.rewards.gems, listed.gems || 0);
    const fall = settledWin(wall, SIEGE_SEGMENT);
    assert.equal(fall.wall.wall.defeated, true, `${wall.id}: the last segment breaks the wall`);
    assert.equal(fall.wall.rewards.gems, WALL_TAKEDOWN_GEMS + (listed.gems || 0), `${wall.id}: takedown gems plus the flagship's own`);
    assert.equal(fall.wall.rewards.medals, 2 * segment.wall.rewards.medals, `${wall.id}: the takedown still pays double`);
  }
  assert.equal(encounterById('eclipse_throne').rewards.gems, 8, 'the Eclipse Throne is the flagship that lists gems');
  assert.deepEqual(WALLS.filter(wall => encounterById(wall.encounterId).rewards.gems > 0).map(wall => wall.id), ['crown']);
});

test('breaking the Crown in one day pays the Eclipse Throne gems once, at the fall', () => {
  let player = veteran('crown');
  assert.equal(currentWall(player, now)?.id, 'crown');
  const crown = WALLS.find(wall => wall.id === 'crown');
  const attempts = [];
  for (let i = 0; i < 12 && !player.flags.wall_crown; i++) {
    const offer = player.contractBoard.offers.find(entry => entry.wall);
    let p = acceptContract(player, offer.id, now).player;
    for (const id of ['launch', 'push']) p = commitContractAction(p, previewContractAction(p, { id }, now), { now, rng: () => 0 }).player;
    p = finishCrewFight(p, now);
    const claimed = claimContractReward(p, now);
    assert.ok(claimed.ok, claimed.reason);
    attempts.push({ ...p.activeContract.result, gained: claimed.player.wallet.gems - player.wallet.gems });
    player = prepareSession({ ...claimed.player, wallet: { ...claimed.player.wallet, fuel: 10 }, ship: { ...claimed.player.ship, hull: 100 } }, now);
  }
  assert.equal(player.flags.wall_crown, true, 'the veteran crew breaks the Crown');
  const segments = attempts.filter(a => a.success && !a.wall.defeated);
  assert.equal(segments.length, Math.ceil(crown.pool / SIEGE_SEGMENT) - 1, 'six segments, then the fall');
  assert.ok(segments.every(a => a.rewards.gems === 0 && a.gained === 0), 'no gems before the fall (8 a segment before the fix)');
  assert.ok(segments.every(a => a.rewards.medals === encounterById('eclipse_throne').rewards.medals), 'segments still pay the flagship medals');
  const fall = attempts.at(-1);
  assert.equal(fall.wall.defeated, true);
  assert.equal(fall.gained, WALL_TAKEDOWN_GEMS + 8);
  assert.equal(attempts.reduce((sum, a) => sum + a.gained, 0), 28, 'the whole siege pays 28 gems (68 before the fix)');
});
