// FTL-lite crew fights (ruleset v3). See docs/superpowers/specs/2026-10-04-ftl-lite-combat-design.md.
//
// A fight runs in 1-second beats of four 250 ms ticks. A beat is the unit that
// is saved and validated, exactly like the v1/v2 beat fights. Everything is
// seeded and deterministic, so a reload replays nothing and the economy
// simulator can play fights without a screen.
//
// Commands (target a room, hold weapons, move crew) change `intent` without
// advancing time; the next beat applies them.

import { STATIONS } from './stations.js';
import { kitFor } from '../data/crewKits.js';
import { CREW_CATALOG, catalogById } from '../data/crewRoster.js';

export const FTL_VERSION = 3;
export const TICK_MS = 250;
export const TICKS_PER_BEAT = 4;
export const BEAT_MS = TICK_MS * TICKS_PER_BEAT;

/** Player rooms are the four stations; the ship view maps them to cutaway rooms through STATIONS. */
export const PLAYER_ROOMS = Object.freeze(['helm', 'shields', 'weapons', 'engineering']);
export const ENEMY_ROOMS = Object.freeze(['weapons', 'shields', 'engines', 'helm']);
const PLAYER_ADJ = Object.freeze({ helm: ['shields', 'weapons'], shields: ['helm', 'weapons', 'engineering'], weapons: ['helm', 'shields', 'engineering'], engineering: ['shields', 'weapons'] });
const ENEMY_ADJ = Object.freeze({ weapons: ['shields', 'helm'], shields: ['weapons', 'engines'], engines: ['shields', 'helm'], helm: ['weapons', 'engines'] });

/**
 * Player weapons. Lasers are stopped by a shield layer; missiles fly through
 * shields but carry limited ammo per fight; ion blasts knock a layer out and
 * stall the enemy's shield recharge; beams only bite an unshielded ship but cut
 * deep and start fires.
 */
export const WEAPON_CATALOG = Object.freeze({
  burst: Object.freeze({ id: 'burst', name: 'Burst Laser', kind: 'laser', shots: 2, damage: 4, chargeMs: 9000 }),
  heavy: Object.freeze({ id: 'heavy', name: 'Heavy Laser', kind: 'laser', shots: 1, damage: 7, chargeMs: 11000 }),
  missile: Object.freeze({ id: 'missile', name: 'Leto Missile', kind: 'missile', shots: 1, damage: 8, chargeMs: 12000, ammo: 3 }),
  ion: Object.freeze({ id: 'ion', name: 'Ion Blast', kind: 'ion', shots: 1, damage: 0, chargeMs: 8000, ionMs: 6000, roomDamage: 12 }),
  beam: Object.freeze({ id: 'beam', name: 'Pike Beam', kind: 'beam', shots: 1, damage: 6, chargeMs: 12000, roomDamage: 34, fireChance: 30 }),
});
export const DEFAULT_LOADOUT = Object.freeze(['burst', 'heavy']);
/** The starting pair (kept for callers that list the default guns). */
export const PLAYER_WEAPONS = Object.freeze(DEFAULT_LOADOUT.map(id => WEAPON_CATALOG[id]));
export const MAX_WEAPON_SLOTS = 4;

/**
 * What drydock levels do in a fight. Level 1 everywhere is the plain Sparrow.
 * Shields: faster recharge, a second layer at 6 and a third at 10.
 * Weapons: faster charging, a third slot at 4 and a fourth at 8.
 * Engines: harder to hit. Sensors: easier to hit them.
 */
export function shipCombatStats(levels = {}) {
  const lv = key => Math.max(1, Math.min(20, Math.trunc(levels?.[key] || 1)));
  return {
    shieldLayers: 1 + (lv('shields') >= 6 ? 1 : 0) + (lv('shields') >= 10 ? 1 : 0),
    shieldRechargeMult: Math.round((1 + 0.04 * (lv('shields') - 1)) * 100) / 100,
    chargeMult: Math.round((1 + 0.03 * (lv('weapons') - 1)) * 100) / 100,
    weaponSlots: 2 + (lv('weapons') >= 4 ? 1 : 0) + (lv('weapons') >= 8 ? 1 : 0),
    evasionBonus: Math.min(10, lv('engines') - 1),
    accuracyBonus: Math.min(8, lv('sensors') - 1),
  };
}

export const shipStatsOf = state => shipCombatStats(state?.ship?.levels);

export const RULES = Object.freeze({
  playerHullMax: 100,
  playerShieldLayers: 1,
  shieldRechargeMs: 2000,
  enemyShieldRechargeMs: 2500,
  roomHitDamage: 20,
  fireChance: 12,
  fireBurnPerSec: 6,
  fireSpreadAfterMs: 6000,
  crewRepairPerSec: 12,
  crewExtinguishPerSec: 50,
  enemyExtinguishPerSec: 34,
  rallyHull: 40,
  overchargeBeats: 8,
  overchargeMult: 1.5,
  boarderWarnBeat: 6,
  boarderLandBeat: 8,
  boarderHp: 30,
  boarderSabotagePerSec: 8,
  autoReturnBeats: 10,
});

export const BOARD = Object.freeze({ maxEnemyHull: 21, rewardScale: 1.25 });

/**
 * Enemies in kit fights are tougher, so a Common crew with Auto abilities wins about as often as a
 * crew without kits did, and better crews win more (tuned by sim, 2026-10-09).
 */
export const ENEMY_HULL = 42;
export const KIT_ENEMY = Object.freeze({ hull: 55, damageMult: 1.15 });
/** The enemy's full hull: a wall segment's start, else the default for this kind of fight. */
export const enemyStartHull = state => (Number.isInteger(state?.enemy?.startHull) ? state.enemy.startHull
  : state?.fx && typeof state.fx === 'object' ? KIT_ENEMY.hull : ENEMY_HULL);
export const OVERCHARGE = Object.freeze({ fuel: 1 });

