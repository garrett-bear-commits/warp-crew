// Saved bridge between a contract and the deterministic crew-run fight.
import { trustedNow } from '../shared/time.js';
import { startEncounter, advanceEncounter, enemyVolleyDamage, TACTICS, BURN, BOARDERS, BOARDING_ENEMIES } from './autoCombat.js';
import { normalizeAssignments, stationOutputs } from './stations.js';
import { resolveSimulatedCombatPayout, readyContractCrew } from './contractRewards.js';
import { crewPower, encounterById } from './combat.js';
import { NODES } from '../data/sectors.js';
import { combatBonuses } from './passives.js';
import { wallEncounterSetup } from './walls.js';
import { RALLY } from './gemSinks.js';
import { isCanonicalGuidedContract } from './contractState.js';
import { startFtlEncounter, advanceFtlEncounter, applyFtlCommand, validFtlBody, FTL_VERSION, OVERCHARGE } from './ftlCombat.js';
import { shipLoadout } from './armory.js';
import { loyalEdge } from './loyalty.js';
import { factionOf } from '../data/factions.js';
import { cleanTwist } from '../data/twists.js';

const STATIONS = ['helm', 'shields', 'weapons', 'engineering'];
const numberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const targets = ['hull', 'shields', 'weapons', 'engineering'];

function validOrders(encounter) {
  const { orders, cooldowns } = encounter;
  return record(orders) && record(orders.brace) && record(orders.repair)
    && typeof orders.brace.used === 'boolean'
    && Number.isInteger(orders.brace.uses) && numberIn(orders.brace.uses, 0, encounter.beat)
    && Number.isInteger(orders.repair.uses) && numberIn(orders.repair.uses, 0, encounter.beat)
    && orders.brace.used === (orders.brace.uses > 0)
    && (encounter.version === 1 ? !Object.hasOwn(orders, 'targetWeapons') : (record(orders.targetWeapons)
      && typeof orders.targetWeapons.used === 'boolean'
      && Number.isInteger(orders.targetWeapons.uses) && numberIn(orders.targetWeapons.uses, 0, 1)
      && orders.targetWeapons.uses <= encounter.beat
      && orders.targetWeapons.used === (orders.targetWeapons.uses === 1)))
    && Number.isInteger(encounter.braceThroughBeat) && numberIn(encounter.braceThroughBeat, 0, encounter.beat + 2)
    && record(cooldowns) && Object.keys(cooldowns).every(name => ['brace', 'repair'].includes(name))
    && ['brace', 'repair'].every(name => Number.isInteger(cooldowns[name]) && numberIn(cooldowns[name], 0, 4));
}

function validTactics(encounter) {
  if (!Object.hasOwn(encounter, 'tactics')) return true;
  const tactics = encounter.tactics;
  if (encounter.kind !== 'normal' || !record(tactics) || !Object.keys(tactics).every(name => TACTICS.includes(name))) return false;
  const burn = tactics.burn;
  const board = tactics.board;
  return (!burn || (record(burn) && [0, 1].includes(burn.uses) && Number.isInteger(burn.throughBeat)
      && (burn.uses === 0 ? burn.throughBeat === 0 : numberIn(burn.throughBeat, BURN.beats - 1, encounter.beat + BURN.beats - 1))))
    && (!board || (record(board) && [0, 1].includes(board.uses)
      && (board.uses === 0 ? board.success === null : typeof board.success === 'boolean')
      && (!board.success || (encounter.result === 'win' && encounter.enemy.hull === 0))));
}

function validBoarders(encounter) {
  if (!Object.hasOwn(encounter, 'boarders')) return true;
  const b = encounter.boarders;
  if (encounter.kind !== 'normal' || !BOARDING_ENEMIES.includes(encounter.encounterId) || !record(b)) return false;
  if (!['none', 'incoming', 'aboard', 'repelled'].includes(b.phase)) return false;
  if (b.phase === 'none') return b.target === null && b.strength === 0 && b.defenderId === null && encounter.beat < BOARDERS.warnBeat + 1;
  return ['weapons', 'shields', 'engineering', 'helm'].includes(b.target)
    && Number.isInteger(b.strength) && numberIn(b.strength, 0, BOARDERS.strength)
    && Number.isInteger(b.landsBeat) && b.landsBeat === BOARDERS.warnBeat + 1
    && (b.phase !== 'repelled' || (b.strength === 0 && typeof b.defenderId === 'string'
      && Number.isInteger(b.repelledBeat) && numberIn(b.repelledBeat, BOARDERS.warnBeat + 1, encounter.beat)))
    && (b.defenderId === null || (typeof b.defenderId === 'string' && typeof b.defenderRole === 'string'))
    && (b.defenderStation === null || ['helm', 'shields', 'weapons', 'engineering'].includes(b.defenderStation));
}

