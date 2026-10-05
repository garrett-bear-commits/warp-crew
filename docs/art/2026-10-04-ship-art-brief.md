# Art brief: Sparrow v4 cutaway and enemy ship cutaways

For: Codex (gpt-6-luna, medium effort). From: the Warp Crew code lead. Date: 2026-10-04.

## Why

Warp Crew's fights are becoming FTL-like: you see your ship's rooms, target the enemy's rooms, and move crew between rooms to repair, fight fires and repel boarders. Two problems with today's art:

1. The Sparrow (`public/art/space/sparrow-hull-v3.png`, 1152×1728) is too small for its crew. Rooms are about 230 px tall; a crew member is about 102 px, so crew look huge and rooms look like closets. FTL rooms read as places people stand in.
2. All 16 enemies share one small top-down sprite (`public/art/space/pirate-scout.png`, 512×268) with no interior, so there is nothing to target.

## Style (match what exists)

- Look at `public/art/space/sparrow-hull-v3.png` and the crew sheets in `public/art/crew/` (e.g. `captain_cyborg_walk.png`) and the splash art in `public/art/` for palette and mood: gritty, worn sci-fi pixel art; weathered gunmetal and charcoal hull plating, warm orange and amber warning accents, teal and cyan console screens, soft interior lighting, small readable props.
- Top-down orthographic cutaway (we look straight down into the rooms), like FTL. No perspective.
- Crisp pixel art on a consistent pixel grid (one art pixel = 4 image pixels). No blur, no painterly gradients, no text or labels baked in (the game draws labels).
- Transparent background (PNG with alpha). No stars or space behind the ship.

## Deliverable 1: Sparrow v4 (the player's ship)

- `public/art/ships/v4/sparrow-v4.png`: 1536 × 2560, transparent, vertical, bow (nose) at the TOP, engines at the BOTTOM.
- Layout: one straight central spine corridor running bow to stern (about 10% of the width), rooms on both sides of it, each with a door gap onto the spine. Keep this topology: crew walk along the spine and turn into rooms through doors.
- Rooms, bow to stern (ids are what the code uses):

| Row | Port (left) | Starboard (right) | Notes |
| --- | --- | --- | --- |
| 1 | `bridge` (spans both sides at the nose) | | Pilot seat facing forward, helm consoles |
| 2 | `shields` | `weapons` | Shield generator core; weapon racks and a gunnery console |
| 3 | `sensors` | `medbay` | Scanner table; medical bed and cabinet |
| 4 | `quarters` | `mess` | Bunks; table and galley |
| 5 | `cargo` | `armory` | Crates and a cargo lift; weapon lockers |
| 6 | `engineering` (spans both sides at the stern) | | Reactor and repair benches |
| — | `airlock` on the port hull wall beside `cargo` | | Small exterior hatch where boarders come in |

- Size rooms so a 102 px tall crew member is about one third of a room's height: rooms roughly 300–360 px tall, 2-column rooms roughly 520–600 px wide. Leave walkable floor in every room.
- Every room needs one obvious work spot (a console, seat, bench or bed) where a crew member stands to work it.
- Each room should be recognizable by its props and floor colour alone (the four fight systems especially: bridge, shields, weapons, engineering).
- Four engine nozzles at the stern, evenly spaced, pointing down.

## Deliverable 2: enemy ship cutaways

Six hull families. Each: `public/art/enemies/<family>.png`, 1024 × 512, transparent, horizontal, bow pointing LEFT. Same pixel grid and style, but hostile: each family gets its own accent colour and silhouette.

Every enemy shows four clear rooms the player can target: `weapons`, `shields`, `engines`, `helm` (plus optional filler rooms). Rooms must be large and distinct at small size: the enemy is shown about 360 px wide on a phone.

| Family file | Enemies (encounter ids) | Look |
| --- | --- | --- |
| `pirate` | pirate_scout, pirate_wing, pirate_ace | Lean raider, red and rust, bolted-on guns |
| `scrapper` | scrapper_gang, ember_raider | Junk-built hauler, mismatched plates, grapples |
| `swarm` | swarm_probe, swarm_skirmish, swarm_frigate, swarm_brood | Alien, organic chitin, violet and green bio-glow |
| `ice` | ice_raiders | Frost-crusted hull, pale blue, harpoon guns |
| `shade` | veil_wraith, hollow_shade | Stealthy black hull, magenta slits |
| `crown` | corsair_king, eclipse_echo, crown_warden, eclipse_throne | Big ornate flagship, gold trim on black, many guns |

## Deliverable 3: layout data (measured from your final images)

The code positions crew, damage, fire and targeting markers from these files, so they must match the pixels.

1. `src/data/art/sparrowV4Layout.json`:
```json
{
  "image": "art/ships/v4/sparrow-v4.png",
  "sourceSize": { "width": 1536, "height": 2560 },
  "spine": { "left": 45, "top": 8, "width": 10, "height": 84 },
  "rooms": [
    { "id": "bridge", "label": "Bridge", "left": 30, "top": 4, "width": 40, "height": 11,
      "workAnchor": { "x": 50, "y": 9 }, "door": { "room": { "x": 50, "y": 14 }, "spine": { "x": 50, "y": 16 } } }
  ],
  "airlock": { "x": 18, "y": 70 },
  "thrusters": [ { "x": 38, "y": 97 } ]
}
```
All numbers are percentages of the image (0–100). Room rectangles are the walkable floor inside the walls. `workAnchor` is where the crew member stands to work the room. `door.room` is just inside the door; `door.spine` is the matching point on the spine centreline. Include every room id from the table.

2. `src/data/art/enemyLayouts.json`: one entry per family: `{ "image": "art/enemies/pirate.png", "sourceSize": {...}, "rooms": [ { "id": "weapons", "left": .., "top": .., "width": .., "height": .. }, ... ], "mounts": [ { "x": .., "y": .. } ] }`, where mounts are the gun muzzles shots fire from. Plus `"encounters": { "pirate_scout": "pirate", ... }` mapping all 16 encounter ids above.

## Deliverable 4: proof

- `docs/art/qa/sparrow-v4-overlay.png` and `docs/art/qa/enemies-overlay.png`: your images with every rectangle, anchor, door and mount from the JSON drawn on top (thin coloured outlines and dots, with ids), so a reviewer can see they line up.
- `docs/art/qa/contact-sheet.png`: all seven ships side by side at small size, plus the new Sparrow next to `sparrow-hull-v3.png` at the same scale for comparison.
- `docs/art/2026-10-04-ship-art-notes.md`: short notes: what you generated, how you cleaned it (background removal, palette, pixel grid), and anything you could not achieve.

## Rules

- Generate with your image tool, then clean up with scripts (e.g. Python/Pillow): remove backgrounds to true alpha, snap to the 4-px pixel grid (downscale ×4 nearest then upscale ×4 nearest), keep a limited palette, crop to the exact canvas sizes.
- Iterate: view your result, compare against this brief, regenerate what is weak. The four fight rooms on the Sparrow and the four target rooms on each enemy must be obvious at a glance.
- Create only the new files listed above. Do not edit or delete any existing file, do not run git commands, and do not touch `src/` other than creating `src/data/art/*.json`.
- Finish with a short summary: files created, any rooms or families that are weak, and what you would redo with more time.
