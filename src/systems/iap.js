// @ts-nocheck
/**
 * IAP product grants for Warp Crew.
 * SKUs must match products configured in Jest Developer Console.
 */

import { grant, clampFuel } from './economy.js';
import {
  getProducts,
  purchaseProduct,
  completePurchase,
  getIncompletePurchases,
  captureEvent,
} from '../shared/platform.js';

/** Local + console product definitions */
const gems = (sku, amount, name) => ({ sku, name, blurb: `+${amount} gems`, grant: { gems: amount } });
const wallPack = (sector, name, grant) => ({
  sku: `wc_wall_${sector}`, name, blurb: 'One time only · helps break this sector\'s flagship', oneTime: true, wall: sector, grant,
});

/**
 * Every product and every discount is its own SKU; nothing sells below $1.99.
 * Prices live in the Jest console (cents); these are the grants.
 */
export const PRODUCT_DEFS = {
  wc_gems_s: gems('wc_gems_s', 100, 'Gem Pouch'),
  wc_gems_m: gems('wc_gems_m', 280, 'Gem Pack'),
  wc_gems_l: gems('wc_gems_l', 600, 'Gem Crate'),
  wc_gems_xl: gems('wc_gems_xl', 1300, 'Gem Vault'),
  wc_gems_xxl: gems('wc_gems_xxl', 3500, 'Gem Hoard'),
  wc_starter_kit: {
    sku: 'wc_starter_kit',
    name: "New Captain's Kit",
    blurb: 'One time only: gems, fuel, medals and credits',
    oneTime: true,
    grant: { fuel: 10, gems: 250, medals: 50, credits: 800 },
  },
  wc_wall_spur: wallPack('spur', 'Corsair Breaker Pack', { gems: 300, medals: 80, credits: 1500, fuel: 10, drydockFinishes: 1 }),
  wc_wall_veil: wallPack('veil', 'Frigate Breaker Pack', { gems: 450, medals: 120, credits: 3000, fuel: 10, drydockFinishes: 1 }),
  wc_wall_ember: wallPack('ember', 'Raider Breaker Pack', { gems: 600, medals: 160, credits: 5000, fuel: 10, drydockFinishes: 2 }),
  wc_wall_hollow: wallPack('hollow', 'Shade Breaker Pack', { gems: 800, medals: 220, credits: 8000, fuel: 10, drydockFinishes: 2 }),
  wc_wall_crown: wallPack('crown', 'Throne Breaker Pack', { gems: 950, medals: 280, credits: 12000, fuel: 10, drydockFinishes: 3 }),
};

/** Gem ladder rungs, used for honest value comparisons. */
export const GEM_LADDER = ['wc_gems_s', 'wc_gems_m', 'wc_gems_l', 'wc_gems_xl', 'wc_gems_xxl'];

export function ownsOneTime(player, sku) {
  return (player?.oneTimePurchases || []).includes(sku);
}

export function applyGrant(player, grantTable, token = null, sku = null) {
  const fulfilled = player.iapFulfilled || [];
  if (token && fulfilled.includes(token)) {
    return player;
  }
  const { drydockFinishes = 0, ...currencies } = grantTable;
  let wallet = grant(player.wallet, currencies);
  if (grantTable.fuel) {
    wallet = clampFuel(wallet, player.fuelMax ?? 10);
  }
  const oneTime = sku && PRODUCT_DEFS[sku]?.oneTime && !ownsOneTime(player, sku);
  return {
    ...player,
    wallet,
    ...(drydockFinishes ? { drydockFinishes: (player.drydockFinishes || 0) + drydockFinishes } : {}),
    ...(oneTime ? { oneTimePurchases: [...(player.oneTimePurchases || []), sku] } : {}),
    iapFulfilled: token ? [...fulfilled, token] : fulfilled,
  };
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

/**
 * Purchase SKU: begin → grant → complete (Jest-safe order).
 */
export async function buyProduct(player, sku) {
  const def = PRODUCT_DEFS[sku];
  if (!def) return { ok: false, reason: 'unknown_sku', player };
  if (def.oneTime && ownsOneTime(player, sku)) return { ok: false, reason: 'already_owned', player };

  const begin = await purchaseProduct(sku);
  if (!begin.ok) {
    return {
      ok: false,
      reason: begin.cancelled ? 'cancelled' : begin.error || 'purchase_failed',
      player,
    };
  }

  // Grant BEFORE completePurchase (Jest docs: grant then confirm)
  const token = begin.purchase?.purchaseToken;
  if (token && (player.iapFulfilled || []).includes(token)) {
    try {
      await completePurchase(token);
    } catch (e) {
      console.warn('[iap] completePurchase failed on duplicate', e);
    }
    return { ok: true, player, sku, purchase: begin.purchase, duplicate: true };
  }
  const next = applyGrant(player, def.grant, token, sku);
  captureEvent('iap_granted', { sku, mock: Boolean(begin.mock) });

  try {
    await completePurchase(begin.purchase.purchaseToken);
  } catch (e) {
    console.warn('[iap] completePurchase failed — grant kept; will retry incomplete', e);
  }

  return { ok: true, player: next, sku, purchase: begin.purchase };
}

/** Drain incomplete purchases on boot (crash safety). */
export async function fulfillIncompletePurchases(player) {
  let current = player;
  const granted = [];
  try {
    let page;
    do {
      page = await getIncompletePurchases();
      for (const purchase of page.purchases || []) {
        const def = PRODUCT_DEFS[purchase.productSku];
        if (!def) continue;
        const token = purchase.purchaseToken;
        if (token && (current.iapFulfilled || []).includes(token)) {
          try {
            await completePurchase(token);
          } catch (e) {
            console.warn('[iap] incomplete complete failed', e);
          }
          continue;
        }
        current = applyGrant(current, def.grant, token, purchase.productSku);
        granted.push(purchase.productSku);
        try {
          await completePurchase(token);
        } catch (e) {
          console.warn('[iap] incomplete complete failed', e);
        }
      }
    } while (page?.hasMore);
  } catch (e) {
    console.warn('[iap] getIncompletePurchases', e);
  }
  return { player: current, granted };
}
