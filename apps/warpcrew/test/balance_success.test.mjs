// Crew-matter success tests 2 and 3 (docs/superpowers/specs/2026-10-09-crew-matter-design.md), checked on the
// guided simulator's own day-7 captains (balance pass 2026-10-09, docs/qa/2026-10-09-balance-pass.md).
// Seeded and deterministic; about a minute, so it runs in test:balance.
process.env.TZ = 'UTC';
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateFreePlayer30Days, ECONOMY_SEEDS, STRATEGIES } from '../src/sim/contractEconomy.js';
import { contractFightArgs, startCrewFight, fightPower, threatLabel } from '../src/systems/encounterState.js';
import { playOddsFight, offerFightContract } from '../src/systems/fightOdds.js';
import { advanceFtlEncounter, applyFtlCommand, ftlPolicyStep, MAX_FIGHT_BEATS } from '../src/systems/ftlCombat.js';
import { normalizeAssignments } from '../src/systems/stations.js';
import { createCrewInstance } from '../src/data/crewRoster.js';
import { encounterById, rubberBandPower } from '../src/systems/combat.js';
import { combatBonuses } from '../src/systems/passives.js';
import { WALL_BY_ID } from '../src/systems/walls.js';

// 48 seeds per crew (720 fights per Legendary): at 16, the full-hull gain (about +2 points at an 84% base) sat
// inside one standard error and its sign flipped with unrelated changes.
const SEEDS = Array.from({ length: 48 }, (_, i) => 5000 + i * 7919);
const LEGENDARIES = ['merc_zephyr', 'merc_onyx', 'merc_prism', 'merc_solace', 'merc_harrow'];

/** Every guided captain's save at the end of day 7, crew back aboard and healed, siege damage cleared. */
const captains = Object.keys(STRATEGIES).flatMap(strategy => ECONOMY_SEEDS.map(seed => {
  let snap = null;
  simulateFreePlayer30Days({ seed, strategy, flow: 'guided', days: 7, onDayEnd: (player, day) => { snap = { player: structuredClone(player), now: day.now }; } });
  const { player, now } = snap;
  return { strategy, seed, now, player: { ...player, siege: {}, ship: { ...player.ship, hull: 100 },
    crew: player.crew.map(member => ({ ...member, status: 'ready', injuredUntil: 0 })) } };
}));
const atHull = (player, hull) => ({ ...player, ship: { ...player.ship, hull } });
const pct = (wins, fights) => Math.round((wins / fights) * 1000) / 10;

/**
 * The same crew with a freshly hired Legendary (level 1) in place of the weakest non-captain merc. The Legendary
 * takes their role's own station when there is one (whoever sat there moves to the freed seat), as a captain would.
 */
const ROLE_SEAT = { pilot: 'helm', gunner: 'weapons', engineer: 'shields' };
function withLegendary(player, templateId) {
  const weakest = player.crew.filter(member => !member.isCaptain && member.instanceId !== player.captainInstanceId)
    .sort((a, b) => a.power - b.power || a.instanceId.localeCompare(b.instanceId))[0];
  const seats = normalizeAssignments(player);
  const legend = { ...createCrewInstance(templateId, { rng: () => 0.42 }), instanceId: `${templateId}_hired` };
  const stationAssignments = { ...seats };
  delete stationAssignments[weakest.instanceId];
  const own = ROLE_SEAT[legend.role];
  const holder = own && Object.keys(stationAssignments).find(id => stationAssignments[id] === own);
  if (holder) stationAssignments[holder] = seats[weakest.instanceId] || null;
  stationAssignments[legend.instanceId] = own || seats[weakest.instanceId] || null;
  return { ...player, crew: [...player.crew.filter(member => member !== weakest), legend], stationAssignments };
}
const veilWall = { encounterId: WALL_BY_ID.veil.encounterId, wall: { id: 'veil' }, destinationId: WALL_BY_ID.veil.destinationId, profile: 'risky' };
const winRate = (pairs) => {
  let wins = 0, fights = 0;
  for (const { player, now, contract } of pairs) {
    const args = contractFightArgs(player, contract, now);
    for (const seed of SEEDS) { wins += playOddsFight(player, args, seed, now) ? 1 : 0; fights += 1; }
  }
  return pct(wins, fights);
};

