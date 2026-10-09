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

