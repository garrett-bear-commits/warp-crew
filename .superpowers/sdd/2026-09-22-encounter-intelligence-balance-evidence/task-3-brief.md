### Task 3: Shared Payout Projection and Live Reward Bands

**Files:**
- Create: `src/systems/contractRewards.js`
- Modify: `src/systems/contracts.js`
- Create: `test/contract_rewards.test.mjs`

**Interfaces:**
- Consumes: `resolveCombatOrder()`, `scaleSitePayout()`, `tradePayout()`, saved `routeContent`, production preview/commit validation, and current player modifiers.
- Produces: `readyContractCrew(player)`, `normalizeCurrencyReward(reward)`, `resolveRoutePayout(player, contract, selectedOutcome)`, `resolveContractCombatPayout(player, contract, orderId, { rng, now })`, `formatRewardBand(band)`, and `contractRewardBand(player, offer, { now })`.

- [ ] **Step 1: Write failing shared-helper tests**

```js
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { ensureContractBoard, contractRewardBand } from '../src/systems/contracts.js';
import { formatRewardBand } from '../src/systems/contractRewards.js';

const now = Date.UTC(2026, 8, 22, 12);
let player = createNewPlayer({ now, rng: () => 0.1 });
player = { ...player, tutorial: { ...player.tutorial, completed: true, phase: 'done' }, story: { ...player.story, chapter: 1 }, wallet: { ...player.wallet, fuel: 10 } };
player = ensureContractBoard(player, now).player;

for (const profile of ['reliable', 'risky', 'strange']) {
  const offer = player.contractBoard.offers.find((x) => x.profile === profile);
  const band = contractRewardBand(player, offer, { now });
  assert.equal(band.available, true, profile);
  assert.ok(band.paths.length > 0, profile);
  assert.equal(formatRewardBand(band), band.label);
}

assert.equal(formatRewardBand({ available: true, currencies: { credits: { min: 120, max: 120, presentOnAllPaths: true }, medals: { min: 0, max: 8, presentOnAllPaths: false } } }), '120 credits · up to 8 medals');
assert.deepEqual(contractRewardBand(player, { ...player.contractBoard.offers[0], routeContent: null }, { now }), { available: false, label: 'Reward unavailable', currencies: {}, paths: [] });
console.log('contract_rewards.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/contract_rewards.test.mjs`

Expected: module/import failure because shared payout helpers and `contractRewardBand` do not exist.

- [ ] **Step 3: Extract production-owned payout helpers**

Move existing `readyContractCrew`, route/story payout, and the complete combat outcome mutation from private `contracts.js` branches into `contractRewards.js`. The combat helper must preserve hull loss, injury selection/deadline, XP, win statistics, summary text, and reward operation order exactly; its only behavioral change is replacing the injury `Date.now()` read with the supplied `now`.

