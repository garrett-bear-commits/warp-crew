# Encounter Intelligence and Balance Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every current contract encounter legible, replace vague reward-family copy with live-derived currency ranges, and produce deterministic combat and 30-day free-player evidence without changing gameplay values.

**Architecture:** Add static encounter tells to the existing combat catalog, extract pure reward projections that both live resolution and evidence reuse, and keep reward bands as derived view data over production previews and ephemeral player copies. Add optional `now`/`rng` injection to existing transitions while preserving runtime defaults, then build focused deterministic report modules and thin CLI writers around those production seams.

**Tech Stack:** JavaScript ES modules, Vite 6, Node `assert`/`node:test`, existing HTML/CSS renderer, JSON and Markdown evidence artifacts, existing Grok subscription CLI workflow.

**Spec:** `docs/superpowers/specs/2026-09-22-encounter-intelligence-balance-evidence-design.md`

## Global Constraints

- Do not change any numeric reward, fuel, timer, power, probability, injury, hull-loss, upgrade, or progression value.
- Do not add encounters, contract profiles, currencies, offers, subscriptions, purchases, or paid-player assumptions.
- Do not add movement art, hull transformations, lore surfaces, or other visual packages.
- Do not claim real-device readiness, balanced pacing, economy approval, or monetization approval.
- Do not merge draft PR #1, publish Pages, upload to Jest, or activate Jest production.
- Do not use Flora or another image generator in this evidence-first package.
- Preserve saved-route identity, preview/commit validation, reload safety, and exact-once reward claims.
- Reward projections must call the same production payout helpers as live resolution; do not duplicate coefficients.
- Pre-resolution bands recompute from the current player snapshot; resolved contracts display only their stored claim result.
- Optional time and random dependencies must default to the current `Date.now` and `Math.random` behavior.
- The 30-day baseline uses one check-in every 24 hours and no ads, purchases, paid fuel, skips, premium grants, manual clock changes, catch-up, or compensation.
- The simulator must never use `forceComplete` to bypass expedition readiness.
- Phone-sized evidence covers 390 by 844 and 360 by 800 CSS pixels; it is not physical-device proof.
- Run a bounded read-only Grok audit after the first complete implementation diff and again before review-ready status. Grok receives no edit, commit, push, deploy, purchase, or production authority.

## File Map

- `src/systems/combat.js`: owns the 16 authored tells and unchanged combat-order math.
- `src/systems/contractRewards.js`: owns pure route/combat payout projections shared by live commits, reward bands, and reports.
- `src/systems/contracts.js`: owns fuel-feasible reward-path enumeration and optional transition time injection.
- `src/systems/sessionLoop.js`: builds encounter/reward view models, emits recommendation telemetry, and forwards `now`/`rng`.
- `src/ui/contractView.js`: renders literal bands, tell/recommendation copy, and accessible labels.
- `src/data/crewRoster.js`, `src/systems/player.js`, `src/systems/expedition.js`: expose deterministic creation and expedition-resolution seams while preserving live defaults.
- `src/sim/contractBalance.js`: constructs the production-preview combat matrix.
- `src/sim/contractEconomy.js`: runs and reconciles deterministic 30-day free-player strategies.
- `scripts/contract-balance-report.mjs`, `scripts/contract-economy-report.mjs`: serialize stable JSON/Markdown evidence from the simulation modules.
- `test/encounter_intelligence.test.mjs`, `test/contract_rewards.test.mjs`, `test/contract_balance.test.mjs`, `test/contract_economy.test.mjs`: focused TDD gates.
- `docs/qa/artifacts/encounter-balance-matrix.json`, `docs/qa/artifacts/contract-economy-30-day.json`: committed machine-readable evidence.
- `docs/qa/2026-09-22-encounter-balance-evidence.md`: concise human-readable findings and limits.

---

### Task 1: Deterministic Time and Identity Seams

**Files:**
- Modify: `src/data/crewRoster.js`
- Modify: `src/systems/player.js`
- Modify: `src/systems/contracts.js`
- Modify: `src/systems/sessionLoop.js`
- Modify: `src/systems/expedition.js`
- Create: `test/deterministic_seams.test.mjs`

**Interfaces:**
- Consumes: existing `createNewPlayer()`, `createCrewInstance()`, contract transitions, `wallClockProgress()`, and `resolveExpedition()`.
- Produces: `createCrewInstance(templateId, { level, stars, rank, instanceId, rng })`, `createNewPlayer({ captainName, now, rng })`, `acceptContract(player, offerId, now)`, `commitContractAction(player, preview, { rng, now })`, `claimContractReward(player, now)`, and `resolveExpedition(job, { rng, forceComplete, player, abortFrac, now })`.

