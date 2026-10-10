import assert from 'node:assert/strict';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { prepareSession, sessionAction, sessionModels } from '../src/systems/sessionLoop.js';
import { assignStation } from '../src/systems/stations.js';
import { contractThreat, unlockedTactics, fightHullLoss } from '../src/systems/encounterState.js';
import { BURN } from '../src/systems/autoCombat.js';
import { enemyLoadout, RULES as FTL_RULES } from '../src/systems/ftlCombat.js';
import { renderShipEncounter } from '../src/ui/contractView.js';
import { renderFtlEnemy } from '../src/ui/ftlView.js';
import { encounterById } from '../src/systems/combat.js';
import { scaleSitePayout } from '../src/systems/economy.js';
import { resolveSimulatedCombatPayout, normalizeCurrencyReward } from '../src/systems/contractRewards.js';
import { validTravelFight, normalizeTravelFightState, beginTravelFight } from '../src/systems/travelFight.js';
import { previewTravel } from '../src/systems/travel.js';
import { shouldAutoAdvanceFight, beatDelayMs, FIGHT_BEAT_MS } from '../src/systems/fightPacing.js';
import { createGuidedBeatScheduler } from '../src/ui/guidedBeatScheduler.js';
import { renderOverlays, renderMissions } from '../src/ui/bridge.js';
import { createSeededRng } from '../src/sim/contractEconomy.js';

// Deterministic: the veteran's crew and every roll the test leaves unseeded come from one seed. A crew drawn
// from Math.random made the near-miss search below fail about one run in sixteen once fights got fairer.
Math.random = createSeededRng(4219);
const now = Date.UTC(2030, 8, 22, 12);
const LANE_A_SCOUT = { node: 'lane_a', rng: () => 0.6 };
const reload = player => migratePlayer(JSON.parse(JSON.stringify(player)));
const ident = player => ({ acceptanceId: player.activeEncounter.acceptanceId, revision: player.activeEncounter.revision });

// A realistic post-tutorial captain with everyone aboard and fuel to jump.
let veteran = completeFreshTutorial();
// Jumps follow lanes: start at Spur Anchor, one lane from Dust Lane and the Null Scrapyard.
veteran = { ...veteran, location: 'station_home', activeContract: null, activeEncounter: null, activeExpedition: null,
  crew: veteran.crew.map(c => ({ ...c, status: 'ready', injuredUntil: 0 })), wallet: { ...veteran.wallet, fuel: 10, gems: 0 } };
const gunner = veteran.crew.find(c => c.role === 'gunner');
const staffed = assignStation(veteran, gunner.instanceId, 'weapons', now).player;

function act(player, name, data = {}, options = {}) {
  return sessionAction(player, {}, name, data, { now, ...options });
}
function jump(player, { node, rng } = LANE_A_SCOUT) {
  const result = act(player, 'travel-to', { node }, { rng });
  assert.equal(result.ok, true, result.reason);
  return result;
}
/** Hands-off to the end (conceding a downed crew), checking every beat survives a reload unchanged. */
function playOut(player, { orderFor = () => null, reloadEachBeat = true } = {}) {
  let beats = 0;
  while (player.activeTravelFight.stage === 'fight' && beats < 200) {
    if (reloadEachBeat) {
      const restored = reload(player);
      assert.deepEqual(restored.activeTravelFight, player.activeTravelFight, `binding survives reload at beat ${beats}`);
      assert.deepEqual(restored.activeEncounter, player.activeEncounter, `snapshot survives reload at beat ${beats}`);
      player = restored;
    }
    const order = player.activeEncounter.phase === 'downed' ? 'concede' : orderFor(player);
    const result = act(player, order ? 'encounter-order' : 'encounter-advance', { ...ident(player), order });
    assert.equal(result.ok, true, result.reason);
    player = result.player;
    beats += 1;
  }
  return { player, beats };
}

