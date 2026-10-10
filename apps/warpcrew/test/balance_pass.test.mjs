// Balance pass 2026-10-09 (crew-matter design §4): reference-power threat, win odds from the real fight,
// and old in-flight fights still loading. Report: docs/qa/2026-10-09-balance-pass.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { prepareSession, sessionModels } from '../src/systems/sessionLoop.js';
import { acceptContract, previewContractAction, commitContractAction } from '../src/systems/contracts.js';
import { contractThreat, contractFightArgs, startCrewFight, threatLabel, daysPlayed, referencePower, REFERENCE_CURVE,
  SECTOR_THREAT_BASE, applyEncounterAction, applyEncounterCommand, normalizeEncounterState } from '../src/systems/encounterState.js';
import { fightOdds, offerFightContract, oddsSeeds, oddsText, playOddsFight, clearFightOdds, ODDS_SEEDS } from '../src/systems/fightOdds.js';
import { enemyLoadout, ftlPolicyStep, validFtlBody } from '../src/systems/ftlCombat.js';
import { recomputeCrew } from '../src/data/crewRoster.js';
import { localDayKey } from '../src/shared/time.js';
import { renderContractBoard, renderContractReview } from '../src/ui/contractView.js';
import { finishCrewFight } from './helpers/crewFight.mjs';
import { gateStep, pickGateChoice, GATE_OPENS } from '../src/sim/contractEconomy.js';
import { hasLane } from '../src/data/sectorMaps.js';
import { NODES } from '../src/data/sectors.js';
import { claimContractReward } from '../src/systems/contracts.js';
import { resolveSimulatedCombatPayout } from '../src/systems/contractRewards.js';
import { fightHullLoss } from '../src/systems/encounterState.js';
import { beginTravelFight, applyTravelFightAction, claimTravelFight, validTravelFight } from '../src/systems/travelFight.js';

const DAY = 86400000;
const start = new Date(2030, 8, 20, 9).getTime();
const clone = value => JSON.parse(JSON.stringify(value));

/** A post-tutorial guided captain on their Nth day played (one finished contract on each earlier day). */
function captain(day = 1, { level = 1 } = {}) {
  const now = start + (day - 1) * DAY;
  const base = createNewPlayer({ tutorialScript: 4, now: start, rng: () => 0.1 });
  let player = prepareSession({ ...base, createdAt: start, crew: base.crew.map(member => recomputeCrew({ ...member, level })),
    tutorial: { ...base.tutorial, completed: true, phase: 'done' }, wallet: { ...base.wallet, fuel: 10 },
    stats: { ...base.stats, contractsCompleted: 6 } }, now);
  const done = Array.from({ length: day - 1 }, (_, i) => `offer_${localDayKey(start + i * DAY)}_reliable`);
  player = { ...player, contractBoard: { ...player.contractBoard, completedOfferIds: [...player.contractBoard.completedOfferIds, ...done] } };
  return { player, now };
}
const risky = player => player.contractBoard.offers.find(offer => offer.profile === 'risky' && !offer.wall);

test('days played count finished board days once; the tutorial job and wall attempts do not count', () => {
  const ids = ['offer_tutorial_distress', 'offer_wall_spur_3', 'offer_2030-09-20_reliable', 'offer_2030-09-20_risky', 'offer_2030-09-21_strange'];
  assert.equal(daysPlayed({}), 1);
  assert.equal(daysPlayed({ contractBoard: { completedOfferIds: ids } }), 3);
  // The curve: the guided simulator's median by day played, linear between points, held after day 30.
  assert.equal(referencePower(captain(1).player), REFERENCE_CURVE[0][1]);
  assert.equal(referencePower(captain(7).player), 95);
  assert.equal(referencePower(captain(30).player), 220);
  assert.equal(referencePower({ contractBoard: { completedOfferIds: Array.from({ length: 60 }, (_, i) => `offer_${localDayKey(start + i * DAY)}_risky`) } }), 220);
  const day10 = referencePower(captain(10).player);
  assert.ok(day10 > 95 && day10 < 130, 'between the day-7 and day-15 points');
});

