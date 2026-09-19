// @ts-nocheck
import { regenAmount, MS_PER_HOUR } from '../shared/timer.js';
import { clampFuel } from './economy.js';
import { isMember } from './shop.js';
import { MEMBER_FUEL_MULT } from '../data/monetization.js';

export const DEFAULT_FUEL_CONFIG = {
  ratePerHour: 1,
  startingMax: 10,
  startingFuel: 8,
};

function fuelRate(player, now = Date.now()) {
  const base = player.fuelRatePerHour ?? DEFAULT_FUEL_CONFIG.ratePerHour;
  return isMember(player, now) ? base * MEMBER_FUEL_MULT : base;
}

/**
 * Claim offline fuel regen into wallet.
 * Mutates conceptually: returns new wallet + fuelState.
 */
export function claimFuelRegen(player, now = Date.now()) {
  const max = player.fuelMax ?? DEFAULT_FUEL_CONFIG.startingMax;
  const current = player.wallet?.fuel ?? 0;
  const last = player.fuelClaimAt ?? now;
  const rate = fuelRate(player, now);
  const { gained, nextAt } = regenAmount({
    lastClaimAt: last,
    ratePerHour: rate,
    max,
    current,
    now,
  });
  // Only claim whole units for clean UX
  const whole = Math.floor(gained);
  if (whole <= 0) {
    return {
      player: {
        ...player,
        // Keep last claim; fractional is recomputed each time from last whole claim.
      },
      gained: 0,
      nextFuelAt: nextAt,
    };
  }
  const msPerUnit = MS_PER_HOUR / rate;
  const newClaimAt = last + whole * msPerUnit;
  let wallet = { ...player.wallet, fuel: current + whole };
  wallet = clampFuel(wallet, max);
  return {
    player: { ...player, wallet, fuelClaimAt: newClaimAt },
    gained: whole,
    nextFuelAt: newClaimAt + msPerUnit,
  };
}

export function spendFuel(player, amount = 1) {
  const fuel = player.wallet?.fuel ?? 0;
  if (fuel < amount) return { ok: false, player, reason: 'not_enough_fuel' };
  const wallet = { ...player.wallet, fuel: fuel - amount };
  return { ok: true, player: { ...player, wallet } };
}

export function fuelStatus(player, now = Date.now()) {
  const max = player.fuelMax ?? DEFAULT_FUEL_CONFIG.startingMax;
  const current = player.wallet?.fuel ?? 0;
  const rate = fuelRate(player, now);
  const last = player.fuelClaimAt ?? now;
  const { gained, nextAt } = regenAmount({
    lastClaimAt: last,
    ratePerHour: rate,
    max,
    current,
    now,
  });
  return {
    current,
    max,
    ratePerHour: rate,
    member: isMember(player, now),
    pendingWhole: Math.floor(gained),
    nextUnitAt: nextAt,
    isFull: current >= max,
  };
}
