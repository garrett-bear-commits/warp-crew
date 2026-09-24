import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { renderV5Modal, renderSessionGuidance, renderNav, renderCrew, renderRoomSheet, renderOverlays, initialSessionCamera, isGuidedSpotlightBlocked } from '../src/ui/bridge.js';
import { renderShipEncounter } from '../src/ui/contractView.js';
import { renderShipSequence, renderRoomHotspot } from '../src/ui/shipView.js';
import { encounterVisualFrame, pirateDrawSize } from '../src/ui/combatView.js';
import { ROOMS } from '../src/data/starterShip.js';

const fresh = createNewPlayer({ now: 1, rng: () => 0.1 });
const at = phase => ({ ...fresh, tutorial: { ...fresh.tutorial, phase } });
const captain = renderV5Modal(at('captain'));
assert.equal((captain.match(/data-captain-option=/g) || []).length, 4);
assert.equal((captain.match(/data-act="captain-choose"/g) || []).length, 1);
assert.match(captain, /data-captain-name/);
assert.match(captain, /Take command/);
assert.doesNotMatch(captain, /tutorial-next|tutorial-go/);

const gunner = { instanceId: 'captain-1', templateId: 'captain_gunner', isCaptain: true, name: 'Aster', role: 'gunner', stars: 1, level: 1, power: 12 };
const gunnerPlayer = { ...at('hire'), captainInstanceId: gunner.instanceId, crew: [gunner] };
const hire = renderV5Modal(gunnerPlayer);
assert.match(hire, /Bolt/);
assert.match(hire, /Hire for free/);
assert.match(hire, /data-act="tutorial-first-hire"/);
assert.doesNotMatch(hire, /Jen Park/);
const pilot = { ...gunner, templateId: 'captain_cyborg', role: 'pilot' };
assert.match(renderV5Modal({ ...gunnerPlayer, crew: [pilot] }), /Jen Park/);
const crewView = renderCrew({ ...gunnerPlayer, stationAssignments: { 'captain-1': 'weapons' } });
assert.match(crewView, /crew-identity/);
assert.match(crewView, /Weapons/);
const stationView = renderRoomSheet({ ...gunnerPlayer, stationAssignments: { 'captain-1': 'weapons' } }, ROOMS.find(room => room.id === 'workshop'), { current: 5 }, 1);
assert.match(stationView, /crew-identity/);
assert.match(stationView, /★/);
const assigned = { ...gunnerPlayer, tutorial: { ...gunnerPlayer.tutorial, phase: 'assign', firstHireInstanceId: 'bolt-1' }, crew: [gunner, { instanceId: 'bolt-1', templateId: 'merc_bolt', name: 'Bolt', role: 'engineer' }] };
const activeCrew = { ...assigned, tutorial: { ...assigned.tutorial, phase: 'done', completed: true } };
assert.doesNotMatch(renderCrew(activeCrew), /data-act="crew-bench" data-id="captain-1"/);
const cue = renderSessionGuidance(assigned);
assert.match(cue, /Bolt is ready\. Put (him|Bolt) at Shields|Assign Bolt to Shields/);
assert.match(cue, /data-id="bolt-1" data-station="shields"/);
assert.equal((cue.match(/data-spotlight-target/g) || []).length, 1);
assert.match(renderSessionGuidance({ ...assigned, tutorial: { ...assigned.tutorial, phase: 'fight' } }), /Pirates are firing on a trader\. Help them\./);
const distress = { ...assigned, tutorial: { ...assigned.tutorial, phase: 'fight' } };
assert.match(renderOverlays(distress, { isHome: true }), /distress-pair/);
assert.equal(isGuidedSpotlightBlocked(distress, 'select-room'), true);
assert.equal(isGuidedSpotlightBlocked(distress, 'tutorial-fight-start'), false);

const encounter = { version: 2, kind: 'guided', beat: 1, revision: 2, acceptanceId: 'rescue-1', hull: 30, shield: 12, enemyHull: 25,
  outputs: {}, systems: {}, target: 'weapons', beatsToImpact: 1, result: null,
  orders: [{ id: 'target_weapons', available: true, cost: 0, effectLabel: 'Stop the next volley' }] };
