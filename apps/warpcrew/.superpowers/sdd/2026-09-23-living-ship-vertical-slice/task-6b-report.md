# Task 6B report: durable crew-run encounters

## Result

- New script-4 distress launches and a reliable Pirate Scout reached by Push begin a versioned encounter at the route action that enters confrontation. Authored `ice_spur` is the fixed repeatable Pirate Scout route on the 2030-09-22 board. An already-saved confrontation with no `activeEncounter` stays on the legacy resolver, including active script-3 distress. Other encounters explicitly say “Legacy encounter.”
- Every beat checks acceptance ID and encounter revision, snapshots availability-adjusted station outputs, and advances the pure reducer. Fuel was paid by launch/route actions and is not touched by beats. The final winning beat constructs a payout from the authored encounter reward data, without another combat roll, then saves a valid return result. Claim is the only wallet/reputation grant and clears the terminal encounter; a second claim fails. A normal loss exposes Recover, clears the contract and encounter without a reward, and leaves hull at least 1.
- The new UI shows the threatened target/countdown, ship and pirate hull, shield reserve, station outputs and system integrity, legal orders with exact shield cost and disabled reason, and an always available no-order beat. The pirate remains in the world view during the saved fight; damage beams and bars consume committed state/events. Camera controls remain available. Reduced motion skips transient beams, and the snapshot still renders after reload.
- Loading validates version, acceptance identity, route seed, counters, finite hull/output/system fields, and the saved order window. A bad new encounter clears both contract and encounter and records a recovery event, so it cannot fall into the old resolver or claim a reward. Existing script-3 contracts are unchanged.

## TDD and verification

- Initial RED: `node test/encounter_session.test.mjs` exited 1 with `ERR_MODULE_NOT_FOUND` for the new encounter-state module. A later RED caught a wrong route seed being accepted; another RED caught a malformed order window that would have crashed the combat UI. Both are now guarded.
- Final `node test/encounter_session.test.mjs`: 9/9 passed.
- Final `node test/auto_combat.test.mjs`: passed.
- Final `npm run test:loop`: passed, including 15/15 final-review subtests. One existing test initially failed because it assumed every confrontation resolved through one legacy `contract-order`; it now drives the committed new encounter and asserts its actual combat beat telemetry, while retaining the original route beat-label assertion.
- Final `npm run test:ship`: passed.
- Final `npm run test:balance`: passed; both generated balance/economy artifacts reported unchanged.
- Final `npm test`: passed, including 15/15 final-review subtests.
- Final `npm run build`: passed.
- `git diff --check`: passed before the last test run; no whitespace errors were introduced afterward.

## Open review points

- Reviewed 6A normal balance makes a natural loss unreachable with Task 5's real station baseline. Reproduction with the 2030-09-22 reliable `ice_spur` Pirate Scout, Rex at Helm, Bolt in reserve, and no emergency order: outputs `{helm:110,shields:100,weapons:100,engineering:100}`; Pirate hull falls `42→37→32→27→22→17→12→7→2→0` by beat 9; player hull stays 30, shield reaches 0, and fuel stays 8. Loss/recovery is tested using a valid prior system-damage snapshot with Weapons integrity 0. A separate 6A tuning fix is required before Task 6 is accepted as offering both normal win and loss.
- New script-4 tutorial creation/migration is Task 7. The current `migrateTutorialV3` still coerces script 4 to 3; Task 7 must preserve script-4 resume and wire its tutorial phases. The 6B encounter snapshot itself survives JSON reload.
- `contractRewardBand` currently enumerates a no-order path for the new fight. After the 6A balance change, re-check whether it still communicates the possible normal win payout; it may need an order-policy path.
- Browser/phone rendered checks remain for the later visual and QA packages. The current saved-state tests and build do not prove the presentation on a real device.

## Scope

Only Task 6B source and tests were changed. Existing untracked `Mobile Game UI.jpg` and `package-lock.json` remain untouched. No push, merge, deploy, art generation, or Jest activation was performed.

## Review fix round 1 (2026-09-23)

- A fresh crew fight now selects the Ship tab, and a compact combat panel is rendered over the visible ship rather than only on the Missions page. The stage and its pan/zoom controls remain available outside the panel. The legacy `isBattlePlaying` action lock was not broadened.
- Encounter-beat effects now carry their terminal outcome separately from route-result payloads. The main loop calls `logTravelResult` only for travel/combat effects, preventing a post-save exception after a winning beat.
- Save normalization now validates nested order counters, brace duration, cooldowns, enemy state, and every named order option before the reducer or UI can consume them. An active encounter with a missing/corrupt `encounterMode` clears both encounter and contract; true old saves without an active encounter still retain the legacy path. Terminal wins must have a defeated enemy and a return result whose hull loss agrees with the encounter snapshot. Direct claim also rejects a mode mismatch.
- The pirate tell remains visible for the intervening beat after the order window closes. Brace and Repair buttons disclose their effect and cooldown/once-per-fight rule before selection.
- RED regressions caught missing ship-panel and overlay integration; the expanded focused suite is now 11/11 GREEN. `node test/auto_combat.test.mjs`, `npm run test:loop` (including 15/15 final-review subtests), `npm run test:ship`, `npm run test:balance` (generated artifacts unchanged), `npm test`, `npm run build`, and `git diff --check` all passed after the fixes. These are code/test/build checks, not a phone-rendered QA pass.
- The separate 6A natural normal-loss reachability gate remains open with the real-station baseline recorded above; this round did not retune balance. Script-4 tutorial migration and device presentation remain later-package work.

## Review fix round 2 (2026-09-23)

- RED reproduced the remaining claim forgery: a real terminal win with its encounter `beat`, `revision`, and `eventIndex` rewritten to zero survived migration and could reach claim. A separate regression changed only the contract revision to test drift.
- A new-mode saved contract must now be at its entry revision (distress Launch = 1; reliable Push after Launch = 2) plus exactly the number of encounter beats. Terminal win/loss also requires at least one combat beat. This check runs on migration and direct claim through the shared encounter validator. Legitimate guided and normal start/win reloads remain accepted; legacy script-3 fights remain on the old path.
- Focused encounter suite 11/11, auto-combat reducer, loop suite (15/15 final-review subtests), ship suite, balance suite (artifacts unchanged), full `npm test`, `npm run build`, and `git diff --check` all passed after the fix. The 6A normal-loss balance gate and phone-rendered QA remain open, unchanged.
