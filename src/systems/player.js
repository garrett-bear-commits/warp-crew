import { createCrewInstance } from '../data/crewRoster.js';
import { starterShip } from '../data/ships.js';
import { DEFAULT_FUEL_CONFIG } from './fuel.js';

export function createNewPlayer({ captainName = 'Captain' } = {}) {
  const now = Date.now();
  const crew = [
    createCrewInstance('merc_rex'),
    createCrewInstance('merc_bolt'),
  ];
  return {
    version: 2,
    captainName,
    createdAt: now,
    wallet: {
      credits: 250,
      fuel: DEFAULT_FUEL_CONFIG.startingFuel,
      gems: 25, // test gems so skip / IAP UX can be tried
      medals: 25,
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
  };
}

/** Fill missing fields on older saves */
export function migratePlayer(player) {
  if (!player) return createNewPlayer();
  const base = createNewPlayer({ captainName: player.captainName || 'Captain' });
  return {
    ...base,
    ...player,
    wallet: { ...base.wallet, ...(player.wallet || {}) },
    ship: player.ship || base.ship,
    crew: Array.isArray(player.crew) ? player.crew : base.crew,
    stats: { ...base.stats, ...(player.stats || {}) },
    story: { ...base.story, ...(player.story || {}) },
    flags: player.flags || {},
    version: Math.max(2, player.version || 1),
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
