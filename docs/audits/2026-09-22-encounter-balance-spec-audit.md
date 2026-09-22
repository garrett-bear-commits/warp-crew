# Encounter balance package — Grok spec audit

Date: 2026-09-22

Target: `docs/superpowers/specs/2026-09-22-encounter-intelligence-balance-evidence-design.md` at `1fa493d`

## Provenance

The first read-only Grok subscription-CLI run inspected the repository directly but stayed live without a substantive verdict and was stopped. It is not review evidence.

The single fallback used a self-contained, in-band evidence packet in a fresh temporary directory with tool/skill loading forbidden. Grok returned `REQUEST CHANGES`. It did not inspect the repository directly, run tests/builds, use a browser, view screenshots, or use network research. Codex verified every finding against the current checkout before editing the spec.

## Accepted findings

- Route identity is saved, but cargo, weapons, reputation, ready crew, visit count, and other payout modifiers are live. The spec now labels the range `Possible payout now`, recomputes it before resolution, and shows only the stored result afterward.
- Burn's +12 power may not raise a chance already capped at 94%. Board's 1.25 multiplier is floored and is not universally 25% more. The authored copy now states the actual mechanism instead of universal outcome claims.
- Reward-band enumeration must share extracted production payout helpers, not transcribe 1.25/0.22/0.25 into a second formula.
- Deterministic simulation needs injected time/RNG across player and crew creation, acceptance, injuries, elapsed analytics, expedition progress, and day logic. It must not use `forceComplete`.
- A currently executable band must exclude disabled orders.
- The balance matrix must use the production contract preview path, including rubber-banding and the chance cap.
- “Literal” applies to currency payout only; XP and consequences remain separate facts.

## Rejected findings after source verification

- Tutorial victory is not merely implied by Brace-only preview. `resolveContractCombat` passes `tutorialGuaranteed` for the distress profile, and `resolveCombat` forces success with the fixed tutorial payout.
- Ship improvement is not a simulator-only invention. Production exposes `nextUpgradeCost` and `upgradeSystem`, and `sessionAction` uses `upgradeSystem`. The revised spec names those transitions and forbids a parallel buyer.

## Authority boundary

This audit and reconciliation do not approve implementation, balance tuning, PR #1 merge, Pages publication, Jest upload, or Jest production activation.
