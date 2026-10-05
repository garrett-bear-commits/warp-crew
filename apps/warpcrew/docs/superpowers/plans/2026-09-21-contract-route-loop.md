# Contract Route and First-Session Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace instant mission-map outcomes with a persistent three-offer Contract Board, short route decisions, Brace/Burn/Board combat orders, a production-system tutorial, explicit expedition party choice, and a compact repeatable daily loop.

**Architecture:** Add contract content and a pure contract state machine beside the existing node/travel systems. Keep Explore travel as a compatibility path, but make Contracts the Missions default and route every new-loop mutation through preview/commit APIs with revision checks. Split rendering into a focused contract UI module, leave `main.js` as orchestration, migrate saves additively to version 7, and verify behavior with deterministic Node tests plus browser-sized interaction evidence.

**Tech Stack:** JavaScript ES modules, Vite 6, Canvas/CSS/HTML UI, Node assertion scripts, localStorage save envelope, existing Jest platform facade.

**Spec:** `docs/superpowers/specs/2026-09-21-contract-route-loop-design.md`

## Global Constraints

- Do not deploy, activate production, publish, or change external services.
- Preserve the existing Sparrow geometry manifest and grounded Ninefold animation behavior.
- Do not add a runtime dependency.
- `TUTORIAL_SCRIPT` becomes `3`; save version becomes `7`.
- A board contains exactly Reliable, Risky, and Strange offers and remains stable across reload.
- Accept/review spends no fuel; each paid route action charges once; reward claim grants once.
- Every route mutation requires the saved stage and revision it previewed.
- The tutorial and one normal contract must fit within the fresh account's free fuel.
- No store, gem price, fuel purchase, gacha pull, or paid prompt appears before tutorial completion.
- All player-facing combat uses Brace, Burn, or Board; scripted tutorial odds say `Guaranteed`.
- All functional outcomes remain earnable through play.
- Contract rewards use current reward sources and `scaleSitePayout()`; Board alone adds 25% credits and medals.
- Phone evidence covers 390 by 844 and 360 by 800 CSS pixels.
- Every action is at least 44 by 44 CSS pixels; essential consequence text is at least 16px.
- Reduced motion preserves every state and consequence without shake, camera motion, or reward-flight particles.
- Existing wallet, crew, reserve, ship, story, expedition, and `iapFulfilled` fields survive migration.

---

### Task 1: Combat order rules

**Files:**
- Modify: `src/systems/combat.js`
- Modify: `src/systems/passives.js`
- Create: `test/combat_orders.test.mjs`

**Interfaces:**
- Consumes: existing `combatWinChance()`, `resolveCombat()`, encounter rewards, and hull/injury rules.
- Produces: `COMBAT_ORDERS`, `listCombatOrders({ tutorial })`, `previewCombatOrder({ playerPower, enemyPower, orderId, fuel, tutorial })`, and `resolveCombatOrder({ playerPower, enemyPower, orderId, encounter, rng, tutorialGuaranteed })`.

- [ ] **Step 1: Write the failing order behavior test**

```js
import {
  COMBAT_ORDERS,
  listCombatOrders,
  previewCombatOrder,
  resolveCombatOrder,
} from '../src/systems/combat.js';

const base = { playerPower: 20, enemyPower: 20, fuel: 2, tutorial: false };
if (Object.keys(COMBAT_ORDERS).join(',') !== 'brace,burn,board') throw new Error('order roster');
if (listCombatOrders({ tutorial: true }).map((x) => x.id).join(',') !== 'brace') throw new Error('tutorial order');

const brace = previewCombatOrder({ ...base, orderId: 'brace' });
const burn = previewCombatOrder({ ...base, orderId: 'burn' });
const board = previewCombatOrder({ ...base, orderId: 'board' });
if (brace.extraFuel !== 0 || !brace.preventsInjury || brace.failureHullScale !== 0.5) throw new Error('brace preview');
if (burn.extraFuel !== 1 || burn.effectivePower !== 32) throw new Error('burn preview');
if (board.effectivePower !== 18 || board.rewardScale !== 1.25 || !board.forcesFailureInjury) throw new Error('board preview');
if (previewCombatOrder({ ...base, fuel: 0, orderId: 'burn' }).enabled) throw new Error('burn fuel gate');

const boarded = resolveCombatOrder({ ...base, orderId: 'board', encounter: { rewards: { credits: 101, medals: 5, reputation: 3 } }, rng: () => 0 });
if (!boarded.success) throw new Error('board victory');
if (boarded.rewards.credits !== 126 || boarded.rewards.medals !== 6 || boarded.rewards.reputation !== 3) throw new Error('board reward');

const tutorial = resolveCombatOrder({ ...base, orderId: 'brace', tutorialGuaranteed: true, rng: () => 1 });
if (!tutorial.success || tutorial.chance !== 1) throw new Error('tutorial guarantee');
console.log('combat_orders.test.mjs OK');
```

