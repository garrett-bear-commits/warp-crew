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

