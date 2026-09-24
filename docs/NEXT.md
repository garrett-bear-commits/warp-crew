# Warp Crew next-work checklist

Last updated: 2026-09-24
Reviewed gameplay baseline: `9b9585ea794120696913216a2763c563a4ba7753`

## 2026-09-24 trader distress polish — Pages QA live

- [x] On source `83aa1b2064f8cb8cd1c6d6782671a283942d54b4`, dismiss the camera hint after a real pan plus zoom (pinch or control), and keep it dismissed through a same-tab reload. Replace the floating trader glyph/pirate with one illustrated distress transmission and Intercept button. One trader sprite generation; no retries. Local browser checks passed at 390×844 and 360×800; the full test suites and Pages build passed.
- [x] Publish mock-only QA `gh-pages@5fb440ca712cd031dd0be342dc4b472bdf095442`. [Pages run 36069338677](https://github.com/garrett-bear-commits/warp-crew/actions/runs/36069338677) succeeded. Live build marker names the source; served index, JS, CSS, and trader sprite hashes match the local build. [Test the QA build](https://garrett-bear-commits.github.io/warp-crew/?fresh=1) in a separate browser/profile if the current browser save matters; `?fresh=1` intentionally clears it once.
- [x] Garrett clarified that the existing Jest staging version hosts the GitHub Pages QA URL; no new Jest upload is needed for Pages changes. The `versionId=01a0babc-fbc1-7578-97fb-92d9c3a06980` preview was checked after the Pages publish and its game iframe loaded `garrett-bear-commits.github.io/warp-crew/`. That verifies the staging source URL, not a fresh Jest sandbox-user playthrough of this polish.
- [ ] Test the updated flow inside the Jest staging preview with a sandbox user, including camera gesture dismissal and the trader distress card. Do not activate Jest production or merge PR #1 without Garrett's explicit approval.

## Captain-first package — Pages QA live

- [x] Run the final local source-bound `af50be5` script-5 first-play, saved script-4 Brace, next normal pirate job, in-progress and completed reload, five corrupt guided-claim retries, corrupt fight/contract, missing-hire recovery, and duplicate welcome-history guard in isolated Chrome at 390×844, 360×800, and 390×844 reduced motion. [Evidence and limits](qa/2026-09-24-captain-first-play-qa.md). The `?fresh=1` link clears once; refreshing after the first hire preserves progress. The served `/qa.html` matches the captain-first checklist. The superseding report has 84 captures and SHA-256 `87f0b3b3ee4005b26055a216059d710bfb15e141fd64d2ba3ab12c8fdc3b2ae0`.
- [x] Final artifact provenance: source `af50be5ed14365fa66e5d2f6752434ff86ffdccb`; local and live Pages `index.html` SHA-256 `b8a638ce94a6c8a915e1cd5456cdcee0d295b478b38fe1f0fc09ee6fcac65a56`, `qa.html` `2f2e4f352d525d1be42e0069a2b9c6a18ea536e61d1d79098a77d9516923ead3`, JS `b51eec0d84f19d10006aca08857f726d4e7cbe4192e2931bf429f55b755b59ce`, CSS `7e594d0a2408b78ea1f8f7fef52bd6a2431e411299238b0464f5fd0559e3f735`.
- [x] Fix and regress the v5 corrupt-fight and malformed-contract double fuel charge, missing first-hire dead end, duplicate welcome pull, and normal-fight 18px threat copy. Distinct static alien/droid markers resolve the generic cyan fallback, but not final nonhuman walking art.
- [x] Complete the bounded source audit and resolve its four reproduced findings. Grok's subscription CLI returned no substantive verdict after the permitted retry; an independent Codex audit requested changes, then accepted the scoped repairs. [Audit and limits](audits/2026-09-24-captain-first-play-audit.md).
- [x] Publish the provenance-checked mock-only Pages QA build at `gh-pages@f3b0abdf1b211fdcbe2cdca2f2a0ccbfb0e91c69` from source `af50be5ed14365fa66e5d2f6752434ff86ffdccb`. GitHub Pages [run 36051255221](https://github.com/garrett-bear-commits/warp-crew/actions/runs/36051255221) succeeded 2026-09-24. Live `build.txt`, index, QA hub, JS, CSS, splash, and pirate hashes matched the tested build. An isolated public `?fresh=1` smoke completed captain choice, hire, assignment, pirate rescue, claim, ship name, free pull, and skip; normal reload retained three crew, one claim, one pull, and 200 credits. [Play the QA build](https://garrett-bear-commits.github.io/warp-crew/?fresh=1). This is not Jest or physical-device acceptance.
- [ ] Get Garrett's physical iPhone and Android play/readability pass. Local Chrome emulation is not device acceptance.
- [ ] Finish reviewing distinct alien/droid movement art; the current static markers are an honest partial art state.

## Tomorrow — verify first

- [x] Open the GitHub Pages fresh-save link and confirm the deployed build shows the Contract Board tutorial rather than an older Grok build.
- [x] Record the Pages deployment commit/time in the stopping-point handoff.
- [x] Publish and live-smoke the updated GitHub Pages QA game build at `gh-pages@d0e72f0` from package source `47fb6e5` (2026-09-23). Use the direct game link; the QA hub checklist still describes an older flow.
- [x] Publish the living-ship first-play slice at `gh-pages@b487113` from source `07ebcac` (2026-09-23), and verify live build marker, JavaScript, and approved splash hashes. The [QA game](https://garrett-bear-commits.github.io/warp-crew/) and [QA checklist](https://garrett-bear-commits.github.io/warp-crew/qa.html) now describe this slice; `?fresh=1` wipes the current browser save once.
- [ ] Run one real iPhone pass and one real Android pass; attach screenshots or recordings and device/OS details.
- [ ] Garrett: play the new Pages fresh-save tutorial on a separate browser/profile and report the first confusing or dull moment, fight feel, crew/station legibility, and whether the next job is obvious. Pages sign-in and purchases are mock previews, not Jest verification.
- [ ] Check safe areas, scrolling, 44px targets, 16px consequence text, focus, reduced motion, and frame pacing on those devices.
- [ ] Log any device failure as a reproducible issue before changing layout.

## Next design decisions

- [x] Approve and implement encounter tells and recommended orders for all 16 current encounters (2026-09-22 package; scoped audits and local QA below).
- [x] Approve and implement literal current contract reward-band presentation, without approving balance values.
- [ ] Approve fair monetization invariants: earnable functional power, acceleration/fuel/attempts/convenience/cosmetics, and subscription stance.
- [ ] Approve source/sink targets and free/light/high-spender assumptions for the economy simulator.
- [ ] Choose the next art package: alien/robot movement families or Sparrow/hull visual transformation.

## Next implementation candidates

- [x] **Selected and implemented 2026-09-22:** encounter-tell roster, literal reward bands, 192-row balance matrix, and 15 deterministic 30-day free-player runs. [Approved design](superpowers/specs/2026-09-22-encounter-intelligence-balance-evidence-design.md), [runtime and economy evidence](qa/2026-09-22-encounter-balance-evidence.md), [bounded Grok audit](audits/2026-09-22-encounter-balance-implementation-audit.md). This does not approve economy balance or production release.
- [ ] **Proposed next package, owner approval required:** classify the simulator's `reward_unavailable`/non-useful days against actual crew availability, then run one real iPhone and one real Android short-session pass with recordings, timings, touch/focus/safe-area checks, and player-comprehension notes. Agree daily useful-session and source/sink target bands before any numeric tuning. Do not broaden it into monetization or art generation.
- [ ] Physical-device fixes found by the verification pass.
- [ ] Distinct alien/robot body families using the approved Ninefold crop/anchor contract.
- [ ] Additional ships/hulls, visible room upgrades, and long-horizon progression surfaces.
- [ ] Lore delivery through short transmissions, crew reactions, discoveries, and optional dossiers.
- [ ] Monetization implementation only after authority, recovery, fairness, and simulation specs are approved.

## Overhaul operating rules — 2026-09-22

- Work toward a visually exceptional living-starship game with a satisfying five-to-ten-minute core loop, worthwhile optional check-ins, slow long-term progression, a rewarding meta, and strong fair monetization.
- Keep work in bounded packages with explicit design, tests, phone-sized evidence, and separate review surfaces.
- Request read-only Grok subscription audits at meaningful code milestones: the first complete package diff and the final review candidate. Codex owns integration and verification.
- For approved art/UI packages, use Flora GPT Image 2.5 where it fits. Record prompt, model, references, output identity, cost, disposition, and installed path before any retry.
- After a timeout or uncertain response, audit recent Flora outputs. Never rerun an identical generation until the prior attempt is proven absent or unusable.
- Set a package generation count and spend cap before generation. Prefer one deliberate batch, reuse approved source assets, and stop for review before expanding variants.
- Do not let monetization compensate for an unfun loop. Instrument and simulate free play first; approve fairness, authority, recovery, and source/sink assumptions before paid value.
- Draft PR #1 remains unmerged and Jest production remains inactive without Garrett's explicit approval.

## Do not claim yet

- [ ] Real-device readiness.
- [ ] Balanced 5–10 minute daily pacing.
- [ ] Economy or monetization approval.
- [ ] Secure paid value or cross-device recovery.
- [ ] Complete encounter content, body-family art, ship roster, lore, or evergreen meta.
- [ ] Jest production release or activation.
