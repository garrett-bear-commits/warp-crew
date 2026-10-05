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
const verify = async (signed) => { verified.push(signed); return { ok: true, data: { issuedAt: NOW, subscriptions: [{ sku: 'wc_sub_commission', active: true, trialEligible: false, retentionOffer: { price: 599, durationPeriods: 2 } }] } }; };
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
const spoof = await refreshCommission(sub.player, { sdk, real: true, verify: async () => ({ ok: true, data: { issuedAt: NOW, subscriptions: [{ sku: 'wc_sub_commission', active: false }] } }), now });
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

// A verified list without the Commission revokes it.
const revoked = applyEntitlements(active, [], NOW);
assert.equal(commissionActive(revoked, NOW), false);
// Lapse keeps fuel already in the tank; the extra space shrinks as it is spent and never refills.
const { syncCommission } = await import('../src/systems/subscription.js');
const fullTank = { ...active, wallet: { ...active.wallet, fuel: active.fuelMax } };
const lapsedFull = applyEntitlements(fullTank, [{ sku: 'wc_sub_commission', active: false }], NOW);
assert.equal(lapsedFull.wallet.fuel, baseFuelMax + 2, 'no fuel deleted on lapse');
assert.equal(lapsedFull.fuelMax, baseFuelMax + 2);
const spent = syncCommission({ ...lapsedFull, wallet: { ...lapsedFull.wallet, fuel: baseFuelMax + 1 } }, NOW);
assert.equal(spent.fuelMax, baseFuelMax + 1, 'cap follows the fuel down');
const refilled = syncCommission({ ...spent, wallet: { ...spent.wallet, fuel: baseFuelMax } }, NOW);
assert.equal(refilled.fuelMax, baseFuelMax);
assert.equal(syncCommission({ ...refilled, wallet: { ...refilled.wallet, fuel: baseFuelMax } }, NOW).fuelMax, baseFuelMax, 'never grows back');
// Offline grace running out ends the bonus too, not just the daily perks.
const expired = syncCommission({ ...active, wallet: { ...active.wallet, fuel: 3 } }, NOW + ENTITLEMENT_GRACE_MS + 1);
assert.equal(expired.commission.active, false);
assert.equal(expired.fuelMax, baseFuelMax);
// A checkout proof that cannot be verified falls back to a fresh signed list.
const fallback = await subscribeCommission(base, { sdk, real: true, now, verify: async (signed) => signed === 'SIGNED-LIST'
  ? { ok: true, data: { issuedAt: NOW, subscriptions: [{ sku: 'wc_sub_commission', active: true }] } } : { ok: false, reason: 'no_iat' } });
assert.equal(fallback.ok, true);

// Grace runs from when Jest signed the proof, and an older proof never overrides a newer one.
const { priceCents } = await import('../src/systems/subscription.js');
const signedEarly = applyEntitlements(base, [{ sku: 'wc_sub_commission', active: true, issuedAt: NOW - 23 * 3600_000 }], NOW);
assert.equal(signedEarly.commission.verifiedAt, NOW - 23 * 3600_000);
assert.equal(commissionActive(signedEarly, NOW + 50 * 3600_000), false, 'a 23 h-old proof leaves 49 h of grace, not 72');
const cancelledNow = applyEntitlements(signedEarly, [{ sku: 'wc_sub_commission', active: false, issuedAt: NOW }], NOW);
const replayed = applyEntitlements(cancelledNow, [{ sku: 'wc_sub_commission', active: true, issuedAt: NOW - 3600_000 }], NOW + 60_000);
assert.equal(replayed.commission.active, false, 'replaying an older "active" proof after a cancel does nothing');
assert.equal(applyEntitlements(base, undefined, NOW), base, 'a malformed answer changes nothing');
// Shop terms come from the verified catalog.
const withTerms = applyEntitlements(base, [{ sku: 'wc_sub_commission', active: false, trialEligible: true, price: 999, currency: 'USD', billingPeriod: 'monthly' }], NOW);
assert.deepEqual(withTerms.commission.terms, { priceCents: 999, currency: 'USD', billingPeriod: 'monthly' });
assert.equal(priceCents(9.99), 999);
assert.equal(priceCents(599), 599);
assert.equal(priceCents(0), null);
const { renderCommissionCard } = await import('../src/ui/bridge.js');
assert.match(renderCommissionCard(withTerms, NOW), /Start 7-day free trial[\s\S]*Then \$9\.99\/month/);
assert.doesNotMatch(renderCommissionCard(base, NOW), /commission-subscribe/, 'no verified terms, no checkout button');

// Terms are a complete verified tuple or nothing: never kept from before, never invented.
const noTerms = applyEntitlements(withTerms, [{ sku: 'wc_sub_commission', active: false, trialEligible: true }], NOW + 1);
assert.equal(noTerms.commission.terms, null);
assert.doesNotMatch(renderCommissionCard(noTerms, NOW), /commission-subscribe/);
assert.equal(applyEntitlements(base, [{ sku: 'wc_sub_commission', active: false, price: 1299 }], NOW).commission.terms, null, 'no invented USD/monthly');
assert.equal(applyEntitlements(base, [null], NOW), base, 'a malformed member changes nothing');
// An old list that omits the Commission cannot revoke a newer active proof.
const fresh = applyEntitlements(base, [{ sku: 'wc_sub_commission', active: true, issuedAt: NOW }], NOW);
assert.equal(applyEntitlements(fresh, [], NOW + 1000, { issuedAt: NOW - 3600_000 }).commission.active, true);
assert.equal(applyEntitlements(fresh, [], NOW + 1000, { issuedAt: NOW + 500 }).commission.active, false);
// The cancel-save sheet uses Jest's offer and the verified renewal terms.
const { renderCommissionWinback } = await import('../src/ui/bridge.js');
const yearly = { commission: { retentionOffer: { price: 4999, durationPeriods: 1 }, terms: { priceCents: 7999, currency: 'USD', billingPeriod: 'yearly' } } };
const sheet = renderCommissionWinback(yearly);
assert.match(sheet, /\$49\.99\/year/);
assert.match(sheet, /returns to \$79\.99/);
assert.doesNotMatch(sheet, /\/mo\b|\$9\.99/);
assert.match(sheet, /for your next year\./);

// Partial terms left in an older save never show a checkout.
assert.doesNotMatch(renderCommissionCard({ ...base, commission: { trialEligible: true, terms: { priceCents: 999 } } }, NOW), /commission-subscribe/);

assert.equal(renderCommissionWinback({ commission: { retentionOffer: { price: 599, durationPeriods: 2 }, terms: null } }), '', 'no verified terms, no pitch');

console.log('subscription.test.mjs OK');
