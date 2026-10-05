# Living-Ship Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first win and one repeatable job feel like operating a visible crewed ship, with a short first session, a usable camera, durable crew-run combat, and a rewarding free recruit.

**Architecture:** Keep authoritative assignments, encounters, tutorial progress, and rewards in pure `src/systems` transitions saved through `persistSessionTransition`; rendering and camera state are presentation only. Add the new encounter to the distress job and one named normal job, leaving all other routes on the existing resolver with an explicit legacy label. Build the visual shell around one world-space ship layer and a separate screen-space HUD.

**Tech Stack:** Vite 6, browser JavaScript ESM, Node `.mjs` assertion tests, DOM/CSS/canvas, localStorage, existing Jest SDK adapter. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-22-living-ship-core-vertical-slice-design.md`

## Global Constraints

- Only package 1 of the spec is in scope. Do not merge draft PR #1, activate Jest production, activate purchases, or deploy a public build without separate authority.
- Preserve every existing save's crew, currency, purchases, reputation, route, and completed tutorial. Bump `SAVE_VERSION` from 7 to 8 with migration tests. Active script-3 tutorials finish on script 3; only fresh saves use script 4.
- The new guided fight must be an authored win, not a hidden one-roll override; the repeatable fight can be lost and must recover.
- Save a transition before publishing animation or analytics. An encounter beat and its claim each require revision/identity checks.
- Camera state cannot influence simulation or persistence. Gameplay targets, sprites, effects, and hit tests share one world transform; HUD remains in screen space.
- Mandatory prompts have at most one sentence or two display lines. Player text is at least 16 CSS px, instructional body text at least 18 CSS px, and touch controls at least 44×44 CSS px.
- First-session copy uses **job**, **crew**, **station**, **reward**, **reputation**, and **Away team**. Do not claim Jest registration provides cloud recovery; current save is localStorage.
- New art is high-pixel-count, clean-edged “new retro” pixel art. Preserve originals and do not expand this batch beyond splash plus Rex, Bolt, Kira, Tink, and Nemi identity sheets.
- User-owned untracked `Mobile Game UI.jpg` and `package-lock.json` are not plan inputs to commit or delete. No unrelated changes.
- Executor may delegate bounded, non-overlapping tasks to GPT-6 Luna, as Garrett requested; root owns integration and final verification. A scoped read-only Grok/Claude audit is a final gate, not a replacement for local tests.

## File Map and Delivery Order

| Responsibility | Files |
| --- | --- |
| Camera math and input | Create `src/ui/shipCamera.js`, `src/ui/shipCameraController.js`; modify `src/ui/bridge.js`, `src/ui/style.css`; test `test/ship_camera.test.mjs`, `test/ship_camera_input.test.mjs` |
| Shared world projection | Modify `src/ui/spaceFlight.js`, `src/ui/combatView.js`, `src/ui/crewWalk.js`; create `src/ui/worldProjection.js`; test `test/world_projection.test.mjs` |
| Ship geometry and walking | Create `src/data/shipRoutes.js`; modify `src/data/starterShip.js`, `src/data/navGrid.js`, `src/ui/crewWalk.js`; test `test/ship_pathing.test.mjs`, `test/crew_walk_routes.test.mjs` |
| Station state and outputs | Create `src/systems/stations.js`; modify `src/systems/player.js`, `src/systems/sessionLoop.js`, `src/ui/bridge.js`; test `test/stations.test.mjs`, `test/station_actions.test.mjs` |
| Durable combat core | Create `src/systems/autoCombat.js`, `src/systems/encounterState.js`; modify `src/systems/player.js`, `src/systems/sessionLoop.js`, `src/ui/bridge.js`; test `test/auto_combat.test.mjs`, `test/encounter_session.test.mjs` |
| Fresh-only onboarding and welcome pull | Create `src/systems/tutorialV4.js`; modify `src/systems/tutorial.js`, `src/systems/gacha.js`, `src/systems/player.js`, `src/systems/sessionLoop.js`, `src/ui/bridge.js`, `src/main.js`; test `test/tutorial_v4.test.mjs`, `test/tutorial_migration.test.mjs` |
| Visual/copy/art pass | Modify `src/ui/bridge.js`, `src/ui/style.css`, `src/data/portraits.js`; create `src/ui/essentialPreload.js`, `src/data/artManifest.js`, `docs/qa/2026-09-23-first-session-copy.md`, `docs/art/2026-09-23-vertical-slice-ledger.md`; add approved exports under `public/art/pixel/vertical-slice/`; test `test/asset_manifest.test.mjs`, `test/first_session_copy.test.mjs` |
| Integration and owner QA | Modify `docs/NEXT.md`; create `docs/qa/2026-09-23-living-ship-qa.md`; run Node suites, Vite build, browser captures, scoped external audit, phone checks |

The tasks below are sequential at integration boundaries. Camera math, art brief preparation, and copy inventory can be delegated independently. No worker edits `src/ui/bridge.js` or `src/systems/sessionLoop.js` concurrently with another worker.

## Review Focus

1. A pinch begins after a one-finger drag: no queued station tap fires, and the touched world point stays under the midpoint. Pin in Task 2.
2. Crew is sent away or injured during an encounter: their station output ceases on the next committed beat, without erasing the assignment. Pin in Task 5.
3. Reload occurs between a winning beat and reward claim: the same route resumes and neither fuel nor reward is applied twice. Pin in Task 6.
4. A script-3 save is interrupted at the recruit phase: migration never restarts script 4 or grants a second recruit. Pin in Task 7.
5. An image fails to load or a saved path is disconnected: loading can finish with a fallback, and crew does not jump through the hull. Pin in Tasks 3 and 4.

---

### Task 1: Pure camera transform

**Files:** Create `src/ui/shipCamera.js`; test `test/ship_camera.test.mjs`.

**Interfaces:** `makeCamera(viewport, world, focus, scale)` returns `{ x,y,scale,minScale,maxScale,viewport,world }` with `x/y` as screen coordinates of world origin. `project(camera, point)`, `unproject(camera, point)`, `pan(camera, dx, dy)`, `zoomAt(camera, factor, screenPoint)`, and `resizeCamera(camera, viewport)` return new values. `clampCamera` keeps at least 20% of the world visible while allowing the far zoom to frame both ships. `focusCamera(camera, worldPoint, targetScale)` returns a clamped view.

- [ ] **Step 1: Write failing tests** in `test/ship_camera.test.mjs`:

```js
import assert from 'node:assert/strict';
import { makeCamera, project, unproject, pan, zoomAt, resizeCamera, focusCamera } from '../src/ui/shipCamera.js';
const c = makeCamera({ w: 390, h: 620 }, { w: 1152, h: 1728 }, { x: 540, y: 360 }, 0.9);
const p = { x: 420, y: 530 };
assert.ok(Math.abs(unproject(c, project(c, p)).x - p.x) < 0.001);
assert.ok(Math.abs(unproject(c, project(c, p)).y - p.y) < 0.001);
const midpoint = { x: 200, y: 300 };
const before = unproject(c, midpoint);
const enlarged = zoomAt(c, 1.8, midpoint);
assert.ok(Math.abs(unproject(enlarged, midpoint).x - before.x) < 0.001);
assert.ok(Math.abs(unproject(enlarged, midpoint).y - before.y) < 0.001);
assert.ok(pan(c, 1e6, -1e6).x !== c.x + 1e6);
assert.ok(Number.isFinite(resizeCamera(c, { w: 360, h: 800 }).x));
assert.ok(Math.abs(project(focusCamera(c, p, c.maxScale), p).x - 195) < 1);
```

- [ ] **Step 2: Run** `node test/ship_camera.test.mjs`; expect missing-module failure.
- [ ] **Step 3: Implement** immutable transforms in `shipCamera.js`, beginning with these exact identities and adding viewport/world clamping and finite-value guards:

```js
export const project = (c, p) => ({ x: c.x + p.x * c.scale, y: c.y + p.y * c.scale });
export const unproject = (c, p) => ({ x: (p.x - c.x) / c.scale, y: (p.y - c.y) / c.scale });
export function zoomAt(c, factor, anchor) {
  const worldPoint = unproject(c, anchor);
  const scale = Math.max(c.minScale, Math.min(c.maxScale, c.scale * factor));
  return clampCamera({ ...c, scale, x: anchor.x - worldPoint.x * scale, y: anchor.y - worldPoint.y * scale });
}
```

Derive `minScale` from a 1,152×1,728 ship plus a 55% battle margin and `maxScale` from a 44 CSS px minimum station target at the focused room. `resizeCamera` retains the old viewport center's world point.
- [ ] **Step 4: Run** `node test/ship_camera.test.mjs` and `npm run test:ship`; expect PASS.
- [ ] **Step 5: Commit** `feat: add bounded ship camera transforms` with only the two task files.

### Task 2: Stable gesture surface and camera controls

**Files:** Create `src/ui/shipCameraController.js`; modify `src/ui/bridge.js`, `src/ui/style.css`; test `test/ship_camera_input.test.mjs`.

**Interfaces:** `createCameraController({ surface, getCamera, setCamera, onTap, onFocus })` returns `{ destroy, wasGesture }`. `onTap(worldPoint, event)` is invoked only after a stationary single-pointer release. `onFocus` receives a world point. `bridge.js` owns camera state in its shell instance, not saved player state.

- [ ] **Step 1: Write a failing controller test** using a minimal event-target fake in `test/ship_camera_input.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createCameraController } from '../src/ui/shipCameraController.js';
const handlers = new Map(), surface = { addEventListener: (n, f) => handlers.set(n, f), removeEventListener: n => handlers.delete(n), setPointerCapture() {} };
let taps = 0, camera = { x: 0, y: 0, scale: 1, minScale: .2, maxScale: 2, viewport: { w: 390, h: 620 }, world: { w: 1152, h: 1728 } };
const control = createCameraController({ surface, getCamera: () => camera, setCamera: c => { camera = c; }, onTap: () => taps++, onFocus() {} });
const send = (name, id, x, y) => handlers.get(name)({ pointerId: id, clientX: x, clientY: y, preventDefault() {} });
send('pointerdown', 1, 100, 100); send('pointermove', 1, 140, 100);
send('pointerdown', 2, 250, 100); send('pointermove', 2, 280, 100);
send('pointerup', 2, 280, 100); send('pointerup', 1, 140, 100);
assert.equal(taps, 0);
assert.equal(control.wasGesture(), true);
control.destroy();
```

- [ ] **Step 2: Run** `node test/ship_camera_input.test.mjs`; expect missing-module failure.
- [ ] **Step 3: Implement** pointer map, 8px drag threshold, midpoint-preserving two-pointer zoom, pointercancel/lostpointercapture cleanup, and 350ms suppression of synthesized clicks after gestures. The release guard must have this shape:

```js
if (pointers.size !== 1 || gestureMoved || Date.now() < suppressClickUntil) return;
onTap(unproject(getCamera(), { x: event.clientX - rect.left, y: event.clientY - rect.top }), event);
```

Bind once on stable `.stage`, route stationary taps through `unproject`, and render 44px Focus/Zoom in/Zoom out controls in `.stage-hud`. Set `touch-action: none` only on `.stage`; leave scrollable panels unaffected. At overview scale a station tap calls focus instead of assignment. Respect `prefers-reduced-motion` by skipping focus tween.
- [ ] **Step 4: Run** `node test/ship_camera_input.test.mjs`, `npm run test:ship`, `npm run build`; expect PASS.
- [ ] **Step 5: Commit** `feat: add ship pan zoom and focus controls` with task files only.

### Task 3: Shared projection, stable space, and combat effects

**Files:** Create `src/ui/worldProjection.js`; modify `src/ui/spaceFlight.js`, `src/ui/combatView.js`, `src/ui/crewWalk.js`, `src/ui/bridge.js`; test `test/world_projection.test.mjs`.

**Interfaces:** `worldProjection(camera, worldPoint)` delegates to `project`; `effectScreenPoint(camera, effect)` projects an effect's `{ worldX, worldY }` every draw. `attachCombat` continues to be presentation-only; no outcome computation moves to canvas. `attachSpace` receives a camera getter and fixed landmark seed.

- [ ] **Step 1: Write failing projection tests**:

```js
import assert from 'node:assert/strict';
import { effectScreenPoint, visibleLandmarks } from '../src/ui/worldProjection.js';
const base = { x: 0, y: 0, scale: 1, viewport: { w: 390, h: 620 } };
const fx = { worldX: 100, worldY: 150 };
assert.deepEqual(effectScreenPoint(base, fx), { x: 100, y: 150 });
assert.deepEqual(effectScreenPoint({ ...base, x: -20, scale: 2 }, fx), { x: 180, y: 300 });
assert.deepEqual(visibleLandmarks(77, base), visibleLandmarks(77, base));
```

- [ ] **Step 2: Run** `node test/world_projection.test.mjs`; expect missing-module failure.
- [ ] **Step 3: Implement** `effectScreenPoint` and deterministic `visibleLandmarks(seed,camera)` using a local integer PRNG; keep star/planet/nebula world coordinates stable across resize and zoom. For effects, use:

```js
export const effectScreenPoint = (camera, effect) => ({
  x: camera.x + effect.worldX * camera.scale,
  y: camera.y + effect.worldY * camera.scale,
});
```

Move ship, hotspot, crew canvas, feedback, and debug into a camera-transformed world wrapper; reproject combat effect anchors each animation frame rather than caching `getBoundingClientRect()` at battle start. Essential art load failures show existing hull/space fallbacks and advance loading, never leave the bar stuck.
- [ ] **Step 4: Run** `node test/world_projection.test.mjs`, `npm run test:ship`, `npm run build`; capture close, full-ship, and battle-overview screenshots at 390×844; expect consistent anchors.
- [ ] **Step 5: Commit** `feat: keep ship crew and battle effects in world space` with task files only.

### Task 4: Door-truthful station walks

**Files:** Create `src/data/shipRoutes.js`, `test/crew_walk_routes.test.mjs`; modify `src/data/starterShip.js`, `src/data/navGrid.js`, `src/ui/crewWalk.js`; extend `test/ship_pathing.test.mjs`.

**Interfaces:** `routeToWorkAnchor(from, roomId)` returns `{ ok:true, points }` or `{ ok:false, reason:'disconnected' }`; each point is walkable and transitions rooms only at an authored `door-enter`/`door-exit`. `crewTargetStates(player, options)` consumes persisted station assignments from Task 5; until Task 5 it uses the existing bridge/engineering targets.

- [ ] **Step 1: Write failing route test**:

```js
import assert from 'node:assert/strict';
import { routeToWorkAnchor } from '../src/data/shipRoutes.js';
import { isWalkablePct } from '../src/data/navGrid.js';
const route = routeToWorkAnchor({ x: 56, y: 20, room: 'bridge' }, 'engineering');
assert.equal(route.ok, true);
assert.ok(route.points.some(p => p.via === 'door-enter'));
assert.ok(route.points.every(p => isWalkablePct(p.x, p.y)));
assert.deepEqual(routeToWorkAnchor({ x: -100, y: -100, room: 'missing' }, 'engineering'), { ok: false, reason: 'disconnected' });
```

- [ ] **Step 2: Run** `node test/crew_walk_routes.test.mjs`; expect missing export.
- [ ] **Step 3: Implement** graph-based route in `shipRoutes.js` (which imports both `starterShip.js` and `navGrid.js`, avoiding a reverse import cycle) to the room's `workAnchor`; validate every path segment against `isWalkablePct` and return failure instead of nearest-room teleport fallback. Preserve the actor on failure:

```js
const route = routeToWorkAnchor({ x: actor.x, y: actor.y, room: actor.room }, destinationRoom);
if (!route.ok) { console.warn('[crew-route]', actor.id, route.reason); return; }
actor.path = route.points;
```

Make station doors/hall and work markers visibly clear in the cutaway without replacing the 1,152×1,728 reference art. Simulation never waits for decorative arrival.
- [ ] **Step 4: Run** `node test/crew_walk_routes.test.mjs`, `npm run test:ship`; inspect a screen recording of bridge→engineering and engineering→weapons at close zoom; expect door crossings and no hull jump.
- [ ] **Step 5: Commit** `fix: route crew through visible ship doors` with task files only.

### Task 5: Persist one crew assignment and derive station outputs

**Files:** Create `src/systems/stations.js`; modify `src/systems/player.js`, `src/systems/sessionLoop.js`, `src/ui/bridge.js`, `src/ui/crewWalk.js`; create `test/stations.test.mjs`, `test/station_actions.test.mjs`.

**Interfaces:** `normalizeAssignments(player)` returns a map of crew instance ID to station ID or `null`. `assignStation(player, crewId, stationId, now)` returns `{ ok, player?, reason? }`; `stationOutputs(player, now)` returns `{ helm, shields, weapons, engineering }`, each with `{ staffedBy, baseline, bonus, total, label }`. `station-assign` UI action carries `data.id` and `data.station`; no UI writes the saved map directly. Away/injured crew keep their saved assignment but contribute only baseline.

- [ ] **Step 1: Write failing tests**:

```js
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { assignStation, stationOutputs } from '../src/systems/stations.js';
const now = 2_000_000, p = createNewPlayer({ now, rng: () => .1 });
const bolt = p.crew.find(c => c.templateId === 'merc_bolt');
const assigned = assignStation(p, bolt.instanceId, 'shields', now);
assert.equal(assigned.ok, true);
assert.equal(assigned.player.stationAssignments[bolt.instanceId], 'shields');
assert.ok(stationOutputs(assigned.player, now).shields.bonus > 0);
const away = { ...assigned.player, crew: assigned.player.crew.map(c => c.instanceId === bolt.instanceId ? { ...c, status: 'expedition' } : c) };
assert.equal(stationOutputs(away, now).shields.bonus, 0);
assert.equal(away.stationAssignments[bolt.instanceId], 'shields');
assert.equal(assignStation(p, bolt.instanceId, 'cargo', now).reason, 'unknown_station');
```

- [ ] **Step 2: Run** `node test/stations.test.mjs`; expect missing module.
- [ ] **Step 3: Implement** four station IDs, one crew per station for this slice, role-specific visible bonuses (pilot at helm, engineer at shields/engineering, gunner at weapons), conservative unmanned baseline, and a single selector shared by HUD and combat. The availability check must be explicit:

```js
const member = player.crew.find(c => c.instanceId === crewId);
if (!member) return { ok: false, reason: 'unknown_crew' };
if (member.status === 'expedition' || (member.injuredUntil || 0) > now) return { ok: false, reason: 'unavailable_crew' };
if (!['helm', 'shields', 'weapons', 'engineering'].includes(stationId)) return { ok: false, reason: 'unknown_station' };
```

Add `stationAssignments` to new saves with Rex at helm and Bolt in reserve so the guided Shields assignment is a real player action; migrate absent maps without moving existing crew or changing old combat selection. Wire a brief crew→station chooser with `station-assign`, a clear work marker, and an output delta; one station remains selected at close camera scale.
- [ ] **Step 4: Add `station_actions.test.mjs`** with `sessionAction(p, {}, 'station-assign', { id: 'missing', station: 'helm' }).reason === 'unknown_crew'`, and assert a valid assignment survives JSON round-trip and `migratePlayer`.
- [ ] **Step 5: Run** `node test/stations.test.mjs`, `node test/station_actions.test.mjs`, `npm run test:loop`, `npm run test:ship`; expect PASS.
- [ ] **Step 6: Commit** `feat: persist crew station assignments` with task files only.

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

### Task 7: Fresh-only short tutorial, first win, ship name, and curated pull

**Files:** Create `src/systems/tutorialV4.js`; modify `src/systems/tutorial.js`, `src/systems/gacha.js`, `src/systems/player.js`, `src/systems/sessionLoop.js`, `src/ui/bridge.js`, `src/main.js`; create `test/tutorial_v4.test.mjs`, `test/tutorial_migration.test.mjs`.

**Interfaces:** `defaultTutorialV4()` begins at `board`; `advanceTutorialV4(player,event)` returns a new player only for legal events. `grantWelcomePull(player,{rng})` returns `{ ok,player,instance }` once, choosing uniformly from `merc_kira`, `merc_tink`, `merc_nemi`, rarity `uncommon`; increments `gacha.pulls`, resets/advances pity by normal rules, and appends to normal history. `nameShip(player,name)` trims to 1–24 visible characters or uses the current default. Script-3 helpers remain intact and are selected by `player.tutorial.script`.

- [ ] **Step 1: Write failing migration/reward tests**:

```js
import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { grantWelcomePull, nameShip } from '../src/systems/tutorialV4.js';
const fresh = createNewPlayer({ now: 1, rng: () => .2 });
assert.equal(fresh.tutorial.script, 4);
const readyForPull = { ...fresh, tutorial: { ...fresh.tutorial, phase: 'pull', firstWin: true } };
const first = grantWelcomePull(readyForPull, { rng: () => .5 });
assert.equal(first.ok, true);
assert.equal(first.instance.templateId, 'merc_tink');
assert.equal(first.instance.rarity, 'uncommon');
assert.equal(first.player.gacha.pulls, 1);
assert.equal(grantWelcomePull(first.player, { rng: () => .9 }).ok, false);
assert.equal(nameShip(first.player, '  ').ship.name, 'Sparrow');
const old = { ...fresh, version: 7, tutorial: { script: 3, phase: 'recruit', completed: false } };
assert.equal(migratePlayer(old).tutorial.script, 3);
assert.equal(migratePlayer({ ...old, tutorial: { script: 3, phase: 'done', completed: true } }).tutorial.completed, true);
```

- [ ] **Step 2: Run** `node test/tutorial_v4.test.mjs`; expect missing module or wrong script.
- [ ] **Step 3: Implement** fresh script 4 only, and migrate existing script 3 unchanged. The selector is keyed to the saved script, not a global version switch:

```js
const tutorial = player.tutorial?.script === 4
  ? normalizeTutorialV4(player.tutorial)
  : migrateTutorialV3(player).tutorial;
