#!/usr/bin/env python3
"""Bake the Warp Crew ship sprites from the Sunnyside character rig.

The Sunnyside strips in public/art/char/ are the rig: base body + hair layers,
96x64 cells, facing right, one shared palette. Parts are identified by POSITION
(see ~/ninefold/src/recolor.js), never by hue:

  1. every frame is labelled at source scale (outline / skin / eye / shirt /
     pants / boot / hair) and anchors are measured from the base layer
     (head box, eyes, torso, pants, hand) so worn gear rides the walk bob;
  2. the labels are upscaled 2x and repainted with family materials
     (human / alien / droid) plus gear drawn at 2x against the anchors;
  3. a 1px outer outline, bevel light and body-anchored grime finish it.

Everything is deterministic: same inputs, byte-identical PNGs.

    python3 scripts/crew-rig/build_crew_sheets.py            # all looks
    python3 scripts/crew-rig/build_crew_sheets.py --only merc_rex,merc_hex

Writes public/art/crew/<lookId>_{walk,idle,work}.png, public/art/crew/manifest.json,
src/data/crewRigManifest.js and the QA contact sheet.
"""
import argparse
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CHAR = os.path.join(ROOT, 'public', 'art', 'char')
OUT = os.path.join(ROOT, 'public', 'art', 'crew')
MANIFEST_JS = os.path.join(ROOT, 'src', 'data', 'crewRigManifest.js')
CONTACT = os.path.join(ROOT, 'docs', 'qa', 'artifacts', '2026-09-26-crew-rig')

SRC_CELL = (96, 64)
CROP = (36, 13, 24, 28)          # x, y, w, h inside the 96x64 cell
UP = 2                           # detail scale
CELL_W, CELL_H = CROP[2] * UP, CROP[3] * UP
GROUND_Y = 39                    # Sunnyside ground line (feet occupy row 38)
BODY_X = 48.5                    # centre of the 43..53 body columns
FOOT = (round((BODY_X - CROP[0]) * UP), (GROUND_Y - CROP[1]) * UP)

ANIMS = {
    'walk': {'file': 'walk_strip8', 'frames': 8, 'fps': 10},
    'idle': {'file': 'idle_strip9', 'frames': 9, 'fps': 7},
    'work': {'file': 'doing_strip8', 'frames': 8, 'fps': 9},
}

# ---------------------------------------------------------------- source palette
SRC = {}
for c in ['171424', '181424', '181425', '181525', '171425', '191425', '181325', '171324', '181526', '181324']:
    SRC[c] = ('O', 0)
for lvl, group in enumerate([['b86f50', 'bb6d53'], ['c58158', 'c87f5b', 'c87f5c'], ['d8956c', 'd9966d'],
                             ['e8ad7d', 'e9ad7d', 'e8ac7c', 'e8ac7d']]):
    for c in group:
        SRC[c] = ('S', lvl)
for lvl, group in enumerate([['733e39', '743f39', '753c39', '753d3a'], ['a22633', 'a51f33', 'a61f34'],
                             ['e43b44', 'e83145', 'e93245']]):
    for c in group:
        SRC[c] = ('T', lvl)
for lvl, group in enumerate([['242b42', '252c43', '262b44'], ['374464', '384565', '3a4466']]):
    for c in group:
        SRC[c] = ('P', lvl)
SRC['fa717a'] = ('K', 0)

# ---------------------------------------------------------------- materials
# Five steps each, darkest first. Shadows lean cool, lights lean warm.
OUTLINE = '#06070b'
R = {
    # human skin
    'skin.light': ['#4f332f', '#86574a', '#ad7760', '#cc967a', '#e2b496'],
    'skin.tan': ['#3f271f', '#6e4431', '#935f43', '#b27c58', '#c9976e'],
    'skin.brown': ['#2c1b17', '#523224', '#724a34', '#8e6248', '#a67c5c'],
    'skin.deep': ['#1c120f', '#382218', '#523424', '#6a4734', '#7f5d47'],
    # alien skin
    'alien.greygreen': ['#152019', '#2a3c2f', '#45624c', '#668a6a', '#8fad88'],
    'alien.teal': ['#0a1d21', '#133239', '#1e5058', '#2f757a', '#539c9a'],
    'alien.violet': ['#170f22', '#2a1c42', '#422f66', '#5f4a8a', '#8570ac'],
    'alien.ash': ['#16161c', '#292a33', '#43444f', '#636674', '#8c8e9c'],
    'alien.crimson': ['#1f0b0f', '#3c1419', '#5e2025', '#84342f', '#a8554a'],
    'alien.moss': ['#0f1f0d', '#1b3515', '#2c521f', '#46732c', '#6c9644'],
    'alien.sand': ['#221a0b', '#403018', '#634b26', '#876938', '#ad8c52'],
    'alien.glass': ['#101c26', '#1e3444', '#34546a', '#557a92', '#86a8bc'],
    'alien.void': ['#0e0c18', '#1c1830', '#2c2648', '#3f3866', '#5a5288'],
    # droid plating
    'metal.rust': ['#200f08', '#44200e', '#713714', '#9e521c', '#c77630'],
    'metal.hazard': ['#201806', '#46340c', '#755712', '#a8801a', '#d4aa36'],
    'metal.gunmetal': ['#0e1014', '#1b1f25', '#2e343d', '#48515d', '#6d7784'],
    'metal.ivory': ['#22242a', '#454951', '#737982', '#a2a8ae', '#cfd3d6'],
    'metal.chrome': ['#0c1220', '#1a2436', '#2c3c56', '#48607e', '#7890ae'],
    'metal.blackops': ['#0b0b10', '#1a1a22', '#2b2b37', '#42424f', '#60606e'],
    'metal.brass': ['#1e1507', '#3e2c0e', '#654818', '#8f6a24', '#bb953e'],
    # suits (jumpsuits / armour cloth)
    'suit.red': ['#200d11', '#40161c', '#662029', '#8c2d33', '#ad4a45'],
    'suit.blue': ['#0d1422', '#18253d', '#263a5c', '#39547e', '#56729c'],
    'suit.cyan': ['#0b181e', '#122b34', '#1b4550', '#2a6570', '#478a8e'],
    'suit.green': ['#12170e', '#212a18', '#333f24', '#4b5832', '#667545'],
    'suit.purple': ['#150f1d', '#261b35', '#3a2b50', '#533f6e', '#6f5a8c'],
    'suit.ochre': ['#221307', '#42240d', '#6a3a14', '#96561c', '#bb7a34'],
    'suit.slate': ['#0f1114', '#1b1f23', '#2b3136', '#414a51', '#5e6970'],
    'suit.umber': ['#180f0a', '#2e1e14', '#4a3222', '#664832', '#846448'],
    # gear
    'pad': ['#101216', '#23272e', '#3b414b', '#5e6772', '#8b949e'],
    'belt': ['#0c0907', '#1d1510', '#30231a', '#453427', '#5c4636'],
    'boot': ['#08080b', '#131318', '#1f1f26', '#2f2f38', '#44444f'],
    'glove': ['#0a0a0d', '#16161b', '#24242b', '#35353f', '#4b4b57'],
    'bone': ['#2a2620', '#4c463a', '#766e5c', '#a09682', '#c8bea8'],
    'glass': ['#05080d', '#0b121c', '#132030', '#1f3348', '#39536c'],
    'eye': ['#030305', '#07070c', '#0d0d16', '#161622', '#23233a'],
    'joint': ['#07080a', '#111317', '#1c1f25', '#2b2f37', '#3f444e'],
}
HAIR = {
    'black': ['#0b0a0f', '#16141c', '#24202b', '#352e3b', '#463d4b'],
    'brown': ['#170d0a', '#2f1a13', '#4a2a1d', '#653a28', '#7e4c36'],
    'ginger': ['#240f07', '#4a1e0c', '#7a3314', '#a0481c', '#be6232'],
    'sand': ['#211710', '#433020', '#664b33', '#886648', '#a6835f'],
    'grey': ['#18171b', '#302e34', '#4b4850', '#6a666e', '#8b868d'],
    'blonde': ['#2a2217', '#54462f', '#85714d', '#ad9870', '#cab795'],
}
GLOW = {
    'cyan': ['#0d5866', '#1fa6bd', '#52e4f5', '#b6fbff'],
    'red': ['#5c0d0d', '#b3221c', '#ff4a36', '#ffc2b0'],
    'amber': ['#5a2e05', '#b06610', '#ffab2e', '#ffe7a6'],
    'green': ['#0d4d1c', '#1c9a38', '#5cf07a', '#d0ffd8'],
    'violet': ['#3a0f5c', '#7a2cb8', '#c479ff', '#f0d9ff'],
}
SHADED = {'S', 'T', 'P', 'H', 'M', 'suit', 'pad', 'belt', 'boot', 'glove', 'bone', 'metal', 'skin', 'joint', 'hairx'}


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hash01(*v):
    h = 2166136261
    for n in v:
        h = ((h ^ (n & 0xffffffff)) * 16777619) & 0xffffffff
        h ^= h >> 13
    return (h % 10007) / 10007.0


