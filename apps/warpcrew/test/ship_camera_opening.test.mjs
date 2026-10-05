import assert from 'node:assert/strict';
import { initialSessionCamera } from '../src/ui/bridge.js';
import { makeCamera, project } from '../src/ui/shipCamera.js';
import { HULL_PX, roomWorldPoint } from '../src/data/starterShip.js';

const viewport = { w: 390, h: 730 };
const wholeShip = makeCamera(viewport, HULL_PX);
const opening = initialSessionCamera(viewport);
const bridge = project(opening, roomWorldPoint('bridge'));
assert.ok(opening.scale > wholeShip.scale * 1.8, 'first look should show the bridge at usable scale');
assert.ok(Math.abs(bridge.x - viewport.w / 2) < 1);
assert.ok(Math.abs(bridge.y - viewport.h * 0.3) < 1, 'bridge should sit high enough to reveal the working ship below');
