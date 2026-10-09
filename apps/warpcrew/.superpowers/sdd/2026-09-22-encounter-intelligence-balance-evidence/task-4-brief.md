### Task 4: Reward-Band and Combat-Intelligence UI

**Files:**
- Modify: `src/systems/contracts.js`
- Modify: `src/systems/sessionLoop.js`
- Modify: `src/ui/contractView.js`
- Modify: `test/contract_ui.test.mjs`
- Modify: `test/session_loop.test.mjs`

**Interfaces:**
- Consumes: `contractRewardBand()`, `formatRewardBand()`, encounter tells, and existing contract/combat view models.
- Produces: board/review `rewardBand` objects, shared literal visible/accessibility labels, invalid-content acceptance gating, and resolved-result-only claim copy.

- [ ] **Step 1: Add failing UI assertions**

```js
assert.match(boardHtml, /Possible payout now/);
assert.match(boardHtml, /credits/);
assert.doesNotMatch(boardHtml, /Expected reward/);
assert.match(boardHtml, new RegExp(escapeRegex(boardModel.offers[0].rewardBand.label)));
assert.match(reviewHtml, /<dt>Possible payout now<\/dt>/);
assert.match(reviewHtml, new RegExp(`aria-label="[^"]*${escapeRegex(reviewModel.rewardBand.label)}`));
assert.match(combatHtml, /Recommended/);
assert.match(combatHtml, new RegExp(escapeRegex(combatModel.tell.reason)));
assert.equal(invalidReview.enabled, false);
assert.equal(invalidReview.rewardBand.label, 'Reward unavailable');
```

Also assert that a `stage: 'return'` active contract displays its stored `result.rewardLabel` and does not recompute or display `Possible payout now`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node test/contract_ui.test.mjs && node test/session_loop.test.mjs`

Expected: FAIL because board cards still display reward families and review copy still says `Expected reward`.

- [ ] **Step 3: Populate derived view models**

In `sessionModels`, derive the band on each render for unresolved offers and reviews.

```js
const band = contractRewardBand(player, offer, { now });
return {
  ...offer,
  rewardBand: band,
  primaryReward: band.label,
  enabled: band.available && !offer.completed,
};
```

Keep the stored result path unchanged. In the `sessionAction` `contract-accept` branch, derive the reviewed offer's band before calling `acceptContract` and return `reward_unavailable` when `available` is false; `acceptContract` remains the low-level saved-route transition used by the enumerator.

- [ ] **Step 4: Render one shared literal label**

Update card facts, review facts, and button/dialog accessible labels to use `rewardBand.label`. Replace `Expected reward` with `Possible payout now`. Do not add a new modal or navigation surface.

```js
const rewardLabel = (offer) => offer.rewardBand?.label || offer.primaryReward || 'Reward unavailable';
// Card fact:
`<div><dt>Possible payout now</dt><dd>${e(rewardLabel(offer))}</dd></div>`
```

Keep `renderCombatOrders` unselected: recommendation is a badge/reason only, never `aria-pressed` and never a hidden bonus.

- [ ] **Step 5: Run UI and loop tests**

Run: `node test/contract_ui.test.mjs && node test/session_loop.test.mjs && npm run test:loop`

Expected: all checks PASS; literal range strings match between visible and accessible copy.

- [ ] **Step 6: Commit**

```bash
git add src/systems/contracts.js src/systems/sessionLoop.js src/ui/contractView.js test/contract_ui.test.mjs test/session_loop.test.mjs
git commit -m "feat: show live payout ranges and encounter guidance"
```

---

