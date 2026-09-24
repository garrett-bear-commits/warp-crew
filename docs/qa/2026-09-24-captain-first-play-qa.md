# Captain-first first-play QA (local Pages preview)

Date: 2026-09-24. Scope: Task 7 Steps 1–3 of the [implementation plan](../superpowers/plans/2026-09-24-captain-first-play-combat.md). This is local mock-platform browser evidence. The independent audit and Pages publish are separate gates.

## Source and artifact provenance

- Starting source HEAD: `c310be675b2709a8ca728825daee0dbe68f9f5df` on `codex/contract-route-overhaul`. Task 7 changes in this QA pass: `scripts/living-ship-qa.mjs`, `package.json`, `src/systems/encounterState.js`, `src/ui/style.css`, `test/tutorial_v5_session.test.mjs`, and this documentation. Final task commit: pending at document creation.
- Built with `npm run build:pages` (Vite 6.4.3; 66 modules) and served by `npm run preview` at `http://127.0.0.1:4173/`. The production Pages build is local; no public QA site was updated.
- Built SHA-256: `dist/index.html` `2fec2a8d59ec6ce124e1d3d947e853d83d96ea6449be41cd2590754f20e19447`; `dist/assets/index-CyO8RawR.js` `d4b17b3d7380ed42378fc9eea0f35fd46bb7338b36d75031f7f3ae75572681cf`; `dist/assets/index-ChUziMeb.css` `7e594d0a2408b78ea1f8f7fef52bd6a2431e411299238b0464f5fd0559e3f735`.
- Isolated headless Chrome `153.0.8010.53`, mobile device emulation at 390×844, 360×800, and 390×844 with `prefers-reduced-motion: reduce`. A separate local Chrome profile and fresh DevTools targets held the synthetic saves. The machine's ordinary profile and the public Pages origin were not touched.
- [Machine-readable Chrome report](../../.superpowers/sdd/2026-09-24-captain-first-play-combat/captures/captain-first-play-qa.json) (SHA-256 `555d37466a7674ac6a21d2dcc42c52d985141007d775aa3b92b656e3920d8935`) and 51 phase-specific PNG captures live beside it. They are ignored scratch artifacts, available in this workspace, and are not part of the source commit.

## Test gates

| Command | Result |
| --- | --- |
| `npm run test:first-play` | Passed: 9 focused files, 0 failures, including `guided_beat_scheduler` and `qa_fresh_start`; the Node TAP files report 39 passing cases. |
| `npm run test:ship` | Passed: 5 files, 0 failures. |
| `npm run test:loop` | Passed: 14 files, 0 failures; `final_review` reports 15 passing cases. |
| `npm run test:balance` | Passed: 6 test files and 2 report commands, 0 failures; 192 encounter rows, 0 disabled, 15 reconciled 30-day runs. Its generated economy JSON contains only new nullable captain fields and was restored to the checked-in version after inspection; it is not in this QA commit. |
| `npm test` | Passed: 11 files, 0 failures; `final_review` reports 15 passing cases. |
| `npm run build:pages` | Passed; artifact hashes above. |
| `node scripts/living-ship-qa.mjs` | Passed: 51 captures across the three mobile emulations plus legacy and corrupt-save checks. |

The browser pass found two real issues. The next normal fight's threat instruction computed below 18px because only first-session combat had the larger rule; `.encounter-threat` now computes 18px. A corrupt saved script-5 distress encounter cleared to a retry but lost its paid-fuel recovery marker, charging a second launch fuel. A failing v5 session regression test reproduced that bug before the fix; the existing v4 recovery mechanism now also carries v5 paid fuel. Script-4 Brace compatibility remained green.

## Browser journey and measurements

Each emulation reached Board ship → four portrait captain choices → named alien captain `QA Aster` → Jen free hire → Weapons assignment → trader distress → v2 Target their weapons → automatic crew win → one cargo claim → ship name → one Uncommon pull → registration Skip → usable ship. An in-progress reload at assignment kept exactly one captain and Jen. The `?fresh=1` query was removed after its first clear; an in-progress refresh and a completed refresh both retained progress. The completed save had three crew, one captain, one Uncommon welcome pull, one distress claim, and 200 credits in all three runs.

The automation's fresh-entry-to-first-win stopwatch was 5.068s at 390×844, 4.786s at 360×800, and 5.457s with reduced motion. The corresponding fight-only spans were 1.642s, 1.610s, and 1.637s. All were under two minutes; these are scripted click timings and do not estimate a novice's play time. At 390×844, the next Reliable/Push pirate job reached a win with the same target-weapons order. This one fight does not establish whole-game combat balance.

Across 51 captures, measured enabled button rectangles had a minimum side of 44 CSS px; selected mandatory text was at least 16 CSS px and measured instruction text at least 18 CSS px; document width never exceeded the emulated viewport. At most one primary pulse target was present per captured state. Reduced-motion captures reported no animation on that target. The Crew attention dot was present while its action was ready and cleared on opening Crew. The v3 splash image loaded at its actual 941px width; all four captain portraits loaded at 256px natural width and displayed at 72 CSS px in the selection sheet. The hull image loaded at 1152px natural width. Representative captures: [captain at 360px](../../.superpowers/sdd/2026-09-24-captain-first-play-combat/captures/captain-360x800-captain.png), [reduced-motion target window](../../.superpowers/sdd/2026-09-24-captain-first-play-combat/captures/captain-390x844-reduced-target-window.png), [post-tutorial ship](../../.superpowers/sdd/2026-09-24-captain-first-play-combat/captures/captain-360x800-next-job.png).

A saved script-4 v1 encounter reopened at Brace, won, and claimed once. A deliberately corrupted script-5 v2 encounter reopened at the guided retry instead of paying a reward; initial launch fuel was 8→7, retry remained 7→7, and credits remained 80→80. The raw corrupt localStorage record remains until the retry commits a repaired save; the visible in-memory state is recoverable. Screenshots of the [recovery cue](../../.superpowers/sdd/2026-09-24-captain-first-play-combat/captures/captain-390x844-corrupt-recovery.png) and [retry target window](../../.superpowers/sdd/2026-09-24-captain-first-play-combat/captures/captain-390x844-corrupt-retry.png) are in the same capture set.

## Limits and remaining gates

The Chrome clicks and emulated media query do not prove physical touch, notch safe areas, iPhone or Android performance, or owner comprehension. The screen inspection shows crew and the ship composition; pathing and door routing are covered by `test:ship`, not a measured end-to-end browser trajectory. Task 5 art remains partial: the alien/droid movement presentation uses distinct static markers pending accepted nonhuman walk sheets; no generic human sheet is accepted as their replacement. No live Jest session, purchases, cloud recovery, public Pages publish, PR merge, or Grok audit is claimed here.
