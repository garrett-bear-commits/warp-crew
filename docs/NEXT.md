# Warp Crew next-work checklist

Last updated: 2026-09-23
Reviewed gameplay baseline: `9b9585ea794120696913216a2763c563a4ba7753`

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
