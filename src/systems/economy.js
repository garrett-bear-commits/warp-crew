/** Currency & economy helpers for Warp Crew */

export const CURRENCIES = {
  credits: { id: 'credits', name: 'Credits', soft: true },
  fuel: { id: 'fuel', name: 'Fuel', energy: true },
  gems: { id: 'gems', name: 'Gems', premium: true },
  medals: { id: 'medals', name: 'Medals', soft: true },
  reputation: { id: 'reputation', name: 'Reputation', meta: true },
};

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
    next[k] = (next[k] ?? 0) + v;
  }
  return next;
}

export function clampFuel(wallet, maxFuel) {
  return { ...wallet, fuel: Math.min(maxFuel, Math.max(0, wallet.fuel ?? 0)) };
}
