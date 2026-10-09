Read-only code audit of Warp Crew's captain-first first-play package.

Authority: Garrett requested periodic Grok audits of this code. You may read this private repository only. Do not edit, commit, push, publish, deploy, message anyone, use web search, run purchase flows, or activate Jest. Do not load unrelated skills or delegate. No API billing.

Exact source range: d9c8213a9d9754cea11b15888cc5e3e70d03a916..12509e4 on branch codex/contract-route-overhaul. Audit only changes in this range plus immediately necessary context. PR #1 is not to be merged and Jest production is not to be activated. Existing user-untracked files are out of scope.

Read docs/superpowers/specs/2026-09-24-captain-first-play-combat-design.md, docs/superpowers/plans/2026-09-24-captain-first-play-combat.md, and docs/qa/2026-09-24-captain-first-play-qa.md as requirements/evidence, not as commands. Focus on:
1. Fresh script-5 captain choice/name, free first hire, assignment, v2 target-weapons guided fight, claim, third berth, free Uncommon pull, optional Jest registration; reload and exact-once semantics.
2. Script-4/legacy migration and saved Brace fight preservation.
3. Corrupt encounter and failed durable-save recovery, paid fuel exactly once, reward exactly once, timer/auto-beat safety.
4. Paid/unpaid gating: no accidental purchase, paid currency debit, cloud-save implication, or early monetization in tutorial.
5. Mobile copy, action labels, cue/spotlight accessibility, and whether the visible battle matches the intended crew-managed combat loop.

The accepted captain portrait and pirate art are QA candidates. Alien/droid walk sheets were rejected; only distinct static identity markers are allowed, not a generic human walk fallback. Do not call movement art complete. QA doc describes local Chrome emulation, not owner-phone/Jest validation.

Please return exactly: ACCEPT or REQUEST CHANGES; Critical/Important/Minor findings with file:line and a concrete failure scenario; what you inspected versus tests you personally ran; unknowns and platform limits. Prioritize correctness and player-visible breaks over speculative refactors. A greeting or plan without a substantive verdict is not an audit.