- [ ] **Step 1: Write the failing deterministic-seam test**

```js
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { makeTimedJob, wallClockProgress } from '../src/shared/timer.js';
import { resolveExpedition } from '../src/systems/expedition.js';

const now = Date.UTC(2026, 8, 22, 12);
const makeRng = () => {
  const values = [0.25, 0.5];
  return () => values.shift() ?? 0.75;
};
const a = createNewPlayer({ captainName: 'Sim', now, rng: makeRng() });
const b = createNewPlayer({ captainName: 'Sim', now, rng: makeRng() });
assert.deepEqual(a, b);
assert.equal(a.createdAt, now);
assert.equal(a.fuelClaimAt, now);
assert.notEqual(a.crew[0].instanceId, a.crew[1].instanceId);

const job = makeTimedJob({ id: 'exp_test', kind: 'expedition', minutes: 60, startedAt: now, payload: { planetId: 'dustfall', crewInstanceIds: [], successChance: 1 } });
assert.equal(wallClockProgress(job, now + 59 * 60000).complete, false);
assert.equal(resolveExpedition(job, { now: now + 59 * 60000, rng: () => 0, player: a }).ready, false);
assert.equal(resolveExpedition(job, { now: now + 60 * 60000, rng: () => 0, player: a }).ready, true);
console.log('deterministic_seams.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/deterministic_seams.test.mjs`

Expected: FAIL because player/crew creation and expedition resolution do not yet consume the supplied dependencies.

- [ ] **Step 3: Inject deterministic player and crew creation**

Use one RNG stream and stable call order. Apply these exact signature/expression changes; all other returned fields retain their current source implementation.

```diff
-export function createCrewInstance(templateId, { level = 1, stars = 1, rank = 1 } = {}) {
+export function createCrewInstance(templateId, { level = 1, stars = 1, rank = 1, instanceId = null, rng = Math.random } = {}) {
@@
-    instanceId: `${templateId}_${Math.random().toString(36).slice(2, 9)}`,
+    instanceId: instanceId || `${templateId}_${rng().toString(36).slice(2, 9)}`,

-export function createNewPlayer({ captainName = 'Captain' } = {}) {
-  const now = Date.now();
+export function createNewPlayer({ captainName = 'Captain', now = Date.now(), rng = Math.random } = {}) {
   const crew = [
-    createCrewInstance('merc_rex'),
-    createCrewInstance('merc_bolt'),
+    createCrewInstance('merc_rex', { rng }),
+    createCrewInstance('merc_bolt', { rng }),
   ];
```

- [ ] **Step 4: Forward `now` through contract and expedition transitions**

Change only clock reads, not outcomes. Use `now` for acceptance IDs/timestamps, injury deadlines, claim day/elapsed analytics, and expedition progress.

```diff
-export function acceptContract(player, offerId) {
+export function acceptContract(player, offerId, now = Date.now()) {
@@
-    acceptedAt: Date.now(),
+    acceptedAt: now,

-export function commitContractAction(player, preview, { rng = Math.random } = {}) {
+export function commitContractAction(player, preview, { rng = Math.random, now = Date.now() } = {}) {

-export function claimContractReward(player) {
+export function claimContractReward(player, now = Date.now()) {

-export function resolveExpedition(job, { rng = Math.random, forceComplete = false, player = null, abortFrac = 1 } = {}) {
-  const { progress, complete } = wallClockProgress(job);
+export function resolveExpedition(job, { rng = Math.random, forceComplete = false, player = null, abortFrac = 1, now = Date.now() } = {}) {
+  const { progress, complete } = wallClockProgress(job, now);
```

In `sessionAction`, pass its existing `now` to `acceptContract`, `commitContractAction`, and `claimContractReward`. Add `now` to `abortPayoutFrac(job, now)` and pass it to `wallClockProgress(job, now)`.

- [ ] **Step 5: Run focused and regression checks**

Run: `node test/deterministic_seams.test.mjs && node test/contract_route.test.mjs && node test/session_loop.test.mjs && node test/travel_phase_a.test.mjs`

Expected: all four scripts PASS with unchanged live-default behavior.

- [ ] **Step 6: Commit**

```bash
git add src/data/crewRoster.js src/systems/player.js src/systems/contracts.js src/systems/sessionLoop.js src/systems/expedition.js test/deterministic_seams.test.mjs
git commit -m "refactor: add deterministic gameplay seams"
```

