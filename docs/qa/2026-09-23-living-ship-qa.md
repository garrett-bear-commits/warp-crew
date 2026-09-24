# Living-ship vertical-slice QA — in progress

This record separates local code/browser evidence from owner phone QA and any published Jest build. The feature branch is `codex/contract-route-overhaul`; current reviewed source HEAD is `454495f` (the v4 fuel-retry recovery fix). The previous public GitHub Pages QA build documented in `docs/handoffs/2026-09-21-stopping-point.md` is older and does **not** contain this slice. No PR merge or Jest production activation is part of this record.

## Local regression, 2026-09-23

At `b0e1b19` before the narrow recovery fix, root ran `npm test`, `npm run test:ship`, `npm run test:loop`, `npm run test:balance`, and `npm run build`: all exited 0. The production bundle was `index-C-m8Rsc1.js` (SHA-256 `c613bbeefd4a5b054f67d5ab9afcb46fb7dd576fb762df106ea73436e4595f63`) and `index-CKDAKRM3.css` (SHA-256 `7a0930d2e780ecb3bb22d7b50151b1710377727aa48eb3e85e6ec2275c748d08`). Root also ran all nine focused tutorial, encounter, camera, manifest, and copy test files; each exited 0. The historical 30-day economy report still uses an explicit script-3 starting fixture, so it is not evidence for v4 retention/economy.

The `454495f` implementer observed a RED regression before the fix: a malformed saved guided encounter charged launch fuel again on retry (6 rather than 7 fuel remaining). After the fix, `node --test test/tutorial_v4_session.test.mjs test/encounter_session.test.mjs test/final_review.test.mjs` passed 36/36; `npm test`, `npm run test:loop`, and `npm run build` passed. An independent reviewer reproduced the parent failure, verified five corruption/reload/retry cycles and exactly-once reward claim, reran focused tests 21/21, and approved the narrow change.

Root reran the full local matrix at `454495f`: `npm test`, `npm run test:ship`, `npm run test:loop`, `npm run test:balance`, and `npm run build` all exited 0. That build emitted `index-BJN5pX6L.js` (SHA-256 `8ec3676ce70e876f5253d376892e3a7a750feb75f99b4af77bd2545fd6d35ea1`) and `index-CKDAKRM3.css` (SHA-256 `7a0930d2e780ecb3bb22d7b50151b1710377727aa48eb3e85e6ec2275c748d08`). This is a local build, not an uploaded or served artifact.

## External read-only code review