Name the mutation this catches: changing any order's fuel, power, protection, risk, or reward contract makes the literal expectation fail.

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/combat_orders.test.mjs`

Expected: import failure because `COMBAT_ORDERS` and the preview/resolve APIs do not exist.

- [ ] **Step 3: Implement the minimal order API**

Add literal order definitions and derive previews from them. Burn adds 12 power. Board uses `Math.floor(playerPower * 0.9)` and scales only credits/medals with `Math.floor(value * 1.25)`. Brace exposes protection metadata; the caller applies hull/injury consequences. Keep `resolveCombat()` as a compatibility wrapper for existing tests and old save-shaped calls.

- [ ] **Step 4: Run focused and existing combat checks**

Run: `node test/combat_orders.test.mjs && node test/economy.test.mjs && node test/sanity.mjs`

Expected: all three scripts PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/combat.js src/systems/passives.js test/combat_orders.test.mjs
git commit -m "feat: add consequential combat orders"
```

---

### Task 2: Deterministic Contract Board

**Files:**
- Create: `src/data/contracts.js`
- Create: `src/systems/contracts.js`
- Create: `test/contract_board.test.mjs`

**Interfaces:**
- Consumes: `visibleNodes(player, now)`, node outcome weights, `fuelCostFor()`, `dayKey()`.
- Produces: `CONTRACT_PROFILES`, `contractDayKey(now)`, `careerBand(player)`, `generateContractBoard(player, now)`, `ensureContractBoard(player, now)`, `reviewContractOffer(player, offerId)`, and `tutorialDistressOffer(player)`.

- [ ] **Step 1: Write the failing board-generation test**

```js
import { createNewPlayer } from '../src/systems/player.js';
import { generateContractBoard, ensureContractBoard, reviewContractOffer } from '../src/systems/contracts.js';

const now = Date.UTC(2026, 8, 21, 12);
const player = { ...createNewPlayer(), createdAt: now - 86400000, tutorial: { script: 3, completed: true, phase: 'done' } };
const a = generateContractBoard(player, now);
const b = generateContractBoard(player, now);
if (a.offers.map((x) => x.profile).join(',') !== 'reliable,risky,strange') throw new Error('profiles');
if (new Set(a.offers.map((x) => x.id)).size !== 3) throw new Error('offer ids');
if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('board not deterministic');
for (const offer of a.offers) {
  if (!offer.destinationId || !offer.title || !offer.brief || offer.normalFuel < 2) throw new Error('incomplete offer');
  if (!['Low', 'Guarded', 'High'].includes(offer.danger)) throw new Error('danger');
}
const stored = { ...player, contractBoard: a };
const ensured = ensureContractBoard(stored, now + 60000);
if (ensured.player.contractBoard !== a) throw new Error('stored board replaced');
const review = reviewContractOffer(stored, a.offers[0].id);
if (!review.ok || review.cost.fuel < 1 || !review.rewardBand.label || !review.favoredTrait.label) throw new Error('review');
console.log('contract_board.test.mjs OK');
```

Name the mutation this catches: nondeterministic selection, missing profile coverage, incomplete card data, or replacing a saved same-day board.

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/contract_board.test.mjs`

Expected: module-not-found for `src/systems/contracts.js`.

- [ ] **Step 3: Add contract content definitions**

In `src/data/contracts.js`, define the three ordered profiles, icon IDs, danger labels, title/brief banks, favored-role mapping, and classification helpers. Keep copy arrays finite and authored; seeded selection chooses among them.

- [ ] **Step 4: Implement seeded board generation**

Use a stable string hash and a local xorshift PRNG. Snapshot every display field into the offer. Candidate classification follows the spec's outcome-weight thresholds and explicit fallbacks. `ensureContractBoard()` retains the saved board when its day matches or when `activeContract` exists.

- [ ] **Step 5: Run the board and visibility tests**

Run: `node test/contract_board.test.mjs && node test/tutorial_week.test.mjs && node test/sanity.mjs`

Expected: all scripts PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/contracts.js src/systems/contracts.js test/contract_board.test.mjs
git commit -m "feat: generate daily contract board"
```

