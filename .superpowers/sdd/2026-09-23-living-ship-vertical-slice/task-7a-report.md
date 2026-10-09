# Task 7A implementer report

## Scope and interface

- Fresh players are save version 8, named `Sparrow`, and start `tutorial.script = 4`, phase `board`.
- Script-4 phases are `board → station → fight → claim → name → pull → register → done`.
- `advanceTutorialV4(player, event)` accepts these committed events: `board_ship`, `station_assigned` (Bolt saved at Shields), `guided_win` (saved distress result plus guided win and Brace), `reward_claimed` (distress offer in completed IDs), and `registration_skipped` / `registration_completed`. Invalid or repeated events return the exact original player.
- `nameShip(player, name)` commits `name → pull`, returns the player shape, accepts a blank string as the current/default Sparrow name, counts Unicode grapheme clusters, and throws `RangeError` for controls, invisible-only names, or more than 24 visible characters. Repeated initial naming returns the same player.
- `grantWelcomePull(player, { rng })` commits `pull → register`, returns `{ ok, player, instance, kind, sold }`, chooses Kira/Tink/Nemi uniformly as Uncommon, and uses normal roster rules. It gives no currency cost and leaves the daily pull available. It records pity, compact gacha history, one-time reward flag, and suggested station/Away context. Repeated/reloaded pull is rejected.
- Gacha history entries have `{ templateId, instanceId, rarity, kind, source }`, capped at 40 entries. Ordinary `pullMerc`, `pullOnce`, and `pullTen` now consistently use caller RNG for rarity, template, and instance creation; normal odds and pity thresholds are unchanged.
- `migratePlayer` selects script-4 normalization only for a saved `tutorial.script === 4`. Script-3 active/completed and veteran saves retain their old flow and rewards. Invalid/missing gacha history becomes `[]`.

## TDD and verification

- RED first: `node --test test/tutorial_v4.test.mjs` failed `7 !== 8` before production edits. Expanded behavior tests then failed because `tutorialV4.js` was absent. Added later boundary tests failed on zero-width-only name, trailing control character, and null saved history before the corresponding fixes.
- GREEN: `node --test test/tutorial_v4.test.mjs test/tutorial_migration.test.mjs` — 12/12 pass.
- `npm run test:loop` — pass, including 15/15 final-review tests.
- `npm run test:balance` — pass; generated encounter and 30-day economy artifacts both report `unchanged` (16 encounters, 192 rows; 15 runs, 30 days each, all ledgers reconciled).
- `npm test` — pass.
- `npm run build` — pass.
- `git diff --check` — pass.

## Compatibility fixtures adjusted

- `test/helpers/tutorialFlow.mjs`, `test/tutorial_v3.test.mjs`, `test/session_loop.test.mjs`, and `test/final_review.test.mjs` now construct explicit saved script-3 players for existing v3 behavior tests. Their production expectations remain intact.
- `test/sanity.mjs` expects the new save version 8.
- `src/sim/contractEconomy.js` starts from an explicit script-3 fixture, with an explanatory comment, to preserve the approved historical 30-day report until a dedicated v4 simulator exists. It changes no economy rule, and output artifacts are byte unchanged.

## For Task 7B

- Wire only committed session transitions to the event names above. `nameShip` and `grantWelcomePull` advance their own phases. The current session/UI still treats script 4 as outside the v3 guided flow; 7B must gate and present the new tutorial before a fresh save is playable.
- The saved `tutorial.suggestedStation` is `weapons` for Kira, `shields` for Tink, and `null` plus `suggestedRole = 'away'` for Nemi. These are suggestions, not an automatic reassignment.
- The `registration_completed` event records only a UI choice. Do not promise cloud saving; current persistence remains local.