test('threat comes from the encounter, the sector and the reference crew, never from the crew aboard', () => {
  const { player, now } = captain(7);
  const contract = { encounterId: 'swarm_frigate', destinationId: 'swarm_scar' };
  const weak = contractThreat(player, contract, now);
  const strong = contractThreat({ ...player, crew: player.crew.map(member => recomputeCrew({ ...member, level: 10, stars: 3 })) }, contract, now);
  assert.equal(strong, weak, 'levelling the crew does not raise the enemy');
  // A stronger listed enemy is the bigger threat; the same enemy is softer once the reference crew outgrows it.
  assert.ok(contractThreat(player, { encounterId: 'pirate_wing', destinationId: 'danger_belt' }, now)
    < contractThreat(player, { encounterId: 'corsair_king', destinationId: 'danger_belt' }, now));
  assert.ok(contractThreat(captain(20).player, contract, now) < contractThreat(captain(2).player, contract, now));
  // Later sectors fight back harder for the same enemy.
  assert.ok(SECTOR_THREAT_BASE.spur < SECTOR_THREAT_BASE.veil && SECTOR_THREAT_BASE.hollow < SECTOR_THREAT_BASE.crown);
  assert.ok(contractThreat(player, { encounterId: 'pirate_wing', destinationId: 'danger_belt' }, now)
    < contractThreat(player, { encounterId: 'pirate_wing', destinationId: 'merchant_moon' }, now));
  // Above the reference crew the enemy fights at its full ratio (Deadly), clamped to the engine's range.
  assert.equal(contractThreat(captain(1).player, { encounterId: 'eclipse_throne', destinationId: 'eclipse_crown' }, now), 1.6);
  // Nobody aboard who can fight: Deadly.
  const away = { ...player, crew: player.crew.map(member => ({ ...member, status: 'expedition' })) };
  assert.equal(contractThreat(away, contract, now), 1.6);
  // Labels keep their thresholds.
  assert.deepEqual([1.3, 1.29, 1.05, 1.04, 0.9, 0.89].map(threatLabel), ['Deadly', 'Dangerous', 'Dangerous', 'Even', 'Even', 'Favorable']);
});

test('a fight saved before the balance pass keeps its threat, loads and plays to its end', () => {
  const { player, now } = captain(4);
  const offer = risky(player);
  let p = acceptContract(player, offer.id, now).player;
  for (const id of ['launch', 'push']) p = commitContractAction(p, previewContractAction(p, { id }, now), { now, rng: () => 0 }).player;
  assert.equal(p.activeEncounter?.version, 3);
  // The old model stored a crew-matched threat; this one cannot come from the reference model today.
  const oldThreat = 1.37;
  assert.notEqual(p.activeEncounter.enemy.threat, oldThreat);
  // The fight keeps its faction block and twist: every saved faction fight carries them (audit 2026-10-10 L3).
  const fight = p.activeEncounter;
  const load = enemyLoadout(oldThreat, { tier: fight.enemy.tier || 0, kits: true, faction: fight.faction?.id || null,
    elite: fight.twist?.elite ?? null, hitMult: fight.twist?.id === 'holdout' ? 1.2 : 1 });
  const oldFight = fight;
  const saved = clone({ ...p, activeEncounter: { ...oldFight, enemy: { ...p.activeEncounter.enemy, threat: oldThreat,
    evasion: load.evasion, repairPerSec: load.repairPerSec, shields: { layers: load.shieldLayers, max: load.shieldLayers, rechargeMs: 0 },
    weapons: load.weapons.map((w, i) => ({ ...w, progressMs: p.activeEncounter.enemy.weapons[i]?.progressMs ?? 0, target: p.activeEncounter.enemy.weapons[i]?.target ?? 'helm' })) } } });
  assert.equal(validFtlBody(saved.activeEncounter), true);
  const loaded = migratePlayer(saved);
  assert.equal(loaded.activeEncounter?.enemy.threat, oldThreat, 'the saved threat is kept, not recomputed');
  assert.deepEqual(normalizeEncounterState(loaded).activeEncounter, loaded.activeEncounter);
  const finished = finishCrewFight(loaded, now);
  assert.ok(['win', 'loss'].includes(finished.activeEncounter.result));
  assert.equal(finished.activeContract.stage, 'return');
});

