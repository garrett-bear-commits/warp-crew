# Ledger: style mockup, 2026-10-09

Brief: [`2026-10-09-style-mockup-brief.md`](2026-10-09-style-mockup-brief.md). Account: Garrett's **personal** Flora
workspace `ws_qd74q6ne1vz179axy853gsba3s7v9r97` ("Garrett Dare's Workspace"), project
`prj_ns7f3yytp61zv39w1ea33bqynd8fycj1` ("Warp Crew style mockup 2026-10-09"). Never the textclub account.

Model: `t2i-gpt-image-2-5-flare` (GPT Image 2.5), params `quality: high`, `resolution: 1k`. No reference images.
Prompts: the brief's base prompt for the subject + the variant line + the common suffix, word for word.

## Round 1 (6 images, $0.33)

| File (`outputs/mockup-2026-10-09/`) | Variant | Aspect | Flora run id | Cost | Disposition |
|---|---|---|---|---|---|
| `raw/portrait-A.png` | A. HD pixel | 1:1 (1024×1024) | `run_m174bn7bdzaaaxezpe3m7avg5s8fygsj` | $0.055 | Kept for review. Cleanest read; bleached undercut and chevrons as briefed. |
| `raw/portrait-B.png` | B. Painted pixel | 1:1 | `run_m1700fbga7nzpvxm9vyc22t2y18fz31x` | $0.055 | Kept for review. Richest texture; the chevron tattoos came out as bars and the undercut is dark, not bleached. |
| `raw/portrait-C.png` | C. Bold arcade | 1:1 | `run_m17dycyhxz717tvsb742xny8s18fy2kj` | $0.055 | Kept for review. Chunkiest pixels and strongest rim light; reads best at small size. |
| `raw/ship-A.png` | A. HD pixel | 2:3 (832×1248) | `run_m1780yds7fyf9788fey634dadn8fzzzx` | $0.055 | Kept for review. Every room as briefed; cool floors, clearest room colours. |
| `raw/ship-B.png` | B. Painted pixel | 2:3 | `run_m17bskketh6xv6mxxcptb1e9x98fyqsq` | $0.055 | Kept for review. Warmer and darker; rooms blend more at phone size. |
| `raw/ship-C.png` | C. Bold arcade | 2:3 | `run_m173nga705zktv1vr2ra50y4n58fzsfz` | $0.055 | Kept for review. Crispest grid and props (medbay crosses); engineering split into two rooms either side of the reactor. |

Flora reported $0.335 spent on the day and $12.254 left after Round 1.

## Clean-up (local, free)

`scripts/pixel-snap.py` (grid refine, cell medians, 40-colour OKLab palette that keeps bright accents, navy key):

| Image | Art-pixel size | Art size | Colours |
|---|---|---|---|
| portrait-A | 4.05 px | 253×253 | 40 |
| portrait-B | 4.29 px | 240×239 | 40 |
| portrait-C | 5.46 px | 188×188 | 40 |
| ship-A | 2.30 px | 362×544 | 40 |
| ship-B | 2.35 px | 354×532 | 40 |
| ship-C | 2.66 px | 313×469 | 40 |

Outputs: `*-snapped.png` (art size, transparent background) and the contact sheets `contact-sheet-portraits.png`
and `contact-sheet-ships.png` (raw, snapped, and at phone size).

Notes for production:
- The model draws a finer grid than the brief asked for: portraits about 190–250 art pixels across (brief: 96–128),
  ships 313–362 (brief: 256–384). Variant C is closest. If Garrett wants a chunkier look, Round 2 can ask for it.
- 40 colours is tight for a whole ship: the snapped ships lose a little warmth. 48 is within the brief and worth
  trying for production ships.
- The ships' grids are weak (edge scores about 1.03 for A and B against 1.1–1.35 for the rest), so their snap
  changes more pixels than the portraits'. C has the truest grid.

## Zoom check (local, free)

Garrett picked **C for portraits** and asked which ship holds up best fully zoomed in and fully zoomed out. Each
snapped ship was rendered on a 390×726-point phone ship view at 3× (iPhone pixels), at the same on-screen sizes as
today's Sparrow at the game's camera limits (measured: about 252 points wide zoomed out, 729 zoomed in), with
`image-rendering: pixelated`: `zoom-sheet-ships.png` (whole screens) and `zoom-detail-ships.png` (actual pixels
zoomed in). Zoomed in, one art pixel is about 2 points (6–7 iPhone pixels) for every variant.

- Zoomed out: C reads best (strongest contrast, the orange trim and engines carry the silhouette, each room is
  its own colour block); A is clear but darker; B's rooms blend into brown.
- Zoomed in: C is the cleanest (flat clusters, hard outlines, props readable at a glance); A is good but mottled
  where a soft source was snapped; B's texture turns into speckle.

## Round 2

Not started: waiting for Garrett's pick. Up to 4 more images; cap 10 images and about $5 in all.
