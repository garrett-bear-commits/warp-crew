# Captain-First Play and Readable Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Give a fresh player a nameable working captain, one free first hire, a visible crew-run pirate rescue with a meaningful weapons-targeting order, and an honest free recruit reveal.

**Architecture:** Keep captain, tutorial, combat, and reward state in pure saved transitions; the UI renders committed state and events. New script-5 saves use a new captain-first path while active script-4 and older saves retain their exact existing flow. Extend only the guided and Reliable/Push pirate encounters to encounter snapshot v2; accept saved v1 snapshots until they finish.

**Tech Stack:** Vite 6, JavaScript ESM, Node assertion tests, DOM/CSS/canvas, localStorage, existing Jest adapter. No new runtime dependency.

**Spec:** docs/superpowers/specs/2026-09-24-captain-first-play-combat-design.md

## Global Constraints

- Preserve existing crew, currency, reputation, purchases, contracts, and tutorial rewards. Bump save version 8 to 9; a saved script-4 tutorial finishes script 4.
- New script 5 starts with one selected Common, one-star captain; Jen or Bolt is a free first hire; the recorded welcome pull is a guaranteed Uncommon from Kira, Tink, or Nemi.
- The selected captain is a working crew instance, can be injured or sent Away, and cannot be sold, benched, or overflow-parked. A duplicate draw stars up that same named instance.
- The target-weapons order is free, once per encounter, available only at the telegraphed charge window, and cancels the next pirate volley. Guided combat wins for all four captain choices; the repeatable normal fight can lose.
- Save before presenting animation or telemetry. Acceptance ID plus revision guards every combat beat and claim. Invalid snapshots fail closed rather than falling back to legacy payout.
- Mandatory player text is at least 16 CSS px, instruction text 18 CSS px, touch targets at least 44×44 CSS px. One primary action per state, concrete language, safe areas, reduced-motion parity.
- Art follows the current high-pixel-count new-retro style and the approved four-screen mockup. Preserve originals. One considered Codex image generation per approved asset; do not claim an exact backend model ID. No Flora charge without a separately approved count, estimate, and cap.
- Do not edit, delete, or stage the user-owned Mobile Game UI.jpg or package-lock.json. The two untracked review PNGs are also outside task commits unless Garrett asks to preserve them.
- No PR #1 merge, Jest upload/activation, purchase activation, or live-Jest claim. Pages is mock-platform QA; any QA publish needs a verified source/artifact pair and a live smoke.

## File Map and Delivery Order

| Responsibility | Files |
| --- | --- |
| Captain identity, name, and save migration | Create src/systems/captainFirstPlay.js, test/captain_first_play.test.mjs; modify src/data/crewRoster.js, src/data/looks.js, src/systems/player.js, src/systems/gacha.js and relevant legacy fixtures |
| Script-5 progress and free hire | Create src/systems/tutorialV5.js, test/tutorial_v5.test.mjs; modify src/systems/tutorial.js, src/systems/sessionLoop.js; retain src/systems/tutorialV4.js unchanged except a proven compatibility repair |
| Targetable pirate combat | Modify src/systems/autoCombat.js, src/systems/encounterState.js; extend test/auto_combat.test.mjs and test/encounter_session.test.mjs |
| Session, reward, and reload integration | Modify src/systems/sessionLoop.js, src/systems/contracts.js, src/main.js; create test/tutorial_v5_session.test.mjs; extend test/tutorial_migration.test.mjs |
| Captain and pirate art | Add versioned files under public/art/pixel/vertical-slice/; modify src/data/artManifest.js, src/data/portraits.js, src/data/looks.js, src/ui/crewArt.js; extend docs/art/2026-09-23-vertical-slice-ledger.md and test/asset_manifest.test.mjs |
| UI and on-ship presentation | Modify src/ui/bridge.js, src/ui/contractView.js, src/ui/shipView.js, src/ui/style.css, src/main.js; create test/first_play_ui.test.mjs; extend test/first_session_copy.test.mjs |
| Full QA and review | Modify scripts/living-ship-qa.mjs, package.json, docs/NEXT.md; create docs/qa/2026-09-24-captain-first-play-qa.md and docs/audits/2026-09-24-captain-first-play-audit.md |

Only one worker edits sessionLoop.js, bridge.js, or style.css at a time. Tasks 1–4 define behavior before Tasks 5–6 can present it. Asset generation and copy inventory may be delegated independently once execution begins, but the primary agent reviews every installed output and owns final QA.