function validOrderWindow(window, encounter) {
  if (window == null) return true;
  const names = encounter.kind === 'guided' ? ['brace'] : ['brace', 'repair'];
  if (encounter.version === 2 && encounter.encounterId === 'pirate_scout') names.push('target_weapons');
  return Boolean(
    record(window) && targets.includes(window.target)
    && (encounter.version !== 2 || encounter.enemy.pattern === 'charging_volley')
    && Number.isInteger(window.beatsToImpact) && numberIn(window.beatsToImpact, 1, 3)
    && Array.isArray(window.availableOrders)
    && window.availableOrders.every(name => names.includes(name))
    && new Set(window.availableOrders).size === window.availableOrders.length
    && record(window.orderOptions)
    && Object.keys(window.orderOptions).length === names.length
    && names.every(name => {
      const option = window.orderOptions?.[name];
      return record(option) && record(option.cost)
        && option.cost.shield === (name === 'brace' ? 2 : name === 'target_weapons' ? 0 : 3)
        && typeof option.available === 'boolean'
        && (option.available ? option.reason === null : ['insufficient_resource', 'cooldown', 'used', 'hull_full'].includes(option.reason))
        && Number.isInteger(option.cooldownBeats) && numberIn(option.cooldownBeats, 0, 4)
        && window.availableOrders.includes(name) === option.available;
    })
  );
}

function eligibleContract(player, contract) {
  return contract?.stage === 'confrontation' && (
    (contract.profile === 'distress' && [4, 5].includes(player.tutorial?.script) && contract.encounterId === 'pirate_scout')
    || (contract.profile !== 'distress' && ['secure', 'push'].includes(contract.choiceId) && Boolean(contract.encounterId))
  );
}

const THREAT_RANGE = [0.6, 1.6];

/** New captains meet Burn after three finished contracts and Board after five. */
export const TACTIC_UNLOCKS = Object.freeze({ burn: 3, board: 5 });
export const BOARDERS_UNLOCK = 8;

export function boardersUnlocked(player) {
  const guidedFlow = [4, 5].includes(player?.tutorial?.script) && player.tutorial.completed;
  return !guidedFlow || (player?.stats?.contractsCompleted || 0) >= BOARDERS_UNLOCK;
}

/** Security first, then gunners, then the strongest non-captain; the captain only as a last resort. */
export function pickDefender(player, now = trustedNow()) {
  const ready = readyContractCrew(player, now);
  const rank = member => (member.role === 'security' ? 300 : member.role === 'gunner' ? 200 : 100)
    + (member.instanceId === player.captainInstanceId ? -150 : 0) + (member.power || 10);
  const best = [...ready].sort((a, b) => rank(b) - rank(a))[0];
  if (!best) return null;
  return { id: best.instanceId, name: best.name, role: best.role, station: normalizeAssignments(player)[best.instanceId] || null };
}

export function unlockedTactics(player) {
  const guidedFlow = [4, 5].includes(player?.tutorial?.script) && player.tutorial.completed;
  const done = player?.stats?.contractsCompleted || 0;
  return TACTICS.filter(name => !guidedFlow || done >= TACTIC_UNLOCKS[name]);
}

export function threatLabel(threat) {
  if (threat == null) return null;
  return threat >= 1.3 ? 'Deadly' : threat >= 1.05 ? 'Dangerous' : threat >= 0.9 ? 'Even' : 'Favorable';
}

/** The crew side of the power model: ready fighting crew plus crit and hull bonuses. */
export function fightPower(player, encounterId, now = trustedNow(), { excludeIds = [] } = {}) {
  const crew = readyContractCrew(player, now).filter(member => !excludeIds.includes(member.instanceId));
  return Math.max(1, crewPower(crew) + combatBonuses(player, encounterById(encounterId)).extraPower);
}

/**
 * Days the captain has played: local days with a finished board contract, plus today. Contract offer ids
 * carry their board day (`offer_YYYY-MM-DD_profile`); the tutorial job and Siege-wall attempts carry none,
 * so a day of failed wall attempts never counts twice and a captain who stays away is not punished.
 */
