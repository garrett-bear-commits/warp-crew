#!/usr/bin/env python3
"""Sample each crew portrait for the colours its walking figure should wear.

The portraits (public/art/pixel/crew-v2/<name>.png, 768x768, style C) are the
art direction; the figures baked by build_crew_sheets.py must read as the same
person. This script samples the dominant colour inside a rough region of each
portrait per role (hair, skin, top, ...) and writes
scripts/crew-rig/portrait_palettes.json, which the bake reads. Rerun it only
when the portraits change; the output is deterministic.

    python3 scripts/crew-rig/sample_portrait_palettes.py            # write the json
    python3 scripts/crew-rig/sample_portrait_palettes.py --review out.png   # + sampled regions and swatches

A role is sampled from a region (x0, y0, x1, y1 as fractions of the 768px
portrait), optionally with a mode: 'dom' (most common colour, default), 'sat'
(most saturated common colour) or 'light' (brightest common colour). A role may
also be a fixed '#rrggbb'. Roles missing for a look fall back to the family
defaults below, and the bake derives anything still missing from the top colour.

Roles: hair, skin (face / plating), top (jacket, robe, chest plating), pants,
pad (shoulder pads, vest, headset, helmet shell), trim (sash, scarf, crest),
glow (visor, optics, cyber eye).
"""
import argparse
import colorsys
import json
import os
import re

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORTRAITS = os.path.join(ROOT, 'public', 'art', 'pixel', 'crew-v2')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'portrait_palettes.json')

ROLES = ['hair', 'skin', 'top', 'pants', 'pad', 'trim', 'fin', 'glow']
BOX = {'hair': (255, 80, 80), 'skin': (80, 255, 80), 'top': (80, 160, 255), 'pants': (255, 80, 255), 'pad': (255, 255, 80),
       'trim': (80, 255, 255), 'fin': (255, 160, 80), 'glow': (255, 255, 255)}
DEFAULT = {
    'hair': 'headtop',
    'skin': (0.38, 0.22, 0.62, 0.4),
    'top': (0.15, 0.75, 0.85, 1.0),
}

