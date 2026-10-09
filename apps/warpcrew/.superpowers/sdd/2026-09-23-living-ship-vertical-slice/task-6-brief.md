### Task 6: Seeded, resumable combat and exactly-once route claim

**Files:** Create `src/systems/autoCombat.js`, `src/systems/encounterState.js`; modify `src/systems/player.js`, `src/systems/sessionLoop.js`, `src/ui/bridge.js`, `src/ui/combatView.js`; create `test/auto_combat.test.mjs`, `test/encounter_session.test.mjs`.

**Interfaces:** `startEncounter({ acceptanceId, encounterId, kind, seed, assignments, outputs })` returns a serializable versioned snapshot. `advanceEncounter(state, order = null)` returns `{ state, events }` without mutation or `Math.random`; state includes `revision`, `beat`, `seed`, `hull`, `shield`, `systems`, `enemy`, `cooldowns`, `orderWindow`, `result`. `applyEncounterAction(player, { acceptanceId, revision, order })` validates identity and saves a new player; `claimContractReward` remains the only route reward grant.

- [ ] **Step 1: Write failing simulation and reload tests**:

```js
import assert from 'node:assert/strict';
import { startEncounter, advanceEncounter } from '../src/systems/autoCombat.js';
const args = { acceptanceId: 'a1', encounterId: 'pirate_scout', kind: 'guided', seed: 19, assignments: {}, outputs: { helm: { total: 1 }, shields: { total: 1 }, weapons: { total: 1 }, engineering: { total: 1 } } };
const first = startEncounter(args);
assert.deepEqual(advanceEncounter(first), advanceEncounter(structuredClone(first)));
assert.equal(first.revision, 0);
assert.equal(advanceEncounter(first).state.revision, 1);
let state = first;
for (let i = 0; i < 20 && !state.result; i++) state = advanceEncounter(state, state.orderWindow ? 'brace' : null).state;
assert.equal(state.result, 'win');
const normal = startEncounter({ ...args, kind: 'normal', seed: 3, outputs: { ...args.outputs, weapons: { total: 0 } } });
let lost = normal;
for (let i = 0; i < 40 && !lost.result; i++) lost = advanceEncounter(lost).state;
assert.equal(lost.result, 'loss');
assert.ok(lost.hull >= 1);
const windowState = advanceEncounter(normal).state;
if (windowState.orderWindow) {
  const repaired = advanceEncounter(windowState, 'repair').state;
  assert.ok(repaired.cooldowns.repair > 0);
}
```

- [ ] **Step 2: Run** `node test/auto_combat.test.mjs`; expect missing module.
- [ ] **Step 3: Implement** a small deterministic two-ship beat policy: telegraph, station response, impact, recovery; Brace only at the guided threat window and at most one use; normal variant has at least Brace, emergency repair, and no-order, with visible cost/cooldown. The pure reducer starts with a copy, not a mutation:

```js
export function advanceEncounter(state, order = null) {
  if (state.result) return { state, events: [] };
  const next = structuredClone(state);
  next.revision += 1;
  next.beat += 1;
  // Read only next.seed/next.beat for variation; never Math.random or wall time.
  return { state: next, events: [] };
}
```

- [ ] **Step 4: Wire** `distress` and one fixed `reliable` encounter through this state; mark all others “Legacy encounter” without changing their resolver. Freeze launch fuel and route identity at start, recompute crew availability from committed status per beat, and commit through `persistSessionTransition` before effects. Winning sets a valid `activeContract.result` and `stage='return'`; retain a terminal `activeEncounter` until claim so reload can show the win. Only existing claim grants wallet/reputation. A normal loss exposes `encounter-recover`, which clears the failed contract after showing the reason, preserves a minimum 1 hull, and grants no reward.
- [ ] **Step 5: Add `encounter_session.test.mjs`** with the exact-once assertions:

```js
const saveRoundTrip = JSON.parse(JSON.stringify(playerWithActiveEncounter));
assert.deepEqual(advanceEncounter(saveRoundTrip.activeEncounter), advanceEncounter(playerWithActiveEncounter.activeEncounter));
assert.equal(applyEncounterAction(playerWithActiveEncounter, { acceptanceId: 'wrong', revision: 0, order: null }).reason, 'stale_encounter_action');
assert.equal(applyEncounterAction(wonPlayer, { acceptanceId: wonPlayer.activeContract.acceptanceId, revision: wonPlayer.activeEncounter.revision, order: null }).reason, 'encounter_finished');
assert.equal(claimContractReward(claimedPlayer).ok, false);
```

Use the fixture setup in this file to obtain `playerWithActiveEncounter`, `wonPlayer`, and `claimedPlayer` by `startEncounter`, legal repeated `applyEncounterAction`, and one successful `claimContractReward` respectively; assert wallet and fuel before/after those transitions. Run `node test/auto_combat.test.mjs`, `node test/encounter_session.test.mjs`, `npm run test:loop`, `npm run test:balance`; expect PASS.
- [ ] **Step 6: Commit** `feat: add durable crew-run encounters` with task files only.

