// @ts-nocheck
import { SPACE_ART } from '../data/portraits.js';
import { onTick } from './stageLoop.js';
import { effectScreenPoint, visibleLandmarks } from './worldProjection.js';

let canvas = null, ctx = null, w = 0, h = 0, dpr = 1, started = false;
let motionQuery = null, getCamera = null, landmarkSeed = 77, launch = null, clock = 0;
const rocks = [];
const images = Object.create(null);

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

function resize() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  w = Math.max(1, rect.width);
  h = Math.max(1, rect.height);
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawImageOrFallback(g, image, point, size, fallback) {
  if (image?.complete && image.naturalWidth) {
    g.drawImage(image, point.x - size / 2, point.y - size / 2, size, size);
  } else fallback();
}

function drawLandmarks(g, camera) {
  const items = visibleLandmarks(landmarkSeed, camera);
  for (const item of items.filter(item => item.kind === 'nebula')) {
    const point = effectScreenPoint(camera, item);
    const size = item.size * camera.scale;
    g.save();
    g.globalAlpha = 0.3;
    drawImageOrFallback(g, load(SPACE_ART.nebula), point, size, () => {
      const glow = g.createRadialGradient(point.x, point.y, 0, point.x, point.y, size / 2);
      glow.addColorStop(0, 'rgba(88,67,146,0.5)');
      glow.addColorStop(1, 'rgba(88,67,146,0)');
      g.fillStyle = glow;
      g.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    });
    g.restore();
  }
  for (const item of items) {
    const point = effectScreenPoint(camera, item);
    if (item.kind === 'star') {
      const twinkle = motionQuery?.matches ? 1 : 0.85 + Math.sin(clock * 1.2 + item.depth * 23) * 0.15;
      g.fillStyle = `rgba(215,231,255,${(0.28 + item.depth * 0.7) * twinkle})`;
      const size = Math.max(0.7, item.size * camera.scale * 2);
      g.fillRect(point.x, point.y, size, launch && !motionQuery?.matches ? size * 6 : size);
    } else if (item.kind === 'planet' || item.kind === 'ice' || item.kind === 'hole') {
      const size = item.size * camera.scale;
      const src = item.kind === 'planet' ? SPACE_ART.planet
        : item.kind === 'ice' ? SPACE_ART.planetIce : SPACE_ART.blackhole;
      drawImageOrFallback(g, load(src), point, size, () => {
        g.fillStyle = item.kind === 'planet' ? '#455683'
          : item.kind === 'ice' ? '#9ecadd' : '#12101f';
        g.beginPath();
        g.arc(point.x, point.y, size * 0.42, 0, Math.PI * 2);
        g.fill();
      });
    }
  }
}

function spawnRock(camera) {
  const world = camera.world || { w: 1152, h: 1728 };
  const src = SPACE_ART.asteroids[(Math.random() * SPACE_ART.asteroids.length) | 0];
  rocks.push({
    worldX: Math.random() * world.w, worldY: -60,
    size: 35 + Math.random() * 45, speed: 50 + Math.random() * 40,
    rotation: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.4,
    image: load(src),
  });
}

function drawRocks(g, camera, dt) {
  if (!motionQuery?.matches && rocks.length < 3 && Math.random() < dt * 0.6) spawnRock(camera);
  for (let i = rocks.length - 1; i >= 0; i--) {
    const rock = rocks[i];
    rock.worldY += rock.speed * dt;
    rock.rotation += rock.spin * dt;
    if (rock.worldY > (camera.world?.h || 1728) + 100) {
      rocks.splice(i, 1);
      continue;
    }
    const point = effectScreenPoint(camera, rock);
    const size = rock.size * camera.scale;
    g.save();
    g.translate(point.x, point.y);
    g.rotate(rock.rotation);
    g.globalAlpha = 0.7;
    drawImageOrFallback(g, rock.image, { x: 0, y: 0 }, size, () => {
      g.fillStyle = '#6a6e78';
      g.beginPath();
      g.arc(0, 0, size * 0.35, 0, Math.PI * 2);
      g.fill();
    });
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
  else if (launch) dt *= 6;
  clock += dt;
  const g = ctx;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#03050c';
  g.fillRect(0, 0, w, h);
  const camera = getCamera();
  if (!camera) return;
  drawLandmarks(g, camera);
  drawRocks(g, camera, dt);
}

export function attachSpace(el, cameraGetter, seed = 77) {
  if (!el) return;
  getCamera = cameraGetter;
  landmarkSeed = seed;
  if (!motionQuery) motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  if (canvas === el && started) return;
  canvas = el;
  resize();
  if (!el._wcRo) {
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