export function daysPlayed(player) {
  const days = new Set();
  for (const id of player?.contractBoard?.completedOfferIds || []) {
    const match = /^offer_(\d{4}-\d{2}-\d{2})_/.exec(String(id));
    if (match) days.add(match[1]);
  }
  return days.size + 1;
}

/**
 * Reference crew power by day played: the power model's crew side (fightPower: ready fighting crew plus crit
 * and hull bonuses) of a typical free captain. Points are the median first fight of each day across the
 * guided 30-day simulator's captains, who take the free daily hire and level their crew (balance pass
 * 2026-10-09, docs/qa/2026-10-09-balance-pass.md). Linear between points; held after day 30 (not simulated).
 */
export const REFERENCE_CURVE = Object.freeze([[1, 38], [4, 72], [7, 95], [15, 130], [30, 220]]);
export function referencePower(player) {
  const day = daysPlayed(player);
  const last = REFERENCE_CURVE[REFERENCE_CURVE.length - 1];
  if (day >= last[0]) return last[1];
  const upper = REFERENCE_CURVE.findIndex(([d]) => d >= day);
  if (upper <= 0) return REFERENCE_CURVE[0][1];
  const [d0, p0] = REFERENCE_CURVE[upper - 1];
  const [d1, p1] = REFERENCE_CURVE[upper];
  return Math.round(p0 + (p1 - p0) * (day - d0) / (d1 - d0));
}

/**
 * Each sector's base threat: what a fight there is worth against a crew that has outgrown its enemy.
 * Later sectors fight back harder (Spur fodder stays Favorable, the Hollow and the Crown stay Even).
 */
export const SECTOR_THREAT_BASE = Object.freeze({ spur: 0.8, veil: 0.84, ember: 0.88, hollow: 0.92, crown: 0.96 });

/**
 * Fight threat (the FTL-lite enemy loadout, its label and the Siege-wall floor) from the encounter, the sector
 * and the reference crew power for this point in the game, never from your actual crew. An enemy listed
 * stronger than the reference crew fights at power over reference; a weaker one at the sector's base plus
 * its share of the rest. A stronger crew than the reference therefore wins more instead of being matched:
 * the old 82% pull-up toward the crew's own power (rubberBandPower) now serves only the legacy order-based
 * fights. With nobody aboard who can fight, the fight is Deadly.
 */
export function contractThreat(player, contract, now = trustedNow(), { excludeIds = [] } = {}) {
  if (!readyContractCrew(player, now).some(member => !excludeIds.includes(member.instanceId))) return THREAT_RANGE[1];
  const ratio = encounterById(contract.encounterId).power / referencePower(player);
  const base = SECTOR_THREAT_BASE[NODES[contract.destinationId ?? contract.nodeId]?.sector] ?? SECTOR_THREAT_BASE.spur;
  const threat = ratio >= 1 ? ratio : base + (1 - base) * ratio;
  return Math.max(THREAT_RANGE[0], Math.min(THREAT_RANGE[1], Math.round(threat * 100) / 100));
}

/** Each role's one passive (crewRoster passive field) that the fight reads as `bonus`. */
export const ROLE_PASSIVE = Object.freeze({ gunner: 'critChance', engineer: 'repairBonus', medic: 'assistCharge',
  trader: 'tradeCredits', scout: 'expeditionSuccess', security: 'pirateResist', pilot: 'fuelCostReduce' });

/** Fight grade 0-1 from effective power: a level-1 Common is about 0.04, a Legendary 0.45, the Apex 0.9. */
export const crewGrade = power => Math.round(Math.max(0, Math.min(1, ((Number(power) || 0) - 8) / 50)) * 100) / 100;

/**
 * The crew who fight, at their stations (null station = free crew who go where needed).
 * With `kits`, each carries their signature move, fight grade and role passive (crew-matter design).
 */
export function fightingCrew(player, now = trustedNow(), { kits = false } = {}) {
  const assignments = normalizeAssignments(player);
  return readyContractCrew(player, now).map(member => ({
    id: member.instanceId, role: member.role || '', station: assignments[member.instanceId] || null,
    // A Loyal merc (Phase 3 §5) fights a little sharper and their role passive counts a quarter more.
    ...(kits && typeof member.templateId === 'string' ? {
      kit: member.templateId,
      grade: Math.min(1, Math.round((crewGrade(member.power) + loyalEdge(player, member.templateId).grade) * 100) / 100),
      tier: Math.max(0, Math.min(3, Math.trunc(member.ascension || 0))),
      bonus: Math.max(0, Math.min(2, (Number(member.passive?.[ROLE_PASSIVE[member.role]]) || 0) * loyalEdge(player, member.templateId).passive)),
    } : {}),
  }));
}

