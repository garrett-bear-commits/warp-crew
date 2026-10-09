#!/usr/bin/env python3
"""Key a baked-in hot-pink/magenta chroma-key background out of pixel-art PNGs.

Some generated crew portraits came back with an opaque magenta square behind the
character instead of a transparent background. This script turns that square into
fully transparent pixels and cleans the magenta fringe on the character's edge,
without resampling or blurring (image size and crispness are unchanged).

Usage:
    python3 apps/warpcrew/scripts/key-portrait-magenta.py FILE.png [FILE.png ...]
    python3 apps/warpcrew/scripts/key-portrait-magenta.py --check FILE.png ...   # report only, write nothing

Files are overwritten in place. Requires Python 3 and Pillow.

How it works:
 1. The key colour is estimated per image (median of the opaque border pixels that
    look magenta). The key is slightly noisy / has a gradient, so matching uses a
    colour distance, not an exact value.
 2. Background = key-like pixels connected to the image border (flood fill), plus
    enclosed key-like pockets of a minimum size (gaps between an arm and the body).
    Pixels are only ever removed if they are key-like AND connected to the
    background (or in a sizeable key-coloured pocket), so the character's own
    colours are not touched.
 3. Fringe: for the 3 pixels next to the removed background, estimate how much
    magenta each pixel carries ("spill" = min(R,B) - G). Mostly-magenta pixels become
    transparent; lightly tinted ones are un-mixed from the local key colour so no
    pink halo remains. Alpha is always 0 or 255 (crisp pixel art).
"""
import sys
from collections import deque
from statistics import median

from PIL import Image

KEY_DIST = 90        # max RGB distance from the key colour to count as background
POCKET_DIST = 60     # stricter distance for enclosed pockets (not touching the border)
POCKET_MIN = 1       # smallest enclosed pocket (pixels) that is removed
FRINGE_RADIUS = 3    # how far from the background the fringe cleaning reaches
DROP_T = 0.45        # fringe pixels at least this much magenta become transparent
CLEAN_T = 0.04       # fringe pixels with less than this are left untouched


def is_magentaish(p):
    r, g, b, a = p
    return a > 200 and r > 170 and g < 90 and 90 < b < 210 and r - g > 120


def distance(p, key):
    return ((p[0] - key[0]) ** 2 + (p[1] - key[1]) ** 2 + (p[2] - key[2]) ** 2) ** 0.5


def spill(p):
    return min(p[0], p[2]) - p[1]


def border_pixels(px, w, h):
    for x in range(w):
        yield px[x, 0]
        yield px[x, h - 1]
    for y in range(h):
        yield px[0, y]
        yield px[w - 1, y]


def estimate_key(px, w, h):
    pts = [p for p in border_pixels(px, w, h) if is_magentaish(p)]
    if len(pts) < (2 * (w + h)) * 0.05:
        return None
    return tuple(median(p[i] for p in pts) for i in range(3))


def neighbors4(x, y, w, h):
    if x > 0:
        yield x - 1, y
    if x < w - 1:
        yield x + 1, y
    if y > 0:
        yield x, y - 1
    if y < h - 1:
        yield x, y + 1


def flood(seeds, ok, w, h):
    seen = set(seeds)
    q = deque(seeds)
    while q:
        x, y = q.popleft()
        for n in neighbors4(x, y, w, h):
            if n not in seen and ok(n):
                seen.add(n)
                q.append(n)
    return seen


