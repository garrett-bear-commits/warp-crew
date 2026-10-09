# Task 4 report: captain-first saved rescue session

## Status

Implemented the script-5 session action path through the existing single durable publication boundary. New saves can choose a captain, hire one free crew member, assign that exact member, launch the distress job, target the pirate weapons, claim once, name the ship, pull welcome crew, and skip or complete registration. Each committed phase was JSON serialized and migrated in the integration test. Script-4 players retain the saved v1 Brace route.

## Red and green evidence

- `node test/tutorial_v5_session.test.mjs` RED: 2 failed, 1 passed. The first failure was `captain !== hire` after a captain action; the second returned `tutorial_action_unavailable` instead of reaching the save-failure boundary.
- After routing script-5 actions, the same command was GREEN: 3 passed, 0 failed. The full flow asserted a single distress reward, third berth before the welcome pull, and no captain, hire, target-order, or claim publication when saving failed.
- A later registration-handoff test was RED: `tutorial-register-start` returned `tutorial_action_locked` instead of reaching the async app handler. After extending the session handoff, `node test/tutorial_v5_session.test.mjs` was GREEN: 5 passed, 0 failed.
- A forged first-hire identity test was RED: assigning the captain was accepted as the hired member. After validating the saved hired member and required station, `node test/tutorial_v5_session.test.mjs` was GREEN: 5 passed, 0 failed.
- A corrupted claim-phase snapshot with `firstWin: false` was RED: its reward claim was accepted. The claim guard now requires the saved guided-win evidence; the focused command returned 5 passed, 0 failed.

## Final verification

All commands were run after the final source change:

| Command | Result |
| --- | --- |
| `node test/tutorial_v5_session.test.mjs` | 5 passed, 0 failed |
| `node test/tutorial_v4_session.test.mjs` | 10 passed, 0 failed |
| `node test/tutorial_migration.test.mjs` | 5 passed, 0 failed |
| `node test/tutorial_v5.test.mjs` | 7 passed, 0 failed |
| `node test/encounter_session.test.mjs` | 15 passed, 0 failed |
| `npm run test:loop` | Exit 0; all listed suites passed, final review 15 passed |
| `npm test` | Exit 0; all listed suites passed, final review 15 passed |
| `git diff --check` | Exit 0 |

The migration regression specifically saved and reloaded script 4 at the open Brace window, used Brace, won, and claimed once. The new script-5 integration test reloaded after each committed action; it checked acceptance identity, saved first-win evidence, v2 target order, phase identity, save-failure rollback, reward exact-once behavior, third berth, and registration completion. Existing `contract_ship_feedback.test.mjs` in `test:loop` verifies that the `crew-arrival` effect starts at the Airlock and follows authored hall and door anchors; the new test checks that this effect and `crew_arrived` event emit only after commit.

## Files and self-review

- `src/systems/sessionLoop.js`: routes all active script-5 tutorial actions, applies v5 target and claim gates, opens the third berth on the existing claim transition, and emits a committed first-hire arrival.
- `src/main.js`: keeps active script-5 notification entry on the ship, logs the actual new roster, shows the target-order error, and allows the script-5 registration handoff.
- `test/tutorial_v5_session.test.mjs`: new serialized first-session and rollback coverage.
- `test/tutorial_migration.test.mjs`: saved script-4 Brace-window regression.
- `test/tutorial_v5.test.mjs`: replaces the obsolete pending-action expectations with the now-committed action contract.

I inspected `src/systems/contracts.js` and `src/systems/player.js` but did not modify them. Their existing acceptance, single-claim, and script-aware migration paths supported the required behavior, and the tests exercise them end to end. I did not change the v5 naming and welcome-pull adapters in `tutorialV5.js`; the integration test confirms they retain script 5 across reload and pay once.

## Concerns and handoff

- Task 6 still needs to render controls for script-5 phases in `src/ui/bridge.js`; this task wires the committed actions, but the current modal renderer selects only script 4.
- The existing ship sequence caption says “Jen aboard” for every `crew-arrival` effect, including the Bolt branch. The arrival animation uses the shared Airlock-to-Workshop route. Task 6 should choose copy and destination appropriate to the hired member.
- No browser or physical-device pass was run for Task 4. No publish, Jest activation, or PR merge was performed.

## Reviewer follow-up: corrupt saved first hire

The reviewer reproduced a payout from a JSON-reloaded script-5 `fight` snapshot with `firstHireUsed: true`, `firstHireInstanceId: 'missing'`, and only the captain aboard. I added a regression that reloads this exact shape and checks that launch and claim are denied without spending fuel or granting currency. A second test covers a captain ID forged as the hire, an unassigned Jen, a Bolt forged for a pilot captain, and a valid gunner/Bolt/Shields launch.

- RED: `node test/tutorial_v5_session.test.mjs` returned 5 passed, 2 failed. Both new tests showed `tutorial-fight-start` returning `ok: true` for invalid saved hire evidence. The first failure was at the missing-ID launch assertion; the second was at the captain-as-hire case.
- GREEN: `node test/tutorial_v5_session.test.mjs` returned 7 passed, 0 failed after the guard verified an actual non-captain hire, its template for the chosen captain, and its required station assignment before launch.
- Final covering runs after the source refactor: `node test/tutorial_v4_session.test.mjs` 10 passed, `node test/tutorial_v5.test.mjs` 7 passed, `node test/tutorial_migration.test.mjs` 5 passed, `npm test` exit 0 (all listed suites passed; final review 15 passed), and `git diff --check` exit 0.

The shared first-hire validation is used by the assign and launch phases; the saved script-4 Brace path remains untouched. The once-per-fight target-order cooldown label is a Task 6 copy follow-up.
