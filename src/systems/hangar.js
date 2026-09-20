// @ts-nocheck
import { SHIPS, getShipDef, SHIP_SYSTEMS } from '../data/ships.js';
import { canAfford, pay, upgradeCost, grant, sellContract, clampFuel } from './economy.js';
import { DEFAULT_FUEL_CONFIG } from './fuel.js';
import { RESERVE_CAP } from './gacha.js';

const ZERO_START = new Set(['quarters', 'sensors', 'medbay']);

export function listOwnedHulls(player) {
  const owned = player.ship?.ownedHulls || [player.ship?.shipId || 'sparrow'];
  return owned;
}

export function canBuyHull(player, shipId) {
  const def = SHIPS[shipId];
  if (!def || shipId === 'sparrow') return { ok: false, reason: 'invalid' };
  const owned = listOwnedHulls(player);
  if (owned.includes(shipId)) return { ok: false, reason: 'owned' };
  if (def.lockedUntilChapter && (player.story?.chapter || 0) < def.lockedUntilChapter) {
    return { ok: false, reason: 'chapter_lock', need: def.lockedUntilChapter };
  }
  if (def.lockedUntilRep && (player.wallet?.reputation || 0) < def.lockedUntilRep) {
    return { ok: false, reason: 'rep_lock', need: def.lockedUntilRep };
  }
  if (def.requiresHull && !owned.includes(def.requiresHull)) {
    return { ok: false, reason: 'hull_lock', need: def.requiresHull };
  }
  return { ok: true, def };
}

export function berthsFor(player, def, { fillBase = false } = {}) {
  const hull = def || getShipDef(player.ship?.shipId || 'sparrow');
  const q = player.ship?.systems?.quarters || 0;
  const floor = fillBase ? (hull.crewSlots || 2) : 2;
  return Math.min(
    hull.maxCrewSlots,
    Math.max(player.crewSlots || 2, floor, 2 + q)
  );
}

export function fuelMaxFor(player, def) {
  const hull = def || getShipDef(player.ship?.shipId || 'sparrow');
  const engines = player.ship?.systems?.engines || 1;
  const engineBonus = Math.floor(Math.max(0, engines) / 2);
  return DEFAULT_FUEL_CONFIG.startingMax + (hull.fuelMaxBonus || 0) + engineBonus;
}

export function fuelRateFor(player, def) {
  const hull = def || getShipDef(player.ship?.shipId || 'sparrow');
  return Number((DEFAULT_FUEL_CONFIG.ratePerHour + (hull.fuelBonus || 0) * 0.15).toFixed(2));
}

/** Park extra mercs into reserve when berths shrink. Reserve full → sell. Keep expedition crews aboard. */
export function parkOverflowToReserve(player, slots, reserveCap = RESERVE_CAP) {
  const crew = [...(player.crew || [])];
  const reserve = [...(player.reserve || [])];
  const sold = [];
  const granted = {};
  if (crew.length <= slots) {
    return { player: { ...player, crew, reserve, crewSlots: slots }, sold, granted };
  }
  const flying = crew.filter((c) => c.status === 'expedition');
  const rest = crew
    .filter((c) => c.status !== 'expedition')
    .sort((a, b) => (b.power || 0) - (a.power || 0));
  const room = Math.max(0, slots - flying.length);
  const keep = [...flying, ...rest.slice(0, room)];
  const overflow = rest.slice(room);
  for (const c of overflow) {
    if (reserve.length < reserveCap) {
      reserve.push({ ...c, status: 'reserve' });
    } else {
      const payOut = sellContract(c.rarity);
      sold.push({ name: c.name, rarity: c.rarity, sold: payOut });
      for (const [k, v] of Object.entries(payOut)) {
        granted[k] = (granted[k] || 0) + (v || 0);
      }
    }
  }
  const wallet = Object.keys(granted).length ? grant(player.wallet, granted) : player.wallet;
  return {
    player: { ...player, crew: keep, reserve, crewSlots: Math.max(slots, flying.length), wallet },
    sold,
    granted,
  };
}