---

### Task 2: Authored Encounter Tells and Recommendation Telemetry

**Files:**
- Modify: `src/systems/combat.js`
- Modify: `src/systems/sessionLoop.js`
- Create: `test/encounter_intelligence.test.mjs`

**Interfaces:**
- Consumes: `ENCOUNTERS_V1`, `COMBAT_ORDERS`, `listCombatOrders()`, and `previewContractAction()`.
- Produces: a `tell` object on every encounter and telemetry fields `recommendedOrder` and `followedRecommendation` on every `combat_order_selected` event.

- [ ] **Step 1: Write the failing roster and view-model test**

```js
import assert from 'node:assert/strict';
import { COMBAT_ORDERS, ENCOUNTERS_V1 } from '../src/systems/combat.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { ensureContractBoard, acceptContract, previewContractAction, commitContractAction } from '../src/systems/contracts.js';
import { sessionModels, sessionAction } from '../src/systems/sessionLoop.js';

assert.equal(ENCOUNTERS_V1.length, 16);
for (const encounter of ENCOUNTERS_V1) {
  assert.ok(encounter.tell?.label?.trim(), encounter.id);
  assert.ok(encounter.tell?.text?.trim(), encounter.id);
  assert.ok(COMBAT_ORDERS[encounter.tell?.recommendedOrder], encounter.id);
  assert.ok(encounter.tell?.reason?.trim(), encounter.id);
}

let player = completeFreshTutorial();
player = { ...player, activeContract: null };
player = ensureContractBoard(player).player;
player = acceptContract(player, player.contractBoard.offers.find((x) => x.profile === 'risky').id).player;
player = commitContractAction(player, previewContractAction(player, { id: 'launch' }), { rng: () => 0 }).player;
player = commitContractAction(player, previewContractAction(player, { id: 'push' }), { rng: () => 0 }).player;
const ui = sessionModels(player, {}).activeContractView.combat;
assert.deepEqual(ui.tell, player.activeContract && ENCOUNTERS_V1.find((x) => x.id === player.activeContract.encounterId).tell);
assert.equal(ui.orders.filter((x) => x.recommended).length, 1);
const order = ui.orders.find((x) => x.recommended);
const result = sessionAction(player, { contractPreviews: { [`order:${order.id}`]: previewContractAction(player, { id: 'order', orderId: order.id }) } }, 'contract-order', { order: order.id, revision: player.activeContract.revision, acceptanceId: player.activeContract.acceptanceId }, { rng: () => 0 });
const event = result.events.find((x) => x.event === 'combat_order_selected');
assert.equal(event.fields.recommendedOrder, order.id);
assert.equal(event.fields.followedRecommendation, true);
console.log('encounter_intelligence.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/encounter_intelligence.test.mjs`

Expected: FAIL because tells are absent and Brace is still hardcoded as the recommendation.

- [ ] **Step 3: Add the approved 16-entry tell roster**

Add this static table beside `ENCOUNTERS_V1`, then spread `tell: ENCOUNTER_TELLS[id]` into each matching encounter object. Keep all existing IDs, power, rewards, blurb, win, and fail values byte-for-byte unchanged.