## Review Focus

1. A new player double-taps captain selection or loses a save write: only one captain appears after reload, and the failed write shows no new crew. Pin in Tasks 1 and 4.
2. A selected captain is drawn again after being renamed: the captain gains a star and keeps the custom name; no second captain appears. Pin in Task 1.
3. A script-4 guided fight is saved at a Brace window while the app updates: it resumes with v1 rules and cannot receive target-weapons order or a second tutorial reward. Pin in Tasks 3 and 4.
4. A script-5 fight reloads after the targeting order but before claim: the skipped enemy volley and used order remain saved, and claim pays once. Pin in Tasks 3 and 4.
5. A user pinches across the enemy target then taps a station at overview scale: no accidental order or assignment fires, and the camera can still focus the room. Pin in Task 6.

---

### Task 1: Working captain catalog and durable identity

**Files:** Create src/systems/captainFirstPlay.js, test/captain_first_play.test.mjs; modify src/data/crewRoster.js, src/data/looks.js, src/systems/player.js, src/systems/gacha.js, src/systems/hangar.js; update old test fixtures that require a Rex/Bolt script-4 start.

**Interfaces:** Export STARTER_CAPTAINS as four stable template IDs: captain_cyborg, captain_gunner, captain_alien, captain_droid. Export chooseCaptain(player, { templateId, name, rng }) returning { ok, reason?, player, instance? }. Export captainStationFor(role) returning helm, weapons, or shields. `createNewPlayer({ tutorialScript = 5, now, rng })` defaults to the new flow; `tutorialScript: 4` is an explicit legacy fixture path only. Crew instances gain isCaptain:boolean and customName:string|null; their display name is customName || catalog name.

- [ ] **Step 1: Write failing tests** using fresh and serialized players. The break caught is duplicate captain creation or name loss during recompute:

~~~js
const fresh = createNewPlayer({ now: 1, rng: () => 0.1 });
assert.equal(fresh.tutorial.script, 5);
assert.equal(fresh.crew.length, 0);
const picked = chooseCaptain(fresh, { templateId: 'captain_alien', name: '  Aster  ', rng: () => 0.2 });
assert.equal(picked.ok, true);
assert.equal(picked.player.crew.length, 1);
assert.equal(picked.instance.customName, 'Aster');
assert.equal(migratePlayer(JSON.parse(JSON.stringify(picked.player))).crew[0].customName, 'Aster');
assert.equal(chooseCaptain(picked.player, { templateId: 'captain_droid', name: 'Two' }).ok, false);
assert.equal(chooseCaptain(fresh, { templateId: 'captain_alien', name: '\u0000' }).reason, 'invalid_captain_name');
~~~

- [ ] **Step 2: Run** node test/captain_first_play.test.mjs; expect missing export or wrong fresh crew count, not a fixture error.
- [ ] **Step 3: Implement** four Common, one-star, equal-base-power templates in crewRoster.js. createNewPlayer makes an empty script-5 roster and nullable captainInstanceId; the explicit `tutorialScript: 4` fixture makes the old Rex/Bolt roster. `chooseCaptain` trims the supplied name, uses `Captain` for blank input, rejects controls, and counts 1–24 visible graphemes with the ship-name segmenter rule. It constructs one crew instance, marks it protected, saves its instance ID, and assigns helm for pilot/scout, weapons for gunner, shields for engineer. recomputeCrew preserves customName/isCaptain instead of resetting display name. Prevent bench/sell/overflow of the selected instance in hangar and gacha operations. Key logic:

~~~js
if (player.captainInstanceId || player.crew.length) return { ok: false, reason: 'captain_already_chosen', player };
const chosen = String(name ?? '').trim() || 'Captain';
if (/[\p{Cc}\p{Cf}]/u.test(chosen) || [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(chosen)].length > 24) {
  return { ok: false, reason: 'invalid_captain_name', player };
}
const instance = { ...createCrewInstance(templateId, { rng }), isCaptain: true, customName: chosen };
return { ok: true, instance, player: { ...player, captainInstanceId: instance.instanceId,
  crew: [instance], stationAssignments: { [instance.instanceId]: captainStationFor(instance.role) } } };
~~~