```

Set `ship.name='Sparrow'` on new saves and use it as the migration fallback. Gate actions to: Board ship → assign Bolt to Shields → guided encounter/Brace/win → claim visible repair/reputation → name ship → free pull → optional Jest registration/skip → next job. Show the new crew in a useful context: Kira at Weapons, Tink at Shields/Engineering, or Nemi in the future Away-team slot; allow the player to change that suggested assignment. Store stable phase plus one-time flags in player; ship naming and welcome pull use the durable transition boundary. Add `gacha.history` for both normal and welcome pulls (existing gacha has no history), passing `rng` into `createCrewInstance` and pity selection without changing odds. No first-session store/purchase UI.
- [ ] **Step 4: Add `tutorial_migration.test.mjs`** cases for active script-3 recruit, completed script 3, a version-7 veteran without tutorial, and script-4 reload at each phase. Begin with this frozen v3 case and extend it for the other three saved shapes:

```js
const v3 = { ...createNewPlayer({ now: 1, rng: () => .2 }), version: 7,
  tutorial: { script: 3, phase: 'recruit', completed: false, dismissed: false } };
const migrated = migratePlayer(JSON.parse(JSON.stringify(v3)));
assert.equal(migrated.tutorial.script, 3);
assert.equal(migrated.tutorial.phase, 'recruit');
assert.deepEqual(migrated.crew.map(c => c.instanceId), v3.crew.map(c => c.instanceId));
assert.deepEqual(migrated.wallet, v3.wallet);
```

Assert route identity and completed status remain unchanged in the other cases. Run `node test/tutorial_v4.test.mjs`, `node test/tutorial_migration.test.mjs`, `npm run test:loop`, `npm run test:balance`; expect PASS.
- [ ] **Step 5: Commit** `feat: add short fresh-save first session` with task files only.

### Task 8: Full-screen opening, canonical identity, and plain-language UI

**Files:** Create `src/ui/essentialPreload.js`, `src/data/artManifest.js`, `docs/art/2026-09-23-vertical-slice-ledger.md`, `docs/qa/2026-09-23-first-session-copy.md`; modify `src/data/portraits.js`, `src/ui/bridge.js`, `src/ui/style.css`, `src/main.js`; add approved art to `public/art/pixel/vertical-slice/`; create `test/asset_manifest.test.mjs`, `test/first_session_copy.test.mjs`.

**Interfaces:** `ART_VERTICAL_SLICE` maps `splash`, `rex`, `bolt`, `kira`, `tink`, `nemi` to approved public paths, dimensions, hash, and fallback path. `renderSplash({ progress, ready, error })` uses a full-screen illustration, separately rendered logo and truthful essential-asset progress, and enables Board ship at readiness even when optional art fails. `preloadEssentialAssets(sources, load, onProgress)` resolves to paths/fallbacks after every source settles, including rejected images.

- [ ] **Step 1: Write failing manifest/copy tests**:

```js
import assert from 'node:assert/strict';
import { ART_VERTICAL_SLICE } from '../src/data/artManifest.js';
import { renderSplash } from '../src/ui/bridge.js';
import { preloadEssentialAssets } from '../src/ui/essentialPreload.js';
assert.deepEqual(Object.keys(ART_VERTICAL_SLICE).sort(), ['bolt','kira','nemi','rex','splash','tink']);
assert.match(renderSplash({ progress: 40, ready: false }), /role="progressbar"[^>]*aria-valuenow="40"/);
assert.doesNotMatch(renderSplash({ progress: 40, ready: false }), /data-act="splash-dismiss"(?![^>]*disabled)/);
assert.match(renderSplash({ progress: 100, ready: true }), /Board ship/);
const resolved = await preloadEssentialAssets([{ src: '/broken.png', fallback: '/art/pixel/cinematic/jump.png' }],
  () => Promise.reject(new Error('image failed')), () => {});
