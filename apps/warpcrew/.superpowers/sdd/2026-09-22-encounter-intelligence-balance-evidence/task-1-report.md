# Task 1 report: deterministic time and identity seams

Status: DONE

## Implementation

- `createCrewInstance` accepts an explicit `instanceId` or injected `rng`. `createNewPlayer` accepts `now` and one shared RNG stream for both starter crew identities. Defaults remain `Date.now()` and `Math.random`.
- Contract acceptance, preview, commit, combat injury expiry, trade payout crew selection, and claim consume supplied `now` where time affects state, payout, or analytics. Preview and commit use the same simulated clock for ready-crew selection and decision-key validation across injury deadlines.
- `sessionModels` and `sessionAction` forward their existing `now` to contract preview and transition functions.
- Expedition resolution and abort payout progress use supplied `now`. The `abortPayoutFrac(job, now)` seam is retained for the Task 3 payout extraction. `src/shared/timer.js` already accepted `now` and was untouched.
- No reward tables, success probabilities, injury duration formulas, or other numeric balance rules changed.

## TDD evidence

- RED: `node test/deterministic_seams.test.mjs` exited 1 with `ERR_ASSERTION` on `assert.deepEqual(a, b)` because the starter crew instance IDs differed despite equal injected RNG streams. The new file also checks exact player timestamps, an explicit crew ID, contract preview/commit across an injury deadline, contract claim day and elapsed analytics, session forwarding, expedition completion at 59/60 minutes, and abort payout at 29/30 minutes.
- GREEN: after minimal production changes, `node test/deterministic_seams.test.mjs` exited 0 with `deterministic_seams.test.mjs OK`.

## Verification

- `node test/deterministic_seams.test.mjs && node test/contract_route.test.mjs && node test/session_loop.test.mjs && node test/travel_phase_a.test.mjs`: exit 0, all four scripts OK.
- `npm run test:loop`: exit 0, all named scripts OK and final review 15 passed, 0 failed.
- `npm test`: exit 0, all named scripts OK and final review 15 passed, 0 failed.
- `git diff --check`: exit 0.

## Files

- `src/data/crewRoster.js`
- `src/systems/player.js`
- `src/systems/contracts.js`
- `src/systems/sessionLoop.js`
- `src/systems/expedition.js`
- `test/deterministic_seams.test.mjs`

## Self-review and concerns

- Reviewed every changed call site in the diff. Existing calls that omit `now` or `rng` retain live defaults. Contract decision keys continue to reject stale previews when the selected ready crew changes.
- `Mobile Game UI.jpg` and `package-lock.json` were pre-existing unrelated untracked files and remain untouched.
- No known concerns in Task 1 scope. This task does not include the simulator or Task 3 payout extraction.
