#!/usr/bin/env python3
"""Install the Phase 3 art (cast and client portraits, faction and twist icons, scenes; 2026-10-10) into public/art.

    python3 apps/warpcrew/scripts/install-phase3-art.py

Reads docs/art/outputs/phase3-art-2026-10-10/prompts.json and its raw/ images, and installs them the way
scripts/install-phase2-art.py and the portrait pass do:
- portraits (kind "portrait"): scripts/pixel-snap.py --auto 3.5,8 --out-size 768 (own pixel grid, 40 colours, navy
  keyed to transparent) to public/art/pixel/<cast|clients>/<name>.png;
- icon sheets (kind "icons"): navy keyed out, split 2 x 2, each icon trimmed, shrunk to 256 px and cut to 256 colours
  to public/art/pixel/ui/<split>.png;
- scenes (kind "scene"): 1280 x 720 to public/art/pixel/cinematic/v2/<name>.png;
- the sprite (kind "sprite"): navy keyed out, trimmed, shrunk to 512 px to its "installs" path.
Deterministic: same raws, byte-identical files.
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/art/outputs/phase3-art-2026-10-10'
sys.dont_write_bytecode = True


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pixel_snap = load('pixel_snap', 'scripts/pixel-snap.py')
art_pass = load('install_art_pass', 'scripts/install-art-pass.py')

ICON_SIZE = 256
SCENE_SIZE = (1280, 720)
SPRITE_SIZE = 512
PORTRAIT_SIZE = 768


def keyed(raw):
    art = raw.convert('RGBA')
    bg = pixel_snap.key_background(np.asarray(raw.convert('RGB')).astype(float), art_pass.NAVY, 30)
    art.putalpha(Image.fromarray(np.where(bg, 0, 255).astype('uint8')))
    return art


def save256(img, out):
    out.parent.mkdir(parents=True, exist_ok=True)
    img.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, optimize=True)


def main():
    report = []

    def done(item, img, out, note=''):
        rel = str(out.relative_to(ROOT))
        report.append({'name': item['name'], 'file': rel, 'size': [img.width, img.height], 'bytes': out.stat().st_size})
        print(f'{rel}: {img.width}x{img.height}, {out.stat().st_size // 1024} KB{note}')

    for item in json.loads((OUT / 'prompts.json').read_text()):
        kind = item['kind']
        if kind == 'rejected':  # kept in raw/ for the record, never installed
            continue
        raw = Image.open(OUT / item['file']).convert('RGB')
        if kind == 'portrait':
            out = ROOT / item['installs']
            out.parent.mkdir(parents=True, exist_ok=True)
            art, cell, _, _ = pixel_snap.snap(np.asarray(raw).astype(float), None, (3.5, 8.0), 40)
            big = art.resize((PORTRAIT_SIZE, PORTRAIT_SIZE), Image.NEAREST)
            pixel_snap.save_palette_png(big, out)
            done(item, big, out, f', cell {cell:.2f}')
        elif kind == 'icons':
            art = keyed(raw)
            w, h = art.width // 2, art.height // 2
            quarters = [art.crop((x, y, x + w, y + h)) for y in (0, h) for x in (0, w)]
            for quarter, name in zip(quarters, item['splits']):
                img = art_pass.shrunk(art_pass.trim(quarter), ICON_SIZE)
                out = ROOT / 'public/art/pixel/ui' / f'{name}.png'
                save256(img, out)
                done(item, img, out)
        elif kind == 'scene':
            img = raw.convert('RGBA').resize(SCENE_SIZE, Image.LANCZOS)
            out = ROOT / 'public/art/pixel/cinematic/v2' / f"{item['name']}.png"
            save256(img, out)
            done(item, img, out)
        elif kind == 'sprite':
            img = art_pass.shrunk(art_pass.trim(keyed(raw), 8), SPRITE_SIZE)
            out = ROOT / item['installs']
            save256(img, out)
            done(item, img, out)
        else:
            raise SystemExit(f"unknown kind {kind!r} for {item['name']}")
    (OUT / 'install-report.json').write_text(json.dumps(report, indent=1) + '\n')
    contact_sheet(report)


def contact_sheet(report):
    """One review PNG of everything installed: portraits, icons, then scenes and the sprite, on a mid-grey checker."""
    from PIL import ImageDraw
    groups = [([r for r in report if '/cast/' in r['file'] or '/clients/' in r['file']], 4, 200),
              ([r for r in report if '/ui/' in r['file']], 8, 100),
              ([r for r in report if '/cinematic/' in r['file'] or '/ships/' in r['file']], 3, 190)]
    width = 800
    parts = []
    for rows, cols, cell in groups:
        n = len(rows)
        sheet = Image.new('RGB', (width, ((n + cols - 1) // cols) * cell), (58, 62, 74))
        cw = width // cols
        for i, r in enumerate(rows):
            img = Image.open(ROOT / r['file']).convert('RGBA')
            img.thumbnail((cw - 6, cell - 6))
            tile = Image.new('RGBA', img.size, (86, 90, 104, 255))
            tile.alpha_composite(img)
            x, y = (i % cols) * cw + 3, (i // cols) * cell + 3
            sheet.paste(tile.convert('RGB'), (x, y))
            ImageDraw.Draw(sheet).text((x + 3, y + 3), Path(r['file']).stem, fill=(255, 255, 255))
        parts.append(sheet)
    full = Image.new('RGB', (width, sum(p.height for p in parts)))
    y = 0
    for p in parts:
        full.paste(p, (0, y))
        y += p.height
    full.save(OUT / 'contact-sheet.png', optimize=True)


if __name__ == '__main__':
    main()