# look -> role -> '#hex' | region | (region, mode). Regions are read off the
# portraits on a 10% grid (fractions of the 768px image). The few fixed hexes are
# silver / pale-cream colours whose lit edges are warm and shadows violet, so a
# region sample comes out pink; they were picked off the portrait by eye.
LOOKS = {
    # ---- captains
    'captain_cyborg': {'skin': (0.4, 0.28, 0.58, 0.42), 'top': (0.02, 0.7, 0.35, 0.95),
                       'pants': (0.4, 0.75, 0.6, 1.0), 'glow': ((0.52, 0.3, 0.65, 0.4), 'sat')},
    'captain_gunner': {'hair': '#3a1118', 'skin': (0.5, 0.22, 0.65, 0.4), 'top': (0.02, 0.7, 0.3, 0.97)},
    'captain_alien': {'skin': (0.3, 0.1, 0.55, 0.22), 'top': (0.0, 0.72, 0.4, 1.0), 'trim': ((0.4, 0.74, 0.65, 0.97), 'light')},
    'captain_droid': {'skin': (0.2, 0.08, 0.6, 0.22), 'top': (0.25, 0.65, 0.7, 0.9), 'glow': ((0.35, 0.28, 0.65, 0.4), 'sat'),
                      'pad': (0.5, 0.72, 0.64, 0.86)},
    # ---- humans
    'merc_rex': {'skin': (0.35, 0.3, 0.55, 0.45), 'top': (0.02, 0.65, 0.35, 0.95),
                 'pants': (0.35, 0.72, 0.5, 0.95)},
    'merc_jen': {'skin': (0.36, 0.27, 0.58, 0.46), 'top': (0.1, 0.72, 0.5, 0.98),
                 'pants': (0.85, 0.7, 1.0, 0.95)},
    'merc_kira': {'hair': ('headtop', 'sat'), 'skin': (0.45, 0.24, 0.65, 0.42), 'top': (0.8, 0.68, 0.98, 0.97),
                  'pants': (0.8, 0.68, 0.98, 0.97), 'pad': ((0.3, 0.6, 0.7, 0.97), 'sat')},
    # rook, greaves, oso and ashen are baked with a helmet shell the portraits do not have:
    # the shell wears the hair colour so the head still reads right
    'merc_rook': {'skin': (0.35, 0.22, 0.55, 0.36), 'top': (0.05, 0.65, 0.45, 1.0), 'pad': 'headtop'},
    'merc_isa': {'skin': (0.47, 0.3, 0.62, 0.45), 'top': (0.1, 0.72, 0.9, 1.0),
                 'pad': ((0.25, 0.03, 0.65, 0.15), 'sat')},
    'merc_lora': {'skin': (0.45, 0.24, 0.65, 0.45), 'top': (0.05, 0.7, 0.5, 1.0)},
    'merc_onyx': {'hair': '#cbb8ac', 'skin': (0.28, 0.3, 0.45, 0.47), 'top': (0.15, 0.72, 0.9, 1.0),
                  'pad': ((0.05, 0.72, 0.2, 0.9), 'sat'), 'glow': ((0.42, 0.33, 0.55, 0.45), 'sat')},
    'merc_tess': {'skin': (0.33, 0.25, 0.5, 0.42), 'top': (0.05, 0.65, 0.95, 1.0)},
    'merc_dax': {'skin': (0.28, 0.25, 0.46, 0.42), 'top': (0.0, 0.7, 0.35, 1.0), 'pad': (0.78, 0.75, 0.9, 1.0)},
    'merc_pip': {'hair': ('headtop', 'sat'), 'skin': (0.42, 0.27, 0.6, 0.45), 'top': (0.05, 0.7, 0.5, 1.0)},
    'merc_juno': {'skin': (0.42, 0.27, 0.62, 0.45), 'top': (0.02, 0.62, 0.3, 0.95)},
    'merc_greaves': {'skin': (0.33, 0.2, 0.58, 0.42), 'pad': 'headtop'},
    'merc_yara': {'skin': (0.28, 0.27, 0.45, 0.45), 'top': (0.03, 0.68, 0.95, 1.0),
                  'pants': (0.35, 0.7, 0.5, 1.0)},
    'merc_brink': {'skin': (0.3, 0.3, 0.5, 0.45), 'pad': (0.58, 0.2, 0.75, 0.42)},
    'merc_oso': {'skin': (0.3, 0.22, 0.5, 0.4), 'pad': 'headtop'},
    'merc_orla': {'skin': (0.38, 0.25, 0.55, 0.45), 'top': (0.1, 0.72, 0.9, 1.0)},
    'merc_kal': {'skin': (0.3, 0.27, 0.5, 0.47),
                 'pad': ((0.7, 0.78, 0.88, 0.88), 'sat')},
    'merc_moth': {'skin': (0.3, 0.36, 0.5, 0.5), 'top': (0.1, 0.7, 0.9, 1.0)},
    'merc_rune': {'skin': (0.3, 0.22, 0.5, 0.42), 'top': (0.3, 0.65, 0.7, 0.95),
                  'pants': (0.02, 0.55, 0.2, 0.9)},
    'merc_ashen': {'skin': (0.35, 0.25, 0.6, 0.42), 'pad': 'headtop'},
    'merc_solace': {'skin': (0.38, 0.38, 0.55, 0.5), 'top': (0.05, 0.68, 0.8, 0.95),
                    'pants': (0.3, 0.62, 0.45, 0.9), 'glow': ((0.28, 0.25, 0.55, 0.35), 'sat')},
    'merc_harrow': {'hair': '#a89a96', 'skin': (0.42, 0.22, 0.62, 0.4), 'top': (0.02, 0.7, 0.45, 1.0)},
    # ---- aliens
    'merc_plip': {'skin': (0.3, 0.1, 0.6, 0.28), 'top': (0.02, 0.82, 0.3, 1.0), 'trim': ((0.25, 0.68, 0.7, 0.88), 'sat')},
    'merc_syla': {'skin': (0.4, 0.18, 0.62, 0.4), 'top': (0.15, 0.65, 0.85, 0.95), 'trim': ((0.4, 0.2, 0.62, 0.4), 'light'),
                  'glow': ((0.42, 0.36, 0.66, 0.47), 'sat')},
    'merc_nemi': {'skin': (0.4, 0.1, 0.58, 0.25), 'top': (0.05, 0.65, 0.95, 1.0), 'trim': ((0.44, 0.6, 0.56, 0.9), 'sat'),
                  'glow': '#ffb830'},
    'merc_vorn': {'skin': (0.4, 0.12, 0.62, 0.35), 'top': (0.2, 0.6, 0.85, 0.95), 'trim': ((0.05, 0.55, 0.25, 0.85), 'sat'),
                  'glow': ((0.45, 0.28, 0.65, 0.38), 'sat')},
    'merc_quill': {'skin': (0.3, 0.1, 0.65, 0.3), 'top': (0.02, 0.68, 0.3, 0.95), 'trim': ((0.3, 0.05, 0.5, 0.15), 'light'),
                   'glow': ((0.45, 0.33, 0.6, 0.42), 'sat')},
    'merc_drift': {'skin': (0.3, 0.12, 0.5, 0.3), 'top': (0.3, 0.62, 0.8, 0.95)},
    'merc_skarn': {'skin': (0.4, 0.2, 0.7, 0.5), 'top': (0.2, 0.65, 0.9, 1.0), 'trim': ((0.1, 0.1, 0.3, 0.45), 'light'),
                   'glow': ((0.55, 0.1, 0.7, 0.25), 'sat')},
    'merc_wisp': {'skin': (0.3, 0.15, 0.7, 0.5), 'top': (0.2, 0.7, 0.9, 1.0), 'trim': '#d8eeff', 'glow': '#9fe6ff'},
    'merc_zephyr': {'skin': (0.4, 0.22, 0.6, 0.4), 'top': (0.05, 0.7, 0.95, 1.0), 'fin': ((0.3, 0.02, 0.7, 0.15), 'light'),
                    'trim': ((0.2, 0.7, 0.5, 0.9), 'sat'), 'glow': ((0.4, 0.25, 0.65, 0.42), 'sat')},
    'merc_vex': {'skin': (0.3, 0.3, 0.5, 0.55), 'top': (0.0, 0.75, 0.35, 1.0), 'trim': ((0.35, 0.75, 0.55, 0.97), 'sat'),
                 'glow': ((0.3, 0.28, 0.5, 0.38), 'sat')},
    'merc_nyx': {'skin': (0.3, 0.25, 0.5, 0.45), 'top': (0.1, 0.7, 0.9, 1.0), 'glow': ((0.3, 0.28, 0.55, 0.4), 'sat')},
    'merc_eclipse': {'skin': (0.4, 0.05, 0.6, 0.35), 'top': (0.2, 0.62, 0.8, 1.0), 'trim': ((0.1, 0.5, 0.9, 1.0), 'sat'),
                     'glow': ((0.35, 0.2, 0.65, 0.3), 'sat')},
    'merc_voidwake': {'skin': (0.45, 0.27, 0.62, 0.45), 'top': (0.05, 0.7, 0.95, 1.0), 'trim': ((0.3, 0.72, 0.7, 1.0), 'sat')},
    # ---- droids
    'merc_bolt': {'skin': (0.25, 0.08, 0.58, 0.3), 'top': (0.25, 0.62, 0.9, 0.95), 'glow': ((0.24, 0.34, 0.5, 0.42), 'sat')},
    'merc_moss': {'skin': (0.35, 0.05, 0.6, 0.15), 'top': (0.35, 0.62, 0.85, 0.9), 'glow': ((0.55, 0.25, 0.75, 0.45), 'sat'),
                  'pad': ((0.65, 0.65, 0.95, 0.8), 'sat')},
    'merc_cog': {'skin': (0.3, 0.1, 0.65, 0.3), 'top': (0.25, 0.65, 0.6, 0.95), 'glow': ((0.35, 0.35, 0.65, 0.5), 'sat'),
                 'pad': (0.05, 0.75, 0.25, 0.95)},
    'merc_hex': {'skin': (0.25, 0.05, 0.65, 0.15), 'top': (0.2, 0.62, 0.7, 0.95), 'glow': ((0.4, 0.27, 0.7, 0.4), 'sat'),
                 'pad': ((0.02, 0.6, 0.15, 0.9), 'sat')},
    'merc_ada': {'skin': (0.3, 0.12, 0.45, 0.3), 'top': (0.15, 0.68, 0.4, 0.85), 'glow': ((0.3, 0.3, 0.7, 0.5), 'sat')},
    'merc_prism': {'skin': (0.4, 0.1, 0.55, 0.25), 'top': (0.15, 0.65, 0.85, 0.95), 'pad': '#d8a83a',
                   'glow': ((0.4, 0.2, 0.55, 0.35), 'sat')},
    'merc_nub': {'skin': (0.3, 0.08, 0.62, 0.2), 'top': (0.3, 0.5, 0.6, 0.8), 'glow': ((0.3, 0.22, 0.62, 0.3), 'sat')},
    'merc_tink': {'skin': (0.25, 0.05, 0.75, 0.2), 'top': (0.15, 0.65, 0.85, 0.95), 'glow': ((0.2, 0.33, 0.7, 0.46), 'sat'),
                  'pad': (0.65, 0.4, 0.9, 0.55)},
    'merc_reed': {'skin': (0.4, 0.05, 0.7, 0.2), 'top': (0.3, 0.7, 0.7, 0.95), 'glow': ((0.4, 0.55, 0.55, 0.68), 'sat')},
    'merc_coil': {'skin': (0.35, 0.1, 0.55, 0.2), 'top': (0.1, 0.7, 0.9, 1.0), 'glow': ((0.26, 0.28, 0.54, 0.4), 'sat'),
                  'pad': ((0.64, 0.25, 0.74, 0.42), 'sat')},
    'merc_archon': {'skin': (0.28, 0.1, 0.42, 0.4), 'top': (0.35, 0.62, 0.6, 0.95), 'glow': ((0.45, 0.2, 0.65, 0.4), 'sat')},
}