- [ ] **Step 4: Test** malformed names (blank default, 25 graphemes, controls), all four role mappings, duplicate draw star-up, injury/Away availability, and protected overflow. Run node test/captain_first_play.test.mjs and npm run test:loop. Repair legacy test fixtures with explicit script-4 saved states; do not weaken their old-path assertions.
- [ ] **Step 5: Commit** only Task 1 source/tests as feat: add working starter captains.

### Task 2: Script-5 progress and exact-once first hire

**Files:** Create src/systems/tutorialV5.js and test/tutorial_v5.test.mjs; modify src/systems/tutorial.js, src/systems/player.js, src/systems/sessionLoop.js.

**Interfaces:** defaultTutorialV5() and normalizeTutorialV5(saved) define phases board, captain, hire, assign, fight, claim, name_ship, pull, register, done. advanceTutorialV5(player,event) returns unchanged player on an invalid event. hireFirstCrew(player,{rng}) returns { ok, reason?, player, instance? } and grants Jen unless the captain is a gunner, when it grants Bolt.

- [ ] **Step 1: Write failing phase and hire tests.** The break caught is bypassing hire/assignment or paying twice:

~~~js
let p = createNewPlayer({ now: 1, rng: () => 0.1 });
p = advanceTutorialV5(p, 'board_ship');
assert.equal(p.tutorial.phase, 'captain');
p = chooseCaptain(p, { templateId: 'captain_gunner', name: 'Mara', rng: () => 0.1 }).player;
p = advanceTutorialV5(p, 'captain_chosen');
assert.equal(p.tutorial.phase, 'hire');
const first = hireFirstCrew(p, { rng: () => 0.3 });
assert.equal(first.instance.templateId, 'merc_bolt');
assert.equal(first.player.wallet.credits, 80);
assert.equal(first.player.tutorial.phase, 'assign');
assert.equal(hireFirstCrew(first.player).ok, false);
~~~

- [ ] **Step 2: Run** node test/tutorial_v5.test.mjs; expect missing-module failure.
- [ ] **Step 3: Implement** the pure script-5 transition table and one-use hire entitlement. A free hire inserts one catalog instance, records firstHireInstanceId, and consumes the entitlement in the same saved player transition. assign advances only when that instance is staffed at weapons for Jen or shields for Bolt. First win/claim/name/pull/register each require the previous committed flag; use the existing welcome-pull/pity mechanism with a script-5 guard rather than a second gacha algorithm. Tutorial unlock helpers treat active script 5 like active script 4: ship tab only, no shop/gacha/paid prompt.

~~~js
const hireId = player.crew.find(c => c.instanceId === player.captainInstanceId)?.role === 'gunner'
  ? 'merc_bolt' : 'merc_jen';
const instance = createCrewInstance(hireId, { rng });
const next = { ...player, crew: [...player.crew, instance],
  tutorial: { ...player.tutorial, phase: 'assign', firstHireInstanceId: instance.instanceId, firstHireUsed: true } };
~~~

- [ ] **Step 4: Run** node test/tutorial_v5.test.mjs, node test/tutorial_v4.test.mjs, node test/tutorial_migration.test.mjs, and npm run test:loop. Add explicit save-write-failure and reload cases before moving on.
- [ ] **Step 5: Commit** only Task 2 source/tests as feat: add captain-first tutorial state.

### Task 3: Versioned target-weapons combat

**Files:** Modify src/systems/autoCombat.js and src/systems/encounterState.js; extend test/auto_combat.test.mjs and test/encounter_session.test.mjs.

**Interfaces:** startEncounter accepts ruleset:'v1'|'v2' (default v2 for new pirate fights). v2 state includes enemy.weaponDisabledThroughBeat and orders.targetWeapons.used/uses. advanceEncounter(state,'target_weapons') returns a new state and a target-lock/system-disable event. validSnapshot accepts both saved v1 and new v2, checking each version's own schema.

- [ ] **Step 1: Write failing tests** for the exact effect and backward compatibility. The break caught is an order that looks useful but does not stop a volley:

~~~js
const opened = advanceEncounter(startEncounter({ ...baseArgs, ruleset: 'v2' })).state;
assert.equal(opened.orderWindow.orderOptions.target_weapons.available, true);
const locked = advanceEncounter(opened, 'target_weapons');
assert.equal(locked.state.orders.targetWeapons.used, true);
assert.ok(locked.events.some(e => e.type === 'enemy_weapon_disabled'));
const impact = advanceEncounter(locked.state);
assert.equal(impact.events.some(e => e.type === 'enemy_impact' && e.amount > 0), false);
assert.equal(advanceEncounter(impact.state, 'target_weapons').ok, false);
const legacy = startEncounter({ ...baseArgs, ruleset: 'v1' });
assert.equal(legacy.version, 1);
assert.deepEqual(advanceEncounter(JSON.parse(JSON.stringify(legacy))), advanceEncounter(legacy));
~~~

