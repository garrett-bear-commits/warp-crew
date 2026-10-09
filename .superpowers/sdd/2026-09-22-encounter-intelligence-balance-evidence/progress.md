# SDD ledger — plan: docs/superpowers/plans/2026-09-22-encounter-intelligence-balance-evidence.md

Execution base: 3a5d980. Owner chose subagent execution on 2026-09-22.

Workspace: dedicated `codex/contract-route-overhaul` branch in `/Users/garrettdare/warp-crew`. Pre-existing unrelated untracked `Mobile Game UI.jpg` and `package-lock.json` remain untouched.

Ruling: Continue in the existing dedicated feature checkout — the approved spec and prior package commits already live on this branch, and a new worktree would separate execution from the active handoff without carrying the untracked owner files. Cost if wrong: the user may prefer a second isolated checkout; all package work remains on a focused `codex/` branch and can be reviewed as an exact commit range.

## Preflight dependency scan

| Tasks | Shared file/interface | Finding |
|---|---|---|
| 1 / 2 | `sessionLoop.js`, deterministic action options and tell model | Sequential: 1 forwards time; 2 adds recommendation data. No conflict. |
| 1 / 3 | `contracts.js`, time-aware commit and reward extraction | Sequential: 3 must retain `now` through its extracted combat helper. |
| 1 / 4 | `contracts.js` and `sessionLoop.js` | Sequential: 4 derives bands in view models after time seam exists. |
| 1 / 6 | player/crew/contract/expedition deterministic seams | Sequential: 6 must use injected `now`/`rng`; no duplicate clock branch. |
| 2 / 3 | encounter IDs and combat projection | Sequential: static tells do not change payout math. |
| 2 / 4 | tell and recommendation display | Sequential: 4 consumes authored tell from 2. |
| 2 / 5 | encounter roster/matrix | Sequential: 5 uses the 16-entry roster and unchanged numeric fields. |
| 3 / 4 | `contracts.js`, band/formatter/UI | Sequential: 4 consumes `contractRewardBand` and does not create a second formatter. |
| 3 / 5 | shared payout helper/matrix | Sequential: 5 uses production preview and shared payout results. |
| 3 / 6 | production route results/economy simulation | Sequential: 6 uses shared payout paths through production transitions. |
| 4 / 8 | UI/browser evidence | Sequential: 8 measures the actual rendered card/review/order states. |
| 5 / 6 | `package.json` and QA Markdown | Sequential: 6 extends scripts and report; rerun generator for idempotence. |
| 5 / 7 | matrix artifact/audit | Sequential: 7 audits the committed first report. |
| 5 / 8 | matrix artifact/final QA | Sequential: 8 checks artifact idempotence and summarizes. |
| 6 / 7 | economy report/audit | Sequential: 7 needs both implementation reports before Grok. |
| 6 / 8 | economy report/final QA | Sequential: 8 includes complete report and tests. |
| 7 / 8 | audit ledger/final audit | Sequential: 8 appends final verdict to 7's ledger. |

| Task | Internal consistency finding |
|---|---|
| 1 | Test injection uses distinct RNG values; production defaults unchanged. The plan lists `src/shared/timer.js` in prose but its `wallClockProgress(job, now)` seam already exists, so Task 1 need not touch it. |
| 2 | 16 tell IDs map to 16 existing encounters; no numeric combat changes. |
| 3 | Extracted combat helper must own full result mutation and receive `now`; band enumerator calls production preview/commit and cannot call UI acceptance validation recursively. |
| 4 | Band derivation belongs in view model; invalid acceptance gate belongs in `sessionAction`, while low-level accept remains usable by enumeration. |
| 5 | Matrix rows include all orders and record enabled state; disabled rows cannot be treated as executable expected payouts. |
| 6 | Day 1 tutorial starts an expedition and accepts a normal offer. Daily loop must resume that accepted offer and must not attempt a second expedition while one is active. |
| 7 | Audit occurs after all six implementation tasks; unavailable Grok is not approval. |
| 8 | Browser sizes and reduced motion are emulation evidence; no release step is authorized. |

