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
    version: 1,
    captainName,
    createdAt: now,
    wallet: {
      credits: 200,
      fuel: DEFAULT_FUEL_CONFIG.startingFuel,
      gems: 0,
      medals: 20,
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
