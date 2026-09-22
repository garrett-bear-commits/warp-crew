import assert from 'node:assert/strict';
import { SPARROW_LAYOUT } from '../src/data/starterShip.js';
import {
  contractShipSignals,
  renderRoomHotspot,
  renderDepartureStatus,
  renderShipFeedback,
} from '../src/ui/shipView.js';
import { renderHotspots, renderPlatformLoginEntry } from '../src/ui/bridge.js';
import {
  crewTargetStates,
  departureActionBlocked,
  holdCrewForDeparture,
  moveCrewToDeparture,
  syncCrewLayer,
} from '../src/ui/crewWalk.js';
import { stopStageLoop } from '../src/ui/stageLoop.js';

// Catches losing the ship-space indication for an active/returned route or
// failing to render the durable first Sparrow repair after the route clears.
const base = { activeContract: null, flags: {}, crew: [] };
assert.deepEqual(contractShipSignals(base), {
  operationsActive: false,
  cargoReady: false,
  firstRepairLit: false,
});
assert.deepEqual(contractShipSignals({
  ...base,
  activeContract: { stage: 'choice' },
}), {
  operationsActive: true,
  cargoReady: false,
  firstRepairLit: false,
});
assert.deepEqual(contractShipSignals({
  ...base,
  activeContract: { stage: 'return' },
  flags: { sparrowFirstRepair: true },
}), {
  operationsActive: false,
  cargoReady: true,
  firstRepairLit: true,
});
assert.equal(contractShipSignals({
  ...base,
  flags: { sparrowFirstRepair: true },
}).firstRepairLit, true);

const operations = SPARROW_LAYOUT.rooms.find((room) => room.id === 'operations');
const operationsHtml = renderRoomHotspot({ room: operations, signal: 'route' });
assert.match(operationsHtml, /contract-route/);
assert.match(operationsHtml, /aria-label="Operations, route active"/);
assert.match(operationsHtml, />ROUTE</);

const cargo = SPARROW_LAYOUT.rooms.find((room) => room.id === 'cargo');
const cargoHtml = renderRoomHotspot({ room: cargo, signal: 'return' });
assert.match(cargoHtml, /contract-return/);
assert.match(cargoHtml, /aria-label="Cargo Hold, reward ready"/);
assert.match(cargoHtml, />REWARD</);

const repairHtml = renderShipFeedback({
  operationsActive: false,
  cargoReady: false,
  firstRepairLit: true,
});
assert.match(repairHtml, /sparrow-first-repair is-lit/);
assert.match(repairHtml, /Sparrow repair online/);
assert.match(repairHtml, /repair-prop/);

const shipPlayer = {
  ship: { systems: { sensors: 1, cargo: 1 } },
  activeContract: { stage: 'choice' },
  activeExpedition: null,
  flags: {},
};
const routeHotspots = renderHotspots(shipPlayer, { pendingWhole: false }, false, null);
assert.match(routeHotspots, /contract-route/);
assert.doesNotMatch(routeHotspots, /contract-return/);
const returnHotspots = renderHotspots({
  ...shipPlayer,
  activeContract: { stage: 'return' },
}, { pendingWhole: false }, false, null);
assert.match(returnHotspots, /contract-return/);
assert.doesNotMatch(returnHotspots, /contract-route/);

const crew = [
  { instanceId: 'crew-pilot', role: 'pilot', status: 'ready' },
  { instanceId: 'crew-engineer', role: 'engineer', status: 'ready' },
  { instanceId: 'crew-gunner', role: 'gunner', status: 'ready' },
];
const routeTargets = crewTargetStates({
  crew,
  activeContract: { stage: 'choice' },
});
assert.deepEqual(routeTargets, [
  {
    crewInstanceId: 'crew-pilot',
    mode: 'contract-station',
    roomId: 'bridge',
    anchors: [{ x: 56, y: 20 }],
    immediate: false,
  },
  {
    crewInstanceId: 'crew-engineer',
    mode: 'contract-station',
    roomId: 'engineering',
    anchors: [{ x: 56, y: 84 }],
    immediate: false,
  },
]);

const departureTargets = crewTargetStates({ crew, activeContract: null }, {
  departingCrewInstanceIds: ['crew-gunner', 'crew-pilot'],
  reducedMotion: true,
});
assert.deepEqual(departureTargets.map((target) => target.crewInstanceId), ['crew-gunner', 'crew-pilot']);
for (const target of departureTargets) {
  assert.equal(target.mode, 'expedition-departure');
  assert.equal(target.roomId, 'cargo');
  assert.deepEqual(target.anchors, [
    SPARROW_LAYOUT.anchors.cargoDeparture,
    SPARROW_LAYOUT.anchors.airlock,
  ]);
  assert.equal(target.immediate, true);
}
assert.equal(departureTargets.some((target) => target.crewInstanceId === 'crew-engineer'), false);

