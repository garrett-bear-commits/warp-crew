# Task 1 report: working captain catalog and durable identity

Status: DONE_WITH_CONCERNS (script-5 tutorial progression and UI are subsequent tasks).
Commit: `73d82ff` (`feat: add working starter captains`).

## Implementation

- Added four stable Common, one-star, equal-base-power starter templates and provisional looks: cyborg pilot, gunner, alien scout, and droid engineer. They remain in the ordinary Common catalog for later duplicate draws.
- Added `STARTER_CAPTAINS`, `captainStationFor`, and `chooseCaptain`. The choice accepts only these four templates, trims and validates a 1–24-visible-grapheme name, defaults blank input to `Captain`, creates one working crew instance, saves its ID, and assigns the useful station. Repeated selection leaves the player unchanged.
- Added `isCaptain` and `customName` to crew instances. Recompute and migration retain the captain's display name, and duplicate pulls star up the same instance.
- Bumped the save version to 9. Fresh players start script 5 with no crew and a null captain ID. `tutorialScript: 4` explicitly makes the legacy Rex/Bolt fixture; migration keeps saved script 3, 4, or 5 semantics.
- Protected the chosen captain from benching, reserve sale, and overflow parking. Existing injury and Away rules still apply.
- Converted legacy tests that need Rex/Bolt to the explicit script-4 fixture. The historical 30-day economy simulation also needs this explicit setup to keep its approved baseline.

## Files

New: `src/systems/captainFirstPlay.js`, `test/captain_first_play.test.mjs`.

Changed source: `src/data/crewRoster.js`, `src/data/looks.js`, `src/systems/player.js`, `src/systems/gacha.js`, `src/systems/hangar.js`, `src/sim/contractEconomy.js`.

Changed legacy tests: `test/contract_economy.test.mjs`, `test/contract_rewards.test.mjs`, `test/contract_route.test.mjs`, `test/contract_ui.test.mjs`, `test/deterministic_seams.test.mjs`, `test/expedition_party.test.mjs`, `test/explore_orders.test.mjs`, `test/final_review.test.mjs`, `test/helpers/tutorialFlow.mjs`, `test/sanity.mjs`, `test/session_loop.test.mjs`, `test/tutorial_migration.test.mjs`, `test/tutorial_v3.test.mjs`, `test/tutorial_v4.test.mjs`, `test/tutorial_v4_session.test.mjs`.

## RED and GREEN

- RED: `node test/captain_first_play.test.mjs` exited 1 with `ERR_MODULE_NOT_FOUND` for `src/systems/captainFirstPlay.js`, the expected missing-feature failure.
- GREEN: `node test/captain_first_play.test.mjs` exited 0, 6/6 tests passed. An additional export-boundary RED returned `does not provide an export named 'STARTER_CAPTAINS'`; after exporting it, focused GREEN again passed 6/6.

## Full suite

- `npm test`: exit 0, including 15/15 `final_review` tests.
- `npm run test:loop`: exit 0, including 15/15 `final_review` tests.
- `npm run test:ship`: exit 0.
- `npm run test:balance`: exit 0; 16 encounters/192 rows, 15 simulated 30-day runs with reconciled ledgers. The report generator temporarily updated its JSON artifact with the new crew fields; I removed only those generated additions and left the artifact unchanged.
- `node test/tutorial_v4.test.mjs`: 8/8 passed.
- `node test/tutorial_v4_session.test.mjs`: 10/10 passed.
- `node test/tutorial_migration.test.mjs`: 4/4 passed.
- `git diff --check`: exit 0.

## Self-review and concerns

The selected instance is identified by `captainInstanceId` and protected as a fallback by `isCaptain`, including on malformed reserve data. The choice is idempotent across JSON reload and does not mutate the input. The display name is recomputed from `customName`, preserving it through stars and migration. The save-version change is intentional per the global plan.

The script-5 tutorial object is a minimal saved `board` state in this task. Task 2 owns its complete phase model; Task 4 owns session action and durable publication. Current production UI still follows script-4-specific presentation until those tasks land. This foundation is not a standalone playable first session yet.

## Follow-up review fix: visible emoji graphemes

Follow-up commit: `1907a0b` (`fix: allow visible emoji captain names`).

The review found that rejecting every Unicode format character also rejected the joiner inside `👩‍🚀`, although the existing ship-name rule counts that sequence as one visible grapheme. I changed captain validation to use the same C0/C1 control-character range as ship naming while retaining the visible-grapheme count. Standalone invisible `\u200b` remains invalid because its visible count is zero.

RED: After adding the regression, `node test/captain_first_play.test.mjs` exited 1 with `AssertionError: false !== true` at the `👩‍🚀` acceptance assertion (5 passed, 1 failed). The test also checks 24 joined emoji are accepted and 25 are rejected.

GREEN: `node test/captain_first_play.test.mjs` exited 0 (6/6); `node test/tutorial_v4_session.test.mjs` exited 0 (10/10); `npm test` exited 0 (including 15/15 final-review tests).

Diff: `src/systems/captainFirstPlay.js` changes the control regex from all `Cc`/`Cf` to the ship-name rule's C0/C1 ranges; `test/captain_first_play.test.mjs` adds joined-emoji acceptance and length assertions. No spec, plan, art, or owner files were changed for this fix.
