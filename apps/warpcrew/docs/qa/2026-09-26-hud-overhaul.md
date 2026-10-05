# HUD overhaul, crew rig and first-session polish (local QA)

Date: 2026-09-26. Branch `claude/hud-overhaul` (local, not pushed). Source reviewed: `ffcd14e6229aefa4a19582e29816af37010b8329`.
Trigger: Garrett's phone recording (UI plain, crew not walking, stray green/yellow squares, busted stars/planet, misaligned thrusters, contracts/text needing design and simplification).

## What changed

| Area | Change | Commit |
| --- | --- | --- |
| Stray squares | `drawWayfinding` painted door ticks and work-anchor markers every frame; removed (debug view still via `?shipDebug=1` in dev). | `7c5c377` |
| Thrusters | Exhaust now starts at four measured nozzle exits (two main bells, two trim) with bloom, plume and core. | `7c5c377` |
| Space backdrop | Screen-space parallax: gradient sky, soft nebula, three streaming star layers (warp streaks on launch), keyed hero planet (old `planet.png` was a quarter crop), full-opacity asteroids; non-square art no longer stretched. | `e275912` |
| HUD | New `src/ui/hudView.js`: pixel icon set, hull/shield segmented plate, location + objective plate, crew rail, command bar with large Contracts action. Whole-ship home camera; always-on counter-scaled room nameplates. | `e275912` |
| Contracts | Dispatch cards: profile banner with ship art, fact tiles, highlighted payout, Favored tag. Approved literal reward wording kept. | `8e3faa3` |
| Slow unlocks | New-flow captains: Ship/Crew/Contracts first; Shop, Log, gems after 2 contracts; Explore after 3. Veterans and anyone holding gems/purchases see all. | `8e3faa3` |
| Crew / rooms | Roster header, Recruit panel with odds drawer, 2x2 station grid; room sheets with output tile, portrait rows, labelled upgrades; camera glides to the selected room. | `1c86131` |
| First session | Step kickers, ops-skinned dialogs, tickers moved off the HUD, combat readout, recruit reveal with rarity ring. | `001ae94` |
| Other screens | Log milestones by name, QA restart last; hull list folded; framed away cards. | `da25def` |
| Combat feel | Travelling three-bolt bursts, sparks, impact flash / shield ripple, hit shake. | `c8e1985` |
| Crew rig | Ninefold Sunnyside rig re-baked per frame into sci-fi human/alien/droid families (50 templates, 150 sheets); 8-frame walk, 9-frame idle, 8-frame work loop. Deterministic, no paid generation. | `64faf69`, `e148462` |

## Verification

- `npm test`, `npm run test:loop`, `npm run test:ship`, `npm run test:first-play`: all pass on `ffcd14e6229aefa4a19582e29816af37010b8329`. `npm run build` succeeds.
- New tests: `test/progressive_unlock.test.mjs`, `test/crew_rig_runtime.test.mjs`; updated crew animation/identity tests.
- Pre-existing: `test/stations.test.mjs` fails identically on untouched code (stale fixture) and is in no npm suite.
- Browser: in-app Chrome pane at 390x844 and 360x800 (emulated). Walked fresh `?fresh=1` first session end to end, post-tutorial home, Contracts, Away, Explore, Crew, room sheet, Shop, Log. Crew art evidence: [contact sheet](artifacts/2026-09-26-crew-rig/contact-sheet.png), [ship](artifacts/2026-09-26-crew-rig/ship-390x844-whole.png).

## Not verified / open

- No physical iPhone/Android pass; no Pages or Jest publish from this branch.
- Crew art needs Garrett's review: helmets can read as grey hair, long hair reads as a bun, work tools are small, alien fin/tendril shapes. The style is still Sunnyside-proportioned, not the painted gritty look of the splash; a hand-painted or AI-assisted per-frame pass would need a spend cap first.
- First fight still resolves in about 1.5 s; pacing is a balance decision, not changed here.
- `public/art/char/walk-4dir.png` is unused and can be removed.

## 2026-09-27 fight pacing and crew-fight conversion

| Change | Commit |
| --- | --- |
| Real-time beats: 4 s guided, 6 s normal; normal fights auto-advance, orders optional; pause when hidden or off the Ship tab; beat bar, volley ETA, ambient crew fire, pirate charge glow. | `040c0c4` |
| Every contract confrontation is a crew fight. Damage = 28 × threat (0.6–1.6, legacy power model), seeded ±30% volley swing, 15% crew crits. Losses settle to the legacy failure salvage. Enemy name, threat label and authored tell shown. Economy simulator plays crew fights. | `3b22583` |

Measured in the local browser (390×844): tutorial fight 15.7 s from Intercept to win (3.2 s reading, then ~4 s beats); Risky Pirate Wing (threat 0.94) 40.6 s hands-off, 7 beats, won at 6 hull.

Calibration (200 seeds, disciplined orders; old dice chance in brackets): threat 1.0 unstaffed 74% (58%), 1.2 57% (50%), 1.6 38% (40%); a gunner on Weapons lifts these to 97%/91%/60%. Fights run 7–9 beats (42–54 s). `test/fight_pacing.test.mjs` pins the 11–17 s guided auto span and the 30–60 s normal band.

Economy evidence regenerated (`npm run test:balance` passes, 15/15 runs conserve). Simulated balanced/ambitious players send crew away before fighting, fight at the 1.6 cap, and win 4/20 and 0/20; their 30-day medals and reputation fall ~10–15% versus the dice model. Needs Garrett's decision (lower cap, warn on depleted crew, or accept).

Not converted: Explore-map travel fights (`combat-order` from a pending jump) still use the order menu and 3.5 s canned battle. Burn and Board orders no longer exist in contract fights.

Update (branch `claude/explore-crew-fights`): Explore-map fights are now crew fights too. A combat jump spends its fuel and opens `player.activeTravelFight` (own `fightId`/revision, validated on load) plus the usual `activeEncounter`; the ship panel, pacing, tactics, boarders and Rally are shared with contracts; the final beat settles with the contract payout (salvage share on loss); "Bring cargo aboard" performs the arrival (location, visit, jump, wallet). The order menu and dice now run only for a pending jump already held in memory. Covered by `test/explore_crew_fight.test.mjs`.
