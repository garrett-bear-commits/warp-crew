# SDD ledger — plan: docs/superpowers/plans/2026-09-23-living-ship-vertical-slice.md

Base commit: 5e897d7bd934e1554f51f03bf3cc57a03d251502. Baseline `npm test`: pass. Worktree decision requested; no new worktree created yet.

## Preflight interface and task scan

| Tasks | Producer → consumer or self-check | Finding |
| --- | --- | --- |
| 1 | Camera transform tests → math implementation | Approximate float checks; no conflict. |
| 1→2 | `makeCamera`, `unproject`, `pan`, `zoomAt` → gesture controller | Exact signatures align. |
| 1→3 | `project` → world effect projection | Exact signature aligns; world units must remain 1152×1728 pixels. |
| 2 | Pointer fake/tests → controller | Plan's test covers drag-to-pinch cancellation but not lost capture; add focused test during implementation. |
| 2→3 | Stable `.stage` controller → transformed world wrapper | Shared `bridge.js`; sequential edits only. |
| 3 | Projection tests → effect/space implementation | Seeded landmark test is self-equality and insufficient for changed-seed/resize; strengthen during implementation. |
| 3→4 | Camera world wrapper → walk animation canvas | Shared `crewWalk.js`; preserve world coordinates and do not independently scale twice. |
| 4 | Route test → pathing implementation | `shipRoutes.js` avoids starterShip/navGrid circular dependency. |
| 4→5 | Work-anchor routing → station assignment targets | Four logical stations need physical room mapping; see ruling below. |
| 5 | Station output tests → saved assignment selector | Fresh Rex helm/Bolt reserve aligns with guided Shields action. |
| 5→6 | Station selector → combat per-beat outputs | Availability must recompute per committed beat; shared save model requires sequential integration. |
| 6 | Simulation tests → reducer | Guided win and normal loss fixtures need tuning without a hidden win override. |
| 6→7 | Durable encounter → tutorial phase machine | First win/claim are committed before v4 phase/recruit; shared `sessionLoop.js` sequential. |
| 7 | Migration tests → fresh-only script | SAVE_VERSION=8 but script 3 remains frozen for active saves. |
| 7→8 | Tutorial state/actions → opening/copy | Shared `bridge.js`; visual pass follows behavior. |
| 8 | Manifest/copy tests → UI/art | Six outputs, costed gate; no generation until separate approval. |
| 8→9 | QA artifact/copy/screens → audit | UI audit suggestions require owner approval before applying. |
| 9 | QA evidence → handoff | Local tests and browser capture do not imply real-phone or production approval. |

Ruling: Map helm to bridge, shields to operations, weapons to workshop, engineering to engineering — the current cutaway has no Shields-labelled room, so reusing operations preserves visible door/hall geometry. If wrong, station signage/art will need rework.

Ruling: Strengthen Task 3's landmark test to assert coordinates persist over resize and change with seed — the plan's `deepEqual(x,x)` is tautological. If wrong, this adds a small test but no product behavior.

Ruling: Add focused lost-pointer-capture cancellation test in Task 2 — the plan requires the behavior but its written test does not pin it. If wrong, this adds a small test with no runtime cost.

Ruling: Do not infer art approval from plan approval — the spec and plan both require a separately costed yes before Flora generation. If wrong, the visual package waits for an extra user response.

Ruling: Continue on the existing `codex/contract-route-overhaul` feature branch while the optional separate-worktree question is unanswered; this avoids creating a new checkout without consent, and baseline tests pass. If wrong, moving these focused commits to a separate worktree later costs a branch handoff; the original untracked files stay untouched.

Task 1 review at 1c16e6f: spec ❌ / quality needs fixes. Important: clamp can move world entirely offscreen on narrow viewport; 64-world-pixel scale premise is not derived from existing station geometry; zoom test never changes scale. Minor: small rendered world can drift off-center.