- [ ] **Step 2: Run** node test/auto_combat.test.mjs and node test/encounter_session.test.mjs; expect the v2 window assertion to fail.
- [ ] **Step 3: Implement** a v2 order option only when pirate weapons are charging, with cost { shield: 0 }, one use per encounter, and a saved disable-through-beat value. On the next impact beat, emit enemy_weapon_disabled and no damage instead of enemy_impact, then clear the disable. Keep the v1 Brace/Repair transition unchanged, including its old fixtures. beginContractEncounter selects v1 for script-4 distress and v2 for script-5 distress and new Reliable/Push fights; callers of other legacy encounter types explicitly request v1. Do not reinterpret a previously saved v1 encounter as v2.

~~~js
if (order === 'target_weapons') {
  next.orders.targetWeapons = { used: true, uses: 1 };
  next.enemy.weaponDisabledThroughBeat = next.beat + 2;
  events.push({ type: 'enemy_weapon_disabled', target: 'weapons', throughBeat: next.enemy.weaponDisabledThroughBeat });
}
if (next.version === 2 && next.enemy.weaponDisabledThroughBeat >= next.beat) {
  events.push({ type: 'enemy_volley_canceled', target: 'weapons' });
} else resolveEnemyImpact(next, selectedWindow, events);
~~~

- [ ] **Step 4: Test** stale revision, malformed v2 option, save/reload after lock, all four starting captain outputs, guided win, and normal-fight recoverable loss. Build one matching activeContract plus saved v1 encounter fixture and assert normalizeEncounterState retains it without conversion. Run focused combat tests, npm run test:balance, and npm run test:loop.
- [ ] **Step 5: Commit** only Task 3 files as feat: add saved pirate weapons targeting.

### Task 4: Integrate the new first session without migrating old rewards

**Files:** Modify src/systems/sessionLoop.js, src/systems/contracts.js, src/systems/player.js, src/main.js; create test/tutorial_v5_session.test.mjs; extend test/tutorial_migration.test.mjs.

**Interfaces:** sessionAction accepts captain-choose, tutorial-first-hire, tutorial-fight-start, tutorial-name-ship, tutorial-welcome-pull, tutorial-register-skip/complete for active script 5. Existing actions retain their script-4 behavior. persistSessionTransition remains the only publish boundary.

- [ ] **Step 1: Write failing integration tests** that serialize/reload after every phase. The break caught is a committed v5 event returning to v4 or duplicating a payout:

~~~js
let p = prepareSession(createNewPlayer({ now, rng: () => 0.1 }), now);
const act = (player, action, data = {}) => {
  const result = sessionAction(player, {}, action, data, { now, rng: () => 0.1 });
  if (!result.ok) return result;
  let published = player;
  const committed = persistSessionTransition(result, {
    save: () => true,
    publish: value => { published = value.player; },
  });
  return { ...committed, player: migratePlayer(JSON.parse(JSON.stringify(published)) ) };
};
p = act(p, 'splash-dismiss').player;
p = act(p, 'captain-choose', { templateId: 'captain_cyborg', name: 'Rook' }).player;
p = act(p, 'tutorial-first-hire').player;
assert.deepEqual(p.crew.map(c => c.templateId), ['captain_cyborg', 'merc_jen']);
assert.equal(p.tutorial.phase, 'assign');
assert.equal(act(p, 'tutorial-first-hire').ok, false);
assert.equal(migratePlayer(JSON.parse(JSON.stringify(p))).tutorial.script, 5);
const savedScript4 = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
assert.equal(migratePlayer(savedScript4).tutorial.script, 4);
~~~

- [ ] **Step 2: Run** node test/tutorial_v5_session.test.mjs; expect the new action to be unavailable.
- [ ] **Step 3: Route** v5 actions through chooseCaptain, hireFirstCrew, advanceTutorialV5, and the versioned encounter. A script-5 start uses the existing distress offer without exposing the board, and a v5 guided win requires targetWeapons.used before claim phase. On claim, open third berth and keep the existing exact-once reward path. Emit a committed `crew_arrived` presentation event for the hired member; animation starts at the Airlock and follows existing hall/door path anchors without becoming a completion gate. Retain v4's Brace gate and old ship naming branch. Set the fresh-boot log to the actual roster, not “Rex and Bolt.” Guard all v5 actions by phase and acceptance identity.

