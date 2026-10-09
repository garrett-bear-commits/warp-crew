// @ts-nocheck
import {
  CREW_CATALOG,
  RARITY,
  createCrewInstance,
  recomputeCrew,
  catalogById,
  rankUpCost,
  medalLevelCostFor,
  STARTER_CAPTAINS,
  ASCENSION,
  MAX_ASCENSION,
  levelCap,
} from '../data/crewRoster.js';
import { sellContract, reputationRank, canAfford, pay, grant } from './economy.js';
import { currentBanner, MARK_COST } from '../data/banners.js';
import { trustedNow } from '../shared/time.js';

/** Room for a collection: 24 mercs wait in reserve (was 8, which auto-sold Epics after a 10-hire). */
export const RESERVE_CAP = 24;

/** Hires roll from every merc except the starter captains: a captain is chosen once, never pulled. */
export const RECRUIT_POOL = CREW_CATALOG.filter((c) => !STARTER_CAPTAINS.includes(c.id));
export const LUCK_CAP = 15;

export function defaultGacha() {
  return { pityRare: 0, pityLegend: 0, luck: 0, pulls: 0, lastRarity: null, history: [], marks: 0, featuredGuarantee: false };
}

/**
 * Reputation and Luck lift the odds, but Legendary-or-better stays special: at most 3% of a hire
 * (and Mythic plus Apex at most 0.6%) before pity. Base rates are unchanged (crew-matter design).
 */
export const RARITY_CAPS = Object.freeze({ legendaryPlus: 0.03, mythicPlus: 0.006 });

function capInflation(w) {
  // Work in probabilities: cap Mythic+Apex first, then give Legendary whatever room is left under the
  // Legendary-or-better cap. The mass taken off moves to Rare and Epic, so the odds never invert.
  const total = Object.values(w).reduce((sum, v) => sum + v, 0);
  const p = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / total]));
  let freed = 0;
  const top = p.mythic + p.apex;
  if (top > RARITY_CAPS.mythicPlus) {
    const f = RARITY_CAPS.mythicPlus / top;
    freed += top - RARITY_CAPS.mythicPlus;
    p.mythic *= f;
    p.apex *= f;
  }
  const room = RARITY_CAPS.legendaryPlus - (p.mythic + p.apex);
  if (p.legendary > room) {
    freed += p.legendary - room;
    p.legendary = room;
  }
  if (freed > 0) {
    const mid = p.rare + p.epic;
    p.rare += freed * (p.rare / mid);
    p.epic += freed * (p.epic / mid);
  }
  return p;
}

