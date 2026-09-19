// @ts-nocheck
import { createCrewInstance } from '../data/crewRoster.js';
import { starterShip } from '../data/ships.js';
import { DEFAULT_FUEL_CONFIG } from './fuel.js';
import { defaultTutorial, TUTORIAL_SCRIPT } from './tutorial.js';

export function createNewPlayer({ captainName = 'Captain' } = {}) {
  const now = Date.now();
  const crew = [
    createCrewInstance('merc_rex'),
    createCrewInstance('merc_bolt'),
  ];
  return {
    version: 5,
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
    loginStreak: 0,
    lastLoginDay: null,
    dailyPullAvailable: true,
    stats: { jumps: 0, combatsWon: 0, expeditions: 0 },
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
  let crew = Array.isArray(player.crew) ? [...player.crew] : base.crew;
  let crewSlots = player.crewSlots ?? base.crewSlots;
  const tutorial = freshIntro
    ? { ...defaultTutorial(), completed: true, phase: 'done', dismissed: true }
    : { ...defaultTutorial(), ...(player.tutorial || {}) };

  return {
    ...base,
    ...player,
    wallet: { ...base.wallet, ...(player.wallet || {}) },
    ship: player.ship || base.ship,
    crew,
    crewSlots: Math.max(crewSlots, crew.length, tutorial.completed ? 3 : 2),
    stats: { ...base.stats, ...(player.stats || {}) },
    story: { ...base.story, ...(player.story || {}) },
    flags: player.flags || {},
    tutorial,
    version: 5,
  };
}

export function assignedCrew(player) {
  return player.crew.filter((c) => c.status === 'ready' || c.status === 'injured');
}

export function readyCrew(player) {
  const now = Date.now();
  return player.crew.filter((c) => {
    if (c.status === 'expedition') return false;
    if (c.status === 'injured' && (c.injuredUntil || 0) > now) return false;
    return true;
  });
}
