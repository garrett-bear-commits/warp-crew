# Warp Crew next-work checklist

Last updated: 2026-09-22
Reviewed gameplay baseline: `9b9585ea794120696913216a2763c563a4ba7753`

## Tomorrow — verify first

- [x] Open the GitHub Pages fresh-save link and confirm the deployed build shows the Contract Board tutorial rather than an older Grok build.
- [x] Record the Pages deployment commit/time in the stopping-point handoff.
- [ ] Run one real iPhone pass and one real Android pass; attach screenshots or recordings and device/OS details.
- [ ] Check safe areas, scrolling, 44px targets, 16px consequence text, focus, reduced motion, and frame pacing on those devices.
- [ ] Log any device failure as a reproducible issue before changing layout.

## Next design decisions

- [ ] Approve encounter tells and recommended orders for all 16 current encounters.
- [ ] Approve numeric contract reward-band presentation.
- [ ] Approve fair monetization invariants: earnable functional power, acceleration/fuel/attempts/convenience/cosmetics, and subscription stance.
- [ ] Approve source/sink targets and free/light/high-spender assumptions for the economy simulator.
- [ ] Choose the next art package: alien/robot movement families or Sparrow/hull visual transformation.

## Next implementation candidates

- [ ] **Selected 2026-09-22:** Encounter-tell roster, literal reward bands, balance matrix, and 30-day simulator. Design awaiting owner review: [Encounter intelligence and balance evidence](superpowers/specs/2026-09-22-encounter-intelligence-balance-evidence-design.md).
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