# ---------------------------------------------------------------- inputs
def parse_looks():
    text = open(os.path.join(ROOT, 'src', 'data', 'looks.js')).read()
    body = text.split('export const CREW_LOOKS = {', 1)[1].split('\n};', 1)[0]
    looks = {}
    for m in re.finditer(r"^\s+(\w+): \{(.*?)\},?$", body, flags=re.M):
        looks[m.group(1)] = dict(re.findall(r"(\w+): '([^']*)'", m.group(2)))
    return looks


def parse_roster():
    text = open(os.path.join(ROOT, 'src', 'data', 'crewRoster.js')).read()
    return {m.group(1): {'role': m.group(2), 'species': m.group(3)}
            for m in re.finditer(r"m\('(\w+)', '[^']*', '(\w+)', '\w+', '(\w+)'", text)}


_strip_cache = {}


def strip(layer, anim):
    key = (layer, anim)
    if key not in _strip_cache:
        path = os.path.join(CHAR, f"{layer}_{ANIMS[anim]['file']}.png")
        _strip_cache[key] = Image.open(path).convert('RGBA')
    return _strip_cache[key]


# ---------------------------------------------------------------- labelling
def label_frame(anim, frame, hair_style):
    """Label one frame at source scale, positionally, and measure anchors."""
    base = strip('base', anim)
    hair = strip(hair_style, anim) if hair_style else None
    x0, y0, w, h = CROP
    ox = frame * SRC_CELL[0]
    L = [[None] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            p = base.getpixel((ox + x0 + x, y0 + y))
            if p[3] > 8:
                k = '%02x%02x%02x' % p[:3]
                L[y][x] = SRC.get(k, ('O', 0))
    hairL = [[None] * w for _ in range(h)]
    if hair is not None:
        pts = []
        for y in range(h):
            for x in range(w):
                q = hair.getpixel((ox + x0 + x, y0 + y))
                if q[3] <= 8:
                    continue
                p = base.getpixel((ox + x0 + x, y0 + y))
                if p[3] > 8 and p[:3] == q[:3]:
                    continue
                lum = 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2]
                pts.append((x, y, lum))
        if pts:
            lums = [p[2] for p in pts]
            lo, hi = min(lums), max(lums)
            for x, y, lum in pts:
                t = (lum - lo) / max(1e-6, hi - lo)
                hairL[y][x] = ('O', 0) if lum < 30 else ('H', 1 if t < 0.34 else 2 if t < 0.67 else 3)

    # Re-proportion the chibi rig: drop one plain skull row and double the
    # first shirt and first trouser rows. Head 11 -> 10 rows, body 5 -> 7, the
    # feet stay on the ground line, and the leg cycle is untouched.
    raw = [(x, y) for y in range(h) for x in range(w) if L[y][x]]
    r_head = min(y for x, y in raw)
    r_torso = min(y for x, y in raw if L[y][x][0] in 'TP' and 9 <= x <= 15)
    r_pants = next((y for y in range(r_torso + 1, h)
                    if any(L[y][x] and L[y][x][0] == 'P' for x in range(9, 16))
                    and not any(L[y][x] and L[y][x][0] == 'T' for x in range(9, 16))), r_torso + 1)
    order = []
    for y in range(h):
        if y == r_head + 3:
            continue
        order.append(y)
        if y in (r_torso, r_pants):
            order.append(y)
    order = [None] * (h - len(order)) + order if len(order) < h else order[len(order) - h:]
    L = [list(L[y]) if y is not None else [None] * w for y in order]
    hairL = [list(hairL[y]) if y is not None else [None] * w for y in order]

    opaque = [(x, y) for y in range(h) for x in range(w) if L[y][x]]
    head_top = min(y for x, y in opaque)
    feet = max(y for x, y in opaque)
    torso_px = [(x, y) for x, y in opaque if L[y][x][0] in 'TP' and 9 <= x <= 15]
    torso_top = min(y for x, y in torso_px)
    head_bot = torso_top - 1
    head_rows = [(x, y) for x, y in opaque if head_top <= y < head_bot]
    head_l = min(x for x, y in head_rows)
    # measured on the crown so a raised work arm never widens the skull
    head_r = max(x for x, y in head_rows if y < head_top + 6)
    eyes = []
    for x, y in head_rows:
        if L[y][x] != ('O', 0) or y < head_top + 3:
            continue
        left = L[y][x - 1] if x > 0 else None
        right = L[y][x + 1] if x + 1 < w else None
        if left and left[0] == 'S' and right is not None and head_l + 2 < x < head_r:
            eyes.append((x, y))
    pants_top = feet
    for y in range(torso_top, feet + 1):
        row = [L[y][x] for x in range(9, 16) if L[y][x] and L[y][x][0] in 'TP']
        if row and sum(1 for c in row if c[0] == 'P') * 2 >= len(row) and sum(1 for c in row if c[0] == 'T') == 0:
            pants_top = y
            break
    torso_cols = [x for x, y in opaque if torso_top <= y <= feet and x <= 16 and L[y][x][0] in 'TP']
    torso_l, torso_r = min(torso_cols), max(torso_cols)
    hand = [(x, y) for x, y in opaque if L[y][x][0] == 'S' and y >= head_bot + (1 if x <= head_r else -2) and x > torso_r - 1]
    ex = sorted(set(x for x, y in eyes))
    ey = [y for x, y in eyes]
    hair_top = min([y for y in range(h) for x in range(w) if hairL[y][x]] or [head_top])
    A = {
        'head_top': head_top, 'head_bot': head_bot, 'head_l': head_l, 'head_r': head_r,
        'eyes': eyes, 'eye_back': ex[0] if ex else head_r - 5, 'eye_front': ex[-1] if ex else head_r - 2,
        'eye_top': min(ey) if ey else head_bot - 3, 'eye_bot': max(ey) if ey else head_bot - 2,
        'torso_top': torso_top, 'torso_l': torso_l, 'torso_r': torso_r, 'pants_top': pants_top,
        'feet': feet, 'hand': hand, 'hair_top': hair_top,
    }
    return L, hairL, A