/**
 * A kit fighter must be the crew member they claim to be: same merc and role, and an Ascension tier
 * they have reached (audit 2026-10-09 #2). Grade is not compared with today's power: power is
 * recomputed on load, and a fight must never be thrown away because a formula moved (grade stays
 * bounded 0-1 by the fight validator). A fighter who has since left the roster cannot be checked
 * and is let through; fights lock the crew tabs anyway.
 */
export function kitCrewMatchesRoster(player, encounter) {
  if (encounter?.version !== FTL_VERSION || !Array.isArray(encounter.crew)) return true;
  const roster = [...(player?.crew || []), ...(player?.reserve || [])];
  return encounter.crew.every(member => {
    if (typeof member.kit !== 'string') return true;
    const own = roster.find(c => c.instanceId === member.id);
    if (!own) return true;
    return own.templateId === member.kit && own.role === member.role && (member.tier || 0) <= (own.ascension || 0);
  });
}

/** Abilities cast themselves unless the captain switched Auto off. */
export const autoAbilities = player => player?.flags?.manualAbilities !== true;

/** Every new normal fight (contract, wall, Explore jump) is an FTL-lite v3 fight. */
/** Enemy ship class from its catalog power: later-sector ships fight harder (see enemyLoadout). */
export function enemyTierFor(encounterId) {
  const power = encounterById(encounterId)?.power || 0;
  return power >= 52 ? 2 : power >= 38 ? 1 : 0;
}

/**
 * Start a v3 crew fight for a contract, a wall attempt or an Explore jump. The enemy's faction comes from the
 * encounter (factions.js); a contract's twist arrives as `twist` (contractFightArgs reads it off the contract).
 * The guided first fight has neither, and walls never take a twist.
 */
export function startCrewFight(player, args, now = trustedNow()) {
  return startFtlEncounter(crewFightSetup(player, args, now));
}

/** What startCrewFight hands startFtlEncounter (the faction evidence replays fights from it). */
export function crewFightSetup(player, { acceptanceId, encounterId, seed, threat, enemyHull = null, remainingBefore = null, guided = false, flagship = 0, twist = null }, now = trustedNow()) {
  const systems = player.ship?.systems || {};
  const wallFight = Number.isInteger(enemyHull);
  return {
    faction: guided ? null : factionOf(encounterId)?.id || null,
    twist: guided || wallFight ? null : cleanTwist(twist),
    // The ship as fitted at the drydock: levels shape shields, charge, evasion and aim; the loadout is its guns.
    shipLevels: guided ? null : { shields: systems.shields || 1, weapons: systems.weapons || 1, engines: systems.engines || 1, sensors: Math.min(20, (systems.sensors || 0) + 1) },
    loadout: guided ? undefined : shipLoadout(player),
    flagship: guided ? 0 : flagship,
    enemyTier: guided ? 0 : enemyTierFor(encounterId),
    acceptanceId,
    encounterId,
    seed,
    threat,
    // The guided first fight teaches targeting only; every later fight brings the crew's kits.
    crew: fightingCrew(player, now, { kits: !guided }),
    auto: !guided && autoAbilities(player),
    hull: Math.max(1, Math.min(100, Math.round(player.ship?.hull ?? 100))),
    enemyHull,
    remainingBefore,
    tactics: guided ? [] : unlockedTactics(player),
    boarders: !guided && boardersUnlocked(player) && BOARDING_ENEMIES.includes(String(encounterId)),
    guided,
  };
}

/** The script-5 tutorial's first fight is an easy FTL-lite fight that teaches targeting. */
export const GUIDED_FIGHT = Object.freeze({ threat: 0.6, enemyHull: 25 });
const ftlGuided = (player, contract) => contract?.profile === 'distress' && player?.tutorial?.script === 5;
/** Did the captain do what the guided fight teaches? (v2: the Target Weapons order; v3: target their Weapons room.) */
export function guidedTargetDone(encounter) {
  return encounter?.version === FTL_VERSION ? encounter.guided === true && encounter.intent?.target === 'weapons'
    : encounter?.orders?.targetWeapons?.used === true;
}

