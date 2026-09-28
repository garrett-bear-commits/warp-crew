import assert from 'node:assert/strict';
import {
  COMMISSION, commissionActive, applyEntitlements, claimCommissionDaily, ENTITLEMENT_GRACE_MS,
  subscribeCommission, refreshCommission, cancelCommission, acceptRetention,
} from '../src/systems/subscription.js';
import { createNewPlayer } from '../src/systems/player.js';
import { PRODUCT_DEFS, SUBSCRIPTION_DEFS } from '../src/data/products.js';

const NOW = Date.UTC(2030, 8, 27, 12);
const base = createNewPlayer({ tutorialScript: 4 });
const baseFuelMax = base.fuelMax;

// Catalog: one SKU, $9.99, 7-day trial, retention $5.99 × 2, never below $1.99.
assert.equal(COMMISSION.sku, 'wc_sub_commission');
assert.equal(COMMISSION.priceCents, 999);
assert.equal(COMMISSION.trialDays, 7);
assert.deepEqual(COMMISSION.retention, { priceCents: 599, periods: 2 });
assert.ok(!Object.keys(SUBSCRIPTION_DEFS).some(sku => /winback/.test(sku)), 'win-back is a retention discount, not a second SKU that would double-bill');
assert.ok(!PRODUCT_DEFS.wc_sub_commission, 'subscriptions are not consumable products');

// Entitlement drives the fuel cap and the daily perks.
const active = applyEntitlements(base, [{ sku: 'wc_sub_commission', active: true, trialEligible: false, retentionOffer: null }], NOW);
assert.equal(active.fuelMax, baseFuelMax + COMMISSION.perks.fuelMaxBonus);
assert.equal(commissionActive(active, NOW), true);
const day1 = claimCommissionDaily(active, NOW);
assert.deepEqual(day1.granted, { gems: 30, drydockFinishes: 1 });
assert.equal(day1.player.wallet.gems, active.wallet.gems + 30);
assert.equal(claimCommissionDaily(day1.player, NOW + 3600_000).granted, null, 'once per day');
assert.ok(claimCommissionDaily(day1.player, NOW + 86400_000).granted, 'again the next day');
// Offline grace: a verified entitlement pays for 72 h without a re-check, then stops.
assert.equal(claimCommissionDaily(day1.player, NOW + ENTITLEMENT_GRACE_MS + 1).granted, null);
// Lapse: fuel cap returns to normal, no perks.
const lapsed = applyEntitlements(day1.player, [{ sku: 'wc_sub_commission', active: false, trialEligible: false }], NOW + 1);
assert.equal(lapsed.fuelMax, baseFuelMax);
assert.equal(claimCommissionDaily(lapsed, NOW + 86400_000).granted, null);

// Flows against a fake SDK.
const now = () => NOW;
const plain = (status, extra = {}) => ({ sku: 'wc_sub_commission', status, trialEligible: false, retentionOffer: null, ...extra });
const calls = [];
const sdk = {
  getSubscriptions: async () => ({ subscriptions: [plain('active')], signed: 'SIGNED-LIST' }),
  beginSubscription: async () => { calls.push('begin'); return { result: 'success', subscription: plain('active'), subscriptionSigned: 'SIGNED-ONE' }; },
  cancelSubscription: async () => { calls.push('cancel'); return { result: 'success' }; },
  claimRetentionOffer: async () => { calls.push('claim'); return { result: 'success', subscription: plain('active'), subscriptionSigned: 'SIGNED-CLAIM' }; },
};
// Real Jest with no verifier: never opens a checkout.
const noServer = await subscribeCommission(base, { sdk, real: true, verify: null, now });
assert.equal(noServer.reason, 'store_unavailable');
assert.deepEqual(calls, []);
// Real Jest: only the server's verified answer unlocks, never the plain object.
const verified = [];
const verify = async (signed) => { verified.push(signed); return { ok: true, data: { subscriptions: [{ sku: 'wc_sub_commission', active: true, trialEligible: false, retentionOffer: { price: 599, durationPeriods: 2 } }] } }; };
const sub = await subscribeCommission(base, { sdk, real: true, verify, now });
assert.equal(sub.ok, true);
assert.deepEqual(verified, ['SIGNED-ONE']);
assert.equal(commissionActive(sub.player, NOW), true);
assert.deepEqual(sub.player.commission.retentionOffer, { price: 599, durationPeriods: 2 });
// Verification down after checkout: nothing unlocks yet; the next boot refresh picks it up.
const down = await subscribeCommission(base, { sdk, real: true, verify: async () => ({ ok: false, reason: 'network' }), now });
assert.equal(down.reason, 'pending_verification');
assert.equal(commissionActive(down.player, NOW), false);
const booted = await refreshCommission(down.player, { sdk, real: true, verify, now });
assert.equal(commissionActive(booted.player, NOW), true);
// A verifier that says inactive wins over a plain "active" (spoofed) object.
const spoof = await refreshCommission(sub.player, { sdk, real: true, verify: async () => ({ ok: true, data: { subscriptions: [{ sku: 'wc_sub_commission', active: false }] } }), now });
assert.equal(commissionActive(spoof.player, NOW), false);
// Already subscribed: no second checkout.
calls.length = 0;
assert.equal((await subscribeCommission(sub.player, { sdk, real: true, verify, now })).reason, 'already_active');
assert.deepEqual(calls, []);
// Cancel-save: claim the retention discount on the same subscription.
const stay = await acceptRetention(sub.player, { sdk, real: true, verify, now });
assert.equal(stay.ok, true);
assert.deepEqual(calls, ['claim']);
// Cancel keeps perks until Jest reports the lapse.
const cancelled = await cancelCommission(sub.player, { sdk, real: true, verify, now });
assert.equal(cancelled.ok, true);
assert.equal(cancelled.player.commission.cancelRequested, true);
assert.equal(commissionActive(cancelled.player, NOW), true);
const resub = applyEntitlements(applyEntitlements(cancelled.player, [{ sku: 'wc_sub_commission', active: false }], NOW), [{ sku: 'wc_sub_commission', active: true }], NOW);
assert.equal(resub.commission.cancelRequested, false, 'resubscribing clears the cancelled note');

// Local mock: the SDK mock works end to end without a server.
delete globalThis.window;
const platform = await import('../src/shared/platform.js');
const mockSdk = { getSubscriptions: platform.getSubscriptions, beginSubscription: platform.beginSubscription, cancelSubscription: platform.cancelSubscription, claimRetentionOffer: platform.claimRetentionOffer };
const listed = await mockSdk.getSubscriptions();
assert.equal(listed.subscriptions[0].trialEligible, true);
const mocked = await subscribeCommission(base, { sdk: mockSdk, real: false, verify: null, now });
assert.equal(commissionActive(mocked.player, NOW), true);
assert.ok(mocked.player.commission.retentionOffer, 'mock offers the retention discount once subscribed');
const mockStay = await acceptRetention(mocked.player, { sdk: mockSdk, real: false, verify: null, now });
assert.equal(mockStay.player.commission.retentionOffer, null, 'claimed once');

console.log('subscription.test.mjs OK');
