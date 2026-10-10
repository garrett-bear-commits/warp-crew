#!/usr/bin/env python3
"""Install the Phase 2 art (shop, chests, calendar, achievements, welcome back; 2026-10-10) into public/art.

    python3 apps/warpcrew/scripts/install-phase2-art.py

Reads docs/art/outputs/phase2-art-2026-10-10/prompts.json and its raw/ images, and installs them the way
scripts/install-art-pass.py does: the navy background keyed out, sheets of four split, sprites trimmed, shrunk to
size and cut to 256 colours. Icons go to public/art/pixel/ui/<name>.png at 256 px (drawn at 40-112 points);
the welcome-back scene to public/art/pixel/cinematic/v2/welcome-back.png. Deterministic.
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/art/outputs/phase2-art-2026-10-10'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('install_art_pass', ROOT / 'scripts/install-art-pass.py')
art_pass = importlib.util.module_from_spec(spec)
spec.loader.exec_module(art_pass)

ICON_SIZE = 256
SCENE_WIDTH = 1280


def main():
    report = []
    for item in json.loads((OUT / 'prompts.json').read_text()):
        raw = Image.open(OUT / item['file']).convert('RGB')
        if not item['splits']:
            out = ROOT / 'public/art/pixel/cinematic/v2' / f"{item['name']}.png"
            img = art_pass.shrunk(raw.convert('RGBA'), SCENE_WIDTH)
            parts = [(img, out)]
        else:
            art = raw.convert('RGBA')
            bg = art_pass.pixel_snap.key_background(np.asarray(raw).astype(float), art_pass.NAVY, 30)
            art.putalpha(Image.fromarray(np.where(bg, 0, 255).astype('uint8')))
            w, h = art.width // 2, art.height // 2
            quarters = [art.crop((x, y, x + w, y + h)) for y in (0, h) for x in (0, w)]
            parts = [(art_pass.shrunk(art_pass.trim(q), ICON_SIZE), ROOT / 'public/art/pixel/ui' / f'{name}.png')
                     for q, name in zip(quarters, item['splits'])]
        for img, out in parts:
            out.parent.mkdir(parents=True, exist_ok=True)
            img.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, optimize=True)
            rel = str(out.relative_to(ROOT))
            report.append({'name': item['name'], 'file': rel, 'size': [img.width, img.height], 'bytes': out.stat().st_size})
            print(f'{rel}: {img.width}x{img.height}, {out.stat().st_size // 1024} KB')
    (OUT / 'install-report.json').write_text(json.dumps(report, indent=1) + '\n')


if __name__ == '__main__':
    main()