const fight = renderShipEncounter({ acceptanceId: 'rescue-1', revision: 2, encounter });
assert.match(fight, /Target their weapons/);
assert.doesNotMatch(fight, /Brace|Advance combat|No order/);
assert.equal((fight.match(/data-primary-pulse/g) || []).length, 1);
const disabledFight = renderShipEncounter({ acceptanceId: 'rescue-1', revision: 3, encounter: { ...encounter, beat: 2, orders: [], weaponDisabled: true } });
assert.match(disabledFight, /Pirate weapons disabled/);
assert.doesNotMatch(disabledFight, /Incoming fire/);
assert.match(renderShipEncounter({ acceptanceId: 'rescue-1', revision: 3, encounter: { ...encounter, result: 'win', orders: [] } }), /Bring cargo aboard/);

const register = renderV5Modal({ ...assigned, tutorial: { ...assigned.tutorial, phase: 'register', welcomeInstanceId: 'bolt-1' } }, { jestLive: false });
assert.match(register, /saved in this browser/i);
assert.doesNotMatch(register, /cloud save|sync across devices/i);
assert.match(register, /Continue to ship/);
assert.equal(renderV5Modal(at('assign')), '');
assert.match(renderOverlays({ ...assigned, tutorial: { ...assigned.tutorial, phase: 'done', completed: true }, stats: { contractsCompleted: 1 }, activeContract: null }, { isHome: true, selectedRoom: null, now: 1 }), /See contracts/);

assert.match(renderShipSequence('crew-arrival', { templateId: 'merc_bolt', name: 'Bolt' }), /Bolt aboard · heading to Shields/);
assert.equal(renderShipSequence(null), '');
assert.match(renderShipSequence('crew-arrival', { templateId: 'merc_jen', name: 'Jen Park' }), /Jen Park aboard · heading to Weapons/);
assert.match(renderShipSequence('crew-arrival', { templateId: 'merc_tink', name: 'Tink' }), /Tink aboard · new crew ready/);
const readyCrewTab = { ...fresh, dailyPullAvailable: true, tutorial: { ...fresh.tutorial, phase: 'done', completed: true } };
assert.match(renderNav('ship', readyCrewTab, false, ['ship', 'crew', 'shop'], null), /nav-badge/);
assert.doesNotMatch(renderNav('ship', readyCrewTab, false, ['ship', 'crew', 'shop'], null, true), /nav-badge/);
assert.doesNotMatch(renderNav('ship', { ...readyCrewTab, crewSlots: 1, crew: [gunner], reserve: Array.from({ length: 20 }, (_, i) => ({ instanceId: `r${i}` })) }, false, ['ship', 'crew', 'shop'], null), /nav-badge/);
assert.doesNotMatch(renderNav('ship', fresh, false, ['ship', 'shop'], null), /nav-badge/);
const cargo = ROOMS.find(room => room.id === 'cargo');
assert.match(renderRoomHotspot({ room: cargo, signal: 'return' }), /attention-dot/);
assert.doesNotMatch(renderRoomHotspot({ room: cargo, signal: '' }), /attention-dot/);
const camera = initialSessionCamera({ w: 390, h: 620 });
assert.ok(camera.scale > camera.minScale);
assert.deepEqual(encounterVisualFrame({ hull: 28, shield: 8, enemy: { hull: 16 }, kind: 'guided' }, [
  { type: 'enemy_weapon_disabled' }, { type: 'weapon_damage' }, { type: 'enemy_impact' },
]).shots, [{ ally: true }, { ally: false }]);
assert.equal(encounterVisualFrame({ hull: 28, shield: 8, enemy: { hull: 16 }, kind: 'guided' }, [
  { type: 'enemy_weapon_disabled' },
]).weaponDisabled, true);
assert.deepEqual(pirateDrawSize(400, 200, 0.5), { width: 250, height: 125 });
assert.deepEqual(pirateDrawSize(512, 768, 0.5), { width: 500 / 3, height: 250 });
console.log('first_play_ui.test.mjs OK');
