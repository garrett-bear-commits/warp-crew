// @ts-nocheck
/**
 * One-time New Captain's Kit. It appears after the player has found their
 * footing (third post-tutorial contract) or after their first lost fight,
 * never before the Shop is unlocked, and stays for a real 48-hour window.
 */
import { trustedNow } from '../shared/time.js';
import { isTabUnlocked } from './tutorial.js';
import { PRODUCT_DEFS, GEM_LADDER, ownsOneTime } from './iap.js';
import { FUEL_REFILL } from './gemSinks.js';

export const STARTER_OFFER = Object.freeze({ sku: 'wc_starter_kit', windowMs: 48 * 3600 * 1000, contractsTrigger: 4 });

export function evaluateStarterOffer(player, now = trustedNow()) {
  if (!player || player.offers?.starter) return player;
  if (!isTabUnlocked(player, 'shop')) return player;
  const lost = (player.stats?.contractsLost || 0) > 0;
  const settled = (player.stats?.contractsCompleted || 0) >= STARTER_OFFER.contractsTrigger;
  if (!lost && !settled) return player;
  return { ...player, offers: { ...(player.offers || {}), starter: { triggeredAt: now, reason: lost ? 'first_loss' : 'settled_in', seen: false, purchased: false } } };
}

export function starterOfferState(player, now = trustedNow()) {
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
  // Gems per dollar against the regular pack, so a pricier pack cannot inflate its claim.
  const morePct = Math.round(((gemValue / pack.price) / (rungGems / rung.price) - 1) * 100);
  return { sku, price: pack.price, currency: pack.currency || 'USD', grant, rung: { sku: rung.sku, name: PRODUCT_DEFS[rung.sku].name, price: rung.price, gems: rungGems },
    gemValue, morePct: morePct > 0 ? morePct : 0 };
}

export function starterValue(products = []) {
  return packValue(STARTER_OFFER.sku, products);
}

/** Wall breaker packs: once per wall, after a near miss or two days stuck. No timer. */
export const WALL_PACK_STUCK_MS = 2 * 86400 * 1000;
export const wallPackSku = wallId => `wc_wall_${wallId}`;

export function evaluateWallPackOffer(player, wall, now = trustedNow()) {
  if (!player || !wall) return player;
  const sku = wallPackSku(wall.id);
  if (player.offers?.walls?.[wall.id] || ownsOneTime(player, sku) || !PRODUCT_DEFS[sku]) return player;
  const record = player.siege?.[wall.id];
  const nearMiss = record?.nearMiss === true;
  const stuck = Number.isFinite(record?.firstSeenAt) && now - record.firstSeenAt >= WALL_PACK_STUCK_MS;
  if (!nearMiss && !stuck) return player;
  return { ...player, offers: { ...(player.offers || {}), walls: { ...(player.offers?.walls || {}),
    [wall.id]: { triggeredAt: now, reason: nearMiss ? 'near_miss' : 'stuck', seen: false } } } };
}

export function wallPackState(player, wall) {
  if (!wall) return { active: false };
  const offer = player?.offers?.walls?.[wall.id];
  const sku = wallPackSku(wall.id);
  const active = Boolean(offer) && !ownsOneTime(player, sku) && player?.flags?.[`wall_${wall.id}`] !== true;
  return { active, sku, wallId: wall.id, reason: offer?.reason, showModal: active && !offer.seen };
}

export function markWallPackSeen(player, wallId) {
  const offer = player?.offers?.walls?.[wallId];
  if (!offer) return player;
  return { ...player, offers: { ...player.offers, walls: { ...player.offers.walls, [wallId]: { ...offer, seen: true } } } };
}
