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

// The value line compares with the same-price gem pack and never invents a saving.
const products = [
  { sku: 'wc_gems_s', price: 1.99 }, { sku: 'wc_gems_m', price: 4.99 }, { sku: 'wc_gems_l', price: 9.99 },
  { sku: 'wc_starter_kit', price: 4.99 },
];
const value = starterValue(products);
assert.equal(value.rung.sku, 'wc_gems_m');
assert.equal(value.gemValue, 350, '250 gems plus 10 fuel at 10 gems each');
assert.equal(value.morePct, 25);
assert.equal(starterValue(products.map(p => p.sku === 'wc_starter_kit' ? { ...p, price: 99 } : p)).morePct, 0, 'no claim when it is not better value');
assert.equal(starterValue([]), null);
assert.equal(starterOfferState({ ...afterLoss, oneTimePurchases: ['wc_starter_kit'] }, now).active, false, 'owned kit never shows again');
state = starterOfferState(afterLoss, now);
const html = renderStarterOffer(state, value);
assert.match(html, /One time only · 48h 0m left/);
assert.match(html, /25% more than the \$4\.99 Gem Pack \(280 gems\)/);
assert.match(html, /data-act="iap-buy" data-sku="wc_starter_kit">\$4\.99/);
assert.match(html, /data-act="starter-dismiss"/);
assert.doesNotMatch(renderStarterOffer(state, { ...value, morePct: 0 }), /more than the/);

console.log('starter_offer.test.mjs OK');
