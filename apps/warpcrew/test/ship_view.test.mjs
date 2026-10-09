import { SPARROW_LAYOUT } from '../src/data/starterShip.js';
import {
  polygonCss,
  renderRoomHotspot,
} from '../src/ui/shipView.js';

const bridge = SPARROW_LAYOUT.rooms.find((room) => room.id === 'bridge');
const clip = polygonCss(bridge.hitPolygon);
const r2 = (value) => Math.round(value * 100) / 100;
const [left, top, right, bottom] = [bridge.left, bridge.top, r2(bridge.left + bridge.w), r2(bridge.top + bridge.h)];
if (clip !== `polygon(${left}% ${top}%, ${right}% ${top}%, ${right}% ${bottom}%, ${left}% ${bottom}%)` || /\d{5}/.test(clip)) {
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
// Labels may be wider than a compartment. Keep polygon hit ownership on the
// button but render its passive label outside that clipping ancestor.
if (!/<\/button>\s*<span[^>]*class="room-tag"/.test(html)) throw new Error('room label remains clipped inside hotspot');
if (!html.includes('data-room-label="bridge"')) throw new Error('missing room label identity');
if (!/<span[^>]*class="room-tag"[^>]*aria-hidden="true"/.test(html)) throw new Error('passive label duplicates accessible button name');

console.log('ship_view.test.mjs OK');
