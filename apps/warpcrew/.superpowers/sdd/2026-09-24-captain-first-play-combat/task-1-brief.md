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

