#!/usr/bin/env python3
"""Install the 2026-10-09 style C art pass (everything after the portraits and the Sparrow) into public/art.

    python3 apps/warpcrew/scripts/install-art-pass.py

Reads docs/art/outputs/art-pass-2026-10-09/prompts.json (every image's prompt, Flora run and target) and its raw/
images. Sprites have their navy generation background keyed to transparent (scripts/pixel-snap.py's flood fill from
the border) and are trimmed; sheets of four are split; every image is shrunk to its target size if larger and cut to
256 colours. These images are not snapped to a pixel grid the way the portraits were: the model drew them at about
2-3 px per art pixel, every grid search locked onto twice that (halving the detail), and the game always draws them
smaller than their raw size anyway (see the ledger). Deterministic: same raws, byte-identical files.
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/art/outputs/art-pass-2026-10-09'
sys.dont_write_bytecode = True  # no scripts/__pycache__ from loading pixel-snap.py
spec = importlib.util.spec_from_file_location('pixel_snap', ROOT / 'scripts/pixel-snap.py')
pixel_snap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pixel_snap)

NAVY = (11, 18, 32)  # the brief's background, #0b1220
# kind: (key the navy background and trim to the sprite, target long side in px, split 2 x 2 into these names)
KINDS = {
    'enemy': (True, 1024, None),
    'topdown': (True, 768, None),
    'splash': (False, 1280, None),
    'cinematic': (False, 1280, None),
    'ship': (True, 360, None),
    'planet-hero': (True, 512, None),
    'planet-ice': (True, 256, None),
    'swarm-fx': (True, 256, None),
    'asteroids': (True, 128, ['asteroid-1', 'asteroid-2', 'asteroid-3', 'asteroid-4']),
    'icons-currency': (True, 128, ['credits', 'fuel', 'gems', 'medals']),
    'icons-node': (True, 128, ['node-wreck', 'node-crystal', 'node-station', 'node-planet']),
}


def kind_of(name):
    return next(k for k in sorted(KINDS, key=len, reverse=True) if name == k or name.startswith(k + '-'))


def trim(img, margin=16):
    """Crop to the opaque pixels plus a margin, so the corners stay transparent after shrinking."""
    alpha = np.asarray(img)[:, :, 3]
    ys, xs = np.nonzero(alpha)
    return img.crop((max(0, xs.min() - margin), max(0, ys.min() - margin),
                     min(img.width, xs.max() + 1 + margin), min(img.height, ys.max() + 1 + margin)))


def shrunk(img, target):
    f = min(1.0, target / max(img.width, img.height))
    return img if f == 1.0 else img.resize((round(img.width * f), round(img.height * f)), Image.LANCZOS)


def main():
    items = json.loads((OUT / 'prompts.json').read_text())
    report = []
    for item in items:
        key, target, split = KINDS[kind_of(item['name'])]
        raw = Image.open(OUT / item['file']).convert('RGB')
        art = raw.convert('RGBA')
        if key:
            bg = pixel_snap.key_background(np.asarray(raw).astype(float), NAVY, 30)
            art.putalpha(Image.fromarray(np.where(bg, 0, 255).astype('uint8')))
        if split:
            w, h = art.width // 2, art.height // 2
            parts = [art.crop((x, y, x + w, y + h)) for y in (0, h) for x in (0, w)]
            targets = [str(Path(item['installs_to']).parent / f'{n}.png') for n in split]
        else:
            parts, targets = [art], [item['installs_to']]
        for part, target_path in zip(parts, targets):
            out = ROOT / target_path
            out.parent.mkdir(parents=True, exist_ok=True)
            img = shrunk(trim(part) if key else part, target)
            img.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, optimize=True)
            report.append({'name': item['name'], 'file': target_path, 'size': [img.width, img.height], 'bytes': out.stat().st_size})
            print(f'{target_path}: {img.width}x{img.height}, {out.stat().st_size // 1024} KB')
    (OUT / 'install-report.json').write_text(json.dumps(report, indent=1) + '\n')


if __name__ == '__main__':
    main()