export function fightCrewLaunched(encounter, participantIds) {
  return Array.isArray(participantIds) && encounter.crew.every(member => participantIds.includes(member.id));
}

/**
 * Hull a settled fight took off the ship (v3 fights use the ship's own hull). A crew that patched the hull
 * above where it started lost none: the payout records 0, so this must too, or the settled fight would fail
 * validation and its prize could never be claimed (balance pass 2026-10-09).
 */
export const fightHullLoss = encounter => Math.max(0, encounter.version === FTL_VERSION ? encounter.startHull - encounter.hull : 30 - encounter.hull);

/**
 * The FTL-lite fight a normal contract opens: its threat and, for a Siege wall, the segment and the flagship
 * tier. Contract launches and the contract cards' win odds (fightOdds.js) both start fights from this.
 */
export function contractFightArgs(player, contract, now = trustedNow()) {
  const threat = contractThreat(player, contract, now);
  const wall = contract.wall ? wallEncounterSetup(player, contract, threat, now) : null;
  return {
    encounterId: contract.encounterId,
    threat: wall ? wall.threat : threat,
    enemyHull: wall ? wall.enemyHull : null,
    remainingBefore: wall ? wall.remainingBefore : null,
    // The first wall's flagship fights as tuned; later walls' flagships carry an extra shield layer.
    flagship: wall ? (contract.wall.id === 'spur' ? 0 : 2) : 0,
    // The contract's twist rides into the fight (never on a wall or the guided first fight).
    twist: wall || contract.profile === 'distress' ? null : cleanTwist(contract.twist),
  };
}

/** Called only by the action that freshly enters confrontation. */
export function beginContractEncounter(player, now = trustedNow()) {
  const contract = player?.activeContract;
  if (player?.activeEncounter || !eligibleContract(player, contract)) return player;
  const kind = contract.profile === 'distress' ? 'guided' : 'normal';
  const normal = kind === 'normal' ? contractFightArgs(player, contract, now) : null;
  const encounter = ftlGuided(player, contract) ? startCrewFight(player, {
    acceptanceId: contract.acceptanceId,
    encounterId: contract.encounterId,
    seed: contract.routeSeed,
    threat: GUIDED_FIGHT.threat,
    enemyHull: GUIDED_FIGHT.enemyHull,
    guided: true,
  }, now) : normal ? startCrewFight(player, {
    acceptanceId: contract.acceptanceId,
    seed: contract.routeSeed,
    ...normal,
  }, now) : startEncounter({
    acceptanceId: contract.acceptanceId,
    encounterId: contract.encounterId,
    kind,
    ruleset: contract.profile === 'distress' && player.tutorial?.script === 4
      ? 'v1' : contract.encounterId === 'pirate_scout' ? 'v2' : 'v1',
    seed: contract.routeSeed,
    assignments: normalizeAssignments(player),
    outputs: stationOutputs(player, now),
    // Only the script-4 guided distress fight still starts a v1/v2 beat fight.
    threat: null,
    enemyHull: null,
    remainingBefore: null,
    tactics: [],
    boarders: false,
  });
  return {
    ...player,
    activeContract: {
      ...contract,
      encounterMode: 'crew',
      participantIds: (player.crew || []).filter(member => member.status === 'ready' && (member.injuredUntil || 0) <= now).map(member => member.instanceId),
    },
    activeEncounter: encounter,
  };
}

