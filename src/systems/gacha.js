// @ts-nocheck
import { CREW_CATALOG, RARITY, createCrewInstance } from '../data/crewRoster.js';

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