---

### Task 3: Persistent route state machine

**Files:**
- Modify: `src/systems/contracts.js`
- Create: `test/contract_route.test.mjs`

**Interfaces:**
- Consumes: Task 1 order previews/resolution and Task 2 stored offers.
- Produces: `acceptContract(player, offerId)`, `previewContractAction(player, action)`, `commitContractAction(player, preview, { rng })`, `claimContractReward(player)`, `abandonContract(player, expectedRevision)`, and `normalizeContractState(player)`.

- [ ] **Step 1: Write the failing route transition test**

```js
import { createNewPlayer } from '../src/systems/player.js';
import {
  ensureContractBoard,
  acceptContract,
  previewContractAction,
  commitContractAction,
  claimContractReward,
} from '../src/systems/contracts.js';

const now = Date.UTC(2026, 8, 21, 12);
let player = { ...createNewPlayer(), wallet: { ...createNewPlayer().wallet, fuel: 8 }, tutorial: { script: 3, completed: true, phase: 'done' } };
player = ensureContractBoard(player, now).player;
const offer = player.contractBoard.offers.find((x) => x.profile === 'risky');
let res = acceptContract(player, offer.id);
if (!res.ok || res.player.activeContract.stage !== 'briefing' || res.player.wallet.fuel !== 8) throw new Error('accept');
player = res.player;

const launch = previewContractAction(player, { id: 'launch' });
res = commitContractAction(player, launch, { rng: () => 0 });
if (!res.ok || res.player.activeContract.stage !== 'choice' || res.player.wallet.fuel !== 7) throw new Error('launch');
const afterLaunch = res.player;
if (commitContractAction(afterLaunch, launch, { rng: () => 0 }).ok) throw new Error('stale launch replay');

const push = previewContractAction(afterLaunch, { id: 'push' });
res = commitContractAction(afterLaunch, push, { rng: () => 0 });
if (!res.ok || res.player.activeContract.stage !== 'confrontation' || res.player.wallet.fuel !== 6) throw new Error('push');

const order = previewContractAction(res.player, { id: 'order', orderId: 'brace' });
res = commitContractAction(res.player, order, { rng: () => 0 });
if (!res.ok || res.player.activeContract.stage !== 'return' || !res.player.activeContract.result) throw new Error('resolve');
const beforeClaim = res.player.wallet.credits;
const claimed = claimContractReward(res.player);
if (!claimed.ok || claimed.player.wallet.credits <= beforeClaim || claimed.player.activeContract !== null) throw new Error('claim');
if (claimContractReward(claimed.player).ok) throw new Error('double claim');
console.log('contract_route.test.mjs OK');
```

Name the mutation this catches: spending on accept, replaying a stale action, skipping a route stage, losing the saved result, or granting twice.

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/contract_route.test.mjs`

Expected: import failure for `acceptContract`.

- [ ] **Step 3: Implement accept and preview**

`acceptContract()` snapshots offer identity, destination, favored trait, route seed, encounter/story selection, `stage: 'briefing'`, and `revision: 0`. It rejects unknown, completed, or competing offers. `previewContractAction()` returns `{ ok, stage, revision, action, cost, consequence }` and never mutates.

- [ ] **Step 4: Implement commit and stable outcomes**

Validate both stage and revision before any spend. Use `spendFuel()` once, then create a new contract object with `revision + 1`. Store all random choices in the contract or result so JSON serialize/parse cannot reroll them. Reliable secure may enter `return`; Risky push enters `confrontation`; Strange follows its snapshotted content.

- [ ] **Step 5: Implement idempotent claim and abandonment**

Claim grants the stored result through `grant()`, records visit/completion stats and today's Contract milestone, appends the offer ID to `completedOfferIds`, then clears `activeContract`. Abandon is free only at briefing; after launch it clears the route without refund or reward and returns an analytics payload.

- [ ] **Step 6: Add reload, midnight, insufficient-fuel, and invalid-save cases to the same test**

```js
const saved = JSON.parse(JSON.stringify(res.player));
if (saved.activeContract.stage !== 'return') throw new Error('reload stage');
const poor = { ...afterLaunch, wallet: { ...afterLaunch.wallet, fuel: 0 } };
const poorPreview = previewContractAction(poor, { id: 'push' });
if (poorPreview.ok || poorPreview.reason !== 'not_enough_fuel') throw new Error('fuel gate');
const midnight = ensureContractBoard(afterLaunch, now + 86400000 * 2).player;
if (midnight.contractBoard.dayKey !== afterLaunch.contractBoard.dayKey) throw new Error('active midnight reroll');
```

- [ ] **Step 7: Run focused tests**

Run: `node test/contract_route.test.mjs && node test/contract_board.test.mjs && node test/combat_orders.test.mjs`

Expected: all scripts PASS.

- [ ] **Step 8: Commit**

```bash
git add src/systems/contracts.js test/contract_route.test.mjs
git commit -m "feat: persist short contract routes"
```

---

### Task 4: Save version 7 and tutorial version 3

**Files:**
- Modify: `src/systems/player.js`
- Modify: `src/systems/tutorial.js`
- Modify: `src/systems/contracts.js`
- Replace: `test/tutorial_week.test.mjs`
- Create: `test/tutorial_v3.test.mjs`

**Interfaces:**
- Consumes: `tutorialDistressOffer()`, route actions, existing crew grant, existing story chapter progression.
- Produces: `TUTORIAL_SCRIPT = 3`, phases `distress|launch|order|return|recruit|choose|away|done`, `migrateTutorialV3(player)`, `noteTutorialEvent()` mappings, and additive version-7 player fields.

- [ ] **Step 1: Write migration failures first**

```js
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { TUTORIAL_SCRIPT, currentTutorialStep } from '../src/systems/tutorial.js';

