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
export const PRODUCT_DEFS = {
  wc_fuel_5: {
    sku: 'wc_fuel_5',
    name: 'Fuel Cell ×5',
    blurb: 'Instant +5 fuel',
    grant: { fuel: 5 },
  },
  wc_gems_100: {
    sku: 'wc_gems_100',
    name: 'Gem Pack 100',
    blurb: '+100 gems',
    grant: { gems: 100 },
  },
  wc_gems_500: {
    sku: 'wc_gems_500',
    name: 'Gem Crate 500',
    blurb: '+500 gems',
    grant: { gems: 500 },
  },
  wc_starter: {
    sku: 'wc_starter',
    name: 'Starter Pack',
    blurb: 'Fuel + gems + medals',
    grant: { fuel: 10, gems: 150, medals: 30, credits: 500 },
  },
};

export function applyGrant(player, grantTable) {
  let wallet = grant(player.wallet, grantTable);
  if (grantTable.fuel) {
    wallet = clampFuel(wallet, player.fuelMax ?? 10);
  }
  return { ...player, wallet };
}

export async function listShopProducts() {
  const remote = await getProducts();
  // Merge remote pricing with our grant defs
  return Object.values(PRODUCT_DEFS).map((def) => {
    const r = (remote || []).find((p) => p.sku === def.sku);
    return {
      ...def,
      price: r?.price ?? null,
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

  const begin = await purchaseProduct(sku);
  if (!begin.ok) {
    return {
      ok: false,
      reason: begin.cancelled ? 'cancelled' : begin.error || 'purchase_failed',
      player,
    };
  }

  // Grant BEFORE completePurchase (Jest docs: grant then confirm)
  const next = applyGrant(player, def.grant);
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
        current = applyGrant(current, def.grant);
        granted.push(purchase.productSku);
        try {
          await completePurchase(purchase.purchaseToken);
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
