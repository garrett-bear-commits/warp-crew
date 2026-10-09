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