// Exercise real initialized actors through the production RAF callback. The
// fake canvas records actor shadow feet, so contract targets remain observable.
let nextFrame = null;
let frameId = 0;
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
globalThis.requestAnimationFrame = (callback) => { nextFrame = callback; return ++frameId; };
globalThis.cancelAnimationFrame = () => { nextFrame = null; };
globalThis.document = { hidden: false };
globalThis.window = {
  devicePixelRatio: 1,
  matchMedia: () => motion,
  addEventListener() {},
};
globalThis.ResizeObserver = class {
  observe() {}
};

const shadowFeet = [];
const gradient = { addColorStop() {} };
const context = {
  setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
  fill() {}, fillRect() {}, drawImage() {}, moveTo() {}, lineTo() {}, closePath() {},
  createRadialGradient: () => gradient,
  createLinearGradient: () => gradient,
  ellipse(x, y, rx, ry) { if (rx === 9 && ry === 2.5) shadowFeet.push([x, y]); },
  imageSmoothingEnabled: false,
};
const canvas = {
  tagName: 'CANVAS',
  isConnected: true,
  width: 0,
  height: 0,
  getBoundingClientRect: () => ({ width: 100, height: 100 }),
  getContext: () => context,
};
const runFrame = () => {
  const callback = nextFrame;
  assert.ok(callback, 'stage loop scheduled');
  frameNow += 50;
  callback(frameNow);
};
const runUntil = (predicate, limit = 400) => {
  for (let i = 0; i < limit && !predicate(); i++) runFrame();
  assert.equal(predicate(), true, `condition incomplete after ${limit} frames`);
};
const selectedIds = ['crew-gunner', 'crew-pilot'];
const readyPlayer = { crew, activeContract: null };
const awayPlayer = {
  ...readyPlayer,
  crew: crew.map((member) => selectedIds.includes(member.instanceId)
    ? { ...member, status: 'expedition' }
    : member),
};

syncCrewLayer(canvas, readyPlayer);
holdCrewForDeparture(selectedIds);
syncCrewLayer(canvas, awayPlayer);
let normalCompletions = 0;
moveCrewToDeparture(awayPlayer, selectedIds, {
  reducedMotion: false,
  onDone: () => { normalCompletions++; syncCrewLayer(canvas, awayPlayer); },
});
runUntil(() => normalCompletions === 1);
for (let i = 0; i < 5; i++) runFrame();
assert.equal(normalCompletions, 1, 'normal departure completes exactly once');

motion.set(true);
syncCrewLayer(canvas, readyPlayer);
holdCrewForDeparture(selectedIds);
syncCrewLayer(canvas, awayPlayer);
let initialReducedCompletions = 0;
const reducedPlan = moveCrewToDeparture(awayPlayer, selectedIds, {
  reducedMotion: true,
  onDone: () => { initialReducedCompletions++; syncCrewLayer(canvas, awayPlayer); },
});
assert.equal(initialReducedCompletions, 1, 'initial reduced motion completes immediately');
assert.deepEqual(reducedPlan.map((target) => target.crewInstanceId), selectedIds);

motion.set(false);
syncCrewLayer(canvas, readyPlayer);
holdCrewForDeparture(selectedIds);
syncCrewLayer(canvas, awayPlayer);
let changedMotionCompletions = 0;
moveCrewToDeparture(awayPlayer, selectedIds, {
  reducedMotion: false,
  onDone: () => { changedMotionCompletions++; syncCrewLayer(canvas, awayPlayer); },
});
for (let i = 0; i < 4; i++) runFrame();
assert.equal(changedMotionCompletions, 0, 'animated departure remains in flight');
motion.set(true);
assert.equal(changedMotionCompletions, 1, 'motion change snaps and completes departure');
motion.set(true);
assert.equal(changedMotionCompletions, 1, 'motion change completion is exact once');

motion.set(false);
syncCrewLayer(canvas, { crew, activeContract: { stage: 'choice' } });
runFrame();
motion.set(true);
shadowFeet.length = 0;
runFrame();
assert.ok(shadowFeet.some(([x, y]) => Math.abs(x - 56) < 0.001 && Math.abs(y - 21) < 0.001), `Bridge actor snapped to authored work anchor: ${JSON.stringify(shadowFeet)}`);
assert.ok(shadowFeet.some(([x, y]) => Math.abs(x - 56) < 0.001 && Math.abs(y - 85) < 0.001), `Engineering actor snapped to authored work anchor: ${JSON.stringify(shadowFeet)}`);
stopStageLoop();

const loginEntry = renderPlatformLoginEntry();
assert.match(loginEntry, /data-act="prompt-login"/);
assert.match(loginEntry, /Optional Jest sign-in/);
assert.doesNotMatch(loginEntry, /register|save|sync|across devices?/i);

assert.equal(departureActionBlocked('goto-contracts'), false);
assert.equal(departureActionBlocked('select-room'), false);
assert.equal(departureActionBlocked('close-toast'), false);
assert.equal(departureActionBlocked('exp-start'), true);
assert.equal(departureActionBlocked('exp-launch'), true);
const departureStatus = renderDepartureStatus(true);
assert.match(departureStatus, /role="status"/);
assert.match(departureStatus, /aria-live="polite"/);
assert.match(departureStatus, /Away team boarding through Cargo/);
assert.equal(renderDepartureStatus(false), '');

console.log('contract_ship_feedback.test.mjs OK');
