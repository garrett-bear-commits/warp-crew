// @ts-nocheck
import { recolor, recolorHair, bodyMaps, hairRamp, SKIN_TONES, HAIR_COLORS, CLOTH_COLORS } from '../shared/recolor.js';
import { CREW_LOOKS, lookIdFor } from '../data/looks.js';
import { portraitFor } from '../data/portraits.js';
import { artUrl } from '../shared/artUrl.js';
import { animationProfileFor } from './crewAnimation.js';

const SRC_W = 96;
const SRC_H = 64;
export const IDLE_FRAMES = 9;
export const DOING_FRAMES = 8;
export const CELL_W = 32;
export const CELL_H = 32;
export const WALK_CELL = 96;
export const WALK_FRAMES = 4;
export const WALK_DIRS = ['down', 'left', 'right', 'up'];
const CROP = { x: 36, y: 16, w: 24, h: 24 };
const PAD = { x: 4, y: 8 };

const sheets = Object.create(null);
const walkImgs = Object.create(null);
const identityMarkers = Object.create(null);

export function staticCrewMarkerFor(templateId) {
  if (templateId === 'captain_alien') return { src: portraitFor(templateId), shape: 'diamond', color: '#73e5d5', label: 'A' };
  if (templateId === 'captain_droid') return { src: portraitFor(templateId), shape: 'square', color: '#ffae55', label: 'D' };
  return null;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    const t = setTimeout(() => rej(new Error('timeout ' + src)), 4000);
    i.onload = () => {
      clearTimeout(t);
      res(i);
    };
    i.onerror = () => {
      clearTimeout(t);
      rej(new Error('failed to load ' + src));
    };
    i.src = src;
  });
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function mixRamp(ramp, t) {
  const stops = ramp.map(hexToRgb);
  if (stops.length === 1) return stops[0];
  const u = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
  const i = u | 0;
  const f = u - i;
  const a = stops[i];
  const b = stops[Math.min(stops.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

async function flattenStrip(look, kind) {
  const frames = kind === 'doing' ? DOING_FRAMES : IDLE_FRAMES;
  const file = kind === 'doing' ? 'doing_strip8.png' : 'idle_strip9.png';
  const base = await loadImage(artUrl(`art/char/base_${file}`));
  const hair =
    look.hair && look.hair !== 'base'
      ? await loadImage(artUrl(`art/char/${look.hair}_${file}`))
      : null;
  const body = recolor(base, bodyMaps(look));
  const flat = document.createElement('canvas');
  flat.width = SRC_W * frames;
  flat.height = SRC_H;
  const fg = flat.getContext('2d');
  fg.imageSmoothingEnabled = false;
  fg.drawImage(body, 0, 0);
  if (hair) fg.drawImage(recolorHair(hair, base, hairRamp(look)), 0, 0);

  const c = document.createElement('canvas');
  c.width = CELL_W * frames;
  c.height = CELL_H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (let i = 0; i < frames; i++) {
    g.drawImage(
      flat,
      i * SRC_W + CROP.x,
      CROP.y,
      CROP.w,
      CROP.h,
      i * CELL_W + PAD.x,
      PAD.y,
      CROP.w,
      CROP.h
    );
  }
  return c.toDataURL('image/png');
}

function tintWalk(img, look) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const skin = SKIN_TONES[look.skin] || SKIN_TONES.tan;
  const hair = HAIR_COLORS[look.hairColor] || HAIR_COLORS.brown;
  const cloth = (CLOTH_COLORS[look.cloth] || CLOTH_COLORS.cyan).shirt;
  const pants = (CLOTH_COLORS[look.cloth] || CLOTH_COLORS.cyan).pants;

  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 12) continue;
    const r = px[i];
    const gv = px[i + 1];
    const b = px[i + 2];
    const [h, s, v] = rgbToHsv(r, gv, b);
    // leftover magenta / hot-pink key from the walk sheet
    if (s > 0.35 && v > 0.2 && h >= 270 && h <= 340 && r > gv + 30 && b > gv) {
      px[i + 3] = 0;
      continue;
    }
    if (r > 200 && b > 180 && gv < 90) {
      px[i + 3] = 0;
      continue;
    }
    const y = ((i / 4 / c.width) | 0) % WALK_CELL;
    const cellY = y / WALK_CELL;
    let dst = null;
    if (s > 0.28 && h >= 160 && h <= 210 && v > 0.25) {
      dst = mixRamp(cellY < 0.42 ? hair : cloth, v);
    } else if (s > 0.22 && h >= 12 && h <= 48 && v > 0.45) {
      dst = mixRamp(skin, Math.max(0, (v - 0.4) / 0.6));
    } else if (s > 0.18 && h >= 12 && h <= 42 && v > 0.18 && v <= 0.5) {
      dst = mixRamp(cloth, v * 1.1);
    } else if (s < 0.28 && v < 0.38 && v > 0.08) {
      dst = mixRamp(pants, v / 0.38);
    }
    if (!dst) continue;
    px[i] = dst[0];
    px[i + 1] = dst[1];
    px[i + 2] = dst[2];
  }
  g.putImageData(data, 0, 0);
  const out = new Image();
  out.src = c.toDataURL('image/png');
  return out;
}

async function flattenWalk(look) {
  const base = await loadImage(artUrl('art/char/walk-4dir.png'));
  const img = tintWalk(base, look);
  await new Promise((res, rej) => {
    if (img.complete && img.naturalWidth) return res();
    img.onload = () => res();
    img.onerror = rej;
  });
  return img;
}

export async function prepareCrewArt() {
  const entries = Object.entries(CREW_LOOKS);
  await Promise.all([
    ...['captain_alien', 'captain_droid'].map(async id => {
      try { identityMarkers[id] = await loadImage(staticCrewMarkerFor(id).src); }
      catch (error) { console.warn('crew marker', id, error); }
    }),
    ...entries.map(async ([id, look]) => {
      try {
        const [idle, doing, walk] = await Promise.all([
          flattenStrip(look, 'idle'),
          flattenStrip(look, 'doing').catch(() => null),
          flattenWalk(look).catch(() => null),
        ]);
        sheets[id] = {
          url: idle,
          idle,
          doing: doing || idle,
          walk: idle,
          frames: IDLE_FRAMES,
          framesDoing: doing ? DOING_FRAMES : IDLE_FRAMES,
          w: CELL_W,
          h: CELL_H,
        };
        if (walk) walkImgs[id] = walk;
      } catch (e) {
        console.warn('crew look', id, e);
      }
    }),
  ]);
}

export function hasCrewArt() {
  return Object.keys(sheets).length > 0;
}

export function resolveCrewSheet(templateId, role, library) {
  // Rejected alien and droid walk sheets must never become a human sprite.
  if (templateId === 'captain_alien' || templateId === 'captain_droid') return null;
  const id = lookIdFor(templateId, role);
  if (library[id]) return library[id];
  return library.merc_rex || null;
}

export function sheetFor(templateId, role) {
  return resolveCrewSheet(templateId, role, sheets);
}

export function walkSheetFor(templateId, role) {
  return resolveCrewSheet(templateId, role, walkImgs);
}

export function walkAssetFor(templateId, role, bodyFamily = 'standard_humanoid') {
  return {
    image: walkSheetFor(templateId, role),
    marker: staticCrewMarkerFor(templateId),
    markerImage: identityMarkers[templateId] || null,
    profile: animationProfileFor(bodyFamily),
  };
}
