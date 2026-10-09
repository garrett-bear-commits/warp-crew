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

