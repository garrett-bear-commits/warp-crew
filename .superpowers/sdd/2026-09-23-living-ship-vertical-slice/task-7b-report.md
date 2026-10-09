# Task 7B implementer report

## Result

Fresh script-4 saves now stay on script 4 at boot and proceed through a single ship-centered first session. Saved script-3 active and completed players keep the script-3 selectors and route flow. No art, deployment, push, or production activation was performed.

## Exact happy path

1. `splash-dismiss` commits `board_ship` and `flags.splashSeen` through `persistSessionTransition`.
2. `station-assign` accepts only Bolt → Shields and commits `station_assigned`.
3. `tutorial-fight-start` accepts the authored distress offer, launches it, spends one fuel, and commits encounter beat 1 with the visible pirate tell in one saved transition. The long contract review sheet does not appear.
4. `encounter-order` with Brace is required at the first threat. The browser schedules later `encounter-advance` beats after each successful save; a visible Continue fight button remains as a retry path. A saved win advances to `claim` only when contract and encounter acceptance IDs match.
5. `contract-claim` grants the existing route reward once, lights the existing repair, opens the third berth, and shows a new berth marker on the ship.
6. `tutorial-name` accepts the prefilled Sparrow or a valid ship name and advances to `pull`.
7. `tutorial-welcome-pull` uses 7A's guaranteed Uncommon pull. The new crew joins the opened berth and their suggested station/Away role is shown without assigning them.
8. `tutorial-register-skip` completes the intro, or `tutorial-register-start` asks Jest and commits `tutorial-register-complete` only after the platform reports `registered`. The copy states only that local device progress is saved. The ship then shows a next-contract action and an Away-team hint.

Every durable action above uses `sessionAction` and the existing save-before-publish boundary. The tutorial temporarily shows only Ship, hides unrelated room targets and paid controls, and keeps the camera available.

## TDD and compatibility evidence

- RED: the new suite initially failed because boot exposed no script-preserving restore helper, fresh setup exposed three normal offers, and the Board action bypassed `sessionAction`. Later RED cases found an acceptance-ID mismatch in `guided_win`, a second guided-fight button at the first threat, no third-berth ship marker, and a stranded saved pre-threat fight.
- GREEN: `node --test test/tutorial_v4_session.test.mjs test/tutorial_v4.test.mjs test/tutorial_migration.test.mjs test/encounter_session.test.mjs` passed 30/30 after the final code changes. `node --test test/tutorial_v4_session.test.mjs` passed 7/7 in the last run.
- `npm run test:loop` passed, including 15/15 final-review tests; its exact-shape `contractShipSignals` fixture was updated for `berth3Open`.
- `npm run test:ship` passed.
- `npm run test:balance` passed. Generated encounter matrix and 30-day economy artifacts were unchanged (16 encounters/192 rows; 15 runs of 30 days, reconciled).
- `npm test` passed.
- `npm run build` passed, producing Vite assets.
- `git diff --check` passed.

The new tests reload JSON after Board, station assignment, guided launch, Brace, every combat beat, claim, name, welcome pull, and registration. They check save failure for Board, station assignment, and welcome pull; wrong station/crew; a required Brace; once-only fuel/reward/pull; roster and gacha history; script-3 active recruit and completed veteran migration. Two older fixtures that operated a normal route from a fresh player were explicitly moved to their intended completed/v3 context or the new guided start action.

## UI and phone unknowns

- Automated tests and build do not establish phone layout, splash quality, scene readability, animation timing, or real Jest registration-overlay behavior. Task 8 is responsible for the full-screen splash/art/copy package and Task 9 for captures and owner-phone checks.
- The scripted fight auto-advances after Brace in the browser; the pure session test advances those same saved beats directly. The timer and visual cadence still need browser/phone observation.
- Existing script-3 and legacy combat presentation remains separate, and production is not activated.

## Review fix round 1

- RED: after Skip, selecting Operations or Hangar returned the next-job cue instead of the room sheet. The new test failed on the missing `.room-sheet`. The hint now appears only when no room is selected; both station and Hangar render in the focused test.
- RED: an unfinished script-4 notification entry had no tutorial-aware routing selector. `resolveEntryTab` now runs in boot after the notification is recorded. Every unfinished phase stays on Ship for `fuel_full`, `daily_pull`, and `expedition_done`; completed saves keep existing notification routing. This was tested through the boot-used selector because this repository has no DOM test runtime.
- The local preview no longer presents a mock login as completed Jest registration. Its registration card explains that sign-in is unavailable in the preview and keeps Skip available; the Jest-host path still shows the sign-in action. The local first-session handler also refuses to mark mock login as registered.
- RED/Green: 3 focused failures before the fix, then 9/9 focused passed. The broader focused set passed 32/32. `npm run test:loop`, `test:ship`, `test:balance`, `npm test`, `npm run build`, and `git diff --check` all passed. Balance artifacts again reported unchanged.
