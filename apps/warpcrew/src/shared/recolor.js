// @ts-nocheck
// Runtime recolouring for Sunnyside character layers (from Ninefold).
// Recolor PER LAYER before flattening. Exact colour match, never hue ranges.

const SKIN_SRC = [
  ['#b86f50', '#bb6d53'],
  ['#c58158', '#c87f5b', '#c87f5c'],
  ['#d8956c', '#d9966d'],
  ['#e8ad7d', '#e9ad7d', '#e8ac7c', '#e8ac7d'],
];

const PANTS_SRC = [
  ['#242b42', '#252c43', '#262b44'],
  ['#374464', '#384565', '#3a4466'],
];

const SHIRT_SRC = [
  ['#733e39', '#743f39', '#753c39', '#753d3a'],
  ['#a22633', '#a51f33', '#a61f34'],
  ['#e43b44', '#e83145', '#e93245'],
];

export const SKIN_TONES = {
  light: ['#b86f50', '#c58158', '#d8956c', '#e8ad7d'],
  tan: ['#8f5236', '#a8663f', '#c07f52', '#d99a68'],
  brown: ['#5f3324', '#7a462f', '#96603f', '#b07a54'],
  deep: ['#3d2018', '#54301f', '#6d4530', '#875c42'],
};

export const HAIR_COLORS = {
  black: ['#2b1d18', '#3e2a23', '#54392f'],
  brown: ['#5c2f22', '#7e402e', '#9a5138'],
  ginger: ['#8a3d1a', '#b55022', '#d2652f'],
  sand: ['#8a5c40', '#ad7654', '#c79068'],
  grey: ['#6a5c58', '#867671', '#a2928c'],
  blonde: ['#b9a288', '#d8c2ad', '#efdcc8'],
};

export const CLOTH_COLORS = {
  red: { shirt: ['#733e39', '#a22633', '#e43b44'], pants: ['#242b42', '#374464'] },
  blue: { shirt: ['#243a5c', '#2f5486', '#3d78c0'], pants: ['#1d2436', '#2c3654'] },
  cyan: { shirt: ['#16324a', '#1d5fad', '#3d9cf0'], pants: ['#1a2030', '#2a3548'] },
  green: { shirt: ['#2b4429', '#3d6b34', '#579c45'], pants: ['#232c22', '#35422f'] },
  purple: { shirt: ['#3c2a4a', '#573a6d', '#7d55a0'], pants: ['#241d2e', '#342a44'] },
  ochre: { shirt: ['#5c3f1e', '#8a5c22', '#c08a2c'], pants: ['#2e2718', '#463a22'] },
  slate: { shirt: ['#2e3438', '#454e53', '#657277'], pants: ['#1e2225', '#2e3438'] },
};

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const key = (r, g, b) => (r << 16) | (g << 8) | b;

function buildMap(srcRamp, dstRamp) {
  const map = new Map();
  srcRamp.forEach((group, i) => {
    const dst = hex(dstRamp[i]);
    for (const src of group) {
      const [r, g, b] = hex(src);
      map.set(key(r, g, b), dst);
    }
  });
  return map;
}

export function recolor(img, maps) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  if (!maps.length) return c;

  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const merged = new Map();
  for (const m of maps) for (const [k, v] of m) merged.set(k, v);

  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    const hit = merged.get(key(px[i], px[i + 1], px[i + 2]));
    if (!hit) continue;
    px[i] = hit[0];
    px[i + 1] = hit[1];
    px[i + 2] = hit[2];
  }
  g.putImageData(data, 0, 0);
  return c;
}

export function bodyMaps({ skin = 'light', cloth = 'red' } = {}) {
  const tone = SKIN_TONES[skin] ?? SKIN_TONES.light;
  const kit = CLOTH_COLORS[cloth] ?? CLOTH_COLORS.red;
  return [
    buildMap(SKIN_SRC, tone),
    buildMap(SHIRT_SRC, kit.shirt),
    buildMap(PANTS_SRC, kit.pants),
  ];
}

export function recolorHair(hairImg, bodyImg, ramp) {
  const c = document.createElement('canvas');
  c.width = hairImg.width;
  c.height = hairImg.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(hairImg, 0, 0);
  const hair = g.getImageData(0, 0, c.width, c.height);

  const b = document.createElement('canvas');
  b.width = c.width;
  b.height = c.height;
  const bg = b.getContext('2d', { willReadFrequently: true });
  bg.imageSmoothingEnabled = false;
  bg.drawImage(bodyImg, 0, 0);
  const body = bg.getImageData(0, 0, c.width, c.height).data;

  const px = hair.data;
  const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const isHair = (i) =>
    px[i + 3] > 8 &&
    !(body[i + 3] > 8 && body[i] === px[i] && body[i + 1] === px[i + 1] && body[i + 2] === px[i + 2]);

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < px.length; i += 4) {
    if (!isHair(i)) continue;
    const l = lum(i);
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  if (lo === Infinity) return c;
  const span = Math.max(1e-6, hi - lo);
  const stops = ramp.map(hex);
  for (let i = 0; i < px.length; i += 4) {
    if (!isHair(i)) continue;
    const t = (lum(i) - lo) / span;
    const dst = stops[t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2];
    px[i] = dst[0];
    px[i + 1] = dst[1];
    px[i + 2] = dst[2];
  }
  g.putImageData(hair, 0, 0);
  return c;
}

export function hairRamp({ hairColor = 'black' } = {}) {
  return HAIR_COLORS[hairColor] ?? HAIR_COLORS.black;
}
