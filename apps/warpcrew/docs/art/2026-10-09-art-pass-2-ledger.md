# Ledger: the rest of the art in style C, 2026-10-09

Approved by Garrett 2026-10-09 ("go", after the estimate of about $2.90 for one take of each image, about $4.50 with
redos). Account: his **personal** Flora workspace `ws_qd74q6ne1vz179axy853gsba3s7v9r97`, project
`prj_ns7f3yytp61zv39w1ea33bqynd8fycj1`. Style: C (the [portrait and Sparrow pass](2026-10-09-portrait-pass-ledger.md)).

## What was made

30 images, every one usable on the first take (no redos):

| Group | Images | Where the game shows it |
|---|---|---|
| Enemy ships (pirate, scrapper, swarm, ice, shade, crown) | 6 | FTL fights: the enemy ship and its four rooms you target |
| Pirate fighter and trade freighter, top-down | 2 | Risky, Reliable and Distress contract cards; flight combat |
| Opening splash (the four captains on the bridge) | 1 | The first screen |
| Story scenes (jump, hire, veil, ember, hollow, crown) | 6 | Story beats |
| Hull thumbnails (Sparrow and the eight hulls for sale) | 9 | The hangar hull list |
| Red planet, ice planet, swarm drone | 3 | Space flight backdrop; away-mission destinations |
| Asteroids (4 in one image) | 1 | Rocks drifting past in space flight |
| Currency icons (4 in one image), star-map icons (4 in one image) | 2 | Top bar, rewards, star map, destinations |

- Model `is2i-gpt-image-2-5-flare` (GPT Image 2.5), `quality: high`, `resolution: 1k`.
- Two references for each image: a style reference (the Sparrow `ship-C2-chunky` for ships, scenes and props; round-2
  Kira for scenes with people; the four style C captains, as one sheet, for the splash) and the old image, so each
  keeps its design and layout. The Sparrow thumbnail used the Sparrow v5 hull alone.
- The old images were fetched by Flora from the public QA build; the four sheets (captains, asteroids, currency icons,
  star-map icons) were made locally and uploaded.
- A 5-image pilot (one of each kind: an enemy ship, the splash, a story scene, a thumbnail, an icon sheet) checked
  the approach before the other 25.
- Every prompt, its parameters, references and Flora run id: [`outputs/art-pass-2026-10-09/prompts.json`](outputs/art-pass-2026-10-09/prompts.json).

## Cost

| Step | Images | Cost |
|---|---|---|
| Pilot | 5 | $0.365 |
| Main batch | 20 | $1.460 |
| Last batch (4 with two references, the Sparrow thumbnail with one) | 5 | $0.356 |
| **This pass** | **30** | **$2.181** |

Flora reported $9.71 spent on 2026-10-09 and $2.87 left. Of that, $4.254 is the mockup and portrait pass, $2.181 this
pass, and the rest is a different project on the same account ("Lanternwild – Lantern Die prototype": sound effects
and images made just before this pass), not Warp Crew.

## Clean-up and install (local, free)

`scripts/install-art-pass.py` installs every image from the raws and `prompts.json` (deterministic: a second run is
byte-identical). Sprites have the navy background keyed to transparent (a flood fill from the border, as in
`scripts/pixel-snap.py`) and are trimmed; the asteroid and icon sheets are split into four; every image is shrunk to
its size in the game if larger and cut to 256 colours.

| Group | Installed as | Size |
|---|---|---|
| Enemy ships | `public/art/enemies/v2/<family>.png` | 1024 px wide, 103–164 KB |
| Pirate fighter, freighter | `public/art/pixel/vertical-slice/{pirate-scout,trader-freighter}-topdown-v2.png` | 768 px tall |
| Splash | `public/art/pixel/vertical-slice/splash-v4.png` | 720 × 1280, 397 KB (the old one was 2.6 MB) |
| Story scenes | `public/art/pixel/cinematic/v2/<scene>.png` | 1280 × 720, 335–415 KB |
| Hull thumbnails | `public/art/pixel/ships/v2/<hull>.png` | 360 px on the long side |
| Planets, swarm drone, asteroids | `public/art/space/v2/`, `public/art/pixel/fx/v2/swarm.png` | 128–512 px |
| Icons | `public/art/pixel/icons/v2/` | 128 px |

The new set is 4.6 MB; the 53 old files removed with it were 20.9 MB (the images it replaces plus unused ones).
New folders, so no phone shows a cached old image.

**Not snapped to a pixel grid**, unlike the portraits. The model drew this pass at about 2–3 px per art pixel. Every
automatic grid search locked onto twice that size, because it lines up with every other edge and scores higher, and
snapping there halved the detail. Side-by-side crops of each image showed this. The game always draws these images
smaller than their raw size, so a snap would gain nothing on screen.

- Enemy target rooms: `scripts/measure-enemies-v2.py` holds each ship's four rooms (weapons, helm, shields,
  engines) and its gun mounts, measured on the installed art, and writes `src/data/art/enemyLayouts.json` plus the
  review overlay [`qa/enemies-v2-layout.png`](qa/enemies-v2-layout.png). The encounter map is unchanged.
- Code: `src/data/portraits.js` (ships, space, icons, star map, destinations, story scenes) and
  `src/data/artManifest.js` (splash and pirate fighter, status `style-c`, new hashes) point at the new files.
- These images are always drawn smaller than their pixels, so their CSS now shrinks them smoothly
  (`image-rendering: auto`); `pixelated` dropped whole pixel rows when shrinking. This applies to the top bar and
  reward icons, star-map beacons, hull thumbnails, destinations, contract-card ships, asteroids and enemy ships.
- Removed 53 old images. They remain in git history. Some were replaced; others nothing drew: the static star
  field, nebula, black hole and plain planet (space flight draws those itself), the laser and thruster effects, the
  old splash candidates, the side-view pirate, and the v1–v3 Sparrow hulls. The hit-flash effect
  (`art/fx/impact.png`) and the Sparrow's fallback cutaway stay.
- Tests: the new `test/art_pass.test.mjs` (in `test:loop`) checks every image the game draws is from this set and
  installed, that sprites have transparent corners, and that each enemy's size matches its layout. It also checks
  that each target room sits on the ship, that no two rooms overlap, and that each gun mount is on the hull. The
  PNG decoder moved to `test/helpers/png.mjs` (now with small palettes). `enemy_art`, `asset_manifest`,
  `first_play_ui` and `scripts/living-ship-qa.mjs` point at the new files.
- Review sheet: [`outputs/art-pass-2026-10-09/review-sheet.jpg`](outputs/art-pass-2026-10-09/review-sheet.jpg).
- Screens checked in a phone-size browser: the splash and the first fight (pirate ship, rooms, top-bar icons, the
  red planet behind the Sparrow).

## Not in this pass

- The hit-flash effect sheet and the Sparrow's fallback cutaway (`sparrow-cutaway.jpg`) are the older art.
- The ice planet's ring encloses a little of the navy background, which stays dark navy. It reads as shadow.
