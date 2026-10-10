// Phase 3: enemy factions, elites and twists in the fight (docs/superpowers/specs/2026-10-10-world-design.md §3-4).
// The success tests, numbers in docs/qa/2026-10-10-faction-mechanics.md:
//   1. each faction's rule fires in its fights, and fights without the new blocks play bit for bit as before;
//   2. the sharp captain (plays the counters) wins 5+ points more often than a hands-off Auto captain;
//   3. a hands-off Auto captain wins within 8 points of before, faction by faction;
//   4. each twist changes the fight or the pay as written; bad twists and edited fights are refused; reloads hold.
// FACTION_EVIDENCE=1 node --test test/factions.test.mjs also plays a bigger sample and rewrites the report.
// FACTION_FIXTURE=1 rebuilds test/fixtures/reference-crews-day7.json from the 30-day simulator (about a minute).
process.env.TZ = 'UTC';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { FACTIONS, ENCOUNTER_FACTION, ELITE_NAMES, ELITE_MODIFIERS, factionOf, validElite } from '../src/data/factions.js';
import { TWISTS, TWIST_RULES, validTwist, describeTwist, applyTwistPay } from '../src/data/twists.js';
import {
  startFtlEncounter, advanceFtlEncounter, applyFtlCommand, ftlPolicyStep, validFtlBody, enemyLoadout, ftlTwistOutcome,
  ftlMechanicsView, FACTION_RULES, ELITE_RULES, KIT_ENEMY, MAX_FIGHT_BEATS, WEAPON_CATALOG, regrowBudget, enemyWaveHull,
} from '../src/systems/ftlCombat.js';
import { crewFightSetup, startCrewFight, contractFightArgs, fightingCrew, enemyTierFor, normalizeEncounterState, applyEncounterAction, applyEncounterCommand } from '../src/systems/encounterState.js';
import { resolveSimulatedCombatPayout } from '../src/systems/contractRewards.js';
import { generateContractBoard, acceptContract, previewContractAction, commitContractAction, contractRewardBand, normalizeContractState } from '../src/systems/contracts.js';
import { offerFightContract } from '../src/systems/fightOdds.js';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { sessionModels } from '../src/systems/sessionLoop.js';
import { renderFtlEnemy, renderFtlControls, renderFtlShipMarkers } from '../src/ui/ftlView.js';
import { ENCOUNTERS_V1, COMBAT_ORDERS } from '../src/systems/combat.js';
import { BOARDING_ENEMIES } from '../src/systems/autoCombat.js';
import { SFX } from '../src/data/sfxManifest.js';

const FIXTURE = new URL('./fixtures/reference-crews-day7.json', import.meta.url);
const REPORT = new URL('../docs/qa/2026-10-10-faction-mechanics.md', import.meta.url);

if (process.env.FACTION_FIXTURE) {
  // The balance pass's reference crews: the guided simulator's 15 captains at the end of day 7, healed and aboard.
  const { simulateFreePlayer30Days, ECONOMY_SEEDS, STRATEGIES } = await import('../src/sim/contractEconomy.js');
  const KEEP = ['captainInstanceId', 'crewSlots', 'stationAssignments', 'ship', 'flags', 'tutorial'];
  const lean = member => Object.fromEntries(Object.entries(member).filter(([key]) => !['quote', 'history', 'blurb', 'origin', 'species', 'faction'].includes(key)));
  const captains = Object.keys(STRATEGIES).flatMap(strategy => ECONOMY_SEEDS.map(seed => {
    let snap = null;
    simulateFreePlayer30Days({ seed, strategy, flow: 'guided', days: 7, onDayEnd: (player, day) => { snap = { player: structuredClone(player), now: day.now }; } });
    const full = { ...snap.player, ship: { ...snap.player.ship, hull: 100 }, crew: snap.player.crew.map(member => ({ ...member, status: 'ready', injuredUntil: 0 })) };
    const player = { ...Object.fromEntries(KEEP.map(key => [key, full[key]])), crew: full.crew.map(lean),
      reserve: (full.reserve || []).map(member => ({ instanceId: member.instanceId, templateId: member.templateId, role: member.role, status: member.status })),
      stats: { contractsCompleted: full.stats.contractsCompleted }, contractBoard: { completedOfferIds: full.contractBoard.completedOfferIds }, wallet: full.wallet };
    return { strategy, seed, now: snap.now, player };
  }));
  writeFileSync(FIXTURE, `${JSON.stringify({ note: "The guided 30-day simulator's 15 captains at the end of day 7 (fights-first, the balance pass reference crews), crew healed and aboard, hull 100. Made by FACTION_FIXTURE=1 node test/factions.test.mjs.", captains })}\n`);
}
const { captains } = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const pct = (wins, fights) => Math.round((wins / fights) * 1000) / 10;

// --- The reference fights -------------------------------------------------------------------------------
// Contested content: each faction's encounters, at a threat where a day-7 crew wins roughly 70-85% of fights
// hands-off on the engine before factions (enemy class 0: 1.5, class 1: 1.2, class 2: 1.0), at hull 100 and 70.
// At contract threat these crews win about every fight, so no rule could show there (balance pass 2026-10-09).
const CONTESTED_THREAT = [1.5, 1.2, 1.0];
const HULLS = [100, 70];
const FACTION_ENCOUNTERS = Object.fromEntries(Object.keys(FACTIONS).map(id => [id, Object.keys(ENCOUNTER_FACTION).filter(e => ENCOUNTER_FACTION[e] === id)]));
/** Who boarded before Phase 3: the "before" fights rebuild today's engine exactly (faction and twist blocks off). */
const BOARDING_BEFORE = ['scrapper_gang', 'ice_raiders', 'corsair_king'];