# ---------------------------------------------------------------- canvas
class Canvas:
    """2x grid of (material, level) cells, resolved to colour at the end."""

    def __init__(self):
        self.g = [[None] * CELL_W for _ in range(CELL_H)]

    def get(self, x, y):
        if 0 <= x < CELL_W and 0 <= y < CELL_H:
            return self.g[y][x]
        return None

    def put(self, x, y, mat, lvl=0):
        if 0 <= x < CELL_W and 0 <= y < CELL_H:
            self.g[y][x] = (mat, lvl)

    def rect(self, x, y, w, h, mat, lvl=0):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.put(xx, yy, mat, lvl)

    def block(self, x1, y1, mat, lvl=0):
        """Paint one source pixel (2x2)."""
        self.rect(x1 * UP, y1 * UP, UP, UP, mat, lvl)

    def solid(self, x, y):
        c = self.get(x, y)
        return c is not None and c[0] != 'O'


def mat_for(look, family):
    suit = 'suit.' + look.get('suit', look.get('cloth', 'slate'))
    if suit not in R:
        suit = 'suit.slate'
    if family == 'human':
        skin = 'skin.' + look.get('skin', 'tan')
    elif family == 'alien':
        skin = 'alien.' + look.get('tone', 'ash')
    else:
        skin = 'metal.' + look.get('tone', 'gunmetal')
    return {
        'skin': skin if skin in R else 'skin.tan',
        'suit': suit,
        'hair': look.get('rigHairColor', look.get('hairColor', 'black')),
        'glow': look.get('glow', 'cyan' if family != 'human' else 'amber'),
    }


def paint_base(C, L, hairL, A, family, look, mats, gear):
    """Upscale labels into family materials."""
    h, w = len(L), len(L[0])
    for y in range(h):
        for x in range(w):
            c = L[y][x]
            if not c:
                continue
            kind, lvl = c
            if kind == 'O':
                C.block(x, y, 'O')
            elif kind == 'S':
                is_hand = (x, y) in A['hand'] or y > A['head_bot']
                if is_hand and family == 'human' and 'gloves' in gear:
                    C.block(x, y, 'glove', lvl + 1)
                elif is_hand and family == 'droid':
                    C.block(x, y, 'joint', lvl + 1)
                else:
                    C.block(x, y, 'skin', lvl)
            elif kind == 'K':
                C.block(x, y, 'skin', 2 if family != 'droid' else 3)
            elif kind == 'T':
                C.block(x, y, 'suit', lvl + 1)
            elif kind == 'P':
                if y < A['pants_top']:
                    C.block(x, y, 'suit', lvl)
                else:
                    C.block(x, y, 'pants', lvl + 1)
    # feet row: boots (the pack draws them as outline + one shade pixel)
    fy = A['feet']
    for x in range(w):
        if L[fy][x] and L[fy][x][0] != 'S':
            pass
    for x in range(w):
        c = L[fy][x]
        if c and (c[0] == 'O' or c[0] == 'T') and L[fy - 1][x] and L[fy - 1][x][0] in 'PT':
            C.rect(x * UP, fy * UP, UP, 1, 'boot' if family != 'droid' else 'joint', 2)
    for y in range(h):
        for x in range(w):
            if L[y][x] and L[y][x][0] == 'T' and y >= A['pants_top'] and L[y][x][1] == 0:
                C.block(x, y, 'boot', 2)
    if family == 'human':
        shell = 'helmet' in gear
        for y in range(h):
            for x in range(w):
                c = hairL[y][x]
                if c:
                    C.block(x, y, 'O' if c[0] == 'O' else 'pad' if shell else 'hairx', c[1] + (1 if shell else 0))


# ---------------------------------------------------------------- head gear
def eye_cells(A):
    return A['eyes']


