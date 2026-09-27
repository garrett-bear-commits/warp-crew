# Captain-first first-play audit and Pages QA gate

Date: 2026-09-24. This is a **mock-platform Pages QA** decision, not Jest production approval or PR #1 merge approval.

## Exact scope and disposition

- Runtime source reviewed: `d9c8213a9d9754cea11b15888cc5e3e70d03a916..af50be5ed14365fa66e5d2f6752434ff86ffdccb` on `codex/contract-route-overhaul`. The replacement Pages source is `af50be5ed14365fa66e5d2f6752434ff86ffdccb`; QA harness/evidence then advanced to `e7740ee7594fb3d8f053d995a653ce742f855f2b` without further production-source changes.
- Initial independent Codex read-only source audit: **REQUEST CHANGES**. It reproduced malformed v5 contract double-fuel, missing-first-hire onboarding dead-end, a second welcome pull after corrupt flags, and anonymous alien/droid ship markers.
- Repair `867c142` re-review: **ACCEPT for those four findings**. Repros now keep paid launch fuel at 7 on retry, restore one free-hire path or reconnect the saved recruit, reject a repeated welcome pull from recorded `source: 'welcome'` history, and draw distinct portrait-backed alien/droid markers. Focused v5/v4/art and ship tests passed in the re-review. Accepted nonhuman walk sheets are still absent; the markers are explicitly interim.
- Subsequent final-branch review found a saved script-5 guided win could become stuck at `claim` after corrupt rewards or encounter data. Fixes `8ba8aa6`, `b090f7d`, and `af50be5` cover malformed rewards, missing/outdated encounter, mismatched guided IDs, and an entirely missing contract. An independent recovery re-review at `af50be5` returned **READY for mock Pages QA**, with 41 focused passing tests, including saved script-4 behavior and no double fuel or payout. The superseding local Chrome matrix binds `af50be5` to 84 captures and five claim-corruption retries; its report SHA-256 is `87f0b3b3ee4005b26055a216059d710bfb15e141fd64d2ba3ab12c8fdc3b2ae0`. See [QA evidence](../qa/2026-09-24-captain-first-play-qa.md).

## Grok subscription audit availability

Garrett requested occasional Grok review. I used the read-only subscription CLI wrapper, no API key/billing, with the exact source range and explicit no-edit/no-publish scope. `grok inspect --json` reported CLI 1.0.13 and no project instructions. The sandboxed call failed before a session because DNS and session-file permissions were unavailable. One scoped elevated retry exited 0 but returned only an opening plan, not findings or a verdict. Under the delegation skill's retry limit, **Grok is unavailable for this package**; it did not inspect source or approve it. The independent Codex audits above are a labeled substitute, not a Grok result.

## QA-only deployment checklist

- [x] Local first-play, ship, loop, balance, default test, and Pages build gates passed; the final source-bound 84-capture browser matrix is recorded in the QA evidence.
- [x] Independent source re-review accepted the initial four fixes and the later guided-claim recovery; the earlier independent QA evidence review found no new Critical/Important issue. The superseding 84-capture matrix was run after that review and is reported separately.
- [x] No database migration or live Jest purchase/save change is in this Pages package. Pages uses the local/mock platform.
- [x] Built-bundle Chrome checks at 390×844, 360×800, and 390×844 reduced motion completed. This is **not** owner-phone, iOS notch, Android, live Jest, purchase, or comprehension acceptance.
- [x] Bound the exact `dist` hashes and source `af50be5` into Pages `build.txt`, verified the previous remote `gh-pages` tip `be81c77`, and published from an isolated temporary checkout without touching the feature branch or user-untracked files.
- [x] GitHub Pages [run 36051255221](https://github.com/garrett-bear-commits/warp-crew/actions/runs/36051255221) completed successfully for `gh-pages@f3b0abdf1b211fdcbe2cdca2f2a0ccbfb0e91c69`. Live `build.txt`, index, QA hub, JS, CSS, splash, and pirate hashes matched the tested files. An isolated public `?fresh=1` browser smoke completed the captain-first rescue, ship naming, one Uncommon pull, and optional sign-in skip; normal reload kept three crew, one claim, one pull, and 200 credits. No CDN mismatch was observed.
- [ ] Garrett's device playtest and feedback remain open. Do not merge PR #1 or upload/activate Jest production without explicit approval.

## Remaining limits and rollback

One post-repair local browser attempt timed out at the saved-v4 Brace window; its cause was not established. An instrumented full rerun persisted Brace, won, claimed once, and reloaded. Treat this as a watch item in the public QA smoke, not a proven runtime defect. The nonhuman captain walk animation remains a separate art acceptance gap; rejected sheets are preserved but unmapped, and no duplicate generation was run. Static portrait markers permit first-play QA without claiming final animation quality.

The prior live Pages branch tip was `be81c7782551ec98bb25006f28f8b902b929d19f` when checked before the replacement publish. It is superseded because of the claim-recovery defect. If a later QA failure warrants rollback, first verify the exact remote state and choose a known-safe mock QA build; do not restore the superseded claim-defect build by default. Jest production remains untouched.