/** The same seeded fights for every policy: one distinct seed per fight. */
function referenceFights(faction, { fights = 240, seedBase = 5000 } = {}) {
  const ids = FACTION_ENCOUNTERS[faction];
  const seeds = Math.max(1, Math.round(fights / (ids.length * captains.length * HULLS.length)));
  const list = [];
  for (const [e, encounterId] of ids.entries()) for (const [c, { player, now }] of captains.entries()) for (const [h, hull] of HULLS.entries()) {
    for (let i = 0; i < seeds; i += 1) {
      const seed = (seedBase + i * 7919 + c * 104729 + h * 1299709 + e * 15485863) % 2147483647;
      list.push({ encounterId, setup: crewFightSetup({ ...player, ship: { ...player.ship, hull } },
        { acceptanceId: 'faction-evidence', encounterId, seed, threat: CONTESTED_THREAT[enemyTierFor(encounterId)] }, now) });
    }
  }
  return list;
}
const beforeFight = ({ encounterId, setup }) => startFtlEncounter({ ...setup, faction: null, twist: null, boarders: setup.boarders && BOARDING_BEFORE.includes(encounterId) });
const afterFight = ({ setup }) => startFtlEncounter(setup);

/** One scripted fight to its end, Auto on (abilities cast themselves); a downed crew concedes. */
function play(state, policy) {
  state = applyFtlCommand(state, { type: 'auto', auto: true }).state || state;
  const types = new Set();
  for (let beat = 0; beat < MAX_FIGHT_BEATS && state.result === null; beat += 1) {
    if (state.phase === 'downed') break;
    for (const command of ftlPolicyStep(state, policy).commands) {
      const applied = applyFtlCommand(state, command);
      if (applied.ok) state = applied.state;
    }
    const advanced = advanceFtlEncounter(state, null);
    for (const event of advanced.events) types.add(event.type === 'shot' ? `shot:${event.from}:${event.weapon}${event.cloaked ? ':cloaked' : ''}` : event.type);
    state = advanced.state;
  }
  return { win: state.result === 'win', state, types };
}

function winRates(faction, sample) {
  const fights = referenceFights(faction, sample);
  const rows = { before: 0, idle: 0, sharp: 0, ...(sample?.smart ? { smart: 0, beforeSmart: 0 } : {}) };
  const types = new Set();
  for (const fight of fights) {
    rows.before += play(beforeFight(fight), 'idle').win ? 1 : 0;
    const idle = play(afterFight(fight), 'idle');
    rows.idle += idle.win ? 1 : 0;
    for (const type of idle.types) types.add(type);
    rows.sharp += play(afterFight(fight), 'sharp').win ? 1 : 0;
    if (sample?.smart) {
      rows.smart += play(afterFight(fight), 'smart').win ? 1 : 0;
      rows.beforeSmart += play(beforeFight(fight), 'smart').win ? 1 : 0;
    }
  }
  return { fights: fights.length, wins: rows, rates: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, pct(v, fights.length)])), types };
}

// Measured on the engine before factions (commit de4ccd7) with this exact sample: wins of 240 hands-off fights.
const RECORDED_BEFORE = { corsairs: 161, scrappers: 161, swarm: 165, ice: 171, shades: 180, wardens: 195, eclipse: 203 };
/** Factions whose counter the sharp captain plays in the fight itself (Scrappers and Swarm ask for crew and guns). */
const COUNTERED = ['corsairs', 'ice', 'shades', 'wardens', 'eclipse'];
/** The rule each faction's fights must show. */
const SIGNS = {
  corsairs: ['shot:enemy:missile', 'boarders_landed'],
  scrappers: ['boarders_landed'],
  swarm: ['shot:enemy:drones', 'regrow'],
  ice: ['shot:enemy:ion', 'ion_lock', 'boarders_landed'],
  shades: ['cloak', 'shot:player:burst:cloaked'],
  wardens: [],
  eclipse: ['cloak', 'regrow', 'shot:player:burst:cloaked'],
};

const results = {};
test('success tests 1-3: every faction rule fires; sharp beats hands-off; hands-off stays near before', () => {
  for (const faction of Object.keys(FACTIONS)) results[faction] = winRates(faction);
  const lines = Object.entries(results).map(([faction, r]) => `  ${faction.padEnd(9)} before ${r.rates.before}%  Auto ${r.rates.idle}%  sharp ${r.rates.sharp}%`);
  console.log(`faction win rates (${results.corsairs.fights} fights each, day-7 crews, contested threat, hull 100/70):\n${lines.join('\n')}`);
  for (const [faction, r] of Object.entries(results)) {
    assert.equal(r.wins.before, RECORDED_BEFORE[faction], `${faction}: the before fights replay the old engine exactly`);
    for (const sign of SIGNS[faction]) assert.ok(r.types.has(sign), `${faction}: ${sign} happens in its fights`);
    assert.ok(Math.abs(r.rates.idle - r.rates.before) <= 8, `${faction}: Auto ${r.rates.idle}% vs ${r.rates.before}% before`);
    if (COUNTERED.includes(faction)) assert.ok(r.rates.sharp - r.rates.idle >= 5, `${faction}: sharp ${r.rates.sharp}% vs Auto ${r.rates.idle}%`);
  }
});

test('success test 1: harmonics recharge Warden shields twice as fast while their Shields room is above half', () => {
  const { player, now } = captains[0];
  const fresh = startCrewFight(player, { acceptanceId: 'h', encounterId: 'crown_warden', seed: 3, threat: 1 }, now);
  const plain = startFtlEncounter({ ...crewFightSetup(player, { acceptanceId: 'h', encounterId: 'crown_warden', seed: 3, threat: 1 }, now), faction: null });
  // Their shields down, our guns cold and our moves on hold: only the recharge moves this beat.
  const drained = state => {
    const s = structuredClone(state);
    s.enemy.shields.layers = 0;
    s.enemy.shields.rechargeMs = 0;
    s.weapons.forEach(w => { w.chargeMs = 0; });
    s.intent.auto = false;
    return s;
  };
  const after = (state, room = 100) => {
    const s = drained(state);
    s.enemy.rooms.shields.integrity = room;
    return advanceFtlEncounter(s).state.enemy.shields;
  };
  assert.equal(after(fresh).rechargeMs, 2 * after(plain).rechargeMs, 'twice the recharge in a beat');
  assert.equal(after(fresh, 40).rechargeMs, after(plain, 40).rechargeMs, 'below half the room, ordinary recharge');
  assert.equal(ftlMechanicsView(fresh).harmonics.active, true);
});

