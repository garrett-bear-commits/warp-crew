import assert from 'node:assert/strict';
import { createCameraController } from '../src/ui/shipCameraController.js';
import { guidedStationTap } from '../src/ui/bridge.js';

function setup(scale = 0.25, cameraDisabled = false) {
  const handlers = new Map();
  const captures = new Set();
  const surface = {
    addEventListener(name, fn) { handlers.set(name, fn); },
    removeEventListener(name) { handlers.delete(name); },
    setPointerCapture(id) { captures.add(id); },
    releasePointerCapture(id) { captures.delete(id); },
    hasPointerCapture(id) { return captures.has(id); },
    getBoundingClientRect() { return { left: 10, top: 20 }; },
    classList: { contains(name) { return cameraDisabled && name === 'camera-disabled'; } },
  };
  let camera = { x: 0, y: 0, scale, minScale: 0.2, maxScale: 2,
    viewport: { w: 390, h: 620 }, world: { w: 1152, h: 1728 } };
  const taps = [];
  const control = createCameraController({ surface, getCamera: () => camera,
    setCamera: next => { camera = next; }, onTap: point => taps.push(point), onFocus() {} });
  const send = (name, id, x, y, detail = 1, target = null) => {
    const event = { pointerId: id, clientX: x, clientY: y, button: 0, detail,
      target,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; } };
    handlers.get(name)?.(event);
    return event;
  };
  return { send, taps, control, get camera() { return camera; }, handlers };
}

// A captain identity marker remains a real button; camera capture must not consume its click.
{
  const s = setup();
  const target = { closest: selector => selector.includes('.captain-marker') ? {} : null };
  s.send('pointerdown', 1, 110, 120, 1, target);
  s.send('pointerup', 1, 110, 120, 1, target);
  const click = s.send('click', 1, 110, 120, 1, target);
  assert.equal(click.stopped, false);
  assert.equal(s.taps.length, 0);
  s.control.destroy();
}

// Lost capture must consume a following pointer click without blocking a new tap or keyboard click.
{
  const s = setup();
  s.send('pointerdown', 1, 110, 120);
  s.send('lostpointercapture', 1, 110, 120);
  const cancelledClick = s.send('click', 1, 110, 120);
  assert.equal(cancelledClick.stopped, true);
  assert.equal(s.taps.length, 0);
  s.send('pointerdown', 2, 110, 120);
  s.send('pointerup', 2, 110, 120);
  assert.equal(s.taps.length, 1);
  const keyboardClick = s.send('click', 2, 110, 120, 0);
  assert.equal(keyboardClick.stopped, false);
  s.control.destroy();
}

// Combat keeps the playfield gesture surface active even when battle UI is live.
{
  const s = setup(0.4, true);
  s.send('pointerdown', 1, 110, 120);
  s.send('pointermove', 1, 130, 120);
  assert.equal(s.camera.x, 20);
  s.control.destroy();
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

const assignment = { tutorial: { script: 5, phase: 'assign', firstHireInstanceId: 'jen-1' },
  crew: [{ instanceId: 'jen-1', templateId: 'merc_jen' }] };
assert.deepEqual(guidedStationTap(assignment, 'workshop', 0.2, 0.2), { kind: 'focus', room: 'workshop' });
assert.deepEqual(guidedStationTap(assignment, 'workshop', 0.5, 0.2), { kind: 'assign', id: 'jen-1', station: 'weapons' });
assert.equal(guidedStationTap(assignment, 'bridge', 0.5, 0.2), null);
