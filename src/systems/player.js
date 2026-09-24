// @ts-nocheck
import { createCrewInstance, recomputeCrew } from '../data/crewRoster.js';
import { starterShip, getShipDef } from '../data/ships.js';
import { DEFAULT_FUEL_CONFIG } from './fuel.js';
import { migrateTutorialV3 } from './tutorial.js';
import { defaultTutorialV4, normalizeTutorialV4 } from './tutorialV4.js';
import { normalizeContractState } from './contractState.js';
import { NODES } from '../data/sectors.js';
import { encounterById } from './combat.js';
import { defaultGacha } from './gacha.js';
import { berthsFor, fuelMaxFor, fuelRateFor, parkOverflowToReserve } from './hangar.js';
import { clampFuel } from './economy.js';
import { normalizeAssignments } from './stations.js';
import { normalizeEncounterState } from './encounterState.js';

const SAVE_VERSION = 8;

function ensureShip(ship) {
  const base = starterShip();
  const next = { ...base, ...(ship || {}) };
  if (typeof next.name !== 'string' || !next.name.trim()) next.name = 'Sparrow';
  next.systems = {
    engines: 1,
    shields: 1,
    cargo: 1,
    weapons: 1,
    quarters: 0,
    sensors: 0,
    medbay: 0,
    ...(ship?.systems || {}),
  };
  if (!Array.isArray(next.ownedHulls) || !next.ownedHulls.length) {
    next.ownedHulls = [next.shipId || 'sparrow'];
  }
  if (next.hull == null) next.hull = 100;
  return next;
}

export function createNewPlayer({ captainName = 'Captain', now = Date.now(), rng = Math.random } = {}) {
  const crew = [
    createCrewInstance('merc_rex', { rng }),
    createCrewInstance('merc_bolt', { rng }),
  ];
  return {
    version: SAVE_VERSION,
    captainName,
    createdAt: now,
    wallet: {
      credits: 80,
      fuel: DEFAULT_FUEL_CONFIG.startingFuel,
      gems: 0,
      medals: 0,
      reputation: 0,
    },
    fuelMax: DEFAULT_FUEL_CONFIG.startingMax,
    fuelRatePerHour: DEFAULT_FUEL_CONFIG.ratePerHour,
    fuelClaimAt: now,
    ship: starterShip(),
    crewSlots: 2,
    crew,
    stationAssignments: { [crew[0].instanceId]: 'helm', [crew[1].instanceId]: null },
    reserve: [],
    iapFulfilled: [],
    activeExpedition: null,
    contractBoard: null,
    activeContract: null,
    activeEncounter: null,
    dailyLoop: { dayKey: null, contract: false, improve: false, away: false },
    location: 'station_home',
    flags: {},
    gacha: defaultGacha(),
    loginStreak: 0,
    lastLoginDay: null,
    dailyPullAvailable: true,
    stats: { jumps: 0, combatsWon: 0, expeditions: 0, visits: {}, planetRuns: {}, contractsCompleted: 0, contractsByProfile: { reliable: 0, risky: 0, strange: 0 } },
    story: { chapter: 0, eclipseIntro: false },
    tutorial: defaultTutorialV4(),
  };
}