function applyHullStats(player, def) {
  const fuelMax = fuelMaxFor(player, def);
  const fuelRatePerHour = fuelRateFor(player, def);
  const wallet = clampFuel(player.wallet || {}, fuelMax);
  return { ...player, fuelMax, fuelRatePerHour, wallet };
}

/** currency: 'gems' | 'credits' */
export function buyHull(player, shipId, currency = 'gems') {
  const check = canBuyHull(player, shipId);
  if (!check.ok) return { ok: false, reason: check.reason, need: check.need };

  const def = check.def;
  const cost =
    currency === 'gems'
      ? { gems: def.gemPrice }
      : { credits: def.creditPrice };

  if (cost.gems == null && currency === 'gems') return { ok: false, reason: 'no_gem_price' };
  if (cost.credits == null && currency === 'credits') return { ok: false, reason: 'no_credit_price' };
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };

  const paid = pay(player.wallet, cost);
  const owned = [...listOwnedHulls(player), shipId];
  const ship = {
    ...player.ship,
    shipId,
    ownedHulls: owned,
    systems: { ...(player.ship.systems || {}) },
  };
  let next = {
    ...player,
    wallet: paid.wallet,
    ship,
    crewSlots: berthsFor({ ...player, ship }, def, { fillBase: true }),
  };
  next = applyHullStats(next, def);

  return {
    ok: true,
    player: next,
    def,
  };
}

export function switchHull(player, shipId) {
  const owned = listOwnedHulls(player);
  if (!owned.includes(shipId)) return { ok: false, reason: 'not_owned' };
  const def = getShipDef(shipId);
  const ship = { ...player.ship, shipId };
  const slots = berthsFor({ ...player, ship }, def, { fillBase: true });
  const parked = parkOverflowToReserve({ ...player, ship }, slots);
  const next = applyHullStats(parked.player, def);
  return {
    ok: true,
    player: next,
    def,
    sold: parked.sold,
    granted: parked.granted,
    parked: Math.max(0, (player.crew || []).length - (next.crew || []).length - parked.sold.length),
  };
}

/** Cost exponent: 0-start systems charge base for 0→1, then scale. 1-start (engines) first buy is base. */
export function upgradeFromLevel(system, level) {
  const lv = Number(level) || 0;
  if (ZERO_START.has(system)) return Math.max(1, lv + 1);
  return Math.max(1, lv);
}

export function nextUpgradeCost(player, system) {
  const def = getShipDef(player.ship.shipId);
  const costs = def.upgradeCosts || SHIPS.sparrow.upgradeCosts;
  if (!costs?.[system]) return null;
  const level = player.ship?.systems?.[system] || 0;
  if (system === 'quarters' && (player.crewSlots || 0) >= def.maxCrewSlots) {
    return null;
  }
  const from = upgradeFromLevel(system, level);
  return { credits: upgradeCost(costs[system].credits || 0, from), level: Math.max(level, 0) };
}

export function upgradeSystem(player, system) {
  const def = getShipDef(player.ship.shipId);
  const costs = def.upgradeCosts || SHIPS.sparrow.upgradeCosts;
  if (!costs?.[system]) return { ok: false, reason: 'no_upgrade' };
  const level = player.ship?.systems?.[system] || 0;
  if (system === 'quarters' && (player.crewSlots || 0) >= def.maxCrewSlots) {
    return { ok: false, reason: 'max_berths' };
  }
  const from = upgradeFromLevel(system, level);
  const base = costs[system];
  const cost = { credits: upgradeCost(base.credits || 0, from) };
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };

  const systems = { ...(player.ship.systems || {}) };
  systems[system] = (level || 0) + 1;
  if (systems[system] < 1) systems[system] = 1;

  let crewSlots = player.crewSlots;
  if (system === 'quarters') {
    crewSlots = Math.min(def.maxCrewSlots, crewSlots + 1);
  }

  let next = {
    ...player,
    wallet: pay(player.wallet, cost).wallet,
    ship: { ...player.ship, systems },
    crewSlots,
  };
  next = applyHullStats(next, def);

  return {
    ok: true,
    player: next,
    cost,
    nextLevel: systems[system],
  };
}

export { SHIP_SYSTEMS };
