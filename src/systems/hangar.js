// @ts-nocheck
import { SHIPS, getShipDef, SHIP_SYSTEMS } from '../data/ships.js';
import { canAfford, pay, upgradeCost, grant, sellContract, clampFuel } from './economy.js';
import { DEFAULT_FUEL_CONFIG } from './fuel.js';
import { SUBSCRIPTION_DEFS } from '../data/products.js';
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
  // Captain's Commission (verified entitlement) adds tank space.
  const commissionBonus = player.commission?.active ? SUBSCRIPTION_DEFS.wc_sub_commission.perks.fuelMaxBonus
    // After a lapse, only tank space still holding fuel is kept (see syncCommission).
    : Math.max(0, Math.min(SUBSCRIPTION_DEFS.wc_sub_commission.perks.fuelMaxBonus, player.commission?.heldFuelBonus || 0));
  return DEFAULT_FUEL_CONFIG.startingMax + (hull.fuelMaxBonus || 0) + engineBonus + commissionBonus;
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
  const protectedCrew = crew.filter((c) => c.status === 'expedition'
    || c.instanceId === player.captainInstanceId || c.isCaptain);
  const rest = crew
    .filter((c) => !protectedCrew.includes(c))
    .sort((a, b) => (b.power || 0) - (a.power || 0));
  const room = Math.max(0, slots - protectedCrew.length);
  const keep = [...protectedCrew, ...rest.slice(0, room)];
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
    player: { ...player, crew: keep, reserve, crewSlots: Math.max(slots, protectedCrew.length), wallet },
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

/** Levels 1-3 are instant; higher levels build in the drydock over real time. */
export const UPGRADE_BUILD = Object.freeze({ instantThrough: 3, minutes: { 4: 30, 5: 60, 6: 120, 7: 240 }, maxMinutes: 480 });

export function buildMinutesFor(targetLevel) {
  if (targetLevel <= UPGRADE_BUILD.instantThrough) return 0;
  return UPGRADE_BUILD.minutes[targetLevel] ?? UPGRADE_BUILD.maxMinutes;
}

/** About ten gems per remaining hour, never less than five. */
export function buildSkipGems(remainingMs) {
  return Math.max(5, Math.ceil(Math.max(0, remainingMs) / 360000));
}

function applyLevel(player, system) {
  const def = getShipDef(player.ship.shipId);
  const level = player.ship?.systems?.[system] || 0;
  const systems = { ...(player.ship.systems || {}) };
  systems[system] = Math.max(1, (level || 0) + 1);
  let crewSlots = player.crewSlots;
  if (system === 'quarters') crewSlots = Math.min(def.maxCrewSlots, crewSlots + 1);
  return applyHullStats({ ...player, ship: { ...player.ship, systems }, crewSlots }, def);
}

export function upgradeSystem(player, system, now = Date.now()) {
  const def = getShipDef(player.ship.shipId);
  const costs = def.upgradeCosts || SHIPS.sparrow.upgradeCosts;
  if (!costs?.[system]) return { ok: false, reason: 'no_upgrade' };
  if (player.shipBuild) return { ok: false, reason: 'drydock_busy', build: player.shipBuild };
  const level = player.ship?.systems?.[system] || 0;
  if (system === 'quarters' && (player.crewSlots || 0) >= def.maxCrewSlots) {
    return { ok: false, reason: 'max_berths' };
  }
  const from = upgradeFromLevel(system, level);
  const base = costs[system];
  const cost = { credits: upgradeCost(base.credits || 0, from) };
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  const targetLevel = Math.max(1, (level || 0) + 1);
  const minutes = buildMinutesFor(targetLevel);
  const paid = { ...player, wallet: pay(player.wallet, cost).wallet };
  if (minutes > 0) {
    const shipBuild = { system, targetLevel, startedAt: now, endAt: now + minutes * 60000 };
    return { ok: true, player: { ...paid, shipBuild }, cost, nextLevel: targetLevel, build: shipBuild };
  }
  return { ok: true, player: applyLevel(paid, system), cost, nextLevel: targetLevel };
}

/** Finish a build whose timer has run out; idempotent otherwise. */
export function completeShipBuild(player, now = Date.now()) {
  const build = player?.shipBuild;
  if (!build || build.endAt > now) return { player, completed: null };
  const done = applyLevel({ ...player, shipBuild: null }, build.system);
  return { player: done, completed: build };
}

export function skipShipBuild(player, now = Date.now()) {
  const build = player?.shipBuild;
  if (!build) return { ok: false, reason: 'no_build' };
  // Drydock finish tokens (from wall packs) are spent before gems.
  if ((player.drydockFinishes || 0) > 0) {
    const paid = { ...player, drydockFinishes: player.drydockFinishes - 1 };
    return { ok: true, gems: 0, token: true, ...completeShipBuild(paid, Math.max(now, build.endAt)) };
  }
  const gems = buildSkipGems(build.endAt - now);
  if ((player.wallet?.gems || 0) < gems) return { ok: false, reason: 'not_enough_gems', gems };
  const paid = { ...player, wallet: { ...player.wallet, gems: player.wallet.gems - gems } };
  return { ok: true, gems, ...completeShipBuild(paid, Math.max(now, build.endAt)) };
}

export { SHIP_SYSTEMS };