if (TUTORIAL_SCRIPT !== 3) throw new Error('script version');
const fresh = createNewPlayer();
if (fresh.version !== 7 || fresh.tutorial.phase !== 'distress') throw new Error('fresh v3');

const veteran = migratePlayer({
  ...fresh,
  version: 6,
  tutorial: { script: 2, completed: true, phase: 'done', hiredThird: true },
  wallet: { ...fresh.wallet, gems: 77 },
  iapFulfilled: ['receipt-a'],
});
if (!veteran.tutorial.completed || veteran.wallet.gems !== 77 || veteran.iapFulfilled[0] !== 'receipt-a') throw new Error('veteran migration');

const fought = migratePlayer({ ...fresh, version: 6, tutorial: { script: 2, firstCombat: true, hiredThird: false }, stats: { ...fresh.stats, jumps: 1, combatsWon: 1 } });
if (fought.tutorial.phase !== 'recruit') throw new Error('combat migration');
if (!currentTutorialStep(fought)) throw new Error('migrated step');
console.log('tutorial_v3.test.mjs OK');
```

Name the mutation this catches: replaying completed tutorials, resetting paid/player data, or assigning the wrong continuation phase.

- [ ] **Step 2: Run the migration test and verify RED**

Run: `node test/tutorial_v3.test.mjs`

Expected: failure because the script and save versions are still 2 and 6.

- [ ] **Step 3: Implement additive player migration**

Set version 7, add `contractBoard: null`, `activeContract: null`, `dailyLoop: { dayKey: null, contract: false, improve: false, away: false }`, `stats.contractsCompleted: 0`, and `stats.contractsByProfile: { reliable: 0, risky: 0, strange: 0 }`. Normalize valid contract state through a dependency-free shape check; clear invalid partial state. Preserve all preexisting durable fields.

- [ ] **Step 4: Replace tutorial phases and copy**

Define the eight phase records from the approved spec. Remove `join` and every cross-device claim from tutorial data. Keep optional platform login outside `currentTutorialStep()`. Make `noteTutorialEvent()` advance only on committed production events: `contract_reviewed`, `contract_launched`, `combat_order_done`, `contract_claimed`, `recruited`, `contract_accepted`, `expedition_start`.

- [ ] **Step 5: Add the fresh-session sequence test**

Drive a fresh player through the real distress offer, launch, Brace resolution, reward claim, Jen grant, normal offer accept, and Dustfall expedition event. Assert each exact phase and that no step has `modal: 'join'`, `Register`, `gems`, `shop`, or `buy` copy.

- [ ] **Step 6: Reconcile the week test with v3**

Keep its content-count and week-goal assertions, but complete the version-three production event sequence rather than calling version-two events.

- [ ] **Step 7: Run tutorial, route, and migration regression tests**

Run: `node test/tutorial_v3.test.mjs && node test/tutorial_week.test.mjs && node test/contract_route.test.mjs && node test/sanity.mjs`

Expected: all scripts PASS.

- [ ] **Step 8: Commit**

```bash
git add src/systems/player.js src/systems/tutorial.js src/systems/contracts.js test/tutorial_v3.test.mjs test/tutorial_week.test.mjs
git commit -m "feat: migrate first session to contract loop"
```

---

### Task 5: Explicit expedition party selection

**Files:**
- Modify: `src/systems/expedition.js`
- Create: `test/expedition_party.test.mjs`

**Interfaces:**
- Consumes: current ready crew, role preference, passive score, party-size cap, and success formula.
- Produces: `expeditionCrewOptions(player, planetId)`, `recommendedExpeditionCrewIds(player, planetId)`, `previewExpedition(player, planetId, crewInstanceIds = null)`, and `validateExpeditionParty(player, planetId, crewInstanceIds)`.

- [ ] **Step 1: Write the failing real-party test**

```js
import { createNewPlayer } from '../src/systems/player.js';
import {
  expeditionCrewOptions,
  recommendedExpeditionCrewIds,
  previewExpedition,
  validateExpeditionParty,
} from '../src/systems/expedition.js';

