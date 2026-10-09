#!/usr/bin/env python3
"""Build the Sparrow v5 hull image and its layout (rooms, doors, corridor, furniture) from the style C art.

    python3 apps/warpcrew/scripts/measure-sparrow-v5.py

Source: docs/art/outputs/mockup-2026-10-09/ship-C2-chunky-snapped.png (309 x 465 art pixels, chosen by Garrett on
2026-10-09). Everything below is measured on that image in art pixels (x0, y0, x1, y1, inclusive) from a wall scan
and gridded close-ups (docs/art/qa/sparrow-v5-layout.png shows the result over the art). The script writes:

- public/art/ships/v5/sparrow-v5.png: the art at 5x with hard pixel blocks (the game's world is 1545 x 2325);
- src/data/art/sparrowV5Layout.json: the same geometry in percent of the image, the format starterShip.js reads;
- docs/art/qa/sparrow-v5-layout.png: rooms (cyan), corridor (white), doors (amber), work spots (green) and
  furniture (pink) over the art, for review.

Furniture covers only the big props, so every door has a clear lane to its room's work spot.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'docs/art/outputs/mockup-2026-10-09/ship-C2-chunky-snapped.png'
SCALE = 5

# Interior of each room (inside its walls).
ROOMS = [
    ('bridge', 'Bridge', (121, 32, 187, 82)),
    ('shields', 'Shields', (87, 90, 138, 144)),
    ('weapons', 'Weapons', (167, 90, 221, 144)),
    ('sensors', 'Sensors', (87, 149, 138, 201)),
    ('medbay', 'Medbay', (167, 149, 221, 201)),
    ('quarters', 'Quarters', (87, 206, 138, 260)),
    ('mess', 'Mess', (167, 206, 221, 260)),
    ('cargo', 'Cargo', (87, 265, 138, 314)),
    ('armory', 'Armory', (167, 265, 221, 314)),
    ('engineering', 'Engineering', (87, 325, 221, 381)),
]
SPINE = (143, 84, 164, 324)       # the central corridor, bridge door to engineering door
SPINE_X = 153.5
# Where crew stand to work, and the room side of each door (the corridor side is on SPINE_X at the same height,
# except the bridge and engineering doors, which open onto the corridor's ends).
WORK = {'bridge': (153, 70), 'shields': (114, 137), 'weapons': (177, 128), 'sensors': (131, 180),
        'medbay': (175, 185), 'quarters': (110, 248), 'mess': (176, 244), 'cargo': (128, 300),
        'armory': (175, 300), 'engineering': (124, 362)}
# Room-side door points sit at least 1.5% inside the room: the walkable area stops 1% short of each wall.
DOOR = {'bridge': ((153.5, 75), (153.5, 89)), 'shields': ((133, 115), None), 'weapons': ((172, 115), None),
        'sensors': ((133, 171), None), 'medbay': ((172, 171), None), 'quarters': ((133, 231), None),
        'mess': ((172, 228), None), 'cargo': ((133, 286), None), 'armory': ((172, 288), None),
        'engineering': ((153.5, 333), (153.5, 319))}
FURNITURE = [
    ('bridge', 'forward-console', (141, 32, 166, 46)),
    ('bridge', 'port-console', (124, 38, 140, 57)),
    ('bridge', 'starboard-console', (168, 38, 184, 57)),
    ('bridge', 'pilot-seat', (148, 50, 158, 60)),
    ('shields', 'generator-core', (102, 99, 126, 131)),
    ('shields', 'port-cells', (87, 100, 97, 136)),
    ('weapons', 'port-rack', (175, 90, 193, 117)),
    ('weapons', 'starboard-rack', (196, 90, 213, 117)),
    ('weapons', 'gunnery-console', (181, 121, 198, 134)),
    ('weapons', 'ammo-locker', (205, 122, 216, 137)),
    ('sensors', 'holo-table', (98, 159, 127, 189)),
    ('sensors', 'port-consoles', (87, 160, 96, 196)),
    ('sensors', 'starboard-cabinet', (127, 149, 138, 162)),
    ('medbay', 'bed', (180, 158, 202, 192)),
    ('medbay', 'cabinet', (205, 149, 214, 167)),
    ('medbay', 'scanner', (207, 172, 219, 198)),
    ('quarters', 'bunks', (88, 207, 121, 236)),
    ('quarters', 'locker', (128, 206, 138, 227)),
    ('quarters', 'plant', (87, 238, 94, 252)),
    ('mess', 'shelf', (168, 206, 181, 219)),
    ('mess', 'galley', (187, 206, 209, 222)),
    ('mess', 'fridge', (211, 206, 221, 228)),
    ('mess', 'table', (183, 228, 206, 254)),
    ('mess', 'plant', (212, 230, 221, 250)),
    ('cargo', 'crates-fore', (87, 265, 112, 285)),
    ('cargo', 'crates-aft', (87, 300, 112, 314)),
    ('cargo', 'locker', (121, 265, 138, 283)),
    ('armory', 'locker', (170, 265, 180, 285)),
    ('armory', 'weapon-racks', (183, 265, 212, 292)),
    ('armory', 'wall-consoles', (214, 270, 221, 300)),
    ('armory', 'workbench', (181, 298, 203, 313)),
    ('engineering', 'reactor', (135, 336, 171, 378)),
    ('engineering', 'port-cabinets', (87, 330, 96, 381)),
    ('engineering', 'port-bench', (99, 369, 118, 381)),
    ('engineering', 'starboard-lockers', (186, 330, 208, 360)),
    ('engineering', 'starboard-wall', (210, 330, 221, 381)),
]
AIRLOCK = (60, 293)                # the hatch on the port hull beside cargo
THRUSTERS = [(93, 430), (132, 430), (175, 430), (214, 430)]


def main():
    art = Image.open(ART).convert('RGBA')
    w, h = art.size
    px = lambda x: round(x / w * 100, 1)
    py = lambda y: round(y / h * 100, 1)
    pt = lambda p: {'x': px(p[0]), 'y': py(p[1])}
    rect = lambda r: {'left': px(r[0]), 'top': py(r[1]), 'width': px(r[2] + 1) - px(r[0]), 'height': py(r[3] + 1) - py(r[1])}
    rooms = []
    for rid, label, r in ROOMS:
        room_pt, spine_pt = DOOR[rid]
        spine_pt = spine_pt or (SPINE_X, room_pt[1])
        rooms.append({'id': rid, 'label': label, **{k: round(v, 1) for k, v in rect(r).items()},
                      'workAnchor': pt(WORK[rid]), 'door': {'room': pt(room_pt), 'spine': pt(spine_pt)}})
    layout = {
        'image': 'art/ships/v5/sparrow-v5.png',
        'sourceSize': {'width': w * SCALE, 'height': h * SCALE},
        'spine': {k: round(v, 1) for k, v in rect(SPINE).items()},
        'rooms': rooms,
        'blockers': [{'id': f'{room}-{name}', 'room': room, **{k: round(v, 1) for k, v in rect(r).items()}}
                     for room, name, r in FURNITURE],
        'airlock': pt(AIRLOCK),
        'thrusters': [pt(t) for t in THRUSTERS],
    }
    (ROOT / 'src/data/art/sparrowV5Layout.json').write_text(json.dumps(layout, indent=2) + '\n')

    out = ROOT / 'public/art/ships/v5/sparrow-v5.png'
    out.parent.mkdir(parents=True, exist_ok=True)
    big = np.asarray(art.resize((w * SCALE, h * SCALE), Image.NEAREST)).copy()
    big[big[:, :, 3] == 0] = 0
    colours, index = np.unique(big.reshape(-1, 4), axis=0, return_inverse=True)
    pal = Image.fromarray(index.reshape(big.shape[:2]).astype('uint8'), 'P')
    pal.putpalette(colours[:, :3].astype('uint8').flatten().tolist())
    pal.save(out, optimize=True, transparency=bytes(int(a) for a in colours[:, 3]))

    k = 3
    qa = Image.new('RGBA', (w * k, h * k), (11, 18, 32, 255))
    qa.alpha_composite(art.resize((w * k, h * k), Image.NEAREST))
    d = ImageDraw.Draw(qa)
    box = lambda r, c, width=2: d.rectangle([r[0] * k, r[1] * k, (r[2] + 1) * k, (r[3] + 1) * k], outline=c, width=width)
    for _, _, r in ROOMS:
        box(r, (0, 255, 230, 255))
    box(SPINE, (255, 255, 255, 220))
    for _, _, r in FURNITURE:
        box(r, (255, 70, 200, 255))
    for rid, (room_pt, spine_pt) in DOOR.items():
        spine_pt = spine_pt or (SPINE_X, room_pt[1])
        d.line([room_pt[0] * k, room_pt[1] * k, spine_pt[0] * k, spine_pt[1] * k], fill=(255, 190, 60, 255), width=5)
    for x, y in WORK.values():
        d.ellipse([x * k - 6, y * k - 6, x * k + 6, y * k + 6], fill=(80, 255, 120, 255))
    for x, y in [AIRLOCK, *THRUSTERS]:
        d.ellipse([x * k - 6, y * k - 6, x * k + 6, y * k + 6], outline=(255, 255, 0, 255), width=3)
    qa_out = ROOT / 'docs/art/qa/sparrow-v5-layout.png'
    qa.convert('RGB').save(qa_out)
    print(f'{out.relative_to(ROOT)} {w * SCALE}x{h * SCALE}, {len(colours)} colours, {out.stat().st_size // 1024} KB')
    print(f'{len(rooms)} rooms, {len(FURNITURE)} furniture blocks; QA overlay {qa_out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
