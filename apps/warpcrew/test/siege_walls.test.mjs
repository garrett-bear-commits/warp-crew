import assert from 'node:assert/strict';
import { CHAPTERS } from '../src/data/campaign.js';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { prepareSession } from '../src/systems/sessionLoop.js';
import { acceptContract, previewContractAction, commitContractAction, claimContractReward } from '../src/systems/contracts.js';
import { visibleNodes } from '../src/data/sectors.js';
import { WALLS, WALL_THREAT_FLOOR, SIEGE_SEGMENT, currentWall, siegeState } from '../src/systems/walls.js';
import { encounterById } from '../src/systems/combat.js';
import { finishCrewFight } from './helpers/crewFight.mjs';

const DAY = 86400000;
const start = new Date(2030, 8, 20, 9).getTime();
const spur = WALLS[0];
const clone = value => JSON.parse(JSON.stringify(value));

function captain(now, { power = 60 } = {}) {
  const base = createNewPlayer({ tutorialScript: 4, now: start, rng: () => 0.1 });
  return prepareSession({ ...base, createdAt: start, crew: base.crew.map(member => ({ ...member, power })),
    tutorial: { ...base.tutorial, completed: true, phase: 'done' }, wallet: { ...base.wallet, fuel: 10, credits: 0 },
    stats: { ...base.stats, contractsCompleted: 6 },
    // Phase 3: the Spur wall is chapter 1's boss and waits for its five story missions.
    campaign: { done: CHAPTERS[0].missions, since: 1 } }, now);
}
const wallOfferOf = player => player.contractBoard.offers.find(offer => offer.wall);
function attempt(player, now) {
  const offer = wallOfferOf(player);
  let p = acceptContract(player, offer.id, now).player;
  for (const id of ['launch', 'push']) p = commitContractAction(p, previewContractAction(p, { id }, now), { now, rng: () => 0 }).player;
  const fightStart = p.activeEncounter;
  p = finishCrewFight(p, now);
  assert.deepEqual(migratePlayer(clone(p)).activeContract, p.activeContract, 'settled wall attempt survives reload');
  const claimed = claimContractReward(p, now);
  assert.equal(claimed.ok, true, claimed.reason);
  // Fuel topped up and hull patched between attempts: FTL-lite fights carry hull damage over.
  return { fightStart, settled: p, player: prepareSession({ ...claimed.player, wallet: { ...claimed.player.wallet, fuel: 10 },
    ship: { ...claimed.player.ship, hull: 100 } }, now) };
}

// The first wall arrives on career day 3 and hides the Veil gate until it falls.
assert.equal(currentWall(captain(start + DAY), start + DAY), null, 'no wall on day 2');
let now = start + 2 * DAY;
let player = captain(now);
assert.equal(currentWall(player, now)?.id, 'spur');
assert.ok(wallOfferOf(player), 'the wall is on the board beside the daily offers');
assert.equal(player.contractBoard.offers.filter(offer => !offer.wall).length, 3);
assert.ok(!visibleNodes(player, now).some(node => node.id === 'veil_gate'), 'Veil gate hidden behind the wall');
assert.ok(visibleNodes({ ...player, tutorial: { script: 3, completed: true, phase: 'done' } }, now).some(node => node.id === 'veil_gate'), 'veterans are unaffected');

// Attempt one: a 42-hull segment at Dangerous or worse; damage holds for the day.
const first = attempt(player, now);
assert.equal(first.fightStart.enemy.hull, SIEGE_SEGMENT);
assert.ok(first.fightStart.enemy.threat >= WALL_THREAT_FLOOR);
assert.equal(first.settled.activeContract.result.wall.id, 'spur');
player = first.player;
const dealt = first.settled.activeContract.result.wall.dealt;
assert.equal(siegeState(player, spur, now).remaining, spur.pool - dealt);
assert.notEqual(wallOfferOf(player).id, wallOfferOf(captain(now)).id, 'each attempt is a fresh offer');
assert.equal(siegeState(player, spur, now + DAY).remaining, spur.pool, 'damage resets at the next local day');

// Keep attacking the same day until the flagship breaks.
let takedown = null;
for (let i = 0; i < 8 && !player.flags?.wall_spur; i++) {
  const next = attempt(player, now);
  if (next.settled.activeContract.result.wall.defeated) takedown = next.settled.activeContract.result;
  player = next.player;
}
assert.equal(player.flags.wall_spur, true, 'a committed day of attempts breaks the first wall');
assert.ok(takedown, 'the final blow is a takedown');
assert.equal(takedown.rewards.gems >= 20, true);
assert.ok(takedown.rewards.credits >= encounterById(spur.encounterId).rewards.credits, 'takedown pays the boosted prize');
assert.ok(visibleNodes(player, now).some(node => node.id === 'veil_gate'), 'the Veil gate opens');
assert.equal(wallOfferOf(player), undefined, 'no wall offer until the next wall is reachable');

// A weak crew still chips the wall on a loss, and pays salvage.
{
  let weak = captain(start + 2 * DAY, { power: 5 });
  const lost = attempt(weak, start + 2 * DAY);
  assert.equal(typeof lost.settled.activeContract.result.wall.dealt, 'number');
  if (lost.settled.activeEncounter.result === 'loss') {
    assert.equal(lost.settled.activeContract.result.success, false);
    assert.ok(siegeState(lost.player, spur, start + 2 * DAY).remaining <= spur.pool);
  }
}

console.log('siege_walls.test.mjs OK');
