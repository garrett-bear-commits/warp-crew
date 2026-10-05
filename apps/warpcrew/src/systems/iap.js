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
  isReal,
} from '../shared/platform.js';

/** Local + console product definitions */
import { PRODUCT_DEFS, GEM_LADDER } from '../data/products.js';
import { stageReceipt, clearReceipt, applyVerifiedPurchases } from './cloudSync.js';

export { PRODUCT_DEFS, GEM_LADDER };

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
    // Which product each token bought, so a merge can re-grant it from the catalog.
    ...(token && sku ? { purchaseSkus: { ...(player.purchaseSkus || {}), [token]: sku } } : {}),
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
 * Purchase SKU: begin -> (server verify) -> grant -> complete.
 *
 * With `verifyReceipt` (a save server is configured) nothing is granted until
 * the server has verified the signed receipt and chosen the grant. The receipt
 * is staged and persisted first, and the Jest purchase is completed only after
 * the grant is saved, so a crash or network failure at any step recovers.
 * Without a server (Pages QA, local mock) the old local grant path runs.
 */
export async function buyProduct(player, sku, { verifyReceipt = null, persist = null, checkOwned = null } = {}) {
  const def = PRODUCT_DEFS[sku];
  if (!def) return { ok: false, reason: 'unknown_sku', player };
  if (def.oneTime && ownsOneTime(player, sku)) return { ok: false, reason: 'already_owned', player };
  // Never open a real checkout that nothing can verify.
  if (isReal() && !verifyReceipt) return { ok: false, reason: 'store_unavailable', player };
  // A one-time pack is checked against the server before any money moves: this
  // device's save may not know about a purchase made on another device.
  if (def.oneTime && verifyReceipt) {
    const owned = checkOwned ? await checkOwned() : { ok: false };
    if (!owned.ok) return { ok: false, reason: 'store_unavailable', player };
    if ((owned.data?.oneTime || []).includes(sku)) {
      const next = { ...player, oneTimePurchases: [...new Set([...(player.oneTimePurchases || []), sku])] };
      persist?.(next);
      return { ok: false, reason: 'already_owned', player: next };
    }
  }

  const begin = await purchaseProduct(sku);
  if (!begin.ok) {
    return {
      ok: false,
      reason: begin.cancelled ? 'cancelled' : begin.error || 'purchase_failed',
      player,
    };
  }

  if (verifyReceipt && begin.purchaseSigned) {
    const staged = stageReceipt(player, begin.purchaseSigned);
    persist?.(staged);
    return settleReceipt(staged, begin.purchaseSigned, { verifyReceipt, persist, sku });
  }
  if (!begin.mock) {
    // A real purchase is granted only by the server. Without a verifier, or
    // without a signed receipt, leave it incomplete: Jest hands it back later.
    return { ok: false, reason: verifyReceipt ? 'unsigned_receipt' : 'store_unavailable', player };
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

/** Verify one staged receipt, apply the server's grants, persist, then complete. */
export async function settleReceipt(player, receipt, { verifyReceipt, persist = null, sku = null }) {
  const verified = await verifyReceipt(receipt);
  if (!verified.ok) {
    // Network or server trouble: keep the receipt staged; nothing is granted yet.
    const permanent = ['bad_signature', 'wrong_audience', 'malformed', 'malformed_purchase', 'bad_alg'].includes(verified.reason);
    const next = permanent ? clearReceipt(player, receipt) : player;
    if (permanent) persist?.(next);
    return { ok: false, reason: permanent ? `receipt_${verified.reason}` : 'pending_verification', player: next };
  }
  const results = verified.data?.purchases || [];
  const applied = applyVerifiedPurchases(clearReceipt(player, receipt), results);
  persist?.(applied.player);
  for (const token of applied.settled) {
    try {
      await completePurchase(token);
    } catch (e) {
      console.warn('[iap] completePurchase failed after verified grant; Jest will re-offer it', e);
    }
  }
  for (const result of results) captureEvent('iap_verified', { sku: result.sku, status: result.status });
  return { ok: true, player: applied.player, sku: sku || results[0]?.sku, granted: applied.granted, results };
}

/** Retry receipts that were staged but never verified. */
export async function retryPendingReceipts(player, { verifyReceipt, persist = null }) {
  let current = player;
  const granted = [];
  for (const receipt of [...(player.pendingReceipts || [])]) {
    const settled = await settleReceipt(current, receipt, { verifyReceipt, persist });
    current = settled.player;
    if (settled.ok) granted.push(...settled.granted);
  }
  return { player: current, granted };
}

/** Drain incomplete purchases on boot (crash safety). */
export async function fulfillIncompletePurchases(player, { verifyReceipt = null, persist = null } = {}) {
  let current = player;
  const granted = [];
  try {
    let page;
    let pages = 0;
    do {
      page = await getIncompletePurchases();
      pages += 1;
      if (verifyReceipt && page?.purchasesSigned && (page.purchases || []).length) {
        current = stageReceipt(current, page.purchasesSigned);
        persist?.(current);
        const settled = await settleReceipt(current, page.purchasesSigned, { verifyReceipt, persist });
        current = settled.player;
        if (!settled.ok) break; // still staged; retried on the next boot
        granted.push(...settled.granted);
        continue;
      }
      // Real incomplete purchases wait for the server; only mock ones grant locally.
      if (isReal()) break;
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
    } while (page?.hasMore && pages < 20);
  } catch (e) {
    console.warn('[iap] getIncompletePurchases', e);
  }
  return { player: current, granted };
}
