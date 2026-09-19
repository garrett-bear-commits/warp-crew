import { makeTimedJob, wallClockProgress } from '../shared/timer.js';

/** Test cadence — set to 360 for launch (6h) */
export const TEST_EXPEDITION_MINUTES = 15;
export const LAUNCH_EXPEDITION_MINUTES = 360;

/** Gem cost to finish an active expedition immediately (success roll still applies). */
export const EXPEDITION_SKIP_GEMS = 15;

export function expeditionSuccessChance({ crewPower, planetDifficulty, gearBonus = 0 }) {
  const raw = 0.38 + (crewPower / (crewPower + planetDifficulty)) * 0.52 + gearBonus;
  return Math.max(0.08, Math.min(0.94, raw));
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

export function resolveExpedition(job, { rng = Math.random, forceComplete = false } = {}) {
  const { progress, complete } = wallClockProgress(job);
  if (!forceComplete && !complete) return { ready: false, progress };

  const success = rng() < (job.payload.successChance ?? 0.5);
  const mult = success ? 1 : 0.18;
  // Slightly tuned for 15m test loop — still meaningful but not print money
  const rewards = {
    credits: Math.floor((70 + (job.payload.successChance || 0.5) * 110) * mult),
    medals: Math.floor((10 + (job.payload.successChance || 0.5) * 18) * mult),
    reputation: success ? 5 : 1,
  };
  return {
    ready: true,
    success,
    rewards,
    crewInstanceIds: job.payload.crewInstanceIds,
    skipped: Boolean(forceComplete),
  };
}

/** Instant-complete by setting endAt to now (caller pays gems). */
export function skipExpeditionJob(job, now = Date.now()) {
  return {
    ...job,
    endAt: now,
    payload: { ...job.payload, skippedWithGems: true },
  };
}

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
    difficulty: 18,
    minutes: Math.max(5, Math.floor(TEST_EXPEDITION_MINUTES / 3)),
    blurb: 'Tutorial scrap moon — short run.',
  },
];