test('win odds play the same fight a launch starts, with fixed seeds, and are cached by the fight setup', () => {
  clearFightOdds();
  const { player, now } = captain(4, { level: 3 });
  const offer = risky(player);
  const fight = offerFightContract(offer);
  assert.equal(fight.encounterId, offer.routeContent.routeOutcome.encounter, 'the toughest route is the push fight');
  // Honest: the launch's fight is the odds' fight with the contract's own seed.
  let p = acceptContract(player, offer.id, now).player;
  for (const id of ['launch', 'push']) p = commitContractAction(p, previewContractAction(p, { id }, now), { now, rng: () => 0 }).player;
  const real = p.activeEncounter;
  const args = contractFightArgs(player, fight, now);
  assert.deepEqual(startCrewFight(player, { acceptanceId: real.acceptanceId, seed: real.seed, ...args }, now), real);
  // Play the real fight as the odds do (smart captain, Auto on): same result as the odds' player.
  let live = p;
  for (let beat = 0; beat < 200 && !live.activeEncounter.result; beat++) {
    const encounter = live.activeEncounter;
    if (encounter.phase === 'downed') { live = applyEncounterAction(live, { acceptanceId: encounter.acceptanceId, revision: encounter.revision, order: 'concede' }, now).player; break; }
    for (const command of ftlPolicyStep(encounter, 'smart').commands) {
      const applied = applyEncounterCommand(live, { acceptanceId: encounter.acceptanceId, revision: encounter.revision, command });
      if (applied.ok) live = applied.player;
    }
    live = applyEncounterAction(live, { acceptanceId: encounter.acceptanceId, revision: live.activeEncounter.revision }, now).player;
  }
  assert.equal(playOddsFight(player, args, real.seed, now), live.activeEncounter.result === 'win');

  // Deterministic, eight fixed seeds per offer, cached until the fight setup changes.
  assert.equal(oddsSeeds(offer.id).length, ODDS_SEEDS);
  assert.deepEqual(oddsSeeds(offer.id), oddsSeeds(offer.id));
  const t0 = process.hrtime.bigint();
  const odds = fightOdds(player, offer, now);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`win odds: ${ODDS_SEEDS} fights for one card in ${ms.toFixed(1)} ms (uncached)`);
  assert.equal(odds.fights, ODDS_SEEDS);
  assert.equal(odds.winPct, Math.round((odds.wins / ODDS_SEEDS) * 100));
  assert.equal(odds.label, threatLabel(args.threat));
  assert.equal(fightOdds(clone(player), offer, now), odds, 'a render that changes nothing replays nothing');
  clearFightOdds();
  assert.deepEqual(fightOdds(player, offer, now), odds, 'the same seeds give the same odds');
  // Swapping, levelling or hurting crew changes the fight, so the card plays it again.
  const trained = { ...player, crew: player.crew.map(member => recomputeCrew({ ...member, level: 9 })) };
  assert.notEqual(fightOdds(trained, offer, now), odds);
  const hurt = { ...player, ship: { ...player.ship, hull: 30 } };
  assert.ok(fightOdds(hurt, offer, now).winPct <= odds.winPct, 'a damaged ship never shows better odds');
});

