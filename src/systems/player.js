// @ts-nocheck
import { createCrewInstance, recomputeCrew } from '../data/crewRoster.js';
import { starterShip } from '../data/ships.js';
import { DEFAULT_FUEL_CONFIG } from './fuel.js';
import { defaultTutorial, TUTORIAL_SCRIPT } from './tutorial.js';
import { defaultGacha } from './gacha.js';

const SAVE_VERSION = 6;

function ensureShip(ship) {
  const base = starterShip();
  const next = { ...base, ...(ship || {}) };
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

export function createNewPlayer({ captainName = 'Captain' } = {}) {
  const now = Date.now();
  const crew = [
    createCrewInstance('merc_rex'),
    createCrewInstance('merc_bolt'),
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
    reserve: [],
    activeExpedition: null,
    location: 'station_home',
    flags: {},
    gacha: defaultGacha(),
    loginStreak: 0,
    lastLoginDay: null,
    dailyPullAvailable: true,
    stats: { jumps: 0, combatsWon: 0, expeditions: 0, visits: {} },
    story: { chapter: 0, eclipseIntro: false },
    tutorial: defaultTutorial(),
  };
}

export function migratePlayer(player) {
  if (!player) return createNewPlayer();
  const captainName = player.captainName || 'Captain';
  const jumps = player.stats?.jumps || 0;
  const combats = player.stats?.combatsWon || 0;
  const script = player.tutorial?.script;
  const freshIntro =
    (player.version || 0) < 5 || script !== TUTORIAL_SCRIPT;

  // Zero-progress careers re-enter the v2 intro (2 mercs, gated nav).
  if (freshIntro && jumps === 0 && combats === 0) {
    return createNewPlayer({ captainName });
  }

  const base = createNewPlayer({ captainName });
  let crew = Array.isArray(player.crew) ? player.crew.map((c) => recomputeCrew(c)) : base.crew;
  let crewSlots = player.crewSlots ?? base.crewSlots;
  const tutorial = freshIntro
    ? { ...defaultTutorial(), completed: true, phase: 'done', dismissed: true }
    : { ...defaultTutorial(), ...(player.tutorial || {}) };

  const veteran = (player.version || 0) < SAVE_VERSION && (jumps > 0 || combats > 0);
  const flags = { ...(player.flags || {}) };
  if (veteran && flags.splashSeen == null) flags.splashSeen = true;

  return {
    ...base,
    ...player,
    wallet: { ...base.wallet, ...(player.wallet || {}) },
    ship: ensureShip(player.ship || base.ship),
    crew,
    gacha: { ...defaultGacha(), ...(player.gacha || {}) },
    crewSlots: Math.max(crewSlots, crew.length, tutorial.completed ? 3 : 2),
    stats: { ...base.stats, ...(player.stats || {}) },
    story: { ...base.story, ...(player.story || {}) },
    flags,
    tutorial,
    version: SAVE_VERSION,
  };
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