Ruling: For Task 1, use the smallest authored room hit width (19% of 1152 world pixels) as the measurable station target; choose near framing so approximately 2.5 such rooms span the viewport, while retaining a 44px floor. This replaces the unverified 64px visual-feature premise and should make a station/adjacent hall inspectable. If wrong, the close zoom may need visual retuning after rendered phone QA.

Ruling: When the world fits inside a viewport axis, center it rather than allowing an edge-aligned overview; when it exceeds the viewport, require visible overlap of min(viewport extent, 20% world extent). The plan's 20% guarantee is geometrically impossible when the viewport is narrower than 20% of the world. If wrong, extreme-aspect panning may feel constrained but the ship will not disappear.

Task 1: fix round 1/5 (4 addressed, 0 open; commits 1c16e6f..f988757).
Task 1: complete (commits 5e897d7..f988757, review clean).

Task 2 review at 5b7180f: spec ❌ / quality needs fixes. Important: `camera-disabled` during battle blocks required pan/pinch; lost capture of a stationary press can allow a subsequent native click to select a station. Initial camera transform was verified by reviewer.

Task 2: fix round 1/5 (2 addressed, 0 open; commits 5b7180f..d0b45fe).
Task 2: complete (commits f988757..d0b45fe, review clean).

Task 3 review at 4cc41ac: spec ❌ / quality needs fixes. Important: combat anchors can start offscreen at close zoom; CSS focus easing moves hull separately from effect/background camera state; `test/contract_ship_feedback.test.mjs` fails after canvas world-coordinate change and `test:loop` was not run. Minor (deferred to final visual pass): nebula/black-hole image aspect ratios are stretched by square drawing in `spaceFlight.js`.

Ruling: Remove CSS focus tween until all render layers can share a frame-interpolated camera; instant focus is correct and reduced motion stays respected. If wrong, focus loses a brief ease but avoids visible ship/effect separation.

Ruling: Give combat presentation an explicit battle-overview camera action before its first draw, centering player and pirate at a safe overview scale without saving camera state. If wrong, the player loses their close view at combat start but can pan/zoom back manually, matching the spec's suggested battle frame.

Task 3: minor (deferred): space images are drawn as squares, stretching nebula/black-hole assets; revisit during Task 8 visual pass.
Task 3: fix round 1/5 (3 addressed, 0 open; commits 4cc41ac..7d86bcc).
Task 3: complete (commits d0b45fe..7d86bcc, review clean).

Task 4 review at 9445abd: spec ❌ / quality needs fixes. Important: rerouting from an actor already in the spine can use stale prior-room identity and omit a door-enter marker; expedition Claim/Skip/Extract remains blocked by `departureInFlight` until decorative walk callback, contrary to the plan's no-wait contract. Reviewer confirms route tests pass but close-zoom recording is absent.

Ruling: Treat a source point in the spine as the spine regardless of stale actor room; route to any room through its authored `door-enter` and update actor room only there. If wrong, an interrupted walk may take a longer hall route, but it cannot cut a wall.

Ruling: Remove the gameplay gate on a durably started expedition's Claim/Skip/Extract; cancel or reconcile decorative departure when one of those actions commits so later animation callbacks cannot overwrite the newer state. The preexisting main/UI guard conflicts with the spec's no-animation-wait contract, even though it was outside Task 4's original file list. If wrong, rapid expedition actions may need further animation cleanup, but save authority stays with the transition.

Task 4: fix round 1/5 (2 addressed, 0 open; commits 9445abd..832f544).
Task 4: complete (commits 7d86bcc..832f544, review clean). Visual close-zoom bridge→engineering/workshop recording remains for Task 9 QA.

