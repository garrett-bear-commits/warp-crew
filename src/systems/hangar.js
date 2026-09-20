// @ts-nocheck
import { SHIPS, getShipDef, SHIP_SYSTEMS } from '../data/ships.js';
import { canAfford, pay, upgradeCost } from './economy.js';

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

  return {
    ok: true,
    player: {
      ...player,
      wallet: paid.wallet,
      ship,
      crewSlots: Math.max(player.crewSlots || 2, def.crewSlots),
      fuelMax: (player.fuelMax || 10) + (def.fuelMaxBonus || 0),
    },
    def,
  };
}

export function switchHull(player, shipId) {
  const owned = listOwnedHulls(player);
  if (!owned.includes(shipId)) return { ok: false, reason: 'not_owned' };
  const def = getShipDef(shipId);
  return {
    ok: true,
    player: {
      ...player,
      ship: { ...player.ship, shipId },
      crewSlots: Math.max(player.crewSlots, def.crewSlots),
    },
  };
}

export function nextUpgradeCost(player, system) {
  const def = getShipDef(player.ship.shipId);
  const costs = def.upgradeCosts || SHIPS.sparrow.upgradeCosts;
  if (!costs?.[system]) return null;
  const level = player.ship?.systems?.[system] || (SHIP_SYSTEMS.includes(system) ? 0 : 1);
  const lv = Math.max(1, level || 1);
  return { credits: upgradeCost(costs[system].credits || 0, lv), level: lv };
}

export function upgradeSystem(player, system) {
  const def = getShipDef(player.ship.shipId);
  const costs = def.upgradeCosts || SHIPS.sparrow.upgradeCosts;
  if (!costs?.[system]) return { ok: false, reason: 'no_upgrade' };
  const level = player.ship?.systems?.[system] || 0;
  const from = Math.max(1, level || 1);
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

  let fuelMax = player.fuelMax || 10;
  if (system === 'engines' && systems.engines % 2 === 0) {
    fuelMax += 1;
  }

  return {
    ok: true,
    player: {
      ...player,
      wallet: pay(player.wallet, cost).wallet,
      ship: { ...player.ship, systems },
      crewSlots,
      fuelMax,
    },
    cost,
    nextLevel: systems[system],
  };
}