Ruling: Task 5's 192-row completeness requirement includes disabled order rows; record their enabled state and omit executable outcome expectation for disabled rows. Cost if wrong: the matrix may need a separate enabled-only view; raw rows remain sufficient to derive it.

Ruling: Task 6 treats the day-1 accepted normal offer and active Dustfall expedition as pending production state, then resumes them when valid. Cost if wrong: day-1 activity counts may differ from a player who stops immediately after the tutorial, but the baseline remains explicit and reproducible.

Task 1: implementer commit 90028a7; RED/GREEN deterministic test, focused four, `npm run test:loop`, and `npm test` reported green.
Task 1: minor (deferred): `sessionModels` crewLabel calls `readyCrew(player)` without supplied `now`, so a simulated recovered crew may disagree with enabled Launch; carry into Task 4 view-model work.
Task 1: complete (commits 3a5d980..90028a7, spec and quality review approved)

Ruling for Task 3: The plan's illustrative `readyContractCrew` snippet filters `status === 'ready'`, which conflicts with the current production helper's injury-deadline and slot/power selection behavior. Move the production helper unchanged into `contractRewards.js`, including its `now` parameter. Cost if wrong: an overly permissive or restrictive ready-crew set would corrupt preview power, trade payouts, and reward bands.

Ruling for Task 3: The band formatter must distinguish a numeric zero payout from currency omitted on some valid path before normalization; use raw path presence metadata alongside normalized values so `0–4 reputation` and `up to 8 gems` can both be truthful. Cost if wrong: players may misread the possible rewards although claim values remain correct.

Task 2: implementer commit bf53ab7; authored 16 tells, model recommendation, and contract/Explore telemetry. Focused tests and `npm run test:loop` reported green.
Task 2: minor (deferred): tests exercise contract followed=true and Explore followed=false, but not the opposite boolean values; implementation is symmetric. Carry to final review.
Task 2: complete (commits 90028a7..bf53ab7, spec and quality review approved)

Task 3: implementer commit 8bc8ec6; production payout helper extraction, fuel-feasible live bands, strict invalid-content validation, and coherent legacy test fixtures. Four focused scripts, `npm run test:loop`, and `npm test` reported green.
Task 3: review requested change for malformed story flags producing fabricated fallback payouts. Fix round 1/5 addressed (1 addressed, 0 open; commit 8bc8ec6..ffcfb96); focused and broad tests reported green; scoped re-review approved.
Task 3: minor (deferred): final_review destination-override fixture now supplies authored combat snapshots, so that fixture verifies snapshot consumption rather than independent snapshot selection; production-generation coverage should be considered in final review.
Ruling: A null `encounterId` in an accepted Risky briefing is not itself invalid saved content while valid saved Secure/Push outcomes supply the encounter on the production choice transition. Cost if wrong: this may accept a corrupted pre-choice identity that a stricter save validator would reject; no payout is invented from catalog lookup.
Task 3: complete (commits bf53ab7..ffcfb96, review finding fixed and re-review approved)

Task 4: implementer commit cf494e8; Board/review literal payout labels, invalid-content gating, stored-result return copy, and injected-now crew label. Focused UI/session tests and `npm run test:loop` reported green; task reviewer independently ran focused tests and diff check.
Task 1 minor resolved by Task 4: `sessionModels` crewLabel now uses injected `now`.
Task 4: complete (commits ffcfb96..cf494e8, spec and quality review approved)

Ruling for Task 6: The production tutorial recruit path currently calls `createCrewInstance` without the seeded RNG, so `grantTutorialRecruit(player, { rng })` and the `sessionAction` tutorial-draw caller need optional RNG forwarding even though `tutorial.js` and `sessionLoop.js` are absent from Task 6's file list. This follows the approved deterministic fresh-save requirement. Cost if wrong: the simulator would create a nondeterministic Jen instance ID and identical seeds would produce different JSON.

