// @ts-nocheck
import {
  PRODUCT_CATALOG,
  PASS_PREMIUM,
  MEMBER_DAILY,
  MEMBERSHIP_MS,
  SEASON_ID,
} from '../data/monetization.js';
import { grant, clampFuel } from './economy.js';
import { weekGoals } from './tutorial.js';
import { runPulls } from './gacha.js';

function shopDayKey(now = Date.now()) {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function defaultShop() {
  return {
    firstPurchase: false,
    lifetimeUsd: 0,
    membershipUntil: 0,
    memberClaimDay: null,
    passSeason: SEASON_ID,
    passPremium: false,
    passClaimed: [],
    dailyDay: null,
    dailyBought: [],
    boughtOnce: [],
  };
}

export function shopState(player) {
  return { ...defaultShop(), ...(player.shop || {}) };
}

export function isMember(player, now = Date.now()) {
  return (shopState(player).membershipUntil || 0) > now;
}

export function memberDaysLeft(player, now = Date.now()) {
  const until = shopState(player).membershipUntil || 0;
  if (until <= now) return 0;
  return Math.max(1, Math.ceil((until - now) / 86400000));
}

function applyWallet(player, table) {
  let wallet = grant(player.wallet, table);
  if (table.fuel) wallet = clampFuel(wallet, player.fuelMax ?? 10);
  return { ...player, wallet };
}

function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function dailySalesFor(player, now = Date.now()) {
  const day = shopDayKey(now);
  const shop = shopState(player);
  const bought = shop.dailyDay === day ? shop.dailyBought : [];
  const seed = hash01(day + (player.captainName || 'c'));
  const gemPrice = 35 + Math.floor(seed * 25);
  return [
    {
      id: 'fuel_deal',
      name: 'Fuel on sale',
      blurb: '+6 fuel',
      cost: { gems: gemPrice },
      grant: { fuel: 6 },
      bought: bought.includes('fuel_deal'),
    },
    {
      id: 'medal_deal',
      name: 'Medal crate',
      blurb: '+18 medals',
      cost: { gems: 50 + Math.floor(seed * 20) },
      grant: { medals: 18 },
      bought: bought.includes('medal_deal'),
    },
    {
      id: 'credit_deal',
      name: 'Payroll drop',
      blurb: '+350 credits',
      cost: { gems: 25 },
      grant: { credits: 350 },
      bought: bought.includes('credit_deal'),
    },
  ];
}

export function shopHasBadge(player, now = Date.now()) {
  const shop = shopState(player);
  if (!(shop.boughtOnce || []).includes('wc_captain')) return true;
  if (dailySalesFor(player, now).some((o) => !o.bought)) return true;
  const specialBought = shop.dailyDay === shopDayKey(now) && (shop.dailyBought || []).includes('wc_daily_special');
  return !specialBought;
}

export function buyGemDeal(player, offerId, now = Date.now()) {
  const offers = dailySalesFor(player, now);
  const offer = offers.find((o) => o.id === offerId);
  if (!offer || offer.bought) return { ok: false, reason: 'sold_out', player };
  const wallet = player.wallet || {};
  for (const [k, v] of Object.entries(offer.cost)) {
    if ((wallet[k] || 0) < v) return { ok: false, reason: 'cannot_afford', player };
  }
  let nextWallet = { ...wallet };
  for (const [k, v] of Object.entries(offer.cost)) nextWallet[k] -= v;
  const granted = applyWallet({ ...player, wallet: nextWallet }, offer.grant);
  const shop = shopState(player);
  const day = shopDayKey(now);
  const bought = shop.dailyDay === day ? [...shop.dailyBought] : [];
  bought.push(offerId);
  return {
    ok: true,
    player: { ...granted, shop: { ...shop, dailyDay: day, dailyBought: bought } },
  };
}

export function fulfillSku(player, sku, now = Date.now()) {
  const def = PRODUCT_CATALOG[sku];
  if (!def) return { ok: false, reason: 'unknown_sku', player };
  let shop = shopState(player);
  if (def.once && shop.boughtOnce.includes(sku)) {
    return { ok: false, reason: 'already_owned', player };
  }
  if (def.lane === 'daily') {
    const day = shopDayKey(now);
    const bought = shop.dailyDay === day ? [...shop.dailyBought] : [];
    if (bought.includes(sku)) return { ok: false, reason: 'sold_out', player };
    shop = { ...shop, dailyDay: day, dailyBought: [...bought, sku] };
  }

  let next = player;
  let pulled = [];
  const doubleFirst = !shop.firstPurchase && def.lane === 'gems' && def.grant?.gems;
  const grantTable = { ...(def.grant || {}) };
  if (doubleFirst) grantTable.gems = (grantTable.gems || 0) * 2;
  if (Object.keys(grantTable).length) next = applyWallet(next, grantTable);

  if (def.extra === 'membership') {
    const base = Math.max(now, shop.membershipUntil || 0);
    shop = { ...shop, membershipUntil: base + MEMBERSHIP_MS };
  }
  if (def.extra === 'pass') {
    shop = { ...shop, passSeason: SEASON_ID, passPremium: true };
  }
  if (def.extra === 'rare_pull') {
    const res = runPulls(next, 1, { guaranteedRarity: 'rare' });
    next = res.player;
    pulled = res.pulled;
  }
  if (def.extra === 'pulls_10') {
    const res = runPulls(next, 10);
    next = res.player;
    pulled = res.pulled;
  }
  if (def.once) shop = { ...shop, boughtOnce: [...shop.boughtOnce, sku] };
  shop = {
    ...shop,
    firstPurchase: shop.firstPurchase || def.lane === 'gems',
    lifetimeUsd: (shop.lifetimeUsd || 0) + (def.usd || 0),
  };
  next = { ...next, shop };
  if (def.extra === 'membership') {
    const mem = claimMembershipDay(next, now);
    next = mem.player;
  }
  if (next.shop?.passPremium) next = collectPassRewards(next).player;
  return { ok: true, player: next, doubled: Boolean(doubleFirst), pulled };
}

export function claimMembershipDay(player, now = Date.now()) {
  if (!isMember(player, now)) return { player, claimed: false };
  const shop = shopState(player);
  const today = shopDayKey(now);
  if (shop.memberClaimDay === today) return { player, claimed: false };
  const next = applyWallet(player, MEMBER_DAILY);
  return {
    player: { ...next, shop: { ...shop, memberClaimDay: today } },
    claimed: true,
    grant: MEMBER_DAILY,
  };
}

export function collectPassRewards(player) {
  const shop = shopState(player);
  if (!shop.passPremium) return { player, gained: {} };
  const goals = weekGoals(player).goals;
  const claimed = new Set(shop.passClaimed || []);
  const gained = {};
  for (const g of goals) {
    if (!g.done || claimed.has(g.id)) continue;
    const r = PASS_PREMIUM[g.id];
    if (!r) continue;
    claimed.add(g.id);
    for (const [k, v] of Object.entries(r)) gained[k] = (gained[k] || 0) + v;
  }
  if (!Object.keys(gained).length) return { player, gained: {} };
  const next = applyWallet(player, gained);
  return {
    player: { ...next, shop: { ...shop, passClaimed: [...claimed] } },
    gained,
  };
}

export function shopCatalog() {
  return Object.values(PRODUCT_CATALOG);
}