```js
const ENCOUNTER_TELLS = {
  pirate_scout: { label: 'Targeting engines.', text: "The scout is painting the Sparrow's engines, but its first volley is hurried.", recommendedOrder: 'brace', reason: 'Protect the tutorial crew and hull while the guaranteed counterattack lands.' },
  pirate_wing: { label: 'Formation tightening.', text: 'Three cutters are closing their ragged V around the Sparrow.', recommendedOrder: 'burn', reason: 'Spend 1F for +12 power before the displayed chance reaches its cap.' },
  scrapper_gang: { label: 'Grapples primed.', text: 'Cutting skiffs are drifting close enough to trade hull for salvage.', recommendedOrder: 'board', reason: 'Risk lower effective power for the higher rounded win payout shown.' },
  swarm_probe: { label: 'Signal about to jump.', text: 'The probe has finished mapping the ship and is turning for open dark.', recommendedOrder: 'burn', reason: 'Spend 1F for +12 power before the displayed chance reaches its cap.' },
  swarm_skirmish: { label: 'Pack spreading wide.', text: 'The hunting pack is separating to strike from both sides.', recommendedOrder: 'brace', reason: 'Halve failure hull loss and prevent crew injury if the pack gets through.' },
  swarm_frigate: { label: 'Core flare rising.', text: 'The remembered frigate is charging a broadside larger than the Sparrow.', recommendedOrder: 'brace', reason: 'Halve failure hull loss and prevent crew injury against the heavy shot.' },
  pirate_ace: { label: 'Attack vector committed.', text: 'The ace has traded distance for one clean firing pass.', recommendedOrder: 'burn', reason: 'Spend 1F for +12 power before the displayed chance reaches its cap.' },
  ice_raiders: { label: 'Boarding clamps open.', text: 'White-hulled corsairs are matching speed with their clamps exposed.', recommendedOrder: 'board', reason: 'Accept greater failure risk for the higher rounded win payout shown.' },
  swarm_brood: { label: 'Chitin cloud closing.', text: 'Half-grown probes are thickening around the shield line.', recommendedOrder: 'brace', reason: 'Halve failure hull loss and prevent crew injury if the brood reaches the hull.' },
  veil_wraith: { label: 'Blind angle moving.', text: 'The contact vanishes whenever sensors or crew look directly at it.', recommendedOrder: 'burn', reason: 'Spend 1F for +12 power before the displayed chance reaches its cap.' },
  corsair_king: { label: 'Flagship alongside.', text: 'The old captain is presenting a prize broadside and daring a boarding reply.', recommendedOrder: 'board', reason: 'Risk lower effective power for the higher rounded win payout shown.' },
  eclipse_echo: { label: 'War-form unfolding.', text: 'The echo is opening weapon limbs the Spur was never built to answer.', recommendedOrder: 'brace', reason: 'Halve failure hull loss and prevent crew injury if the war-form fires.' },
  ember_raider: { label: 'Breach team heating.', text: 'Raiders are welding toward Cargo while their own hull runs exposed.', recommendedOrder: 'burn', reason: 'Spend 1F for +12 power before the displayed chance reaches its cap.' },
  hollow_shade: { label: 'Name forming.', text: "A second line of writing is appearing beneath the crew's name on the hull.", recommendedOrder: 'brace', reason: 'Halve failure hull loss and prevent crew injury if the mark completes.' },
  crown_warden: { label: 'Verdict chambered.', text: 'The Warden has finished its warning and loaded a gold verdict round.', recommendedOrder: 'brace', reason: 'Halve failure hull loss and prevent crew injury if the verdict lands.' },
  eclipse_throne: { label: 'Halo collapsing inward.', text: "The Throne's halo is drawing every nearby signal toward its core.", recommendedOrder: 'burn', reason: 'Spend 1F for +12 power before the displayed chance reaches its cap.' },
};
```

- [ ] **Step 4: Replace hardcoded presentation and add telemetry**

```diff
-    reason: preview.reason || '', recommended: id === 'brace',
+    reason: preview.reason || '', recommended: id === encounter.tell.recommendedOrder,
@@
-    tell: { label: encounter.name, text: encounter.blurb, reason: 'Brace is recommended for hull and crew protection.' }, ...extra };
+    tell: encounter.tell, ...extra };
```

For both contract and Explore `combat_order_selected` events, include the encounter's authored recommendation and whether the chosen order matches it. Tutorial still exposes only Brace and remains guaranteed.

- [ ] **Step 5: Run focused tests**

Run: `node test/encounter_intelligence.test.mjs && node test/combat_orders.test.mjs && node test/session_loop.test.mjs && node test/explore_orders.test.mjs && node test/tutorial_v3.test.mjs`

Expected: all five scripts PASS and the existing numeric expectations remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/systems/combat.js src/systems/sessionLoop.js test/encounter_intelligence.test.mjs
git commit -m "feat: author encounter tells and recommendations"
```

---

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

### Task 5: Production-Preview Combat Balance Matrix

**Files:**
- Create: `src/sim/contractBalance.js`
- Create: `scripts/contract-balance-report.mjs`
- Create: `test/contract_balance.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: all 16 encounters, production contract preview, ready-crew power, combat bonuses, `rubberBandPower`, order modifiers, current fuel gates, and reward projections.
- Produces: `buildCombatBalanceMatrix({ now })`, `renderCombatBalanceMarkdown(matrix)`, and `npm run report:contract-balance`.

- [ ] **Step 1: Write the failing matrix test**

