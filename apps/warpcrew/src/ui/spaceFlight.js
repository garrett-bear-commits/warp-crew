// @ts-nocheck
import { SPACE_ART } from '../data/portraits.js';
import { onTick } from './stageLoop.js';
import { makeCamera } from './shipCamera.js';
import { HULL_PX } from '../data/starterShip.js';

// Screen-space parallax backdrop. The ship flies "up", so every layer streams down.
let canvas = null, ctx = null, w = 0, h = 0, dpr = 1, started = false;
let motionQuery = null, getCamera = null, landmarkSeed = 77, launch = null, clock = 0;
let nebula = null;
const stars = [];
const rocks = [];
const images = Object.create(null);
const planet = { y: 0, image: null };

const STAR_LAYERS = [
  { density: 0.00055, speed: 5, size: [0.6, 1.1], alpha: [0.25, 0.55], parallax: 0.015 },
  { density: 0.00022, speed: 13, size: [1, 1.6], alpha: [0.45, 0.8], parallax: 0.035 },
  { density: 0.00006, speed: 30, size: [1.6, 2.4], alpha: [0.75, 1], parallax: 0.07 },
];
const STAR_TINTS = ['215,231,255', '255,236,210', '180,210,255', '255,210,230'];

/** Presentation only; callers invoke this after the launch save commits. */
export function playLaunch({ onDone } = {}) {
  launch = { remaining: 1.8, onDone };
  if (canvas) canvas.dataset.flight = motionQuery?.matches ? 'static' : 'departing';
}

function load(src) {
  if (!src) return null;
  if (images[src]) return images[src];
  const image = new Image();
  image.src = src;
  images[src] = image;
  return image;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function lerp(range, t) {
  return range[0] + (range[1] - range[0]) * t;
}

function buildStars() {
  const rand = seeded(landmarkSeed * 7919);
  stars.length = 0;
  STAR_LAYERS.forEach((layer, index) => {
    const count = Math.round(w * h * layer.density);
    for (let i = 0; i < count; i++) {
      stars.push({
        layer: index,
        x: rand() * w,
        y: rand() * h,
        size: lerp(layer.size, rand()),
        alpha: lerp(layer.alpha, rand()),
        tint: STAR_TINTS[rand() < 0.7 ? 0 : 1 + ((rand() * 3) | 0)],
        phase: rand() * Math.PI * 2,
      });
    }
  });
}

// Soft painted clouds, rendered once per size and scrolled as a tall loop.
function buildNebula() {
  const rand = seeded(landmarkSeed * 104729);
  const tall = Math.max(1, Math.round(h * 2));
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(w));
  off.height = tall;
  const g = off.getContext('2d');
  const hues = [[88, 60, 170], [40, 110, 190], [150, 50, 140], [30, 140, 160]];
  for (let i = 0; i < 9; i++) {
    const [r, gg, b] = hues[i % hues.length];
    // Clouds repeat at the seam so the loop never shows an edge.
    const cx = rand() * w;
    const cy = rand() * h;
    const radius = (0.35 + rand() * 0.55) * Math.max(w, h * 0.6);
    for (const oy of [0, h]) {
      const grad = g.createRadialGradient(cx, cy + oy, 0, cx, cy + oy, radius);
      grad.addColorStop(0, `rgba(${r},${gg},${b},${0.16 + rand() * 0.08})`);
      grad.addColorStop(0.55, `rgba(${r},${gg},${b},0.05)`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, off.width, tall);
    }
  }
  nebula = { canvas: off, offset: 0 };
}

function resize() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const nextW = Math.max(1, rect.width);
  const nextH = Math.max(1, rect.height);
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(nextW * dpr);
  canvas.height = Math.round(nextH * dpr);
  ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (nextW !== w || nextH !== h || !stars.length) {
    w = nextW;
    h = nextH;
    buildStars();
    if (typeof document?.createElement === 'function') buildNebula();
    planet.y = h * 0.16;
  }
}

function panOffset(camera) {
  if (!camera?.viewport) return { x: 0, y: 0 };
  const world = camera.world || HULL_PX;
  return {
    x: camera.x + (world.w * camera.scale) / 2 - camera.viewport.w / 2,
    y: camera.y + (world.h * camera.scale) / 2 - camera.viewport.h / 2,
  };
}

function drawBase(g) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0b0f24');
  sky.addColorStop(0.55, '#060814');
  sky.addColorStop(1, '#03040a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
}

function drawNebula(g, dt, pan) {
  if (!nebula) return;
  nebula.offset = (nebula.offset + dt * 2.5) % h;
  const y = -h + nebula.offset + pan.y * 0.01;
  g.drawImage(nebula.canvas, pan.x * 0.01, y, w, h * 2);
}

