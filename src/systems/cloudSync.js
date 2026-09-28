// @ts-nocheck
/** Pure reconciliation between the local save, the cloud save and the purchase ledger. */
import { applyGrant } from './iap.js';
import { PRODUCT_DEFS } from '../data/products.js';

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
export function chooseSave(local, cloud, purchaseSkus = {}) {
  if (!cloud?.blob) return { player: local, source: 'local' };
  let remote;
  let remoteSavedAt = 0;
  try {
    const parsed = JSON.parse(cloud.blob);
    remote = parsed?.player;
    remoteSavedAt = Number(parsed?.savedAt) || cloud.savedAt || 0;
  } catch { return { player: local, source: 'local' }; }
  if (!remote?.wallet) return { player: local, source: 'local' };
  const adoptCloud = { player: { ...remote, cloudSeq: cloud.seq, cloudDirty: false }, source: 'cloud' };
  if (!local) return adoptCloud;
  const neverSynced = !Number.isSafeInteger(local.cloudSeq);
  const localSeq = neverSynced ? 0 : local.cloudSeq;
  if (cloud.seq <= localSeq) return { player: { ...local, cloudSeq: Math.max(localSeq, cloud.seq) }, source: 'local' };
  // A save that never synced (including one from before cloud save existed) is
  // treated as unsynced progress: it is compared and archived, never dropped.
  if (!local.cloudDirty && !neverSynced) return adoptCloud;
  // Both devices changed since the last sync.
  const localScore = progressScore(local);
  const remoteScore = progressScore(remote);
  // On a tie a never-synced device defers to the cloud; its save is archived.
  const localWins = localScore > remoteScore || (localScore === remoteScore && !neverSynced && (local.lastSavedAt || 0) > remoteSavedAt);
  return localWins
    ? { player: carryPurchases({ ...local, cloudSeq: cloud.seq }, remote, purchaseSkus), source: 'local', conflict: true, archived: remote }
    : { ...adoptCloud, player: carryPurchases(adoptCloud.player, local, purchaseSkus), conflict: true, archived: local };
}

/**
 * Purchases are never lost in a merge: anything the losing save had applied
 * that the winner has not is re-granted from the catalog, and one-time
 * ownership is merged.
 */
export function carryPurchases(winner, loser, serverSkus = {}) {
  let next = winner;
  // The server's ledger is the provenance authority; saves fill in mock tokens.
  const skus = { ...(winner?.purchaseSkus || {}), ...(loser?.purchaseSkus || {}), ...(serverSkus || {}) };
  for (const token of loser?.iapFulfilled || []) {
    if ((next.iapFulfilled || []).includes(token)) continue;
    const sku = skus[token] || mockTokenSku(token);
    const grant = sku ? PRODUCT_DEFS[sku]?.grant : null;
    // An unmapped token is left off the winner rather than marked carried, so
    // it is never mistaken for a grant that arrived.
    if (grant) next = applyGrant(next, grant, token, sku);
  }
  const owned = new Set([...(next.oneTimePurchases || []), ...(loser?.oneTimePurchases || [])]);
  return owned.size ? { ...next, oneTimePurchases: [...owned] } : next;
}

/** Local mock tokens name their SKU: `local_<sku>_<time>`. */
function mockTokenSku(token) {
  const m = /^local_(wc_[a-z0-9_]+)_\d+$/.exec(String(token));
  return m && PRODUCT_DEFS[m[1]] ? m[1] : null;
}

/** Record the server's token→SKU provenance so a later merge can re-grant any purchase. */
export function withPurchaseSkus(player, purchaseSkus = {}) {
  if (!player || !purchaseSkus || !Object.keys(purchaseSkus).length) return player;
  const known = new Set(player.iapFulfilled || []);
  const add = Object.fromEntries(Object.entries(purchaseSkus).filter(([token, sku]) => known.has(token) && PRODUCT_DEFS[sku]));
  return Object.keys(add).length ? { ...player, purchaseSkus: { ...add, ...(player.purchaseSkus || {}) } } : player;
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
    // The server says this player already owns the pack: hide it so it cannot be bought again.
    if (result.status === 'duplicate_one_time' && result.sku && !(next.oneTimePurchases || []).includes(result.sku)) {
      next = { ...next, oneTimePurchases: [...(next.oneTimePurchases || []), result.sku] };
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