```js
export const CURRENCIES = ['credits', 'medals', 'reputation', 'gems', 'fuel'];

export function normalizeCurrencyReward(reward = {}) {
  return Object.fromEntries(CURRENCIES.map((key) => [key, Number(reward[key]) || 0]));
}

export function readyContractCrew(player) {
  return (player.crew || []).filter((member) => member.status === 'ready');
}

export function resolveRoutePayout(player, contract, selectedOutcome = contract.routeOutcome) {
  const outcome = selectedOutcome || {};
  const visits = player.stats?.visits?.[contract.destinationId] || 0;
  let base = normalizeCurrencyReward(outcome);
  const kind = outcome.kind || 'salvage';
  const storyFlag = kind === 'story' ? outcome.flag || contract.storyFlag || null : null;
  if (kind === 'story') {
    const applied = applyStoryFlag(player, storyFlag);
    base = normalizeCurrencyReward(applied.rewards || { credits: 40, reputation: 3 });
  }
  let rewards = scaleSitePayout(base, player, { kind, visits });
  if (kind === 'trade' || kind === 'delivery') {
    rewards = { ...rewards, credits: tradePayout(rewards.credits, readyContractCrew(player)) };
  }
  return {
    success: true,
    rewards: normalizeCurrencyReward(rewards),
    hullLoss: 0,
    injuredCrewId: null,
    storyFlag,
    summary: kind === 'story' ? 'The signal resolves into a discovery.' : 'The contract closes cleanly.',
  };
}

export function resolveContractCombatPayout(player, contract, orderId, { rng = Math.random, now = Date.now() } = {}) {
  const encounter = encounterById(contract.encounterId);
  const crew = readyContractCrew(player);
  const bonus = combatBonuses(player, encounter);
  const playerPower = crewPower(crew) + bonus.extraPower;
  const enemyPower = Math.max(6, Math.round(rubberBandPower(encounter.power, playerPower) * bonus.enemyScale));
  const result = resolveCombatOrder({
    playerPower,
    enemyPower,
    orderId,
    encounter,
    fuel: (player.wallet?.fuel ?? 0) + (orderId === 'burn' ? 1 : 0),
    tutorialGuaranteed: contract.profile === 'distress',
    rng,
  });
  const visits = player.stats?.visits?.[contract.destinationId] || 0;
  const rewards = contract.profile === 'distress'
    ? normalizeCurrencyReward(result.rewards)
    : normalizeCurrencyReward(scaleSitePayout(result.rewards, player, { kind: 'combat', visits }));
  return { combat: result, crew, rewards, now };
}
```

`commitContractAction` must call these helpers. Do not leave a copied reward branch in `contracts.js`.

- [ ] **Step 4: Enumerate only fuel-feasible production paths**

`contractRewardBand` accepts either a board offer or its saved accepted equivalent. For each saved Secure/Push route, create a JSON-safe ephemeral player, accept the matching offer, then advance it only through `previewContractAction` and `commitContractAction`. For random terminal outcomes, call commit once with `rng: () => 0` and once with `rng: () => 1`; include only previews with `ok === true`. The tutorial uses the same guaranteed Brace branch. Deduplicate identical terminal reward objects and never mutate the supplied player.

```js
const outcomes = [() => 0, () => 1];
for (const rng of outcomes) {
  const copy = JSON.parse(JSON.stringify(player));
  const preview = previewContractAction(copy, action);
  if (!preview.ok) continue;
  const result = commitContractAction(copy, preview, { rng, now });
  if (result.ok && result.result?.rewards) paths.push(normalizeCurrencyReward(result.result.rewards));
}
```

Implement the sequence in a private `enumerateRewardPaths` helper in `contracts.js`; it must still call production preview/commit and the shared payout helpers. Keep saved-content validation separate from UI band derivation so `acceptContract` itself does not call `contractRewardBand` and cannot recurse.

- [ ] **Step 5: Add exhaustive edge-case assertions**

Extend `test/contract_rewards.test.mjs` to assert:

```js
assert.equal(JSON.stringify(player), before, 'band mutated player');
assert.ok(band.paths.every((path) => Object.values(path).every(Number.isFinite)));
assert.ok(!band.paths.some((path) => path.__disabledOrder));
assert.equal(tutorialBand.paths.length, 1);
assert.equal(tutorialBand.label, '120 credits · 8 medals · 4 reputation');
assert.notDeepEqual(contractRewardBand(modifiedPlayer, offer, { now }).currencies, band.currencies, 'live modifiers must recompute');
```

Cover reliable, risky, strange, tutorial, success, failure, Board flooring, repeat visits, zero minima, insufficient Burn fuel, reload-preserved route identity, and invalid saved content.

- [ ] **Step 6: Run focused and regression tests**

Run: `node test/contract_rewards.test.mjs && node test/contract_route.test.mjs && node test/contract_board.test.mjs && node test/combat_orders.test.mjs`

Expected: all four scripts PASS; prior exact payout assertions remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/systems/contractRewards.js src/systems/contracts.js test/contract_rewards.test.mjs
git commit -m "feat: derive live contract reward bands"
```

---