~~~js
if (v5 && phase === 'captain' && act === 'captain-choose') {
  const selected = chooseCaptain(player, { templateId: data.templateId, name: data.name, rng });
  if (!selected.ok) return fail(selected.reason);
  player = advanceTutorialV5(selected.player, 'captain_chosen');
}
~~~

- [ ] **Step 4: Run** node test/tutorial_v5_session.test.mjs, node test/tutorial_v4_session.test.mjs, node test/tutorial_migration.test.mjs, npm run test:loop, and npm test. Extend the existing v4 guided test to serialize specifically at its Brace window, reload under v5-capable code, use Brace, win, and claim once. Assert save-failure rolls back captain, hire, order, and claim; v4 active encounter remains resumable.
- [ ] **Step 5: Commit** only Task 4 files as feat: connect captain tutorial to saved rescue job.

### Task 5: Canonical first-play portraits, movement silhouettes, and pirate art

**Files:** Add four captain portrait PNGs, two nonhuman movement sheets, and one pirate top-down PNG under public/art/pixel/vertical-slice/; modify src/data/artManifest.js, src/data/portraits.js, src/data/looks.js, src/ui/crewArt.js, docs/art/2026-09-23-vertical-slice-ledger.md, test/asset_manifest.test.mjs.

**Interfaces:** portraitFor(captain template ID) returns that captain's approved export. walkAssetFor uses the dedicated alien or droid sheet when those template IDs are active; human captains use distinct existing recolor profiles. All four appear recognizable beside the v3 splash and at 52px in-ship height.

- [ ] **Step 1: Write failing asset tests** for four portrait mappings, nonhuman sheet routing, hashes, and fallbacks. The break caught is a new captain silently becoming Rex art:

~~~js
for (const id of ['captain_cyborg', 'captain_gunner', 'captain_alien', 'captain_droid']) {
  assert.notEqual(portraitFor(id), portraitFor('merc_rex'));
  assert.ok(ART_VERTICAL_SLICE[id].path.startsWith('/art/pixel/vertical-slice/'));
}
assert.equal(lookIdFor('captain_alien', 'scout'), 'captain_alien');
assert.equal(lookIdFor('captain_droid', 'engineer'), 'captain_droid');
~~~

- [ ] **Step 2: Run** node test/asset_manifest.test.mjs; expect absent mappings.
- [ ] **Step 3: Produce exactly seven considered built-in image outputs:** four square portraits derived from the matching v3 splash characters; two 384×384 four-direction, four-frame walk sheets anchored to the matching portraits and the Ninefold row order down/left/right/up; one transparent top-down pirate scout ship with a visible weapons module. Use the game-art sprite-generation skill for the movement sheets and imagegen for raster edits. No Flora run, no duplicate generation, no automatic reroll. Save originals and exports under versioned names, then record the actual prompt, route, generated path, dimensions, SHA-256, and disposition in the ledger. If any sheet breaks its frame/alpha/foot-line contract, stop that asset for review; do not fake acceptance with a generic human sheet. Add only verified exports to the manifest and runtime maps.
- [ ] **Step 4: Run** art-qa-and-review automated checks on the two movement sheets and enemy transparency, make a uniquely named contact sheet over magenta and the actual ship/space background, then inspect 52px ship and 72px card composites. Run node test/asset_manifest.test.mjs, npm run test:ship, and npm run build:pages. Keep any failed output as a logged candidate, not an installed asset.
- [ ] **Step 5: Commit** accepted asset bytes, mapping, tests, and ledger as art: add first-play captain and pirate identities.

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
- [ ] **Step 3: Implement** the four-screen mockup's worn dark plates, large portraits, generous action controls, simple bars, and visible two-ship battle composition. Keep the splash's existing separate logo/progress UI. Captain choice and first hire are actions with portraits, not explanation cards. Reuse a legible portrait/role/star/job/stat pattern in the crew sheet, station sheet, and recruit reveal. The ship starts near bridge; show one dismissible “Drag to look around. Pinch to zoom. Tap your captain.” cue and keep the camera control collapsed until used. A station tap at far zoom focuses rather than assigns. Render enemy target ring and shot/disable/impact from committed encounter events; effects never change damage or rewards. Example structure (the real render injects the chosen crew instance ID):