const player = { ...createNewPlayer(), crewSlots: 4 };
const options = expeditionCrewOptions(player, 'dustfall');
if (options.length !== 2 || options.some((x) => !x.reasons.length)) throw new Error('options and reasons');
const recommended = recommendedExpeditionCrewIds(player, 'dustfall');
const one = [recommended[0]];
const preview = previewExpedition(player, 'dustfall', one);
if (preview.crew.length !== 1 || preview.crew[0].instanceId !== one[0]) throw new Error('selected party');
if (validateExpeditionParty(player, 'dustfall', []).ok) throw new Error('empty party');
if (validateExpeditionParty(player, 'dustfall', ['missing']).ok) throw new Error('unknown crew');
console.log('expedition_party.test.mjs OK');
```

Name the mutation this catches: silently replacing player selection with auto-pick, losing recommendation reasons, or allowing invalid launches.

- [ ] **Step 2: Run and verify RED**

Run: `node test/expedition_party.test.mjs`

Expected: missing export for `expeditionCrewOptions`.

- [ ] **Step 3: Implement option reasons and validation**

Return every ready crew member with literal reason strings derived from real scoring inputs. Accept one through the current cap. Preserve the no-argument `previewExpedition(player, planetId)` behavior by using the recommendation when IDs are omitted.

- [ ] **Step 4: Run focused and existing expedition tests**

Run: `node test/expedition_party.test.mjs && node test/travel_phase_a.test.mjs && node test/sanity.mjs`

Expected: all scripts PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/expedition.js test/expedition_party.test.mjs
git commit -m "feat: make away teams player-selected"
```

---

### Task 6: Contract and Away rendering module

**Files:**
- Create: `src/ui/contractView.js`
- Modify: `src/ui/bridge.js`
- Modify: `src/ui/style.css`
- Create: `test/contract_ui.test.mjs`

**Interfaces:**
- Consumes: board/review/route snapshots, order previews, expedition previews/options, `escapeHtml()` supplied as a render dependency.
- Produces: `renderMissionSwitcher(view)`, `renderContractBoard(model)`, `renderContractReview(model)`, `renderActiveContract(model)`, `renderCombatOrders(model)`, `renderAwayPicker(model)`, and `renderDailyPlan(model)`.

- [ ] **Step 1: Write behavior-level render tests**

```js
import { renderContractBoard, renderCombatOrders, renderAwayPicker } from '../src/ui/contractView.js';

const board = renderContractBoard({ offers: [
  { id: 'r', profile: 'reliable', profileLabel: 'Reliable', title: 'Quiet Freight', brief: 'Medicine through the Spur.', normalFuel: 2, beats: 2, primaryReward: 'Credits', danger: 'Low', favoredTrait: { label: 'Trader' } },
  { id: 'k', profile: 'risky', profileLabel: 'Risky', title: 'Cut the Nest', brief: 'Pirates owe us metal.', normalFuel: 2, beats: 3, primaryReward: 'Medals', danger: 'High', favoredTrait: { label: 'Gunner' } },
  { id: 's', profile: 'strange', profileLabel: 'Strange', title: 'A Signal Knocks', brief: 'It knows the ship.', normalFuel: 2, beats: 3, primaryReward: 'Discovery', danger: 'Guarded', favoredTrait: { label: 'Sensors' } },
] });
if ((board.match(/data-act="contract-review"/g) || []).length !== 3) throw new Error('three review actions');
if (!board.includes('2F') || !board.includes('High') || !board.includes('Gunner')) throw new Error('card facts');

const orders = renderCombatOrders({ guaranteed: true, orders: [{ id: 'brace', name: 'Brace', enabled: true, chanceLabel: 'Guaranteed', consequence: 'Half hull loss · no injury', costLabel: 'Free' }] });
if (!orders.includes('Guaranteed') || orders.includes('Sure') || !orders.includes('data-order="brace"')) throw new Error('order UI');

const away = renderAwayPicker({ destination: { id: 'dustfall', name: 'Dustfall' }, cap: 2, selectedIds: ['a'], options: [{ id: 'a', name: 'Rex', role: 'pilot', selected: true, reasons: ['highest ready power'] }] });
if (!away.includes('highest ready power') || !away.includes('data-act="exp-crew-toggle"')) throw new Error('party UI');
console.log('contract_ui.test.mjs OK');
```