function drawPlanet(g, dt, pan) {
  const image = planet.image || (planet.image = load(SPACE_ART.planetHero));
  const radius = Math.min(w, h) * 0.24;
  planet.y += dt * 1.6;
  if (planet.y - radius > h) planet.y = -radius * 1.2;
  const x = w * 0.14 + pan.x * 0.04;
  const y = planet.y + pan.y * 0.04;
  g.save();
  const halo = g.createRadialGradient(x, y, radius * 0.9, x, y, radius * 1.35);
  halo.addColorStop(0, 'rgba(255,120,70,0.22)');
  halo.addColorStop(1, 'rgba(255,120,70,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(x, y, radius * 1.35, 0, Math.PI * 2);
  g.fill();
  if (image?.complete && image.naturalWidth) {
    g.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
    // Terminator: the night side faces away from the nebula light.
    const shade = g.createLinearGradient(x - radius * 0.6, y - radius * 0.6, x + radius, y + radius);
    shade.addColorStop(0, 'rgba(3,4,10,0)');
    shade.addColorStop(0.55, 'rgba(3,4,10,0.35)');
    shade.addColorStop(1, 'rgba(3,4,10,0.88)');
    g.fillStyle = shade;
    g.beginPath();
    g.arc(x, y, radius + 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawStars(g, dt, pan) {
  const still = motionQuery?.matches;
  const warp = launch && !still ? 14 : 1;
  for (const star of stars) {
    const layer = STAR_LAYERS[star.layer];
    star.y += layer.speed * warp * dt;
    if (star.y > h) {
      star.y -= h;
      star.x = Math.random() * w;
    }
    const x = (((star.x + pan.x * layer.parallax) % w) + w) % w;
    const y = (((star.y + pan.y * layer.parallax) % h) + h) % h;
    const twinkle = still ? 1 : 0.8 + Math.sin(clock * (1 + star.layer) + star.phase) * 0.2;
    g.fillStyle = `rgba(${star.tint},${star.alpha * twinkle})`;
    const streak = warp > 1 ? layer.speed * warp * 0.035 : 0;
    g.fillRect(x, y - streak, star.size, star.size + streak);
  }
}

function spawnRock(initial = false) {
  const src = SPACE_ART.asteroids[(Math.random() * SPACE_ART.asteroids.length) | 0];
  const depth = 0.4 + Math.random() * 0.6;
  // Favour the flanks so rocks read around the hull rather than under it.
  const side = Math.random() < 0.5 ? Math.random() * 0.3 : 0.7 + Math.random() * 0.3;
  rocks.push({
    x: side * w,
    y: initial ? Math.random() * h : -60,
    size: (14 + Math.random() * 26) * depth * Math.max(1, w / 390),
    speed: 18 + depth * 38,
    depth,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.6,
    image: load(src),
  });
}

function drawRocks(g, dt, pan) {
  const still = motionQuery?.matches;
  if (!still && rocks.length < 4 && Math.random() < dt * 0.35) spawnRock();
  for (let i = rocks.length - 1; i >= 0; i--) {
    const rock = rocks[i];
    rock.y += rock.speed * (launch && !still ? 8 : 1) * dt;
    rock.rotation += rock.spin * dt;
    if (rock.y > h + 80) {
      rocks.splice(i, 1);
      continue;
    }
    const x = rock.x + pan.x * 0.1 * rock.depth;
    const y = rock.y + pan.y * 0.1 * rock.depth;
    g.save();
    g.translate(x, y);
    g.rotate(rock.rotation);
    g.globalAlpha = 0.55 + rock.depth * 0.45;
    const image = rock.image;
    if (image?.complete && image.naturalWidth) {
      const ratio = image.naturalHeight / image.naturalWidth;
      g.drawImage(image, -rock.size / 2, (-rock.size * ratio) / 2, rock.size, rock.size * ratio);
    } else {
      g.fillStyle = '#6a6e78';
      g.beginPath();
      g.arc(0, 0, rock.size * 0.35, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}

function tick(sim, dt) {
  if (!canvas || !ctx || !getCamera) return;
  if (launch) {
    launch.remaining -= dt;
    canvas.dataset.flight = motionQuery?.matches ? 'static' : 'departing';
    if (launch.remaining <= 0) {
      const done = launch.onDone;
      launch = null;
      canvas.dataset.flight = '';
      done?.();
    }
  }
  if (motionQuery?.matches) dt = 0;
  clock += dt;
  const g = ctx;
  const pan = panOffset(getCamera());
  g.clearRect(0, 0, w, h);
  drawBase(g);
  drawNebula(g, dt, pan);
  drawStars(g, dt, pan);
  drawPlanet(g, dt, pan);
  drawRocks(g, dt, pan);
}

export function attachSpace(el, cameraGetter, seed = 77) {
  if (!el) return;
  getCamera = typeof cameraGetter === 'function' ? cameraGetter
    : () => makeCamera({ w, h }, HULL_PX);
  landmarkSeed = seed;
  if (!motionQuery) motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  if (canvas === el && started) return;
  canvas = el;
  resize();
  if (!rocks.length) for (let i = 0; i < 3; i++) spawnRock(true);
  if (!el._wcRo && typeof ResizeObserver !== 'undefined') {
    el._wcRo = new ResizeObserver(resize);
    el._wcRo.observe(el);
  }
  if (!started) {
    started = true;
    onTick(tick);
    window.addEventListener('resize', resize);
  }
}

export function stopSpace() {
  canvas = null;
  ctx = null;
  getCamera = null;
}