assert.deepEqual(resolved, ['/art/pixel/cinematic/jump.png']);
```

- [ ] **Step 2: Run** `node test/asset_manifest.test.mjs`; expect missing module or mismatched splash signature.
- [ ] **Step 3: Write `first_session_copy.test.mjs`** before changing strings:

```js
import assert from 'node:assert/strict';
import { renderSplash } from '../src/ui/bridge.js';
const text = renderSplash({ progress: 100, ready: true });
assert.match(text, /Board ship/);
assert.doesNotMatch(text, /Victory is Guaranteed|favored crew|route profile|cross-device save/i);
```

- [ ] **Step 4: Before any Flora run**, read current Flora model price again and submit this exact batch for Garrett's explicit cost approval: one 9:16 splash scene plus five canonical character identity sheets, one output each, GPT Image 2.5 Flare or Sunburst (`t2i-gpt-image-2-5-flare` / `t2i-gpt-image-2-5-sunburst`), current estimate 62 credits / US$0.05537 per output, 372 credits / US$0.33222 total, hard cap US$0.50. References: `public/art/pixel/ships/sparrow-cutaway.jpg`, `public/art/space/sparrow-hull-v3.png`, existing `public/art/pixel/crew/{rex,bolt,kira,tink,nemi}.png`, and the user-provided `Mobile Game UI.jpg` for layout mood only. If pricing exceeds the cap, stop and seek a new decision; do not quietly reduce quality or run extras.
- [ ] **Step 5: After approval**, generate one output at a time, record prompt/model/run/output/cost/hash in the ledger immediately, audit recent Flora generations before retrying any timeout, preserve originals, inspect a six-image contact sheet and phone-size crops, and accept only on-model exports. Render the logo as CSS/SVG overlay; never bake it or the loading bar into generated art. Implement essential preload progress with image error completion and fallback, including this settlement pattern:

```js
export async function preloadEssentialAssets(sources, load, onProgress) {
  let settled = 0;
  const ready = await Promise.allSettled(sources.map(async item => {
    try { return await load(item.src); }
    finally { settled += 1; onProgress(Math.round(100 * settled / sources.length)); }
  }));
  return ready.map((entry, i) => entry.status === 'fulfilled' ? sources[i].src : sources[i].fallback);
}
```

Replace verbose mandatory screens with the approved short sequence and inventory every before/after string in the copy document; remove technical jargon from blocked-action and registration copy. Enforce 16/18/44 CSS minimums and safe areas with tests plus browser measurement.
- [ ] **Step 6: Run** `node test/asset_manifest.test.mjs`, `node test/first_session_copy.test.mjs`, `npm run build`; capture splash, station, threat, win, pull, naming, registration, and post-tutorial screens at 360×800 and 390×844; expect no overflow or obscured tap target.
- [ ] **Step 7: Commit** `feat: add new-retro first-session art and UI` with accepted exports, manifest, copy inventory, ledger, tests, and task source files only. If art approval is pending, stop here and report the tested code state; do not claim the visual slice is complete.

### Task 9: Integrated QA, audit, and inactive build handoff

**Files:** Create `docs/qa/2026-09-23-living-ship-qa.md`; modify `docs/NEXT.md` only to record verified status. No new gameplay code unless an audit finding is separately reproduced and fixed with a failing test.

**Interfaces:** QA record identifies exact commit/branch, build hash, screenshots/recordings, tested save fixtures, skipped phone/platform items, and owner decisions. It does not call a browser capture a real-phone pass.

- [ ] **Step 1: Run** `npm test`, `npm run test:ship`, `npm run test:loop`, `npm run test:balance`, and `npm run build`; record exact commands and results.
- [ ] **Step 2: Verify** fresh script 4, interrupted script 4 at each phase, active script 3, completed/veteran saves, guided win, normal win/loss, claim idempotency, no paid prompt, camera close/full/battle scales, reduced motion, and 360×800/390×844 captures. Record time to first win and one unprompted normal-job comprehension observation. Request real iPhone and Android passes from Garrett where local physical access is unavailable.
- [ ] **Step 3: Apply Garrett's `mobile-game-design-basics-v11.zip` audit to the first QA build**: verify archive SHA-256 `b83b3fa3e5f7ef1a3a278c335fa26b8f37f919fe84a903e7cc556969e8700760`, run its CSS/contrast/screenshot checks, attach before/after proposals, mark render-only/phone unknowns, and obtain Garrett's approval before changing UI based on that audit.
- [ ] **Step 4: Request a scoped read-only Grok or Claude audit** of the exact package diff for save migration, exact-once claims, camera hit testing, copy, and art provenance. Reproduce findings locally and add failing tests before fixes. Root re-runs the affected suites and full build.
- [ ] **Step 5: Assemble an inactive QA artifact only if authorized**; provide its exact URL/commit and test instructions. Do not merge PR #1, make the build live, activate Jest production, or imply physical-phone PASS from desktop emulation. Update `docs/NEXT.md` and commit `docs: record living-ship QA handoff` with documentation only.

## Rollback and Stop Gates

- Each task is a focused commit, so a rejected task can be reverted without resetting user files. Do not use `git reset --hard` or overwrite dirty files.
- Script-4 selection is fresh-save-only. The preexisting script-3 flow and legacy combat remain executable; disabling the new route behind an explicit feature flag is the QA fallback if an encounter migration defect appears.
- The art batch and QA audit are approval gates, not implied authority from plan approval. An unfinished gate is reported as unfinished, never silently skipped.
- Stop after the inactive QA handoff and ask for owner testing/feedback. Production activation and PR merge remain separate decisions.
