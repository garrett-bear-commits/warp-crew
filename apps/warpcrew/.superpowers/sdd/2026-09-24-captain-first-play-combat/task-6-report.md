# Task 6 implementation report — 2026-09-24

## Scope and result

Implemented the captain-first v5 presentation: captain choice, first hire, ship naming, free recruit, and registration sheets; shared portrait/role/stars/job/power cards; short assignment and trader-distress cues; guided battle target window and result cargo action; near-bridge camera opening and collapsed controls; state-derived CTA spotlight, pulse, and attention dots. Committed combat visuals show the pirate/trader pair, target ring, shots, weapon disable, and impact without changing battle rules. The 512×768 pirate source is drawn without stretching. Jen and Bolt arrival copy routes to their actual stations; later recruits get neutral copy.

The captain cannot be offered a Bench action. Crew attention clears on opening Crew and stays hidden when a free pull has no roster/reserve capacity. The CSS uses a static CTA outline under `prefers-reduced-motion`.

Reviewer correction: the original Task 6 commit still required a text-only **Continue fight** tap after the v5 target-weapons order. The follow-up commit adds a single-timer guided beat scheduler for the committed script-5 order, retains the script-4 Brace gate, and removes the v5 manual beat control. The status now reads the committed v2 weapon-disable window. Each automatic beat still uses `sessionAction` plus `persistSessionTransition`, so state and effects publish only after a successful save.

Second review correction: a failed automatic beat save previously stopped that scheduler while leaving only “Crew engaging…” onscreen. The saved acceptance ID/revision now gates a visible **Retry fight progress** action after this failure. Retry uses the existing guarded `encounter-advance` transition; a repeated failed save leaves the action visible, while a successful commit clears the cue and resumes automatic crew beats. No failed beat is published or rewarded.

## Test evidence

- Red-first `node test/first_play_ui.test.mjs` exposed missing v5 UI and later the captain Bench action; green after implementation/fix.
- `node test/first_play_ui.test.mjs` — pass.
- `node test/crew_art_identity.test.mjs` — pass; rejected alien/droid walk mappings do not resolve to generic human sheets.
- `node test/first_session_copy.test.mjs` — pass.
- `node test/ship_camera_input.test.mjs` — pass; captain marker click is not swallowed by camera gesture handling.
- `npm run test:ship` — pass, all five ship tests.
- `node --test test/guided_beat_scheduler.test.mjs` — pass after witnessed red assertions; all four captains finish through committed automatic beats, with animation deferral, one pending timer, failed-save/no-publication, visible identity-guarded retry, repeated failed retry, successful retry back to automatic beats, reload continuation, and one contract resolution/claim. Other cases retain the script-4 Brace gate and keep an uncommitted v2 window from falsely saying crew is engaging.
- `node test/tutorial_v5_session.test.mjs`, `node test/tutorial_v4_session.test.mjs`, `node test/encounter_session.test.mjs`, `npm run test:loop` — pass after reviewer correction.
- `npm run build:pages` — pass, Vite transformed 66 modules after reviewer correction.
- `npm test` — pass, including 15 final-review tests.
- `git diff --check` — pass.

## Phone UI QA

Local Chrome/Vite, no publish: inspected the first-play path at 360×800 and 390×844 in normal motion, including splash, captain choice, hire, ship/assignment cue, distress composition and spotlight, battle target order and disabled-weapons state, victory/cargo, ship naming, free recruit reveal, and post-intro ship/Crew. **That initial walkthrough used the erroneous Continue fight taps; it did not verify automatic combat.** Automatic progression and its new save-failure retry are verified by real-transition tests, not by a new browser walkthrough. At 390×844, Crew showed legible 88px portraits and name/role/stars/job/power cards, with no captain Bench. Opening Crew cleared the dot; returning to Ship showed zero `.nav-badge` elements. At 360×800, the post-intro ship screenshot had no horizontal overflow; a DOM measurement found no visible buttons below 44px high. The bottom CTA and nav cleared the viewport edge. The pirate was upright in the battle composition rather than forced into the old wide aspect.

Reduced-motion browser emulation was not available through this UI-control session, so 360×800 and 390×844 reduced-motion screenshots were **not captured**. The `prefers-reduced-motion` CSS disables the pulse animation and retains a 3px static outline; this was statically reviewed, not visually verified. Automated render/input tests cover spotlight target count, scrim action blocking, badge state, art aspect, and camera-marker click behavior, but they are not a substitute for owner-phone QA.

## Remaining gap / boundaries

Task 5's alien and droid movement sheets were rejected and remain unmapped. Task 6 prevents the generic human walk fallback and renders a distinct static captain identity/portrait marker; it does **not** claim motion art is complete or install substitute sheets. No Jest production, merge, PR, deployment, or publication action was taken. Task 7 still owns the full fresh-save browser/reduced-motion matrix and Pages gate.
