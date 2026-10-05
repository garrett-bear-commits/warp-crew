// The one place a reward reaches the player. Every grant Warp Crew applies (a purchase delivered
// by the core server, a support or cohort grant, a local-mock purchase with no server) goes
// through applyGrantRewards, and its vocabulary is exactly apps/server/games/warpcrew/grants.ts:
// gems (premium), credits, medals and fuel (soft currencies) and drydock finishes (an item).
// apps/server/test/unit/warpcrew-client-parity.test.ts keeps the two lists equal.
import { grant as addToWallet, clampFuel } from '../systems/economy.js';
import { PRODUCT_DEFS } from '../data/products.js';

/** The grant reward kinds this client applies, as `kind[:currency|itemId]`. */
export const GRANT_KINDS = Object.freeze([
  'premium_currency',
  'soft_currency:credits',
  'soft_currency:medals',
  'soft_currency:fuel',
  'item:drydockFinishes',
]);

/** @param {{kind: string, currency?: string, itemId?: string}} r */
export const grantKindOf = (r) =>
  r.kind === 'soft_currency' ? `soft_currency:${r.currency}` : r.kind === 'item' ? `item:${r.itemId}` : r.kind;

/**
 * A products.js grant table as core grant rewards (the shape the server mints).
 * @param {Record<string, number>} table
 */
export function rewardsFromTable(table) {
  const out = [];
  for (const [key, amount] of Object.entries(table || {})) {
    if (!(amount > 0)) continue;
    if (key === 'gems') out.push({ kind: 'premium_currency', amount });
    else if (key === 'drydockFinishes') out.push({ kind: 'item', itemId: 'drydockFinishes', qty: amount });
    else out.push({ kind: 'soft_currency', currency: key, amount });
  }
  return out;
}

/** The one-time SKU a purchase grant delivers (`reason: "purchase <sku>"`), or null. */
export function oneTimeSkuOf(grant) {
  const m = /^purchase (wc_[a-z0-9_]+)$/.exec(String(grant?.reason || ''));
  return m && PRODUCT_DEFS[m[1]]?.oneTime ? m[1] : null;
}

/**
 * Apply grant rewards to a player. Pure. Rewards outside the vocabulary are returned in
 * `unknown` and change nothing (the server refuses to mint them, so one here is a bug to report).
 * @param {object} player
 * @param {Array<{kind: string, amount?: number, qty?: number, currency?: string, itemId?: string}>} rewards
 * @param {{ oneTimeSku?: string | null }} [opts]
 * @returns {{ player: object, applied: Record<string, number>, unknown: string[] }}
 */
export function applyGrantRewards(player, rewards, { oneTimeSku = null } = {}) {
  const wallet = {};
  let finishes = 0;
  const unknown = [];
  for (const r of rewards || []) {
    const kind = r && typeof r === 'object' ? grantKindOf(r) : String(r);
    const n = Math.max(0, Math.floor(Number(r?.kind === 'item' ? r.qty : r?.amount) || 0));
    if (kind === 'premium_currency') wallet.gems = (wallet.gems || 0) + n;
    else if (kind === 'soft_currency:credits' || kind === 'soft_currency:medals' || kind === 'soft_currency:fuel') {
      wallet[r.currency] = (wallet[r.currency] || 0) + n;
    } else if (kind === 'item:drydockFinishes') finishes += n;
    else unknown.push(kind);
  }
  let nextWallet = addToWallet(player.wallet, wallet);
  if (wallet.fuel) nextWallet = clampFuel(nextWallet, player.fuelMax ?? 10);
  const owned = player.oneTimePurchases || [];
  const own = oneTimeSku && PRODUCT_DEFS[oneTimeSku]?.oneTime && !owned.includes(oneTimeSku);
  const next = {
    ...player,
    wallet: nextWallet,
    ...(finishes ? { drydockFinishes: (player.drydockFinishes || 0) + finishes } : {}),
    ...(own ? { oneTimePurchases: [...owned, oneTimeSku] } : {}),
  };
  return { player: next, applied: { ...wallet, ...(finishes ? { drydockFinishes: finishes } : {}) }, unknown };
}

/** Record one-time packs the server says this player owns (never removes one). */
export function markOwned(player, skus) {
  const owned = new Set(player.oneTimePurchases || []);
  const add = (skus || []).filter((sku) => PRODUCT_DEFS[sku]?.oneTime && !owned.has(sku));
  return add.length ? { ...player, oneTimePurchases: [...owned, ...add] } : player;
}