// 1. A combat jump opens a crew fight on the ship: fuel paid, no % menu, arrival deferred.
{
  const before = staffed;
  const started = jump(before);
  const player = started.player;
  const fight = player.activeTravelFight;
  assert.equal(started.ui.pendingCombat, null);
  assert.equal(started.ui.tab, 'ship');
  assert.equal(fight.stage, 'fight');
  assert.equal(fight.encounterId, 'pirate_scout');
  assert.equal(player.wallet.fuel, before.wallet.fuel - fight.fuelSpent);
  assert.equal(player.location, before.location, 'location moves when the prize is claimed');
  assert.deepEqual(player.stats, before.stats, 'no visit or jump recorded mid-fight');
  const encounter = player.activeEncounter;
  assert.equal(encounter.kind, 'normal');
  assert.equal(encounter.version, 3, 'Explore jumps fight as FTL-lite fights');
  assert.equal(encounter.acceptanceId, fight.fightId);
  // Threat and damage come from the contract power model.
  assert.equal(encounter.enemy.threat, contractThreat(before, { encounterId: 'pirate_scout' }, now));
  // Explore fights bring the crew's kits, so the enemy fights as a kit-fight enemy.
  assert.ok(encounter.fx && encounter.crew.every(member => typeof member.kit === 'string'), 'the crew fight with their signature moves');
  assert.deepEqual(encounter.enemy.weapons.map(w => w.damage), enemyLoadout(encounter.enemy.threat, { kits: true }).weapons.map(w => w.damage));
  assert.equal(encounter.hull, before.ship.hull, 'the fight runs on the ship\'s own hull');
  assert.deepEqual(Object.keys(encounter.tactics), unlockedTactics(before));
  assert.equal(validTravelFight(player), true);
  assert.equal(shouldAutoAdvanceFight(player), true);
  assert.equal(beatDelayMs(encounter), 1000, 'real time: one beat per second');
  assert.ok(started.events.some(e => e.event === 'travel_fight_started'));

  // Same fight screen as contracts: the enemy ship with targetable rooms, and the controls strip.
  const models = sessionModels(player, {}, now);
  assert.equal(models.combatOrders, null);
  const enemy = renderFtlEnemy(models.activeTravelView.encounter);
  assert.match(enemy, /Pirate Scout/);
  assert.match(enemy, new RegExp(models.activeTravelView.encounter.threatLabel));
  assert.match(enemy, /data-command-type="target" data-room="weapons"/);
  const html = renderShipEncounter(models.activeTravelView);
  assert.match(html, /class="ftl-controls"/);
  assert.match(html, /data-order="burn"/);
  assert.doesNotMatch(html, /combat-orders|Choose Brace/);
  // Explore map is locked while the crew fights; contracts wait too.
  const map = renderMissions(player, now, { missionView: 'explore' });
  assert.match(map, /id="explore-fight-lock"/);
  assert.equal(act(player, 'travel-to', { node: 'danger_belt' }).reason, 'combat_pending');
  assert.equal(act(player, 'contract-review', { offer: player.contractBoard.offers[0].id }).reason, 'travel_fight_active');
  assert.equal(act(player, 'contract-accept', { offer: player.contractBoard.offers[0].id }).reason, 'travel_fight_active');
  assert.equal(act(player, 'travel-claim', { acceptanceId: fight.fightId, revision: fight.revision }).reason, 'encounter_not_finished');
}

