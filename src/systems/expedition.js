import { makeTimedJob, wallClockProgress } from '../shared/timer.js';

/** Test cadence — set TEST_EXPEDITION_MINUTES = 360 for launch (6h) */
export const TEST_EXPEDITION_MINUTES = 15;
export const LAUNCH_EXPEDITION_MINUTES = 360;

export function expeditionSuccessChance({ crewPower, planetDifficulty, gearBonus = 0 }) {
  const raw = 0.35 + (crewPower / (crewPower + planetDifficulty)) * 0.55 + gearBonus;
  return Math.max(0.05, Math.min(0.95, raw));
}

export function startExpedition({
  planetId,
  crewInstanceIds,
  minutes = TEST_EXPEDITION_MINUTES,
  successChance,
  startedAt = Date.now(),
}) {
  return makeTimedJob({
    id: `exp_${planetId}_${startedAt}`,
    kind: 'expedition',
    minutes,
    startedAt,
    payload: {
      planetId,
      crewInstanceIds: [...crewInstanceIds],
      successChance,
    },
  });
}

export function resolveExpedition(job, { rng = Math.random } = {}) {
  const { progress, complete } = wallClockProgress(job);
  if (!complete) return { ready: false, progress };
  const success = rng() < (job.payload.successChance ?? 0.5);
  const mult = success ? 1 : 0.15;
  const rewards = {
    credits: Math.floor((80 + (job.payload.successChance || 0.5) * 120) * mult),
    medals: Math.floor((12 + (job.payload.successChance || 0.5) * 20) * mult),
    reputation: success ? 5 : 1,
  };
  return {
    ready: true,
    success,
    rewards,
    crewInstanceIds: job.payload.crewInstanceIds,
  };
}

/** Mission board destinations (aligns with mockup: freighter / asteroid / outpost) */
export const PLANETS_V1 = [
  {
    id: 'derelict_freighter',
    name: 'Derelict Freighter',
    difficulty: 25,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Silent hulk on the edge of the Spur. Salvage and risk.',
  },
  {
    id: 'crystal_asteroid',
    name: 'Crystal Asteroid',
    difficulty: 40,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Refractive ore veins. Good medals, medium danger.',
  },
  {
    id: 'ice_outpost',
    name: 'Ice Mining Outpost',
    difficulty: 55,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Frozen claim under Swarm probe traffic.',
  },
  {
    id: 'dustfall',
    name: 'Dustfall Outpost',
    difficulty: 20,
    minutes: Math.max(5, Math.floor(TEST_EXPEDITION_MINUTES / 2)),
    blurb: 'Tutorial scrap moon — short run.',
  },
];
