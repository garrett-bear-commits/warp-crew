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

