# Captain-first first-play audit and Pages QA gate

Date: 2026-09-24. This is a **mock-platform Pages QA** decision, not Jest production approval or PR #1 merge approval.

## Exact scope and disposition

- Production source reviewed: `d9c8213a9d9754cea11b15888cc5e3e70d03a916..867c142d90763c40ab9b3fe4e431186a67d56a31` on `codex/contract-route-overhaul`. QA harness/evidence then advanced to `552fa58213958ad68ac08645e7359b8d9991f0c0` without changing production source.
- Initial independent Codex read-only source audit: **REQUEST CHANGES**. It reproduced malformed v5 contract double-fuel, missing-first-hire onboarding dead-end, a second welcome pull after corrupt flags, and anonymous alien/droid ship markers.
- Repair `867c142` re-review: **ACCEPT for those four findings**. Repros now keep paid launch fuel at 7 on retry, restore one free-hire path or reconnect the saved recruit, reject a repeated welcome pull from recorded `source: 'welcome'` history, and draw distinct portrait-backed alien/droid markers. Focused v5/v4/art and ship tests passed in the re-review. Accepted nonhuman walk sheets are still absent; the markers are explicitly interim.
- Final Task 7 QA evidence `552fa58` read-only review: **PASS** for source/build provenance and 64-capture local Chrome matrix. The report binds source `867c142` to locally built and served HTML/JS/CSS SHA-256 hashes and tests the first session, next normal pirate job, v4 Brace, three corrupt-v5 recoveries, reduced motion, controls, spotlight, crew route, and combat feedback. See [QA evidence](../qa/2026-09-24-captain-first-play-qa.md).

## Grok subscription audit availability

Garrett requested occasional Grok review. I used the read-only subscription CLI wrapper, no API key/billing, with the exact source range and explicit no-edit/no-publish scope. `grok inspect --json` reported CLI 1.0.13 and no project instructions. The sandboxed call failed before a session because DNS and session-file permissions were unavailable. One scoped elevated retry exited 0 but returned only an opening plan, not findings or a verdict. Under the delegation skill's retry limit, **Grok is unavailable for this package**; it did not inspect source or approve it. The independent Codex audits above are a labeled substitute, not a Grok result.

## QA-only deployment checklist

- [x] Local first-play, ship, loop, balance, default test, and Pages build gates passed after `867c142`; exact counts, served hashes, and browser results are in the QA evidence record.
- [x] Independent source re-review accepted the four reproduced fixes; independent QA evidence re-review found no new Critical/Important issue.
- [x] No database migration or live Jest purchase/save change is in this Pages package. Pages uses the local/mock platform.
- [x] Built-bundle Chrome checks at 390×844, 360×800, and 390×844 reduced motion completed. This is **not** owner-phone, iOS notch, Android, live Jest, purchase, or comprehension acceptance.
- [ ] Before publishing, bind the exact `dist` hashes and source `867c142` into the Pages `build.txt` and verify the current remote `gh-pages` tip. Publish only from a separate QA deployment checkout; preserve the feature branch and user-untracked files.
- [ ] After publishing, verify the Pages deployment result, fetch live `build.txt`, HTML, JavaScript, CSS, and key art hashes, and complete a live `?fresh=1` smoke. Record the Pages commit/run and any CDN delay.
- [ ] Garrett's device playtest and feedback remain open. Do not merge PR #1 or upload/activate Jest production without explicit approval.

## Remaining limits and rollback

One post-repair local browser attempt timed out at the saved-v4 Brace window; its cause was not established. An instrumented full rerun persisted Brace, won, claimed once, and reloaded. Treat this as a watch item in the public QA smoke, not a proven runtime defect. The nonhuman captain walk animation remains a separate art acceptance gap; rejected sheets are preserved but unmapped, and no duplicate generation was run. Static portrait markers permit first-play QA without claiming final animation quality.

The prior live Pages branch tip was `b487113f9ee003f67c261027d0ae4e1d1b3c82b0` when checked before this publish. If the QA update fails the live smoke, stop sharing the new build and restore that known Pages tip after verifying the exact remote state. This rollback concerns the public mock QA site only; Jest production remains untouched.
