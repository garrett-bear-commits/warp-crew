// @ts-nocheck
/**
 * One-time New Captain's Kit. It appears after the player has found their
 * footing (third post-tutorial contract) or after their first lost fight,
 * never before the Shop is unlocked, and stays for a real 48-hour window.
 */
import { isTabUnlocked } from './tutorial.js';
import { PRODUCT_DEFS } from './iap.js';

export const STARTER_OFFER = Object.freeze({ sku: 'wc_starter', windowMs: 48 * 3600 * 1000, contractsTrigger: 4 });

export function evaluateStarterOffer(player, now = Date.now()) {
  if (!player || player.offers?.starter) return player;
  if (!isTabUnlocked(player, 'shop')) return player;
  const lost = (player.stats?.contractsLost || 0) > 0;
  const settled = (player.stats?.contractsCompleted || 0) >= STARTER_OFFER.contractsTrigger;
  if (!lost && !settled) return player;
  return { ...player, offers: { ...(player.offers || {}), starter: { triggeredAt: now, reason: lost ? 'first_loss' : 'settled_in', seen: false, purchased: false } } };
}

export function starterOfferState(player, now = Date.now()) {
  const offer = player?.offers?.starter;
  if (!offer) return { active: false };
  const endsAt = offer.triggeredAt + STARTER_OFFER.windowMs;
  const active = !offer.purchased && now < endsAt;
  return { active, endsAt, remainingMs: Math.max(0, endsAt - now), showModal: active && !offer.seen, reason: offer.reason, purchased: offer.purchased };
}

export function markStarterOffer(player, patch) {
  const offer = player?.offers?.starter;
  if (!offer) return player;
  return { ...player, offers: { ...player.offers, starter: { ...offer, ...patch } } };
}

/**
 * Truthful value line: price the kit's gems and fuel at the best live per-unit
 * rate of the ordinary gem and fuel packs. Credits and medals are extra.
 */
export function starterValue(products = []) {
  const bySku = Object.fromEntries(products.filter(p => Number.isFinite(p?.price)).map(p => [p.sku, p]));
  const kit = bySku[STARTER_OFFER.sku];
  const grant = PRODUCT_DEFS[STARTER_OFFER.sku].grant;
  const rate = (skus, key) => Math.min(...skus.map(sku => bySku[sku] && PRODUCT_DEFS[sku].grant[key]
    ? bySku[sku].price / PRODUCT_DEFS[sku].grant[key] : Infinity));
  const gemRate = rate(['wc_gems_100', 'wc_gems_500'], 'gems');
  const fuelRate = rate(['wc_fuel_5'], 'fuel');
  if (!kit || !Number.isFinite(gemRate) || !Number.isFinite(fuelRate)) return null;
  const worth = Math.round(((grant.gems || 0) * gemRate + (grant.fuel || 0) * fuelRate) * 100) / 100;
  const savedPct = Math.round((1 - kit.price / worth) * 100);
  return { price: kit.price, currency: kit.currency || 'USD', worth, savedPct: savedPct > 0 ? savedPct : 0, grant };
}
