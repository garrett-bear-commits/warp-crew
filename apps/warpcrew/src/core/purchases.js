// Purchases on the core. The server verifies every signed receipt and mints the pack's rewards as
// a grant; the client claims the grant and applies it through applyGrantRewards (the single
// grant-application path), waits until the change is saved durably, and only then completes the
// provider purchase. So a crash anywhere leaves either an incomplete Jest purchase (re-offered and
// re-verified on the next boot; the server answers `duplicate` and points at the same grant) or an
// unclaimed grant (claimed on the next boot, on any device). Nothing is ever granted from an
// unsigned object.
//
// Only a tab that can apply a grant (the core's leader tab, booted and live, no restore running)
// ever claims one: a claim consumes the grant on the server, so a claim whose apply is refused
// would lose it. Followers defer (client.js runs the deferred work once the tab leads). A Jest
// purchase is completed only when its grant was applied here and saved, or the server says it was
// already claimed (applied and saved by whichever leader claimed it).
//
// One-time packs (starter kit, wall packs) ask the server `GET /v1/purchases/owned` first: no
// answer, no checkout; owned elsewhere, the pack is marked owned here and no money moves.
//
// With no server (the GitHub Pages QA build, offline dev) the local mock checkout delivers the
// products.js grant on the device, exactly as before the port, but never inside the real Jest
// shell: there, without a server, purchasing is disabled (`enabled: false`).
import { PRODUCT_DEFS } from '../data/products.js';
import { rewardsFromTable, oneTimeSkuOf } from './grants.js';

/**
 * @param {{
 *   api: ReturnType<typeof import('./api.js').createWarpcrewApi> | null,
 *   payments: import('@foundation/client').PaymentsProvider,
 *   player: () => any,
 *   canApply?: () => boolean,
 *   applyGrant: (grant: { grantKey: string, rewards: any[], reason?: string, source?: string }, oneTimeSku: string | null) => Promise<boolean>,
 *   markOwned: (skus: string[]) => void,
 *   enabled?: boolean,
 *   onError?: (message: string, detail?: Record<string, string | number | boolean>) => void,
 * }} deps
 */
export function createPurchases(deps) {
  const online = () => deps.api !== null;
  const enabled = () => deps.enabled !== false;
  const canApply = () => (deps.canApply ? deps.canApply() === true : true);
  const ownsLocally = (sku) => (deps.player()?.oneTimePurchases || []).includes(sku);
  const report = (message, detail) => { try { deps.onError?.(message, detail); } catch { /* never blocks */ } };

  /**
   * Claim one grant and apply it. Outcomes: 'applied' (applied here and saved), 'already' (claimed
   * earlier, so applied and saved by that claimer), 'deferred' (this tab may not apply now: not
   * claimed), 'failed' (not claimed, or nothing to apply), 'lost' (claimed but the apply or its
   * save failed: reported loudly; support re-grants).
   */
  async function claim(grantKey) {
    if (!canApply()) return 'deferred';
    const r = await deps.api.grants.claim(grantKey);
    if (!r.ok) {
      report('grant claim failed', { status: r.status });
      return 'failed';
    }
    if (r.body?.outcome === 'already_claimed') return 'already';
    if (r.body?.outcome !== 'claimed' || !r.body.grant) return 'failed';
    const applied = await deps.applyGrant(r.body.grant, oneTimeSkuOf(r.body.grant));
    if (!applied) {
      report('claimed grant not applied', { grantKey: String(grantKey).slice(0, 120) });
      return 'lost';
    }
    return 'applied';
  }
  const delivered = (outcome) => outcome === 'applied' || outcome === 'already';

  /** Every grant waiting for this player (purchases from any device, support make-goods). */
  async function claimPending() {
    if (!online()) return { ok: false, claimed: [] };
    if (!canApply()) return { ok: false, deferred: true, claimed: [] };
    const r = await deps.api.grants.pending();
    if (!r.ok) return { ok: false, claimed: [] };
    const claimed = [];
    for (const g of r.body?.grants || []) {
      const outcome = await claim(g.grantKey);
      if (outcome === 'applied') claimed.push(g);
      if (outcome === 'deferred') return { ok: false, deferred: true, claimed };
    }
    return { ok: true, claimed };
  }

  /**
   * The server's one-time ownership, merged into the save (never removes a pack). Anything but a
   * 2xx with a `oneTime` array of strings is an unknown answer: `ok: false`, and no checkout opens.
   */
  async function refreshOwned() {
    if (!online()) return { ok: false, oneTime: [] };
    const r = await deps.api.purchases.owned();
    const list = r.ok ? r.body?.oneTime : null;
    if (!Array.isArray(list) || !list.every((sku) => typeof sku === 'string')) {
      if (r.ok) report('malformed ownership answer');
      return { ok: false, oneTime: [] };
    }
    deps.markOwned(list);
    return { ok: true, oneTime: list };
  }

  async function complete(token) {
    const done = await deps.payments.complete(token);
    if (done.kind !== 'success') report('purchase completion failed', { kind: done.kind });
  }

  /**
   * Buy one product. Outcomes: ok (rewards applied and saved), or a reason: unknown_sku,
   * already_owned, store_unavailable (purchasing disabled, or no valid ownership answer),
   * not_leader (another tab plays), cancelled, purchase_failed, unsigned_receipt,
   * pending_verification (server unreachable: Jest re-offers it at the next boot), rejected:<why>
   * (e.g. delivery_unavailable while minting is off), withheld (recorded, not delivered),
   * pending_delivery (the grant could not be claimed or saved now; it is retried at boot).
   * @param {string} sku
   */
  async function buy(sku) {
    const def = PRODUCT_DEFS[sku];
    if (!def) return { ok: false, reason: 'unknown_sku' };
    if (!enabled()) return { ok: false, reason: 'store_unavailable' };
    if (!canApply()) return { ok: false, reason: 'not_leader' };
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
      // Local mock only: the device grants the catalog's rewards, saves, then completes.
      const applied = await deps.applyGrant({ grantKey: `local:${begin.purchaseToken}`, rewards: rewardsFromTable(def.grant), reason: `purchase ${sku}`, source: 'purchase' }, def.oneTime ? sku : null);
      if (!applied) return { ok: false, reason: 'pending_delivery' };
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
    if (!record?.grantKey) {
      report('ready purchase without a grant');
      return { ok: false, reason: 'withheld' };
    }
    // Never complete a purchase whose grant was not applied and saved: Jest re-offers it at boot.
    if (!delivered(await claim(record.grantKey))) return { ok: false, reason: 'pending_delivery' };
    await complete(body.purchaseToken);
    return { ok: true, sku };
  }

  /**
   * Boot: verify Jest's incomplete purchases, claim and save their grants, and complete only those
   * whose grant was delivered. Leader only (a follower returns `deferred`).
   */
  async function recover() {
    if (!online() || !enabled()) return { ok: false, completed: 0 };
    if (!canApply()) return { ok: false, deferred: true, completed: 0 };
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
          if (result.purchase?.duplicateOf != null) {
            deps.markOwned([result.purchase.sku]);
            ready.push(result.purchaseToken);
          } else if (result.purchase?.grantKey && delivered(await claim(result.purchase.grantKey))) {
            ready.push(result.purchaseToken);
          }
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
