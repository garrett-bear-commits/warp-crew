// @ts-nocheck
/** Pure reconciliation between the local save, the cloud save and the purchase ledger. */
import { applyGrant } from './iap.js';

/**
 * Adopt the cloud copy when another device wrote after this one last synced,
 * or when this device has no progress of its own yet.
 */
export function chooseSave(local, cloud) {
  if (!cloud?.blob) return { player: local, source: 'local' };
  let remote;
  try { remote = JSON.parse(cloud.blob)?.player; } catch { return { player: local, source: 'local' }; }
  if (!remote?.wallet) return { player: local, source: 'local' };
  const localSeq = Number.isSafeInteger(local?.cloudSeq) ? local.cloudSeq : 0;
  const localIsFresh = !local || (!local.tutorial?.completed && !(local.stats?.contractsCompleted > 0) && !local.cloudSeq);
  if (cloud.seq > localSeq || localIsFresh) return { player: { ...remote, cloudSeq: cloud.seq }, source: 'cloud' };
  return { player: { ...local, cloudSeq: Math.max(localSeq, cloud.seq) }, source: 'local' };
}

/** Grant every ledger purchase this save has never applied (idempotent by token). */
export function applyLedger(player, purchases = []) {
  let next = player;
  const applied = [];
  for (const entry of purchases) {
    if (!entry?.purchaseToken || (next.iapFulfilled || []).includes(entry.purchaseToken)) continue;
    next = applyGrant(next, entry.grant || {}, entry.purchaseToken, entry.sku);
    applied.push(entry.sku);
  }
  return { player: next, applied };
}

/** Server-verified purchase results become grants; nothing else does. */
export function applyVerifiedPurchases(player, results = []) {
  let next = player;
  const granted = [];
  const settled = [];
  for (const result of results) {
    if (['granted', 'already_recorded'].includes(result.status) && result.grant && Object.keys(result.grant).length) {
      const before = next;
      next = applyGrant(next, result.grant, result.purchaseToken, result.sku);
      if (next !== before) granted.push(result.sku);
    } else if (!(next.iapFulfilled || []).includes(result.purchaseToken)) {
      // Unsupported or duplicate one-time: settle the token without a grant.
      next = { ...next, iapFulfilled: [...(next.iapFulfilled || []), result.purchaseToken] };
    }
    settled.push(result.purchaseToken);
  }
  return { player: next, granted, settled };
}

/** Receipts waiting for the server survive reloads in the save. */
export function stageReceipt(player, receipt) {
  if (!receipt || (player.pendingReceipts || []).includes(receipt)) return player;
  return { ...player, pendingReceipts: [...(player.pendingReceipts || []), receipt].slice(-20) };
}

export function clearReceipt(player, receipt) {
  return { ...player, pendingReceipts: (player.pendingReceipts || []).filter(item => item !== receipt) };
}