// 2. Determinism and reload safety at every beat; a win pays the scaled catalog prize on claim.
{
  // Seeds follow the save's identity and jump count; find a staffed jump that wins hands-off.
  let winner = null;
  for (let jumps = 0; jumps < 50 && !winner; jumps += 1) {
    const candidate = { ...staffed, stats: { ...staffed.stats, jumps } };
    if (playOut(jump(candidate).player, { reloadEachBeat: false }).player.activeEncounter.result === 'win') winner = candidate;
  }
  assert.ok(winner, 'a staffed crew wins a Scout fight hands-off');
  const a = playOut(jump(winner).player);
  const b = playOut(jump(winner).player, { reloadEachBeat: false });
  assert.deepEqual(a.player.activeEncounter, b.player.activeEncounter, 'same inputs, same fight');
  assert.ok(a.beats >= 15 && a.beats <= 70, `fight ${a.beats} s outside 15-70 s`);
  let player = a.player;
  const fight = player.activeTravelFight;
  assert.equal(player.activeEncounter.result, 'win');
  assert.equal(fight.stage, 'return');
  const visitsBefore = winner.stats.visits.lane_a || 0;
  assert.deepEqual(fight.result.rewards, normalizeCurrencyReward(scaleSitePayout(encounterById('pirate_scout').rewards, winner, { kind: 'combat', visits: visitsBefore })));
  assert.equal(fight.result.hullLoss, fightHullLoss(player.activeEncounter));
  assert.equal(player.ship.hull, player.activeEncounter.hull, 'the ship keeps the hull the fight left it');
  assert.equal(player.stats.combatsWon, (winner.stats.combatsWon || 0) + 1);
  const participant = player.crew.find(c => fight.participantIds.includes(c.instanceId));
  assert.ok(participant.xp > winner.crew.find(c => c.instanceId === participant.instanceId).xp || participant.level > winner.crew.find(c => c.instanceId === participant.instanceId).level, 'crew XP granted');
  // A settled fight also survives reload, and the claim button is the travel claim.
  player = reload(player);
  assert.equal(player.activeTravelFight.stage, 'return');
  const models = sessionModels(player, {}, now);
  assert.match(renderShipEncounter(models.activeTravelView), /data-act="travel-claim"[^>]*>Bring cargo aboard/);
  assert.equal(act(player, 'encounter-advance', ident(player)).reason, 'encounter_finished');
  assert.equal(act(player, 'travel-claim', { acceptanceId: 'travel:other', revision: fight.revision }).reason, 'stale_encounter_action');
  const walletBefore = player.wallet;
  const claimed = act(player, 'travel-claim', { acceptanceId: fight.fightId, revision: fight.revision });
  assert.equal(claimed.ok, true);
  player = claimed.player;
  assert.equal(player.activeTravelFight, null);
  assert.equal(player.activeEncounter, null);
  assert.equal(player.location, 'lane_a');
  assert.equal(player.stats.visits.lane_a, visitsBefore + 1);
  assert.equal(player.stats.jumps, (winner.stats.jumps || 0) + 1);
  assert.equal(player.stats.contractsCompleted, winner.stats.contractsCompleted, 'Explore fights are not contracts');
  assert.equal(player.wallet.credits, walletBefore.credits + fight.result.rewards.credits);
  assert.equal(player.wallet.medals, walletBefore.medals + fight.result.rewards.medals);
  assert.equal(claimed.effect.kind, 'travel');
  assert.equal(claimed.effect.result.combat.crewFight, true);
  assert.equal(act(player, 'travel-claim', { acceptanceId: fight.fightId, revision: fight.revision }).reason, 'already_claimed');
}

// 3. A loss settles to the same salvage share a contract loss pays, and still completes the jump.
{
  const stranded = { ...staffed, crew: staffed.crew.map(c => ({ ...c, status: 'injured', injuredUntil: now + 3600000 })) };
  const started = jump(stranded).player;
  assert.equal(started.activeEncounter.enemy.threat, 1.6, 'no ready crew is a Deadly fight');
  let lastLive = started;
  let player = started;
  while (player.activeTravelFight.stage === 'fight') {
    lastLive = player;
    const order = player.activeEncounter.phase === 'downed' ? 'concede' : null;
    player = act(player, order ? 'encounter-order' : 'encounter-advance', { ...ident(player), order }).player;
  }
  assert.equal(player.activeEncounter.result, 'loss');
  assert.equal(player.activeTravelFight.result.success, false);
  const asContract = resolveSimulatedCombatPayout({ ...lastLive, activeEncounter: player.activeEncounter },
    { encounterId: 'pirate_scout', profile: 'risky', destinationId: 'lane_a', participantIds: started.activeTravelFight.participantIds }, player.activeEncounter, now);
  assert.deepEqual(player.activeTravelFight.result.rewards, asContract.result.rewards);
  assert.ok(player.activeTravelFight.result.rewards.credits > 0, "salvage pays something");
  const models = sessionModels(player, {}, now);
  assert.match(renderShipEncounter(models.activeTravelView), /Collect salvage/);
  const claimed = act(player, 'travel-claim', { acceptanceId: player.activeTravelFight.fightId, revision: player.activeTravelFight.revision }).player;
  assert.equal(claimed.location, 'lane_a');
  assert.equal(claimed.activeTravelFight, null);
}