// --- Seeded hires: each save has its own pull stream, so every result is reproducible. ---

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(a) {
  let t = a >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** This save's hire seed: kept once made, otherwise derived from the save's own identity. */
export function hireSeed(player) {
  const g = player?.gacha || {};
  if (Number.isInteger(g.seed)) return g.seed;
  return hashString(`${player?.createdAt ?? ''}|${player?.captainInstanceId ?? player?.crew?.[0]?.instanceId ?? 'crew'}`);
}

/** The random stream for this save's next hire (hire number n). */
export const hireRng = (seed, n) => mulberry32(hashString(`${seed}:${n}`));

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
  if (reputation >= 100) { w.common = 56; w.uncommon = 28; w.rare = 11; w.epic = 3.2; w.legendary = 1.2; w.mythic = 0.35; w.apex = 0.1; }
  if (reputation >= 300) { w.common = 44; w.uncommon = 32; w.rare = 15; w.epic = 5.5; w.legendary = 2.2; w.mythic = 0.8; w.apex = 0.22; }
  if (reputation >= 600) { w.common = 34; w.uncommon = 30; w.rare = 20; w.epic = 9; w.legendary = 4.2; w.mythic = 1.6; w.apex = 0.45; }
  if (reputation >= 1000) { w.common = 26; w.uncommon = 28; w.rare = 22; w.epic = 12; w.legendary = 7; w.mythic = 3; w.apex = 0.9; }
  if (reputation >= 2000) { w.common = 20; w.uncommon = 26; w.rare = 24; w.epic = 14; w.legendary = 9; w.mythic = 4.5; w.apex = 1.5; }
  if (reputation >= 3500) { w.common = 16; w.uncommon = 24; w.rare = 24; w.epic = 16; w.legendary = 11; w.mythic = 6; w.apex = 2.2; }
  if (reputation >= 5500) { w.common = 14; w.uncommon = 22; w.rare = 24; w.epic = 17; w.legendary = 12.2; w.mythic = 7; w.apex = 2.6; }

  const L = Math.max(0, Math.min(LUCK_CAP, luck || 0));
  const odd = 1 + L * 0.018;
  w.rare *= odd;
  w.epic *= 1 + L * 0.028;
  w.legendary *= 1 + L * 0.04;
  w.mythic *= 1 + L * 0.05;
  w.apex *= 1 + L * 0.055;
  w.common = Math.max(8, w.common / (1 + L * 0.012));
  return capInflation(w);
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

function applyPity(rarity, gacha, weights, rng = Math.random) {
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
  if (!pick) pick = pickRarity(w, rng);
  if (g.pityRare + 1 >= PITY.rareHard && rarityRank(pick) < 3) pick = 'rare';
  if (g.pityLegend + 1 >= PITY.legendHard && rarityRank(pick) < 5) pick = 'legendary';
  return pick;
}

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/**
 * One hire. With a banner: landing on the featured merc's rarity gives the featured merc half the time
 * (always, after a miss); landing on Rare gives a rate-up Rare half the time.
 * `featured` is true/false when the hire landed on the featured rarity, otherwise null.
 */
export function pullMerc({
  reputation = 0,
  luck = 0,
  gacha = null,
  rng = Math.random,
  guaranteedRarity = null,
  minRarity = null,
  banner = null,
} = {}) {
  const weights = rarityWeights(reputation, luck);
  let rarity = guaranteedRarity || applyPity(null, gacha, weights, rng);
  if (minRarity && rarityRank(rarity) < rarityRank(minRarity)) rarity = minRarity;
  const pool = RECRUIT_POOL.filter((c) => c.rarity === rarity);
  const fallback = RECRUIT_POOL.filter((c) => c.rarity === 'common');
  const list = pool.length ? pool : fallback;
  const star = banner ? catalogById(banner.featured) : null;
  let template;
  let featured = null;
  if (star && rarity === star.rarity) {
    const others = list.filter((c) => c.id !== star.id);
    featured = Boolean(gacha?.featuredGuarantee) || !others.length || rng() < 0.5;
    template = featured ? star : pick(others, rng);
  } else if (banner?.rateUp?.length && rarity === 'rare' && rng() < 0.5) {
    template = catalogById(pick(banner.rateUp, rng)) || pick(list, rng);
  } else {
    template = pick(list, rng);
  }
  const instance = createCrewInstance(template.id, { rng });
  return { instance, rarity, template, featured };
}

/** After a hire: a featured miss guarantees the next one at that rarity; a hit clears it; every hire is a mark. */
function afterBannerHire(gacha, featured) {
  return {
    ...gacha,
    marks: (gacha.marks || 0) + 1,
    featuredGuarantee: featured === true ? false : featured === false ? true : Boolean(gacha.featuredGuarantee),
  };
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

/** The actual roster outcome is recorded for regular and welcome draws alike. */
export function recordPull(gacha, instance, kind, source) {
  const history = Array.isArray(gacha?.history) ? gacha.history : [];
  return {
    ...gacha,
    history: [...history, { templateId: instance.templateId, instanceId: instance.instanceId,
      rarity: instance.rarity, kind, source }].slice(-40),
  };
}

export function luckCreditCost(luck = 0) {
  return Math.floor(90 * Math.pow(1.18, Math.max(0, luck)));
}

export function luckGemCost(luck = 0) {
  return 12 + Math.max(0, luck) * 3;
}

export function buyLuck(player, currency = 'credits') {
  const g = { ...defaultGacha(), ...(player.gacha || {}) };
  if ((g.luck || 0) >= LUCK_CAP) return { ok: false, reason: 'luck_cap', luck: g.luck };
  const cost = currency === 'gems' ? { gems: luckGemCost(g.luck) } : { credits: luckCreditCost(g.luck) };
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  const paid = pay(player.wallet, cost);
  g.luck = (g.luck || 0) + 1;
  return { ok: true, player: { ...player, wallet: paid.wallet, gacha: g }, cost, luck: g.luck };
}

function starCopy(owned) {
  return recomputeCrew({
    ...owned,
    stars: (owned.stars || 1) + 1,
    copies: (owned.copies || 1) + 1,
  });
}

/** Own copy → star up (max 5). Overflow parks in reserve. Reserve full → sell. */
export function applyPullToRoster(player, instance) {
  const crew = player.crew || [];
  const reserve = player.reserve || [];
  const owned = crew.find((c) => c.templateId === instance.templateId);
  if (owned) {
    if ((owned.stars || 1) < 5) {
      const next = starCopy(owned);
      return {
        player: {
          ...player,
          crew: crew.map((c) => (c.instanceId === owned.instanceId ? next : c)),
        },
        kind: 'star',
        instance: next,
      };
    }
    // Past 5 stars a copy becomes one of their shards, for Ascension (never pocket change).
    const shard = recomputeCrew({ ...owned, copies: (owned.copies || 1) + 1, shards: (owned.shards || 0) + 1 });
    return {
      player: { ...player, crew: crew.map((c) => (c.instanceId === owned.instanceId ? shard : c)) },
      kind: 'shard',
      instance: shard,
    };
  }

  const parked = reserve.find((c) => c.templateId === instance.templateId);
  if (parked) {
    if ((parked.stars || 1) < 5) {
      const next = starCopy(parked);
      return {
        player: {
          ...player,
          reserve: reserve.map((c) => (c.instanceId === parked.instanceId ? next : c)),
        },
        kind: 'star',
        instance: next,
      };
    }
    const shard = recomputeCrew({ ...parked, copies: (parked.copies || 1) + 1, shards: (parked.shards || 0) + 1 });
    return {
      player: { ...player, reserve: reserve.map((c) => (c.instanceId === parked.instanceId ? shard : c)) },
      kind: 'shard',
      instance: shard,
    };
  }

  if (crew.length < (player.crewSlots || 2)) {
    return {
      player: { ...player, crew: [...crew, instance] },
      kind: 'hire',
      instance,
    };
  }

  if (reserve.length < RESERVE_CAP) {
    return {
      player: { ...player, reserve: [...reserve, { ...instance, status: 'reserve' }] },
      kind: 'reserve',
      instance,
    };
  }

  // Reserve full: a rarer new merc takes the place of the weakest one waiting (who is sold instead),
  // so a good hire is never thrown away for lack of room.
  const weakest = [...reserve].sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || (a.power || 0) - (b.power || 0))[0];
  if (weakest && rarityRank(instance.rarity) > rarityRank(weakest.rarity)) {
    const bumped = sellContract(weakest.rarity);
    return {
      player: {
        ...player,
        wallet: grant(player.wallet, bumped),
        reserve: [...reserve.filter((c) => c.instanceId !== weakest.instanceId), { ...instance, status: 'reserve' }],
      },
      kind: 'reserve',
      instance,
      bumped: { instance: weakest, sold: bumped },
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

export function callUpReserve(player, instanceId) {
  const reserve = player.reserve || [];
  const found = reserve.find((c) => c.instanceId === instanceId);
  if (!found) return { ok: false, reason: 'missing' };
  if ((player.crew || []).length >= (player.crewSlots || 2)) return { ok: false, reason: 'no_slot' };
  if ((player.crew || []).some((c) => c.templateId === found.templateId)) return { ok: false, reason: 'owned' };
  return {
    ok: true,
    player: {
      ...player,
      crew: [...player.crew, { ...found, status: 'ready' }],
      reserve: reserve.filter((c) => c.instanceId !== instanceId),
    },
    instance: found,
  };
}

export function sellReserve(player, instanceId) {
  const reserve = player.reserve || [];
  const found = reserve.find((c) => c.instanceId === instanceId);
  if (!found) return { ok: false, reason: 'missing' };
  if (found.instanceId === player.captainInstanceId || found.isCaptain) return { ok: false, reason: 'captain_protected' };
  const sold = sellContract(found.rarity);
  return {
    ok: true,
    player: {
      ...player,
      wallet: grant(player.wallet, sold),
      reserve: reserve.filter((c) => c.instanceId !== instanceId),
    },
    instance: found,
    sold,
  };
}

export function contractHire(player, templateId) {
  const t = catalogById(templateId);
  if (!t) return { ok: false, reason: 'unknown' };
  if (!t.hireCost) return { ok: false, reason: 'gacha_only' };
  if ((player.crew || []).some((c) => c.templateId === templateId)) return { ok: false, reason: 'owned' };
  if ((player.reserve || []).some((c) => c.templateId === templateId)) return { ok: false, reason: 'owned' };
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

export function benchCrew(player, instanceId) {
  const crew = player.crew || [];
  const found = crew.find((c) => c.instanceId === instanceId);
  if (!found) return { ok: false, reason: 'missing' };
  if (found.instanceId === player.captainInstanceId || found.isCaptain) return { ok: false, reason: 'captain_protected' };
  if (found.status === 'expedition') return { ok: false, reason: 'away' };
  if (crew.length <= 1) return { ok: false, reason: 'last_crew' };
  const reserve = player.reserve || [];
  if (reserve.length >= RESERVE_CAP) return { ok: false, reason: 'reserve_full' };
  return {
    ok: true,
    player: {
      ...player,
      crew: crew.filter((c) => c.instanceId !== instanceId),
      reserve: [...reserve, { ...found, status: 'reserve' }],
    },
    instance: found,
  };
}

export const GACHA_COSTS = {
  dailyFree: {},
  credits: { credits: 500 },
  gems: { gems: 100 },
  gems10: { gems: 900 },
};

export function pullOnce(player, { gems = false, free = false, rng = null, now = trustedNow() } = {}) {
  const cost = free ? {} : gems ? GACHA_COSTS.gems : GACHA_COSTS.credits;
  if (!free && !canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  let next = player;
  if (!free) next = { ...next, wallet: pay(next.wallet, cost).wallet };
  else next = { ...next, dailyPullAvailable: false };
  const seed = hireSeed(next);
  const gacha = { ...defaultGacha(), ...(next.gacha || {}), seed };
  const banner = currentBanner(now);
  const { instance, rarity, featured } = pullMerc({
    reputation: next.wallet.reputation,
    luck: gacha.luck || 0,
    gacha,
    rng: rng || hireRng(seed, gacha.pulls || 0),
    banner,
  });
  next = { ...next, gacha: afterBannerHire(tickPity(gacha, rarity), featured) };
  const applied = applyPullToRoster(next, instance);
  const source = free ? 'daily' : gems ? 'gems' : 'credits';
  return {
    ok: true,
    player: { ...applied.player, gacha: recordPull(applied.player.gacha, applied.instance, applied.kind, source) },
    instance: applied.instance,
    rarity,
    kind: applied.kind,
    sold: applied.sold,
    featured: featured === true,
    banner,
    cost,
    free,
  };
}

export function pullTen(player, { rng = null, now = trustedNow() } = {}) {
  const cost = GACHA_COSTS.gems10;
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  let next = { ...player, wallet: pay(player.wallet, cost).wallet };
  const seed = hireSeed(next);
  const banner = currentBanner(now);
  const results = [];
  let rareHit = false;
  for (let i = 0; i < 10; i++) {
    const gacha = { ...defaultGacha(), ...(next.gacha || {}), seed };
    const minRarity = i === 9 && !rareHit ? 'rare' : null;
    const { instance, rarity, featured } = pullMerc({
      reputation: next.wallet.reputation,
      luck: gacha.luck || 0,
      gacha,
      rng: rng || hireRng(seed, gacha.pulls || 0),
      minRarity,
      banner,
    });
    if (rarityRank(rarity) >= 3) rareHit = true;
    next = { ...next, gacha: afterBannerHire(tickPity(gacha, rarity), featured) };
    const applied = applyPullToRoster(next, instance);
    next = { ...applied.player, gacha: recordPull(applied.player.gacha, applied.instance, applied.kind, 'gems10') };
    results.push({ rarity, kind: applied.kind, instance: applied.instance, sold: applied.sold, featured: featured === true });
  }
  return { ok: true, player: next, results, cost, banner };
}

/** Spend Contract Marks to hire the featured merc outright (a duplicate stars them up). */
export function redeemMarks(player, now = trustedNow()) {
  const banner = currentBanner(now);
  const star = catalogById(banner.featured);
  const cost = MARK_COST[star?.rarity];
  const g = { ...defaultGacha(), ...(player.gacha || {}) };
  if (!star || !cost) return { ok: false, reason: 'no_featured' };
  if ((g.marks || 0) < cost) return { ok: false, reason: 'not_enough_marks', cost, marks: g.marks || 0 };
  const seed = hireSeed(player);
  const instance = createCrewInstance(star.id, { rng: hireRng(seed, `marks:${g.pulls || 0}:${g.marks}`) });
  const next = { ...player, gacha: { ...g, seed, marks: g.marks - cost } };
  const applied = applyPullToRoster(next, instance);
  return {
    ok: true,
    player: { ...applied.player, gacha: recordPull(applied.player.gacha, applied.instance, applied.kind, 'marks') },
    instance: applied.instance, rarity: star.rarity, kind: applied.kind, sold: applied.sold, featured: true, banner, cost,
  };
}

/** The odds as shown to players: per-rarity chance now (before pity), the banner split and the pity counters. */
export function hireOdds(player, now = trustedNow()) {
  const g = { ...defaultGacha(), ...(player?.gacha || {}) };
  const weights = rarityWeights(player?.wallet?.reputation || 0, g.luck || 0);
  const total = Object.values(weights).reduce((sum, v) => sum + v, 0);
  const banner = currentBanner(now);
  const star = catalogById(banner.featured);
  return {
    rows: Object.entries(weights).map(([rarity, w]) => ({ rarity, pct: Math.round((w / total) * 10000) / 100 })),
    banner,
    featured: { templateId: star?.id, rarity: star?.rarity, sharePct: g.featuredGuarantee ? 100 : 50, guaranteed: Boolean(g.featuredGuarantee) },
    rateUpSharePct: 50,
    pity: { rare: { count: g.pityRare || 0, soft: PITY.rareSoft, hard: PITY.rareHard },
      legendary: { count: g.pityLegend || 0, soft: PITY.legendSoft, hard: PITY.legendHard } },
    marks: { have: g.marks || 0, cost: MARK_COST[star?.rarity] || null },
  };
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
  if ((c.level || 1) >= levelCap(c)) return { ok: false, reason: 'level_cap', cap: levelCap(c) };
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

/** The next Ascension step for a crew member, what it costs, and why it is not open yet. */
export function ascensionStatus(crew, wallet = {}) {
  const tier = crew?.ascension || 0;
  const next = ASCENSION[tier + 1] || null;
  if (!next) return { next: null, reason: 'max' };
  const reason = (crew.stars || 1) < 5 ? 'needs_5_stars' : (crew.shards || 0) < next.shards ? 'needs_shards'
    : (wallet.medals || 0) < next.medals ? 'needs_medals' : null;
  return { next, reason, shards: crew.shards || 0 };
}

/** Ascend: a 5-star merc spends shards and medals to reach the next tier. */
export function ascendCrew(player, instanceId) {
  const c = (player.crew || []).find((x) => x.instanceId === instanceId);
  if (!c) return { ok: false, reason: 'missing' };
  const status = ascensionStatus(c, player.wallet);
  if (!status.next) return { ok: false, reason: 'max_ascension' };
  if (status.reason) return { ok: false, reason: status.reason, cost: { medals: status.next.medals, shards: status.next.shards } };
  const next = recomputeCrew({ ...c, ascension: Math.min(MAX_ASCENSION, (c.ascension || 0) + 1), shards: (c.shards || 0) - status.next.shards });
  return {
    ok: true,
    player: { ...player, wallet: pay(player.wallet, { medals: status.next.medals }).wallet,
      crew: player.crew.map((x) => (x.instanceId === instanceId ? next : x)) },
    crew: next,
    tier: ASCENSION[next.ascension],
  };
}

export { RARITY, CREW_CATALOG, sellContract, rarityRank };