```js
import assert from 'node:assert/strict';
import { buildCombatBalanceMatrix } from '../src/sim/contractBalance.js';

const matrix = buildCombatBalanceMatrix({ now: Date.UTC(2026, 8, 22, 12) });
assert.equal(matrix.schemaVersion, 1);
assert.equal(matrix.encounters.length, 16);
assert.equal(matrix.ratios.length, 4);
assert.deepEqual(matrix.ratios, [0.75, 1, 1.25, 1.5]);
assert.equal(matrix.rows.length, 16 * 4 * 3);
for (const row of matrix.rows) {
  assert.ok(['brace', 'burn', 'board'].includes(row.orderId));
  assert.ok(row.winChance <= 0.94 || row.tutorialGuaranteed);
  assert.ok(Number.isFinite(row.effectivePower));
  assert.ok(Number.isFinite(row.rubberBandedEnemyPower));
  assert.ok(row.successRewards && row.failureRewards && row.expectedRewards);
  assert.equal(typeof row.enabled, 'boolean');
}
assert.deepEqual(buildCombatBalanceMatrix({ now: matrix.generatedAt }), matrix);
console.log('contract_balance.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/contract_balance.test.mjs`

Expected: module-not-found for `src/sim/contractBalance.js`.

- [ ] **Step 3: Build fixtures through the production preview path**

For each encounter and ratio, construct a minimal accepted contract at `stage: 'confrontation'` with ready crew whose summed power equals the requested pre-order ratio. Pass the fixture to `previewContractAction(player, { id: 'order', orderId })`; do not call `combatWinChance` directly for the displayed chance.

```js
const RATIOS = [0.75, 1, 1.25, 1.5];
const ORDERS = ['brace', 'burn', 'board'];
const preview = previewContractAction(fixture.player, { id: 'order', orderId });
rows.push({
  encounterId: encounter.id,
  ratio,
  orderId,
  enabled: preview.ok,
  effectivePower: preview.consequence.effectivePower,
  rubberBandedEnemyPower: preview.consequence.enemyPower,
  winChance: preview.consequence.chance,
  fuel: preview.cost.fuel,
  successRewards,
  failureRewards,
  expectedRewards: weightedCurrency(successRewards, failureRewards, preview.consequence.chance),
  failureHullMultiplier: COMBAT_ORDERS[orderId].failureHullScale ?? 1,
  failureInjuryPolicy: COMBAT_ORDERS[orderId].preventsInjury ? 'prevented' : COMBAT_ORDERS[orderId].forcesFailureInjury ? 'forced' : 'normal',
});
```

Use the shared payout helper with deterministic success/failure RNG to get post-floor currency objects.

- [ ] **Step 4: Add a stable CLI report**

`scripts/contract-balance-report.mjs` imports the module, serializes keys in stable construction order, writes only when content differs, and prints row counts plus output paths. Add:

```json
"report:contract-balance": "node scripts/contract-balance-report.mjs"
```

The Markdown groups rows by encounter and makes order dominance visible without declaring a target or approval verdict.

- [ ] **Step 5: Run determinism and report gates**

Run: `node test/contract_balance.test.mjs && npm run report:contract-balance && git diff --exit-code -- docs/qa/artifacts/encounter-balance-matrix.json docs/qa/2026-09-22-encounter-balance-evidence.md`

Expected: test PASS; the generator is idempotent after the first artifact write.

- [ ] **Step 6: Commit**

```bash
git add src/sim/contractBalance.js scripts/contract-balance-report.mjs test/contract_balance.test.mjs package.json docs/qa/artifacts/encounter-balance-matrix.json docs/qa/2026-09-22-encounter-balance-evidence.md
git commit -m "test: add deterministic contract balance matrix"
```

---

### Task 6: Deterministic 30-Day Free-Player Economy Simulator

**Files:**
- Create: `src/sim/contractEconomy.js`
- Create: `scripts/contract-economy-report.mjs`
- Create: `test/contract_economy.test.mjs`
- Modify: `package.json`
- Modify: `docs/qa/2026-09-22-encounter-balance-evidence.md`

**Interfaces:**
- Consumes: production player/tutorial creation, fuel regeneration, session actions, contract preview/commit/claim, expedition preview/start/resolve, reward grant, crew XP/injury, `nextUpgradeCost()`, and `upgradeSystem()`.
- Produces: `STRATEGIES`, `createSeededRng(seed)`, `simulateFreePlayer30Days({ seed, strategy, startAt })`, `runEconomySeedSet({ seeds, startAt })`, `reconcileLedger(run)`, and `npm run report:contract-economy`.

- [ ] **Step 1: Write the failing repeatability and conservation test**