export function seededIndex(seed, salt, size) {
  let hash = (Math.trunc(seed) ^ Math.imul(salt + 1, 0x45d9f3b)) | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash % size;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const room = () => ({ integrity: 100, fire: 0, fireMs: 0 });

/**
 * Enemy loadout from threat (0.6 Favorable … 1.6 Deadly). Siege-wall flagships are tougher:
 * tier 1 (the first wall) always carries a second gun; tier 2 (later walls) also an extra shield layer.
 */
export function enemyLoadout(threat = 1, { flagship = 0, tier: enemyTier = 0, kits = false } = {}) {
  const t = clamp(Number(threat) || 1, 0.6, 1.6);
  const tier = flagship === true ? 2 : Math.max(0, Math.min(2, Math.trunc(Number(flagship) || 0)));
  // Enemy tier comes from the ship's class (later sectors): tier 1 fires three-shot volleys,
  // tier 2 also carries an extra shield layer, so upgraded Sparrows still meet a fight.
  const shipTier = Math.max(0, Math.min(2, Math.trunc(Number(enemyTier) || 0)));
  const damage = Math.max(2, Math.round((-16 + 24 * t) * (kits ? KIT_ENEMY.damageMult : 1)));
  const weapons = [{ id: 'cannon', shots: shipTier >= 1 ? 3 : 2, damage, chargeMs: 10000 }];
  if (t >= 1.1 || tier >= 1) weapons.push({ id: 'heavy', shots: 1, damage: Math.round(damage * 1.8), chargeMs: 12000 });
  return {
    shieldLayers: Math.min(2, (t < 0.8 ? 0 : 1) + (tier >= 2 || shipTier >= 2 ? 1 : 0)),
    repairPerSec: Math.round((2 + 4 * t) * 10) / 10,
    evasion: Math.round(4 + 8 * t),
    weapons,
  };
}

/**
 * Start a v3 fight. `crew` is the fighting crew: [{ id, role, station }]; a
 * null station means free crew, who go wherever the ship needs them.
 */
export function startFtlEncounter({ acceptanceId, encounterId, seed, threat = 1, crew = [], hull = 100,
  enemyHull = null, remainingBefore = null, tactics = [], boarders = false, guided = false,
  shipLevels = null, loadout = DEFAULT_LOADOUT, flagship = 0, enemyTier = 0, auto = false }) {
  const s = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 0;
  const tier = Math.max(0, Math.min(2, Math.trunc(Number(enemyTier) || 0)));
  // One flagship tier for the loadout and the save, so the validator rebuilds the same enemy.
  const flagTier = flagship === true ? 2 : Math.max(0, Math.min(2, Math.trunc(Number(flagship) || 0)));
  const fighters = crew.map(member => ({
    id: String(member.id), role: String(member.role || ''),
    station: PLAYER_ROOMS.includes(member.station) ? member.station : null,
    room: PLAYER_ROOMS.includes(member.station) ? member.station : null,
    manualUntil: 0,
    // A crew member with a kit fights with their signature move (abilities start half charged).
    ...(typeof member.kit === 'string' && kitFor(member.kit, member.role) ? {
      kit: member.kit,
      grade: Math.round(clamp(Number(member.grade) || 0, 0, 1) * 100) / 100,
      bonus: Math.round(clamp(Number(member.bonus) || 0, 0, 2) * 1000) / 1000,
      tier: Math.trunc(clamp(Number(member.tier) || 0, 0, 3)),
      charge: 50,
    } : {}),
  }));
  const kitted = fighters.some(hasKit);
  const load = enemyLoadout(threat, { flagship: flagTier, tier, kits: kitted });
  const levels = shipLevels ? Object.fromEntries(['shields', 'weapons', 'engines', 'sensors']
    .map(key => [key, Math.max(1, Math.min(20, Math.trunc(shipLevels[key] || 1)))])) : null;
  const stats = shipCombatStats(levels || {});
  const guns = [...new Set(loadout || DEFAULT_LOADOUT)].filter(id => WEAPON_CATALOG[id]).slice(0, stats.weaponSlots);
  const fitted = guns.length ? guns : [...DEFAULT_LOADOUT];
  const missiles = fitted.filter(id => WEAPON_CATALOG[id].kind === 'missile').length;
  const shieldLayers = stats.shieldLayers;
  const fullHull = kitted ? KIT_ENEMY.hull : ENEMY_HULL;
  const startHull = Number.isInteger(enemyHull) ? clamp(enemyHull, 1, fullHull) : fullHull;
  return {
    version: FTL_VERSION,
    acceptanceId: String(acceptanceId ?? ''),
    encounterId: String(encounterId ?? ''),
    kind: 'normal',
    // The tutorial's first fight: the clock waits until the captain targets their weapons.
    ...(guided ? { guided: true } : {}),
    seed: s,
    revision: 0,
    beat: 0,
    eventIndex: 0,
    phase: 'combat',
    result: null,
    lossReason: null,
    hull: clamp(Math.round(hull), 1, RULES.playerHullMax),
    startHull: clamp(Math.round(hull), 1, RULES.playerHullMax),
    shields: { layers: shieldLayers, max: shieldLayers, rechargeMs: 0 },
    rooms: Object.fromEntries(PLAYER_ROOMS.map(id => [id, room()])),
    weapons: fitted.map(id => ({ id, chargeMs: Math.round(WEAPON_CATALOG[id].chargeMs * 0.2) })),
    ...(levels ? { ship: { levels } } : {}),
    ...(missiles ? { ammo: { missile: missiles * WEAPON_CATALOG.missile.ammo } } : {}),
    crew: fighters,
    intent: { target: null, hold: false, moves: {}, ...(kitted ? { cast: [], auto: Boolean(auto) } : {}) },
    ...(kitted ? { fx: {} } : {}),
    enemy: {
      hull: startHull,
      ...(flagTier ? { flagship: flagTier } : {}),
      ...(tier ? { tier } : {}),
      ...(Number.isInteger(enemyHull) ? { startHull, remainingBefore } : {}),
      threat: Math.round(clamp(Number(threat) || 1, 0.6, 1.6) * 100) / 100,
      evasion: load.evasion,
      repairPerSec: load.repairPerSec,
      shields: { layers: load.shieldLayers, max: load.shieldLayers, rechargeMs: 0 },
      rooms: Object.fromEntries(ENEMY_ROOMS.map(id => [id, room()])),
      // Enemies open part-charged so the first volley lands in 4-7 s.
      weapons: load.weapons.map((w, i) => ({ ...w, progressMs: Math.round(w.chargeMs * (30 + seededIndex(s, 700 + i, 31)) / 100),
        target: PLAYER_ROOMS[seededIndex(s, 710 + i, PLAYER_ROOMS.length)] })),
    },
    ...(tactics.length ? { tactics: Object.fromEntries(['burn', 'board'].filter(name => tactics.includes(name))
      .map(name => [name, name === 'burn' ? { uses: 0, throughBeat: 0 } : { uses: 0, success: null }])) } : {}),
    ...(boarders ? { boarders: { phase: 'none', room: null, hp: 0 } } : {}),
  };
}

// --- Derived values --------------------------------------------------------

const stationRole = id => STATIONS[id]?.role;

// --- Crew kits (docs/superpowers/specs/2026-10-09-crew-matter-design.md) -----
// A fight whose crew carry kits has abilities, grade-scaled station mastery and real role passives.
// A fight without kits (old saves, the guided tutorial fight, engine tests) plays exactly as before.

const hasKit = member => typeof member?.kit === 'string';
/** Does this fight use crew kits (abilities, mastery, passives)? It started with a kit aboard and carries `fx`. */
export const kitFight = state => Boolean(state?.fx && typeof state.fx === 'object' && !Array.isArray(state.fx));
export const memberKit = member => (hasKit(member) ? kitFor(member.kit, member.role) : null);
const gradeOf = member => (Number.isFinite(member?.grade) ? member.grade : 0);
const bonusOf = member => (hasKit(member) && Number.isFinite(member?.bonus) ? member.bonus : 0);
/** Is a timed effect running this beat? */
export const fxActive = (state, key) => Number.isInteger(state?.fx?.[key]?.through) && state.fx[key].through >= state.beat;
/** The best role passive aboard (gunner crit, medic assist, scout aim, security guard...). */
const bestBonus = (state, role, room = null) => Math.max(0, ...state.crew
  .filter(member => member.role === role && hasKit(member) && (room === null || member.room === room)).map(bonusOf));

/** Station mastery: 1.0 unmanned; 1.15 manned (+0.15 x grade); 1.3 by the station's role (+0.3 x grade). */
export function manning(state, roomId) {
  const here = state.crew.filter(member => member.room === roomId);
  if (!here.length) return 1;
  const role = stationRole(roomId);
  return Math.max(...here.map(member => (member.role === role ? 1.3 + 0.3 * gradeOf(member) : 1.15 + 0.15 * gradeOf(member))));
}

/** Percent chance a player shot crits: the best gunner working the weapons room. */
export const critChance = state => (kitFight(state) ? bestBonus(state, 'gunner', 'weapons') : 0);

const integrityFactor = integrity => (integrity >= 50 ? 1 : integrity > 0 ? 0.5 : 0);

/** Extra shield layers above max from an ability (Four-Arm Oath) while it runs. */
export const shieldOver = state => (fxActive(state, 'shieldOver') ? state.fx.shieldOver.n : 0);

export function playerShieldCap(state) {
  const integrity = state.rooms.shields.integrity;
  const base = integrity >= 50 ? state.shields.max : integrity > 0 ? Math.max(0, state.shields.max - 1) : 0;
  return integrity > 0 ? base + shieldOver(state) : base;
}

export function enemyShieldCap(state) {
  const { shields, rooms } = state.enemy;
  const cap = rooms.shields.integrity >= 50 ? shields.max : rooms.shields.integrity > 0 ? Math.max(0, shields.max - 1) : 0;
  return Math.max(0, cap - (state.fx?.enemyShieldDown || 0));
}

/** Percent chance an enemy shot misses the player (engines upgrades add to it). */
export function playerEvasion(state) {
  const atHelm = state.crew.filter(member => member.room === 'helm');
  const pilots = atHelm.filter(member => member.role === stationRole('helm'));
  // A pilot at the helm: 15, plus up to 10 more by grade. Anyone else: 10. Nobody: 5.
  const base = !atHelm.length ? 5 : pilots.length ? 15 + Math.round(10 * Math.max(...pilots.map(gradeOf))) : 10;
  // A move's dodge is the crew's own footwork, added after helm damage (audit 2026-10-09 #4).
  const evade = fxActive(state, 'evade') ? state.fx.evade.bonus : 0;
  return Math.round((base + shipStatsOf(state).evasionBonus) * state.rooms.helm.integrity / 100) + evade;
}

/** Percent chance a player shot misses (sensors upgrades take from it). */
export function enemyEvasion(state) {
  const { evasion, rooms } = state.enemy;
  if (rooms.helm.integrity <= 0) return 0;
  // Scouts read the enemy's moves (their passive); Static Plot and friends take more off for a while.
  const scout = Math.round(100 * bestBonus(state, 'scout'));
  const down = fxActive(state, 'evasionDown') ? state.fx.evasionDown.amount : 0;
  return Math.max(0, Math.round(evasion * rooms.engines.integrity / 100) - shipStatsOf(state).accuracyBonus - scout - down);
}

/** What an idle captain shoots: shields while they matter, then weapons. */
export function autoTarget(state) {
  return enemyShieldMax(state) > 0 && state.enemy.rooms.shields.integrity > 0 ? 'shields' : 'weapons';
}

/** The enemy's shield maximum after Editing and friends took layers away for the fight. */
export const enemyShieldMax = state => Math.max(0, state.enemy.shields.max - (state.fx?.enemyShieldDown || 0));

export const currentTarget = state => (ENEMY_ROOMS.includes(state.intent?.target) ? state.intent.target : autoTarget(state));

export function weaponDef(id) {
  return WEAPON_CATALOG[id];
}

/** A missile launcher with no ammo left cannot charge or fire. */
export function weaponCanFire(state, weapon) {
  return WEAPON_CATALOG[weapon.id]?.kind !== 'missile' || (state.ammo?.missile ?? 0) > 0;
}

// --- Commands (no time passes) ---------------------------------------------

/** Validate and apply a command to intent. Returns { ok, state } or { ok:false, reason }. */
export function applyFtlCommand(state, command = {}) {
  if (state.version !== FTL_VERSION) return { ok: false, reason: 'not_ftl' };
  if (state.result !== null || state.phase !== 'combat') return { ok: false, reason: 'finished' };
  const next = structuredClone(state);
  if (command.type === 'target') {
    if (command.room !== null && !ENEMY_ROOMS.includes(command.room)) return { ok: false, reason: 'unknown_room' };
    next.intent.target = command.room;
  } else if (command.type === 'hold') {
    next.intent.hold = Boolean(command.hold);
  } else if (command.type === 'move') {
    const member = next.crew.find(c => c.id === String(command.crewId));
    if (!member) return { ok: false, reason: 'unknown_crew' };
    if (!PLAYER_ROOMS.includes(command.room)) return { ok: false, reason: 'unknown_room' };
    next.intent.moves = { ...next.intent.moves, [member.id]: command.room };
  } else if (command.type === 'ability') {
    // Tap a charged portrait: the move goes off at the start of the next beat.
    const member = next.crew.find(c => c.id === String(command.crewId));
    if (!member || !hasKit(member)) return { ok: false, reason: 'unknown_crew' };
    if (member.charge < 100) return { ok: false, reason: 'not_ready' };
    if (next.intent.cast.includes(member.id)) return { ok: false, reason: 'already_queued' };
    next.intent.cast = [...next.intent.cast, member.id];
  } else if (command.type === 'auto') {
    if (!kitFight(next)) return { ok: false, reason: 'no_abilities' };
    next.intent.auto = Boolean(command.auto);
  } else return { ok: false, reason: 'unknown_command' };
  return { ok: true, state: next };
}

// --- One beat --------------------------------------------------------------

function tacticAvailable(state, name) {
  const tactic = state.tactics?.[name];
  if (!tactic) return { available: false, reason: 'order_unavailable' };
  if (state.result !== null) return { available: false, reason: 'finished' };
  if (tactic.uses > 0) return { available: false, reason: 'used' };
  if (name === 'board' && state.enemy.hull > BOARD.maxEnemyHull) return { available: false, reason: 'enemy_too_strong' };
  return { available: true, reason: null, ...(name === 'board' ? { chance: boardChance(state) } : {}) };
}

export function boardChance(state) {
  const threat = Number.isFinite(state?.enemy?.threat) ? state.enemy.threat : 1;
  const finishing = (state?.enemy?.hull ?? ENEMY_HULL) <= 10 ? 0.15 : 0;
  // Knocked-out enemy weapons or helm make a boarding party far likelier to hold.
  const crippled = state?.enemy?.rooms && (state.enemy.rooms.weapons.integrity <= 0 || state.enemy.rooms.helm.integrity <= 0) ? 0.1 : 0;
  return Math.max(0.2, Math.min(0.92, Math.round((0.8 - (threat - 1) * 0.7 + finishing + crippled) * 100) / 100));
}

export const ftlTacticStatus = tacticAvailable;

export const RALLY_RULE = Object.freeze({ nearMissPct: 0.2 });

export function ftlRallyEligible(state) {
  if (state.rally?.used) return false;
  return state.enemy.hull > 0 && state.enemy.hull <= enemyStartHull(state) * RALLY_RULE.nearMissPct;
}

function finish(next, result, events, t, lossReason = null) {
  next.result = result;
  next.lossReason = lossReason;
  next.phase = 'complete';
  events.push({ t, type: 'result', result, reason: lossReason });
}

function finishLoss(next, events, t, reason) {
  if (ftlRallyEligible(next)) {
    next.phase = 'downed';
    next.lossReason = reason;
    events.push({ t, type: 'downed', enemyHull: next.enemy.hull, reason });
    return;
  }
  finish(next, 'loss', events, t, reason);
}

function damageRoom(rooms, id, amount) {
  rooms[id].integrity = Math.max(0, rooms[id].integrity - amount);
}

function maybeFire(next, rooms, id, salt, events, t, side, chance = RULES.fireChance) {
  if (rooms[id].fire > 0) return;
  if (seededIndex(next.seed, salt, 100) < chance) {
    rooms[id].fire = 100;
    rooms[id].fireMs = 0;
    events.push({ t, type: 'fire_start', side, room: id });
  }
}

/** Free crew (and crew a captain moved long ago) go where the ship needs them. */
function dispatchCrew(next) {
  const urgency = id => (next.boarders?.phase === 'aboard' && next.boarders.room === id ? 400 : 0)
    + (next.rooms[id].fire > 0 ? 200 + next.rooms[id].fire : 0)
    + (next.rooms[id].integrity < 100 ? 100 - next.rooms[id].integrity : 0);
  for (const member of next.crew) {
    if (member.manualUntil > next.beat) continue;
    if (member.station) {
      // Station crew go home once their manual job is done.
      if (member.room !== member.station && (member.room === null || urgency(member.room) === 0)) member.room = member.station;
      continue;
    }
    const worst = [...PLAYER_ROOMS].sort((a, b) => urgency(b) - urgency(a))[0];
    if (urgency(worst) > 0) member.room = worst;
  }
}

/**
 * Advance one beat. Orders: null, 'burn' (Overcharge), 'board', 'rally', 'concede'.
 * Rejections return { ok:false, reason, state } with the input untouched.
 */
export function advanceFtlEncounter(state, order = null) {
  if (state.result !== null) return { state, events: [] };
  if (state.phase === 'downed') {
    if (!['rally', 'concede'].includes(order)) return { ok: false, reason: 'downed', state };
  } else if (order !== null) {
    if (!['burn', 'board'].includes(order)) return { ok: false, reason: 'order_unavailable', state };
    const status = tacticAvailable(state, order);
    if (!status.available) return { ok: false, reason: status.reason, state };
  }

  const next = structuredClone(state);
  const events = [];
  next.revision += 1;
  next.beat += 1;
  next.eventIndex += 1;
  // An expired Four-Arm Oath drops its extra layer now, even if this beat ends before a tick (audit #1).
  if (kitFight(next)) next.shields.layers = Math.min(next.shields.layers, playerShieldCap(next));

  if (next.phase === 'downed') {
    next.phase = 'combat';
    if (order === 'concede') {
      finish(next, 'loss', events, 0, next.lossReason || 'The crew breaks off.');
      next.eventIndex += events.length;
      return { state: next, events };
    }
    next.lossReason = null;
    next.hull = Math.max(next.hull, RULES.rallyHull);
    next.rally = { used: true };
    events.push({ t: 0, type: 'order', order: 'rally', amount: RULES.rallyHull });
  }

  if (order === 'burn') {
    next.tactics.burn = { uses: 1, throughBeat: next.beat + RULES.overchargeBeats - 1 };
    events.push({ t: 0, type: 'order', order: 'burn', cost: { fuel: OVERCHARGE.fuel }, throughBeat: next.tactics.burn.throughBeat });
  } else if (order === 'board') {
    const chance = boardChance(state);
    const success = seededIndex(next.seed, next.beat * 10 + 303, 100) < Math.round(chance * 100);
    next.tactics.board = { uses: 1, success };
    events.push({ t: 0, type: 'order', order: 'board', chance });
    if (success) {
      events.push({ t: 0, type: 'boarding', success: true, amount: next.enemy.hull });
      next.enemy.hull = 0;
      finish(next, 'win', events, 0);
      next.eventIndex += events.length;
      return { state: next, events };
    }
    let amount = Math.max(1, Math.round(next.enemy.weapons[0].damage * 1.5));
    // Brace and Later protect against a thrown-back boarding party too (audit #5).
    if (kitFight(next) && fxActive(next, 'brace')) amount = Math.ceil(amount / 2);
    next.hull = Math.max(1, next.hull - amount);
    if (kitFight(next) && fxActive(next, 'lastStand')) next.hull = Math.max(next.hull, Math.min(state.hull, next.fx.lastStand.hold));
    events.push({ t: 0, type: 'boarding', success: false, amount });
    if (next.hull <= 1) {
      finishLoss(next, events, 0, 'The boarding party was thrown back and the hull is failing.');
      next.eventIndex += events.length;
      return { state: next, events };
    }
  }

  // Moves ordered since the last beat: crew arrive now and stay a while.
  for (const [id, roomId] of Object.entries(next.intent.moves || {})) {
    const member = next.crew.find(c => c.id === id);
    if (member) {
      member.room = roomId;
      member.manualUntil = next.beat + RULES.autoReturnBeats;
      events.push({ t: 0, type: 'crew_move', crewId: id, room: roomId });
    }
  }
  next.intent.moves = {};

  // Boarders: warned, then land, for raiders that dock.
  if (next.boarders) {
    if (next.boarders.phase === 'none' && next.beat === RULES.boarderWarnBeat) {
      next.boarders = { phase: 'incoming', room: PLAYER_ROOMS[seededIndex(next.seed, 404, PLAYER_ROOMS.length)], hp: 0 };
      events.push({ t: 0, type: 'boarders_incoming', room: next.boarders.room });
    } else if (next.boarders.phase === 'incoming' && next.beat >= RULES.boarderLandBeat) {
      next.boarders = { ...next.boarders, phase: 'aboard', hp: RULES.boarderHp };
      events.push({ t: 0, type: 'boarders_landed', room: next.boarders.room });
    }
  }

  if (kitFight(next)) castAbilities(next, events);

  dispatchCrew(next);

  const overcharged = next.tactics?.burn?.throughBeat >= next.beat;
  for (let tick = 0; tick < TICKS_PER_BEAT && next.result === null && next.phase === 'combat'; tick += 1) {
    const t = tick * TICK_MS;
    const salt = next.beat * 100 + tick * 10;
    runTick(next, events, t, salt, overcharged);
  }
  if (kitFight(next) && next.result === null) chargeAbilities(next);

  next.eventIndex += events.length;
  return { state: next, events };
}

function runTick(next, events, t, salt, overcharged) {
  const sec = TICK_MS / 1000;
  // Player shields.
  const cap = playerShieldCap(next);
  if (next.shields.layers > cap) next.shields.layers = cap;
  if (next.shields.layers < cap) {
    const boost = fxActive(next, 'shieldRecharge') ? 1 + next.fx.shieldRecharge.pct / 100 : 1;
    next.shields.rechargeMs += Math.round(TICK_MS * manning(next, 'shields') * shipStatsOf(next).shieldRechargeMult * boost);
    if (next.shields.rechargeMs >= RULES.shieldRechargeMs) {
      next.shields.layers += 1;
      next.shields.rechargeMs = 0;
      events.push({ t, type: 'shield_up', side: 'player', layers: next.shields.layers });
    }
  } else next.shields.rechargeMs = 0;

  // Enemy shields.
  const enemyCap = enemyShieldCap(next);
  const es = next.enemy.shields;
  if (es.layers > enemyCap) es.layers = enemyCap;
  // An ion hit stalls the enemy's shield recharge for a while.
  if (es.ionMs > 0) {
    es.ionMs = Math.max(0, es.ionMs - TICK_MS);
    if (es.ionMs === 0) events.push({ t, type: 'ion_clear', side: 'enemy' });
  } else if (es.layers < enemyCap) {
    es.rechargeMs += TICK_MS;
    if (es.rechargeMs >= RULES.enemyShieldRechargeMs) {
      es.layers += 1;
      es.rechargeMs = 0;
      events.push({ t, type: 'shield_up', side: 'enemy', layers: es.layers });
    }
  } else es.rechargeMs = 0;

  // Player weapons charge, then fire (all together when holding).
  const rate = manning(next, 'weapons') * integrityFactor(next.rooms.weapons.integrity) * (overcharged ? RULES.overchargeMult : 1)
    * shipStatsOf(next).chargeMult;
  for (const weapon of next.weapons) {
    if (!weaponCanFire(next, weapon)) continue;
    const def = weaponDef(weapon.id);
    weapon.chargeMs = Math.min(def.chargeMs, weapon.chargeMs + Math.round(TICK_MS * rate));
  }
  const armed = next.weapons.filter(w => weaponCanFire(next, w));
  const ready = armed.filter(w => w.chargeMs >= weaponDef(w.id).chargeMs);
  const fireNow = next.intent.hold ? (ready.length === armed.length ? ready : []) : ready;
  const target = currentTarget(next);
  const kitted = kitFight(next);
  const fx = next.fx;
  const extra = kitted ? fx.extraShots || 0 : 0;
  const crit = critChance(next);
  let shotNo = 0;
  for (const weapon of fireNow) {
    const def = weaponDef(weapon.id);
    weapon.chargeMs = 0;
    if (def.kind === 'missile') next.ammo.missile -= 1;
    for (let shot = 0; shot < def.shots + extra; shot += 1) {
      const at = t + shotNo * 70;
      shotNo += 1;
      let shielded = next.enemy.shields.layers > 0;
      // Cold Read: the next shots slip through shields like a missile.
      // Missiles already pass shields and ion is meant to hit them, so neither spends a pierce (audit #6).
      const pierced = kitted && shielded && fx.pierce > 0 && !['missile', 'ion'].includes(def.kind);
      if (pierced) { fx.pierce -= 1; shielded = false; }
      if (shielded && def.kind === 'beam') {
        // Beams only cut an unshielded hull.
        events.push({ t: at, type: 'shot', from: 'player', weapon: weapon.id, room: target, outcome: 'shield', deflected: true });
        continue;
      }
      if (shielded && def.kind !== 'missile') {
        next.enemy.shields.layers -= 1;
        if (def.kind === 'ion') next.enemy.shields.ionMs = def.ionMs;
        events.push({ t: at, type: 'shot', from: 'player', weapon: weapon.id, room: target, outcome: 'shield', ...(def.kind === 'ion' ? { ion: true } : {}) });
        continue;
      }
      // Mark Target and friends: the next shots can't miss and hit harder.
      const sure = kitted && fx.sureHit?.n > 0 ? { ...fx.sureHit } : null;
      if (sure) fx.sureHit.n -= 1;
      if (!sure && seededIndex(next.seed, salt + shot + shotNo * 3 + 1, 100) < enemyEvasion(next)) {
        events.push({ t: at, type: 'shot', from: 'player', weapon: weapon.id, room: target, outcome: 'miss' });
        continue;
      }
      const weak = kitted && fxActive(next, 'weak') && fx.weak.room === target ? fx.weak.mult : 1;
      const roomMult = (sure ? 1 + (sure.roomPct || 0) / 100 : 1) * weak;
      if (def.kind === 'ion') {
        damageRoom(next.enemy.rooms, target, def.roomDamage * roomMult);
        if (target === 'shields') next.enemy.shields.ionMs = def.ionMs;
        events.push({ t: at, type: 'shot', from: 'player', weapon: weapon.id, room: target, outcome: 'hit', damage: 0, ion: true });
        continue;
      }
      const crits = (sure?.crit || (crit > 0 && seededIndex(next.seed, salt + 77 + shotNo * 7, 1000) < Math.round(crit * 1000)));
      const amount = Math.min(crits ? Math.round(def.damage * 1.5) : def.damage, next.enemy.hull);
      next.enemy.hull -= amount;
      const roomHit = (def.roomDamage ?? RULES.roomHitDamage + 2 * def.damage) * roomMult + (crits ? 10 : 0);
      damageRoom(next.enemy.rooms, target, roomHit);
      // A Better Angle: each hit also tears into a neighbouring room.
      if (sure?.splash) damageRoom(next.enemy.rooms, ENEMY_ADJ[target][seededIndex(next.seed, salt + 88 + shotNo, ENEMY_ADJ[target].length)], roomHit / 2);
      events.push({ t: at, type: 'shot', from: 'player', weapon: weapon.id, room: target, outcome: 'hit', damage: amount,
        ...(crits ? { crit: true } : {}), ...(sure ? { sure: true } : {}) });
      maybeFire(next, next.enemy.rooms, target, salt + 50 + shotNo, events, at, 'enemy', def.fireChance);
      if (next.enemy.hull <= 0) {
        next.enemy.hull = 0;
        finish(next, 'win', events, at);
        return;
      }
    }
  }
  if (kitted && extra && fireNow.length) fx.extraShots = 0;

  // Enemy weapons (a bribe stalls them; Customs Cutter slows them).
  const stalled = kitted && fxActive(next, 'stall');
  const slowed = kitted && fxActive(next, 'slow') ? 1 - next.fx.slow.pct / 100 : 1;
  const enemyRate = stalled ? 0
    : integrityFactor(next.enemy.rooms.weapons.integrity) * (next.enemy.rooms.helm.integrity <= 0 ? 0.75 : 1) * slowed;
  next.enemy.weapons.forEach((weapon, index) => {
    if (next.result !== null || next.phase !== 'combat') return;
    weapon.progressMs = Math.min(weapon.chargeMs, weapon.progressMs + Math.round(TICK_MS * enemyRate));
    if (weapon.progressMs < weapon.chargeMs) return;
    weapon.progressMs = 0;
    for (let shot = 0; shot < weapon.shots; shot += 1) {
      const at = t + 120 + shot * 70;
      // The Hallway Moved: nothing lands while it runs, not even on the shields (audit #4).
      if (kitted && fxActive(next, 'evade') && next.fx.evade.bonus >= 100) {
        events.push({ t: at, type: 'shot', from: 'enemy', weapon: weapon.id, room: weapon.target, outcome: 'miss', dodge: true });
        continue;
      }
      if (next.shields.layers > 0) {
        next.shields.layers -= 1;
        events.push({ t: at, type: 'shot', from: 'enemy', weapon: weapon.id, room: weapon.target, outcome: 'shield' });
        continue;
      }
      if (kitted && next.fx.dodgeNext > 0) {
        next.fx.dodgeNext -= 1;
        events.push({ t: at, type: 'shot', from: 'enemy', weapon: weapon.id, room: weapon.target, outcome: 'miss', dodge: true });
        continue;
      }
      if (seededIndex(next.seed, salt + 30 + index * 5 + shot, 100) < playerEvasion(next)) {
        events.push({ t: at, type: 'shot', from: 'enemy', weapon: weapon.id, room: weapon.target, outcome: 'miss' });
        // Laugh at Gauges: every dodge feeds the guns.
        if (kitted && fxActive(next, 'evade') && next.fx.evade.dodgeCharge > 0) chargeWeapons(next, next.fx.evade.dodgeCharge);
        continue;
      }
      const damage = kitted && fxActive(next, 'brace') ? Math.ceil(weapon.damage / 2) : weapon.damage;
      let hull = Math.max(1, next.hull - damage);
      // Later: while it runs the hull holds (at the hold line, or where it already was if lower).
      if (kitted && fxActive(next, 'lastStand')) hull = Math.max(hull, Math.min(next.hull, next.fx.lastStand.hold));
      const taken = next.hull - hull;
      next.hull = hull;
      damageRoom(next.rooms, weapon.target, RULES.roomHitDamage + 2 * weapon.damage);
      // Fights without kits report the weapon's damage, exactly as before (audit #10).
      events.push({ t: at, type: 'shot', from: 'enemy', weapon: weapon.id, room: weapon.target, outcome: 'hit', damage: kitted ? taken : weapon.damage,
        ...(damage < weapon.damage ? { braced: true } : {}) });
      maybeFire(next, next.rooms, weapon.target, salt + 60 + index * 5 + shot, events, at, 'player');
      if (next.hull <= 1) {
        finishLoss(next, events, at, 'Hull breached; retreat with the ship barely holding together.');
        return;
      }
    }
    // Next aim, shown on the player's ship while it charges.
    weapon.target = PLAYER_ROOMS[seededIndex(next.seed, salt + 70 + index, PLAYER_ROOMS.length)];
  });
  if (next.result !== null || next.phase !== 'combat') return;

  // Fires burn and spread on both ships.
  burnFires(next, next.rooms, PLAYER_ADJ, events, t, salt, 'player');
  burnFires(next, next.enemy.rooms, ENEMY_ADJ, events, t, salt + 5, 'enemy');

  // Player crew: fires first, then boarders, then repairs.
  const engineeringBoost = next.crew.some(c => c.room === 'engineering') ? 1.25 : 1;
  const haste = kitted && fxActive(next, 'haste') ? next.fx.haste.mult : 1;
  const door = kitted && fxActive(next, 'holdDoor') ? next.fx.holdDoor.mult : 1;
  for (const member of next.crew) {
    if (!member.room) continue;
    const r = next.rooms[member.room];
    // Grade makes every crew member a little better at the job; engineers add their repair passive.
    const work = (1 + 0.3 * gradeOf(member)) * haste;
    const skill = (member.role === 'engineer' ? 1.5 * (1 + bonusOf(member)) : 1) * engineeringBoost * work;
    if (r.fire > 0) {
      r.fire = Math.max(0, r.fire - RULES.crewExtinguishPerSec * work * (member.role === 'engineer' ? 1 + bonusOf(member) : 1) * sec);
      if (r.fire === 0) { r.fireMs = 0; events.push({ t, type: 'fire_out', side: 'player', room: member.room }); }
    } else if (next.boarders?.phase === 'aboard' && next.boarders.room === member.room) {
      const guard = member.role === 'security' ? 1 + 3 * bonusOf(member) : 1;
      next.boarders.hp = Math.max(0, next.boarders.hp - (['security', 'gunner'].includes(member.role) ? 9 : 6) * guard * door * work * sec);
      if (next.boarders.hp === 0) {
        next.boarders.phase = 'repelled';
        events.push({ t, type: 'boarders_repelled', room: member.room });
      }
    } else if (r.integrity < 100) {
      r.integrity = Math.min(100, r.integrity + RULES.crewRepairPerSec * skill * sec);
    }
  }
  if (next.boarders?.phase === 'aboard' && !(kitted && fxActive(next, 'guard'))) {
    damageRoom(next.rooms, next.boarders.room, RULES.boarderSabotagePerSec * (1 - Math.min(0.8, bestBonus(next, 'security'))) * sec);
  }

  // Enemy crew patch their ship slowly.
  for (const id of ENEMY_ROOMS) {
    const r = next.enemy.rooms[id];
    if (r.fire > 0) {
      r.fire = Math.max(0, r.fire - RULES.enemyExtinguishPerSec * sec);
      if (r.fire === 0) { r.fireMs = 0; events.push({ t, type: 'fire_out', side: 'enemy', room: id }); }
    } else if (r.integrity < 100) r.integrity = Math.min(100, r.integrity + next.enemy.repairPerSec * sec);
  }
  for (const r of [...Object.values(next.rooms), ...Object.values(next.enemy.rooms)]) r.integrity = Math.round(r.integrity * 100) / 100;
}

// --- Abilities ---------------------------------------------------------------

/** Add pct% of each player weapon's full charge (weapons that can fire). */
function chargeWeapons(next, pct) {
  for (const weapon of next.weapons) {
    if (!weaponCanFire(next, weapon)) continue;
    const full = weaponDef(weapon.id).chargeMs;
    weapon.chargeMs = Math.min(full, weapon.chargeMs + Math.round(full * pct / 100));
  }
}

/** Rooms worst first: burning rooms, then the most damaged. */
const worstRooms = (state, n) => [...PLAYER_ROOMS]
  .filter(id => state.rooms[id].fire > 0 || state.rooms[id].integrity < 100)
  .sort((a, b) => (state.rooms[b].fire > 0) - (state.rooms[a].fire > 0) || state.rooms[a].integrity - state.rooms[b].integrity)
  .slice(0, n);

const timed = (next, beats) => next.beat + Math.max(1, Math.trunc(beats || 1)) - 1;

/**
 * Cast a timed effect without weakening one that is still running: the stronger value and the later
 * end win, field by field (audit #3).
 */
function mergeTimed(next, key, value) {
  const old = next.fx[key];
  if (!fxActive(next, key)) { next.fx[key] = value; return; }
  const merged = { ...old };
  for (const [field, v] of Object.entries(value)) merged[field] = typeof v === 'number' ? Math.max(old[field] ?? 0, v) : v;
  next.fx[key] = merged;
}
const capped = (value, max) => Math.min(max, Math.max(0, Math.trunc(value)));

/** Apply one crew member's signature move. Returns early if it wins the fight. */
function applyAbility(next, member, events) {
  const kit = memberKit(member);
  const fx = next.fx;
  const target = currentTarget(next);
  events.push({ t: 0, type: 'ability', crewId: member.id, kit: member.kit, move: kit.move, effects: kit.effects.map(e => e.type) });
  for (const e of kit.effects) {
    switch (e.type) {
      case 'charge': chargeWeapons(next, e.pct); break;
      case 'fullCharge': chargeWeapons(next, 100); break;
      case 'fireNow': chargeWeapons(next, 100); fx.extraShots = capped((fx.extraShots || 0) + (e.extraShots || 0), 3); break;
      case 'extraShots': fx.extraShots = capped((fx.extraShots || 0) + e.n, 3); break;
      case 'pierce': fx.pierce = capped((fx.pierce || 0) + e.n, 10); break;
      case 'sureHit': {
        // Stacked sure-hit moves keep the best of each (audit #8).
        const live = fx.sureHit?.n > 0 ? fx.sureHit : null;
        fx.sureHit = { n: capped((live?.n || 0) + e.n, 10), roomPct: Math.max(live?.roomPct || 0, e.roomPct || 0),
          crit: Boolean(live?.crit) || e.crit === true, splash: Boolean(live?.splash) || e.splash === true };
        break;
      }
      case 'freeShot': {
        for (let shot = 0; shot < (e.shots || 1); shot += 1) {
          const amount = Math.min(e.damage, next.enemy.hull);
          next.enemy.hull -= amount;
          damageRoom(next.enemy.rooms, target, RULES.roomHitDamage + 2 * e.damage);
          events.push({ t: shot * 70, type: 'shot', from: 'player', weapon: 'ability', crewId: member.id, room: target, outcome: 'hit', damage: amount });
          if (next.enemy.hull <= 0) { next.enemy.hull = 0; finish(next, 'win', events, shot * 70); return; }
        }
        break;
      }
      case 'evade': mergeTimed(next, 'evade', { bonus: e.bonus, through: timed(next, e.beats), dodgeCharge: 0 }); break;
      case 'dodgeCharge': if (fx.evade) fx.evade.dodgeCharge = Math.max(fx.evade.dodgeCharge || 0, e.pct); break;
      case 'dodgeNext': fx.dodgeNext = capped((fx.dodgeNext || 0) + e.n, 10); break;
      case 'shieldBurst':
        if (e.over > 0) fx.shieldOver = { n: Math.min(1, e.over), through: timed(next, e.beats) };
        next.shields.layers = Math.max(next.shields.layers, playerShieldCap(next));
        next.shields.rechargeMs = 0;
        events.push({ t: 0, type: 'shield_up', side: 'player', layers: next.shields.layers, ability: true });
        break;
      case 'shieldRecharge': mergeTimed(next, 'shieldRecharge', { pct: e.pct, through: timed(next, e.beats) }); break;
      case 'repair': {
        const rooms = e.rooms === 'all' ? [...PLAYER_ROOMS] : worstRooms(next, e.rooms || 1);
        for (const id of rooms) {
          const r = next.rooms[id];
          if (r.fire > 0) { r.fire = 0; r.fireMs = 0; events.push({ t: 0, type: 'fire_out', side: 'player', room: id }); }
          r.integrity = Math.min(100, r.integrity + e.amount);
        }
        events.push({ t: 0, type: 'repair', rooms, amount: e.amount });
        break;
      }
      case 'extinguish':
        for (const id of PLAYER_ROOMS) {
          const r = next.rooms[id];
          if (r.fire > 0) { r.fire = 0; r.fireMs = 0; events.push({ t: 0, type: 'fire_out', side: 'player', room: id }); }
        }
        break;
      case 'hullPatch': {
        const before = next.hull;
        next.hull = Math.min(RULES.playerHullMax, next.hull + e.amount);
        events.push({ t: 0, type: 'hull_patch', amount: next.hull - before });
        break;
      }
      case 'haste': mergeTimed(next, 'haste', { mult: e.mult, through: timed(next, e.beats) }); break;
      case 'allCharge':
        for (const other of next.crew) if (other !== member && hasKit(other)) other.charge = Math.min(100, other.charge + e.pct);
        break;
      case 'stall': fx.stall = { through: Math.max(fx.stall?.through ?? 0, timed(next, e.beats)) }; break;
      case 'slow': mergeTimed(next, 'slow', { pct: e.pct, through: timed(next, e.beats) }); break;
      case 'drain':
        next.enemy.shields.layers = Math.max(0, next.enemy.shields.layers - e.n);
        next.enemy.shields.rechargeMs = 0;
        next.enemy.shields.ionMs = WEAPON_CATALOG.ion.ionMs;
        events.push({ t: 0, type: 'drain', side: 'enemy', layers: next.enemy.shields.layers });
        break;
      case 'shieldMaxDown':
        fx.enemyShieldDown = capped((fx.enemyShieldDown || 0) + e.n, 2);
        next.enemy.shields.layers = Math.min(next.enemy.shields.layers, enemyShieldCap(next));
        break;
      case 'strike': {
        damageRoom(next.enemy.rooms, target, e.room);
        const amount = Math.min(e.hull || 0, next.enemy.hull);
        next.enemy.hull -= amount;
        events.push({ t: 0, type: 'strike', side: 'enemy', room: target, damage: amount });
        if (next.enemy.hull <= 0) { next.enemy.hull = 0; finish(next, 'win', events, 0); return; }
        break;
      }
      case 'offline':
        next.enemy.rooms[target].integrity = 0;
        events.push({ t: 0, type: 'strike', side: 'enemy', room: target, damage: 0, offline: true });
        break;
      case 'ignite': {
        const id = e.room === 'weapons' ? 'weapons' : target;
        if (next.enemy.rooms[id].fire === 0) {
          next.enemy.rooms[id].fire = 100;
          next.enemy.rooms[id].fireMs = 0;
          events.push({ t: 0, type: 'fire_start', side: 'enemy', room: id });
        }
        break;
      }
      case 'weakRoom':
        if (fxActive(next, 'weak') && fx.weak.room === target) mergeTimed(next, 'weak', { room: target, mult: e.mult, through: timed(next, e.beats) });
        else fx.weak = { room: target, mult: e.mult, through: timed(next, e.beats) };
        break;
      case 'evasionDown': mergeTimed(next, 'evasionDown', { amount: e.amount, through: timed(next, e.beats) }); break;
      case 'brace': fx.brace = { through: Math.max(fx.brace?.through ?? 0, timed(next, e.beats)) }; break;
      case 'holdDoor':
        if (next.boarders?.phase === 'aboard') mergeTimed(next, 'holdDoor', { mult: e.mult, through: timed(next, e.beats) });
        else fx.brace = { through: Math.max(fx.brace?.through ?? 0, timed(next, 2)) };
        break;
      case 'guard': mergeTimed(next, 'guard', { through: timed(next, e.beats) }); break;
      case 'lastStand':
        if (!fx.lastStandUsed) { fx.lastStand = { hold: e.hold, through: timed(next, e.beats) }; fx.lastStandUsed = true; }
        break;
      case 'salvage':
        if (!fx.salvageUsed) { fx.salvage = Math.min(100, (fx.salvage || 0) + e.pct); fx.salvageUsed = true; }
        break;
      case 'rewind':
        for (const weapon of next.enemy.weapons) weapon.progressMs = 0;
        events.push({ t: 0, type: 'rewind', side: 'enemy' });
        break;
      default: break;
    }
  }
}

const enemyAboutToFire = state => state.enemy.weapons.some(w => w.progressMs >= w.chargeMs * 0.7);
const gunsAboutToFire = state => state.weapons.some(w => weaponCanFire(state, w) && w.chargeMs >= weaponDef(w.id).chargeMs * 0.7);
const gunsLow = state => {
  const armed = state.weapons.filter(w => weaponCanFire(state, w));
  return armed.length > 0 && armed.reduce((sum, w) => sum + w.chargeMs / weaponDef(w.id).chargeMs, 0) / armed.length < 0.6;
};
const roomsHurt = (state, below) => PLAYER_ROOMS.some(id => state.rooms[id].fire > 0 || state.rooms[id].integrity < below);

/** Would this effect help right now? (The Auto policy and scripted captains cast when any effect would.) */
function effectUseful(state, e, member) {
  switch (e.type) {
    case 'charge': case 'fullCharge': case 'fireNow': return gunsLow(state);
    case 'extraShots': case 'sureHit': case 'weakRoom': case 'evasionDown': return gunsAboutToFire(state);
    case 'pierce': return gunsAboutToFire(state) && state.enemy.shields.layers > 0;
    case 'freeShot': case 'strike': case 'offline': case 'ignite': case 'shieldMaxDown': return true;
    case 'drain': return state.enemy.shields.layers > 0;
    case 'evade': return enemyAboutToFire(state) && !(fxActive(state, 'evade') && state.fx.evade.bonus >= e.bonus);
    case 'brace': return enemyAboutToFire(state) && !fxActive(state, 'brace');
    case 'stall': return enemyAboutToFire(state) && !fxActive(state, 'stall');
    case 'slow': return enemyAboutToFire(state) && !fxActive(state, 'stall') && !(fxActive(state, 'slow') && state.fx.slow.pct >= e.pct);
    case 'dodgeNext': case 'rewind': return enemyAboutToFire(state);
    case 'shieldBurst': case 'shieldRecharge': return state.shields.layers < playerShieldCap(state);
    case 'repair': case 'extinguish': return roomsHurt(state, 70);
    case 'hullPatch': return state.hull <= RULES.playerHullMax - e.amount || state.hull < 50;
    case 'haste': return (roomsHurt(state, 80) || state.boarders?.phase === 'aboard') && !(fxActive(state, 'haste') && state.fx.haste.mult >= e.mult);
    case 'allCharge': return state.crew.some(other => other !== member && hasKit(other) && other.charge < 50);
    case 'holdDoor': return state.boarders?.phase === 'aboard' || enemyAboutToFire(state);
    case 'guard': return ['incoming', 'aboard'].includes(state.boarders?.phase);
    case 'lastStand': return !state.fx?.lastStandUsed && state.hull <= 45;
    case 'salvage': return !state.fx?.salvageUsed;
    default: return false;
  }
}

export function abilityUseful(state, member) {
  const kit = memberKit(member);
  return Boolean(kit) && member.charge >= 100 && kit.effects.some(e => effectUseful(state, e, member));
}

/** Queued taps first, then (with Auto on) every charged ability that would help now. */
function castAbilities(next, events) {
  const queued = [...(next.intent.cast || [])];
  if (next.intent.auto) {
    for (const member of next.crew) if (!queued.includes(member.id) && abilityUseful(next, member)) queued.push(member.id);
  }
  next.intent.cast = [];
  for (const id of queued) {
    const member = next.crew.find(c => c.id === id);
    if (!member || !hasKit(member) || member.charge < 100 || next.result !== null) continue;
    member.charge = 0;
    applyAbility(next, member, events);
  }
}

/** Abilities charge every beat; medics aboard speed everyone up (their passive). */
/** Beats a move takes to charge: the kit's, 2 faster per Ascension step (never under 8). */
export const abilityChargeBeats = member => Math.max(8, (memberKit(member)?.charge || 14) - 2 * (member.tier || 0));

export function abilityGainPerBeat(state, member) {
  const kit = memberKit(member);
  if (!kit) return 0;
  const assist = bestBonus(state, 'medic');
  return Math.max(1, Math.round(100 * (1 + 2 * assist) / abilityChargeBeats(member)));
}

function chargeAbilities(next) {
  for (const member of next.crew) {
    if (!hasKit(member)) continue;
    member.charge = Math.min(100, member.charge + abilityGainPerBeat(next, member));
  }
}

function burnFires(next, rooms, adjacency, events, t, salt, side) {
  for (const id of Object.keys(rooms)) {
    const r = rooms[id];
    if (r.fire <= 0) continue;
    damageRoom(rooms, id, RULES.fireBurnPerSec * TICK_MS / 1000);
    r.fireMs += TICK_MS;
    if (r.fireMs === RULES.fireSpreadAfterMs) {
      const near = adjacency[id];
      const to = near[seededIndex(next.seed, salt + 90, near.length)];
      if (rooms[to].fire === 0) {
        rooms[to].fire = 100;
        rooms[to].fireMs = 0;
        events.push({ t, type: 'fire_start', side, room: to, spread: true });
      }
    }
  }
}

// --- Save validation ----------------------------------------------------------

const rec = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const num = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

function validRooms(rooms, ids) {
  return rec(rooms) && Object.keys(rooms).length === ids.length && ids.every(id => rec(rooms[id])
    && num(rooms[id].integrity, 0, 100) && num(rooms[id].fire, 0, 100)
    && int(rooms[id].fireMs, 0, 3_600_000) && rooms[id].fireMs % TICK_MS === 0
    && (rooms[id].fire > 0 || rooms[id].fireMs === 0));
}

function validShields(shields, maxLayers, rechargeMax) {
  return rec(shields) && int(shields.max, 0, maxLayers) && int(shields.layers, 0, shields.max)
    && int(shields.rechargeMs, 0, rechargeMax);
}

const bool = value => typeof value === 'boolean';
/** A timed effect: { through, ...params } with each param in range. */
const timedFx = (value, beat, params = {}) => rec(value) && int(value.through, 0, beat + 30)
  && Object.keys(value).every(key => key === 'through' || Object.hasOwn(params, key))
  && Object.entries(params).every(([key, check]) => check(value[key]));
const FX_RULES = {
  evade: beat => v => timedFx(v, beat, { bonus: x => num(x, 0, 100), dodgeCharge: x => num(x, 0, 50) }),
  haste: beat => v => timedFx(v, beat, { mult: x => num(x, 1, 3) }),
  stall: beat => v => timedFx(v, beat),
  slow: beat => v => timedFx(v, beat, { pct: x => num(x, 0, 90) }),
  brace: beat => v => timedFx(v, beat),
  guard: beat => v => timedFx(v, beat),
  holdDoor: beat => v => timedFx(v, beat, { mult: x => num(x, 1, 5) }),
  evasionDown: beat => v => timedFx(v, beat, { amount: x => num(x, 0, 30) }),
  weak: beat => v => timedFx(v, beat, { room: x => ENEMY_ROOMS.includes(x), mult: x => num(x, 1, 3) }),
  shieldOver: beat => v => timedFx(v, beat, { n: x => int(x, 1, 1) }),
  shieldRecharge: beat => v => timedFx(v, beat, { pct: x => num(x, 0, 100) }),
  lastStand: beat => v => timedFx(v, beat, { hold: x => int(x, 1, RULES.playerHullMax) }),
  sureHit: () => v => rec(v) && int(v.n, 0, 10) && num(v.roomPct, 0, 100) && bool(v.crit) && bool(v.splash) && Object.keys(v).length === 4,
  extraShots: () => v => int(v, 0, 3),
  pierce: () => v => int(v, 0, 10),
  dodgeNext: () => v => int(v, 0, 10),
  enemyShieldDown: () => v => int(v, 0, 2),
  salvage: () => v => num(v, 0, 100),
  lastStandUsed: () => v => v === true,
  salvageUsed: () => v => v === true,
};

/** The most each role's passive can be (best in the roster at 5 stars), so a save cannot claim more. */
const ROLE_PASSIVE_KEY = { gunner: 'critChance', engineer: 'repairBonus', medic: 'assistCharge', trader: 'tradeCredits',
  scout: 'expeditionSuccess', security: 'pirateResist', pilot: 'fuelCostReduce' };
const ROLE_BONUS_MAX = Object.fromEntries(Object.entries(ROLE_PASSIVE_KEY).map(([role, key]) => [role,
  Math.round(Math.max(0, ...CREW_CATALOG.filter(t => t.role === role).map(t => Number(t.passive?.[key]) || 0)) * 1.4 * 1000 + 1) / 1000]));

/** What the kits aboard can produce: each effect's biggest value, so a save cannot carry more (audit #2). */
function kitCaps(crew) {
  const caps = {};
  const up = (key, value = 1) => { caps[key] = Math.max(caps[key] ?? 0, value); };
  for (const member of crew) {
    for (const e of memberKit(member)?.effects || []) {
      if (e.type === 'evade') up('evade', e.bonus);
      else if (e.type === 'dodgeCharge') up('dodgeCharge', e.pct);
      else if (e.type === 'haste') up('haste', e.mult);
      else if (e.type === 'stall') up('stall');
      else if (e.type === 'slow') up('slow', e.pct);
      else if (e.type === 'brace') up('brace');
      else if (e.type === 'holdDoor') { up('holdDoor', e.mult); up('brace'); }
      else if (e.type === 'guard') up('guard');
      else if (e.type === 'evasionDown') up('evasionDown', e.amount);
      else if (e.type === 'weakRoom') up('weak', e.mult);
      else if (e.type === 'shieldBurst' && e.over) up('shieldOver');
      else if (e.type === 'shieldRecharge') up('shieldRecharge', e.pct);
      else if (e.type === 'lastStand') up('lastStand', e.hold);
      else if (e.type === 'sureHit') { up('sureHit'); up('sureRoomPct', e.roomPct || 0); if (e.crit) up('sureCrit'); if (e.splash) up('sureSplash'); }
      else if (e.type === 'extraShots' || (e.type === 'fireNow' && e.extraShots)) up('extraShots');
      else if (e.type === 'pierce') up('pierce');
      else if (e.type === 'dodgeNext') up('dodgeNext');
      else if (e.type === 'shieldMaxDown') up('enemyShieldDown');
      else if (e.type === 'salvage') up('salvage', e.pct);
    }
  }
  return caps;
}

function fxWithinKits(fx, caps) {
  const has = key => caps[key] !== undefined;
  const checks = {
    evade: v => has('evade') && v.bonus <= caps.evade && v.dodgeCharge <= (caps.dodgeCharge || 0),
    haste: v => has('haste') && v.mult <= caps.haste,
    stall: () => has('stall'),
    slow: v => has('slow') && v.pct <= caps.slow,
    brace: () => has('brace'),
    guard: () => has('guard'),
    holdDoor: v => has('holdDoor') && v.mult <= caps.holdDoor,
    evasionDown: v => has('evasionDown') && v.amount <= caps.evasionDown,
    weak: v => has('weak') && v.mult <= caps.weak,
    shieldOver: () => has('shieldOver'),
    shieldRecharge: v => has('shieldRecharge') && v.pct <= caps.shieldRecharge,
    lastStand: v => has('lastStand') && v.hold <= caps.lastStand,
    lastStandUsed: () => has('lastStand'),
    sureHit: v => v.n === 0 || (has('sureHit') && v.roomPct <= caps.sureRoomPct && (!v.crit || has('sureCrit')) && (!v.splash || has('sureSplash'))),
    extraShots: v => v === 0 || has('extraShots'),
    pierce: v => v === 0 || has('pierce'),
    dodgeNext: v => v === 0 || has('dodgeNext'),
    enemyShieldDown: v => v === 0 || has('enemyShieldDown'),
    salvage: v => has('salvage') && v <= caps.salvage,
    salvageUsed: () => has('salvage'),
  };
  return Object.entries(fx).every(([key, value]) => checks[key]?.(value));
}

/** Ability state of a kit fight: effects in range and from kits aboard, taps queued only for charged crew. */
function validKitState(e) {
  const fx = e.fx;
  if (!rec(fx) || !Object.entries(fx).every(([key, value]) => FX_RULES[key] && FX_RULES[key](e.beat)(value))) return false;
  if (!fxWithinKits(fx, kitCaps(e.crew))) return false;
  if (Object.hasOwn(fx, 'lastStand') !== Boolean(fx.lastStandUsed)) return false;
  if (Object.hasOwn(fx, 'salvage') !== Boolean(fx.salvageUsed)) return false;
  const { cast, auto } = e.intent;
  return Array.isArray(cast) && new Set(cast).size === cast.length && typeof auto === 'boolean'
    && cast.every(id => e.crew.some(c => c.id === id && hasKit(c) && c.charge === 100));
}

/** Shape and rule checks for a saved v3 fight, independent of what it is bound to. */
export function validFtlBody(e) {
  if (!rec(e) || e.version !== FTL_VERSION || e.kind !== 'normal' || !Number.isInteger(e.seed)
    || !int(e.beat, 0, 100_000) || e.revision !== e.beat || !Number.isInteger(e.eventIndex) || e.eventIndex < e.beat) return false;
  if (!(e.result === null ? ['combat', 'downed'].includes(e.phase) : e.phase === 'complete')) return false;
  if (e.result !== null && !['win', 'loss'].includes(e.result)) return false;
  if (Object.hasOwn(e, 'guided') && e.guided !== true) return false;
  if (e.phase === 'downed' && e.hull !== 1) return false;
  if (Object.hasOwn(e, 'rally') && !(rec(e.rally) && e.rally.used === true)) return false;
  if (!int(e.hull, 1, RULES.playerHullMax) || !int(e.startHull, 1, RULES.playerHullMax)) return false;
  // Ship levels (drydock) are saved with the fight; layers and slots must match them.
  if (Object.hasOwn(e, 'ship') && !(rec(e.ship) && rec(e.ship.levels)
    && ['shields', 'weapons', 'engines', 'sensors'].every(key => int(e.ship.levels[key], 1, 20)))) return false;
  const stats = shipStatsOf(e);
  // Four-Arm Oath may hold one layer above max while it runs.
  const over = rec(e.fx) && rec(e.fx.shieldOver) && Number.isInteger(e.fx.shieldOver.through) && e.fx.shieldOver.through >= e.beat ? 1 : 0;
  if (!(rec(e.shields) && int(e.shields.max, 0, 3) && int(e.shields.layers, 0, e.shields.max + over)
    && int(e.shields.rechargeMs, 0, RULES.shieldRechargeMs * 2)) || e.shields.max !== stats.shieldLayers || !validRooms(e.rooms, PLAYER_ROOMS)) return false;
  if (!Array.isArray(e.weapons) || e.weapons.length < 1 || e.weapons.length > stats.weaponSlots
    || new Set(e.weapons.map(w => w?.id)).size !== e.weapons.length
    || !e.weapons.every(w => rec(w) && WEAPON_CATALOG[w.id] && int(w.chargeMs, 0, WEAPON_CATALOG[w.id].chargeMs))) return false;
  const missiles = e.weapons.filter(w => WEAPON_CATALOG[w.id].kind === 'missile').length;
  if (missiles ? !(rec(e.ammo) && int(e.ammo.missile, 0, missiles * WEAPON_CATALOG.missile.ammo)) : Object.hasOwn(e, 'ammo')) return false;
  if (!Array.isArray(e.crew) || e.crew.length > 24 || new Set(e.crew.map(c => c?.id)).size !== e.crew.length
    || !e.crew.every(c => rec(c) && typeof c.id === 'string' && c.id && typeof c.role === 'string'
      && (c.station === null || PLAYER_ROOMS.includes(c.station)) && (c.room === null || PLAYER_ROOMS.includes(c.room))
      && int(c.manualUntil, 0, e.beat + RULES.autoReturnBeats)
      // A kit (signature move) comes with its grade, passive bonus and charge; crew without one carry none of them.
      // A kit is a real merc of that role, with a passive no bigger than that role's best (audit #2).
      && (hasKit(c) ? c.kit.length <= 64 && catalogById(c.kit)?.role === c.role && Boolean(kitFor(c.kit, c.role))
          && num(c.grade, 0, 1) && num(c.bonus, 0, ROLE_BONUS_MAX[c.role] ?? 0) && int(c.charge, 0, 100) && int(c.tier, 0, 3)
        : !['kit', 'grade', 'bonus', 'charge', 'tier'].some(key => Object.hasOwn(c, key))))) return false;
  const i = e.intent;
  if (!rec(i) || !(i.target === null || ENEMY_ROOMS.includes(i.target)) || typeof i.hold !== 'boolean' || !rec(i.moves)
    || !Object.entries(i.moves).every(([id, roomId]) => e.crew.some(c => c.id === id) && PLAYER_ROOMS.includes(roomId))) return false;
  if (Object.hasOwn(e, 'fx') ? !validKitState(e)
    : (e.crew.some(hasKit) || Object.hasOwn(i, 'cast') || Object.hasOwn(i, 'auto'))) return false;
  const en = e.enemy;
  if (!rec(en) || !num(en.threat, 0.6, 1.6)) return false;
  if (Object.hasOwn(en, 'flagship') && ![1, 2].includes(en.flagship)) return false;
  if (Object.hasOwn(en, 'tier') && ![1, 2].includes(en.tier)) return false;
  const kits = Object.hasOwn(e, 'fx');
  const load = enemyLoadout(en.threat, { flagship: en.flagship || 0, tier: en.tier || 0, kits });
  const startHull = enemyStartHull(e);
  if (!int(startHull, 1, kits ? KIT_ENEMY.hull : ENEMY_HULL) || !int(en.hull, 0, startHull) || en.evasion !== load.evasion || en.repairPerSec !== load.repairPerSec
    || !validShields(en.shields, 2, RULES.enemyShieldRechargeMs * 2) || en.shields.max !== load.shieldLayers
    || (Object.hasOwn(en.shields, 'ionMs') && !int(en.shields.ionMs, 0, WEAPON_CATALOG.ion.ionMs))
    || !validRooms(en.rooms, ENEMY_ROOMS)) return false;
  // The enemy's guns are derived from threat: an edited save cannot soften them.
  if (!Array.isArray(en.weapons) || en.weapons.length !== load.weapons.length
    || !en.weapons.every((w, k) => rec(w) && w.id === load.weapons[k].id && w.shots === load.weapons[k].shots
      && w.damage === load.weapons[k].damage && w.chargeMs === load.weapons[k].chargeMs
      && int(w.progressMs, 0, w.chargeMs) && PLAYER_ROOMS.includes(w.target))) return false;
  if (e.result === null && en.hull === 0) return false;
  if (e.result === 'win' && (e.beat === 0 || en.hull !== 0)) return false;
  if (e.result === 'loss' && (e.beat === 0 || e.hull !== 1 || en.hull <= 0)) return false;
  if (Object.hasOwn(e, 'tactics')) {
    const t = e.tactics;
    if (!rec(t) || !Object.keys(t).every(name => ['burn', 'board'].includes(name))) return false;
    if (t.burn && !(rec(t.burn) && [0, 1].includes(t.burn.uses) && Number.isInteger(t.burn.throughBeat)
      && (t.burn.uses === 0 ? t.burn.throughBeat === 0 : int(t.burn.throughBeat, RULES.overchargeBeats, e.beat + RULES.overchargeBeats - 1)))) return false;
    if (t.board && !(rec(t.board) && [0, 1].includes(t.board.uses)
      && (t.board.uses === 0 ? t.board.success === null : typeof t.board.success === 'boolean')
      && (!t.board.success || (e.result === 'win' && en.hull === 0)))) return false;
  }
  if (Object.hasOwn(e, 'boarders')) {
    const b = e.boarders;
    if (!rec(b) || !['none', 'incoming', 'aboard', 'repelled'].includes(b.phase) || !num(b.hp, 0, RULES.boarderHp)) return false;
    if (b.phase === 'none' ? (b.room !== null || b.hp !== 0 || e.beat >= RULES.boarderWarnBeat + 1) : !PLAYER_ROOMS.includes(b.room)) return false;
    if (b.phase === 'incoming' && b.hp !== 0) return false;
  }
  return true;
}

// --- Scripted captains (reward previews, economy simulator, balance harness) --

/** Longest a v3 fight can run in a scripted loop before giving up. */
export const MAX_FIGHT_BEATS = 200;

/**
 * What a scripted captain does before the next beat.
 * - idle: nothing (crew and auto-targeting only).
 * - smart: hold volleys while the enemy has shields, break shields, then guns.
 * - initiative: smart, plus Overcharge early and Board once it is open.
 * Returns { commands, order }.
 */
export function ftlPolicyStep(state, policy = 'idle') {
  if (state.phase === 'downed') return { commands: [], order: null };
  if (policy === 'idle') return { commands: [], order: null };
  const commands = [];
  const shielded = enemyShieldMax(state) > 0 && state.enemy.rooms.shields.integrity > 0;
  if (state.intent.hold !== shielded) commands.push({ type: 'hold', hold: shielded });
  const room = shielded ? 'shields' : 'weapons';
  if (state.intent.target !== room) commands.push({ type: 'target', room });
  let order = null;
  if (policy === 'initiative') {
    if (ftlTacticStatus(state, 'board').available) order = 'board';
    else if (ftlTacticStatus(state, 'burn').available) order = 'burn';
  }
  return { commands, order };
}

/** Charge gained per beat (ms), for smooth bars between beats. */
export function playerChargePerBeat(state) {
  const overcharged = state.tactics?.burn?.throughBeat > state.beat;
  return Math.round(BEAT_MS * manning(state, 'weapons') * integrityFactor(state.rooms.weapons.integrity) * (overcharged ? RULES.overchargeMult : 1)
    * shipStatsOf(state).chargeMult);
}

export function enemyChargePerBeat(state) {
  // The next beat's rate: a bribe stops their guns, Customs Cutter slows them (audit #9).
  const nextBeat = (state.beat || 0) + 1;
  if (state.fx?.stall?.through >= nextBeat) return 0;
  const slowed = state.fx?.slow?.through >= nextBeat ? 1 - state.fx.slow.pct / 100 : 1;
  return Math.round(BEAT_MS * integrityFactor(state.enemy.rooms.weapons.integrity) * (state.enemy.rooms.helm.integrity <= 0 ? 0.75 : 1) * slowed);
}
