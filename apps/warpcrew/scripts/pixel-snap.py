#!/usr/bin/env python3
"""Snap a generated "pixel art" image onto a real pixel grid, cut its palette and key out its background.

Image models draw pixel art as soft, slightly uneven blocks. This turns one into true pixel art: one colour per
art pixel, a limited palette and a transparent background (docs/art/2026-10-09-style-mockup-brief.md, clean-up).

Usage:
    python3 apps/warpcrew/scripts/pixel-snap.py IN.png OUT.png --cell 4.1
    python3 apps/warpcrew/scripts/pixel-snap.py IN.png OUT.png --cell 2.3 --colours 48 --preview OUT-x.png

OUT.png is written at art-pixel size (e.g. 1024 px / 4.1 = 250 px across). --preview also writes a
nearest-neighbour upscale back to the input size, for side-by-side review. Requires Python 3, numpy and Pillow.

How it works:
 1. Grid: starting from the --cell estimate (eyeball a zoomed crop), the cell size and offset are refined per axis
    to put the most colour edges on cell boundaries.
 2. Each cell becomes the median colour of its inside (its one-pixel rim is skipped where neighbours bleed in).
 3. Palette: k-means in OKLab, with vivid and bright pixels weighted up so small accents (console glow, engine
    fire, hazard stripes) keep their own colour; each palette entry is a real colour from the image.
 4. Background: colours near the key (default the brief's navy #0b1220) connected to the border become
    transparent. Alpha is always 0 or 255.
"""
import argparse
from collections import deque

import numpy as np
from PIL import Image


def to_oklab(rgb):
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                   [0.2119034982, 0.6806995451, 0.1073969566],
                   [0.0883024619, 0.2817188376, 0.6299787005]])
    m2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                   [1.9779984951, -2.4285922050, 0.4505937099],
                   [0.0259040371, 0.7827717662, -0.8086757660]])
    return np.cbrt(lin @ m1.T) @ m2.T


def refine_grid(profile, estimate):
    """Best (score, cell, offset) for one axis: the share of edge strength that falls on cell boundaries."""
    best = (0.0, estimate, 0.0)
    for cell in np.arange(estimate * 0.96, estimate * 1.04, 0.005):
        for offset in np.arange(0, cell, 0.25):
            idx = np.round(np.arange(offset, len(profile), cell)).astype(int) - 1
            idx = idx[(idx >= 0) & (idx < len(profile))]
            score = profile[idx].mean() / profile.mean()
            if score > best[0]:
                best = (score, cell, offset)
    return best


def cell_colours(rgb, cell, off_x, off_y):
    h, w, _ = rgb.shape
    xs = np.unique(np.clip(np.round(np.arange(off_x - cell, w + cell, cell)).astype(int), 0, w))
    ys = np.unique(np.clip(np.round(np.arange(off_y - cell, h + cell, cell)).astype(int), 0, h))
    small = np.zeros((len(ys) - 1, len(xs) - 1, 3))
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            y0, y1, x0, x1 = ys[j], ys[j + 1], xs[i], xs[i + 1]
            if y1 - y0 >= 4 and x1 - x0 >= 4:
                y0, y1, x0, x1 = y0 + 1, y1 - 1, x0 + 1, x1 - 1
            small[j, i] = np.median(rgb[y0:y1, x0:x1].reshape(-1, 3), axis=0)
    return small


def kmeans_palette(img, k, iters=20, seed=7):
    px = img.reshape(-1, 3)
    lab = to_oklab(px)
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    weight = 1 + 12 * chroma + 3 * np.clip(lab[:, 0] - 0.75, 0, 1)
    rng = np.random.default_rng(seed)
    centres = [lab[rng.choice(len(lab), p=weight / weight.sum())]]
    d2 = ((lab - centres[0]) ** 2).sum(1)
    for _ in range(k - 1):
        p = weight * d2
        centres.append(lab[rng.choice(len(lab), p=p / p.sum())])
        d2 = np.minimum(d2, ((lab - centres[-1]) ** 2).sum(1))
    centres = np.array(centres)
    for _ in range(iters):
        label = np.argmin(((lab[:, None, :] - centres[None]) ** 2).sum(2), axis=1)
        for j in range(k):
            m = label == j
            if m.any():
                centres[j] = (lab[m] * weight[m, None]).sum(0) / weight[m].sum()
    label = np.argmin(((lab[:, None, :] - centres[None]) ** 2).sum(2), axis=1)
    palette = np.zeros((k, 3))
    for j in range(k):
        members = np.where(label == j)[0]
        if len(members):
            palette[j] = px[members[np.argmin(((lab[members] - centres[j]) ** 2).sum(1))]]
    return palette[label].reshape(img.shape).round().astype(int)


def key_background(rgb, key, max_dist):
    h, w, _ = rgb.shape
    dist = np.sqrt(((rgb - np.array(key)) ** 2).sum(axis=2))
    bg = np.zeros((h, w), bool)
    todo = deque([(y, x) for x in range(w) for y in (0, h - 1)] + [(y, x) for y in range(h) for x in (0, w - 1)])
    while todo:
        y, x = todo.popleft()
        if bg[y, x] or dist[y, x] > max_dist:
            continue
        bg[y, x] = True
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx]:
                todo.append((ny, nx))
    return bg


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('input')
    ap.add_argument('output')
    ap.add_argument('--cell', type=float, required=True, help='estimated art-pixel size in input pixels')
    ap.add_argument('--colours', type=int, default=40)
    ap.add_argument('--key', default='0b1220', help='background colour to key out (hex), or "none"')
    ap.add_argument('--key-dist', type=float, default=30)
    ap.add_argument('--preview', help='also write a nearest-neighbour upscale to the input size')
    args = ap.parse_args()

    rgb = np.asarray(Image.open(args.input).convert('RGB')).astype(float)
    grey = rgb.mean(axis=2)
    sx = refine_grid(np.abs(np.diff(grey, axis=1)).sum(axis=0), args.cell)
    sy = refine_grid(np.abs(np.diff(grey, axis=0)).sum(axis=1), args.cell)
    cell = (sx[1] + sy[1]) / 2
    small = cell_colours(rgb, cell, sx[2], sy[2])
    snapped = kmeans_palette(small.clip(0, 255), args.colours)
    if args.key == 'none':
        bg = np.zeros(snapped.shape[:2], bool)
    else:
        bg = key_background(snapped, tuple(int(args.key[i:i + 2], 16) for i in (0, 2, 4)), args.key_dist)
    out = Image.fromarray(np.dstack([snapped, np.where(bg, 0, 255)]).astype('uint8'), 'RGBA')
    out.save(args.output)
    if args.preview:
        h, w, _ = rgb.shape
        out.resize((round(out.width * cell), round(out.height * cell)), Image.NEAREST).crop((0, 0, w, h)).save(args.preview)
    colours = len({tuple(p) for p in snapped[~bg]})
    print(f'{args.input}: cell {cell:.3f} (edge scores {sx[0]:.2f}/{sy[0]:.2f}), art size {out.width}x{out.height}, '
          f'{colours} colours, {bg.mean() * 100:.0f}% background keyed')


if __name__ == '__main__':
    main()
