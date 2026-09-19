// @ts-nocheck
/**
 * IAP product grants for Warp Crew.
 * SKUs must match products configured in Jest Developer Console.
 */

import { grant, clampFuel } from './economy.js';
import { PRODUCT_CATALOG } from '../data/monetization.js';
import { fulfillSku } from './shop.js';
import {
  getProducts,
  purchaseProduct,
  completePurchase,
  getIncompletePurchases,
  captureEvent,
} from '../shared/platform.js';

export const PRODUCT_DEFS = PRODUCT_CATALOG;

export function applyGrant(player, grantTable) {
  let wallet = grant(player.wallet, grantTable);
  if (grantTable.fuel) {
    wallet = clampFuel(wallet, player.fuelMax ?? 10);
  }
  return { ...player, wallet };
}

export async function listShopProducts() {
  const remote = await getProducts();
  return Object.values(PRODUCT_DEFS).map((def) => {
    const r = (remote || []).find((p) => p.sku === def.sku);
    return {
      ...def,
      price: r?.price ?? def.usd ?? null,
      currency: r?.currency ?? 'USD',
      remoteName: r?.name,
    };
  });
}

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

  const filled = fulfillSku(player, sku);
  if (!filled.ok) {
    return { ok: false, reason: filled.reason, player };
  }
  captureEvent('iap_granted', { sku, mock: Boolean(begin.mock), doubled: filled.doubled });

  try {
    await completePurchase(begin.purchase.purchaseToken);
  } catch (e) {
    console.warn('[iap] completePurchase failed — grant kept; will retry incomplete', e);
  }

  return {
    ok: true,
    player: filled.player,
    sku,
    purchase: begin.purchase,
    doubled: filled.doubled,
    pulled: filled.pulled || [],
  };
}

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
        const filled = fulfillSku(current, purchase.productSku);
        if (filled.ok) current = filled.player;
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
