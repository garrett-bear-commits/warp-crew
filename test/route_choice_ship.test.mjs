import assert from 'node:assert/strict';
import { renderOverlays } from '../src/ui/bridge.js';

const player = { tutorial: { script: 4, phase: 'done', completed: true },
  activeContract: { stage: 'choice' }, ship: { shipId: 'sparrow' }, stats: { contractsCompleted: 1 } };
const model = { revision: 2, acceptanceId: 'route-17', actions: [
  { id: 'secure', label: 'Secure the contract · 0F', enabled: true },
  { id: 'push', label: 'Push the signal · 0F', enabled: true },
] };
const html = renderOverlays(player, { isHome: true, selectedRoom: null, activeContractView: model });
assert.match(html, /aria-label="Route choice"/);
assert.match(html, /data-action="secure"[^>]*data-revision="2"[^>]*data-acceptance-id="route-17"/);
assert.match(html, /data-action="push"[^>]*data-revision="2"[^>]*data-acceptance-id="route-17"/);
assert.doesNotMatch(renderOverlays(player, { isHome: false, selectedRoom: null, activeContractView: model }), /aria-label="Route choice"/);
console.log('route_choice_ship.test.mjs OK');
