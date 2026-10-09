# Runtime audit repairs — 2026-09-24

Base: `0c430a0` on the existing `codex/contract-route-overhaul` branch. This repair set addresses the four Important findings in the independent source audit. It does not publish a QA build, merge a PR, activate Jest, install rejected walk sheets, or generate/edit images.

## Repairs and RED evidence

1. **Paid guided launch credit.** A malformed v5 contract revision made `normalizeContractState` clear the contract without carrying its already spent launch fuel. The v4/v5 guided fight recovery now carries at most one paid fuel into the next acceptance and clears the stale encounter. The new test reloads the malformed saved contract, retries, and checks fuel stays at 7, credits stay unchanged, acceptance identity changes, and no claim or pull appears. RED: `node --test test/tutorial_v5_session.test.mjs` failed `malformed v5 contract revision keeps paid launch credit on retry` at `undefined !== 1`.
2. **Missing first hire.** Reload reconciliation checks the real roster and required template. If the recruit is absent and only the captain remains, it restores the free-hire phase and clears stale fight state. If a matching recruit exists under a stale saved ID, it reconnects that instance. A saved ID that points at the captain or wrong template remains invalid. RED: the same v5 command failed `a missing saved first hire returns to one free hire after reload` (`fight !== hire`) and `a stale first-hire ID finds the existing recruit instead of granting another` (`missing !== saved Jen ID`).
3. **Second welcome draw.** The v5 grant checks a recorded `gacha.history` entry with `source: 'welcome'` even when mutable tutorial flags are reset. Reload reconciliation restores the register phase and saved recruit identity from that entry. The guard uses recorded source provenance, not the aggregate pull count. RED: the same v5 session command failed `corrupted v5 welcome flags reconcile to recorded pull without another recruit` (`pull !== register`). `node --test --test-name-pattern='direct v5 welcome grant' test/tutorial_v5.test.mjs` failed the direct second-grant assertion (`true !== false`). Script 4's grant path is unchanged.
4. **Nonhuman ship identity.** Alien and droid keep their rejected walk sheets unmapped. Their accepted portraits now preload for static in-ship actor markers: a teal diamond for alien and an orange square for droid. A distinct letter/shape remains if portrait loading fails. RED: `node test/crew_art_identity.test.mjs` failed because `staticCrewMarkerFor` was absent. The test now checks portrait mapping, no human walk image, distinct shape/source, and a portrait draw call for each marker.

## GREEN verification

| Command | Result |
| --- | --- |
| `npm run test:first-play` | PASS; captain, v5, session, encounter, UI, art manifest, scheduler, fresh-start suites |
| `node --test test/tutorial_v4.test.mjs test/tutorial_v4_session.test.mjs test/crew_art_identity.test.mjs` | PASS; 19 tests including legacy v4 and marker mapping |
| `npm run test:ship` | PASS; ship layout, pathing, animation, view, debug |
| `npm test` | PASS; full configured test command, including 15 final-review tests |
| `npm run build:pages` | PASS; Vite transformed 66 modules, `dist/assets/index-cW5vVOIL.js` |
| `git diff --check` | PASS |

Local browser visual check at 390×844 after a fresh Board ship → choose captain → Hire for free run for each species: the alien actor displayed its portrait in the teal diamond, while the droid actor displayed its portrait in the orange square, alongside the existing captain inspection overlay. These were observed in a composited ship view; the normal walk profile is 52 canvas pixels tall and the marker itself is 40 canvas pixels (about 25 CSS pixels after the ship's camera scale in this view). The browser check was local/mock and no screenshot artifact was saved. The full post-repair Task 7 browser matrix and physical-device art acceptance remain separate gates.

Owner-untracked `Mobile Game UI.jpg`, two review PNGs, and `package-lock.json` were untouched.

## Follow-up: corrupt v5 return at claim

The broad reviewer found that a genuine guided win in `claim` became stuck if the saved return result lost its rewards or the saved encounter was missing/changed to version 3. Both invalid-state normalizers had paid-fuel recovery only for phase `fight`; clearing the active contract left the tutorial in `claim` without a claimable contract.

Three RED subtests were run with `node --test --test-name-pattern='corrupt v5 claim with' test/tutorial_v5_session.test.mjs`: missing return rewards, missing return encounter, and unsupported encounter version all failed at `'claim' !== 'fight'` (0/3 passed). The repair takes an unclaimed v5 guided return back to `fight`, clears `firstWin`, preserves at most one paid launch fuel, and removes the stale contract/encounter. Each test then rejects the stale claim, launches under a fresh acceptance with unchanged fuel and credits, completes the target order, claims 120 credits once, rejects a second claim, and records no welcome pull.

GREEN after the repair: the same focused command passed 3/3; `npm run test:first-play`, `node --test test/tutorial_v4.test.mjs test/tutorial_v4_session.test.mjs` (18/18), and `npm test` all exited 0. Parent-owned concurrent QA/audit docs were left untouched. No Pages action, merge, or Jest activation was performed.
