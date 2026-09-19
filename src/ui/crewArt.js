// @ts-nocheck
import { recolor, recolorHair, bodyMaps, hairRamp } from '../shared/recolor.js';
import { CREW_LOOKS, lookIdFor } from '../data/looks.js';
import { artUrl } from '../shared/artUrl.js';

const SRC_W = 96;
const SRC_H = 64;
export const IDLE_FRAMES = 9;
export const CELL_W = 32;
export const CELL_H = 32;
const CROP = { x: 36, y: 16, w: 24, h: 24 };
const PAD = { x: 4, y: 8 };

const sheets = Object.create(null);

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

async function flattenLook(look) {
  const base = await loadImage(artUrl('art/char/base_idle_strip9.png'));
  const hair =
    look.hair && look.hair !== 'base'
      ? await loadImage(artUrl(`art/char/${look.hair}_idle_strip9.png`))
      : null;
  const body = recolor(base, bodyMaps(look));
  const flat = document.createElement('canvas');
  flat.width = SRC_W * IDLE_FRAMES;
  flat.height = SRC_H;
  const fg = flat.getContext('2d');
  fg.imageSmoothingEnabled = false;
  fg.drawImage(body, 0, 0);
  if (hair) fg.drawImage(recolorHair(hair, base, hairRamp(look)), 0, 0);

  const c = document.createElement('canvas');
  c.width = CELL_W * IDLE_FRAMES;
  c.height = CELL_H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (let i = 0; i < IDLE_FRAMES; i++) {
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

export async function prepareCrewArt() {
  const entries = Object.entries(CREW_LOOKS);
  await Promise.all(
    entries.map(async ([id, look]) => {
      try {
        const url = await flattenLook(look);
        sheets[id] = { url, frames: IDLE_FRAMES, w: CELL_W, h: CELL_H };
      } catch (e) {
        console.warn('crew look', id, e);
      }
    })
  );
}

export function hasCrewArt() {
  return Object.keys(sheets).length > 0;
}

export function sheetFor(templateId, role) {
  const id = lookIdFor(templateId, role);
  return sheets[id] || sheets.merc_rex || null;
}