// 4. Burn (fuel), Board and boarders run through the travel binding exactly as in contracts.
{
  let player = jump(staffed).player;
  const fuel = player.wallet.fuel;
  player = act(player, 'encounter-order', { ...ident(player), order: 'burn' }).player;
  assert.equal(player.wallet.fuel, fuel - BURN.fuel);
  assert.equal(player.activeEncounter.tactics.burn.uses, 1);
  assert.equal(act({ ...player, wallet: { ...player.wallet, fuel: 0 } }, 'encounter-order', { ...ident(player), order: 'burn' }).ok, false);
  // Scrapper Gang docks boarders; sending crew to the boarded room is a move command.
  let scrap = jump(staffed, { node: 'scrapyard', rng: () => 0.95 }).player;
  assert.equal(scrap.activeTravelFight.encounterId, 'scrapper_gang');
  assert.ok(scrap.activeEncounter.boarders, 'boarders armed');
  while (scrap.activeEncounter.boarders.phase !== 'aboard' && !scrap.activeEncounter.result) {
    scrap = act(scrap, 'encounter-advance', ident(scrap)).player;
  }
  if (!scrap.activeEncounter.result) {
    const room = scrap.activeEncounter.boarders.room;
    const sent = act(scrap, 'encounter-command', { ...ident(scrap), command: { type: 'move', crewId: gunner.instanceId, room } });
    assert.equal(sent.ok, true, sent.reason);
    assert.equal(sent.player.activeEncounter.intent.moves[gunner.instanceId], room);
    assert.equal(sent.player.activeEncounter.revision, scrap.activeEncounter.revision, 'commands do not advance time');
    assert.equal(validTravelFight(reload(sent.player)), true);
    const moved = act(sent.player, 'encounter-advance', ident(sent.player)).player;
    assert.equal(moved.activeEncounter.crew.find(c => c.id === gunner.instanceId).room, room);
  }
}

// 5. Downed near-misses offer Rally; the first is free, as in contracts.
{
  let downed = null;
  // No gunner on Weapons and a battered hull (damage carries over in v3): close fights.
  const weak = { ...veteran, ship: { ...veteran.ship, hull: 30 } };
  for (let jumps = 0; jumps < 300 && !downed; jumps += 1) {
    let player = jump({ ...weak, stats: { ...weak.stats, jumps } }).player;
    for (let i = 0; i < 200 && player.activeTravelFight.stage === 'fight' && player.activeEncounter.phase !== 'downed'; i += 1) {
      player = act(player, 'encounter-advance', ident(player)).player;
    }
    if (player.activeEncounter.phase === 'downed') downed = player;
  }
  assert.ok(downed, 'a near-miss travel fight exists within 300 seeds');
  assert.equal(reload(downed).activeEncounter.phase, 'downed');
  const view = sessionModels(downed, {}, now).activeTravelView.encounter;
  assert.equal(view.downed.free, true);
  assert.match(renderShipEncounter(sessionModels(downed, {}, now).activeTravelView), /data-order="rally"/);
  const rallied = act(downed, 'encounter-order', { ...ident(downed), order: 'rally' });
  assert.equal(rallied.ok, true, rallied.reason);
  assert.equal(rallied.player.flags.rallyFreeUsed, true);
  assert.equal(rallied.player.activeEncounter.rally.used, true);
  const finished = playOut(rallied.player).player;
  assert.equal(finished.activeTravelFight.stage, 'return');
}