Name the mutation this catches: hiding required card facts, restoring “Sure,” or launching without visible crew reasons.

- [ ] **Step 2: Run and verify RED**

Run: `node test/contract_ui.test.mjs`

Expected: module-not-found for `src/ui/contractView.js`.

- [ ] **Step 3: Implement escaped, semantic renderers**

Use buttons for actions, headings for stage names, `aria-label` strings containing profile/title/fuel/danger/reward, and text/icon state in addition to color. The module receives complete view models and does not mutate player state.

- [ ] **Step 4: Replace the default Missions composition**

In `bridge.js`, default to Contracts, show the segmented Contracts/Away/Explore switcher, and render only the selected view. Keep the existing node renderer inside Explore. Remove player-facing assist buttons and route combat through `renderCombatOrders()`.

- [ ] **Step 5: Add phone-first CSS**

Add `.mission-switcher`, `.contract-card`, `.contract-facts`, `.route-stage`, `.order-card`, `.party-picker`, and `.daily-plan-chip`. Use existing spacing/color variables, minimum 44px controls, 16px consequence text, safe-area-aware sheets, and `[data-reduced-motion="true"]`/`prefers-reduced-motion` overrides.

- [ ] **Step 6: Run UI and ship regressions**

Run: `node test/contract_ui.test.mjs && npm run test:ship`

Expected: all scripts PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/contractView.js src/ui/bridge.js src/ui/style.css test/contract_ui.test.mjs
git commit -m "feat: render phone-first contract missions"
```

---

### Task 7: Session orchestration, telemetry, and daily plan

**Files:**
- Create: `src/systems/dailyLoop.js`
- Modify: `src/main.js`
- Modify: `src/ui/bridge.js`
- Modify: `src/systems/tutorial.js`
- Create: `test/daily_loop.test.mjs`

**Interfaces:**
- Consumes: contract and expedition preview/commit APIs, platform `captureEvent()`, room selection, tutorial events.
- Produces: `defaultDailyLoop(dayKey)`, `ensureDailyLoop(player, now)`, `markDailyMilestone(player, milestone, now)`, `dailyPlan(player, now)`, and main actions named in the spec.

- [ ] **Step 1: Write the failing daily-plan test**

```js
import { createNewPlayer } from '../src/systems/player.js';
import { ensureDailyLoop, markDailyMilestone, dailyPlan } from '../src/systems/dailyLoop.js';

