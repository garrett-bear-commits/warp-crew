// @ts-nocheck
import { CREW_CATALOG, createCrewInstance } from '../data/crewRoster.js';

/** Reputation → weight multipliers for rarities */
export function rarityWeights(reputation = 0) {
  // Base weights
  let w = {
    common: 70,
    uncommon: 25,
    rare: 4.5,
    epic: 0.45,
    legendary: 0.05,
  };
  if (reputation >= 100) { w.common = 60; w.uncommon = 30; w.rare = 8; w.epic = 1.5; w.legendary = 0.2; }
  if (reputation >= 300) { w.common = 45; w.uncommon = 35; w.rare = 15; w.epic = 4; w.legendary = 0.8; }
  if (reputation >= 600) { w.common = 30; w.uncommon = 35; w.rare = 22; w.epic = 10; w.legendary = 2; }
  if (reputation >= 1000) { w.common = 20; w.uncommon = 30; w.rare = 28; w.epic = 16; w.legendary = 5; }
  if (reputation >= 2000) { w.common = 12; w.uncommon = 25; w.rare = 30; w.epic = 22; w.legendary = 10; }
  return w;
}

function pickRarity(weights, rng = Math.random) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let r = rng() * total;
  for (const [k, v] of entries) {
    r -= v;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function pullMerc({ reputation = 0, rng = Math.random, guaranteedRarity = null } = {}) {
  const rarity = guaranteedRarity || pickRarity(rarityWeights(reputation), rng);
  const pool = CREW_CATALOG.filter((c) => c.rarity === rarity);
  const fallback = CREW_CATALOG.filter((c) => c.rarity === 'common');
  const list = pool.length ? pool : fallback;
  const template = list[Math.floor(rng() * list.length)];
  const instance = createCrewInstance(template.id);
  return { instance, rarity, template };
}

export const GACHA_COSTS = {
  dailyFree: {},
  credits: { credits: 500 },
  gems: { gems: 100 },
  gems10: { gems: 900 },
};

/** Deck if a slot is open, otherwise stash in reserve (PSS inventory analog). */
export function placeCrew(player, instance) {
  const crew = player.crew || [];
  if (crew.length < (player.crewSlots || 0)) {
    return { player: { ...player, crew: [...crew, instance] }, dest: 'deck' };
  }
  return {
    player: { ...player, reserve: [...(player.reserve || []), instance] },
    dest: 'reserve',
  };
}

export function runPulls(player, count, opts = {}) {
  let next = player;
  const pulled = [];
  for (let i = 0; i < count; i++) {
    const { instance, rarity } = pullMerc({
      reputation: next.wallet?.reputation || 0,
      guaranteedRarity: opts.guaranteedRarity || null,
    });
    const placed = placeCrew(next, instance);
    next = placed.player;
    pulled.push({ instance, rarity, dest: placed.dest });
  }
  return { player: next, pulled };
}

export function assignFromReserve(player, instanceId) {
  const reserve = [...(player.reserve || [])];
  const idx = reserve.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) return { ok: false, reason: 'missing', player };
  if ((player.crew || []).length >= (player.crewSlots || 0)) {
    return { ok: false, reason: 'no_slot', player };
  }
  const [instance] = reserve.splice(idx, 1);
  return {
    ok: true,
    player: { ...player, reserve, crew: [...player.crew, instance] },
  };
}
