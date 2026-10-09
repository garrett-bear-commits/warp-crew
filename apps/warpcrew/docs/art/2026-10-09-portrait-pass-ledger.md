# Ledger: art pass in style C (portraits and the Sparrow), 2026-10-09

Approved by Garrett 2026-10-09 ("yes start the full art pass", estimate $3.50–4.50). Account: his **personal** Flora
workspace `ws_qd74q6ne1vz179axy853gsba3s7v9r97`, project `prj_ns7f3yytp61zv39w1ea33bqynd8fycj1`. Style: C, chosen
in the [style mockup](2026-10-09-style-mockup-ledger.md).

## What was made

All 50 portraits the game shows: the 46 hireable mercs and the 4 starter captains. Kira and Skarn are the round-2
mockups (`portrait-C2-kira`, `portrait-C2-skarn`); the other 48 are new.

- Model `is2i-gpt-image-2-5-flare` (GPT Image 2.5, two references), `quality: high`, `resolution: 1k`, 1:1.
- Reference 1 (style and framing): round-2 Kira (`mockup-2026-10-09/raw/portrait-C2-kira.png`).
- Reference 2 (design): the character's previous portrait, fetched by Flora from the public QA build, so each merc
  keeps its species, colours, outfit and props.
- Prompt: one template plus a short visual note and the merc's roster blurb. The exact prompt, parameters and Flora
  run id of every image are in [`outputs/portraits-2026-10-09/prompts.json`](outputs/portraits-2026-10-09/prompts.json).
- A 3-image pilot (Rex, Plip, Bolt) checked sharpness and likeness before the other 45.

## Cost

| Step | Images | Cost |
|---|---|---|
| Pilot | 3 | $0.219 |
| Main batches | 45 | $3.285 |
| Redos (Vorn and Eclipse drifted to green; the first takes are kept as `raw/*-first.png`, rejected) | 2 | $0.146 |
| **Portrait pass** | **50** | **$3.650** |

Flora reported $4.254 spent on 2026-10-09 in all (the mockup's $0.609 plus this pass) and $8.33 left.

## Clean-up and install (local, free)

`scripts/pixel-snap.py --auto 3.5,8 --out-size 768`: finds each image's own pixel grid (about 5–6 px per art
pixel, so 170–200 art pixels across), takes one colour per art pixel, cuts to a 40-colour palette, keys the navy
background to transparent, and writes a 768 × 768 palette PNG with hard pixel blocks (about 17 KB each; 852 KB for all
50, against 2.6 MB for the old set).

- Installed in `public/art/pixel/crew-v2/<name>.png` (a new folder, so no phone shows a cached old portrait);
  `src/data/portraits.js` and `src/data/artManifest.js` point there (manifest status `style-c`, new hashes).
- The old `public/art/pixel/crew/` set and the four `vertical-slice/captain-*-portrait-v1.png` files are removed
  (they remain in git history).
- Portraits now shrink smoothly (`image-rendering: auto`): they are always drawn smaller than their art (22–112
  points), and `pixelated` dropped pixels when shrinking.
- Tests: `test/portrait_backgrounds.test.mjs` checks the new folder (transparent top corners, no key colour, 768 ×
  768, every merc and captain on its own style C file); `test/asset_manifest.test.mjs` checks the new hashes.
- Review sheet: [`outputs/portraits-2026-10-09/roster-sheet.png`](outputs/portraits-2026-10-09/roster-sheet.png).

## The Sparrow (v5)

No new generation: the ship is the round-2 mockup `ship-C2-chunky` (run `run_m172wtgwqc3g3jeq5k557f1b1d8fz3t3`,
$0.073, in the mockup ledger), snapped at 2.7 px per art pixel with 48 colours (309 × 465 art pixels).

- `scripts/measure-sparrow-v5.py` holds every measurement in art pixels (rooms from a wall scan, the corridor, door
  points on the drawn door lights, work spots, 36 furniture blocks on the big props, the airlock and the four
  thrusters) and writes the hull image, `src/data/art/sparrowV5Layout.json` and the review overlay
  [`qa/sparrow-v5-layout.png`](qa/sparrow-v5-layout.png).
- Hull image: `public/art/ships/v5/sparrow-v5.png`, the art at 5× (world 1545 × 2325), 60 KB, drawn with
  `image-rendering: pixelated` so the blocks stay hard from the farthest zoom to the nearest.
- The v4 hull and layout are removed. Ship tests that hard-coded v4 coordinates now read them from the layout
  (`ship_pathing`, `crew_walk_routes`, `ship_view`); `ship_pathing` also checks that furniture blocks walking and that
  no work spot is blocked. All 100 room-to-room crew routes connect.
- Room-side door points sit at least 1.5% inside their room: the walkable floor stops 1% short of every wall, and a
  door point on that edge let a smoothed path cut a corner (the first layout failed every route into Engineering).

## Not in this pass

- The splash scene (`vertical-slice/splash-five-crew-v3.png`), the small crew figures that walk the ship
  (`public/art/crew/`), the enemy ships and the ship thumbnails are still the older art.
- `test/ship_camera_input.test.mjs` and `test/ship_camera_opening.test.mjs` are in no suite and already failed
  before this pass (a DOM stub without `classList.add`).
- Kira's chevron tattoos sit under her right eye, not her left (the round-2 refinement did not move them).
