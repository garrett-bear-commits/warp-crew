import assert from 'node:assert/strict';
import { createCameraController } from '../src/ui/shipCameraController.js';

function setup(scale = 0.25) {
  const handlers = new Map();
  const captures = new Set();
  const surface = {
    addEventListener(name, fn) { handlers.set(name, fn); },
    removeEventListener(name) { handlers.delete(name); },
    setPointerCapture(id) { captures.add(id); },
    releasePointerCapture(id) { captures.delete(id); },
    hasPointerCapture(id) { return captures.has(id); },
    getBoundingClientRect() { return { left: 10, top: 20 }; },
  };
  let camera = { x: 0, y: 0, scale, minScale: 0.2, maxScale: 2,
    viewport: { w: 390, h: 620 }, world: { w: 1152, h: 1728 } };
  const taps = [];
  const control = createCameraController({ surface, getCamera: () => camera,
    setCamera: next => { camera = next; }, onTap: point => taps.push(point), onFocus() {} });
  const send = (name, id, x, y) => handlers.get(name)?.({ pointerId: id,
    clientX: x, clientY: y, button: 0, preventDefault() {} });
  return { send, taps, control, get camera() { return camera; }, handlers };
}

// Crossing the drag threshold in small moves pans by the full drag distance.
{
  const s = setup(0.4);
  s.send('pointerdown', 1, 110, 120);
  s.send('pointermove', 1, 114, 120);
  s.send('pointermove', 1, 118, 120);
  assert.equal(s.camera.x, 8);
  s.control.destroy();
}

// Moving the pinch midpoint keeps its original world point under the new midpoint.
{
  const s = setup(0.4);
  s.send('pointerdown', 1, 110, 120);
  s.send('pointerdown', 2, 210, 120);
  s.send('pointermove', 2, 260, 120);
  assert.ok(Math.abs(s.camera.scale - 0.6) < 0.0001);
  assert.ok(Math.abs(s.camera.x - -50) < 0.0001);
  assert.ok(Math.abs(s.camera.y - -50) < 0.0001);
  s.control.destroy();
}

// A second finger after a drag must never turn the release into a station tap.
{
  const s = setup();
  s.send('pointerdown', 1, 100, 100);
  s.send('pointermove', 1, 140, 100);
  s.send('pointerdown', 2, 250, 100);
  const before = s.camera.scale;
  s.send('pointermove', 2, 280, 100);
  s.send('pointerup', 2, 280, 100);
  s.send('pointerup', 1, 140, 100);
  assert.ok(s.camera.scale > before, 'pinch increases camera scale');
  assert.equal(s.taps.length, 0);
  assert.equal(s.control.wasGesture(), true);
  s.control.destroy();
}

// A release far from its press is a gesture even if no move event was delivered.
{
  const s = setup();
  s.send('pointerdown', 1, 100, 100);
  s.send('pointerup', 1, 140, 100);
  assert.equal(s.taps.length, 0);
  assert.equal(s.control.wasGesture(), true);
  s.control.destroy();
}

// A cancelled pointer cannot leave a phantom finger that blocks future taps.
for (const endedBy of ['pointercancel', 'lostpointercapture']) {
  const s = setup();
  s.send('pointerdown', 1, 100, 100);
  s.send(endedBy, 1, 100, 100);
  s.send('pointerdown', 2, 110, 120);
  s.send('pointerup', 2, 110, 120);
  assert.deepEqual(s.taps, [{ x: 400, y: 400 }], `${endedBy} clears pointer state`);
  s.control.destroy();
}

// Stationary release uses coordinates relative to the playfield, then unprojects.
{
  const s = setup();
  s.send('pointerdown', 1, 110, 120);
  s.send('pointerup', 1, 110, 120);
  assert.deepEqual(s.taps, [{ x: 400, y: 400 }]);
  s.send('pointerdown', 2, 110, 120);
  s.send('pointerup', 2, 110, 120);
  assert.equal(s.taps.length, 2, 'a second stationary tap remains available');
  s.control.destroy();
  assert.equal(s.handlers.size, 0);
}

console.log('ship_camera_input.test.mjs OK');