/** Shape and rule checks for any saved crew-fight snapshot, independent of what it is bound to. */
export function validEncounterBody(encounter) {
  if (encounter?.version === FTL_VERSION) return validFtlBody(encounter);
  if (!encounter || ![1, 2].includes(encounter.version) || !['guided', 'normal'].includes(encounter.kind)
    || !Number.isInteger(encounter.seed)
    || !Number.isInteger(encounter.beat) || encounter.beat < 0
    || !Number.isInteger(encounter.revision) || encounter.revision !== encounter.beat
    || !Number.isInteger(encounter.eventIndex) || encounter.eventIndex < encounter.beat
    || !(encounter.result === null ? ['combat', 'downed'].includes(encounter.phase) : encounter.phase === 'complete')
    || (encounter.phase === 'downed' && (encounter.hull !== 1 || encounter.kind !== 'normal'))
    || (Object.hasOwn(encounter, 'rally') && (encounter.kind !== 'normal' || !record(encounter.rally) || encounter.rally.used !== true))
    || !numberIn(encounter.hull, 1, 30) || !numberIn(encounter.shield, 0, 12)
    || !record(encounter.enemy) || !numberIn(encounter.enemy.hull, 0, 42)
    // A live fight always has an enemy standing: zero hull resolves as a win on the same beat.
    || (encounter.result === null && encounter.enemy.hull === 0)
    || (Object.hasOwn(encounter.enemy, 'damage') && (encounter.kind !== 'normal' || !Number.isInteger(encounter.enemy.damage)
      || !numberIn(encounter.enemy.damage, 12, 45) || !numberIn(encounter.enemy.threat, THREAT_RANGE[0], THREAT_RANGE[1])
      || encounter.enemy.damage !== enemyVolleyDamage(encounter.enemy.threat)))
    || (encounter.version === 1 && Object.hasOwn(encounter.enemy, 'weaponDisabledThroughBeat'))
    || (encounter.version === 2 && (encounter.encounterId !== 'pirate_scout'
      || !Number.isInteger(encounter.enemy.weaponDisabledThroughBeat)
      || !numberIn(encounter.enemy.weaponDisabledThroughBeat, 0, encounter.beat + 2)
      || (encounter.enemy.weaponDisabledThroughBeat > 0 && (encounter.enemy.weaponDisabledThroughBeat < encounter.beat
        || encounter.orders?.targetWeapons?.used !== true))))
    || !targets.includes(encounter.enemy.target)
    || !['charging_volley', 'reloading', 'broken_contact'].includes(encounter.enemy.pattern)
    || !STATIONS.every(station => numberIn(encounter.outputs?.[station], 0, 10000)
      && numberIn(encounter.systems?.[station], 0, 100))
    || !validTactics(encounter)
    || !validBoarders(encounter)
    || !record(encounter.assignments)
    || !validOrders(encounter)
    || !validOrderWindow(encounter.orderWindow, encounter)
    || (encounter.result !== null && !['win', 'loss'].includes(encounter.result))) return false;
  if (encounter.result === 'win' && (encounter.beat === 0 || encounter.enemy.hull !== 0 || encounter.orderWindow !== null)) return false;
  if (encounter.result === 'loss' && (encounter.beat === 0 || encounter.hull !== 1 || encounter.enemy.hull <= 0 || encounter.orderWindow !== null)) return false;
  return true;
}

/**
 * A fight's twist is the contract's twist, exactly (id and elite), and only a contract fight off the wall
 * carries one. A fight with a twist is new, so it must also carry its encounter's faction.
 */
export function fightTwistMatches(encounter, contract) {
  const twist = encounter?.twist;
  const expected = contract?.wall || contract?.profile === 'distress' ? null : cleanTwist(contract?.twist);
  if (!twist) return encounter?.version !== FTL_VERSION || !expected;
  if (!expected || twist.id !== expected.id || JSON.stringify(twist.elite ?? null) !== JSON.stringify(expected.elite ?? null)) return false;
  return !factionOf(encounter.encounterId) || Object.hasOwn(encounter, 'faction');
}

function validSnapshot(encounter, contract, tutorial, player = null) {
  if (player && !kitCrewMatchesRoster(player, encounter)) return false;
  // New-mode entry paths are distress Launch (one route action) and any
  // route choice into a confrontation (Launch plus choice). Every later contract revision is a beat.
  const entryRevision = contract.profile === 'distress' ? 1
    : ['secure', 'push'].includes(contract.choiceId) ? 2 : null;
  if (!encounter || contract.encounterMode !== 'crew' || encounter.acceptanceId !== contract.acceptanceId
    || (tutorial?.script === 5 && !tutorial.completed && ['fight', 'claim'].includes(tutorial.phase)
      && !isCanonicalGuidedContract(contract))
    || entryRevision === null
    || (contract.profile === 'distress'
      && (tutorial?.script === 4 ? encounter.version !== 1
        // Script 5: new saves are a guided v3 fight; saves from before keep their v2 fight.
        : tutorial?.script === 5 ? !(encounter.version === 2 || (encounter.version === FTL_VERSION && encounter.guided === true)) : true))
    || encounter.encounterId !== contract.encounterId
    || (contract.profile === 'distress' ? !(encounter.kind === 'guided' || encounter.guided === true) : encounter.kind !== 'normal' || encounter.guided === true)
    || encounter.seed !== contract.routeSeed
    || contract.revision !== entryRevision + encounter.beat
    || !validEncounterBody(encounter)
    // v3 fights carry their crew: only crew who launched with the contract can be in it.
    || (encounter.version === FTL_VERSION && !fightCrewLaunched(encounter, contract.participantIds))
    || !fightTwistMatches(encounter, contract)) return false;
  if (contract.stage === 'return') {
    const settled = (encounter.result === 'win' && contract.result?.success === true)
      || (encounter.result === 'loss' && contract.profile !== 'distress' && contract.result?.success === false);
    return settled && contract.result.hullLoss === fightHullLoss(encounter);
  }
  return contract.stage === 'confrontation' && encounter.result !== 'win';
}

