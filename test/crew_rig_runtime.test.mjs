import assert from 'node:assert/strict';
import { CREW_RIG } from '../src/data/crewRigManifest.js';

// Drive real actors through the production RAF and record what the crew canvas
// draws: which baked sheet, which frame, and whether it was mirrored.
let nextFrame = null;
let frameNow = performance.now();
const motionListeners = new Set();
const motion = {
  matches: false,
  addEventListener(type, listener) { if (type === 'change') motionListeners.add(listener); },
  set(matches) {
    this.matches = matches;
    for (const listener of motionListeners) listener({ matches });
  },
};
globalThis.requestAnimationFrame = (callback) => { nextFrame = callback; return 1; };
globalThis.cancelAnimationFrame = () => { nextFrame = null; };
globalThis.document = { hidden: false, baseURI: 'http://localhost/' };
globalThis.window = { devicePixelRatio: 1, matchMedia: () => motion, addEventListener() {} };
globalThis.ResizeObserver = class { observe() {} };
globalThis.Image = class {
  constructor() { this.complete = true; this.naturalWidth = 1; }
  set src(value) { this._src = value; }
  get src() { return this._src; }
};

const { syncCrewLayer } = await import('../src/ui/crewWalk.js');

const draws = [];
let mirrored = false;
const gradient = { addColorStop() {} };
const context = {
  setTransform() {}, clearRect() {}, beginPath() {}, fill() {}, fillRect() {}, moveTo() {}, lineTo() {},
  closePath() {}, ellipse() {}, quadraticCurveTo() {},
  save() { this._stack = [...(this._stack || []), mirrored]; },
  restore() { mirrored = this._stack.pop(); },
  translate() {},
  scale(x) { if (x < 0) mirrored = !mirrored; },
  createRadialGradient: () => gradient,
  createLinearGradient: () => gradient,
  drawImage(image, sx, sy, sw, sh) {
    draws.push({ id: this.__wcActorInstanceId, src: image.src, sx, sw, flip: mirrored });
  },
  imageSmoothingEnabled: false,
};
const canvas = {
  tagName: 'CANVAS', isConnected: true, width: 0, height: 0,
  getBoundingClientRect: () => ({ width: 100, height: 100 }),
  getContext: () => context,
};
const runFrame = () => {
  const callback = nextFrame;
  assert.ok(callback, 'stage loop scheduled');
  frameNow += 50;
  callback(frameNow);
};

const crew = [
  { instanceId: 'a1', templateId: 'captain_alien', role: 'scout', status: 'ready' },
  { instanceId: 'd1', templateId: 'captain_droid', role: 'engineer', status: 'ready' },
  { instanceId: 'h1', templateId: 'merc_rex', role: 'pilot', status: 'ready' },
];
const player = { crew, activeContract: null, stationAssignments: { h1: 'helm', d1: 'engineering' } };
syncCrewLayer(canvas, player);

const clipOf = (src) => src.match(/_(walk|idle|work)\.png$/)[1];
const lookOf = (src) => src.match(/crew\/(\w+?)_(walk|idle|work)\.png$/)[1];
const seen = new Map();
for (let i = 0; i < 600; i++) {
  draws.length = 0;
  runFrame();
  for (const d of draws) {
    const key = `${d.id}:${clipOf(d.src)}`;
    const entry = seen.get(key) || { frames: new Set(), flips: new Set(), look: lookOf(d.src) };
    entry.frames.add(d.sx / CREW_RIG.cell.w);
    entry.flips.add(d.flip);
    assert.equal(d.sw, CREW_RIG.cell.w);
    seen.set(key, entry);
  }
}

// Alien and droid captains draw their own animated sheets, not markers.
assert.equal(seen.get('a1:walk')?.look, 'captain_alien');
assert.equal(seen.get('d1:walk')?.look, 'captain_droid');
assert.equal(CREW_RIG.looks.captain_alien.family, 'alien');
assert.equal(CREW_RIG.looks.captain_droid.family, 'droid');
// Walking crew cycle through the 8-frame strip, both facings.
const alienWalk = seen.get('a1:walk');
assert.ok(alienWalk && alienWalk.frames.size >= 6, 'unassigned alien walks the full cycle');
assert.ok(seen.get('d1:work') || seen.get('d1:walk'), 'droid drew an animated clip');
assert.ok([...seen.values()].some(e => e.flips.has(true)), 'someone walked left (mirrored)');
assert.ok([...seen.values()].some(e => e.flips.has(false)), 'someone walked right');
// Stationed crew run the work loop at their anchor.
const work = seen.get('h1:work') || seen.get('d1:work');
assert.ok(work && work.frames.size >= 6, 'stationed crew animate the work loop');
// Off-station stops use the 9-frame idle loop.
const idle = seen.get('a1:idle');
assert.ok(idle && idle.frames.size >= 7, 'visiting crew stand in the idle loop');

// Reduced motion: frame animation stops (every draw is frame 0).
motion.set(true);
syncCrewLayer(canvas, player);
const reducedFrames = new Set();
for (let i = 0; i < 40; i++) {
  draws.length = 0;
  runFrame();
  for (const d of draws) reducedFrames.add(d.sx);
}
assert.deepEqual([...reducedFrames], [0], 'reduced motion draws only frame 0');

console.log('crew_rig_runtime.test.mjs OK');