test('success test 1: fights without faction or twist blocks replay bit for bit as before', () => {
  // A golden replay recorded on the engine before factions (commit de4ccd7): kit and plain crews, boarders,
  // tactics, a wall segment and the guided fight, under the idle, smart and initiative captains.
  const hash = createHash('sha256');
  let beats = 0;
  const PLAIN = [{ id: 'cap', role: 'pilot', station: 'helm' }, { id: 'gun', role: 'gunner', station: 'weapons' }, { id: 'eng', role: 'engineer', station: null }];
  for (const [c, { player, now }] of captains.slice(0, 5).entries()) {
    const kits = fightingCrew(player, now, { kits: true });
    for (const [k, setup] of [
      { encounterId: 'pirate_ace', threat: 1.3, crew: kits, tactics: ['burn', 'board'], boarders: true, auto: true, enemyTier: 0, shipLevels: { shields: 3, weapons: 2, engines: 4, sensors: 3 } },
      { encounterId: 'veil_wraith', threat: 1.1, crew: kits, tactics: ['burn'], boarders: false, auto: true, enemyTier: 1, loadout: ['burst', 'heavy', 'ion'], shipLevels: { shields: 6, weapons: 4, engines: 2, sensors: 1 } },
      { encounterId: 'swarm_frigate', threat: 1.2, crew: kits, enemyHull: 30, remainingBefore: 90, flagship: 2, enemyTier: 1, auto: true },
      { encounterId: 'scrapper_gang', threat: 1, crew: PLAIN, boarders: true, tactics: ['burn', 'board'] },
      { encounterId: 'pirate_scout', threat: 0.6, crew: PLAIN, enemyHull: 25, guided: true },
    ].entries()) {
      for (const policy of ['idle', 'smart', 'initiative']) {
        let state = startFtlEncounter({ acceptanceId: `golden:${c}:${k}`, seed: 4242 + c * 97 + k * 13, hull: 90, ...setup });
        hash.update(JSON.stringify(state));
        for (let beat = 0; beat < 200 && state.result === null; beat += 1) {
          let order = null;
          if (state.phase === 'downed') order = beat % 2 ? 'rally' : 'concede';
          else {
            const step = ftlPolicyStep(state, policy);
            for (const command of step.commands) { const applied = applyFtlCommand(state, command); if (applied.ok) state = applied.state; }
            order = step.order;
          }
          let advanced = advanceFtlEncounter(state, order);
          if (advanced.ok === false) advanced = advanceFtlEncounter(state, state.phase === 'downed' ? 'concede' : null);
          state = advanced.state;
          hash.update(JSON.stringify(advanced.events));
          hash.update(JSON.stringify(state));
          hash.update(String(validFtlBody(state)));
          beats += 1;
        }
      }
    }
  }
  assert.equal(beats, 1668);
  assert.equal(hash.digest('hex'), '3c2402deca476f44da45c1ca4a677e04bc41957d3213b9495fdaefdee393e832');
});