/** Invalid new fights cannot become legacy fights or produce a claim. */
export function normalizeEncounterState(player) {
  const contract = player?.activeContract;
  const encounter = player?.activeEncounter;
  // A travel fight owns the encounter when no contract is active; travelFight.js validates that binding.
  if (!contract && player?.activeTravelFight) return player;
  if (!contract) return encounter ? { ...player, activeEncounter: null } : player;
  if (!encounter && contract.encounterMode !== 'crew') return player;
  if (validSnapshot(encounter, contract, player.tutorial, player)) return player;
  const tutorial = player.tutorial;
  const recoveringGuidedDistress = ((contract.profile === 'distress' && tutorial?.script === 4)
    || tutorial?.script === 5) && tutorial.phase === 'fight' && !tutorial.completed;
  const recoveringGuidedClaim = tutorial?.script === 5 && tutorial.phase === 'claim'
    && !tutorial.completed && !(player.contractBoard?.completedOfferIds || []).includes('offer_tutorial_distress')
    && !player.flags?.sparrowFirstRepair;
  const paidFuel = Math.min(1, Number.isFinite(contract.fuelSpent) ? Math.max(0, contract.fuelSpent) : 0);
  return {
    ...player,
    activeContract: null,
    activeEncounter: null,
    ...(recoveringGuidedDistress || recoveringGuidedClaim ? {
      tutorial: {
        ...tutorial,
        ...(recoveringGuidedClaim ? { phase: 'fight', firstWin: false, firstClaim: false } : {}),
        // Carry paid launch fuel into the next acceptance without refunding it.
        contractRecoveryFuelSpent: Math.max(tutorial.contractRecoveryFuelSpent || 0, paidFuel),
      },
    } : {}),
    recoveryEvents: [...(player.recoveryEvents || []), { event: 'contract_recovered', reason: 'invalid_encounter_state' }],
  };
}

/** One committed beat for any saved crew fight: order costs, current station outputs, deterministic advance. */
export function stepEncounter(player, encounter, order = null, now = trustedNow()) {
  if (encounter.result) return { ok: false, reason: 'encounter_finished' };
  if (order === 'burn' && (player.wallet?.fuel ?? 0) < BURN.fuel) return { ok: false, reason: 'not_enough_fuel' };
  const rallyCost = order === 'rally' ? (player.flags?.rallyFreeUsed ? RALLY.gems : 0) : 0;
  if ((player.wallet?.gems ?? 0) < rallyCost) return { ok: false, reason: 'not_enough_gems' };

  if (encounter.version === FTL_VERSION) {
    if (order === 'burn' && (player.wallet?.fuel ?? 0) < OVERCHARGE.fuel) return { ok: false, reason: 'not_enough_fuel' };
    const advanced = advanceFtlEncounter(encounter, order);
    if (advanced.ok === false) return { ok: false, reason: advanced.reason };
    let nextPlayer = { ...player, activeEncounter: advanced.state };
    if (order === 'burn') nextPlayer = { ...nextPlayer, wallet: { ...nextPlayer.wallet, fuel: nextPlayer.wallet.fuel - OVERCHARGE.fuel } };
    if (order === 'rally') {
      nextPlayer = { ...nextPlayer, wallet: { ...nextPlayer.wallet, gems: nextPlayer.wallet.gems - rallyCost },
        flags: { ...(nextPlayer.flags || {}), rallyFreeUsed: true } };
    }
    return { ok: true, player: nextPlayer, state: advanced.state, events: advanced.events };
  }
  const outputs = stationOutputs(player, now);
  const input = {
    ...encounter,
    assignments: normalizeAssignments(player),
    outputs: Object.fromEntries(STATIONS.map(station => [station, outputs[station].total])),
  };
  const defender = order === 'repel' ? pickDefender(player, now) : null;
  const advanced = advanceEncounter(input, order, { defender });
  if (advanced.ok === false) return { ok: false, reason: advanced.reason };
  let nextPlayer = { ...player, activeEncounter: advanced.state };
  if (order === 'burn') nextPlayer = { ...nextPlayer, wallet: { ...nextPlayer.wallet, fuel: nextPlayer.wallet.fuel - BURN.fuel } };
  if (order === 'rally') {
    // The first Rally is free, to teach it; later ones cost gems.
    nextPlayer = { ...nextPlayer, wallet: { ...nextPlayer.wallet, gems: nextPlayer.wallet.gems - rallyCost },
      flags: { ...(nextPlayer.flags || {}), rallyFreeUsed: true } };
  }
  return { ok: true, player: nextPlayer, state: advanced.state, events: advanced.events };
}

