// Drag crew to rooms in FTL-lite fights (chip or ship sprite), with tap-then-tap untouched.
import assert from 'node:assert/strict';
import { bindFtlCrewDrag, dropTargetAt, renderDragGhost, DRAG_START_PX } from '../src/ui/ftlCrewDrag.js';
import { renderFtlShipMarkers } from '../src/ui/ftlView.js';

const classList = () => {
  const set = new Set();
  return { add: c => set.add(c), remove: c => set.delete(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: c => set.has(c), set };
};

function setup({ view, sprite = null } = {}) {
  const rootListeners = {};
  const winListeners = {};
  let pointStack = [];
  const shell = { classList: classList(), children: [], appendChild(el) { this.children.push(el); el.parentNode = this; return el; } };
  const doc = {
    createElement: () => ({ classList: classList(), style: {}, setAttribute() {}, remove() { shell.children = shell.children.filter(c => c !== this); },
      set className(v) { this._cls = v; }, get className() { return this._cls; } }),
    elementsFromPoint: () => pointStack,
    defaultView: {
      addEventListener: (n, fn) => { winListeners[n] = fn; },
      removeEventListener: n => { delete winListeners[n]; },
    },
  };
  const root = {
    ownerDocument: doc,
    addEventListener: (n, fn, capture) => { rootListeners[n] = { fn, capture }; },
    removeEventListener: n => { delete rootListeners[n]; },
    querySelector: sel => (sel === '.wc-shell' ? shell : null),
    querySelectorAll: () => [],
    contains: () => true,
  };
  const calls = { dragging: [], sent: [], selected: [] };
  const drag = bindFtlCrewDrag(root, {
    view: () => view,
    spriteAt: () => sprite,
    setDragging: id => calls.dragging.push(id),
    send: data => calls.sent.push(data),
    select: id => calls.selected.push(id),
  });
  const event = (fields) => ({ pointerId: 1, isPrimary: true, button: 0, pointerType: 'touch', clientX: 0, clientY: 0,
    stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }, ...fields });
  return {
    drag, calls, shell, rootListeners, winListeners,
    setStack: list => { pointStack = list; },
    down: (target, x, y) => { const ev = event({ target, clientX: x, clientY: y }); rootListeners.pointerdown.fn(ev); return ev; },
    move: (x, y) => { const ev = event({ clientX: x, clientY: y }); winListeners.pointermove?.(ev); return ev; },
    up: (x, y) => { const ev = event({ clientX: x, clientY: y }); winListeners.pointerup?.(ev); return ev; },
    cancel: () => winListeners.pointercancel?.(event({})),
    click: () => { const ev = event({}); rootListeners.click.fn(ev); return ev; },
  };
}

const view = { ftl: true, result: null, downed: null, crew: [{ id: 'c1', name: 'Jen Okafor', portrait: 'jen.png', room: 'weapons' }, { id: 'c2', name: 'Bolt', room: 'shields' }] };
const chip = id => ({ dataset: { crewId: id }, disabled: false, closest: sel => (sel.startsWith('.ftl-crew-chip') ? chip(id) : null) });
const hull = { closest: sel => (sel === '.stage' ? {} : null) };
const roomButton = (crewId, room) => ({ dataset: { act: 'encounter-command', commandType: 'move', crewId, room, revision: '4', acceptanceId: 'a1' },
  classList: classList(), closest(sel) { return sel === '.ftl-move-target' ? this : null; } });

// Chip drag onto a room sends the move with the room button's identity; the following click is swallowed.
{
  const s = setup({ view });
  const ev = s.down(chip('c1'), 100, 700);
  assert.equal(ev.stopped, false, 'a chip press is not stolen from the click (tap-then-tap still works)');
  s.move(100, 700 - (DRAG_START_PX - 2));
  assert.deepEqual(s.calls.dragging, [], 'small wobble is still a tap');
  s.move(100, 600);
  assert.deepEqual(s.calls.dragging, ['c1'], 'drop targets light for the dragged crew');
  assert.ok(s.shell.classList.contains('ftl-crew-dragging'));
  assert.equal(s.shell.children.length, 1, 'ghost follows the finger');
  assert.equal(s.shell.children[0].style.transform, 'translate(100px, 600px)');
  const target = roomButton('c1', 'engines');
  s.setStack([{ closest: () => null }, target]);
  s.move(120, 300);
  assert.ok(target.classList.contains('is-drop-hover'), 'room under the finger glows');
  assert.equal(s.drag.hoverRoom, 'engines');
  s.up(120, 300);
  assert.deepEqual(s.calls.sent, [target.dataset]);
  assert.deepEqual(s.calls.dragging, ['c1', null]);
  assert.equal(s.shell.children.length, 0, 'ghost removed');
  assert.ok(!s.shell.classList.contains('ftl-crew-dragging'));
  assert.equal(s.click().stopped, true, 'the click after a drag does not also select a chip');
  assert.equal(s.click().stopped, false, 'only one click is swallowed');
}

