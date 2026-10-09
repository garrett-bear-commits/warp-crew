# Task 4 report: reward bands and combat intelligence UI

## Scope

- Derived live reward bands in `sessionModels` for board offers and reviews, using the current player snapshot and injected `now`.
- Rendered one literal `Possible payout now` label in board/review visible and accessible copy. A resolved return renders only its stored result reward.
- Disabled invalid-content review/acceptance and returned `reward_unavailable` before the low-level acceptance transition.
- Forwarded injected `now` to the active-contract ready-crew label. Existing encounter tells, recommendation badges, reasons, and unselected orders remain in place.

## RED/GREEN evidence

- RED: `node test/contract_ui.test.mjs && node test/session_loop.test.mjs` exited 1. `contract_ui.test.mjs` expected `<dt>Possible payout now</dt>`; board HTML still contained `<dt>Reward</dt>` and reward-family prose.
- GREEN: `node test/contract_ui.test.mjs && node test/session_loop.test.mjs && npm run test:loop` exited 0. Focused tests printed `contract_ui.test.mjs OK` and `session_loop.test.mjs OK`; loop suite passed all script checks and 15 final-review subtests, 0 failures.
- Self-review: `git diff --check` exited 0. Reviewed the four-file diff for stored-result handling, tutorial/claim branches, clock forwarding, HTML escaping, and unrelated files.

## Changed files

- `src/systems/sessionLoop.js`
- `src/ui/contractView.js`
- `test/contract_ui.test.mjs`
- `test/session_loop.test.mjs`

## Concerns

- No open Task 4 concerns. The existing `contractRewardBand` and formatter implementations were reused, so `src/systems/contracts.js` needed no change.
- Unrelated untracked `Mobile Game UI.jpg` and `package-lock.json` were left untouched.