def key_image(im):
    """Return (new_image, stats) or (None, None) if the image has no magenta background."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    key = estimate_key(px, w, h)
    if key is None:
        return None, None

    def keylike(pt, d=KEY_DIST):
        p = px[pt]
        # mostly-transparent leftovers (a partial earlier key-out) count as background too
        return p[3] < 128 or distance(p, key) <= d

    # 1. background connected to the border
    seeds = []
    for x in range(w):
        seeds += [(x, 0), (x, h - 1)]
    for y in range(h):
        seeds += [(0, y), (w - 1, y)]
    seeds = [s for s in seeds if keylike(s)]
    bg = flood(seeds, keylike, w, h)

    # 2. enclosed key-coloured pockets (e.g. between an arm and the torso)
    pockets = 0
    visited = set(bg)
    for y in range(h):
        for x in range(w):
            if (x, y) in visited or not keylike((x, y), POCKET_DIST):
                continue
            comp = flood([(x, y)], lambda n: n not in visited and keylike(n, POCKET_DIST), w, h)
            visited |= comp
            if len(comp) >= POCKET_MIN:
                bg |= comp
                pockets += 1

    # local key estimate for each fringe pixel (mean of nearby background pixels)
    def local_key(x, y):
        acc = [0, 0, 0]
        n = 0
        for yy in range(max(0, y - 4), min(h, y + 5)):
            for xx in range(max(0, x - 4), min(w, x + 5)):
                if (xx, yy) in bg:
                    p = px[xx, yy]
                    acc[0] += p[0]
                    acc[1] += p[1]
                    acc[2] += p[2]
                    n += 1
        if n == 0:
            return key
        return tuple(c / n for c in acc)

    # 3. fringe = non-background pixels within FRINGE_RADIUS (chebyshev) of the background
    fringe = set()
    for (bx, by) in bg:
        for yy in range(max(0, by - FRINGE_RADIUS), min(h, by + FRINGE_RADIUS + 1)):
            for xx in range(max(0, bx - FRINGE_RADIUS), min(w, bx + FRINGE_RADIUS + 1)):
                if (xx, yy) not in bg:
                    fringe.add((xx, yy))

    out = im.copy()
    op = out.load()
    for (x, y) in bg:
        op[x, y] = (0, 0, 0, 0)

    dropped = cleaned = 0
    drop_more = []
    for (x, y) in fringe:
        p = px[x, y]
        if p[3] == 0:
            continue
        k = local_key(x, y)
        ref = max(1.0, spill(k))
        t = max(0.0, min(1.0, spill(p) / ref))
        # pixels that are not tinted towards the key (skin, orange, navy...) are left alone
        if t >= DROP_T and distance(p, k) <= KEY_DIST * 1.3:
            drop_more.append((x, y))
        elif t >= CLEAN_T:
            # un-mix: p = t*key + (1-t)*fg  ->  fg
            fg = [(p[i] - t * k[i]) / (1 - t) for i in range(3)]
            # remove any remaining magenta cast: R and B may not exceed G by more than the
            # character's own colour would; clamp them back towards G
            s = max(0, min(fg[0], fg[2]) - fg[1])
            fg[0] -= s
            fg[2] -= s
            op[x, y] = tuple(max(0, min(255, int(round(c)))) for c in fg) + (255,)
            cleaned += 1
    for pt in drop_more:
        op[pt] = (0, 0, 0, 0)
        dropped += 1

    # 4. drop fully-transparent pixels' colour (keeps PNGs tidy and avoids halo on resampling)
    for y in range(h):
        for x in range(w):
            if op[x, y][3] == 0:
                op[x, y] = (0, 0, 0, 0)

    return out, {'key': tuple(int(c) for c in key), 'background': len(bg), 'pockets': pockets,
                 'fringe_dropped': dropped, 'fringe_cleaned': cleaned}


def main(argv):
    check = '--check' in argv
    files = [a for a in argv if not a.startswith('--')]
    if not files:
        print(__doc__)
        return 2
    for f in files:
        im = Image.open(f)
        size = im.size
        out, stats = key_image(im)
        if out is None:
            print(f'{f}: no magenta background found, left untouched')
            continue
        assert out.size == size
        if check:
            print(f'{f}: magenta background found {stats}')
        else:
            out.save(f, optimize=True)
            print(f'{f}: keyed {stats}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