// Dropping anywhere else cancels; so does pointercancel.
{
  const s = setup({ view });
  s.down(chip('c2'), 100, 700);
  s.move(100, 600);
  s.setStack([]);
  s.up(40, 40);
  assert.deepEqual(s.calls.sent, []);
  assert.deepEqual(s.calls.dragging, ['c2', null]);
  s.down(chip('c2'), 100, 700);
  s.move(100, 600);
  s.cancel();
  assert.deepEqual(s.calls.sent, []);
  assert.equal(s.shell.children.length, 0);
  // A drop target rendered for someone else (stale) is not used.
  s.down(chip('c2'), 100, 700);
  s.move(100, 600);
  s.setStack([roomButton('c1', 'helm')]);
  s.up(100, 300);
  assert.deepEqual(s.calls.sent, []);
}

// A plain chip tap: no drag, no select hook, the native click goes through.
{
  const s = setup({ view });
  s.down(chip('c1'), 100, 700);
  s.up(101, 701);
  assert.deepEqual(s.calls, { dragging: [], sent: [], selected: [] });
  assert.equal(s.click().stopped, false);
}

// A sprite press is taken from the camera (no pan); a tap on it selects, a drag sends.
{
  const s = setup({ view, sprite: 'c2' });
  const ev = s.down(hull, 200, 300);
  assert.equal(ev.stopped, true, 'camera never sees a press on a crew sprite');
  s.up(200, 300);
  assert.deepEqual(s.calls.selected, ['c2']);
  s.down(hull, 200, 300);
  s.move(200, 340);
  s.setStack([roomButton('c2', 'medbay')]);
  s.up(200, 360);
  assert.equal(s.calls.sent[0].room, 'medbay');
}

// Empty hull, a button, or a finished fight: the press is left alone (camera pans as before).
{
  const empty = setup({ view, sprite: null });
  assert.equal(empty.down(hull, 200, 300).stopped, false);
  assert.equal(empty.winListeners.pointermove, undefined);
  const button = { closest: sel => (sel === '.stage' || sel.startsWith('button') ? {} : null) };
  const onButton = setup({ view, sprite: 'c1' });
  assert.equal(onButton.down(button, 1, 1).stopped, false, 'move-target buttons keep tap-then-tap');
  const over = setup({ view: { ...view, result: 'win' }, sprite: 'c1' });
  assert.equal(over.down(hull, 1, 1).stopped, false);
  over.down(chip('c1'), 1, 1);
  assert.equal(over.winListeners.pointermove, undefined);
  // A second finger is never a crew drag.
  const pinch = setup({ view, sprite: 'c1' });
  const second = { ...hull };
  pinch.rootListeners.pointerdown.fn({ pointerId: 2, isPrimary: false, button: 0, target: second, clientX: 1, clientY: 1, stopPropagation() { throw new Error('stolen'); } });
}

// Held at a view edge, the camera drifts (so off-screen rooms come into reach) until the finger leaves the edge.
{
  const frames = [];
  const pans = [];
  const listeners = {};
  const shell = { classList: classList(), appendChild() {} };
  const root = {
    ownerDocument: {
      createElement: () => ({ classList: classList(), style: {}, setAttribute() {}, remove() {} }),
      elementsFromPoint: () => [],
      defaultView: { addEventListener: (n, fn) => { listeners[n] = fn; }, removeEventListener() {},
        requestAnimationFrame: fn => { frames.push(fn); return fn; }, cancelAnimationFrame: fn => { frames.splice(frames.indexOf(fn), 1); } },
    },
    addEventListener: (n, fn) => { listeners[`root:${n}`] = fn; }, removeEventListener() {},
    querySelector: sel => (sel === '.wc-shell' ? shell : null), querySelectorAll: () => [], contains: () => true,
  };
  bindFtlCrewDrag(root, { view: () => view, spriteAt: () => null, setDragging() {}, send() {}, select() {},
    edgePan: (x, y) => { pans.push(y); return y < 50; } });
  const ev = f => ({ pointerId: 1, isPrimary: true, button: 0, target: chip('c1'), stopPropagation() {}, preventDefault() {}, ...f });
  listeners['root:pointerdown'](ev({ clientX: 100, clientY: 700 }));
  listeners.pointermove(ev({ clientX: 100, clientY: 30 }));
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(pans, [30]);
  assert.equal(frames.length, 1, 'keeps drifting while held at the edge');
  listeners.pointermove(ev({ clientX: 100, clientY: 300 }));
  frames.shift()();
  assert.equal(frames.length, 0, 'stops once the finger leaves the edge');
}

// Drop targets and the ghost.
assert.equal(dropTargetAt({ elementsFromPoint: () => [] }, 0, 0), null);
assert.match(renderDragGhost(view.crew[0]), /<img src="jen\.png" alt="" \/><span>Jen<\/span>/);
const fightView = { ftl: true, result: null, downed: null, revision: 3, acceptanceId: 'a', boarders: null,
  enemy: { weapons: [] }, crew: view.crew,
  rooms: { weapons: { id: 'weapons', roomId: 'weapons', integrity: 100, label: 'Weapons' } } };
assert.match(renderFtlShipMarkers(fightView, { selectedCrewId: 'c1', dragging: true }), /class="ftl-move-target is-drop-target"[^>]*data-crew-id="c1" data-room="weapons"/);
assert.doesNotMatch(renderFtlShipMarkers(fightView, { selectedCrewId: 'c1' }), /is-drop-target/);
console.log('ftl_crew_drag.test.mjs OK');
