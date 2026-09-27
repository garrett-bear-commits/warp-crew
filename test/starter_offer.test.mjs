import assert from 'node:assert/strict';
import { evaluateStarterOffer, starterOfferState, markStarterOffer, starterValue, STARTER_OFFER } from '../src/systems/offers.js';
import { renderStarterOffer } from '../src/ui/bridge.js';

const now = Date.UTC(2030, 8, 22, 12);
const captain = (stats) => ({ tutorial: { script: 5, phase: 'done', completed: true }, wallet: { gems: 0 }, iapFulfilled: [], stats });

// Never during the first session or before the Shop exists.
assert.equal(evaluateStarterOffer({ tutorial: { script: 5, phase: 'fight', completed: false }, stats: { contractsLost: 1 } }, now).offers, undefined);
assert.equal(evaluateStarterOffer(captain({ contractsCompleted: 1, contractsLost: 1 }), now).offers, undefined, 'shop still locked');

// Triggers: first loss once the Shop is open, or the third post-tutorial contract.
const afterLoss = evaluateStarterOffer(captain({ contractsCompleted: 2, contractsLost: 1 }), now);
assert.equal(afterLoss.offers.starter.reason, 'first_loss');
const settled = evaluateStarterOffer(captain({ contractsCompleted: STARTER_OFFER.contractsTrigger, contractsLost: 0 }), now);
assert.equal(settled.offers.starter.reason, 'settled_in');
assert.equal(evaluateStarterOffer(captain({ contractsCompleted: 3, contractsLost: 0 }), now).offers, undefined);

// One trigger, one real 48-hour window, one purchase.
assert.equal(evaluateStarterOffer(afterLoss, now + 1000), afterLoss, 'triggers once');
let state = starterOfferState(afterLoss, now);
assert.equal(state.active, true);
assert.equal(state.showModal, true);
assert.equal(starterOfferState(markStarterOffer(afterLoss, { seen: true }), now).showModal, false, 'dismissed pop-up stays in the Shop');
assert.equal(starterOfferState(markStarterOffer(afterLoss, { seen: true }), now).active, true);
assert.equal(starterOfferState(afterLoss, now + STARTER_OFFER.windowMs).active, false, 'the timer is real');
assert.equal(starterOfferState(markStarterOffer(afterLoss, { purchased: true }), now).active, false, 'bought once');

// The saving line is computed from live pack prices and never invented.
const products = [
  { sku: 'wc_fuel_5', price: 0.99 }, { sku: 'wc_gems_100', price: 1.99 }, { sku: 'wc_gems_500', price: 7.99 }, { sku: 'wc_starter', price: 4.99 },
];
const value = starterValue(products);
assert.ok(value.worth > value.price, 'the kit is genuinely cheaper than its gems and fuel');
assert.ok(value.savedPct > 0 && value.savedPct < 100);
assert.equal(starterValue(products.map(p => p.sku === 'wc_starter' ? { ...p, price: 99 } : p)).savedPct, 0, 'no fake discount when it is not cheaper');
assert.equal(starterValue([]), null);
state = starterOfferState(afterLoss, now);
const html = renderStarterOffer(state, value);
assert.match(html, /One time only · 48h 0m left/);
assert.match(html, new RegExp(`Save ${value.savedPct}%`));
assert.match(html, /data-act="iap-buy" data-sku="wc_starter">\$4\.99/);
assert.match(html, /data-act="starter-dismiss"/);
assert.doesNotMatch(renderStarterOffer(state, { ...value, savedPct: 0 }), /Save \d/);

console.log('starter_offer.test.mjs OK');
