# Ledger: Phase 4 art and the fight explosion (2026-10-10)

**Approval.** Garrett approved up to $3 on 2026-10-10. Hard cap for this pass: $2.40.

**Account.** His **personal** Flora workspace `ws_qd74q6ne1vz179axy853gsba3s7v9r97`, project
`prj_ns7f3yytp61zv39w1ea33bqynd8fycj1`. Style C.

**For:**
- the [Phase 4 design](../superpowers/specs/2026-10-10-live-design.md): Season 1, the event and the Rift;
- the first-hour design's §D, [fight feel](../superpowers/specs/2026-10-10-first-hour-design.md).

## What was made

7 images, all used on the first take.

| Image | What | Installed as |
|---|---|---|
| `rhea` | Rhea Hollis, the Season 1 event merc: union boss of the Forge Moon foundries (Epic Security, the Yards) | `public/art/pixel/cast/rhea.png` |
| `wyke` | Overseer Wyke of the Ash Ledger consortium, the event's antagonist | `public/art/pixel/cast/wyke.png` |
| `uprising` | Season 1 key art: workers with hammers and union banners at the Forge Moon foundry, consortium gunships above | `public/art/pixel/cinematic/v2/uprising.png` |
| `rift` | The Rift: a white-cyan tear in space with violet cracks, wrecks and shards, the Sparrow facing it | `public/art/pixel/cinematic/v2/rift.png` |
| `season-icons` | Season point, Forge scrip, Rift depth, event chest | `public/art/pixel/ui/season-point.png`, `scrip.png`, `rift-depth.png`, `event-chest.png` |
| `rift-icons` | Rift boons: patch hull, extra shield, faster guns, cash out | `public/art/pixel/ui/boon-patch.png`, `boon-shield.png`, `boon-guns.png`, `boon-cashout.png` |
| `fx-explosion` | An 8-frame pixel explosion, from white flash to fireball to smoke and embers | `public/art/fx/explosion-strip.png` (8 frames of 43 px in one row, 4 KB) |

**Model and settings:** `is2i-gpt-image-2-5-flare` (GPT Image 2.5), `quality: high`, `resolution: 1k`.

**References,** the same ones as [Phase 3](2026-10-10-phase3-art-ledger.md):
- the round-2 Kira portrait for the two portraits;
- the style C icon sheet for the icons and the explosion;
- the style C scene for the two scenes.

**Records:** every prompt, parameter and run id is in
[`outputs/phase4-art-2026-10-10/prompts.json`](outputs/phase4-art-2026-10-10/prompts.json). Review sheet:
[`contact-sheet.png`](outputs/phase4-art-2026-10-10/contact-sheet.png).

**Name changes before drawing:**
- "Calder" was taken by Rune Calder, so the event merc is Rhea **Hollis**.
- "Hask" appears in Vorn's bond scene, so the overseer is **Wyke**.

## Cost

| Step | Images | Cost |
|---|---|---|
| Pilot (Rhea Hollis, the explosion sheet) | 2 | $0.128 |
| Batch 2 (Wyke, two scenes, two icon sheets) | 5 | $0.320 |
| **Phase 4 art** | **7** | **$0.448** |

Flora showed $25.624 before the pass and $25.176 after, which is the same $0.448. That leaves $2.552 of Garrett's $3
approval.

## Install (local, free)

`scripts/install-phase4-art.py`, the Phase 3 script plus one new kind. It is deterministic.

- **Portraits:**
  - pixel-snapped on their own grid (5.0 and 5.6 px per art pixel);
  - 40 colours, with the navy keyed out;
  - 768 px palette PNGs.
- **Icons:** keyed out, split 2 × 2, trimmed, 256 px, 256 colours.
- **Scenes:** 1280 × 720, 256 colours.
- **The explosion sheet** (kind `fxsheet`):
  - snapped to its grid;
  - keyed out;
  - its 4 × 2 frames cut;
  - each frame centred in an equal 43 px cell;
  - written as one strip.

  Its grid range is pinned to 5.5-7.5 px (`cell_range` in prompts.json). The automatic range picked a cell twice
  too coarse (12 px, 23 px frames). The real cell is about 6 px.

  The fight canvas draws the strip scaled up with smoothing off.

Nothing in `src/` was changed. The screens that use these files register them.
