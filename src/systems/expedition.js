// @ts-nocheck
import { makeTimedJob, wallClockProgress } from '../shared/timer.js';
import { PLANET_DEFS, planetById } from '../data/planets.js';
import { readyCrew } from './player.js';
import { crewPower } from './combat.js';
import { sumPassives } from './passives.js';
import { scaleSitePayout } from './economy.js';
import { galaxyUnlocked } from '../data/galaxies.js';

/** Test cadence — set to 360 for launch (6h) */
export const TEST_EXPEDITION_MINUTES = 15;
export const LAUNCH_EXPEDITION_MINUTES = 360;

/** Gem cost to finish an active expedition immediately (success roll still applies). */
export const EXPEDITION_SKIP_GEMS = 15;

export function expeditionSuccessChance({ crewPower: power, planetDifficulty, gearBonus = 0, roleBonus = 0 }) {
  const raw = 0.38 + (power / (power + planetDifficulty)) * 0.52 + gearBonus + roleBonus;
  return Math.max(0.08, Math.min(0.94, raw));
}

export function expeditionPartySize(player) {
  const slots = player.crewSlots || 2;
  return Math.min(4, 2 + Math.floor(Math.max(0, slots - 2) / 4));
}

function expeditionReadyCrew(player) {
  return readyCrew(player).filter((crew) => crew.status !== 'injured');
}

function roleMatchReason(role) {
  return `${String(role).slice(0, 1).toUpperCase()}${String(role).slice(1)} match`;
}

export function expeditionCrewOptions(player, planetId) {
  const planet = planetById(planetId);
  if (!planet) return [];

  const pref = planet.prefRole;
  const ready = expeditionReadyCrew(player);
  const highestPower = Math.max(...ready.map((crew) => crew.power || 10), 0);
  return ready
    .map((crew) => {
      const roleScore = pref && crew.role === pref ? 14 : 0;
      const expeditionPassive = crew.passive?.expeditionSuccess || 0;
      const reasons = [`power ${crew.power || 10}`];
      if (roleScore) reasons.push(roleMatchReason(pref));
      if ((crew.power || 10) === highestPower) reasons.push('highest ready power');
      if (expeditionPassive) reasons.push(`expedition passive +${Math.round(expeditionPassive * 100)}%`);
      return {
        ...crew,
        id: crew.instanceId,
        reasons,
        score: (crew.power || 10) + roleScore + expeditionPassive * 90,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function recommendedExpeditionCrewIds(player, planetId) {
  return expeditionCrewOptions(player, planetId)
    .slice(0, expeditionPartySize(player))
    .map((crew) => crew.instanceId);
}

export function validateExpeditionParty(player, planetId, crewInstanceIds) {
  const planet = planetById(planetId);
  if (!planet) return { ok: false, reason: 'unknown_planet' };
  if (!Array.isArray(crewInstanceIds)) return { ok: false, reason: 'invalid_party' };
  if (!crewInstanceIds.length) return { ok: false, reason: 'empty_party' };
  const cap = expeditionPartySize(player);
  if (crewInstanceIds.length > cap) return { ok: false, reason: 'party_cap', cap };
  if (new Set(crewInstanceIds).size !== crewInstanceIds.length) return { ok: false, reason: 'duplicate_crew' };

  const byId = new Map((player.crew || []).map((crew) => [crew.instanceId, crew]));
  const crew = [];
  for (const instanceId of crewInstanceIds) {
    const member = byId.get(instanceId);
    if (!member) return { ok: false, reason: 'unknown_crew', instanceId };
    if (member.status === 'expedition') return { ok: false, reason: 'away_crew', instanceId };
    if (member.status === 'injured') return { ok: false, reason: 'injured_crew', instanceId };
    if (!expeditionReadyCrew(player).some((candidate) => candidate.instanceId === instanceId)) {
      return { ok: false, reason: 'unavailable_crew', instanceId };
    }
    crew.push(member);
  }
  return { ok: true, planet, crew, crewInstanceIds: [...crewInstanceIds], cap };
}

export function pickExpeditionCrew(player, planet, max = null) {
  const cap = max ?? expeditionPartySize(player);
  return expeditionCrewOptions(player, planet?.id)
    .slice(0, cap)
    .map((crew) => ({ ...crew }));
}

export function previewExpedition(player, planetId, crewInstanceIds = null) {
  const planet = planetById(planetId);
  const selectedIds = crewInstanceIds == null
    ? recommendedExpeditionCrewIds(player, planetId)
    : crewInstanceIds;
  const validation = validateExpeditionParty(player, planetId, selectedIds);
  const crew = validation.ok ? validation.crew : [];
  const roleHit = planet.prefRole && crew.some((c) => c.role === planet.prefRole);
  const sensors = Math.max(0, player?.ship?.systems?.sensors || 0) * 0.02;
  const chance = expeditionSuccessChance({
    crewPower: crewPower(crew),
    planetDifficulty: planet.difficulty,
    gearBonus: (sumPassives(crew).expeditionSuccess || 0) + sensors,
    roleBonus: roleHit ? 0.06 : 0,
  });
  const visits = player.stats?.planetRuns?.[planet.id] || 0;
  const win = scaleSitePayout(planet.success || { credits: 80, medals: 8, reputation: 3 }, player, {
    kind: 'expedition',
    visits,
  });
  const fail = scaleSitePayout(planet.failLoot || { credits: 18, medals: 2, reputation: 1 }, player, {
    kind: 'expedition',
    visits,
  });
  return { planet, crew, chance, roleHit, win, fail, selectedIds: [...selectedIds], validation };
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
    visits: player?.stats?.planetRuns?.[planet.id] || 0,
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
  const sensorBonus = (player?.ship?.systems?.sensors || 0) >= 3 ? 1 : 0;
  return PLANETS_V1.filter((p) => {
    if (p.sector && p.sector !== 'spur' && !galaxyUnlocked(player, p.sector)) return false;
    if (p.minDay && day + sensorBonus < p.minDay) return false;
    return true;
  });
}

export { planetById };
