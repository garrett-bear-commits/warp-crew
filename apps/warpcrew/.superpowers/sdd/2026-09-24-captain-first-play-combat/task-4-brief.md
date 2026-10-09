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

