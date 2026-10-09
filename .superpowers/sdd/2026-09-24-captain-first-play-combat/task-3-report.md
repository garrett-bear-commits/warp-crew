# Task 3 report: Versioned target-weapons combat

Status: implemented and verified locally. Source/test commit: `2dc6a08` (`feat: add saved pirate weapons targeting`).

## RED evidence

- After pinning preexisting v1 test fixtures to `tutorialScript: 4`, `node test/auto_combat.test.mjs` failed at the new v2 assertion: `1 !== 2`.
- `node test/encounter_session.test.mjs` then passed 12 and failed 2 new cases: script-5 distress had no active encounter, and normal pirate Push still opened version 1.
- A later regression test changed a fresh v2 snapshot's version to 1. It failed because `migratePlayer` retained the contract, showing that v2-only fields could slip through v1 validation.

## GREEN evidence

- `node test/auto_combat.test.mjs`: passed.
- `node test/encounter_session.test.mjs`: 14 passed, 0 failed.
- `npm run test:balance`: passed; 16 encounters, 192 balance rows, 0 disabled; 15 economy runs with ledgers reconciled.
- `npm run test:loop`: passed; 15 final-review tests, 0 failed.
- `npm test`: passed; 15 final-review tests, 0 failed.
- `git diff --check`: passed.

The balance report command regenerated `docs/qa/artifacts/contract-economy-30-day.json` solely because earlier captain fields changed its fixture serialization. I reversed that generated diff after verification; it is outside Task 3.

## Changed files

- `src/systems/autoCombat.js`: v2 pirate snapshot, zero-cost one-use target order, saved weapon-disable duration, canceled volley; v1 transition remains available.
- `src/systems/encounterState.js`: script-4 distress starts v1; script-5 distress and Reliable/Push pirate fights start v2; version-specific snapshot checks prevent malformed v2 fields from falling through v1.
- `test/auto_combat.test.mjs`: v2 order impact and reload, v1 replay, normal-fight cancellation; existing v1 fixtures pinned explicitly.
- `test/encounter_session.test.mjs`: four captain output sets, script-5 guided win and reload, stale revision, script-4 normalization/resume/reward, malformed snapshot rejection, existing normal recoverable loss.

## Self-review and concerns

- Verified the target order actually prevents positive damage at the next impact; it does not merely show an available option or event.
- Verified a serialized v1 script-4 encounter is accepted unchanged, resumes with Brace, and retains the exact `{ credits: 120, medals: 8, reputation: 4, gems: 0, fuel: 0 }` reward.
- Verified saved v2 state after target lock replays deterministically and cannot be used twice.
- Task 4 still connects the captain-first session actions and claim flow. Task 6 still presents the new events and order visually. Those are outside this source/test scope.
- No Jest upload or activation, Pages publish, PR merge, or network action was performed.

## Review fix: script-4 ruleset binding

Commit: `b940949` (`fix: bind distress combat ruleset to tutorial script`). Changed only `src/systems/encounterState.js` and `test/encounter_session.test.mjs`.

RED: Added a test that starts a real script-4 v1 distress fight, changes its saved snapshot to v2, and adds all v2 target-weapons fields and the available order option. `node test/encounter_session.test.mjs` reported 14 passed, 1 failed: `normalizeEncounterState(forged).activeContract` remained non-null. `node test/auto_combat.test.mjs` passed.

GREEN: `validSnapshot` now checks distress ruleset against the saved tutorial script at normalization, action, and recovery. Script 4 accepts v1; script 5 accepts v2. Saved Reliable/Push fights continue accepting v1 or v2. `node test/encounter_session.test.mjs` reported 15 passed, 0 failed; `node test/auto_combat.test.mjs` passed. `npm run test:loop` and `npm test` passed, each with 15 final-review tests and 0 failures. `git diff --check` and staged diff check passed.

The original script-4 v1 normalization, Brace continuation, and exact reward test remains green. The reviewer’s minor saved order-window false-available finding remains ledgered for final review and was outside this fix round. No owner files, generated docs, or deployment state changed.
