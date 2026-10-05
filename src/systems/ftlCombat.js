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
export function enemyLoadout(threat = 1, { flagship = 0, tier: enemyTier = 0 } = {}) {
  const t = clamp(Number(threat) || 1, 0.6, 1.6);
  const tier = flagship === true ? 2 : Math.max(0, Math.min(2, Math.trunc(Number(flagship) || 0)));
  // Enemy tier comes from the ship's class (later sectors): tier 1 fires three-shot volleys,
  // tier 2 also carries an extra shield layer, so upgraded Sparrows still meet a fight.
  const shipTier = Math.max(0, Math.min(2, Math.trunc(Number(enemyTier) || 0)));
  const damage = Math.max(2, Math.round(-16 + 24 * t));
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
  shipLevels = null, loadout = DEFAULT_LOADOUT, flagship = 0, enemyTier = 0 }) {
  const s = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 0;
  const tier = Math.max(0, Math.min(2, Math.trunc(Number(enemyTier) || 0)));
  const load = enemyLoadout(threat, { flagship, tier });
  const levels = shipLevels ? Object.fromEntries(['shields', 'weapons', 'engines', 'sensors']
    .map(key => [key, Math.max(1, Math.min(20, Math.trunc(shipLevels[key] || 1)))])) : null;
  const stats = shipCombatStats(levels || {});
  const guns = (loadout || DEFAULT_LOADOUT).filter(id => WEAPON_CATALOG[id]).slice(0, stats.weaponSlots);
  const fitted = guns.length ? guns : [...DEFAULT_LOADOUT];
  const missiles = fitted.filter(id => WEAPON_CATALOG[id].kind === 'missile').length;
  const shieldLayers = stats.shieldLayers;
  const startHull = Number.isInteger(enemyHull) ? clamp(enemyHull, 1, 42) : 42;
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
    crew: crew.map(member => ({
      id: String(member.id), role: String(member.role || ''),
      station: PLAYER_ROOMS.includes(member.station) ? member.station : null,
      room: PLAYER_ROOMS.includes(member.station) ? member.station : null,
      manualUntil: 0,
    })),
    intent: { target: null, hold: false, moves: {} },
    enemy: {
      hull: startHull,
      ...(flagship ? { flagship: Math.max(1, Math.min(2, Math.trunc(Number(flagship) || 1))) } : {}),
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

/** 1.0 unmanned, 1.15 manned, 1.3 manned by the station's role. */
export function manning(state, roomId) {
  const here = state.crew.filter(member => member.room === roomId);
  if (!here.length) return 1;
  return here.some(member => member.role === stationRole(roomId)) ? 1.3 : 1.15;
}

const integrityFactor = integrity => (integrity >= 50 ? 1 : integrity > 0 ? 0.5 : 0);

export function playerShieldCap(state) {
  const integrity = state.rooms.shields.integrity;
  return integrity >= 50 ? state.shields.max : integrity > 0 ? Math.max(0, state.shields.max - 1) : 0;
}

export function enemyShieldCap(state) {
  const { shields, rooms } = state.enemy;
  return rooms.shields.integrity >= 50 ? shields.max : rooms.shields.integrity > 0 ? Math.max(0, shields.max - 1) : 0;
}

/** Percent chance an enemy shot misses the player (engines upgrades add to it). */
export function playerEvasion(state) {
  const base = state.crew.some(member => member.room === 'helm') ? (manning(state, 'helm') >= 1.3 ? 15 : 10) : 5;
  return Math.round((base + shipStatsOf(state).evasionBonus) * state.rooms.helm.integrity / 100);
}

/** Percent chance a player shot misses (sensors upgrades take from it). */
export function enemyEvasion(state) {
  const { evasion, rooms } = state.enemy;
  if (rooms.helm.integrity <= 0) return 0;
  return Math.max(0, Math.round(evasion * rooms.engines.integrity / 100) - shipStatsOf(state).accuracyBonus);
}

/** What an idle captain shoots: shields while they matter, then weapons. */
export function autoTarget(state) {
  return state.enemy.shields.max > 0 && state.enemy.rooms.shields.integrity > 0 ? 'shields' : 'weapons';
}

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
  const finishing = (state?.enemy?.hull ?? 42) <= 10 ? 0.15 : 0;
  // Knocked-out enemy weapons or helm make a boarding party far likelier to hold.
  const crippled = state?.enemy?.rooms && (state.enemy.rooms.weapons.integrity <= 0 || state.enemy.rooms.helm.integrity <= 0) ? 0.1 : 0;
  return Math.max(0.2, Math.min(0.92, Math.round((0.8 - (threat - 1) * 0.7 + finishing + crippled) * 100) / 100));
}

export const ftlTacticStatus = tacticAvailable;

export const RALLY_RULE = Object.freeze({ nearMissPct: 0.2 });

export function ftlRallyEligible(state) {
  if (state.rally?.used) return false;
  const start = Number.isInteger(state.enemy.startHull) ? state.enemy.startHull : 42;
  return state.enemy.hull > 0 && state.enemy.hull <= start * RALLY_RULE.nearMissPct;
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
    const amount = Math.max(1, Math.round(next.enemy.weapons[0].damage * 1.5));
    next.hull = Math.max(1, next.hull - amount);
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

  dispatchCrew(next);

  const overcharged = next.tactics?.burn?.throughBeat >= next.beat;
  for (let tick = 0; tick < TICKS_PER_BEAT && next.result === null && next.phase === 'combat'; tick += 1) {
    const t = tick * TICK_MS;
    const salt = next.beat * 100 + tick * 10;
    runTick(next, events, t, salt, overcharged);
  }

  next.eventIndex += events.length;
  return { state: next, events };
}

function runTick(next, events, t, salt, overcharged) {
  const sec = TICK_MS / 1000;
  // Player shields.
  const cap = playerShieldCap(next);
  if (next.shields.layers > cap) next.shields.layers = cap;
  if (next.shields.layers < cap) {
    next.shields.rechargeMs += Math.round(TICK_MS * manning(next, 'shields') * shipStatsOf(next).shieldRechargeMult);
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
  let shotNo = 0;
  for (const weapon of fireNow) {
    const def = weaponDef(weapon.id);
    weapon.chargeMs = 0;
    if (def.kind === 'missile') next.ammo.missile -= 1;
    for (let shot = 0; shot < def.shots; shot += 1) {
      const at = t + shotNo * 70;
      shotNo += 1;
      const shielded = next.enemy.shields.layers > 0;
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
      if (seededIndex(next.seed, salt + shot + shotNo * 3 + 1, 100) < enemyEvasion(next)) {
        events.push({ t: at, type: 'shot', from: 'player', weapon: weapon.id, room: target, outcome: 'miss' });
        continue;
      }
      if (def.kind === 'ion') {
        damageRoom(next.enemy.rooms, target, def.roomDamage);
        if (target === 'shields') next.enemy.shields.ionMs = def.ionMs;
        events.push({ t: at, type: 'shot', from: 'player', weapon: weapon.id, room: target, outcome: 'hit', damage: 0, ion: true });
        continue;
      }
      const amount = Math.min(def.damage, next.enemy.hull);
      next.enemy.hull -= amount;
      damageRoom(next.enemy.rooms, target, def.roomDamage ?? RULES.roomHitDamage + 2 * def.damage);
      events.push({ t: at, type: 'shot', from: 'player', weapon: weapon.id, room: target, outcome: 'hit', damage: amount });
      maybeFire(next, next.enemy.rooms, target, salt + 50 + shotNo, events, at, 'enemy', def.fireChance);
      if (next.enemy.hull <= 0) {
        next.enemy.hull = 0;
        finish(next, 'win', events, at);
        return;
      }
    }
  }

  // Enemy weapons.
  const enemyRate = integrityFactor(next.enemy.rooms.weapons.integrity) * (next.enemy.rooms.helm.integrity <= 0 ? 0.75 : 1);
  next.enemy.weapons.forEach((weapon, index) => {
    if (next.result !== null || next.phase !== 'combat') return;
    weapon.progressMs = Math.min(weapon.chargeMs, weapon.progressMs + Math.round(TICK_MS * enemyRate));
    if (weapon.progressMs < weapon.chargeMs) return;
    weapon.progressMs = 0;
    for (let shot = 0; shot < weapon.shots; shot += 1) {
      const at = t + 120 + shot * 70;
      if (next.shields.layers > 0) {
        next.shields.layers -= 1;
        events.push({ t: at, type: 'shot', from: 'enemy', weapon: weapon.id, room: weapon.target, outcome: 'shield' });
        continue;
      }
      if (seededIndex(next.seed, salt + 30 + index * 5 + shot, 100) < playerEvasion(next)) {
        events.push({ t: at, type: 'shot', from: 'enemy', weapon: weapon.id, room: weapon.target, outcome: 'miss' });
        continue;
      }
      next.hull = Math.max(1, next.hull - weapon.damage);
      damageRoom(next.rooms, weapon.target, RULES.roomHitDamage + 2 * weapon.damage);
      events.push({ t: at, type: 'shot', from: 'enemy', weapon: weapon.id, room: weapon.target, outcome: 'hit', damage: weapon.damage });
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
  for (const member of next.crew) {
    if (!member.room) continue;
    const r = next.rooms[member.room];
    const skill = (member.role === 'engineer' ? 1.5 : 1) * engineeringBoost;
    if (r.fire > 0) {
      r.fire = Math.max(0, r.fire - RULES.crewExtinguishPerSec * sec);
      if (r.fire === 0) { r.fireMs = 0; events.push({ t, type: 'fire_out', side: 'player', room: member.room }); }
    } else if (next.boarders?.phase === 'aboard' && next.boarders.room === member.room) {
      next.boarders.hp = Math.max(0, next.boarders.hp - (['security', 'gunner'].includes(member.role) ? 9 : 6) * sec);
      if (next.boarders.hp === 0) {
        next.boarders.phase = 'repelled';
        events.push({ t, type: 'boarders_repelled', room: member.room });
      }
    } else if (r.integrity < 100) {
      r.integrity = Math.min(100, r.integrity + RULES.crewRepairPerSec * skill * sec);
    }
  }
  if (next.boarders?.phase === 'aboard') damageRoom(next.rooms, next.boarders.room, RULES.boarderSabotagePerSec * sec);

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
  if (!validShields(e.shields, 3, RULES.shieldRechargeMs * 2) || e.shields.max !== stats.shieldLayers || !validRooms(e.rooms, PLAYER_ROOMS)) return false;
  if (!Array.isArray(e.weapons) || e.weapons.length < 1 || e.weapons.length > stats.weaponSlots
    || !e.weapons.every(w => rec(w) && WEAPON_CATALOG[w.id] && int(w.chargeMs, 0, WEAPON_CATALOG[w.id].chargeMs))) return false;
  const missiles = e.weapons.filter(w => WEAPON_CATALOG[w.id].kind === 'missile').length;
  if (missiles ? !(rec(e.ammo) && int(e.ammo.missile, 0, missiles * WEAPON_CATALOG.missile.ammo)) : Object.hasOwn(e, 'ammo')) return false;
  if (!Array.isArray(e.crew) || e.crew.length > 24 || new Set(e.crew.map(c => c?.id)).size !== e.crew.length
    || !e.crew.every(c => rec(c) && typeof c.id === 'string' && c.id && typeof c.role === 'string'
      && (c.station === null || PLAYER_ROOMS.includes(c.station)) && (c.room === null || PLAYER_ROOMS.includes(c.room))
      && int(c.manualUntil, 0, e.beat + RULES.autoReturnBeats))) return false;
  const i = e.intent;
  if (!rec(i) || !(i.target === null || ENEMY_ROOMS.includes(i.target)) || typeof i.hold !== 'boolean' || !rec(i.moves)
    || !Object.entries(i.moves).every(([id, roomId]) => e.crew.some(c => c.id === id) && PLAYER_ROOMS.includes(roomId))) return false;
  const en = e.enemy;
  if (!rec(en) || !num(en.threat, 0.6, 1.6)) return false;
  if (Object.hasOwn(en, 'flagship') && ![1, 2].includes(en.flagship)) return false;
  if (Object.hasOwn(en, 'tier') && ![1, 2].includes(en.tier)) return false;
  const load = enemyLoadout(en.threat, { flagship: en.flagship || 0, tier: en.tier || 0 });
  const startHull = Object.hasOwn(en, 'startHull') ? en.startHull : 42;
  if (!int(startHull, 1, 42) || !int(en.hull, 0, startHull) || en.evasion !== load.evasion || en.repairPerSec !== load.repairPerSec
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
  const shielded = state.enemy.shields.max > 0 && state.enemy.rooms.shields.integrity > 0;
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
  return Math.round(BEAT_MS * integrityFactor(state.enemy.rooms.weapons.integrity) * (state.enemy.rooms.helm.integrity <= 0 ? 0.75 : 1));
}