```js
import assert from 'node:assert/strict';
import { STRATEGIES, simulateFreePlayer30Days, reconcileLedger } from '../src/sim/contractEconomy.js';

const startAt = Date.UTC(2026, 8, 22, 12);
for (const strategy of Object.keys(STRATEGIES)) {
  const a = simulateFreePlayer30Days({ seed: 4219, strategy, startAt });
  const b = simulateFreePlayer30Days({ seed: 4219, strategy, startAt });
  assert.deepEqual(a, b, strategy);
  assert.equal(a.days.length, 30);
  assert.equal(a.policy.ads, false);
  assert.equal(a.policy.purchases, false);
  assert.equal(a.policy.skips, false);
  assert.equal(a.policy.forceComplete, false);
  assert.deepEqual(reconcileLedger(a), { ok: true, differences: {} });
  assert.ok(a.days.every((day, index) => day.now === startAt + index * 86400000));
}
console.log('contract_economy.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/contract_economy.test.mjs`

Expected: module-not-found for `src/sim/contractEconomy.js`.

- [ ] **Step 3: Encode the three approved strategies as data**

```js
export const STRATEGIES = {
  cautious: { profiles: ['reliable', 'strange', 'risky'], route: 'secure', order: 'brace' },
  balanced: { profiles: ['strange', 'reliable', 'risky'], secureUnlessPushLeavesFuel: 2, burnGain: 0.10, burnFuelFloor: 1 },
  ambitious: { profiles: ['risky', 'strange', 'reliable'], route: 'push', boardChanceFloor: 0.75 },
};
```

Thresholds stay simulator-only. System improvement chooses the cheapest affordable item returned by `nextUpgradeCost(player, system)` and applies it only through `upgradeSystem(player, system)`.

- [ ] **Step 4: Drive the fresh tutorial through production transitions**

Create the fresh player with injected `now`/`rng`, then drive the same production sequence the UI uses: review distress, accept, launch, Brace, claim, `tutorial-draw`, accept the first normal offer, select Dustfall crew through production recommendations, and start the expedition. Do not import `test/helpers/tutorialFlow.mjs` and do not set `tutorial.completed` directly. Define these simulator-local adapters so every call receives the current UI state and production preview tokens:

```js
function applyTransition(player, ui, result) {
  if (!result?.ok) throw new Error(`simulation transition failed: ${result?.reason || 'unknown'}`);
  return { player: result.player, ui: { ...ui, ...(result.ui || {}) } };
}

function contractIdentity(player, fields = {}) {
  return {
    ...fields,
    revision: player.activeContract.revision,
    acceptanceId: player.activeContract.acceptanceId,
  };
}

function actionUi(player, ui, now) {
  const models = sessionModels(player, ui, now);
  return { ...ui, contractPreviews: models.contractPreviews };
}
```

```js
let result = sessionAction(player, ui, 'contract-review', { offer: distress.id }, deps);
({ player, ui } = applyTransition(player, ui, result));
result = sessionAction(player, ui, 'contract-accept', { offer: distress.id }, deps);
({ player, ui } = applyTransition(player, ui, result));
result = sessionAction(player, actionUi(player, ui, now), 'contract-action', contractIdentity(player, { action: 'launch' }), deps);
({ player, ui } = applyTransition(player, ui, result));
result = sessionAction(player, actionUi(player, ui, now), 'contract-order', contractIdentity(player, { order: 'brace' }), deps);
({ player, ui } = applyTransition(player, ui, result));
result = sessionAction(player, ui, 'contract-claim', contractIdentity(player, { action: 'claim' }), deps);
({ player, ui } = applyTransition(player, ui, result));
result = sessionAction(player, ui, 'tutorial-draw', {}, deps);
```

- [ ] **Step 5: Implement one natural daily check-in**

Day 1 includes the production tutorial sequence above. At each exact 24-hour boundary, including the remainder of day 1 after onboarding:

1. apply the production daily-login transition with the same tutorial reward hold used by `hydratePlayer`, then call `claimFuelRegen(player, now)` and record fuel gained plus cap waste;
2. call `tickCrewStatus(player, now)` so naturally recovered injuries return to ready status;
3. if an expedition is naturally ready, call `resolveExpedition(job, { now, rng, player })`, then pass it to the shared `applyExpeditionResult(player, result, { now })` transition;
4. choose and start one visible expedition through `sessionAction` `exp-choose` and `exp-start`, which use the production recommendation, validation, preview, and start APIs;
5. choose one offer by strategy priority and execute only production-valid route/order previews;
6. claim the stored contract result through `claimContractReward(player, now)`;
7. compare all current ship systems through `nextUpgradeCost`, upgrade the cheapest affordable system through `upgradeSystem`, or save;
8. record all stopped/blocked actions instead of bypassing validation.

