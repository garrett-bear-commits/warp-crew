// @ts-nocheck
import {
  CREW_CATALOG,
  RARITY,
  createCrewInstance,
  recomputeCrew,
  catalogById,
  rankUpCost,
  medalLevelCostFor,
} from '../data/crewRoster.js';
import { sellContract, reputationRank, canAfford, pay, grant } from './economy.js';

export function defaultGacha() {
  return { pityRare: 0, pityLegend: 0, luck: 0, pulls: 0, lastRarity: null };
}

export function rarityWeights(reputation = 0, luck = 0) {
  let w = {
    common: 64,
    uncommon: 26,
    rare: 7.5,
    epic: 1.8,
    legendary: 0.55,
    mythic: 0.12,
    apex: 0.03,
  };
  if (reputation >= 100) { w.common = 56; w.uncommon = 28; w.rare = 11; w.epic = 3.2; w.legendary = 1.2; w.mythic = 0.45; w.apex = 0.15; }
  if (reputation >= 300) { w.common = 42; w.uncommon = 32; w.rare = 16; w.epic = 6; w.legendary = 2.6; w.mythic = 1; w.apex = 0.4; }
  if (reputation >= 600) { w.common = 30; w.uncommon = 30; w.rare = 22; w.epic = 10; w.legendary = 5; w.mythic = 2.2; w.apex = 0.8; }
  if (reputation >= 1000) { w.common = 20; w.uncommon = 26; w.rare = 26; w.epic = 14; w.legendary = 8; w.mythic = 4; w.apex = 2; }
  if (reputation >= 2000) { w.common = 12; w.uncommon = 20; w.rare = 26; w.epic = 18; w.legendary = 12; w.mythic = 7; w.apex = 5; }

  const L = Math.max(0, luck || 0);
  // Orbo-style luck: spend to bias the board. Diminishing but never wasted.
  const odd = 1 + L * 0.018;
  w.rare *= odd;
  w.epic *= 1 + L * 0.028;
  w.legendary *= 1 + L * 0.04;
  w.mythic *= 1 + L * 0.05;
  w.apex *= 1 + L * 0.055;
  w.common = Math.max(6, w.common / (1 + L * 0.012));
  return w;
}

export const REP_GATES = [100, 300, 600, 1000, 2000, 3500, 5500];

export function nextRepGate(reputation = 0) {
  const rank = reputationRank(reputation);
  const next = REP_GATES.find((n) => reputation < n);
  if (!next) return { next: null, label: `${rank.label} · max oddities`, rank };
  return { next, remain: next - reputation, label: `${rank.label} · ${reputation} / ${next} rep`, rank };
}

export const PITY = {
  rareSoft: 8,
  rareHard: 15,
  legendSoft: 55,
  legendHard: 80,
};

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

function rarityRank(id) {
  return RARITY[id]?.rank || 1;
}

function applyPity(rarity, gacha, weights) {
  const g = { ...defaultGacha(), ...(gacha || {}) };
  let w = { ...weights };
  if (g.pityRare >= PITY.rareSoft) {
    const extra = 1 + (g.pityRare - PITY.rareSoft) * 0.35;
    w.rare *= extra;
    w.epic *= extra;
  }
  if (g.pityLegend >= PITY.legendSoft) {
    const extra = 1 + (g.pityLegend - PITY.legendSoft) * 0.55;
    w.legendary *= extra * 2;
    w.mythic *= extra;
    w.apex *= extra;
  }
  let pick = rarity;
  if (!pick) pick = pickRarity(w);
  if (g.pityRare + 1 >= PITY.rareHard && rarityRank(pick) < 3) pick = 'rare';
  if (g.pityLegend + 1 >= PITY.legendHard && rarityRank(pick) < 5) pick = 'legendary';
  return pick;
}

export function pullMerc({
  reputation = 0,
  luck = 0,
  gacha = null,
  rng = Math.random,
  guaranteedRarity = null,
  minRarity = null,
} = {}) {
  const weights = rarityWeights(reputation, luck);
  let rarity = guaranteedRarity || applyPity(null, gacha, weights);
  if (minRarity && rarityRank(rarity) < rarityRank(minRarity)) rarity = minRarity;
  const pool = CREW_CATALOG.filter((c) => c.rarity === rarity);
  const fallback = CREW_CATALOG.filter((c) => c.rarity === 'common');
  const list = pool.length ? pool : fallback;
  const template = list[Math.floor(rng() * list.length)];
  const instance = createCrewInstance(template.id);
  return { instance, rarity, template };
}

export function tickPity(gacha, rarity) {
  const g = { ...defaultGacha(), ...(gacha || {}) };
  const rank = rarityRank(rarity);
  g.pulls = (g.pulls || 0) + 1;
  g.lastRarity = rarity;
  if (rank >= 5) {
    g.pityLegend = 0;
    g.pityRare = 0;
  } else if (rank >= 3) {
    g.pityRare = 0;
    g.pityLegend = (g.pityLegend || 0) + 1;
  } else {
    g.pityRare = (g.pityRare || 0) + 1;
    g.pityLegend = (g.pityLegend || 0) + 1;
  }
  return g;
}

export function luckCreditCost(luck = 0) {
  return Math.floor(90 * Math.pow(1.18, Math.max(0, luck)));
}

export function luckGemCost(luck = 0) {
  return 12 + Math.max(0, luck) * 3;
}

export function buyLuck(player, currency = 'credits') {
  const g = { ...defaultGacha(), ...(player.gacha || {}) };
  const cost = currency === 'gems' ? { gems: luckGemCost(g.luck) } : { credits: luckCreditCost(g.luck) };
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  const paid = pay(player.wallet, cost);
  g.luck = (g.luck || 0) + 1;
  return { ok: true, player: { ...player, wallet: paid.wallet, gacha: g }, cost, luck: g.luck };
}

