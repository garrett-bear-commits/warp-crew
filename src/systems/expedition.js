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

export function skipExpeditionJob(job, now = Date.now()) {
  return {
    ...job,
    endAt: now,
    payload: { ...job.payload, skippedWithGems: true },
  };
}

export const PLANETS_V1 = [
  {
    id: 'dustfall',
    name: 'Dustfall Outpost',
    difficulty: 18,
    minutes: Math.max(5, Math.floor(TEST_EXPEDITION_MINUTES / 3)),
    blurb: 'Tutorial scrap moon — short run. Start here.',
    minDay: 1,
  },
  {
    id: 'derelict_freighter',
    name: 'Derelict Freighter',
    difficulty: 25,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Silent hulk on the edge of the Spur. Salvage and risk.',
    minDay: 1,
  },
  {
    id: 'crystal_asteroid',
    name: 'Crystal Asteroid',
    difficulty: 40,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Refractive ore veins. Good medals, medium danger.',
    minDay: 1,
  },
  {
    id: 'tidefall_ruins',
    name: 'Tidefall Ruins',
    difficulty: 35,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Submerged alien arches. Scouts love it.',
    minDay: 2,
  },
  {
    id: 'ice_outpost',
    name: 'Ice Mining Outpost',
    difficulty: 55,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Frozen claim under Swarm probe traffic.',
    minDay: 2,
  },
  {
    id: 'ledger_vault',
    name: 'Ledger Vault',
    difficulty: 45,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Abandoned bank vault asteroid. Credits + medals.',
    minDay: 3,
  },
  {
    id: 'swarm_husk',
    name: 'Swarm Husk',
    difficulty: 60,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Hollowed probe carcass. High danger, high rep.',
    minDay: 3,
  },
  {
    id: 'echo_shoal',
    name: 'Echo Shoal',
    difficulty: 50,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Crystal shallows. Bring a scout.',
    minDay: 4,
  },
  {
    id: 'amber_mine',
    name: 'Amber Mine',
    difficulty: 42,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Resin tunnels under Amber Port.',
    minDay: 4,
  },
  {
    id: 'signal_wreck',
    name: 'Signal Wreck',
    difficulty: 48,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Collapsed array spine. Story-adjacent salvage.',
    minDay: 5,
  },
  {
    id: 'pirate_cache',
    name: 'Pirate Cache',
    difficulty: 58,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Hidden corsair stash. Security mercs shine.',
    minDay: 5,
  },
  {
    id: 'aurora_ice',
    name: 'Aurora Ice Cap',
    difficulty: 52,
    minutes: TEST_EXPEDITION_MINUTES,
    blurb: 'Tourist moon’s dark side. Quiet riches.',
    minDay: 6,
  },
];

export function visiblePlanets(player, now = Date.now()) {
  const day = 1 + Math.floor((now - (player.createdAt || now)) / 86400000);
  return PLANETS_V1.filter((p) => !p.minDay || day >= p.minDay);
}
