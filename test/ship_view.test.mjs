import { SPARROW_LAYOUT } from '../src/data/starterShip.js';
import {
  polygonCss,
  renderRoomHotspot,
} from '../src/ui/shipView.js';

const bridge = SPARROW_LAYOUT.rooms.find((room) => room.id === 'bridge');
const clip = polygonCss(bridge.hitPolygon);
if (clip !== 'polygon(38% 10%, 62% 10%, 62% 23%, 38% 23%)') {
  throw new Error(`bridge clip ${clip}`);
}

const html = renderRoomHotspot({
  room: bridge,
  selected: true,
  alert: 'good',
  level: null,
});
if (!html.includes('data-room="bridge"')) throw new Error('missing room id');
if (!html.includes('aria-label="Bridge, ready"')) throw new Error('missing accessible state');
if (!html.includes('selected')) throw new Error('missing selected state');
if (!html.includes('has-alert')) throw new Error('missing alert state');
if (!html.includes('clip-path:polygon(')) throw new Error('missing polygon style');

console.log('ship_view.test.mjs OK');
