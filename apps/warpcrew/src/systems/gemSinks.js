// @ts-nocheck
/** In-game gem spends that solve a problem the player can see. */
import { clampFuel } from './economy.js';

export const FUEL_REFILL = Object.freeze({ gems: 50, fuel: 5 });
export const RALLY = Object.freeze({ gems: 60, hull: 12, nearMissPct: 0.2 });

export function refuelWithGems(player) {
  const max = player.fuelMax ?? 10;
  // Only sell a full refill: never charge 50 gems for fuel the tank cannot hold.
  if (max - (player.wallet?.fuel || 0) < FUEL_REFILL.fuel) return { ok: false, reason: 'fuel_full' };
  if ((player.wallet?.gems || 0) < FUEL_REFILL.gems) return { ok: false, reason: 'not_enough_gems', gems: FUEL_REFILL.gems };
  const wallet = clampFuel({ ...player.wallet, gems: player.wallet.gems - FUEL_REFILL.gems, fuel: player.wallet.fuel + FUEL_REFILL.fuel }, max);
  return { ok: true, player: { ...player, wallet }, gems: FUEL_REFILL.gems };
}