test('factions: the table, the encounter map, elites and the cloak, regrowth and ion rules', () => {
  assert.deepEqual(Object.keys(FACTIONS), ['corsairs', 'scrappers', 'swarm', 'ice', 'shades', 'wardens', 'eclipse']);
  for (const f of Object.values(FACTIONS)) {
    for (const key of ['name', 'chip', 'mechanic', 'counter']) assert.ok(typeof f[key] === 'string' && f[key].trim(), `${f.id} ${key}`);
    assert.match(f.chip, / · /);
    assert.ok(ELITE_NAMES[f.id].length >= 3, `${f.id} has elite names`);
  }
  for (const encounter of ENCOUNTERS_V1) assert.ok(factionOf(encounter.id), `${encounter.id} has a faction`);
  assert.equal(factionOf('pirate_ace').id, 'corsairs');
  assert.equal(factionOf('eclipse_throne').id, 'wardens');
  assert.equal(factionOf('nobody'), null);
  assert.deepEqual([...BOARDING_ENEMIES].sort(), ['corsair_king', 'ember_raider', 'ice_raiders', 'pirate_ace', 'scrapper_gang']);
  assert.ok(validElite({ name: 'Two-Tooth Marrik', modifier: 'armored' }));
  assert.ok(!validElite({ name: 'Two-Tooth Marrik', modifier: 'shiny' }) && !validElite({ name: 'Somebody', modifier: 'heavy' }));
  for (const name of ['missile', 'drones', 'ion_shot', 'ion_lock', 'cloak', 'decloak', 'regrow', 'wave']) assert.ok(SFX[name], `${name} sound`);

  // Cloak: on its rhythm, shots fired into it miss, a held gun keeps its charge, a wrecked Helm cannot cloak.
  const { player, now } = captains[2];
  let shade = startCrewFight(player, { acceptanceId: 'c', encounterId: 'veil_wraith', seed: 11, threat: 0.9 }, now);
  for (let i = 1; i < FACTION_RULES.cloak.first; i += 1) shade = advanceFtlEncounter(shade).state;
  assert.equal(shade.result, null);
  const held = structuredClone(applyFtlCommand(shade, { type: 'hold', hold: true }).state);
  held.intent.auto = false;
  held.weapons.forEach(w => { w.chargeMs = WEAPON_CATALOG[w.id].chargeMs; });
  const gunShots = events => events.filter(e => e.type === 'shot' && e.from === 'player' && e.weapon !== 'ability');
  const cloaked = advanceFtlEncounter(held);
  assert.ok(cloaked.events.some(e => e.type === 'cloak' && e.on), 'the cloak goes up on its beat');
  assert.ok(cloaked.state.weapons.every(w => w.chargeMs === WEAPON_CATALOG[w.id].chargeMs), 'held guns keep their charge');
  assert.equal(gunShots(cloaked.events).length, 0, 'nothing fired while holding');
  assert.equal(validFtlBody(cloaked.state), true);
  const loose = advanceFtlEncounter({ ...structuredClone(held), intent: { ...held.intent, hold: false } });
  assert.ok(gunShots(loose.events).length > 0 && gunShots(loose.events).every(e => e.outcome === 'miss' && e.cloaked), 'shots fired into a cloak miss');
  const wrecked = structuredClone(shade);
  wrecked.enemy.rooms.helm.integrity = 40;
  assert.ok(advanceFtlEncounter(wrecked).events.some(e => e.type === 'cloak_failed'), 'a Helm below half cannot cloak');

  // Regrowth: one a beat, never while burning, never past its budget.
  const swarm = structuredClone(startCrewFight(player, { acceptanceId: 'r', encounterId: 'swarm_brood', seed: 5, threat: 1 }, now));
  swarm.enemy.hull = 20;
  swarm.weapons.forEach(w => { w.chargeMs = 0; });
  swarm.intent.auto = false;
  const grown = advanceFtlEncounter(swarm);
  assert.equal(grown.state.enemy.hull, 21, 'it grows back one a beat');
  assert.equal(grown.state.faction.regrown, 1);
  assert.ok(grown.events.some(e => e.type === 'regrow' && e.amount === 1));
  assert.equal(validFtlBody(grown.state), true);
  const burning = structuredClone(swarm);
  burning.enemy.rooms.engines.fire = 100;
  assert.equal(advanceFtlEncounter(burning).state.faction.regrown, 0, 'a fire stops regrowth');
  const spent = structuredClone(swarm);
  spent.faction.regrown = regrowBudget(spent);
  assert.equal(advanceFtlEncounter(spent).state.enemy.hull, 20, 'no regrowth past the budget');
  assert.equal(regrowBudget(swarm), Math.round(KIT_ENEMY.hull * FACTION_RULES.regrow.maxPct / 100));

  // Ion: a hit freezes the room (no charging in Weapons), an engineer thaws it twice as fast.
  let ice = startCrewFight(player, { acceptanceId: 'i', encounterId: 'ice_raiders', seed: 2, threat: 1 }, now);
  ice = structuredClone(ice);
  ice.intent.auto = false;
  ice.faction.locks.weapons = FACTION_RULES.ion.lockMs;
  ice.weapons.forEach(w => { w.chargeMs = 0; });
  ice.crew.forEach(member => { if (member.room === 'weapons') member.room = null; });
  const frozen = advanceFtlEncounter(ice).state;
  assert.ok(frozen.weapons.every(w => w.chargeMs === 0), 'a frozen Weapons room charges nothing');
  assert.equal(frozen.faction.locks.weapons, FACTION_RULES.ion.lockMs - 1000);
  const engineer = ice.crew.find(member => member.role === 'engineer');
  if (engineer) {
    const thawing = structuredClone(ice);
    thawing.crew.find(member => member.id === engineer.id).room = 'weapons';
    thawing.crew.find(member => member.id === engineer.id).manualUntil = 20;
    assert.equal(advanceFtlEncounter(thawing).state.faction.locks.weapons, FACTION_RULES.ion.lockMs - 2000, 'an engineer thaws it twice as fast');
  }
});

// --- Twists -----------------------------------------------------------------------------------------------

const BOUNTY = { id: 'bounty', elite: { name: 'Two-Tooth Marrik', modifier: 'armored' } };
/** A fixture captain's contract fight with a twist, played by a policy; with the payout it would get. */
function twistFight(twist, { encounterId = 'pirate_wing', seed = 7, threat = 1.1, policy = 'smart', who = 0, hull = 100 } = {}) {
  const { player, now } = captains[who];
  const p = { ...player, ship: { ...player.ship, hull } };
  const start = startCrewFight(p, { acceptanceId: 't', encounterId, seed, threat, twist }, now);
  const { state, types } = play(start, policy);
  const contract = { encounterId, profile: 'risky', destinationId: 'danger_belt', participantIds: [], ...(twist ? { twist } : {}) };
  const pay = resolveSimulatedCombatPayout(p, contract, state, now).result;
  return { start, state, types, pay, player: p, now };
}
/** What the same settled fight would pay with no twist on the contract or the fight. */
const noTwistPay = ({ state, player, now }) => {
  const { twist: _t, ...plain } = state;
  return resolveSimulatedCombatPayout(player, { encounterId: state.encounterId, profile: 'risky', destinationId: 'danger_belt', participantIds: [] }, plain, now).result;
};

test('validTwist and describeTwist: well-formed twists only', () => {
  for (const id of Object.keys(TWISTS)) {
    const twist = id === 'bounty' ? BOUNTY : { id };
    assert.ok(validTwist(twist), id);
    const card = describeTwist(twist);
    assert.ok(card.label && card.rule && card.payLine, id);
  }
  for (const bad of [null, {}, { id: 'heist' }, { id: 'bounty' }, { id: 'bounty', elite: { name: 'Nobody', modifier: 'heavy' } },
    { id: 'bounty', elite: { name: 'Two-Tooth Marrik', modifier: 'tiny' } }, { id: 'escort', elite: BOUNTY.elite }, { id: 'rush', extra: 1 },
    { id: 'bounty', elite: { ...BOUNTY.elite, more: 1 } }, ['rush']]) assert.equal(validTwist(bad), false, JSON.stringify(bad));
  assert.match(describeTwist(BOUNTY).rule, /Two-Tooth Marrik/);
  assert.match(describeTwist({ id: 'escort' }).payLine, /×1\.25.*×0\.7/);
});

