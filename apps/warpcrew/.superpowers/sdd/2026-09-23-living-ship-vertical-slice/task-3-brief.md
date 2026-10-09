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

