// @ts-nocheck
/** Pure reconciliation between the local save, the cloud save and the purchase ledger. */
import { applyGrant } from './iap.js';

/** Rough, monotonic progress measure used only to settle two-device conflicts. */
export function progressScore(player) {
  if (!player) return 0;
  const systems = Object.values(player.ship?.systems || {}).reduce((sum, level) => sum + (Number(level) || 0), 0);
  const walls = Object.keys(player.flags || {}).filter(key => key.startsWith('wall_') && player.flags[key] === true).length;
  return (player.story?.chapter || 0) * 10000 + walls * 5000 + (player.stats?.contractsCompleted || 0) * 100
    + systems * 20 + (player.crew?.length || 0) * 10 + (player.tutorial?.completed ? 50 : 0);
}

/**
 * Pick which save to play. The cloud wins when another device wrote after this
 * one last synced and this device has nothing unsynced. When both changed, the
 * save with more progress wins (newer save on a tie) and the loser is returned
 * so it can be archived on the server instead of vanishing.
 */
export function chooseSave(local, cloud) {
  if (!cloud?.blob) return { player: local, source: 'local' };
  let remote;
  let remoteSavedAt = 0;
  try {
    const parsed = JSON.parse(cloud.blob);
    remote = parsed?.player;
    remoteSavedAt = Number(parsed?.savedAt) || cloud.savedAt || 0;
  } catch { return { player: local, source: 'local' }; }
  if (!remote?.wallet) return { player: local, source: 'local' };
  const localSeq = Number.isSafeInteger(local?.cloudSeq) ? local.cloudSeq : 0;
  const localIsFresh = !local || (!local.tutorial?.completed && !(local.stats?.contractsCompleted > 0) && !local.cloudSeq);
  const adoptCloud = { player: { ...remote, cloudSeq: cloud.seq, cloudDirty: false }, source: 'cloud' };
  if (localIsFresh) return adoptCloud;
  if (cloud.seq <= localSeq) return { player: { ...local, cloudSeq: Math.max(localSeq, cloud.seq) }, source: 'local' };
  if (!local.cloudDirty) return adoptCloud;
  // Both devices changed since the last sync.
  const localScore = progressScore(local);
  const remoteScore = progressScore(remote);
  const localWins = localScore > remoteScore || (localScore === remoteScore && (local.lastSavedAt || 0) > remoteSavedAt);
  return localWins
    ? { player: { ...local, cloudSeq: cloud.seq }, source: 'local', conflict: true, archived: remote }
    : { ...adoptCloud, conflict: true, archived: local };
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