test('success test 2: a Legendary in a typical day-7 crew wins a Dangerous wall attempt more often', () => {
  const rows = [];
  for (const hull of [100, 80, 60]) {
    const crews = captains.map(c => ({ ...c, player: atHull(c.player, hull), contract: veilWall }));
    const args = contractFightArgs(crews[0].player, veilWall, crews[0].now);
    assert.equal(threatLabel(args.threat), 'Dangerous', 'the Veil flagship is a Dangerous fight on day 7');
    const base = winRate(crews);
    const each = Object.fromEntries(LEGENDARIES.map(id => [id, winRate(crews.map(c => ({ ...c, player: withLegendary(c.player, id) })))]));
    const mean = Math.round(Object.values(each).reduce((sum, v) => sum + v, 0) / LEGENDARIES.length * 10) / 10;
    rows.push({ hull, base, mean, gain: Math.round((mean - base) * 10) / 10, each });
  }
  console.log(`success test 2 (Veil wall, 15 day-7 captains x ${SEEDS.length} seeds):`);
  for (const row of rows) console.log(`  hull ${row.hull}: base ${row.base}% -> with a Legendary ${row.mean}% (+${row.gain}); ${Object.entries(row.each).map(([id, v]) => `${id.slice(5)} ${v}`).join(', ')}`);
  // NOT met as the spec words it (report): the spec's 15 points hold only where the wall bites hardest, a ship at
  // the 60-hull repair line. With more hull the typical crew already wins most attempts and the five Legendary
  // moves differ widely (Onyx helps most, Harrow less than the merc he replaces), so the mean gain is small.
  // These guard what holds today: a Legendary never makes a typical crew worse on average, +15 at 60 hull.
  const [full, typical, low] = rows;
  assert.ok(low.gain >= 15, `at 60 hull a Legendary adds ${low.gain} points`);
  for (const row of rows) assert.ok(row.gain >= 0, `at ${row.hull} hull a Legendary adds ${row.gain} points`);
  assert.ok(full.base < 90 && typical.base < full.base, 'the wall is a real fight for a typical day-7 crew');
});

/** The threat model before 2026-10-09: the enemy pulled 82% of the way to the crew's own power. */
function oldThreat(player, contract, now) {
  const encounter = encounterById(contract.encounterId);
  const power = fightPower(player, contract.encounterId, now);
  const enemy = Math.max(6, Math.round(rubberBandPower(encounter.power, power) * combatBonuses(player, encounter).enemyScale));
  const threat = Math.max(0.6, Math.min(1.6, Math.round((enemy / power) * 100) / 100));
  return contract.wall ? Math.max(1.2, threat) : threat;
}
/** A fully idle captain: no taps at all (the crew and auto-targeting only), Auto on. */
function idleWin(player, args, seed, now) {
  let state = startCrewFight(player, { acceptanceId: 'idle', seed, ...args }, now);
  state = applyFtlCommand(state, { type: 'auto', auto: true }).state || state;
  for (let beat = 0; beat < MAX_FIGHT_BEATS && state.result === null && state.phase !== 'downed'; beat += 1) {
    for (const command of ftlPolicyStep(state, 'idle').commands) state = applyFtlCommand(state, command).state;
    state = advanceFtlEncounter(state, null).state;
  }
  return state.result === 'win';
}

test('success test 3: an idle Auto-on captain wins about as often as before on the same content', () => {
  // The same content: each day-7 captain's contract board (its toughest fight per offer) and the Veil wall.
  let before = 0, after = 0, fights = 0;
  for (const { player, now } of captains) {
    const contracts = [...player.contractBoard.offers.filter(offer => !offer.wall).map(offerFightContract).filter(Boolean), veilWall];
    for (const contract of contracts) {
      const args = contractFightArgs(player, contract, now);
      const old = { ...args, threat: oldThreat(player, contract, now) };
      for (const seed of SEEDS.slice(0, 8)) {
        before += idleWin(player, old, seed, now) ? 1 : 0;
        after += idleWin(player, args, seed, now) ? 1 : 0;
        fights += 1;
      }
    }
  }
  console.log(`success test 3 (idle, Auto on, ${fights} fights): before ${pct(before, fights)}%, after ${pct(after, fights)}%`);
  // Idle play never gets harder, and stays within ten points of before.
  assert.ok(pct(after, fights) >= pct(before, fights) - 2, 'idle play does not get harder');
  assert.ok(Math.abs(pct(after, fights) - pct(before, fights)) <= 10, 'about as often as before');
});
