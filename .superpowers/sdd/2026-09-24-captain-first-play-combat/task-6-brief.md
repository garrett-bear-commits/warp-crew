### Task 6: Mockup-derived UI, camera cues, and event presentation

**Files:** Modify src/ui/bridge.js, src/ui/contractView.js, src/ui/shipView.js, src/ui/style.css, src/main.js; create test/first_play_ui.test.mjs; extend test/first_session_copy.test.mjs and test/ship_camera_input.test.mjs.

**Interfaces:** renderV5Modal(player) renders only captain, hire, name_ship, pull, and registration sheets. renderSessionGuidance renders a short ship-anchored assignment/distress cue. renderEncounter shows target_weapons only when allowed by the saved model; result state shows the cargo action. Captain and crew sheets share portrait, role, star, current job, and one useful stat layout. The existing camera controller and ship layout remain authoritative for pan/pinch/hit testing.

- [ ] **Step 1: Write failing render tests.** The break caught is a text-only next-button flow or a hidden extra order:

~~~js
const freshV5 = { ...createNewPlayer({ now: 1, rng: () => 0.1 }), tutorial: { script: 5, phase: 'captain' } };
const choice = renderV5Modal(freshV5, { jestLive: false });
assert.equal((choice.match(/data-captain-option=/g) || []).length, 4);
assert.equal((choice.match(/data-act="captain-choose"/g) || []).length, 1);
assert.match(choice, /data-captain-name/);
const targetWindowModel = { acceptanceId: 'rescue-1', revision: 2, encounter: {
  version: 2, kind: 'guided', beat: 1, revision: 2, acceptanceId: 'rescue-1',
  hull: 30, shield: 12, enemyHull: 25, outputs: {}, systems: {},
  target: 'weapons', beatsToImpact: 1, result: null,
  orders: [{ id: 'target_weapons', available: true, cost: 0, effectLabel: 'Stop the next volley' }],
} };
const battle = renderShipEncounter(targetWindowModel);
assert.match(battle, /Target their weapons/);
assert.doesNotMatch(battle, /Brace/);
assert.doesNotMatch(battle, /Advance combat/);
const registerState = { ...freshV5, tutorial: { script: 5, phase: 'register' } };
const register = renderV5Modal(registerState, { jestLive: false });
assert.match(register, /saved in this browser/i);
assert.doesNotMatch(register, /cloud save|sync across devices/i);
~~~

- [ ] **Step 2: Run** node test/first_play_ui.test.mjs; expect absent v5 render or wrong order copy.
- [ ] **Step 3: Implement** the four-screen mockup's worn dark plates, large portraits, generous action controls, simple bars, and visible two-ship battle composition. Keep the splash's existing separate logo/progress UI. Captain choice and first hire are actions with portraits, not explanation cards. Reuse a legible portrait/role/star/job/stat pattern in the crew sheet, station sheet, and recruit reveal. The ship starts near bridge; show one dismissible “Drag to look around. Pinch to zoom. Tap your captain.” cue and keep the camera control collapsed until used. A station tap at far zoom focuses rather than assigns. For discrete guided CTA states, add a viewport-safe dark spotlight that leaves the true target above the scrim and tappable; avoid veiling movement or combat outcomes. Pulse/glow only the active primary CTA, with a static outline under reduced motion. Derive small red attention dots from actual ready/new state, pair with text/icon, and clear when handled; do not badge locked/paid/disabled UI. Render enemy target ring and shot/disable/impact from committed encounter events; effects never change damage or rewards. Example structure (the real render injects the chosen crew instance ID):

~~~html
<aside class="first-session-cue" aria-label="First assignment">
  <p>Jen is ready. Put her at Weapons.</p>
  <button class="primary" data-act="station-assign" data-id="jen-instance-id" data-station="weapons">Assign Jen to Weapons</button>
</aside>
~~~

- [ ] **Step 4: Run** node test/first_play_ui.test.mjs, node test/first_session_copy.test.mjs, node test/ship_camera_input.test.mjs, npm run test:ship, and npm run build:pages. Add tests for one spotlight target above scrim, background taps blocked while target remains actionable, one pulse per state, badge clear-on-open/action, no badge on inaccessible content, and reduced-motion static cue. Capture 360×800 and 390×844 normal/reduced views and inspect every mandatory action for 44px targets, 16/18px copy, safe-area clearance, no horizontal overflow, and no gesture-triggered action.
- [ ] **Step 5: Commit** only Task 6 code/tests as feat: present captain-first ship rescue.