Extract the expedition claim mutation from `finishExpeditionResult` and expose this exact interface:

```js
export function applyExpeditionResult(player, result, { now = Date.now() } = {}) {
  return { ok: true, player: nextPlayer, result };
}
```

Move the existing `finishExpeditionResult` player mutation to that helper and leave only log/toast/SFX in `main.js`.

- [ ] **Step 6: Record and reconcile the ledger**

Each day records start/end wallet, hull, chosen offer, route/order/chance/outcome, fuel gained/spent/wasted, blocked actions, rewards by source, improvement cost, affordability gaps, injury state, milestones, and useful-action status. Aggregate sources/sinks by currency and verify:

```js
for (const currency of ['credits', 'fuel', 'gems', 'medals', 'reputation']) {
  differences[currency] = run.finalWallet[currency] - run.initialWallet[currency]
    - run.totals.sources[currency] + run.totals.sinks[currency];
}
```

An empty difference object is the conservation PASS. Record fuel discarded at cap separately from wallet sinks.

- [ ] **Step 7: Generate fixed-seed JSON and concise Markdown**

Use the documented fixed seed set `[4219, 17031, 88421, 240911, 990001]` for each strategy. Report median and worst seed for useful-session completion, fuel-starved days, end-wallet accumulation, and upgrade cadence. Do not provide target bands or tuning recommendations.

Add:

```json
"report:contract-economy": "node scripts/contract-economy-report.mjs",
"test:balance": "node test/deterministic_seams.test.mjs && node test/encounter_intelligence.test.mjs && node test/contract_rewards.test.mjs && node test/contract_balance.test.mjs && node test/contract_economy.test.mjs && npm run report:contract-balance && npm run report:contract-economy"
```

- [ ] **Step 8: Run simulation and regression gates**

Run: `node test/contract_economy.test.mjs && npm run test:balance && npm run test:loop && npm test`

Expected: all tests PASS; rerunning both reports yields no artifact diff.

- [ ] **Step 9: Commit**

```bash
git add src/sim/contractEconomy.js src/systems/expedition.js src/main.js scripts/contract-economy-report.mjs test/contract_economy.test.mjs package.json docs/qa/artifacts/contract-economy-30-day.json docs/qa/2026-09-22-encounter-balance-evidence.md
git commit -m "test: add deterministic free economy projection"
```

---

### Task 7: First Complete-Diff Grok Audit and Reconciliation

**Files:**
- Create: `docs/audits/2026-09-22-encounter-balance-implementation-audit.md`
- Modify only if findings are accepted: files named by the verified finding

**Interfaces:**
- Consumes: exact package base/HEAD, approved spec, implementation diff, automated test ledger, and generated artifacts.
- Produces: a substantive bounded verdict with each finding classified as accepted, rejected with source evidence, or unresolved.

- [ ] **Step 1: Establish the exact audit range and clean scope**

Run:

```bash
git status --short
git rev-parse fb21912
git rev-parse HEAD
git diff --stat fb21912...HEAD
git diff --check fb21912...HEAD
```

Expected: only package files plus the two pre-existing untracked user files (`Mobile Game UI.jpg`, `package-lock.json`); no merge, deployment, or production changes.

- [ ] **Step 2: Run the complete local evidence gate before delegation**

Run: `npm run test:balance && npm run test:loop && npm test && npm run build`

Expected: every command PASS. Record exact commands and results; do not describe unrun checks as passing.

- [ ] **Step 3: Request the bounded read-only Grok audit**

Use the `grok-subscription-delegation` skill. Give Grok:

- base `fb21912` and the exact current HEAD;
- the approved spec and scoped diff;
- the test ledger and generated reports;
- a request for `APPROVE` or `REQUEST CHANGES` with Critical/Important findings only;
- explicit prohibitions on edits, commits, pushes, deploys, purchases, PR merge, and Jest activation.

If Grok times out or returns no substantive verdict, record `unavailable`; never infer approval.

- [ ] **Step 4: Verify every finding against source and tests**

For an accepted finding, first add a failing focused test, run it RED, implement the smallest fix, rerun focused plus affected regression gates, and commit:

```bash
git add -p
git commit -m "fix: reconcile encounter evidence audit"
```

