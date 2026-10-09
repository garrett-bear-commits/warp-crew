# Task 2 report: script-5 state and one-use first hire

Status: DONE_WITH_CONCERNS

## RED / GREEN

- RED: `node test/tutorial_v5.test.mjs` exited 1 with `ERR_MODULE_NOT_FOUND` for `src/systems/tutorialV5.js`, as expected before implementation.
- A later guard test was RED: `node test/tutorial_v5.test.mjs` exited 1 because `sessionAction(..., 'captain-choose')` returned `null` instead of an explicit failure while its Task 4 handler was absent.
- GREEN: `node test/tutorial_v5.test.mjs` exited 0: 7 tests, 7 pass, 0 fail.

## Verification

- `node test/tutorial_v4.test.mjs`: 8 pass, 0 fail.
- `node test/tutorial_migration.test.mjs`: 4 pass, 0 fail.
- `npm run test:loop`: all command stages passed; final review 15 pass, 0 fail.
- `npm test`: all command stages passed; final review 15 pass, 0 fail.
- `git diff --check`: exited 0.

## Files

- `src/systems/tutorialV5.js`: phase state, guarded transitions, one-use hire, and script-5 adapters to existing ship-name and welcome-pull/pity logic.
- `src/systems/player.js`: new saves and reloads use the script-5 default/normalizer.
- `src/systems/tutorial.js`: active script 5 receives ship-only tutorial unlocks and compact HUD treatment.
- `src/systems/sessionLoop.js`: minimal phase action gate, v5 board/assignment progression, and explicit unavailable responses for Task 4 actions not yet connected.
- `test/tutorial_v5.test.mjs`: ordered phases, exact-once hire, save failure/reload, unlocks, and progression evidence.

## Self-review and concerns

- The first hire adds exactly one catalog crew instance, records its ID and consumed entitlement in the same player object, and does not spend the 80 starting credits. A discarded transition leaves the old snapshot eligible; a persisted and reloaded transition rejects another hire.
- Assignment checks the exact hired instance at weapons for Jen or shields for Bolt. First win and claim use committed contract/encounter/board evidence. Ship naming and welcome pull reuse v4 validation and gacha/pity behavior through script-5 adapters without changing script-4 code.
- Task 4 still needs to wire captain choice, hire, fight, name, welcome pull, and registration into `sessionAction`; those actions currently fail or are unavailable through the session action API. This is the intended Task 2/Task 4 boundary, so the script-5 tutorial cannot yet be played end-to-end through the UI.
- No deploy, Jest, merge, or unrelated untracked file changes were made.

## Follow-up: script-5 Target Weapons win gate

- Review finding: the initial script-5 `guided_win` guard checked `brace.used`, copied from script 4. The approved script-5 order is Target Weapons.
- RED: `node test/tutorial_v5.test.mjs` exited 1; the new Brace-only assertion failed because it incorrectly advanced `fight` to `claim` and set `firstWin: true`.
- GREEN: `node test/tutorial_v5.test.mjs` exited 0 (7 pass, 0 fail); `node test/tutorial_v4.test.mjs` exited 0 (8 pass, 0 fail); `git diff --check` exited 0.
- Files: `src/systems/tutorialV5.js` now requires `activeEncounter.orders.targetWeapons.used === true`; `test/tutorial_v5.test.mjs` supplies a Target Weapons win with no Brace and proves Brace-only cannot advance. Script-4 source remains unchanged.
- Full `npm test` was not repeated for this one-line script-5 guard fix; it passed for the original Task 2 commit, and the focused v4/v5 suites cover the changed boundary.