test('escort: a freighter flies beside you and draws about a third of the volleys; it pays ×1.25 alive, ×0.7 lost', () => {
  let aimed = 0, volleys = 0, met = null, missed = null;
  // Spread seeds, as real contract seeds are (consecutive small seeds start their first aim together).
  for (let i = 1; i <= 60 && volleys < 600; i += 1) {
    const fight = twistFight({ id: 'escort' }, { seed: 1000 + i * 104729, threat: 1.2, encounterId: 'pirate_scout', who: i % captains.length });
    assert.equal(fight.start.twist.freighter, TWIST_RULES.escort.hull);
    // Count volleys (a gun fires at most once a beat) while the freighter still flies.
    let state = applyFtlCommand(fight.start, { type: 'auto', auto: true }).state;
    while (state.result === null && state.beat < 120 && state.phase === 'combat') {
      const alive = state.twist.freighter > 0;
      const r = advanceFtlEncounter(state);
      const fired = new Map();
      for (const e of r.events) if (e.type === 'shot' && e.from === 'enemy' && !fired.has(e.weapon)) fired.set(e.weapon, e.room === 'escort');
      if (alive) { volleys += fired.size; aimed += [...fired.values()].filter(Boolean).length; }
      state = r.state;
      assert.equal(validFtlBody(state), true);
    }
    if (fight.state.result === 'win') {
      const outcome = ftlTwistOutcome(fight.state);
      assert.equal(outcome.met, fight.state.twist.freighter > 0);
      if (outcome.met && !met) met = fight;
      if (!outcome.met && !missed) missed = fight;
    }
  }
  const share = aimed / volleys;
  assert.ok(share > 0.25 && share < 0.45, `about 35% of volleys aim at the freighter (${Math.round(share * 100)}%)`);
  assert.ok(met && missed, 'both a kept and a lost freighter happen');
  assert.deepEqual(met.pay.twist, { id: 'escort', met: true });
  assert.equal(met.pay.rewards.credits, Math.round(noTwistPay(met).rewards.credits * 1.25));
  assert.equal(missed.pay.rewards.credits, Math.round(noTwistPay(missed).rewards.credits * 0.7));
  assert.match(met.pay.summary, /freighter made it/);
});

test('rush: a 30-second clock; a win in time pays +35%, a slow win pays as usual', () => {
  let fast = null, slow = null;
  for (let seed = 1; seed <= 60 && !(fast && slow); seed += 1) {
    const fight = twistFight({ id: 'rush' }, { seed, threat: seed % 2 ? 1.1 : 1.45, encounterId: 'swarm_skirmish' });
    if (fight.state.result !== 'win') continue;
    if (fight.state.beat <= TWIST_RULES.rush.beats) fast = fast || fight; else slow = slow || fight;
  }
  assert.ok(fast && slow, 'fights both inside and outside the clock');
  assert.deepEqual(fast.pay.twist, { id: 'rush', met: true });
  assert.deepEqual(slow.pay.twist, { id: 'rush', met: false });
  assert.equal(fast.pay.rewards.credits, Math.round(noTwistPay(fast).rewards.credits * 1.35));
  assert.equal(slow.pay.rewards.credits, noTwistPay(slow).rewards.credits);
  assert.equal(ftlMechanicsView(fast.start).twist.clock.left, 30);
});

test('bounty: the enemy is a named elite with one modifier; a win pays ×1.4 and half again in medals', () => {
  const { player, now } = captains[1];
  const base = startCrewFight(player, { acceptanceId: 'b', encounterId: 'pirate_ace', seed: 9, threat: 1.2 }, now);
  const elite = modifier => startCrewFight(player, { acceptanceId: 'b', encounterId: 'pirate_ace', seed: 9, threat: 1.2,
    twist: { id: 'bounty', elite: { name: 'Captain Halfpay', modifier } } }, now);
  assert.equal(elite('armored').enemy.shields.max, base.enemy.shields.max + ELITE_RULES.armoredLayers);
  assert.equal(elite('veteran').enemy.repairPerSec, Math.round(base.enemy.repairPerSec * 1.5 * 10) / 10);
  assert.deepEqual(elite('overclocked').enemy.weapons.map(w => w.chargeMs), base.enemy.weapons.map(w => Math.round(w.chargeMs / 1.25)));
  assert.equal(elite('heavy').enemy.hull, Math.round(KIT_ENEMY.hull * ELITE_RULES.heavyHull));
  for (const modifier of Object.keys(ELITE_MODIFIERS)) assert.equal(validFtlBody(elite(modifier)), true, modifier);
  let won = null;
  for (let seed = 1; seed <= 30 && !won; seed += 1) {
    const fight = twistFight(BOUNTY, { seed, threat: 1 });
    if (fight.state.result === 'win') won = fight;
  }
  const plain = noTwistPay(won);
  assert.deepEqual(won.pay.twist, { id: 'bounty', met: true });
  assert.equal(won.pay.rewards.credits, Math.round(plain.rewards.credits * 1.4));
  assert.equal(won.pay.rewards.medals, Math.round(plain.rewards.medals * 1.5));
});

test('holdout: survive 35 seconds or wreck them; they hit 20% harder; a win pays ×1.15', () => {
  const { player, now } = captains[3];
  const base = startCrewFight(player, { acceptanceId: 'h', encounterId: 'crown_warden', seed: 4, threat: 1 }, now);
  const held = startCrewFight(player, { acceptanceId: 'h', encounterId: 'crown_warden', seed: 4, threat: 1, twist: { id: 'holdout' } }, now);
  assert.deepEqual(held.enemy.weapons.map(w => w.damage), base.enemy.weapons.map(w => Math.max(1, Math.round(w.damage * 1.2))));
  let survived = null;
  for (let seed = 1; seed <= 40 && !survived; seed += 1) {
    const fight = twistFight({ id: 'holdout' }, { seed, encounterId: 'crown_warden', threat: 1.2, policy: 'idle', who: seed % captains.length });
    if (fight.state.result === 'win' && fight.state.enemy.hull > 0) survived = fight;
  }
  assert.ok(survived, 'some crews win by holding out');
  assert.equal(survived.state.beat, TWIST_RULES.holdout.beats);
  assert.equal(validFtlBody(survived.state), true, 'a held-out win with their ship still flying is valid');
  assert.ok(survived.types.has('holdout_done'));
  assert.equal(survived.pay.rewards.credits, Math.round(noTwistPay(survived).rewards.credits * 1.15));
  // Without the twist, a ship still flying is no win.
  const { twist: _t, ...plain } = survived.state;
  assert.equal(validFtlBody(plain), false);
});