/** Own copy → star up (max 5). At 5 stars, convert to medals/credits. */
export function applyPullToRoster(player, instance) {
  const owned = (player.crew || []).find((c) => c.templateId === instance.templateId);
  if (!owned) {
    if ((player.crew || []).length < (player.crewSlots || 2)) {
      return {
        player: { ...player, crew: [...player.crew, instance] },
        kind: 'hire',
        instance,
      };
    }
    const sold = sellContract(instance.rarity);
    return {
      player: { ...player, wallet: grant(player.wallet, sold) },
      kind: 'sold',
      instance,
      sold,
    };
  }
  if ((owned.stars || 1) < 5) {
    const next = recomputeCrew({
      ...owned,
      stars: (owned.stars || 1) + 1,
      copies: (owned.copies || 1) + 1,
    });
    return {
      player: {
        ...player,
        crew: player.crew.map((c) => (c.instanceId === owned.instanceId ? next : c)),
      },
      kind: 'star',
      instance: next,
    };
  }
  const sold = sellContract(instance.rarity);
  const bonus = {
    credits: Math.floor((sold.credits || 0) * 1.4),
    medals: Math.floor((sold.medals || 0) * 1.6),
  };
  return {
    player: {
      ...player,
      wallet: grant(player.wallet, bonus),
      crew: player.crew.map((c) =>
        c.instanceId === owned.instanceId ? { ...c, copies: (c.copies || 1) + 1 } : c
      ),
    },
    kind: 'cap',
    instance: owned,
    sold: bonus,
  };
}

export function contractHire(player, templateId) {
  const t = catalogById(templateId);
  if (!t) return { ok: false, reason: 'unknown' };
  if (!t.hireCost) return { ok: false, reason: 'gacha_only' };
  if ((player.crew || []).some((c) => c.templateId === templateId)) return { ok: false, reason: 'owned' };
  if ((player.crew || []).length >= (player.crewSlots || 2)) return { ok: false, reason: 'no_slot' };
  if (!canAfford(player.wallet, t.hireCost)) return { ok: false, reason: 'cannot_afford', cost: t.hireCost };
  const paid = pay(player.wallet, t.hireCost);
  const instance = createCrewInstance(t.id);
  return {
    ok: true,
    player: { ...player, wallet: paid.wallet, crew: [...player.crew, instance] },
    instance,
    cost: t.hireCost,
  };
}

export function pullOnce(player, { gems = false, free = false, rng = Math.random } = {}) {
  const cost = free ? {} : gems ? GACHA_COSTS.gems : GACHA_COSTS.credits;
  if (!free && !canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  let next = player;
  if (!free) next = { ...next, wallet: pay(next.wallet, cost).wallet };
  else next = { ...next, dailyPullAvailable: false };
  const gacha = { ...defaultGacha(), ...(next.gacha || {}) };
  const { instance, rarity } = pullMerc({
    reputation: next.wallet.reputation,
    luck: gacha.luck || 0,
    gacha,
    rng,
  });
  next = { ...next, gacha: tickPity(gacha, rarity) };
  const applied = applyPullToRoster(next, instance);
  return {
    ok: true,
    player: applied.player,
    instance: applied.instance,
    rarity,
    kind: applied.kind,
    sold: applied.sold,
    cost,
    free,
  };
}

export function pullTen(player, { rng = Math.random } = {}) {
  const cost = GACHA_COSTS.gems10;
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  let next = { ...player, wallet: pay(player.wallet, cost).wallet };
  const results = [];
  let rareHit = false;
  for (let i = 0; i < 10; i++) {
    const gacha = { ...defaultGacha(), ...(next.gacha || {}) };
    const minRarity = i === 9 && !rareHit ? 'rare' : null;
    const { instance, rarity } = pullMerc({
      reputation: next.wallet.reputation,
      luck: gacha.luck || 0,
      gacha,
      rng,
      minRarity,
    });
    if (rarityRank(rarity) >= 3) rareHit = true;
    next = { ...next, gacha: tickPity(gacha, rarity) };
    const applied = applyPullToRoster(next, instance);
    next = applied.player;
    results.push({ rarity, kind: applied.kind, instance: applied.instance, sold: applied.sold });
  }
  return { ok: true, player: next, results, cost };
}

export function rankUpCrew(player, instanceId) {
  const c = (player.crew || []).find((x) => x.instanceId === instanceId);
  if (!c) return { ok: false, reason: 'missing' };
  const cost = rankUpCost(c);
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  const next = recomputeCrew({ ...c, rank: (c.rank || 1) + 1 });
  return {
    ok: true,
    player: {
      ...player,
      wallet: pay(player.wallet, cost).wallet,
      crew: player.crew.map((x) => (x.instanceId === instanceId ? next : x)),
    },
    crew: next,
    cost,
  };
}

export function levelCrew(player, instanceId) {
  const c = (player.crew || []).find((x) => x.instanceId === instanceId);
  if (!c) return { ok: false, reason: 'missing' };
  const costMedals = medalLevelCostFor(c);
  const cost = { medals: costMedals };
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  const next = recomputeCrew({ ...c, level: (c.level || 1) + 1, xp: 0 });
  return {
    ok: true,
    player: {
      ...player,
      wallet: pay(player.wallet, cost).wallet,
      crew: player.crew.map((x) => (x.instanceId === instanceId ? next : x)),
    },
    crew: next,
    cost,
  };
}

export const GACHA_COSTS = {
  dailyFree: {},
  credits: { credits: 500 },
  gems: { gems: 100 },
  gems10: { gems: 900 },
};

export { RARITY, CREW_CATALOG, sellContract, rarityRank };