const now = Date.UTC(2026, 8, 21, 12);
let player = ensureDailyLoop(createNewPlayer(), now);
if (dailyPlan(player, now).next.id !== 'contract' || dailyPlan(player, now).completed !== 0) throw new Error('contract first');
player = markDailyMilestone(player, 'contract', now);
if (dailyPlan(player, now).next.id !== 'improve') throw new Error('improve second');
player = markDailyMilestone(player, 'improve', now);
player = markDailyMilestone(player, 'away', now);
if (dailyPlan(player, now).next !== null || dailyPlan(player, now).completed !== 3) throw new Error('plan complete');
const nextDay = ensureDailyLoop(player, now + 86400000);
if (dailyPlan(nextDay, now + 86400000).completed !== 0) throw new Error('daily reset');
console.log('daily_loop.test.mjs OK');
```

Name the mutation this catches: wrong milestone order, failure to complete/hide, or failure to reset on a new day.

- [ ] **Step 2: Run and verify RED**

Run: `node test/daily_loop.test.mjs`

Expected: module-not-found for `src/systems/dailyLoop.js`.

- [ ] **Step 3: Implement pure daily-loop state**

Use the existing local day key. Markers are booleans and writes are idempotent. `dailyPlan()` returns only the next incomplete milestone plus `completed` and `total: 3`; it grants no reward.

- [ ] **Step 4: Wire main actions**

Add ephemeral `missionView`, `reviewedOfferId`, `selectedExpeditionId`, and selected crew IDs. Implement handlers for `mission-view`, `contract-review`, `contract-accept`, `contract-action`, `contract-order`, `contract-claim`, `contract-abandon`, `exp-choose`, `exp-crew-toggle`, and selected-party `exp-start`. Persist successful contract commits before starting animation.

- [ ] **Step 5: Emit the approved event vocabulary**

Call `captureEvent()` only after a committed state transition. Include the exact fields from the spec. Do not emit `travel` for a contract action. Mark Contract on claim, Improve on successful ship/crew upgrade, and Away on successful expedition launch.

- [ ] **Step 6: Wire tutorial production events and ship focus**

Advance tutorial only from the committed handler result. On contract return, switch to Ship and select Cargo. After claim, focus Engineering, an affordable room, an affordable crew member, or Away in the approved order. Remove the persistent post-tutorial coach; render only the compact next-milestone chip.

- [ ] **Step 7: Run system and broad tests**

Run: `node test/daily_loop.test.mjs && node test/tutorial_v3.test.mjs && node test/contract_route.test.mjs && node test/expedition_party.test.mjs && node test/sanity.mjs`

Expected: all scripts PASS.

- [ ] **Step 8: Commit**

```bash
git add src/systems/dailyLoop.js src/main.js src/ui/bridge.js src/systems/tutorial.js test/daily_loop.test.mjs
git commit -m "feat: orchestrate repeatable daily loop"
```

---

### Task 8: Ship feedback and tutorial cleanup

**Files:**
- Modify: `src/data/starterShip.js`
- Modify: `src/ui/shipView.js`
- Modify: `src/ui/crewWalk.js`
- Modify: `src/ui/bridge.js`
- Modify: `src/ui/style.css`
- Create: `test/contract_ship_feedback.test.mjs`

**Interfaces:**
- Consumes: `activeContract.stage`, `flags.sparrowFirstRepair`, selected expedition crew, existing room anchors and reduced-motion policy.
- Produces: `contractShipSignals(player)`, Cargo return alert, Operations route marker, first-repair visual state, and deterministic crew target states.

- [ ] **Step 1: Write the failing feedback-state test**

```js
import { contractShipSignals } from '../src/ui/shipView.js';

const base = { activeContract: null, flags: {}, crew: [] };
if (contractShipSignals(base).cargoReady) throw new Error('empty cargo signal');
const route = contractShipSignals({ ...base, activeContract: { stage: 'choice' } });
if (!route.operationsActive || route.cargoReady) throw new Error('route signal');
const returned = contractShipSignals({ ...base, activeContract: { stage: 'return' }, flags: { sparrowFirstRepair: true } });
if (!returned.cargoReady || !returned.firstRepairLit) throw new Error('return signal');
console.log('contract_ship_feedback.test.mjs OK');
```

Name the mutation this catches: losing the spatial indication that a route is active/returned or failing to persist the first visible repair.

- [ ] **Step 2: Run and verify RED**

Run: `node test/contract_ship_feedback.test.mjs`

Expected: missing export for `contractShipSignals`.

- [ ] **Step 3: Implement state-derived ship signals**

Derive signals without DOM access. Apply classes/markup to Operations and Cargo through the existing room renderer. Set `sparrowFirstRepair` only on the first tutorial claim. Use localized light/glow and a small static prop/effect; do not replace hull art in this package.

- [ ] **Step 4: Route crew to authored anchors**

During briefing/choice, choose Bridge and Engineering work anchors. Before expedition status changes, enqueue selected crew toward Cargo/Airlock anchors; then mark them away after the departure transition. Reduced-motion jumps directly to the final anchor/state without bob, shake, or particles.

- [ ] **Step 5: Remove obsolete tutorial surfaces**

Delete the Join modal and its tutorial-only actions/copy. Keep optional platform login entry points in Shop, with no cross-device promise. Verify the tutorial never renders the old full-width persistent coach after `done`.

- [ ] **Step 6: Run feedback, tutorial, and ship tests**

Run: `node test/contract_ship_feedback.test.mjs && node test/tutorial_v3.test.mjs && npm run test:ship`

Expected: all scripts PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/starterShip.js src/ui/shipView.js src/ui/crewWalk.js src/ui/bridge.js src/ui/style.css test/contract_ship_feedback.test.mjs
git commit -m "feat: show contract state inside Sparrow"
```

---

### Task 9: Test scripts, phone evidence, and package QA

