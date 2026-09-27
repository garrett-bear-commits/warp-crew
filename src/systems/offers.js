// @ts-nocheck
/**
 * One-time New Captain's Kit. It appears after the player has found their
 * footing (third post-tutorial contract) or after their first lost fight,
 * never before the Shop is unlocked, and stays for a real 48-hour window.
 */
import { isTabUnlocked } from './tutorial.js';
import { PRODUCT_DEFS, GEM_LADDER, ownsOneTime } from './iap.js';
import { FUEL_REFILL } from './gemSinks.js';

export const STARTER_OFFER = Object.freeze({ sku: 'wc_starter_kit', windowMs: 48 * 3600 * 1000, contractsTrigger: 4 });

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
  const active = !offer.purchased && !ownsOneTime(player, STARTER_OFFER.sku) && now < endsAt;
  return { active, endsAt, remainingMs: Math.max(0, endsAt - now), showModal: active && !offer.seen, reason: offer.reason, purchased: offer.purchased };
}

export function markStarterOffer(player, patch) {
  const offer = player?.offers?.starter;
  if (!offer) return player;
  return { ...player, offers: { ...player.offers, starter: { ...offer, ...patch } } };
}

/**
 * Truthful value line: compare a pack with the regular gem pack at the same
 * price. Fuel counts at the in-game refill rate; medals and credits are extra.
 */
export function packValue(sku, products = []) {
  const bySku = Object.fromEntries(products.filter(p => Number.isFinite(p?.price)).map(p => [p.sku, p]));
  const pack = bySku[sku];
  const grant = PRODUCT_DEFS[sku]?.grant;
  if (!pack || !grant) return null;
  const rungs = GEM_LADDER.map(id => bySku[id]).filter(Boolean).filter(rung => rung.price <= pack.price)
    .sort((a, b) => b.price - a.price);
  const rung = rungs[0];
  if (!rung) return null;
  const rungGems = PRODUCT_DEFS[rung.sku].grant.gems;
  const gemValue = (grant.gems || 0) + (grant.fuel || 0) * (FUEL_REFILL.gems / FUEL_REFILL.fuel);
  const morePct = Math.round((gemValue / rungGems - 1) * 100 * (rung.price / pack.price));
  return { sku, price: pack.price, currency: pack.currency || 'USD', grant, rung: { sku: rung.sku, name: PRODUCT_DEFS[rung.sku].name, price: rung.price, gems: rungGems },
    gemValue, morePct: morePct > 0 ? morePct : 0 };
}

export function starterValue(products = []) {
  return packValue(STARTER_OFFER.sku, products);
}
