// Purchases on the core. The server verifies every signed receipt and mints the pack's rewards as
// a grant; the client claims the grant and applies it through applyGrantRewards (the single
// grant-application path), saves at once, and only then completes the provider purchase. So a
// crash anywhere leaves either an incomplete Jest purchase (re-offered and re-verified on the next
// boot; the server answers `duplicate` and points at the same grant) or an unclaimed grant (claimed
// on the next boot, on any device). Nothing is ever granted from an unsigned object.
//
// One-time packs (starter kit, wall packs) ask the server `GET /v1/purchases/owned` first: no
// answer, no checkout; owned elsewhere, the pack is marked owned here and no money moves.
//
// With no server (the GitHub Pages QA build, offline dev) the local mock checkout delivers the
// products.js grant on the device, exactly as before the port. No real checkout ever opens
// without a server: the Jest platform is only selected when one is configured.
import { PRODUCT_DEFS } from '../data/products.js';
import { rewardsFromTable, oneTimeSkuOf } from './grants.js';

/**
 * @param {{
 *   api: ReturnType<typeof import('./api.js').createWarpcrewApi> | null,
 *   payments: import('@foundation/client').PaymentsProvider,
 *   player: () => any,
 *   applyGrant: (grant: { grantKey: string, rewards: any[], reason?: string, source?: string }, oneTimeSku: string | null) => boolean,
 *   markOwned: (skus: string[]) => void,
 *   onError?: (message: string, detail?: Record<string, string | number | boolean>) => void,
 * }} deps
 */
export function createPurchases(deps) {
  const online = () => deps.api !== null;
  const ownsLocally = (sku) => (deps.player()?.oneTimePurchases || []).includes(sku);
  const report = (message, detail) => { try { deps.onError?.(message, detail); } catch { /* never blocks */ } };

  /** Claim one grant and apply it. Returns true when this call applied it. */
  async function claim(grantKey) {
    const r = await deps.api.grants.claim(grantKey);
    if (!r.ok) {
      report('grant claim failed', { status: r.status });
      return false;
    }
    if (r.body.outcome !== 'claimed' || !r.body.grant) return false;
    return deps.applyGrant(r.body.grant, oneTimeSkuOf(r.body.grant));
  }

  /** Every grant waiting for this player (purchases from any device, support make-goods). */
  async function claimPending() {
    if (!online()) return { ok: false, claimed: [] };
    const r = await deps.api.grants.pending();
    if (!r.ok) return { ok: false, claimed: [] };
    const claimed = [];
    for (const g of r.body.grants || []) if (await claim(g.grantKey)) claimed.push(g);
    return { ok: true, claimed };
  }

  /** The server's one-time ownership, merged into the save (never removes a pack). */
  async function refreshOwned() {
    if (!online()) return { ok: false, oneTime: [] };
    const r = await deps.api.purchases.owned();
    if (!r.ok) return { ok: false, oneTime: [] };
    const oneTime = Array.isArray(r.body?.oneTime) ? r.body.oneTime : [];
    deps.markOwned(oneTime);
    return { ok: true, oneTime };
  }

  async function complete(token) {
    const done = await deps.payments.complete(token);
    if (done.kind !== 'success') report('purchase completion failed', { kind: done.kind });
  }

  /**
   * Buy one product. Outcomes: ok (rewards applied), or a reason: unknown_sku, already_owned,
   * store_unavailable (no ownership answer), cancelled, purchase_failed, unsigned_receipt,
   * pending_verification (server unreachable: Jest re-offers it at the next boot), rejected:<why>
   * (e.g. delivery_unavailable while minting is off), withheld (recorded, not delivered).
   * @param {string} sku
   */
  async function buy(sku) {
    const def = PRODUCT_DEFS[sku];
    if (!def) return { ok: false, reason: 'unknown_sku' };
    if (def.oneTime && ownsLocally(sku)) return { ok: false, reason: 'already_owned' };
    if (def.oneTime && online()) {
      const owned = await refreshOwned();
      if (!owned.ok) return { ok: false, reason: 'store_unavailable' };
      if (owned.oneTime.includes(sku)) return { ok: false, reason: 'already_owned' };
    }

    let begin;
    try {
      begin = await deps.payments.begin(sku);
    } catch (e) {
      report('purchase begin threw', { message: String(e?.message || e).slice(0, 200) });
      return { ok: false, reason: 'purchase_failed' };
    }
    if (begin.kind === 'cancel') return { ok: false, reason: 'cancelled' };
    if (begin.kind !== 'success') return { ok: false, reason: begin.message || 'purchase_failed' };

    if (!online()) {
      // Local mock only: the device grants the catalog's rewards, then completes.
      deps.applyGrant({ grantKey: `local:${begin.purchaseToken}`, rewards: rewardsFromTable(def.grant), reason: `purchase ${sku}`, source: 'purchase' }, def.oneTime ? sku : null);
      await complete(begin.purchaseToken);
      return { ok: true, sku };
    }
    // A purchase the server cannot verify stays incomplete; Jest hands it back at the next boot.
    if (!begin.purchaseSigned) return { ok: false, reason: 'unsigned_receipt' };

    const verified = await deps.api.purchases.verify(begin.purchaseSigned);
    if (!verified.ok) return { ok: false, reason: 'pending_verification' };
    const body = verified.body;
    if (body.outcome === 'rejected') return { ok: false, reason: `rejected:${body.reason || 'receipt'}` };
    if (body.completion !== 'ready') return { ok: false, reason: 'withheld' };
    if (!body.purchaseToken || body.purchaseToken !== begin.purchaseToken) {
      report('verified token did not match checkout');
      return { ok: false, reason: 'rejected:token_mismatch' };
    }
    const record = body.purchase;
    if (record?.duplicateOf != null) {
      // A second payment for a pack already owned: recorded for a refund, granted nothing.
      deps.markOwned([sku]);
      await complete(body.purchaseToken);
      return { ok: false, reason: 'already_owned' };
    }
    if (record?.grantKey) {
      await claim(record.grantKey);
      // Claimed on another device or an earlier attempt: the rewards are already in a save.
    }
    await complete(body.purchaseToken);
    return { ok: true, sku };
  }

  /** Boot: verify Jest's incomplete purchases, complete the delivered ones, claim their grants. */
  async function recover() {
    if (!online()) return { ok: false, completed: 0 };
    let completed = 0;
    try {
      const outcome = await deps.payments.recoverIncompleteBatch(async (page) => {
        if (!page.purchases.length) return [];
        const r = await deps.api.purchases.verifyBatch(page.purchasesSigned);
        if (!r.ok || r.body.outcome === 'rejected') return [];
        const tokens = new Set(page.purchases.map((p) => p.purchaseToken));
        const ready = [];
        for (const result of r.body.results || []) {
          if (!tokens.has(result.purchaseToken) || result.outcome === 'rejected' || result.completion !== 'ready') continue;
          if (result.purchase?.grantKey) await claim(result.purchase.grantKey);
          if (result.purchase?.duplicateOf != null) deps.markOwned([result.purchase.sku]);
          ready.push(result.purchaseToken);
        }
        return ready;
      });
      completed = outcome.completed.length;
    } catch (e) {
      report('purchase recovery failed', { message: String(e?.message || e).slice(0, 200) });
    }
    return { ok: true, completed };
  }

  return { buy, recover, claimPending, refreshOwned };
}
