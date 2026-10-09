# Task 5 report — saved crew stations

## Result

Added saved `stationAssignments`, a pure `stationOutputs(player, now)` selector, the `station-assign` session action, station controls and output readouts, and authored crew routes to the station work anchors. New saves put Rex at Helm and leave Bolt without station duty; the Shields assignment is a player action. Existing saves without the map normalize their current crew to unassigned without moving roster members. During contract briefing, unassigned crew retain the legacy Bridge/Engineering choreography. Nonstation rooms retain their prior role-based display.

The exact physical mapping is Helm → Bridge, Shields → Operations, Weapons → Workshop, Engineering → Engineering. One crew member may occupy each station; assignment to an occupied station clears the previous assignment. Away and injured crew retain saved duty but contribute baseline only. The selector is exposed to both ship UI and combat presentation models, with no change to combat odds, damage, rewards, gacha, or economy.

## Provisional output decision and observed delta

Station numbers are first-slice display indices: unmanned baseline `100`; matching Pilot at Helm, Engineer at Shields or Engineering, or Gunner at Weapons contributes `+10`. Off-role crew contribute `+0`. The room sheet shows baseline, bonus, and total; the selected station replaces the location text in the close-scale stage HUD; the crew panel summarizes all four outputs. These numbers are not multipliers and are not consumed by combat resolution.

Observed in tests: fresh Rex gives Helm `100 + 10 = 110`; Shields begins at `100`; assigning Bolt to Shields changes it to `100 + 10 = 110`; sending Bolt away or marking him injured returns effective Shields to `100` while the saved Shields order remains. An Engineer at Engineering and Gunner at Weapons each yield `110`; an Engineer at Helm yields `100`.

## RED / GREEN evidence

- Before implementation, `node test/stations.test.mjs` and `node test/station_actions.test.mjs` each failed with `ERR_MODULE_NOT_FOUND` for `src/systems/stations.js`.
- After the selector and session action, `node test/stations.test.mjs` failed because Operations still rendered `Empty`; the station room sheet then made the test pass.
- The new Leave station assertion failed `false !== true` while the UI's empty `data-station` value was rejected; the session action now maps it to `null` and the test passes.
- An injured-status test failed `10 !== 0` after its timer expired but before recovery changed status; output now requires `status: 'ready'`.
- A prototype-name target test failed because `toString` was accepted as a station; validation now checks own station IDs.
- The nonstation room regression test failed because Medbay rendered `Empty` for a Medic; prior role display is restored.
- A combat-presentation test failed because `combat.stationOutputs` was undefined; both combat presentation paths now receive the same selector result, without applying it to combat math.

## Final verification

- `node test/stations.test.mjs && node test/station_actions.test.mjs` — PASS; each printed `OK`.
- `npm run test:loop` — PASS; contract, tutorial, expedition, session, and final-review suite completed, final review 15/15.
- `npm run test:ship` — PASS; five ship layout, pathing, animation, view, and debug files completed.
- `npm test` — PASS; all invoked files completed, final review 15/15.
- `npm run build` — PASS; Vite transformed 57 modules and built `dist`.
- `git diff --check` — PASS with no output.

## Self-review and limits

The action goes through the existing durable session publication boundary; the UI does not write the saved map. Normalization drops unknown station IDs and duplicate occupancy deterministically. The selector returns a fresh object and does not mutate the save. Legacy combat selection and contract route tests passed. The added room chooser can scroll within the existing sheet, but this task did not include a phone visual check. Provisional output indices need a later balance decision before affecting actual combat. No push, merge, deploy, or Jest production action was taken. Existing untracked `Mobile Game UI.jpg` and `package-lock.json` were left untouched.

## Review fix round 1 — projected button output

The room and crew assignment buttons now preview a valid proposed assignment through `assignStation` and then derive the target station's projected total from `stationOutputs`. Their text shows the resulting total and signed change from the current total. In the fresh save, assigning Bolt to occupied Helm shows `100 (-10)` because Rex is displaced; assigning Bolt to empty Shields shows `110 (+10)`. The preview does not mutate the save or change combat or economy numbers. Invalid previews are disabled and labeled unavailable.

RED evidence: `node test/stations.test.mjs` failed the Helm room button assertion because the rendered Bolt choice said `Bolt · +0` instead of `Bolt · 100 (-10)`. A model assertion initially failed with `SyntaxError: ... does not provide an export named 'previewStationAssignment'`. A later invalid-preview assertion failed with `TypeError: Cannot read properties of undefined (reading 'total')` for `null`; preview validation now returns `unknown_station`.

GREEN evidence after the fix:

- `node test/stations.test.mjs && node test/station_actions.test.mjs && node test/contract_ui.test.mjs` — PASS; each printed `OK`.
- `npm run test:loop` — PASS; final review 15/15, 0 failures.
- `npm run test:ship` — PASS; all five ship test files printed `OK`.
- `npm test` — PASS; final review 15/15, 0 failures.
- `npm run build` — PASS; Vite transformed 57 modules and built `dist` in 493 ms.
- `git diff --check` — PASS with no output.

This round did not address the separately logged away/injured Leave station button, save-failure-specific assertion, or phone visual QA.
