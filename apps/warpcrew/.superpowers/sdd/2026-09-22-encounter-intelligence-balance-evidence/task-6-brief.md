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