export function applyEncounterAction(player, { acceptanceId, revision, order = null } = {}, now = trustedNow()) {
  const contract = player?.activeContract;
  const encounter = player?.activeEncounter;
  if (!contract || contract.encounterMode !== 'crew' || !encounter || !validSnapshot(encounter, contract, player.tutorial, player)) {
    return { ok: false, reason: 'invalid_encounter_state', player };
  }
  if (contract.acceptanceId !== acceptanceId || encounter.acceptanceId !== acceptanceId || encounter.revision !== Number(revision)) {
    return { ok: false, reason: 'stale_encounter_action', player };
  }
  const step = stepEncounter(player, encounter, order, now);
  if (!step.ok) return { ok: false, reason: step.reason, player };
  let nextContract = { ...contract, revision: contract.revision + 1 };
  let nextPlayer = { ...step.player, activeContract: nextContract };
  if (step.state.result === 'win' || (step.state.result === 'loss' && contract.profile !== 'distress')) {
    const payout = resolveSimulatedCombatPayout(nextPlayer, nextContract, step.state, now);
    nextPlayer = payout.player;
    nextContract = { ...nextContract, stage: 'return', result: payout.result };
    nextPlayer = { ...nextPlayer, activeContract: nextContract };
  }
  return { ok: true, player: nextPlayer, events: step.events,
    analytics: { event: 'encounter_beat', acceptanceId, beat: step.state.beat, order, result: step.state.result } };
}

/** Retarget, hold, or move crew in a contract fight. No time passes, so the revision does not change. */
export function applyEncounterCommand(player, { acceptanceId, revision, command } = {}) {
  const contract = player?.activeContract;
  const encounter = player?.activeEncounter;
  if (!contract || contract.encounterMode !== 'crew' || !encounter || !validSnapshot(encounter, contract, player.tutorial, player)) {
    return { ok: false, reason: 'invalid_encounter_state', player };
  }
  if (contract.acceptanceId !== acceptanceId || encounter.acceptanceId !== acceptanceId || encounter.revision !== Number(revision)) {
    return { ok: false, reason: 'stale_encounter_action', player };
  }
  const applied = applyFtlCommand(encounter, command || {});
  if (!applied.ok) return { ok: false, reason: applied.reason, player };
  return { ok: true, player: { ...player, activeEncounter: applied.state } };
}

export function recoverEncounter(player, { acceptanceId, revision } = {}) {
  const contract = player?.activeContract;
  const encounter = player?.activeEncounter;
  if (!contract || contract.encounterMode !== 'crew' || !encounter || !validSnapshot(encounter, contract, player.tutorial, player)) {
    return { ok: false, reason: 'invalid_encounter_state', player };
  }
  if (contract.acceptanceId !== acceptanceId || encounter.acceptanceId !== acceptanceId || encounter.revision !== Number(revision)) {
    return { ok: false, reason: 'stale_encounter_action', player };
  }
  if (encounter.result !== 'loss') return { ok: false, reason: 'encounter_not_lost', player };
  return {
    ok: true,
    player: {
      ...player,
      activeContract: null,
      activeEncounter: null,
      ship: { ...player.ship, hull: encounter.version === FTL_VERSION ? Math.max(1, encounter.hull)
        : Math.max(1, Math.min(player.ship?.hull ?? 100, encounter.hull)) },
    },
    analytics: { event: 'encounter_recovered', acceptanceId, reason: encounter.lossReason },
  };
}