Task 5 review at e0b0599: spec ⚠️ / quality needs fixes. Important: UI assignment buttons label role bonus, not actual output delta when assigning a crew member displaces an occupant (e.g. off-role Bolt replaces Rex at Helm and changes 110→100, but button says +0). Minor (deferred to Task 8 UX pass): Leave station remains enabled for unavailable away/injured crew but session action rejects it. Minor (deferred to Task 9 QA): station-specific save-failure test and phone visual check.

Task 5: fix round 1/5 (1 addressed, 0 open; commits e0b0599..f777f2a).
Task 5: complete (commits 832f544..f777f2a, review clean).

Ruling: Split Task 6's implementation into 6A pure seeded encounter reducer and 6B durable contract/session integration, with a review gate after each; the original single dispatch ran for an extended period without a diff or blocker response. If wrong, this adds one extra review cycle but keeps save-authority changes isolated from simulation math.

Task 6A review at df383fa: spec ❌ / quality needs fixes. Important: Brace and repair advertise shield costs of 2/3 when maximum shield is 1, and permit the orders with zero shield; targeted system damage does not change that station's combat effects. Minor: seeded determinism test stops before the later target draw; cost tests do not assert resource deduction/insufficient-resource behavior.

Task 6A: fix round 1/5 (2 original Important addressed, 1 new Important open; commits df383fa..8358838). Re-review found `orderWindow.availableOrders` still advertises Brace/Repair when shield or cooldown makes them unavailable, with no pre-choice cost. Minor: repair can be paid at full hull for zero healing.

Task 6A: fix round 2/5 (remaining Important addressed, 0 open; commits 8358838..6dd821b). Saved order windows now carry truthful cost, availability, reason and cooldown; full-hull repair disabled. Scoped review Spec ✅ / Quality Approved.
Task 6A: complete (commits f777f2a..6dd821b, reviewed clean). Focused, balance, `npm test`, and build PASS in implementer report; reviewer did read-only scoped review.

Task 6B review at e8d0699: spec ❌ / quality needs fixes. Important: Missions-tab encounter controls hide/disable the ship stage and camera; terminal effect passes string result to travel logger and throws after save; nested saved order objects are under-validated and can crash the reducer; inconsistent terminal states can be claimed and a corrupt encounter mode can fall back to legacy combat; threat countdown vanishes a beat before impact and order effects/cooldowns are not disclosed; natural normal loss is unreachable with real station outputs (6A balance dependency). Reviewer ran narrow reproductions, not broad suites.

Task 6B: fix round 1/5 (five presentation/state groups substantially addressed, one Important terminal invariant open; commits e8d0699..b5be271). Re-review reproduced a won snapshot with enemy hull 0 but encounter beat/revision forged to 0; migration retained it and claim succeeded. Need terminal beat/progression invariant. Natural normal loss remains separate 6A tuning gate.

Task 6B: fix round 2/5 (remaining Important addressed, 0 open; commits b5be271..dcb57e3). Terminal requires positive beat; contract revision must match entry revision plus beats. Scoped review Spec ✅ / Quality Approved, focused 11/11 personally rerun by reviewer. Implementer reports loop/ship/balance/`npm test`/build PASS.
Task 6B: complete (commits 6dd821b..dcb57e3, reviewed clean). Task 6 overall remains open pending 6A normal-loss balance and reward-band recheck, plus rendered device QA later.

Ruling: Allow the Task 6A balance follow-up to adjust only `test/encounter_session.test.mjs`'s normal-win fixture to a legally staffed +10 Weapons station, because that test assumed the baseline no-order route always wins and now conflicts with the required reachable normal loss. If wrong, the winning integration test's setup changes, but no production 6B code or payout rule changes.

Ruling: Also allow a narrow `test/final_review.test.mjs` telemetry expectation update for a now-reachable normal loss; a lost contract emits a loss/recovery path rather than `contract_resolved` reward telemetry. If wrong, this changes only the test's interpretation of a losing branch, not production telemetry or reward behavior.

