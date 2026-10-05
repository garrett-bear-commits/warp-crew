// @ts-nocheck
/**
 * Shop catalog helpers for Warp Crew. SKUs must match products configured in the Jest Developer
 * Console and apps/server/games/warpcrew/game.config.ts (a parity test keeps them equal).
 *
 * Buying, receipt verification and delivery live in src/core/purchases.js: the core server
 * verifies every signed receipt and mints the pack as a grant, and src/core/grants.js
 * applyGrantRewards is the single path a reward takes into the player.
 */
import { getProducts } from '../shared/platform.js';
import { PRODUCT_DEFS, GEM_LADDER } from '../data/products.js';

export { PRODUCT_DEFS, GEM_LADDER };

export function ownsOneTime(player, sku) {
  return (player?.oneTimePurchases || []).includes(sku);
}

export async function listShopProducts() {
  const remote = await getProducts();
  // Merge remote pricing with our grant defs
  return Object.values(PRODUCT_DEFS).map((def) => {
    const r = (remote || []).find((p) => p.sku === def.sku);
    return {
      ...def,
      // Jest prices arrive in cents; keep both for display and value maths.
      priceCents: Number.isInteger(r?.price) ? r.price : null,
      price: Number.isInteger(r?.price) ? r.price / 100 : null,
      currency: r?.currency ?? 'USD',
      remoteName: r?.name,
    };
  });
}
