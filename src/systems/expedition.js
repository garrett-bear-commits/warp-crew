import { makeTimedJob, wallClockProgress } from '../shared/timer.js';

export const DEFAULT_EXPEDITION_HOURS = 6;

export function expeditionSuccessChance({ crewPower, planetDifficulty, gearBonus = 0 }) {
  const raw = 0.35 + (crewPower / (crewPower + planetDifficulty)) * 0.55 + gearBonus;
  return Math.max(0.05, Math.min(0.95, raw));
}

export function startExpedition({
  planetId,
  crewInstanceIds,
  hours = DEFAULT_EXPEDITION_HOURS,
  successChance,
  startedAt = Date.now(),
}) {
  return makeTimedJob({
    id: `exp_${planetId}_${startedAt}`,
    kind: 'expedition',
    minutes: hours * 60,
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
  // Rewards scale lightly with chance tier
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

export const PLANETS_V1 = [
  { id: 'dustfall', name: 'Dustfall Outpost', difficulty: 20, hours: 2, blurb: 'Tutorial scrap moon' },
  { id: 'verdant', name: 'Verdant Reach', difficulty: 40, hours: 6, blurb: 'Jungle world, rich alloys' },
  { id: 'glassmere', name: 'Glassmere', difficulty: 55, hours: 6, blurb: 'Crystal flats, pirate risk' },
  { id: 'cinder', name: 'Cinder Reach', difficulty: 70, hours: 8, blurb: 'Volcanic mining claims' },
];