**Files:**
- Modify: `package.json`
- Modify: `docs/README.md`
- Modify: `docs/19-outcome-requirements.md`
- Create: `docs/qa/2026-09-21-contract-route-loop.md`
- Create: `docs/qa/artifacts/contracts-board-390x844.png`
- Create: `docs/qa/artifacts/contracts-board-360x800.png`
- Create: `docs/qa/artifacts/contract-order-390x844.png`
- Create: `docs/qa/artifacts/contract-return-390x844.png`
- Create: `docs/qa/artifacts/expedition-party-390x844.png`
- Create: `docs/qa/artifacts/daily-plan-390x844.png`
- Create: `docs/qa/artifacts/contracts-reduced-motion-390x844.png`

**Interfaces:**
- Consumes: all package tests and runtime states.
- Produces: `npm run test:loop`, refreshed documentation status, and reproducible phone evidence.

- [ ] **Step 1: Add the focused test command**

```json
"test:loop": "node test/combat_orders.test.mjs && node test/contract_board.test.mjs && node test/contract_route.test.mjs && node test/tutorial_v3.test.mjs && node test/expedition_party.test.mjs && node test/contract_ui.test.mjs && node test/daily_loop.test.mjs && node test/contract_ship_feedback.test.mjs"
```

Append the new migration/tutorial coverage to the default `npm test` chain rather than replacing existing scripts.

- [ ] **Step 2: Run the focused and full automated gates**

Run:

```bash
npm run test:loop
npm run test:ship
npm test
npm run build
```

Expected: every command exits 0. Record module count and bundle sizes from the fresh build.

- [ ] **Step 3: Exercise reload/idempotency in the browser harness**

At both target viewports, seed a fresh version-7 save, drive the tutorial through each phase, reload at `choice`, `confrontation`, and `return`, and assert saved revision, wallet, and reward remain unchanged by reload. Then complete one normal route and launch a selected Dustfall party.

- [ ] **Step 4: Measure phone requirements**

For every visible action in the board, review, route, order, claim, and party sheets, assert bounding-box width and height are at least 44px. Assert required consequence/card computed font size is at least 16px, sheets stay within the viewport/safe navigation area, and every required control is scroll-reachable.

- [ ] **Step 5: Capture the listed artifacts**

Capture real runtime screenshots, not isolated mock HTML. Repeat the combat/route state with `prefers-reduced-motion: reduce` and confirm consequence/state parity with decorative motion removed.

- [ ] **Step 6: Write the QA report**

Record exact commit range, commands/results, state seeds, viewports, measured targets/text, reload evidence, screenshots, migration cases, economy changes, telemetry mapping, and remaining real-device gates. Do not call desktop emulation phone QA.

- [ ] **Step 7: Update authoritative docs**

Link the plan and QA report from `docs/README.md`. In `docs/19-outcome-requirements.md`, update only evidence genuinely proven by this package; leave multi-day economy simulation, real-device testing, paid authority, and broader meta work incomplete.

- [ ] **Step 8: Commit**

```bash
git add package.json docs/README.md docs/19-outcome-requirements.md docs/qa/2026-09-21-contract-route-loop.md docs/qa/artifacts/contracts-board-390x844.png docs/qa/artifacts/contracts-board-360x800.png docs/qa/artifacts/contract-order-390x844.png docs/qa/artifacts/contract-return-390x844.png docs/qa/artifacts/expedition-party-390x844.png docs/qa/artifacts/daily-plan-390x844.png docs/qa/artifacts/contracts-reduced-motion-390x844.png
git commit -m "docs: verify contract route loop"
```

---

## Plan self-review

- Spec coverage: board generation, persistent route, orders, tutorial, reward return, daily plan, party selection, Explore preservation, migration, telemetry, accessibility, reduced motion, automated tests, browser evidence, and documentation each have an owning task.
- Non-goals remain outside the plan: paid offer tuning, authority backend, subscriptions/passes, new currencies, fleet dispatch, bespoke body families, and deployment.
- Type consistency: `offer.id` feeds `acceptContract`; `activeContract.stage/revision` feed preview and commit; order IDs are `brace|burn|board`; expedition selection passes instance IDs; daily milestones are `contract|improve|away`.
- Mutation coverage: tests fail on duplicate spending/grants, unstable boards, wrong route stages, altered order tradeoffs, migration data loss, auto-picked expedition substitution, hidden card facts, daily reset failure, and missing ship signals.
- Placeholder scan: implementation steps name exact interfaces, behavior, commands, and expected failures; no unresolved implementation placeholder remains.