test('two waves: when the first ship falls a second arrives at 60% hull with fresh rooms; only its fall wins; ×1.4', () => {
  let won = null;
  for (let seed = 1; seed <= 30 && !won; seed += 1) {
    const fight = twistFight({ id: 'waves' }, { seed, threat: 0.9 });
    if (fight.state.result === 'win') won = fight;
  }
  assert.ok(won.types.has('wave'), 'the second wave arrived');
  assert.equal(won.state.twist.wave, 2);
  assert.deepEqual(won.pay.twist, { id: 'waves', met: true });
  assert.equal(won.pay.rewards.credits, Math.round(noTwistPay(won).rewards.credits * 1.4));
  // The beat the first ship falls: 60% hull, fresh rooms, full shields, and the fight goes on.
  let state = won.start;
  let arrival = null;
  for (let i = 0; i < MAX_FIGHT_BEATS && state.result === null && !arrival; i += 1) {
    for (const command of ftlPolicyStep(state, 'smart').commands) state = applyFtlCommand(state, command).state;
    const r = advanceFtlEncounter(state, state.phase === 'downed' ? 'concede' : null);
    if (r.events.some(e => e.type === 'wave')) arrival = r;
    state = r.state;
  }
  assert.ok(arrival, 'the second wave arrives');
  const wave = arrival.events.find(e => e.type === 'wave');
  assert.equal(wave.hull, Math.round(KIT_ENEMY.hull * TWIST_RULES.waves.hullPct / 100));
  assert.equal(enemyWaveHull(arrival.state), wave.hull);
  assert.ok(arrival.state.enemy.hull <= wave.hull && arrival.state.result === null);
  assert.equal(validFtlBody(arrival.state), true);
  const early = structuredClone(arrival.state);
  early.twist.wave = 1;
  early.result = 'win'; early.phase = 'complete'; early.enemy.hull = 0;
  assert.equal(validFtlBody(early), false, 'no win before the second wave falls');
  assert.equal(applyTwistPay({ credits: 100, medals: 10 }, { id: 'waves', met: true }, false).credits, 100, 'a lost fight pays the usual salvage');
});

test('twists never ride into a wall attempt or the guided first fight; the guided fight has no faction', () => {
  const { player, now } = captains[4];
  const wallArgs = contractFightArgs(player, { encounterId: 'swarm_frigate', wall: { id: 'veil' }, destinationId: 'swarm_scar', profile: 'risky', twist: BOUNTY }, now);
  assert.equal(wallArgs.twist, null);
  assert.equal(startCrewFight(player, { acceptanceId: 'w', seed: 1, ...wallArgs }, now).twist, undefined);
  const guided = startCrewFight(player, { acceptanceId: 'g', encounterId: 'pirate_scout', seed: 1, threat: 0.6, enemyHull: 25, guided: true, twist: { id: 'rush' } }, now);
  assert.equal(guided.twist, undefined);
  assert.equal(guided.faction, undefined);
  assert.deepEqual(contractFightArgs(player, { encounterId: 'pirate_ace', destinationId: 'danger_belt', profile: 'risky', twist: BOUNTY }, now).twist, BOUNTY);
});

test('saves: edited faction and twist blocks are refused; old fights load; a bad contract twist drops alone', () => {
  const { player, now } = captains[5];
  const fight = startCrewFight(player, { acceptanceId: 'v', encounterId: 'hollow_shade', seed: 8, threat: 1.1, twist: { id: 'escort' } }, now);
  let live = fight;
  for (let i = 0; i < FACTION_RULES.cloak.first; i += 1) live = advanceFtlEncounter(live).state;
  assert.equal(validFtlBody(live), true);
  const edits = [
    s => { s.faction.id = 'swarm'; },
    s => { s.faction.cloak = s.beat + 9; },
    s => { s.faction.extra = 1; },
    s => { s.twist.freighter = 99; },
    s => { s.twist.id = 'rush'; },
    s => { s.twist.elite = { name: 'Two-Tooth Marrik', modifier: 'heavy' }; },
    s => { s.enemy.weapons[0].damage -= 1; },
    s => { s.twist.freighter = 0; s.enemy.weapons[0].target = 'escort'; },
    // Dropping the faction block alone leaves its tuned loadout behind: refused.
    s => { delete s.faction; },
  ];
  for (const [i, edit] of edits.entries()) {
    const edited = structuredClone(live);
    edit(edited);
    assert.equal(validFtlBody(edited), false, `edit ${i} is refused`);
  }
  const swarm = startCrewFight(player, { acceptanceId: 'v', encounterId: 'swarm_brood', seed: 8, threat: 1.1 }, now);
  assert.equal(validFtlBody({ ...structuredClone(swarm), faction: { id: 'swarm', regrown: 5 } }), false, 'regrowth cannot run ahead of the beats');
  const ice = startCrewFight(player, { acceptanceId: 'v', encounterId: 'ice_raiders', seed: 8, threat: 1.1 }, now);
  assert.equal(validFtlBody({ ...structuredClone(ice), faction: { ...ice.faction, locks: { ...ice.faction.locks, helm: 7000 } } }), false, 'no lock longer than an ion hit');
  // A fight saved before factions (no faction block) still loads and plays to its end.
  const { faction: _f, ...old } = startFtlEncounter({ ...crewFightSetup(player, { acceptanceId: 'old', encounterId: 'veil_wraith', seed: 8, threat: 1 }, now), faction: null });
  assert.equal(validFtlBody(old), true);
  const oldEnd = play(old, 'smart').state;
  assert.ok(oldEnd.result !== null || oldEnd.phase === 'downed', 'an old fight plays to its end');
  // The contract's twist: kept when valid, dropped alone when not (the contract survives).
  const contractPlayer = contractFightPlayer('pirate_wing', { id: 'heist' });
  const normalized = normalizeContractState(contractPlayer);
  assert.ok(normalized.activeContract, 'the contract survives');
  assert.equal(Object.hasOwn(normalized.activeContract, 'twist'), false, 'only the bad twist goes');
  const good = contractFightPlayer('pirate_wing', BOUNTY);
  assert.deepEqual(normalizeContractState(good).activeContract.twist, BOUNTY);
});