Grok CLI could not connect in this sandbox, so Chrome was used for a **packet-only** review of selected `encounterState.js` and `tutorialV4.js` excerpts. It returned `REQUEST CHANGES` at [the audit chat](https://grok.com/c/1e78d077-dc83-4d2e-9fcc-58f8b77289f3), but did not inspect the full repository or run tests. Local follow-up found:

- Editable local-save flags can force the welcome pull without playing, but the ordinary session/UI path remains gated; there is no server-authoritative welcome economy in this checkout. This is a local-save trust limitation, not verified remote minting.
- An invalid v4 encounter clears contract and encounter but leaves the tutorial fight retryable; Grok's “stranded” claim did not reproduce. A real paid-fuel retry edge did reproduce and is fixed in `454495f`.
- Two calls against the same pure pre-pull object produce alternative next states, not two additive persisted grants. Synchronous save/publication and the phase guard reject a second ordinary UI pull. Save editing can reroll one of three fixed Uncommons; it does not establish a remote tier/pity exploit.
- A completed v4 tutorial's normal generated board has no distress offer; ordinary acceptance rejects a resolved distress offer. Grok's repeated fight claim did not reproduce.

These dispositions apply only to the local code and test paths inspected. Jest platform persistence and purchased pulls are outside this audit.

## Mobile design audit

The supplied `mobile-game-design-basics-v11.zip` SHA-256 matched `b83b3fa3e5f7ef1a3a278c335fa26b8f37f919fe84a903e7cc556969e8700760`. Its static scripts ran against the one project stylesheet, `src/ui/style.css`. `audit_css.py` reported 11 distinct pixel font sizes (3 on the rubric's five-size scale), 21 declarations below 16px, 158/243 spacing values off its 8px grid, 6 `:active` rules, and 5 scaled transforms. These are inspection targets, not automatic defects: some small values draw pixel detail rather than player text. `contrast.py --pairs` reported 1 PASS and 22 UNCHECKED, but failed to parse all 31 `:root` tokens, so it cannot establish actual contrast. Rendered phone-size and grayscale inspection is still required.

The [standalone source mockup](mockups/2026-09-23-mobile-visual-audit.html) pairs the existing 390×844 splash and ship captures with proposed crew-led splash and clearer HUD/tutorial layouts. It proposes a backed logo, boxed fuel/credits/hull stats, a complete location label, visible Shields/Bolt marker, and one amber action. The proposal itself could not be rendered through the available browser policy and is therefore **not** after-screenshot proof. Existing before captures were visually inspected; grayscale separation, the 22 unchecked contrast pairs, five scaled subtrees, and physical-device behavior remain unverified. None of these suggested UI changes is approved for production merely by running the rubric.

## Local browser journey

At `454495f`, a fresh local `?fresh=1` browser pass completed the script-4 journey: full-screen splash and 100% essential preload → Board ship → assign Bolt to Shields → Answer call (fuel 8/10→7/10) → Brace at the telegraphed hull volley (Shield 12→10; Pirate 20→15) → Continue fight to a Pirate 0/Hull 30 win → Bring cargo aboard (credits 80→200) → name `QA Comet` → one guaranteed-Uncommon welcome draw (Tink) → Continue to ship via the local preview's honest unavailable-Jest/Skip path. Crew showed 3/3 and Bolt still at Shields. A normal reload preserved completion and opened the Ship/Next job view. On-screen +/− controls visibly changed ship scale. This is scripted browser evidence, not unprompted comprehension, physical-phone input, or live Jest registration. A stopwatch time to first win was not captured.

The browser surface was 1728×864 with a centered roughly 430px game; phone viewport captures and reduced-motion emulation were not obtained in that pass. On the post-completion reload, the browser accessibility tree showed blank names for visible Focus/+/- camera controls despite their named first-session tree; source markup carries explicit `aria-label` values, so this needs repeat host/screen-reader inspection before a claim.

The QA agent used `?fresh=1` in the Chrome profile on the local Vite origin `http://127.0.0.1:5173`, after seeing an in-progress encounter there. This query clears that origin's localStorage save. The prior save was not backed up, its provenance is unknown, and sandbox read access to Chrome profile storage was denied; recoverability is unknown. The synthetic QA save now occupies that origin. No public Pages or Jest save was touched, and no further browser resets were performed. Future fresh-save QA must use an isolated browser profile/context and preserve any existing save first.

## Art provenance and gate

The approved six-output Flora estimate was US$0.33222 with a US$0.50 hard cap. The first high/2K/9:16 splash run `run_m17315921cwcfemzd770esspk58f1v76` actually cost US$0.113. A similar six-output batch would cost about US$0.678, so further generations were halted and a new cap decision requested. The original 1440×2560 PNG is preserved at `docs/art/outputs/splash-run_m17315921cwcfemzd770esspk58f1v76.png` (SHA-256 `751487688a492cc8836b599b1e9364a1af6ceb14abee02d512a95eb066de2873`); it is not in the public runtime directory, wired into the manifest, or approved as final art yet. See `docs/art/2026-09-23-vertical-slice-ledger.md` for the exact prompt, model, ID, output, and cost.

## Not yet verified

- Time to first win and an unprompted next-job comprehension observation. The scripted fresh script-4 browser playthrough itself completed at `454495f`.
- Interrupted script-4 saves at every phase, active/completed script-3 and veteran saves in a browser; unit tests cover model transitions, not all host behavior.
- 360×800 and 390×844 screen captures after the final visual integration, plus true-size crew and station legibility, grayscale/gradient/translucent contrast, scaled text, and camera gestures during combat.
- Real iPhone Safari and Android Chrome/Jest-host passes, including pinch capture, safe areas, reduced motion, sign-in overlay, and save reload.
- Inactive QA artifact publication/served-byte verification at the final commit. No Jest production activation, paid-product activation, or PR #1 merge.
