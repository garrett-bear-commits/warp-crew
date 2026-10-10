# Ledger: Phase 2 art (shop, chests, calendar, achievements, welcome back), 2026-10-10

Approved by Garrett 2026-10-10 ("approve spending more flora credits. I will buy $20 now"; Flora showed $27.87 before
this pass). Account: his **personal** Flora workspace `ws_qd74q6ne1vz179axy853gsba3s7v9r97`, project
`prj_ns7f3yytp61zv39w1ea33bqynd8fycj1`. Style: C. For the [Phase 2 design](../superpowers/specs/2026-10-10-reward-feel-retention-design.md).

## What was made

8 images, all usable on the first take: seven sheets of four icons (28 icons) and one scene.

| Sheet | Icons (`public/art/pixel/ui/<name>.png`) | Used for |
|---|---|---|
| `shop-gems-a` | `gems-pouch`, `gems-pack`, `gems-crate`, `gems-vault` | Shop gem packs |
| `shop-gems-b` | `gems-hoard`, `starter-crate`, `commission`, `drydock-finish` | Shop: hoard, starter kit, Commission, drydock finish |
| `shop-walls-a` | `wall-spur`, `wall-veil`, `wall-ember`, `wall-hollow` | Wall packs |
| `calendar` | `merc-pod`, `marks`, `shard`, `wall-crown` | Calendar day 28, Contract Marks, shards; Crown wall pack |
| `chests` | `chest-daily`, `chest-daily-open`, `chest-weekly`, `chest-weekly-open` | Daily and weekly chests |
| `achievements-a` | `ach-combat`, `ach-crew`, `ach-ship`, `ach-explore` | Achievement tracks |
| `achievements-b` | `ach-walls`, `ach-collection`, `hold`, `rally` | Achievement tracks; the hold; Rally |
| `welcome-back` | `public/art/pixel/cinematic/v2/welcome-back.png` | The welcome-back claim screen |

- Model `is2i-gpt-image-2-5-flare` (GPT Image 2.5), `quality: high`, `resolution: 1k`, one reference each:
  - the icon sheets use the style C currency icons;
  - the scene uses the style C hire scene.
- Every prompt and Flora run id is in [`outputs/phase2-art-2026-10-10/prompts.json`](outputs/phase2-art-2026-10-10/prompts.json).

## Cost

| Step | Images | Cost |
|---|---|---|
| Icon sheets and scene | 8 | $0.512 |

## Install (local, free)

`scripts/install-phase2-art.py`, the same treatment as the [previous pass](2026-10-09-art-pass-2-ledger.md):

- the navy background is keyed out;
- each sheet is split into its four icons;
- icons are trimmed, shrunk to 256 px and cut to 256 colours;
- the scene is 1280 × 720.

The run is deterministic. Nothing draws these images yet; the Phase 2 screens will.