~~~html
<aside class="first-session-cue" aria-label="First assignment">
  <p>Jen is ready. Put her at Weapons.</p>
  <button class="primary" data-act="station-assign" data-id="jen-instance-id" data-station="weapons">Assign Jen to Weapons</button>
</aside>
~~~

- [ ] **Step 4: Run** node test/first_play_ui.test.mjs, node test/first_session_copy.test.mjs, node test/ship_camera_input.test.mjs, npm run test:ship, and npm run build:pages. Capture 360×800 and 390×844 normal/reduced views and inspect every mandatory action for 44px targets, 16/18px copy, safe-area clearance, no horizontal overflow, and no gesture-triggered action.
- [ ] **Step 5: Commit** only Task 6 code/tests as feat: present captain-first ship rescue.

### Task 7: Full fresh-play QA, independent audit, and QA artifact

**Files:** Modify scripts/living-ship-qa.mjs, package.json, docs/NEXT.md; create docs/qa/2026-09-24-captain-first-play-qa.md and docs/audits/2026-09-24-captain-first-play-audit.md.

**Interfaces:** The QA script starts from ?fresh=1 and checks saved script 5, one captain, one first hire, a target-weapons order, one win/claim, one Uncommon pull, and reload. It also reopens a scripted v4 save at Brace and verifies that path remains unchanged.

- [ ] **Step 1: Replace the QA script's hard-coded Bolt/Brace actions with v5 selectors and add the legacy-v4 check.** Run it against the completed Tasks 1–6 implementation and fix any mismatch in the harness or runtime. Add the focused tests to a package.json test:first-play command so they cannot be hidden outside npm test:

~~~json
{"test:first-play":"node test/captain_first_play.test.mjs && node test/tutorial_v5.test.mjs && node test/tutorial_v5_session.test.mjs && node test/auto_combat.test.mjs && node test/encounter_session.test.mjs && node test/first_play_ui.test.mjs && node test/asset_manifest.test.mjs"}
~~~

- [ ] **Step 2: Run** npm run test:first-play, npm run test:ship, npm run test:loop, npm run test:balance, npm test, and npm run build:pages. Record exact pass/fail counts and any known legacy encounter exceptions. Do not claim whole-game combat completion from one pirate fight.
- [ ] **Step 3: Run the production Pages build locally in Chrome at 390×844, 360×800, and 390×844 reduced motion.** Save unique captures for every first-session phase, next normal pirate job, reload, and one corrupted encounter recovery. Measure first-win elapsed time; record if it exceeds two minutes. Check actual image widths, 44px hit rectangles, 16/18px text, safe-area positions, no horizontal overflow, crew door route, and visible impact/target feedback. A desktop-emulated pass is not owner-phone acceptance.
- [ ] **Step 4: Request a bounded read-only Grok audit** of exact base..HEAD source, focused on save migration, paid gating, target-order validity, exact-once rewards, and mobile copy. If Grok stalls or returns only a plan, report audit unavailable and use the connected Chrome path only if needed; never call a non-audit response approval. Reproduce and fix any finding before final verification, then capture the final diff and hashes in the audit document.
- [ ] **Step 5: Prepare and publish a Pages QA build only after the full local gate and audit disposition.** Record source commit, built asset hashes, Pages commit/run, and a live ?fresh=1 smoke. Do not upload/activate Jest, merge PR #1, or imply purchases/cloud saves are production-ready. Commit QA evidence and the updated NEXT checklist separately from implementation.

## Plan Self-Review

- Spec coverage: captain selection/name/hire, working assignment, targetable guided and repeatable fights, reward/third berth/pull, registration truth, art/UI, migration, browser/device limits, audit, and release boundary each map to a task.
- Dependencies: Task 1 defines crew identity; Task 2 defines v5 phases; Task 3 defines combat v2; Task 4 joins them; Task 5 supplies identity art; Task 6 presents it; Task 7 verifies and publishes QA.
- Tests: the five Review Focus cases are pinned in Tasks 1, 3, 4, and 6; no assertion depends on mock-only UI or a saved-state value derived from the same function under test.
- Execution method: Garrett earlier asked for subagents and cost-aware model routing. Use subagent-driven development after he confirms this plan; root controls integration, art acceptance, audits, and the final Pages provenance check.