/** A fresh captain with an accepted risky contract against `encounterId`, carrying `twist`, launched into the fight. */
const NOW = Date.UTC(2030, 8, 22, 12);
function contractFightPlayer(encounterId, twist, { launch = false } = {}) {
  let player = createNewPlayer({ tutorialScript: 4, now: NOW, rng: () => 0.1 });
  player = { ...player, tutorial: { ...player.tutorial, completed: true, phase: 'done' }, wallet: { ...player.wallet, fuel: 20 },
    crew: player.crew.map(member => ({ ...member, power: 40 })) };
  player = { ...player, contractBoard: generateContractBoard(player, NOW) };
  const offer = player.contractBoard.offers.find(candidate => candidate.profile === 'risky');
  const outcome = { kind: 'combat', encounter: encounterId };
  offer.routeContent = { ...offer.routeContent, routeOutcome: { ...outcome }, secureOutcome: { ...outcome }, encounterId, storyFlag: null };
  offer.twist = twist;
  player = acceptContract(player, offer.id, NOW).player;
  if (!launch) return player;
  for (const id of ['launch', 'push']) player = commitContractAction(player, previewContractAction(player, { id }, NOW), { now: NOW, rng: () => 0.5 }).player;
  return player;
}

test('a contract fight carries its twist and faction, reloads mid-fight unchanged, and claims the twist pay', () => {
  let player = contractFightPlayer('veil_wraith', { id: 'escort' }, { launch: true });
  assert.deepEqual(player.activeContract.twist, { id: 'escort' });
  assert.equal(player.activeEncounter.faction.id, 'shades');
  assert.equal(player.activeEncounter.twist.id, 'escort');
  const beat = p => {
    const e = p.activeEncounter;
    for (const command of ftlPolicyStep(e, 'sharp').commands) {
      const applied = applyEncounterCommand(p, { acceptanceId: e.acceptanceId, revision: e.revision, command });
      if (applied.ok) p = applied.player;
    }
    const order = p.activeEncounter.phase === 'downed' ? 'concede' : null;
    const r = applyEncounterAction(p, { acceptanceId: e.acceptanceId, revision: p.activeEncounter.revision, order }, NOW);
    assert.equal(r.ok, true, r.reason);
    return r.player;
  };
  for (let i = 0; i < 12; i += 1) player = beat(player);
  // Reload mid-fight (through the save codec's JSON and migratePlayer): everything is kept, and play continues identically.
  const reloaded = migratePlayer(JSON.parse(JSON.stringify(player)));
  assert.deepEqual(reloaded.activeEncounter, player.activeEncounter);
  assert.deepEqual(reloaded.activeContract.twist, player.activeContract.twist);
  let a = player, b = reloaded;
  for (let i = 0; i < MAX_FIGHT_BEATS && a.activeEncounter.result === null; i += 1) { a = beat(a); b = beat(b); }
  assert.deepEqual(b.activeEncounter, a.activeEncounter);
  assert.equal(a.activeContract.stage, 'return');
  if (a.activeEncounter.result === 'win') assert.deepEqual(a.activeContract.result.twist, ftlTwistOutcome(a.activeEncounter));
  // A fight whose twist no longer matches its contract is refused (and the contract recovered).
  const swapped = { ...player, activeEncounter: { ...structuredClone(player.activeEncounter), twist: { id: 'rush' } } };
  assert.equal(normalizeEncounterState(swapped).activeContract, null);
  const stripped = { ...player, activeContract: { ...player.activeContract } };
  delete stripped.activeContract.twist;
  assert.equal(normalizeEncounterState(stripped).activeContract, null, 'a twisted fight needs its twisted contract');
});

test('reward bands and win odds run the twist: the card tells the truth', () => {
  const plain = contractFightPlayer('pirate_wing', undefined);
  const offerOf = p => p.contractBoard.offers.find(o => o.id === p.activeContract.offerId);
  const bountyPlayer = contractFightPlayer('pirate_wing', BOUNTY);
  const plainOffer = { ...offerOf(plain) };
  delete plainOffer.twist;
  const bountyOffer = offerOf(bountyPlayer);
  const fresh = p => ({ ...p, activeContract: null });
  const plainBand = contractRewardBand(fresh(plain), plainOffer, { now: NOW });
  const bountyBand = contractRewardBand(fresh(bountyPlayer), bountyOffer, { now: NOW });
  assert.ok(plainBand.available && bountyBand.available);
  assert.ok(bountyBand.currencies.credits.max > plainBand.currencies.credits.max, 'a bounty win pays more, and the band says so');
  assert.ok(bountyBand.currencies.medals.max > plainBand.currencies.medals.max, 'and half again in medals');
  assert.deepEqual(offerFightContract(bountyOffer).twist, BOUNTY);
  assert.deepEqual(contractFightArgs(bountyPlayer, offerFightContract(bountyOffer), NOW).twist, BOUNTY);
});

