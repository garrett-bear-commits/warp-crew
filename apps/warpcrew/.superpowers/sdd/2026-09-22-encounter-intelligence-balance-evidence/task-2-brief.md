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