def families():
    text = open(os.path.join(ROOT, 'src', 'data', 'looks.js')).read()
    return dict(re.findall(r"^\s+(\w+): \{.*?family: '(\w+)'", text, flags=re.M))


def load(name):
    im = Image.open(os.path.join(PORTRAITS, name + '.png')).convert('RGBA')
    return im


def lum(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def usable(p, dark=22):
    """Skip transparent pixels, the near-black outline and the cyan rim light."""
    if p[3] < 200:
        return False
    if lum(p) < dark:
        return False
    if p[2] > 170 and p[1] > 150 and p[0] < 110 and p[2] - p[0] > 90 and lum(p) > 110:
        return False
    return True


def sample(im, region, mode='dom', hair=False):
    W, H = im.size
    x0, y0, x1, y1 = region
    px = im.load()
    bins = {}
    raw = []
    for y in range(int(y0 * H), int(y1 * H)):
        for x in range(int(x0 * W), int(x1 * W)):
            p = px[x, y]
            if hair and usable(p, 6):
                raw.append(p[:3])
            if not usable(p):
                continue
            key = (p[0] >> 4, p[1] >> 4, p[2] >> 4)
            bins.setdefault(key, []).append(p[:3])
    if not bins:
        return None
    total = sum(len(v) for v in bins.values())
    ranked = sorted(bins.items(), key=lambda kv: -len(kv[1]))
    pool = [kv for kv in ranked if len(kv[1]) >= max(4, total * 0.02)] or ranked[:1]
    if mode == 'sat':
        def sat(kv):
            r, g, b = [v / 255 for v in avg(kv[1])]
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            return s * v
        best = max(pool, key=sat)
    elif mode == 'light':
        best = max(pool, key=lambda kv: lum(avg(kv[1])))
    elif mode == 'dark':
        best = min(pool, key=lambda kv: lum(avg(kv[1])))
    else:
        # the middle luminance band of the region: the base tone, not its shadow or its glint
        # (black hair is mostly outline-dark, so it keeps its dark pixels)
        lo, hi = (0.3, 0.7)
        pts = sorted((p for v in bins.values() for p in v), key=lum)
        if hair and sum(1 for p in raw if lum(p) < 22) > len(raw) * 0.5:
            lo, hi, pts = 0.4, 0.9, sorted(raw, key=lum)
        mid = pts[int(len(pts) * lo):max(int(len(pts) * hi), int(len(pts) * lo) + 1)]
        return '#%02x%02x%02x' % tuple(int(round(sum(p[i] for p in mid) / len(mid))) for i in range(3))
    # average the winning bin with its neighbours so the result is a stable mid-tone
    bk = best[0]
    pts = []
    for k, v in bins.items():
        if max(abs(k[i] - bk[i]) for i in range(3)) <= 1:
            pts.extend(v)
    return '#%02x%02x%02x' % tuple(int(round(sum(p[i] for p in pts) / len(pts))) for i in range(3))


def avg(pts):
    return tuple(sum(p[i] for p in pts) / len(pts) for i in range(3))


def head_top(im):
    """The hair band: a strip under the top of the silhouette, over the middle of the head."""
    W, H = im.size
    px = im.load()
    rows = [y for y in range(H) if sum(1 for x in range(0, W, 4) if px[x, y][3] > 200) >= 6]
    y0 = rows[0]
    band = range(y0, y0 + int(H * 0.1))
    xs = [x for y in band for x in range(0, W, 2) if px[x, y][3] > 200]
    lo, hi = min(xs), max(xs)
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    return ((mid - half * 0.6) / W, y0 / H, (mid + half * 0.6) / W, (y0 + H * 0.1) / H)


def pick(im, spec):
    """spec: '#hex' | 'headtop' | region | (region, mode)."""
    if isinstance(spec, str) and spec != 'headtop':
        return spec
    region, mode = spec if isinstance(spec, tuple) and isinstance(spec[1], str) else (spec, 'dom')
    return sample(im, head_top(im) if region == 'headtop' else region, mode, hair=region == 'headtop')


def build():
    out = {}
    fam = families()
    for fname in sorted(os.listdir(PORTRAITS)):
        name = fname[:-4]
        look = name.replace('captain-', 'captain_') if name.startswith('captain-') else 'merc_' + name
        im = load(name)
        roles = dict(LOOKS.get(look, {}))
        pal = {}
        for role in ROLES:
            spec = roles.get(role, DEFAULT.get(role) if role != 'hair' or fam.get(look) == 'human' else None)
            if spec is None:
                continue
            col = pick(im, spec)
            if col:
                pal[role] = col
        out[look] = pal
    return out


def review(pal, path):
    S = 300
    names = sorted(pal)
    cols = 5
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (S + 24), rows * S), (10, 15, 40))
    dr = ImageDraw.Draw(sheet)
    for i, look in enumerate(names):
        name = look.replace('captain_', 'captain-').replace('merc_', '')
        im = load(name).resize((S, S), Image.LANCZOS)
        x, y = (i % cols) * (S + 24), (i // cols) * S
        sheet.paste(im, (x, y), im)
        dr.text((x + 3, y + 2), name, fill=(255, 255, 255))
        for k, role in enumerate(ROLES):
            spec = LOOKS.get(look, {}).get(role, DEFAULT.get(role))
            if spec is None or (isinstance(spec, str) and spec != 'headtop'):
                continue
            box = spec if spec == 'headtop' or not isinstance(spec[1], str) else spec[0]
            box = head_top(load(name)) if box == 'headtop' else box
            dr.rectangle((x + box[0] * S, y + box[1] * S, x + box[2] * S, y + box[3] * S), outline=BOX[role])
        for k, role in enumerate(ROLES):
            if role in pal[look]:
                dr.rectangle((x + S, y + k * 24 + 2, x + S + 20, y + k * 24 + 24), fill=pal[look][role], outline=(255, 255, 255))
    sheet.save(path, optimize=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--review', default='', help='write a PNG of regions and swatches')
    args = ap.parse_args()
    pal = build()
    with open(OUT, 'w') as fh:
        json.dump(pal, fh, indent=1, sort_keys=True)
        fh.write('\n')
    if args.review:
        review(pal, args.review)
    print(f'sampled {len(pal)} looks -> {os.path.relpath(OUT, ROOT)}')