Task 6A balance review at 615cd6f: spec ⚠️ / quality needs fixes. Important: on the actual reliable Push seed, real baseline no-order and the only legal Brace at beat 2 both lose at beat 9, and Repair is never meaningfully available; only a +10 Weapons staffing flips outcome. Captain-order agency is not demonstrated. Minor: order event count shifts seeded target sequence, making Brace alter later enemy target implicitly. Guided fight and payout band unchanged.

Task 6A balance: fix round 1/5 (order agency and target coupling addressed, 0 open; commits 615cd6f..4093864). Independent read-only re-review Spec ✅ / Quality Approved. Actual reliable Push: baseline no-order loss beat 9/hull 1, first-window Brace win beat 9/hull 11, real +10 Weapons win beat 7/hull 14; guided win beat 5. Normal combat is not guaranteed across every seed, as intended. Implementer reports focused/loop/ship/balance/`npm test`/build PASS.
Task 6 overall: behavior and persistence reviewed clean through 4093864. Rendered browser and physical-device QA remain Task 9; Task 7 must preserve new script-4 encounter reload.

Ruling: Task 7A may update test-only legacy fresh-save assumptions and the shared `completeFreshTutorial` helper to construct an explicit script-3 fixture, because fresh saves correctly move to v8/script 4 while those older tests are intended to protect v3 behavior. If wrong, some tests may need reclassification, but production v3 persistence remains unchanged.

Ruling: Keep `src/sim/contractEconomy.js`'s historical 30-day balance baseline on an explicit script-3 starting fixture during Task 7A; fresh v4 session behavior needs a separate later simulator, and silently shifting this report would erase comparability. If wrong, this preserves an old benchmark rather than measuring the new onboarding, so QA must not present it as v4 balance evidence.

Task 7A: complete (commits 4093864..c584902, spec ✅ / quality Approved). Focused 12/12 personally rerun by reviewer; implementer reports loop/balance/`npm test`/build PASS and unchanged historical artifacts. Minor deferred to 7B: `guided_win` guard should match encounter/contract acceptance ID; phase-migration tests use synthetic phase snapshots rather than real committed interruption states; historical economy sim fixture remains coupled to starter defaults. Explicit 7B dependency: open third berth before welcome pull or normal roster rules reserve the new crew.

Task 7B review at 5a0c46e: spec ❌ / quality needs fixes. Important: post-intro next-job hint returns before selected-room sheet, preventing ship station controls immediately after tutorial; notification boot entry can override unfinished v4 Ship selection to Missions while nav is hidden and action gate rejects those buttons. Minor: local mock login should be labeled as simulated so QA does not mistake it for real Jest registration. Reviewer personally ran focused 7/7 and a narrow complete-flow room-sheet reproduction; no broad suites.

Task 7B: fix round 1/5 (two Important plus mock-login minor addressed, 0 open; commits 5a0c46e..5c554ad). Scoped review Spec ✅ / Quality Approved; reviewer personally ran focused 9/9. Implementer reports focused 32/32, loop/ship/balance/`npm test`/build PASS.
Task 7B: complete (commits c584902..5c554ad, reviewed clean). Mounted browser, physical phone, and real Jest overlay remain QA unknowns.

Ruling: Split Task 8 into 8A no-cost full-screen opening/preload/copy foundation with clearly provisional existing art, then 8B accepted Flora exports only after a separately costed approval. If wrong, this adds a review gate and temporary fallback presentation but prevents an unapproved metered batch or false completed-art claim.
Task 8 Flora price checked on 2026-09-23: GPT Image 2.5 Flare/Sunburst text-to-image estimated US$0.05537 per output; six outputs estimate US$0.33222, proposed hard cap US$0.50. Separate user approval requested asynchronously; no metered generation run.