def human_head(C, A, gear, mats, frame, anim):
    for x, y in eye_cells(A):
        C.block(x, y, 'eye', 1)
        C.put(x * UP, y * UP, 'eye', 3)
    top, bot = A['eye_top'], A['eye_bot']
    # brow shadow: gives the face weight
    for x in sorted(set(x for x, _ in A['eyes'])):
        for dx in (0, 1):
            c = C.get(x * UP + dx - 1, top * UP - 1)
            if c and c[0] == 'skin':
                C.put(x * UP + dx - 1, top * UP - 1, 'skin', 0)
    if 'stubble' in gear:
        y2 = (A['head_bot'] - 1) * UP + 1
        for x2 in range((A['eye_back'] - 1) * UP, A['head_r'] * UP):
            c = C.get(x2, y2)
            if c and c[0] == 'skin' and x2 % 2 == 0:
                C.put(x2, y2, 'skin', 1)
        for x2 in range(A['eye_back'] * UP, A['head_r'] * UP, 3):
            c = C.get(x2, y2 - 1)
            if c and c[0] == 'skin':
                C.put(x2, y2 - 1, 'skin', 1)
    if 'scar' in gear:
        sx, sy = A['eye_front'] * UP + 1, top * UP - 2
        for i in range(5):
            if C.solid(sx - i // 2, sy + i):
                C.put(sx - i // 2, sy + i, 'skin', 4 if i % 2 else 0)
    if 'helmet' in gear:
        # the shell is the short-hair mask painted as armour: a ridge, a brow
        # lip and a status light
        hl, hr = A['head_l'], A['head_r']
        ridge_y = A['hair_top'] * UP + 2
        for x in range((hl + 2) * UP, (hr - 1) * UP):
            if C.solid(x, ridge_y):
                C.put(x, ridge_y, 'pad', 4 if x % 4 else 3)
        lip = (top - 1) * UP - 2
        for x in range((hl + 1) * UP, (hr + 1) * UP):
            c = C.get(x, lip)
            if c and c[0] == 'pad':
                C.put(x, lip, 'pad', 1)
                C.put(x, lip + 1, 'O')
        C.rect((hl + 1) * UP + 1, (top - 2) * UP, 2, 2, 'glow', 2)
    if 'visor' in gear:
        x1 = (A['eye_back'] - 1) * UP
        x2 = A['head_r'] * UP + 1
        vy = top * UP
        C.rect(x1, vy - 1, x2 - x1, 5, 'O')
        C.rect(x1 + 1, vy, x2 - x1 - 1, 3, 'glass', 2)
        C.rect(x1 + 1, vy, x2 - x1 - 1, 1, 'glass', 4)
        span = max(1, x2 - x1 - 3)
        sweep = x1 + 1 + (frame * 2) % span
        C.rect(x1 + 1, vy + 1, x2 - x1 - 1, 1, 'glowdim', 0)
        C.rect(sweep, vy + 1, 2, 1, 'glow', 3)
        C.put(x2 - 1, vy + 1, 'glow', 2)
    if 'cybereye' in gear:
        fx = A['eye_front'] * UP
        C.rect(fx - 2, top * UP - 2, 5, 7, 'pad', 2)
        C.rect(fx - 2, top * UP - 2, 5, 1, 'pad', 4)
        C.rect(fx - 1, top * UP, 2, 2, 'glow', 2)
        C.put(fx - 1, top * UP, 'glow', 3)
        C.put(fx + 2, top * UP - 2, 'O')
        C.rect(fx - 4, top * UP - 1, 2, 1, 'pad', 1)
    if 'goggles' in gear:
        gy = (top - 3) * UP
        for x in range(A['head_l'] * UP, A['head_r'] * UP + 1):
            if C.get(x, gy):
                C.put(x, gy, 'belt', 1)
                C.put(x, gy + 1, 'belt', 2)
        gx = A['eye_front'] * UP - 2
        C.rect(gx - 1, gy - 2, 6, 5, 'O')
        C.rect(gx, gy - 1, 4, 3, 'pad', 3)
        C.rect(gx + 1, gy - 1, 2, 2, 'glass', 4)
        C.put(gx + 1, gy - 1, 'glow', 3)
    if 'headset' in gear:
        ex = (A['head_l'] + 2) * UP
        ey = bot * UP - 1
        for y in range(A['hair_top'] * UP + 2, ey):
            C.put(ex + 1, y, 'pad', 2)
            C.put(ex + 2, y, 'O')
        C.rect(ex - 1, ey - 1, 5, 6, 'O')
        C.rect(ex, ey, 3, 4, 'pad', 3)
        C.put(ex, ey, 'pad', 4)
        C.put(ex + 1, ey + 2, 'glow', 2)
        my = ey + 4
        for x in range(ex + 3, A['eye_back'] * UP + 1):
            C.put(x, my, 'pad', 1)
        C.put(A['eye_back'] * UP + 1, my, 'pad', 3)


def alien_head(C, A, variant, mats, frame, anim):
    top, bot = A['eye_top'], A['eye_bot']
    ht, hl, hr = A['head_top'], A['head_l'], A['head_r']
    sway = [0, 0, 1, 1, 0, 0, -1, -1, 0][frame % 9] if anim == 'walk' else [0, 0, 0, 1, 1, 1, 0, 0, 0][frame % 9]
    if variant == 'grey':
        # swollen cranium: an egg at detail scale, widest above the eyes and
        # tapering into the jaw; the face edge stays where the rig put it
        y_top = (ht - 3) * UP
        yc = (ht + 2) * UP
        y_chin = A['head_bot'] * UP
        cx = (hl + hr) * UP / 2.0 - 1
        rx = (hr - hl) * UP / 2.0 + 4
        x_front = (hr + 1) * UP - 1
        for y in range(y_top - 2, y_chin):
            ry = (yc - y_top) if y < yc else (y_chin - yc)
            for x in range((hl - 3) * UP, x_front + 1):
                d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - yc) / ry) ** 2
                d2 = ((x + 0.5 - cx) / (rx + 2)) ** 2 + ((y + 0.5 - yc) / (ry + 2)) ** 2
                cur = C.get(x, y)
                if d <= 1 and x <= x_front - 2:
                    if cur and cur[0] not in ('O',):
                        continue
                    shade = 2 if (x - cx) < -rx * 0.55 or y > yc else 3
                    if d < 0.3 and y < yc - (yc - y_top) * 0.5:
                        shade = 4
                    C.put(x, y, 'skin', shade)
                elif d2 <= 1 and cur is None:
                    C.put(x, y, 'O')
        # temple ridges
        for i in range(3):
            C.put(int(cx - rx * 0.45) + i, yc - 3 + i, 'skin', 1)
        # jaw narrows: chin row becomes slimmer
        cy = A['head_bot'] - 1
        for x in range(hl, A['eye_back'] - 1):
            if C.get(x * UP + 1, cy * UP + 1) and C.get(x * UP + 1, cy * UP + 1)[0] == 'skin':
                C.put(x * UP, cy * UP + 1, 'skin', 1)
    elif variant == 'crest':
        # bony ridge: one continuous serrated fin on the skull, rising to the back
        x_start = (hr - 2) * UP
        x_end = (hl - 2) * UP
        base_y = ht * UP
        for x in range(x_start, x_end - 1, -1):
            t = (x_start - x) / max(1, x_start - x_end)
            hgt = int(2 + t * 8)
            if (x // 2) % 2:
                hgt -= 2
            y_base = base_y + (int((hl * UP - x) * 1.2) if x < hl * UP else 0)
            for k in range(hgt):
                C.put(x, y_base - 1 - k, 'bone', 3 if k < hgt - 1 else 4)
            C.put(x, y_base - 1, 'bone', 1)
        for x in range(hl * UP, hr * UP, 3):
            if C.get(x, base_y + 2) and C.get(x, base_y + 2)[0] == 'skin':
                C.put(x, base_y + 2, 'skin', 1)
        # cheek plates
        C.rect(A['eye_front'] * UP - 1, (bot + 1) * UP + 1, 3, 1, 'bone', 2)
        C.rect((hl + 2) * UP, (top + 1) * UP, 3, 1, 'skin', 0)
        C.rect((hl + 2) * UP, (top + 2) * UP, 3, 1, 'skin', 0)
    elif variant == 'antennae':
        for base_x, length, lean in ((hl + 4, 5, 1), (hl + 7, 4, 2)):
            px = base_x * UP
            py = ht * UP
            pts = []
            for i in range(length * UP):
                off = (i * (lean + sway)) // (length * UP)
                pts.append((px + off, py - i))
            for x, y in pts:
                C.rect(x - 1, y - 1, 3, 3, 'O')
            for x, y in pts:
                C.put(x, y, 'skin', 1)
            tx, ty = pts[-1]
            C.rect(tx - 2, ty - 3, 5, 5, 'O')
            C.rect(tx - 1, ty - 2, 3, 3, 'glow', 2)
            C.put(tx, ty - 1, 'glow', 3)
        for x in range(hl + 1, hr, 3):
            C.put(x * UP + 1, (ht + 1) * UP + 1, 'skin', 1)
    elif variant == 'fins':
        # swept ear fin with ribs, and gill slits
        fx = hl + 1
        fy = top - 1
        fin = [(fx, fy - 2), (fx - 1, fy - 3), (fx - 2, fy - 4), (fx - 1, fy - 2), (fx - 2, fy - 3), (fx - 3, fy - 4),
               (fx, fy - 1), (fx - 1, fy - 1), (fx - 2, fy - 2), (fx, fy), (fx - 1, fy), (fx, fy + 1)]
        for x, y in fin:
            C.rect(x * UP - 1, y * UP - 1 + sway, UP + 2, UP + 2, 'O')
        for x, y in fin:
            C.rect(x * UP, y * UP + sway, UP, UP, 'fin', 2)
        for i in range(4):
            C.put((fx - i) * UP, (fy - i) * UP + sway, 'fin', 4)
            C.put((fx - i) * UP + 1, (fy - i) * UP + 2 + sway, 'fin', 1)
        for i in range(3):
            C.rect((A['eye_back'] - 1) * UP, (bot + 1) * UP + i * 2 - 1, 3, 1, 'skin', 0)
        for x in range(hl + 1, hr - 1, 2):
            C.put(x * UP, (ht + 1) * UP, 'skin', 4)
    elif variant == 'tendrils':
        roots = [(hl + 1, ht + 2), (hl, ht + 5), (hl + 2, ht + 1)]
        for n, (rx, ry) in enumerate(roots):
            pts = []
            x, y = rx * UP, ry * UP
            for i in range(9 + n * 2):
                wob = ((i + frame + n * 2) // 3) % 2 if anim == 'walk' else ((i + frame // 2 + n) // 4) % 2
                pts.append((x - i // 2 - wob, y + i))
            for x2, y2 in pts:
                C.rect(x2 - 1, y2 - 1, 3, 3, 'O')
        for n, (rx, ry) in enumerate(roots):
            x, y = rx * UP, ry * UP
            for i in range(9 + n * 2):
                wob = ((i + frame + n * 2) // 3) % 2 if anim == 'walk' else ((i + frame // 2 + n) // 4) % 2
                C.put(x - i // 2 - wob, y + i, 'skin', 1 if i % 3 else 2)
            end = 9 + n * 2 - 1
            C.put(x - end // 2 - (((end + frame + n * 2) // 3) % 2), y + end, 'glow', 2)
        for x in range(hl + 1, hr - 1):
            C.put(x * UP + 1, ht * UP + 1, 'skin', 4 if x % 2 else 3)
        for i, x in enumerate(range(hl + 2, hr - 2, 2)):
            C.put(x * UP, (ht + 2) * UP + (i % 2), 'glowdim', 0)
    # the big dark eyes every alien shares
    big = variant == 'grey'
    for n, x in enumerate(sorted(set(x for x, _ in A['eyes']))):
        cx = x * UP
        w = 4 if big else 3
        hgt = 5 if big else 4
        ex0 = cx - (1 if n == 0 else 1)
        ey0 = top * UP - (2 if big else 1)
        C.rect(ex0, ey0, w, hgt, 'eye', 1)
        C.rect(ex0, ey0 + hgt - 1, w, 1, 'eye', 0)
        if big:
            C.put(ex0, ey0, 'skin', 2)
            C.put(ex0 + w - 1, ey0 + hgt - 1, 'skin', 2)
        C.put(ex0 + 1, ey0 + 1, 'glow', 3 if big else 2)
        C.put(ex0 + w - 1, ey0 + 1, 'eye', 3)
    # no mouth, no blush: aliens read by their eyes


def droid_head(C, A, variant, mats, frame, anim, nframes):
    top, bot = A['eye_top'], A['eye_bot']
    ht, hb, hl, hr = A['head_top'], A['head_bot'], A['head_l'], A['head_r']
    if variant in ('box', 'sentinel'):
        # square the rounded skull into a plated box with a jaw grille
        t = ht - (1 if variant == 'box' else 0)
        for y in range(t, hb):
            for x in range(hl, hr + 1):
                edge = x in (hl, hr) or y == t
                lvl = 3 if y < t + 2 else 2
                if x == hl + 1:
                    lvl = 1
                C.block(x, y, 'O' if edge else 'skin', lvl)
        # panel seams and rivets
        C.rect((hl + 1) * UP, (t + 3) * UP, (hr - hl - 1) * UP, 1, 'skin', 0)
        for x in (hl + 1, hr - 1):
            C.put(x * UP + (1 if x == hl + 1 else 0), (t + 1) * UP + 1, 'skin', 4)
            C.put(x * UP + (1 if x == hl + 1 else 0), (hb - 1) * UP, 'skin', 4)
        # grille
        for y in range((bot + 1) * UP + 1, hb * UP - 1, 2):
            C.rect((A['eye_back'] - 1) * UP, y, (hr - A['eye_back'] + 1) * UP - 1, 1, 'joint', 1)
        # ear bolt
        C.rect((hl + 2) * UP, (top - 1) * UP, 4, 5, 'pad', 3)
        C.put((hl + 2) * UP + 1, (top - 1) * UP + 2, 'pad', 0)
        if variant == 'box':
            # antenna with blinking tip
            ax = (hl + 3) * UP
            for y in range((t - 3) * UP, t * UP):
                C.rect(ax - 1, y, 3, 1, 'O')
                C.put(ax, y, 'pad', 3)
            C.rect(ax - 2, (t - 3) * UP - 3, 5, 4, 'O')
            on = (frame // 2) % 2 == 0
            C.rect(ax - 1, (t - 3) * UP - 2, 3, 2, 'glow' if on else 'glowdim', 2 if on else 0)
            # scanning visor slit
            x1, x2 = (A['eye_back'] - 1) * UP, hr * UP
            C.rect(x1 - 1, top * UP - 1, x2 - x1 + 1, 5, 'O')
            C.rect(x1, top * UP, x2 - x1, 3, 'glass', 1)
            span = x2 - x1 - 2
            tri = frame % (2 * nframes) / nframes
            pos = int(round((1 - abs(1 - tri * 2)) * (span - 1))) if nframes > 1 else 0
            pos = int(round((frame / max(1, nframes - 1)) * (span - 1))) if anim == 'walk' else pos
            C.rect(x1, top * UP + 1, x2 - x1, 1, 'glowdim', 0)
            C.rect(x1 + pos, top * UP, 3, 3, 'glow', 2)
            C.put(x1 + pos + 1, top * UP + 1, 'glow', 3)
        else:
            # sentinel: heavy brow, single cyclops optic
            C.rect(hl * UP, (t + 2) * UP, (hr - hl + 1) * UP, 2, 'O')
            C.rect((hl + 1) * UP, (t + 2) * UP - 2, (hr - hl - 1) * UP, 2, 'skin', 4)
            ox = (A['eye_back'] + A['eye_front']) * UP // 2 + 1
            oy = top * UP
            C.rect(ox - 3, oy - 2, 7, 7, 'O')
            C.rect(ox - 2, oy - 1, 5, 5, 'joint', 2)
            pulse = 3 if (frame // 3) % 2 == 0 else 2
            C.rect(ox - 1, oy, 3, 3, 'glow', 1)
            C.put(ox, oy + 1, 'glow', pulse)
            C.put(ox - 1, oy, 'glow', 3)
            # shoulder armour spikes read from far away
            C.rect((hr - 1) * UP, (t - 1) * UP + 1, 2, 3, 'O')
            C.rect((hl + 1) * UP, (t - 1) * UP + 1, 2, 3, 'O')
            C.put((hr - 1) * UP, (t - 1) * UP + 2, 'skin', 4)
            C.put((hl + 1) * UP, (t - 1) * UP + 2, 'skin', 4)
    else:
        # dome: round shell with a glass cap and twin optics (captain droid)
        for x in range(hl + 2, hr - 1):
            C.put(x * UP, ht * UP + 2, 'skin', 4)
        C.rect((hl + 2) * UP, (ht + 3) * UP, (hr - hl - 3) * UP, 1, 'skin', 0)
        C.rect((hl + 3) * UP, (ht - 1) * UP, 4, UP + 1, 'O')
        C.rect((hl + 3) * UP + 1, (ht - 1) * UP + 1, 2, UP, 'pad', 3)
        # ear cap
        C.rect((hl + 1) * UP, (top - 1) * UP - 1, 6, 7, 'O')
        C.rect((hl + 1) * UP + 1, (top - 1) * UP, 4, 5, 'pad', 2)
        C.put((hl + 1) * UP + 2, (top - 1) * UP + 1, 'pad', 4)
        for n, x in enumerate(sorted(set(x for x, _ in A['eyes']))):
            cx = x * UP + (0 if n == 0 else 1)
            cy = top * UP + 1
            C.rect(cx - 2, cy - 2, 5, 5, 'O')
            C.put(cx - 2, cy - 2, 'skin', 2)
            C.put(cx + 2, cy - 2, 'skin', 2)
            C.put(cx - 2, cy + 2, 'skin', 1)
            C.put(cx + 2, cy + 2, 'skin', 1)
            C.rect(cx - 1, cy - 1, 3, 3, 'glow', 2)
            C.put(cx, cy, 'glow', 3)
            C.put(cx - 1, cy - 1, 'glow', 3)
        # mouth slot
        C.rect((A['eye_back']) * UP, (hb - 1) * UP, (A['eye_front'] - A['eye_back'] + 1) * UP, 1, 'joint', 0)


# ---------------------------------------------------------------- body gear
def body_gear(C, A, family, gear, variant):
    tt, pt, tl, tr = A['torso_top'], A['pants_top'], A['torso_l'], A['torso_r']
    # collar: the jumpsuit climbs over the bottom of the chin
    cy = A['head_bot'] * UP + 1
    for x in range((tl + 1) * UP, tr * UP):
        c = C.get(x, cy)
        if c and c[0] == 'skin' and family != 'droid':
            C.put(x, cy, 'suit', 3 if x % 3 else 2)
    # belt between shirt and pants, buckle toward the front
    by = pt * UP
    for x in range(tl * UP, (tr + 1) * UP):
        c = C.get(x, by)
        if c and c[0] in ('pants', 'suit'):
            C.put(x, by, 'belt', 2)
    C.put((tr - 1) * UP, by, 'pad', 4)
    C.put((tr - 1) * UP + 1, by, 'pad', 3)
    # shoulder pad on the back shoulder
    sx, sy = (tl + 1) * UP, tt * UP
    if C.solid(sx, sy):
        C.rect(sx - 1, sy - 1, 4, 1, 'O')
        C.rect(sx, sy, 3, 2, 'pad', 3 if family != 'droid' else 4)
        C.put(sx, sy, 'pad', 4)
    # chest detail
    chx, chy = (tr - 2) * UP, tt * UP + 1
    if family == 'droid':
        C.put(chx, chy, 'glow', 3)
        C.put(chx + 1, chy, 'glow', 2)
    elif family == 'alien':
        # diagonal sash
        for i in range(0, (pt - tt) * UP + 1):
            x = tl * UP + 2 + i * 2
            if C.solid(x, tt * UP + i) and C.get(x, tt * UP + i)[0] == 'suit':
                C.put(x, tt * UP + i, 'bone', 3)
                if C.solid(x + 1, tt * UP + i):
                    C.put(x + 1, tt * UP + i, 'bone', 2)
    else:
        if C.solid(chx, chy):
            C.put(chx, chy, 'glowdim', 0)
            C.put(chx + 1, chy, 'pad', 4)
    # knee pads / droid pistons
    ky = (A['feet'] - 1) * UP
    for x in range(tl * UP, (tr + 1) * UP):
        c = C.get(x, ky)
        if c and c[0] == 'pants' and (x // UP) % 3 == 1:
            C.put(x, ky, 'pad' if family != 'droid' else 'skin', 3)


def work_tool(C, A, anim, frame, role, glow):
    if anim != 'work' or not A['hand']:
        return
    hx = max(x for x, y in A['hand'])
    hy = sorted(y for x, y in A['hand'] if x == hx)[0]
    tx, ty = (hx + 1) * UP, hy * UP + 1
    tool = {'engineer': 'welder', 'gunner': 'welder', 'security': 'welder', 'medic': 'scanner'}.get(role, 'datapad')
    if tool == 'datapad':
        C.rect(tx - 1, ty - 2, 5, 6, 'O')
        C.rect(tx, ty - 1, 3, 4, 'glass', 2)
        C.rect(tx, ty - 1 + (frame % 4), 3, 1, 'glow', 2)
        C.put(tx + 1, ty, 'glow', 3 if frame % 2 else 2)
    else:
        C.rect(tx - 1, ty - 1, 5, 3, 'O')
        C.rect(tx, ty, 3, 1, 'pad', 3)
        tip = (tx + 3, ty)
        C.put(tip[0], tip[1], 'glow', 3)
        if tool == 'welder':
            for n in range(3):
                r = hash01(frame, n, 7)
                sx = tip[0] + 1 + int(r * 4)
                sy = tip[1] - 2 + int(hash01(n, frame, 3) * 6)
                C.put(sx, sy, 'spark', 3 if n == 0 else 2)
        else:
            beam = 2 + frame % 4
            for i in range(beam):
                C.put(tip[0] + 1 + i, tip[1] + (i % 2 if frame % 2 else 0), 'glow', 1 if i else 2)


# ---------------------------------------------------------------- finishing
def finish(C, A, family, mats, gear):
    g = C.g
    solid = [[c is not None for c in row] for row in g]
    # outer 1px outline around the full silhouette (including gear)
    add = []
    for y in range(CELL_H):
        for x in range(CELL_W):
            if solid[y][x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < CELL_W and 0 <= yy < CELL_H and solid[yy][xx] and g[yy][xx][0] not in ('spark',):
                    add.append((x, y))
                    break
    for x, y in add:
        g[y][x] = ('O', 1)
    # bevel light from above, occlusion below, grime anchored to the body
    for y in range(CELL_H):
        for x in range(CELL_W):
            c = g[y][x]
            if not c or c[0] in ('O', 'glow', 'glowdim', 'spark', 'eye', 'glass'):
                continue
            mat, lvl = c
            up = g[y - 1][x] if y else None
            dn = g[y + 1][x] if y + 1 < CELL_H else None
            if up is None or up[0] == 'O':
                lvl += 1
            elif dn is None or dn[0] == 'O':
                lvl -= 1
            ax = x - A['torso_l'] * UP if y >= A['torso_top'] * UP else x - A['head_l'] * UP
            ay = y - A['torso_top'] * UP if y >= A['torso_top'] * UP else y - A['head_top'] * UP
            n = hash01(ax, ay, 91)
            if mat in ('suit', 'pants', 'belt', 'boot') and n < 0.16:
                lvl -= 1
            elif mat == 'skin' and family == 'droid' and n < 0.10:
                lvl -= 1 if n < 0.07 else -1
            elif mat == 'pad' and n < 0.05:
                lvl -= 1
            g[y][x] = (mat, max(0, min(4, lvl)))


def resolve(C, mats, family):
    im = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    px = im.load()
    glow = GLOW[mats['glow']]
    pants = [mix(a, b, 0.45) for a, b in zip(R[mats['suit']], R['joint'])]
    fin = R['alien.' + {'violet': 'crimson', 'teal': 'glass', 'sand': 'crimson'}.get(mats['skin'].split('.')[-1], 'teal')] \
        if family == 'alien' else R['pad']
    for y in range(CELL_H):
        for x in range(CELL_W):
            c = C.g[y][x]
            if not c:
                continue
            mat, lvl = c
            if mat == 'O':
                col = OUTLINE if lvl == 0 else '#0b0c12'
            elif mat == 'glow':
                col = glow[min(3, lvl)]
            elif mat == 'glowdim':
                col = glow[0]
            elif mat == 'spark':
                col = ['#6b2a07', '#c45a10', '#ffb347', '#fff1c4'][min(3, lvl)]
            elif mat == 'skin':
                col = R[mats['skin']][lvl]
            elif mat == 'suit':
                col = R[mats['suit']][lvl]
            elif mat == 'pants':
                col = pants[lvl]
            elif mat == 'hairx':
                col = HAIR.get(mats['hair'], HAIR['black'])[lvl]
            elif mat == 'fin':
                col = fin[lvl]
            else:
                col = R[mat][lvl]
            px[x, y] = hexrgb(col) + (255,)
    return im


def mix(a, b, t):
    ra, rb = hexrgb(a), hexrgb(b)
    return '#%02x%02x%02x' % tuple(int(round(ra[i] + (rb[i] - ra[i]) * t)) for i in range(3))


# ---------------------------------------------------------------- build
def family_of(look, species):
    fam = look.get('family') or {'alien': 'alien', 'droid': 'droid'}.get(species, 'human')
    return fam


def render(look_id, look, role, species, anim, frame):
    family = family_of(look, species)
    gear = set(look.get('gear', '').split())
    variant = look.get('variant', 'crew' if family == 'human' else 'grey' if family == 'alien' else 'box')
    hair_style = ('shorthair' if 'helmet' in gear else look.get('rigHair', look.get('hair'))) if family == 'human' else None
    if hair_style == 'base':
        hair_style = None
    L, hairL, A = label_frame(anim, frame, hair_style)
    mats = mat_for(look, family)
    C = Canvas()
    paint_base(C, L, hairL, A, family, look, mats, gear)
    body_gear(C, A, family, gear, variant)
    if family == 'human':
        human_head(C, A, gear, mats, frame, anim)
    elif family == 'alien':
        alien_head(C, A, variant, mats, frame, anim)
    else:
        droid_head(C, A, variant, mats, frame, anim, ANIMS[anim]['frames'])
    work_tool(C, A, anim, frame, role, mats['glow'])
    finish(C, A, family, mats, gear)
    return resolve(C, mats, family), family, variant


def build(only=None):
    looks = parse_looks()
    roster = parse_roster()
    missing = sorted(set(roster) - set(looks))
    if missing:
        sys.exit(f'roster templates without a look: {missing}')
    os.makedirs(OUT, exist_ok=True)
    manifest = {
        'version': 1,
        'source': 'Sunnyside rig (public/art/char) reskinned by scripts/crew-rig/build_crew_sheets.py',
        'cell': {'w': CELL_W, 'h': CELL_H},
        'footAnchor': {'x': FOOT[0], 'y': FOOT[1]},
        'facing': 'right',
        'animations': {k: {'frames': v['frames'], 'fps': v['fps']} for k, v in ANIMS.items()},
        'looks': {},
    }
    frames_out = {}
    for look_id, look in looks.items():
        info = roster.get(look_id, {'role': 'pilot', 'species': 'human'})
        entry = None
        for anim, spec in ANIMS.items():
            sheet = Image.new('RGBA', (CELL_W * spec['frames'], CELL_H), (0, 0, 0, 0))
            for f in range(spec['frames']):
                im, family, variant = render(look_id, look, info['role'], info['species'], anim, f)
                sheet.paste(im, (f * CELL_W, 0))
                frames_out[(look_id, anim, f)] = im
            if not only or look_id in only:
                sheet.save(os.path.join(OUT, f'{look_id}_{anim}.png'), optimize=True)
            entry = entry or {'family': family, 'variant': variant, 'species': info['species'], 'sheets': {}}
            entry['sheets'][anim] = f'art/crew/{look_id}_{anim}.png'
        manifest['looks'][look_id] = entry
    with open(os.path.join(OUT, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)
        fh.write('\n')
    with open(MANIFEST_JS, 'w') as fh:
        fh.write('// @ts-nocheck\n// GENERATED by scripts/crew-rig/build_crew_sheets.py — do not edit by hand.\n')
        fh.write('export const CREW_RIG = ')
        fh.write(json.dumps(manifest, indent=2, sort_keys=True))
        fh.write(';\n')
    contact_sheet(looks, manifest, frames_out)
    print(f"baked {len(manifest['looks'])} looks -> {os.path.relpath(OUT, ROOT)}")


def contact_sheet(looks, manifest, frames):
    os.makedirs(CONTACT, exist_ok=True)
    Z = 4
    bg = (22, 25, 32, 255)
    floor = (34, 38, 46, 255)
    # 1. one representative per family/variant, every frame of every loop
    reps = []
    seen = set()
    for look_id, e in manifest['looks'].items():
        key = (e['family'], e['variant'], looks[look_id].get('tone', looks[look_id].get('gear', '')))
        if (e['family'], e['variant']) in seen and e['family'] != 'human':
            continue
        if e['family'] == 'human' and len([r for r in reps if manifest['looks'][r]['family'] == 'human']) >= 5:
            continue
        seen.add((e['family'], e['variant']))
        reps.append(look_id)
    cols = sum(a['frames'] for a in ANIMS.values()) + 2
    sheet = Image.new('RGBA', (cols * CELL_W * Z, len(reps) * CELL_H * Z), bg)
    for r, look_id in enumerate(reps):
        c = 0
        for anim in ANIMS:
            for f in range(ANIMS[anim]['frames']):
                tile = Image.new('RGBA', (CELL_W, CELL_H), floor if (r + c) % 2 else bg)
                tile.alpha_composite(frames[(look_id, anim, f)])
                sheet.paste(tile.resize((CELL_W * Z, CELL_H * Z), Image.NEAREST), (c * CELL_W * Z, r * CELL_H * Z))
                c += 1
            c += 1 if anim != 'work' else 0
    sheet.convert('RGB').save(os.path.join(CONTACT, 'contact-sheet.png'), optimize=True)
    # 2. the whole roster: walk frames 0/2/4/6 + idle 0 + work 3, flipped copy for left
    ids = list(manifest['looks'])
    per_row = 5
    tile_w = CELL_W * 7
    rows = (len(ids) + per_row - 1) // per_row
    Z2 = 3
    roster = Image.new('RGBA', (per_row * tile_w * Z2, rows * CELL_H * Z2), bg)
    for i, look_id in enumerate(ids):
        strip_im = Image.new('RGBA', (tile_w, CELL_H), floor if (i // per_row + i) % 2 else bg)
        seq = [('walk', 0), ('walk', 2), ('walk', 4), ('walk', 6), ('idle', 0), ('work', 3)]
        for k, (anim, f) in enumerate(seq):
            strip_im.alpha_composite(frames[(look_id, anim, f)], (k * CELL_W, 0))
        strip_im.alpha_composite(frames[(look_id, 'walk', 2)].transpose(Image.FLIP_LEFT_RIGHT), (6 * CELL_W, 0))
        x = (i % per_row) * tile_w * Z2
        y = (i // per_row) * CELL_H * Z2
        roster.paste(strip_im.resize((tile_w * Z2, CELL_H * Z2), Image.NEAREST), (x, y))
    roster.convert('RGB').save(os.path.join(CONTACT, 'roster-sheet.png'), optimize=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    build(set(filter(None, args.only.split(','))) or None)
