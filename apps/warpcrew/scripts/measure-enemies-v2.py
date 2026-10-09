#!/usr/bin/env python3
"""Write the enemy ships' target rooms and gun mounts for the style C enemy art (2026-10-09).

    python3 apps/warpcrew/scripts/measure-enemies-v2.py

Run after scripts/install-art-pass.py. Every box below is measured on the installed image
(public/art/enemies/v2/<family>.png), in percent of its width and height, on the room the art draws for it
(docs/art/qa/enemies-v2-layout.png shows them over the art). The script updates the families in
src/data/art/enemyLayouts.json (image, size, rooms, mounts) and keeps its encounter map.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
LAYOUTS = ROOT / 'src/data/art/enemyLayouts.json'

# family: {room: (left, top, width, height)}, [gun mounts (x, y)], all in percent.
SHIPS = {
    'pirate': ({'weapons': (14, 30, 18, 40), 'helm': (34.5, 24, 14, 22), 'shields': (51, 24, 13, 47), 'engines': (66, 24, 19, 47)},
               [(20, 23), (13, 39), (13, 61), (20, 77)]),
    'scrapper': ({'weapons': (16, 29, 17, 40), 'shields': (35.5, 20, 14, 24), 'helm': (35.5, 53, 14, 19), 'engines': (73, 37, 10, 36)},
                 [(15, 24), (20, 37), (11, 70)]),
    'swarm': ({'weapons': (16, 32, 15, 32), 'shields': (40, 20, 12, 22), 'helm': (49.5, 45, 9.5, 18), 'engines': (65, 21, 13, 22)},
              [(9, 38), (9, 54)]),
    'ice': ({'helm': (19, 33, 14, 26), 'weapons': (35, 22, 20, 25), 'shields': (57, 21, 13, 27), 'engines': (72, 22, 15, 57)},
            [(12, 43), (12, 55)]),
    'shade': ({'helm': (16, 37, 15, 20), 'weapons': (36, 22, 18, 23), 'shields': (56, 21, 13, 25), 'engines': (38, 51, 27, 24)},
              [(9, 41), (9, 50)]),
    'crown': ({'weapons': (12, 36, 17, 28), 'helm': (49, 15, 15, 29), 'shields': (49, 52, 15, 27), 'engines': (71, 33, 17, 34)},
              [(21, 29), (8, 50), (21, 71)]),
}


def main():
    layouts = json.loads(LAYOUTS.read_text())
    sheet = []
    for family, (rooms, mounts) in SHIPS.items():
        image = f'art/enemies/v2/{family}.png'
        art = Image.open(ROOT / 'public' / image).convert('RGBA')
        layouts[family] = {
            'image': image,
            'sourceSize': {'width': art.width, 'height': art.height},
            'rooms': [{'id': rid, 'left': box[0], 'top': box[1], 'width': box[2], 'height': box[3]} for rid, box in rooms.items()],
            'mounts': [{'x': x, 'y': y} for x, y in mounts],
        }
        qa = Image.new('RGBA', art.size, (11, 18, 32, 255))
        qa.alpha_composite(art)
        d = ImageDraw.Draw(qa)
        sx, sy = art.width / 100, art.height / 100
        for rid, (left, top, width, height) in rooms.items():
            d.rectangle([left * sx, top * sy, (left + width) * sx, (top + height) * sy], outline=(0, 255, 230, 255), width=4)
            d.text((left * sx + 6, top * sy + 4), rid, fill=(255, 255, 255, 255))
        for x, y in mounts:
            d.ellipse([x * sx - 8, y * sy - 8, x * sx + 8, y * sy + 8], outline=(255, 255, 0, 255), width=3)
        sheet.append(qa.resize((960, round(art.height * 960 / art.width))))
    # One family per line, as before.
    LAYOUTS.write_text('{\n' + ',\n'.join(f'  {json.dumps(key)}: {json.dumps(value)}' for key, value in layouts.items()) + '\n}\n')
    out = Image.new('RGB', (960, sum(im.height for im in sheet)))
    y = 0
    for im in sheet:
        out.paste(im.convert('RGB'), (0, y))
        y += im.height
    out.save(ROOT / 'docs/art/qa/enemies-v2-layout.png')
    print(f'{len(SHIPS)} enemy ships measured; overlay docs/art/qa/enemies-v2-layout.png')


if __name__ == '__main__':
    main()