Task 8A review at 96a8673: spec ❌ / quality needs fixes. Important: guided combat buttons inherit 15px global button font despite 16px first-session requirement; Brace, Continue fight, Bring cargo aboard need >=16px. Minor: splash amber primary changes to pale blue in ship cue, conflicting with one-accent direction. Deferred visual gate: crew remain tiny/low-contrast in 360/390 phone captures; existing provisional art is not the requested final crew/gallery splash. Reviewer inspected diff/captures, no broad suites.

Task 8A: fix round 1/5 (Important and accent minor addressed, 0 open; commits 96a8673..b0e1b19). Scoped review Quality Approved; Chrome computed Brace/claim 16px and >=44px at 360/390, Continue shares selector but was not live-measured. Implementer reports focused/tutorial/loop/ship/balance/`npm test`/build PASS.
Task 8A: complete as a provisional visual foundation (commits 5c554ad..b0e1b19, reviewed clean). Final splash/crew art, crew true-size readability, and physical-device QA remain open; no Flora spend.

Ruling: Treat Garrett's latest “Yes” as approval of the immediately preceding exact six-output Flora question with a US$0.50 cap, but do not infer any permission to exceed that cap. If wrong, one US$0.113 output was generated before the ambiguity was caught; no other runs occurred.

Task 8B: first Flare high/2K splash run `run_m17315921cwcfemzd770esspk58f1v76` completed and cost US$0.113, not the quoted US$0.05537. Original 1440×2560 output preserved at `docs/art/outputs/` with SHA-256/provenance in committed ledger `67a1b41`; no runtime integration or other five runs. Six equal charges imply US$0.678 > US$0.50 cap, so the remaining batch is halted pending a new cap/scope decision requested asynchronously. No duplicate generation.

Task 9: Grok CLI failed before session due sandbox DNS/session-write limits. Chrome packet-only audit returned REQUEST CHANGES, but local full-code verification rejected its ordinary-UI double-pull, stranded tutorial, and completed-distress claims; local-save tampering is not a remote mint proof. It exposed a narrower real v4 corrupted-fight fuel double-charge, fixed RED→GREEN in `454495f` and independently reviewed Spec ✅ / Quality Approved. Root reran full test/ship/loop/balance/build matrix at `454495f` PASS. The mobile-design zip hash matched; CSS scan flagged 21 sub-16px declarations, 158/243 off-grid spacing, 22 unchecked contrast pairs due token parser limits. Standalone unrendered before/after proposals and QA report committed as `67a1b41`. Do not apply those UI suggestions without Garrett approval.

Task 9 browser QA: scripted local fresh v4 flow reached Board→Bolt/Shields→Brace/win→claim/name/Tink pull→local Jest Skip→reload persistent crew and assignment. No first-win stopwatch, unprompted next-job observation, real phone/Jest, or exact phone-size final-art captures. Caution: `?fresh=1` reset a previously in-progress save on the Chrome 127.0.0.1:5173 origin during QA; provenance/recovery unknown, disclosed. Never reuse that profile for a fresh run; use isolated context and preserve saves first. QA upload approval is separately pending; no upload, PR merge, or production activation.

Task 8B/9 continuation: Garrett approved the Codex-generated five-crew splash and requested the first slice/tutorial on the QA link. Installed approved art without further Flora spend, finished the post-tutorial Dust Lane Patrol and visible Secure/Push route choice, reset ship camera/sheet on tutorial exit, and made the QA fresh-save query one-shot after a read-only reviewer caught repeat-wipe-on-refresh. Independent Grok Chrome packet-only audit accepted the bounded slice but did not inspect the full final diff or run tests. All local test/ship/loop/balance/focused/Pages-build checks passed; isolated Chrome 153 at 390×844, 360×800, and reduced motion captured 33 screens and confirmed tutorial completion/reload, with one normal seeded pirate fight won and claimed. Published Pages `gh-pages@b487113` from source `07ebcac`; Pages run 35961514645 succeeded and live build marker/JS/splash hashes matched. Real phone/Jest sign-in remain unknown; no PR merge or Jest activation.
