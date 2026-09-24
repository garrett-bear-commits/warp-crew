import assert from 'node:assert/strict';
import { renderSplash, renderV4Modal, renderSessionGuidance } from '../src/ui/bridge.js';
import { renderShipEncounter } from '../src/ui/contractView.js';
import { sessionFailureMessage } from '../src/main.js';

const player = {
  ship: { name: 'Sparrow' },
  crew: [{ instanceId: 'welcome', name: 'Kira', role: 'gunner' }],
  tutorial: { phase: 'register', welcomeInstanceId: 'welcome', suggestedStation: 'weapons' },
};
const surfaces = [
  renderSplash({ progress: 100, ready: true }),
  renderV4Modal({ ...player, tutorial: { ...player.tutorial, phase: 'name' } }),
  renderV4Modal({ ...player, tutorial: { ...player.tutorial, phase: 'pull' } }),
  renderV4Modal(player, { jestLive: true }),
  renderV4Modal(player, { jestLive: false }),
  renderShipEncounter({
    revision: 1, acceptanceId: 'job-1',
    encounter: { kind: 'guided', beat: 1, beatsToImpact: 1, target: 'shields',
      hull: 30, shield: 10, enemyHull: 20, outputs: { helm: 100, shields: 110, weapons: 100, engineering: 100 },
      systems: { helm: 100, shields: 100, weapons: 100, engineering: 100 },
      orders: [{ id: 'brace', cost: 2, effectLabel: 'Block hit', cooldownLabel: 'Once', available: true }],
    },
  }),
].join('\n');
assert.match(surfaces, /Board ship/);
assert.match(surfaces, /Progress is saved in this browser/);
assert.match(surfaces, /Jest sign-in is optional/);
assert.match(surfaces, /Brace/);
assert.doesNotMatch(surfaces, /Victory is Guaranteed|favored crew|route profile|cross.device save|cloud save/i);

const stationCue = renderSessionGuidance({ ...player, tutorial: { script: 4, completed: false, phase: 'station' }, crew: [{ templateId: 'merc_bolt', instanceId: 'bolt-1' }] });
assert.match(stationCue, /Distress call: send Bolt to Shields/);
assert.equal((stationCue.match(/class="primary"/g) || []).length, 1);
const fight = renderShipEncounter({ revision: 1, acceptanceId: 'job-1', encounter: {
  kind: 'guided', beat: 1, beatsToImpact: 1, target: 'shields', hull: 30, shield: 10,
  enemyHull: 20, outputs: { helm: 100, shields: 110, weapons: 100, engineering: 100 },
  systems: { helm: 100, shields: 100, weapons: 100, engineering: 100 },
  orders: [{ id: 'brace', cost: 2, effectLabel: 'Block hit', cooldownLabel: 'Once', available: true }],
} });
assert.match(fight, /Brace<span>/);
assert.match(fight, /Spend 2 shield to block the hit/);
assert.equal(sessionFailureMessage('tutorial_station_required'), 'Send Bolt to Shields first.');
assert.equal(sessionFailureMessage('brace_required'), 'Brace before the pirate fires.');
assert.equal(sessionFailureMessage('save_failed'), 'Could not save. Try again.');
