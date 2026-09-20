// @ts-nocheck
import { makeTimedJob, wallClockProgress } from '../shared/timer.js';
import { PLANET_DEFS, planetById } from '../data/planets.js';
import { readyCrew } from './player.js';
import { crewPower } from './combat.js';
import { sumPassives } from './passives.js';
import { scaleSitePayout } from './economy.js';

/** Test cadence — set to 360 for launch (6h) */
export const TEST_EXPEDITION_MINUTES = 15;
export const LAUNCH_EXPEDITION_MINUTES = 360;

/** Gem cost to finish an active expedition immediately (success roll still applies). */
export const EXPEDITION_SKIP_GEMS = 15;

export function expeditionSuccessChance({ crewPower: power, planetDifficulty, gearBonus = 0, roleBonus = 0 }) {
  const raw = 0.38 + (power / (power + planetDifficulty)) * 0.52 + gearBonus + roleBonus;
  return Math.max(0.08, Math.min(0.94, raw));
}

export function pickExpeditionCrew(player, planet, max = 2) {
  const pref = planet?.prefRole;
  const ready = readyCrew(player);
  const scored = ready
    .map((c) => ({
      c,
      score:
        (c.power || 10) +
        (pref && c.role === pref ? 14 : 0) +
        (c.passive?.expeditionSuccess || 0) * 90,
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((x) => x.c);
}

export function previewExpedition(player, planetId) {
  const planet = planetById(planetId);
  const crew = pickExpeditionCrew(player, planet);
  const roleHit = planet.prefRole && crew.some((c) => c.role === planet.prefRole);
  const chance = expeditionSuccessChance({
    crewPower: crewPower(crew),
    planetDifficulty: planet.difficulty,
    gearBonus: sumPassives(crew).expeditionSuccess || 0,
    roleBonus: roleHit ? 0.06 : 0,
  });
  const win = scaleSitePayout(planet.success || { credits: 80, medals: 8, reputation: 3 }, player, {
    kind: 'expedition',
    visits: player.stats?.expeditions || 0,
  });
  const fail = scaleSitePayout(planet.failLoot || { credits: 18, medals: 2, reputation: 1 }, player, {
    kind: 'expedition',
    visits: player.stats?.expeditions || 0,
  });
  return { planet, crew, chance, roleHit, win, fail };
}

export function startExpedition({
  planetId,
  crewInstanceIds,
  minutes = TEST_EXPEDITION_MINUTES,
  successChance,
  startedAt = Date.now(),
  roleHit = false,
}) {
  const planet = planetById(planetId);
  return makeTimedJob({
    id: `exp_${planetId}_${startedAt}`,
    kind: 'expedition',
    minutes: minutes ?? planet.minutes ?? TEST_EXPEDITION_MINUTES,
    startedAt,
    payload: {
      planetId,
      crewInstanceIds: [...crewInstanceIds],
      successChance,
      roleHit: Boolean(roleHit),
    },
  });
}

function lootFor(job, success, player) {
  const planet = planetById(job.payload.planetId);
  const table = success ? planet.success : planet.failLoot;
  const base = table || (success
    ? { credits: 70, medals: 8, reputation: 4 }
    : { credits: 16, medals: 2, reputation: 1 });
  return scaleSitePayout(base, player || {}, {
    kind: 'expedition',
    visits: player?.stats?.expeditions || 0,
  });
}

export function resolveExpedition(job, { rng = Math.random, forceComplete = false, player = null, abortFrac = 1 } = {}) {
  const { progress, complete } = wallClockProgress(job);
  if (!forceComplete && !complete) return { ready: false, progress };

  const chance = job.payload.successChance ?? 0.5;
  const success = abortFrac < 1 ? false : rng() < chance;
  let rewards = lootFor(job, success, player);
  if (abortFrac < 1) {
    rewards = {
      credits: Math.floor((rewards.credits || 0) * abortFrac),
      medals: Math.max(0, Math.floor((rewards.medals || 0) * abortFrac)),
      reputation: Math.max(0, Math.floor((rewards.reputation || 0) * abortFrac)),
      gems: 0,
    };
  }
  const planet = planetById(job.payload.planetId);
  return {
    ready: true,
    success,
    rewards,
    crewInstanceIds: job.payload.crewInstanceIds,
    skipped: Boolean(forceComplete) && abortFrac >= 1,
    aborted: abortFrac < 1,
    flavor: success ? planet.win : planet.fail,
    planet,
    progress: 1,
  };
}

export function skipExpeditionJob(job, now = Date.now()) {
  return {
    ...job,
    endAt: now,
    payload: { ...job.payload, skippedWithGems: true },
  };
}

export function abortPayoutFrac(job, now = Date.now()) {
  const { progress } = wallClockProgress(job);
  if (progress < 0.5) return 0;
  return 0.25;
}

export const PLANETS_V1 = PLANET_DEFS.map((p) => ({
  ...p,
  minutes: p.minutes ?? TEST_EXPEDITION_MINUTES,
}));

export function visiblePlanets(player, now = Date.now()) {
  const day = 1 + Math.floor((now - (player.createdAt || now)) / 86400000);
  const veilOpen = Boolean(player.flags?.veil_opened || player.story?.veilUnlocked);
  return PLANETS_V1.filter((p) => {
    if (p.sector === 'veil' && !veilOpen) return false;
    if (p.minDay && day < p.minDay) return false;
    return true;
  });
}

export { planetById };