// 6. Stale and tampered state never advances or pays.
{
  const player = jump(staffed).player;
  assert.equal(act(player, 'encounter-advance', { ...ident(player), revision: 5 }).reason, 'stale_encounter_action');
  assert.equal(act(player, 'encounter-advance', { ...ident(player), acceptanceId: 'travel:lane_a:1:1' }).reason, 'stale_encounter_action');
  assert.equal(act(player, 'encounter-recover', ident(player)).reason, 'invalid_encounter_state');
  const tampered = [
    { ...player, activeEncounter: { ...player.activeEncounter, enemy: { ...player.activeEncounter.enemy, hull: 0 } } },
    { ...player, activeEncounter: { ...player.activeEncounter, seed: player.activeEncounter.seed + 1 } },
    { ...player, activeTravelFight: { ...player.activeTravelFight, revision: 3 } },
    { ...player, activeTravelFight: { ...player.activeTravelFight, nodeId: 'nowhere' } },
    { ...player, activeTravelFight: { ...player.activeTravelFight, stage: 'return' } },
    { ...player, activeEncounter: { ...player.activeEncounter, enemy: { ...player.activeEncounter.enemy, weapons: player.activeEncounter.enemy.weapons.map(w => ({ ...w, damage: 1 })) } } },
    { ...player, activeEncounter: null },
  ];
  for (const bad of tampered) {
    assert.equal(validTravelFight(bad), false);
    assert.equal(act(bad, 'encounter-advance', ident(player)).reason, 'invalid_encounter_state');
    const restored = reload(bad);
    assert.equal(restored.activeTravelFight, null);
    assert.equal(restored.activeEncounter, null);
    assert.equal(restored.recoveryEvents.at(-1).event, 'travel_fight_recovered');
  }
  // A travel fight can never sit beside a contract: the contract keeps its state.
  const accepted = act(staffed, 'contract-accept', { offer: staffed.contractBoard.offers[0].id }).player;
  const both = normalizeTravelFightState({ ...accepted, activeTravelFight: player.activeTravelFight });
  assert.equal(both.activeTravelFight, null);
  assert.deepEqual(both.activeContract, accepted.activeContract);
  assert.equal(beginTravelFight(accepted, previewTravel(accepted, 'lane_a', { rng: () => 0.6 }), now).reason, 'active_contract');
}

// 7. Old saves still load: no travel binding field, orphan encounters cleared, legacy menu only for in-memory jumps.
{
  const old = { ...createNewPlayer({ tutorialScript: 4, now }), tutorial: { script: 3, completed: true, phase: 'done' } };
  delete old.activeTravelFight;
  const loaded = reload(old);
  assert.equal(loaded.activeTravelFight, undefined);
  const orphan = reload({ ...old, activeEncounter: jump(staffed).player.activeEncounter });
  assert.equal(orphan.activeEncounter, null);
  const pendingCombat = previewTravel(prepareSession(old, now), 'lane_a', { rng: () => 0.6 });
  const legacy = sessionAction(prepareSession(old, now), { pendingCombat }, 'combat-order', { order: 'brace' }, { now, rng: () => 0 });
  assert.equal(legacy.ok, true, 'in-flight legacy jump still resolves by dice');
  assert.equal(legacy.ui.pendingCombat, null);
  assert.equal(legacy.player.activeTravelFight, undefined);
}

// 8. The real-time scheduler drives travel beats and holds while hidden or off the Ship tab.
{
  let player = jump(staffed).player;
  let paused = true;
  const timers = [];
  const scheduler = createGuidedBeatScheduler({
    getPlayer: () => player,
    isBattlePlaying: () => false,
    isPaused: () => paused,
    advance: async data => {
      const result = act(player, 'encounter-advance', data);
      if (result.ok) player = result.player;
      return result;
    },
    setTimer: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
    clearTimer: () => {},
  });
  assert.equal(scheduler.schedule(), true);
  assert.equal(timers.at(-1).ms, 1000);
  await timers.at(-1).callback();
  assert.equal(player.activeEncounter.beat, 0, 'paused fights do not advance');
  paused = false;
  await timers.at(-1).callback();
  await timers.at(-1).callback();
  assert.equal(player.activeEncounter.beat, 1, 'resumed fight advances one beat per tick');
  for (let i = 0; i < 200 && player.activeTravelFight.stage === 'fight' && player.activeEncounter.phase !== 'downed'; i += 1) await timers.at(-1).callback();
  // A downed crew waits for the captain's Rally-or-salvage choice instead of auto-advancing.
  if (player.activeEncounter.phase === 'downed') {
    assert.equal(shouldAutoAdvanceFight(player), false);
    player = act(player, 'encounter-order', { ...ident(player), order: 'concede' }).player;
  }
  assert.equal(player.activeTravelFight.stage, 'return');
  assert.equal(shouldAutoAdvanceFight(player), false);
}

console.log('explore_crew_fight.test.mjs OK');
