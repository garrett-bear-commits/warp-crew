# Warp Crew next-work checklist

Last updated: 2026-10-09

## Where things are (2026-10-09)

- **Work on `main`.** The game-core port was merged into `main` on 2026-10-09 (owner approved). The game is in `apps/warpcrew/`; the core is everything else. Start with [HANDOFF.md](HANDOFF.md).
- **Port status:** stages 1 (import), 2 (server) and 3 (client) are done and Luna-audited ([game-core-port.md](game-core-port.md)); stage 4 (staging and cut-over) is next, below.
- **QA build:** [GitHub Pages](https://garrett-bear-commits.github.io/warp-crew/), offline with mock purchases. Its `build.txt` names the source commit; publish steps are in HANDOFF.md.
- `claude/hud-overhaul` is the frozen pre-port layout; other `claude/*` and `codex/*` branches are merged history.
- **No real players yet:** Garrett is the only playtester, so the cut-over starts from a fresh database (no data migration).

## 2026-10-09 deep dive and the "kick-ass" overhaul (branch `claude/blissful-ptolemy-wxopwr`)

Garrett approved the [deep dive and roadmap](design/21-deep-dive-2026-10-09.md) on 2026-10-09. His answers:
- fairness rule kept (open to recs);
- real-time fights plus an auto-win for cleared fights;
- art: high-quality stylized retro pixel art, mockup first (one ship, one portrait), using his **personal** Flora account (never textclub), GPT Image 2.5 at low resolution;
- music: Creative Commons space synth;
- Jest: gacha allowed (18+), show odds, no rewarded ads, one text notification a day, in-app notices are fine;
- social later if Jest retains and monetizes;
- universe: open to suggestions;
- no launch date;
- staging (stage 4) waits.

**Done (pushed or local, see git log):**

- [x] Step 0:
  - re-keyed the 8 pink portraits (regression test);
  - captains out of the hire pool;
  - one game day at local midnight (DST-safe);
  - developer text out of player copy, and the roadmap board removed;
  - Warp Crew suites and the QA build in CI, with a stale-evidence gate.
- [x] [Universe proposal](design/22-universe-proposal.md) and the [art mockup brief](art/2026-10-09-style-mockup-brief.md).
- [x] [Crew-matter design](superpowers/specs/2026-10-09-crew-matter-design.md), step 1 (engine):
  - kits for all 50 mercs;
  - real passives;
  - Auto;
  - tougher kit-fight enemies;
  - the validator.
- [x] Step 2 (fight UI): move buttons, the Auto toggle, the cast banner, CRIT pops.
- [x] Step 4: level caps by stars, shards, Ascension.
- [x] Step 5:
  - the Between Jobs featured banner, rotating every 14 days, with a 50/50 and a guarantee;
  - Contract Marks;
  - the odds sheet;
  - a rarity cap (Legendary or better at most 3%);
  - seeded hires;
  - the pod reveal and the 10-hire grid;
  - a reserve of 24 that never sells a rarer hire.
- [x] Independent review of the kit engine: 10 findings, all fixed under `test/crew_kits_audit.test.mjs` ([report](audits/2026-10-09-crew-kits-review.md)).
- [x] Dossier: the move, quote and bio are shown, and the squeezed header is fixed.
- [x] Step 6, families: two or four of a family aboard give a fight bonus (`src/data/families.js`).
- [x] Art mockup round 1 on Garrett's personal Flora account ($0.33): three directions each for Kira Nyx and the
  Sparrow, snapped to a real pixel grid by `scripts/pixel-snap.py` ([ledger](art/2026-10-09-style-mockup-ledger.md),
  contact sheets in `art/outputs/mockup-2026-10-09/`).
- [x] Music: four CC0 space-synth tracks (MintoDog, Synth-thetic), one per scene (ship, star map, fight, Siege
  wall), crossfading, with a Music switch in Log > Settings ([credits](../public/audio/music/LICENSE.md)).

**Next:**

- [ ] Garrett:
  - pick an art direction from the contact sheets (A HD pixel, B painted pixel, C bold arcade; mixing is fine);
  - listen to the music in the QA build (Log > Settings has the switch);
  - react to the universe proposal;
  - play the QA build: fights with moves, the hire banner and reveal, families.
- [ ] Art round 2 (after the pick): up to 4 images in the chosen direction; cap 10 images and about $5 in all.
- [ ] Step 3, balance:
  - win odds simulated from the real fight on contract cards;
  - wall pools for crews that still stall (some simulated captains now break Veil on arrival, others never);
  - retire the 82% pull-up for kit fights.
- [ ] Phase 2:
  - the universal reward reveal for purchases and chests;
  - a shop redesign;
  - idle income;
  - a 28-day login calendar;
  - daily and weekly chests;
  - achievements.

## 2026-10-05 FTL-lite fights, weapons, sound, Explore

- [x] FTL-lite real-time crew fights (rooms, shields, fires, crew moves, boarders, Overcharge/Board/Rally), guided first fight, fight camera and off-screen fire alerts.
- [x] Sparrow v4 ship art with furniture pathing; six enemy faction cutaways with enemy crew figures.
- [x] Drydock upgrades change fights (shield layers at Shields 6/10, weapon slots at Weapons 4/8, charge, dodge, aim). Weapons-room armory: Ion Blast 650cr, Leto Missile 800cr, Pike Beam 950cr. Flagship and enemy tiers. Luna audit fixed.
- [x] Kenney CC0 sound effects (35 sounds, 222 KB) with a Sound toggle in Log > Settings.
- [x] Drag crew onto rooms; one-time Explore map nudge for new captains; the 30-day simulator travels the map.
- [x] Balance: Explore events pay 60% credits; first Siege wall pool 100 (falls day 3–4 for every simulated captain).
- [x] [Jest console product list](jest-console-products.md) prepared (11 packs + subscription, staging game only).
- [ ] Garrett: listen to the sounds on the QA build (enemy laser vs ours, extinguisher hiss, engine drone on launch/jump, mix levels).
- [ ] Garrett: phone play of the QA build: fights, armory, drag, Explore nudge.
- [ ] Ambitious simulated captains still earn ~48% of credits from Explore; trim further if real play agrees.
- [ ] Simulated captains don't buy weapons yet, so balance evidence ignores the armory; add once weapon prices settle.
- [ ] Not built: `wc_drydock_2`, welcome-back bundle, sale SKUs; client refund (adjustment) handling.

## Next: staging and cut-over (game-core port stage 4)

- [ ] Garrett: create the 12 products on the **staging** Jest game from [jest-console-products.md](jest-console-products.md); send a screenshot to check.
- [ ] Garrett: paste `JEST_PLAYER_SECRET` into a **new Railway staging service** for the core server (`apps/server`, `GAME_CONFIG=warpcrew`, `GAME_ID`=staging Jest game id, fresh Postgres). Never paste secrets in chat.
- [ ] Garrett: approve `mintSandbox: 'on'` on staging only (recommended) so sandbox purchases grant there; production stays off.
- [ ] Claude: wire the staging service, build the client with `VITE_WARPCREW_SERVER` pointing at it, add a startup guard refusing sandbox minting in production.
- [ ] Garrett: phone session inside Jest staging: sign in, play, reload, second device (deeper save wins), buy a gem pack and the starter kit (second buy refused), start and cancel the subscription trial. This also confirms Jest receipts carry `price`/`currency` and subscription lists carry `iat`.
- [x] Merge `claude/game-core-port` into `main` (done 2026-10-09).
- [ ] After staging passes: point QA builds at the core server and delete `apps/warpcrew/server`.
- [ ] Real-money sales (`mintPremium: 'on'`) only at launch, with Garrett's approval.
- [ ] Other game-core checkouts (Cairndeep, Wild West Demons) still share the `foundation-postgres` container on 55432; Warp Crew uses `warpcrew-postgres` on 55442.

## 2026-09-26 HUD overhaul + crew rig — local branch, not published

- [x] Remove stray wayfinding squares; align thrusters to the four hull nozzles; rebuild the space backdrop as screen-space parallax with a keyed hero planet.
- [x] Ops-console HUD (status plate, objective plate, crew rail, command bar), whole-ship home camera, always-on room nameplates.
- [x] Dispatch-style contract cards, roster/room-sheet redesign, first-session dialog skin, recruit reveal, combat bolts/sparks, readable Log, folded hull list.
- [x] Slow post-tutorial unlocks: Shop/Log/gems after 2 contracts, Explore after 3.
- [x] Crew on the Ninefold Sunnyside rig, re-baked per frame into human/alien/droid sci-fi families with walk/idle/work loops. [QA record](qa/2026-09-26-hud-overhaul.md).
- [ ] Garrett: review crew art and HUD on a phone; decide whether to fund a painted per-frame reskin pass (needs a spend cap).
- [x] Fight pacing: tutorial fight ~15–20 s, contract fights 30–60 s; every contract fight is a real-time crew fight with threat-scaled damage and salvage on loss. [Record](qa/2026-09-26-hud-overhaul.md#2026-09-27-fight-pacing-and-crew-fight-conversion).
- [x] Burn and Board restored as crew-fight initiative orders (unlock after 3 and 5 contracts). Captain always stays aboard; Away picker shows combat power before/after launch and unstaffed stations; contract review shows fight threat with crew aboard.
- [x] Garrett approved the [combat walls, retention and boarding](superpowers/specs/2026-09-27-combat-walls-retention-design.md) proposals (2026-09-27).
- [x] Enemy boarders (Scrapper Gang, Ice Raiders, Corsair King; unlock after 8 contracts): warning, landing, sabotage, Repel boarders with a walking defender and red raider sprites. Repelled boarders are win-rate neutral; ignored ones cost ~25 points.
- [x] One-time New Captain's Kit: first loss or third post-tutorial contract, 48 h real window, pop-up then Shop card, truthful live-price saving. Contents 250 gems / 10 fuel / 50 medals / 800 credits pending sign-off.
- [x] Superseded: the SKU list changed; see [jest-console-products.md](jest-console-products.md).
- [x] Siege walls: five sector flagships gate the next sector for guided-flow captains; per-attempt 42-hull segments of a 100–240 pool at threat ≥1.2; damage holds until local daily reset; takedown pays double + 20 gems and opens the gate.
- [x] Timed drydock upgrades above level 3 (30m → 8h cap), gem skip (~10/h, min 5), completion notification.
- [x] Product prices handled as Jest cents.
- [x] [Monetization plan](superpowers/specs/2026-09-27-monetization-plan.md) approved; step 2 built: gem ladder SKUs, one-time starter kit + wall packs, Rally (first free, then 60 gems), gem fuel refill (50 → 5), drydock tokens.
- [x] Verified purchase authority (idempotent server grants) and cloud save — built (legacy server, now ported to game-core). Creating the SKUs in the Jest console is in "Next: staging and cut-over" above.
- [x] Subscription built (7-day trial → $9.99/mo, cancel-save $5.99/mo × 2); the simulator models wall attempts and gem sinks. Still not built: `wc_drydock_2`, welcome-back bundle, sale SKUs.
- [ ] Previously: decide the remaining proposals in [combat walls, retention and boarding](superpowers/specs/2026-09-27-combat-walls-retention-design.md) (daily rhythm, Siege walls, timed upgrades, enemy boarders next, purchase authority first). Explore-map travel fights are still on the old order menu.
- [x] Pages QA publishing approved by Garrett; `claude/hud-overhaul` is pushed.

## 2026-09-25 QA save restart — Pages QA live

- [x] Add `Log → Settings → Restart save` after the first-play tutorial. Confirmation explains that browser progress is erased, the Jest account remains signed in, and the action cannot be undone. Remove the old one-tap Shop reset. Mid-tutorial QA can still use `?fresh=1` in an isolated browser/profile.
- [x] Test the confirmation's cancel and erase paths in a local browser play-through; erase returned to the splash and fresh captain choice. `npm test`, `test:loop`, `test:ship`, `test:first-play`, camera-input test, and `build:pages` passed on source `93106b42ce58bb9a55e645829aa30641f618ca91`.
- [x] Publish mock-only `gh-pages@aa00ddd83c15b62907c24e15b27dfaf4eed8714c`; [Pages run 36165035051](https://github.com/garrett-bear-commits/warp-crew/actions/runs/36165035051) succeeded. Live build marker, index, and JS hashes matched the tested build. The existing [Jest staging preview](https://jest.com/g/warp-crew?versionId=01a0babc-fbc1-7578-97fb-92d9c3a06980&rl=734c6e) loaded the Pages iframe and visibly showed the new Settings option.
- [ ] Garrett: exercise the restart in a disposable Jest sandbox save, then do the next phone QA pass. We did not erase the existing Jest sandbox save or test on a physical device. Do not merge PR #1 or activate Jest production without explicit approval.

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