For a rejected finding, cite the exact production path/test proving it false. Do not implement speculative suggestions or numeric tuning.

- [ ] **Step 5: Write the audit ledger and rerun the full gate**

The audit document records prompt scope, base/HEAD, verdict, raw finding summary, disposition, verification command, and remaining unknowns. Run: `npm run test:balance && npm run test:loop && npm test && npm run build && git diff --check fb21912...HEAD`

Expected: PASS with no open Critical or Important finding.

- [ ] **Step 6: Commit the reconciliation ledger**

```bash
git add docs/audits/2026-09-22-encounter-balance-implementation-audit.md
git commit -m "docs: record encounter evidence implementation audit"
```

---

### Task 8: Phone-Sized Runtime Evidence, Final Audit, and Handoff

**Files:**
- Create: `docs/qa/artifacts/encounter-intelligence-390x844.png`
- Create: `docs/qa/artifacts/encounter-intelligence-360x800.png`
- Create: `docs/qa/artifacts/encounter-intelligence-reduced-motion.png`
- Modify: `docs/qa/2026-09-22-encounter-balance-evidence.md`
- Modify: `docs/audits/2026-09-22-encounter-balance-implementation-audit.md`
- Modify: `docs/NEXT.md`
- Modify: `docs/handoffs/2026-09-21-stopping-point.md`

**Interfaces:**
- Consumes: completed implementation, generated evidence, first Grok disposition, and local browser runtime.
- Produces: phone-sized screenshots/measurements, final read-only Grok verdict, exact verification ledger, and the next owner decision.

- [ ] **Step 1: Start the local production-like preview**

Run: `npm run build && npm run preview -- --port 4173`

Expected: Vite serves the built app locally. Do not publish Pages or touch Jest.

- [ ] **Step 2: Capture 390×844 and 360×800 interaction evidence**

At each viewport, use `?fresh=1`, complete the tutorial through production controls, and capture:

- Contract Board with a long literal payout range;
- review sheet with the identical visible and accessible range;
- encounter tell plus all enabled orders and exactly one recommendation;
- keyboard focus on an order and a contract action;
- measured action boxes at least 44×44 CSS pixels;
- measured essential consequence text at least 16px;
- no horizontal overflow or clipped dialog content.

Save screenshots under the exact paths listed above and add measured values plus browser/viewport details to the QA document.

- [ ] **Step 3: Capture reduced-motion evidence**

Emulate `prefers-reduced-motion: reduce`, repeat an encounter state, and prove the tell, recommendation, chances, costs, payouts, and consequences remain available without shake, camera motion, or reward-flight particles. Save the screenshot and record that this is emulation, not a physical-device run.

- [ ] **Step 4: Run the final automated gate**

Run: `npm run test:balance && npm run test:loop && npm test && npm run test:ship && npm run build && git diff --check fb21912...HEAD`

Expected: all commands PASS. Rerun report scripts and verify no generated-artifact diff.

- [ ] **Step 5: Request the final bounded Grok audit**

Use the same read-only constraints as Task 7, now including runtime screenshots, measured accessibility evidence, the first audit dispositions, and the exact final base/HEAD. Require `APPROVE` or `REQUEST CHANGES`; unavailable is not approval. Apply accepted fixes only through a new failing test and rerun every affected gate.

- [ ] **Step 6: Update continuation documents without claiming release authority**

Record:

- exact commits and diff range;
- tests actually run and their outcomes;
- report artifact paths and the evidence limits;
- both Grok verdicts and dispositions;
- browser-emulation evidence and explicit lack of physical-device proof;
- that numeric tuning, monetization work, Flora art, PR #1 merge, Pages publication, Jest upload, and Jest production activation remain separately gated;
- the recommended next package based on evidence, phrased as a proposal requiring owner approval.

- [ ] **Step 7: Commit the final evidence and handoff**

```bash
git add docs/qa/artifacts/encounter-intelligence-390x844.png docs/qa/artifacts/encounter-intelligence-360x800.png docs/qa/artifacts/encounter-intelligence-reduced-motion.png docs/qa/2026-09-22-encounter-balance-evidence.md docs/audits/2026-09-22-encounter-balance-implementation-audit.md docs/NEXT.md docs/handoffs/2026-09-21-stopping-point.md
git commit -m "docs: close encounter evidence package"
```

- [ ] **Step 8: Stop at the owner gate**

Report the package outcome and the proposed next package. Do not merge PR #1, publish, upload, activate Jest production, change economy numbers, begin monetization, or generate art without a new explicit owner decision.
