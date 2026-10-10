# Ledger: Phase 3 art (cast, clients, faction and twist icons, chapter and story scenes), 2026-10-10

Approved by Garrett 2026-10-10 ("Yes, up to $5"; hard cap for this pass $4.00). Account: his **personal** Flora
workspace `ws_qd74q6ne1vz179axy853gsba3s7v9r97`, project `prj_ns7f3yytp61zv39w1ea33bqynd8fycj1`. Style: C. For the
[world bible](../design/23-world-bible.md) (cast, clients, factions, chapters 1 and 2).

## What was made

27 images (26 used, 1 rejected pilot take). Every image was usable on the first take, except Auntie Vell (see Redo).

| Group | Images | Installed as |
|---|---|---|
| Cast portraits | `vell`, `crane`, `tarrow`, `choir`, `wren` | `public/art/pixel/cast/<id>.png` |
| Client portraits | `fenn`, `ledgers`, `sato`, `grudge`, `bask`, `ossory`, `quist`, `ulama`, `nobody`, `sallow`, `ash` | `public/art/pixel/clients/<id>.png` |
| Faction icons | `factions-a` (corsairs, scrappers, swarm, ice), `factions-b` (shades, wardens, eclipse, almanac) | `public/art/pixel/ui/faction-<id>.png`, `ui/almanac.png` |
| Twist icons | `twists-a` (escort, rush, bounty, holdout), `twists-b` (waves, story, loyalty, discovery) | `public/art/pixel/ui/twist-<id>.png`, `ui/story.png`, `ui/loyalty.png`, `ui/discovery.png` |
| Chapter title cards | `chapter-spur` ("Cheap Ship, Bad History"), `chapter-veil` ("The Veil") | `public/art/pixel/cinematic/v2/chapter-spur.png`, `chapter-veil.png` |
| Scenes | `almanac`, `constant` (the Constant, chapter 2 boss), `buoy` (Wren's buoy, Echo Reef) | `public/art/pixel/cinematic/v2/<name>.png` |
| Sprite | `freighter` (Big Mabel, side view) | `public/art/pixel/ships/v2/freighter-mabel.png` |

- Model `is2i-gpt-image-2-5-flare` (GPT Image 2.5), `quality: high`, `resolution: 1k`.
- Portraits (1:1): one reference, round-2 Kira, for style and framing only. These characters have no earlier
  design, so each is described in full from the world bible's "Look" column. The Choir has no face: a ring of violet
  spores and static above a cloaked body. Nobody's face is a dark screen with one line of static.
- Icon sheets (1:1): one reference, the Phase 2 style C icon sheet, same template as
  [Phase 2](2026-10-10-phase2-art-ledger.md).
- Scenes (16:9): one reference, the style C scene reference of the [art pass](2026-10-09-art-pass-2-ledger.md). The
  Sparrow title card (`chapter-spur`) also carries a second reference: the Sparrow in the Veil scene
  (`cinematic-veil`), for the ship only. Big Mabel is drawn on plain navy, for keying out.
- Every prompt, parameter and Flora run id is in
  [`outputs/phase3-art-2026-10-10/prompts.json`](outputs/phase3-art-2026-10-10/prompts.json). Review sheet:
  [`outputs/phase3-art-2026-10-10/contact-sheet.png`](outputs/phase3-art-2026-10-10/contact-sheet.png).
- A 2-image pilot (Auntie Vell and Foreman Grudge) checked likeness and the navy background before the other 14.

## Cost

| Step | Images | Cost |
|---|---|---|
| Pilot (Vell, Grudge) | 2 | $0.128 |
| Portraits (the other 14) | 14 | $0.896 |
| Redo: Auntie Vell | 1 | $0.064 |
| Icon sheets | 4 | $0.256 |
| Scenes (the Sparrow card, with two references, was $0.073; the rest $0.064) | 6 | $0.393 |
| **Phase 3 art** | **27** | **$1.737** |

Flora showed $27.361 before the pass and $25.624 after, which is the same $1.737, well under the $4.00 cap and the
$5 approval.

## Redo

- **Auntie Vell, first take rejected** (kept as `raw/vell-first.png`, not installed). The Look column says "cosy
  cluttered office", and the first prompt put one behind her: buildings and plants at both edges, so the navy
  background could not be keyed out. The portrait template now ends "with nothing behind the character: no
  furniture, buildings or scenery", and Vell's prompt dropped the office. The 14 portraits made after the pilot use that wording;
  Foreman Grudge, from the pilot, came out clean without it.

## Install (local, free)

`scripts/install-phase3-art.py`, the same treatment as [Phase 2](2026-10-10-phase2-art-ledger.md) and the
[portrait pass](2026-10-09-portrait-pass-ledger.md). Deterministic; it also writes `install-report.json` and the
contact sheet.

- **Portraits:** `scripts/pixel-snap.py --auto 3.5,8` (each image's own pixel grid, 4.7 to 6.0 px per art pixel), 40
  colours, navy keyed to transparent, written as a 768 × 768 palette PNG (13 to 27 KB each).
- **Icons:** navy keyed out, each sheet split into its four icons, each trimmed, shrunk to 256 px and cut to 256
  colours.
- **Scenes:** resized to 1280 × 720 and cut to 256 colours; not keyed.
- **Big Mabel:** navy keyed out, trimmed and shrunk to 512 px wide (512 × 179, transparent).
- Nothing in `src/` was changed. Earlier passes registered portraits in `src/data/artManifest.js`, but the cast and
  client files are not drawn by any screen yet, and neither `test/asset_manifest.test.mjs` nor
  `test/portrait_backgrounds.test.mjs` lists these folders. The screens that use them will register them.
- `corepack pnpm -F @warpcrew/client test` passes.

## Notes for the next pass

- `chapter-veil` and `chapter-spur` keep the upper third dark and calm, but the Veil card has a little mist and
  two ghost ships up there; title text needs a dark scrim behind it.
- The Choir portrait is a floating spore ring above a dark cloaked body (no head). If the Choir should be only the
  ring, crop it in the UI.
- Wren's glitch (offset pixel rows and cyan static on one cheek) is faint; the `blackbox` speaker can add its own
  static overlay.
