import assert from 'node:assert/strict';
import { chooseSave, progressScore, applyLedger, applyVerifiedPurchases, stageReceipt, clearReceipt } from '../src/systems/cloudSync.js';

const base = { wallet: { gems: 0, credits: 0 }, tutorial: { completed: true }, stats: { contractsCompleted: 5 }, ship: { systems: { weapons: 3 } }, crew: [1, 2, 3] };
const cloudOf = (player, seq, savedAt = 1000) => ({ seq, savedAt, blob: JSON.stringify({ player, savedAt }) });

// No cloud, or a cloud this device already has: keep local.
assert.equal(chooseSave(base, null).source, 'local');
assert.equal(chooseSave({ ...base, cloudSeq: 4 }, cloudOf(base, 4)).source, 'local');
// Another device wrote, and this device has nothing unsynced: take the cloud.
assert.equal(chooseSave({ ...base, cloudSeq: 2, cloudDirty: false }, cloudOf(base, 5)).source, 'cloud');
// A fresh device always takes the cloud.
assert.equal(chooseSave({ tutorial: { completed: false }, stats: {}, wallet: {} }, cloudOf(base, 1)).source, 'cloud');

// Both changed: the further-along save wins and the other is archived, never dropped.
const ahead = { ...base, stats: { contractsCompleted: 9 }, cloudSeq: 2, cloudDirty: true, lastSavedAt: 500 };
const behind = { ...base, stats: { contractsCompleted: 6 } };
const keepLocal = chooseSave(ahead, cloudOf(behind, 5, 2000));
assert.equal(keepLocal.source, 'local');
assert.equal(keepLocal.conflict, true);
assert.equal(keepLocal.archived.stats.contractsCompleted, 6);
assert.equal(keepLocal.player.cloudSeq, 5, 'the next upload is based on the newest server seq');
const takeCloud = chooseSave({ ...behind, cloudSeq: 2, cloudDirty: true, lastSavedAt: 9999 }, cloudOf(ahead, 5));
assert.equal(takeCloud.source, 'cloud');
assert.equal(takeCloud.archived.stats.contractsCompleted, 6);
// Tie: newer save wins.
const tieLocal = chooseSave({ ...base, cloudSeq: 1, cloudDirty: true, lastSavedAt: 3000 }, cloudOf(base, 2, 2000));
assert.equal(tieLocal.source, 'local');
assert.ok(progressScore({ ...base, flags: { wall_spur: true } }) > progressScore(base), 'walls count as progress');

// Ledger and verified grants are idempotent by purchase token.
const ledger = [{ purchaseToken: 't1', sku: 'wc_gems_s', grant: { gems: 100 } }];
const once = applyLedger(base, ledger);
assert.equal(once.player.wallet.gems, 100);
assert.equal(applyLedger(once.player, ledger).player.wallet.gems, 100);
const verified = applyVerifiedPurchases(base, [
  { purchaseToken: 'a', sku: 'wc_gems_m', status: 'granted', grant: { gems: 280 } },
  { purchaseToken: 'b', sku: 'wc_starter_kit', status: 'duplicate_one_time', grant: {} },
  { purchaseToken: 'c', sku: 'nope', status: 'unsupported', grant: {} },
]);
assert.equal(verified.player.wallet.gems, 280);
assert.deepEqual(verified.granted, ['wc_gems_m']);
assert.deepEqual(verified.settled, ['a', 'b', 'c'], 'every token is settled so Jest can complete it');
assert.equal(applyVerifiedPurchases(verified.player, [{ purchaseToken: 'a', sku: 'wc_gems_m', status: 'already_recorded', grant: { gems: 280 } }]).player.wallet.gems, 280);

// The receipt outbox dedupes and is bounded.
let outbox = stageReceipt(base, 'r1');
outbox = stageReceipt(outbox, 'r1');
assert.deepEqual(outbox.pendingReceipts, ['r1']);
assert.deepEqual(clearReceipt(outbox, 'r1').pendingReceipts, []);

console.log('cloud_sync.test.mjs OK');