test('the fight screen shows each rule: chips, cloak, regrowth, frost, escort, clocks, waves and the elite', () => {
  const html = (player, ui = {}) => {
    const view = sessionModels(player, ui, NOW).activeContractView.encounter;
    return { view, enemy: renderFtlEnemy(view), controls: renderFtlControls(view), markers: renderFtlShipMarkers(view) };
  };
  const stepTo = (player, until) => {
    for (let i = 0; i < 80 && player.activeEncounter.result === null && !until(player.activeEncounter); i += 1) {
      const e = player.activeEncounter;
      player = applyEncounterAction(player, { acceptanceId: e.acceptanceId, revision: e.revision, order: e.phase === 'downed' ? 'concede' : null }, NOW).player;
    }
    return player;
  };
  let shade = contractFightPlayer('veil_wraith', { id: 'escort' }, { launch: true });
  let screen = html(shade);
  assert.match(screen.enemy, /Shades · cloak/);
  assert.match(screen.enemy, /data-escort/);
  assert.match(screen.enemy, /Freighter/);
  shade = stepTo(shade, e => e.faction.cloak >= e.beat && e.faction.cloak > 0);
  if (shade.activeEncounter.result === null) {
    screen = html(shade);
    assert.match(screen.enemy, /is-cloaked/);
    assert.match(screen.enemy, /Cloaked<\/b>/);
    assert.match(screen.enemy, /Hold/);
  }
  const bounty = html(contractFightPlayer('crown_warden', BOUNTY, { launch: true }));
  assert.match(bounty.enemy, /Two-Tooth Marrik · Armored/);
  assert.match(bounty.enemy, /Harmonics on/);
  const rush = html(contractFightPlayer('pirate_wing', { id: 'rush' }, { launch: true }));
  assert.match(rush.enemy, /Rush 30s/);
  assert.match(rush.enemy, /Missile \d+/);
  const hold = html(contractFightPlayer('pirate_wing', { id: 'holdout' }, { launch: true }));
  assert.match(hold.enemy, /Hold out 35s/);
  const waves = html(contractFightPlayer('swarm_skirmish', { id: 'waves' }, { launch: true }));
  assert.match(waves.enemy, /Wave 1 of 2/);
  assert.match(waves.enemy, new RegExp(`Drones ${FACTION_RULES.drones.shots}×\\d+`));
  let ice = contractFightPlayer('ice_raiders', undefined, { launch: true });
  ice = { ...ice, activeEncounter: { ...structuredClone(ice.activeEncounter) } };
  ice.activeEncounter.faction.locks.weapons = 3000;
  const iceScreen = html(ice);
  assert.match(iceScreen.markers, /is-frozen/);
  assert.match(iceScreen.markers, /3s/);
  assert.match(iceScreen.controls, /Ion froze Weapons/);
});

test('tells name the faction trick and the counter: unique, short, no numbers, a fight noun', () => {
  const CURRENT_FIGHT = /\b(Weapons|Shields|Engines|Helm|Overcharge|Board|Hold|security|engineer|crew)\b/;
  const TRICK = { corsairs: /missile/i, scrappers: /board/i, swarm: /drone|grow|regrow|burn|fire/i, ice: /ion|froze|freez/i, shades: /cloak/i, wardens: /harmonic/i, eclipse: /cloak/i };
  for (const encounter of ENCOUNTERS_V1) {
    const { reason, recommendedOrder } = encounter.tell;
    assert.ok(reason.length <= 80 && !/\d/.test(reason) && CURRENT_FIGHT.test(reason), `${encounter.id}: ${reason}`);
    assert.match(reason, TRICK[factionOf(encounter.id).id], `${encounter.id} names its faction's trick`);
    assert.ok(COMBAT_ORDERS[recommendedOrder], encounter.id);
  }
  assert.equal(new Set(ENCOUNTERS_V1.map(e => e.tell.reason)).size, ENCOUNTERS_V1.length);
});

if (process.env.FACTION_EVIDENCE) {
  test('evidence: the bigger sample and the report', () => {
    const big = Object.fromEntries(Object.keys(FACTIONS).map(faction => [faction, winRates(faction, { fights: 960, seedBase: 9000, smart: true })]));
    const row = (faction, r) => `| ${FACTIONS[faction].name} | ${FACTION_ENCOUNTERS[faction].join(', ')} | ${r.fights} | ${r.rates.before}% | ${r.rates.idle}% | ${r.rates.idle >= r.rates.before ? '+' : ''}${Math.round((r.rates.idle - r.rates.before) * 10) / 10} | ${r.rates.sharp}% | ${r.rates.sharp >= r.rates.idle ? '+' : ''}${Math.round((r.rates.sharp - r.rates.idle) * 10) / 10}${r.rates.smart != null ? ` | ${r.rates.beforeSmart}% → ${r.rates.smart}%` : ''} |`;
    const header = smart => `| Faction | Encounters | Fights | Before (Auto) | After (Auto) | Change | Sharp | Sharp vs Auto${smart ? ' | Smart (sim captain), before → after' : ''} |\n|---|---|---:|---:|---:|---:|---:|---:|${smart ? '---:|' : ''}`;
    const text = readFileSync(REPORT, 'utf8');
    const start = text.indexOf('<!-- generated:start -->');
    const end = text.indexOf('<!-- generated:end -->');
    assert.ok(start >= 0 && end > start, 'the report has its generated block');
    const block = ['<!-- generated:start -->',
      `In-suite sample (\`test/factions.test.mjs\`, 240 fights per faction, seeds from 5000; asserted on every run):`, '',
      header(false), ...Object.entries(results).map(([f, r]) => row(f, r)), '',
      `Bigger sample (\`FACTION_EVIDENCE=1\`, about 960 fights per faction, seeds from 9000):`, '',
      header(true), ...Object.entries(big).map(([f, r]) => row(f, r)), '',
      '<!-- generated:end -->'].join('\n');
    writeFileSync(REPORT, `${text.slice(0, start)}${block}${text.slice(end + '<!-- generated:end -->'.length)}`);
  });
}