// Bug found by the balance sims (a hired Isa Mender's hull patch): the payout records 0 hull lost when a fight
// ends above its starting hull, but the validator expected a negative loss, so the prize could never be claimed
// and a stuck Explore fight blocked every contract for the rest of the run.
test('a crew that patches the hull above where the fight started can still claim the prize', () => {
  const { player, now } = captain(4, { level: 9 });
  let p = acceptContract(player, risky(player).id, now).player;
  for (const id of ['launch', 'push']) p = commitContractAction(p, previewContractAction(p, { id }, now), { now, rng: () => 0 }).player;
  p = finishCrewFight(p, now);
  assert.equal(p.activeEncounter.result, 'win');
  const healedFight = { ...p.activeEncounter, startHull: p.activeEncounter.hull - 5 };
  assert.equal(fightHullLoss(healedFight), 0);
  assert.equal(resolveSimulatedCombatPayout(player, p.activeContract, healedFight, now).result.hullLoss, 0, 'payout and validator agree');
  const healed = { ...p, activeEncounter: healedFight, activeContract: { ...p.activeContract, result: { ...p.activeContract.result, hullLoss: 0 } } };
  assert.ok(migratePlayer(clone(healed)).activeContract, 'the settled fight survives a reload');
  assert.equal(claimContractReward(healed, now).ok, true);

  // The same on an Explore jump: the fight settles, validates and is claimed.
  let t = beginTravelFight(player, { ok: true, node: NODES.danger_belt, fuelCost: 0, outcome: { kind: 'combat', encounter: 'pirate_wing' } }, now).player;
  for (let beat = 0; beat < 200 && !t.activeEncounter.result; beat++) {
    t = applyTravelFightAction(t, { acceptanceId: t.activeTravelFight.fightId, revision: t.activeEncounter.revision }, now).player;
  }
  assert.equal(t.activeTravelFight.stage, 'return');
  const travel = { ...t, activeEncounter: { ...t.activeEncounter, startHull: Math.max(1, t.activeEncounter.hull - 5) },
    activeTravelFight: { ...t.activeTravelFight, result: { ...t.activeTravelFight.result, hullLoss: 0 } } };
  assert.equal(validTravelFight(travel), true);
  assert.equal(claimTravelFight(travel, { acceptanceId: travel.activeTravelFight.fightId, revision: travel.activeTravelFight.revision }).ok, true);
});

test('a simulated captain heads for the next gate until its sector opens, and takes the choice that opens it', () => {
  const { player: base, now } = captain(4);
  const player = { ...base, location: 'station_home', flags: { ...base.flags, wall_spur: true } };
  let walker = player;
  const path = [];
  for (let n = 0; n < 8 && walker.location !== 'veil_gate'; n++) {
    const hop = gateStep(walker, now);
    assert.ok(hop && hasLane(walker.location, hop), `hop ${n} follows a lane`);
    path.push(hop);
    walker = { ...walker, location: hop };
  }
  assert.equal(walker.location, 'veil_gate', `reached the gate: ${path.join(' > ')}`);
  assert.equal(gateStep({ ...player, flags: { ...player.flags, veil_opened: true } }, now), null, 'an open sector needs no gate run');
  assert.equal(gateStep(base, now), null, 'a gate held by its wall is not a destination');
  const ev = { templateId: 'gate_customs', nodeId: 'veil_gate', base: { kind: 'story', flag: GATE_OPENS.veil_gate }, seed: 7, eventId: 'event:veil_gate:1:7' };
  const share = choice => choice.outcomes.filter(o => o.story).reduce((s, o) => s + o.w, 0) / choice.outcomes.reduce((s, o) => s + o.w, 0);
  for (const policy of ['cautious', 'balanced', 'ambitious']) assert.equal(share(pickGateChoice(walker, ev, policy, now)), 1, policy);
});

test('contract cards and the review show the threat and the win odds in plain words', () => {
  clearFightOdds();
  const { player, now } = captain(4, { level: 3 });
  const offer = risky(player);
  assert.equal(sessionModels(player, {}, now).contractBoard.offers.find(o => o.id === offer.id).fightOdds, null, 'only the game render asks for odds');
  const models = sessionModels(player, {}, now, { fightOdds: true });
  const card = models.contractBoard.offers.find(o => o.id === offer.id);
  assert.deepEqual(card.fightOdds, fightOdds(player, offer, now));
  const html = renderContractBoard(models.contractBoard);
  assert.match(html, new RegExp(`Fight: <b>${card.fightOdds.label}</b> · ${card.fightOdds.text}`));
  assert.match(html, /aria-label="[^"]*Fight \w+, Win odds (about \d+%|over 90%|under 10%)"/);
  const review = sessionModels(player, { reviewedOfferId: offer.id }, now, { fightOdds: true }).contractReview;
  assert.match(renderContractReview(review), new RegExp(`Fight: <b>${card.fightOdds.label}</b> · ${card.fightOdds.text} with the crew aboard`));
  // An active contract hides the board: no odds are played for it.
  const busy = acceptContract(player, offer.id, now).player;
  assert.ok(sessionModels(busy, {}, now, { fightOdds: true }).contractBoard.offers.every(o => o.fightOdds === null));
  assert.deepEqual([8, 0, 6, 1].map(wins => oddsText(wins)), ['Win odds over 90%', 'Win odds under 10%', 'Win odds about 80%', 'Win odds about 10%']);
});
