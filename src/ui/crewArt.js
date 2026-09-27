// @ts-nocheck
import { recolor, recolorHair, bodyMaps, hairRamp } from '../shared/recolor.js';
import { CREW_LOOKS, lookIdFor } from '../data/looks.js';
import { CREW_RIG } from '../data/crewRigManifest.js';
import { artUrl } from '../shared/artUrl.js';
import { animationProfileFor } from './crewAnimation.js';

const SRC_W = 96;
const SRC_H = 64;
export const IDLE_FRAMES = 9;
export const DOING_FRAMES = 8;
export const CELL_W = 32;
export const CELL_H = 32;
const CROP = { x: 36, y: 16, w: 24, h: 24 };
const PAD = { x: 4, y: 8 };

const sheets = Object.create(null);
const rigImages = Object.create(null);

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

export async function prepareCrewArt() {
  const entries = Object.entries(CREW_LOOKS);
  await Promise.all(
    entries.map(async ([id, look]) => {
      try {
        const [idle, doing] = await Promise.all([
          flattenStrip(look, 'idle'),
          flattenStrip(look, 'doing').catch(() => null),
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
      } catch (e) {
        console.warn('crew look', id, e);
      }
    })
  );
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

/** Baked ship-sprite entry for a template: family, variant and clip sheets. */
export function rigLookFor(templateId, role) {
  const id = lookIdFor(templateId, role);
  const lookId = CREW_RIG.looks[id] ? id : 'merc_rex';
  return { lookId, ...CREW_RIG.looks[lookId] };
}

export function rigFamilyFor(templateId, role) {
  return rigLookFor(templateId, role).family;
}

function rigImage(path) {
  if (rigImages[path] !== undefined) return rigImages[path];
  if (typeof Image === 'undefined') return (rigImages[path] = null);
  const img = new Image();
  img.decoding = 'async';
  img.onerror = () => console.warn('crew rig sheet failed', path);
  img.src = artUrl(path);
  rigImages[path] = img;
  return img;
}

function ready(img) {
  return img && img.complete && img.naturalWidth ? img : null;
}

/** Start loading every clip for the given templates (e.g. the current crew). */
export function preloadCrewRig(templateIds = []) {
  for (const templateId of templateIds) {
    for (const path of Object.values(rigLookFor(templateId).sheets)) rigImage(path);
  }
}

export function walkAssetFor(templateId, role) {
  const look = rigLookFor(templateId, role);
  const images = {};
  for (const [clip, path] of Object.entries(look.sheets)) images[clip] = ready(rigImage(path));
  return {
    lookId: look.lookId,
    family: look.family,
    variant: look.variant,
    sheets: look.sheets,
    images,
    profile: animationProfileFor(),
  };
}
