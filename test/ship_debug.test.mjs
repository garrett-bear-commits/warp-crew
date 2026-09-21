import { SPARROW_LAYOUT } from '../src/data/starterShip.js';
import {
  renderShipDebug,
  shipDebugEnabled,
} from '../src/ui/shipDebug.js';

if (!shipDebugEnabled({ dev: true, search: '?shipDebug=1' })) {
  throw new Error('debug flag off in development');
}
if (shipDebugEnabled({ dev: false, search: '?shipDebug=1' })) {
  throw new Error('debug leaked to production');
}
if (shipDebugEnabled({ dev: true, search: '' })) {
  throw new Error('debug enabled without query flag');
}

const html = renderShipDebug(SPARROW_LAYOUT);
for (const room of SPARROW_LAYOUT.rooms) {
  if (!html.includes(`data-debug-room="${room.id}"`)) {
    throw new Error(`missing room ${room.id}`);
  }
}
for (const door of SPARROW_LAYOUT.doors) {
  if (!html.includes(`data-debug-door="${door.id}"`)) {
    throw new Error(`missing door ${door.id}`);
  }
}

console.log('ship_debug.test.mjs OK');