Ruling for Task 6: The extracted `applyExpeditionResult` must pass injected `now` to `applyCrewInjury`, which already accepts it; otherwise injury deadlines leak wall-clock time. Cost if wrong: repeatability and later-day readiness would drift with execution time.

Task 5: implementer commit a535767; 192-row production-preview matrix and deterministic JSON/Markdown report. Focused test, `npm run test:loop`, `npm test`, artifact idempotence reported green; reviewer independently compared generated artifacts and 94% cap.
Task 5: minor (deferred to Task 6): focused matrix test is not in routine `npm test` or `test:loop`; Task 6 adds the dedicated `test:balance` gate containing it.
Task 5: complete (commits cf494e8..a535767, spec and quality review approved)

Ruling for Task 6: `claimFuelRegen` keeps its claim cursor when the fuel tank is full, so simulated cap-excluded accrual is deferred/banked by current production behavior rather than permanently wasted. Record the amount under the spec's cap-waste field with that explicit interpretation. Cost if wrong: the report could overstate or understate actual opportunity loss from returning late; the raw fuel ledger remains available for reinterpretation.

Ruling for Tasks 5/6 reports: both generators must compose the shared Markdown deterministically, so running them in either order produces the same file. Cost if wrong: artifact checks will show false diffs or erase one section of evidence.

Task 6: implementer commit d44a106; 30-day free-player projection, seeded tutorial recruit, shared expedition claim transition, dedicated balance gate, 15-run JSON/Markdown. Focused economy, `test:balance`, `test:loop`, `npm test`, build, reverse-order artifact idempotence reported green. Reviewer independently regenerated JSON/Markdown and reconciled all 450 daily ledgers.
Task 6: minor (deferred): ignored author report describes later blockage as `hull_critical`, but committed 15-run data records zero such blockers and many `reward_unavailable` reasons. Correct the evidence interpretation in final QA/handoff.
Ruling: Treat recorded `reward_unavailable` in the 30-day run as no currently executable payout path; examples show failed expeditions injure crew while the new away team occupies the remaining crew, so contract launch has no ready crew. Cost if wrong: some instances may have another cause; the daily JSON preserves action reasons, injuries, and pending expedition for a full classification pass.
Task 6: complete (commits a535767..d44a106, spec and quality review approved)

Task 7: implementation commits 959f01b, 20cb9a3, f76d8d5; Chrome Grok returned scoped APPROVE on the pre-fix evidence packet, then a real non-tutorial Scout tell defect was proved RED and fixed. CLI was unavailable after one changed-condition retry; no API fallback. `test:balance`, `test:loop`, `npm test`, build, and exact diff check passed. Task reviewer independently approved spec and quality, with focused test and diff check passed.
Task 7: complete (commits d44a106..f76d8d5, spec and quality review approved)

Ruling for Task 8: Keep the browser-evidence section as a source fragment appended by both existing report generators, so regenerating either report retains the QA findings deterministically. Cost if wrong: the extra source document is one more maintained file, but raw combat/economy artifacts and generated Markdown stay reproducible.
Task 8: `c1c6b10` captured Chrome 153 fresh-save 390×844/360×800/reduced emulation and committed measurements/screenshots; `3cf555f` updated NEXT/handoff; `a05bcf4` fixed the normal/reduced Board/review filename overwrite with a red/green unique-name test. All 15 captures now have distinct names. Both report-generator orders are stable; `test:balance`, `test:loop`, `npm test`, `test:ship`, build, and diff check pass on `a05bcf4`. Grok's same-chat final exact-HEAD supplement returned scoped APPROVE for quoted code/docs/evidence composition, zero visible Critical/Important findings, and UNAVAILABLE for screenshot pixel review because Chrome could not attach the PNGs. Physical-phone, balance/economy/monetization, and release gates remain unapproved. Task 7 independent review was approved; Task 8 controller review remains separate.