export function migratePlayer(player) {
  if (!player) return createNewPlayer();
  const captainName = player.captainName || 'Captain';
  const jumps = player.stats?.jumps || 0;
  const combats = player.stats?.combatsWon || 0;
  const base = createNewPlayer({ captainName });
  let crew = Array.isArray(player.crew) ? player.crew.map((c) => recomputeCrew(c)) : base.crew;
  let reserve = Array.isArray(player.reserve) ? player.reserve.map((c) => recomputeCrew(c)) : [];
  let crewSlots = player.crewSlots ?? base.crewSlots;
  const tutorial = player.tutorial?.script === 4
    ? normalizeTutorialV4(player.tutorial)
    : migrateTutorialV3(player).tutorial;

  const veteran = (player.version || 0) < SAVE_VERSION && (jumps > 0 || combats > 0);
  const flags = { ...(player.flags || {}) };
  if (veteran && flags.splashSeen == null) flags.splashSeen = true;

  const ship = ensureShip(player.ship || base.ship);
  const story = { ...base.story, ...(player.story || {}) };
  // Interiors follow gate visits, not chapter skips or Spur keys.
  if (!flags.ember_opened) story.emberUnlocked = false;
  if (!flags.hollow_opened) story.hollowUnlocked = false;
  if (!flags.crown_opened) story.crownUnlocked = false;

  let next = {
    ...base,
    ...player,
    wallet: { ...base.wallet, ...(player.wallet || {}) },
    ship,
    crew,
    reserve,
    stationAssignments: normalizeAssignments({ crew, reserve, stationAssignments: player.stationAssignments }),
    gacha: { ...defaultGacha(), ...(player.gacha || {}), history: Array.isArray(player.gacha?.history) ? [...player.gacha.history] : [] },
    crewSlots,
    stats: { ...base.stats, ...(player.stats || {}), visits: { ...(base.stats.visits || {}), ...(player.stats?.visits || {}) }, planetRuns: { ...(base.stats.planetRuns || {}), ...(player.stats?.planetRuns || {}) }, contractsByProfile: { ...base.stats.contractsByProfile, ...(player.stats?.contractsByProfile || {}) } },
    dailyLoop: { ...base.dailyLoop, ...(player.dailyLoop || {}) },
    story,
    flags,
    tutorial,
    iapFulfilled: [...(player.iapFulfilled || [])],
    version: SAVE_VERSION,
  };

  const def = getShipDef(next.ship.shipId);
  next.crewSlots = berthsFor(next, def, { fillBase: false });
  if (tutorial.completed) {
    next.crewSlots = Math.min(def.maxCrewSlots, Math.max(next.crewSlots, 3));
  }
  const parked = parkOverflowToReserve(next, next.crewSlots);
  next = parked.player;
  next.fuelMax = fuelMaxFor(next, def);
  next.fuelRatePerHour = fuelRateFor(next, def);
  next.wallet = clampFuel(next.wallet, next.fuelMax);
  return normalizeEncounterState(normalizeContractState(next, { nodes: NODES, encounterById }));
}

export function assignedCrew(player) {
  return player.crew.filter((c) => c.status === 'ready' || c.status === 'injured');
}

export function readyCrew(player, now = Date.now()) {
  return player.crew.filter((c) => {
    if (c.status === 'expedition') return false;
    if (c.status === 'injured' && (c.injuredUntil || 0) > now) return false;
    return true;
  });
}

/** Combat / jump squad: top N ready mercs, N = berths. Overflow in reserve does not fight. */
export function fightingCrew(player, now = Date.now()) {
  const ready = readyCrew(player, now);
  const slots = Math.max(1, player.crewSlots || 2);
  return [...ready].sort((a, b) => (b.power || 0) - (a.power || 0)).slice(0, slots);
}

export function tickCrewStatus(player, now = Date.now()) {
  let changed = false;
  const crew = (player.crew || []).map((c) => {
    if (c.status === 'injured' && (c.injuredUntil || 0) <= now) {
      changed = true;
      return { ...c, status: 'ready', injuredUntil: 0 };
    }
    return c;
  });
  return changed ? { ...player, crew } : player;
}

export function applyCrewInjury(player, instanceIds = [], minutes = 20, now = Date.now()) {
  if (!instanceIds.length || minutes <= 0) return player;
  const until = now + Math.round(minutes) * 60000;
  const set = new Set(instanceIds);
  return {
    ...player,
    crew: player.crew.map((c) =>
      set.has(c.instanceId) && c.status !== 'expedition'
        ? { ...c, status: 'injured', injuredUntil: until }
        : c
    ),
  };
}

export function grantCrewXp(player, instanceIds = [], amount = 10) {
  if (!instanceIds.length || !amount) return player;
  const set = new Set(instanceIds);
  return {
    ...player,
    crew: player.crew.map((c) =>
      set.has(c.instanceId) ? recomputeCrew({ ...c, xp: (c.xp || 0) + amount }) : c
    ),
  };
}
