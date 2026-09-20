// @ts-nocheck
import { getShipDef } from '../data/ships.js';

export const CURRENCIES = {
  credits: { id: 'credits', name: 'Credits', soft: true },
  fuel: { id: 'fuel', name: 'Fuel', energy: true },
  gems: { id: 'gems', name: 'Gems', premium: true },
  medals: { id: 'medals', name: 'Medals', soft: true },
  reputation: { id: 'reputation', name: 'Reputation', meta: true },
};

/** Credits per 1 fuel at a dock (before rank cut). */
export const FUEL_CREDIT_PRICE = 45;

export const REP_RANKS = [
  { min: 0, id: 'unknown', label: 'Unknown', fuelCut: 0 },
  { min: 100, id: 'local', label: 'Local name', fuelCut: 0 },
  { min: 300, id: 'known', label: 'Known crew', fuelCut: 3 },
  { min: 600, id: 'respected', label: 'Respected', fuelCut: 6 },
  { min: 1000, id: 'famous', label: 'Famous', fuelCut: 10 },
  { min: 2000, id: 'legendary', label: 'Legendary', fuelCut: 15 },
  { min: 3500, id: 'eclipse', label: 'Eclipse-known', fuelCut: 18 },
  { min: 5500, id: 'halo', label: 'Halo-weight', fuelCut: 22 },
];

export function reputationRank(rep = 0) {
  let row = REP_RANKS[0];
  for (const r of REP_RANKS) {
    if ((rep || 0) >= r.min) row = r;
  }
  return row;
}

export function fuelCreditPrice(player) {
  const cut = reputationRank(player?.wallet?.reputation).fuelCut || 0;
  return Math.max(28, FUEL_CREDIT_PRICE - cut);
}

export function canAfford(wallet, cost) {
  for (const [k, v] of Object.entries(cost || {})) {
    if ((wallet[k] ?? 0) < v) return false;
  }
  return true;
}

export function pay(wallet, cost) {
  if (!canAfford(wallet, cost)) return { ok: false, wallet };
  const next = { ...wallet };
  for (const [k, v] of Object.entries(cost || {})) {
    next[k] = (next[k] ?? 0) - v;
  }
  return { ok: true, wallet: next };
}

export function grant(wallet, reward) {
  const next = { ...wallet };
  for (const [k, v] of Object.entries(reward || {})) {
    if (!v) continue;
    next[k] = (next[k] ?? 0) + v;
  }
  return next;
}

export function clampFuel(wallet, maxFuel) {
  return { ...wallet, fuel: Math.min(maxFuel, Math.max(0, wallet.fuel ?? 0)) };
}

export function cargoMult(player) {
  const lv = player?.ship?.systems?.cargo || 1;
  return 1 + Math.max(0, lv - 1) * 0.08;
}

export function reputationTradeMult(rep = 0) {
  return 1 + Math.min(0.3, (rep || 0) / 2500);
}

export function visitMult(visits = 0) {
  return Math.max(0.72, 1 - Math.max(0, visits) * 0.06);
}

export function engineFuelCut(player) {
  const lv = player?.ship?.systems?.engines || 1;
  return Math.max(0, (lv - 1) * 0.35);
}

/** Scale a site/expedition payout by hull, reputation, and how many times you've been. */
export function scaleSitePayout(base, player, { kind = 'trade', visits = 0 } = {}) {
  const cargo = cargoMult(player);
  const rep = reputationTradeMult(player?.wallet?.reputation);
  const visit = visitMult(visits);
  const hull = getShipDef(player?.ship?.shipId);
  let credits = base?.credits || 0;
  let medals = base?.medals || 0;
  let reputation = base?.reputation || 0;
  const gems = base?.gems || 0;
  const fuel = base?.fuel || 0;

  if (kind === 'trade' || kind === 'delivery') {
    credits = Math.floor(credits * cargo * rep * (1 + (hull.tradeBias || 0)));
  } else if (kind === 'salvage') {
    credits = Math.floor(credits * (1 + (cargo - 1) * 0.5));
    medals = Math.floor(medals * (1 + Math.max(0, (player?.ship?.systems?.cargo || 1) - 1) * 0.04));
  } else if (kind === 'combat') {
    credits = Math.floor(credits * (1 + Math.max(0, (player?.ship?.systems?.weapons || 1) - 1) * 0.05));
  } else if (kind === 'expedition') {
    credits = Math.floor(credits * (1 + (cargo - 1) * 0.4));
  }

  credits = Math.floor(credits * visit);
  return { credits, medals, reputation, gems, fuel };
}

export function hullRepairOffer(player) {
  const hull = player?.ship?.hull ?? 100;
  const missing = Math.max(0, 100 - hull);
  if (!missing) return null;
  const amount = Math.min(missing, 25);
  const cost = Math.max(20, Math.round(amount * 1.4));
  return { amount, cost, missing };
}

export function upgradeCost(baseCredits, level = 1) {
  return Math.floor((baseCredits || 0) * Math.pow(1.22, Math.max(0, level - 1)));
}

export function systemBlurb(system, level = 1) {
  const lv = Math.max(0, Number(level) || 0);
  const shown = Math.max(system === 'quarters' || system === 'sensors' || system === 'medbay' ? 0 : 1, lv);
  if (system === 'cargo') return `Trade +${(shown - 1) * 8}% · salvage & expeditions scale`;
  if (system === 'engines') return `Jump fuel −${((shown - 1) * 0.35).toFixed(1)} (min 40%) · even lv +1 tank`;
  if (system === 'weapons') return `Combat +${(shown - 1) * 4} power · loot +${(shown - 1) * 5}%`;
  if (system === 'shields') return `Combat hull loss −${Math.round(shown * 1.5)} (win always −3)`;
  if (system === 'quarters') return shown >= 1 ? `Adds one crew berth (up to hull max)` : 'Adds one crew berth (up to hull max)';
  if (system === 'sensors') return `Expedition +${shown * 2}% · lv 3 reveals sites a day early`;
  if (system === 'medbay') return `Injury time −${shown * 8}%`;
  return '';
}

export function formatReward(r = {}) {
  const bits = [];
  if (r.credits) bits.push(`${r.credits}cr`);
  if (r.medals) bits.push(`${r.medals} med`);
  if (r.reputation) bits.push(`${r.reputation} rep`);
  if (r.gems) bits.push(`${r.gems}g`);
  if (r.fuel) bits.push(`${r.fuel}F`);
  return bits.join(' · ') || '';
}

export function sellContract(rarity = 'common') {
  const table = {
    common: { credits: 50, medals: 2 },
    uncommon: { credits: 80, medals: 4 },
    rare: { credits: 140, medals: 8 },
    epic: { credits: 220, medals: 14 },
    legendary: { credits: 400, medals: 24 },
    mythic: { credits: 700, medals: 40 },
    apex: { credits: 1200, medals: 64 },
  };
  return table[rarity] || table.common;
}
