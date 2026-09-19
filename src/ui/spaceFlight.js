// @ts-nocheck
import { SPACE_ART } from '../data/portraits.js';
import { onTick } from './stageLoop.js';

let canvas = null;
let ctx = null;
let w = 0;
let h = 0;
let dpr = 1;
let started = false;
let clock = 0;

const stars = [];
const rocks = [];
const bodies = [];
const imgs = Object.create(null);
let spawnPlanet = 4;
let spawnIce = 14;
let spawnNebula = 8;
let spawnHole = 22;

function load(src) {
  if (!src) return null;
  if (imgs[src]) return imgs[src];
  const im = new Image();
  im.src = src;
  imgs[src] = im;
  return im;
}

function resize() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  w = Math.max(1, rect.width);
  h = Math.max(1, rect.height);
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = (w * dpr) | 0;
  canvas.height = (h * dpr) | 0;
  ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function seedStars() {
  stars.length = 0;
  const n = 110;
  for (let i = 0; i < n; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random(),
      s: Math.random() < 0.12 ? 1.6 : 1,
    });
  }
}

function seedRocks() {
  rocks.length = 0;
  for (let i = 0; i < 3; i++) {
    rocks.push(makeRock(true));
  }
}

function makeRock(anywhere) {
  const src = SPACE_ART.asteroids[(Math.random() * SPACE_ART.asteroids.length) | 0];
  return {
    kind: 'rock',
    img: load(src),
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : -40,
    s: 18 + Math.random() * 28,
    vy: 22 + Math.random() * 26,
    rot: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.4,
    a: 0.55 + Math.random() * 0.3,
  };
}

function makeBody(kind) {
  if (kind === 'planet') {
    return {
      kind,
      img: load(SPACE_ART.planet),
      x: w * (0.08 + Math.random() * 0.2),
      y: -120,
      s: 92 + Math.random() * 50,
      vy: 48 + Math.random() * 28,
      a: 0.95,
    };
  }
  if (kind === 'ice') {
    return {
      kind,
      img: load(SPACE_ART.planetIce),
      x: w * (0.62 + Math.random() * 0.22),
      y: -80,
      s: 52 + Math.random() * 28,
      vy: 56 + Math.random() * 34,
      a: 0.92,
    };
  }
  if (kind === 'nebula') {
    return {
      kind,
      img: load(SPACE_ART.nebula),
      x: w * 0.5,
      y: -160,
      s: Math.max(w, h) * (0.7 + Math.random() * 0.25),
      vy: 7 + Math.random() * 6,
      a: 0.38,
    };
  }
  return {
    kind: 'hole',
    img: load(SPACE_ART.blackhole),
    x: w * (0.18 + Math.random() * 0.64),
    y: -90,
    s: 70 + Math.random() * 40,
    vy: 9 + Math.random() * 7,
    a: 0.85,
  };
}

function tick(sim, dt) {
  if (!canvas || !ctx || !w) return;
  clock += dt;
  const g = ctx;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#03050c';
  g.fillRect(0, 0, w, h);

  const nebula = bodies.find((b) => b.kind === 'nebula');
  if (nebula) drawBody(g, nebula);

  // far stars
  g.fillStyle = '#d7e7ff';
  for (const s of stars) {
    const spd = 6 + s.z * 10;
    s.y += spd * dt;
    if (s.y > h + 2) {
      s.y = -2;
      s.x = Math.random() * w;
    }
    const a = 0.28 + s.z * 0.7;
    g.globalAlpha = a;
    const sz = s.s * (0.6 + s.z * 0.8);
    g.fillRect(s.x, s.y, sz, sz);
  }
  g.globalAlpha = 1;

  spawnPlanet -= dt;
  spawnIce -= dt;
  spawnNebula -= dt;
  spawnHole -= dt;
  if (spawnPlanet <= 0 && !bodies.some((b) => b.kind === 'planet')) {
    bodies.push(makeBody('planet'));
    spawnPlanet = 18 + Math.random() * 22;
  }
  if (spawnIce <= 0 && !bodies.some((b) => b.kind === 'ice')) {
    bodies.push(makeBody('ice'));
    spawnIce = 28 + Math.random() * 34;
  }
  if (spawnNebula <= 0 && !bodies.some((b) => b.kind === 'nebula')) {
    bodies.push(makeBody('nebula'));
    spawnNebula = 48 + Math.random() * 40;
  }
  if (spawnHole <= 0 && !bodies.some((b) => b.kind === 'hole')) {
    bodies.push(makeBody('hole'));
    spawnHole = 70 + Math.random() * 50;
  }

  if (rocks.length < 3 && Math.random() < dt * 0.25) rocks.push(makeRock(false));

  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (b.kind === 'nebula') continue;
    b.y += b.vy * dt;
    drawBody(g, b);
    if (b.y - b.s > h + 40) bodies.splice(i, 1);
  }
  if (nebula) {
    nebula.y += nebula.vy * dt;
    if (nebula.y - nebula.s > h + 80) {
      const i = bodies.indexOf(nebula);
      if (i >= 0) bodies.splice(i, 1);
    }
  }

  for (let i = rocks.length - 1; i >= 0; i--) {
    const r = rocks[i];
    r.y += r.vy * dt;
    r.rot += r.vr * dt;
    drawRock(g, r);
    if (r.y - r.s > h + 20) rocks.splice(i, 1);
  }
}

function drawBody(g, b) {
  const im = b.img;
  if (!im || !im.complete || !im.naturalWidth) return;
  g.save();
  g.globalAlpha = b.a;
  g.translate(b.x, b.y);
  const iw = im.naturalWidth;
  const ih = im.naturalHeight;
  const sc = b.s / Math.max(iw, ih);
  g.drawImage(im, (-iw * sc) / 2, (-ih * sc) / 2, iw * sc, ih * sc);
  g.restore();
}

function drawRock(g, r) {
  const im = r.img;
  g.save();
  g.translate(r.x, r.y);
  g.rotate(r.rot);
  g.globalAlpha = r.a;
  if (im && im.complete && im.naturalWidth) {
    g.drawImage(im, -r.s / 2, -r.s / 2, r.s, r.s);
  } else {
    g.fillStyle = '#6a6e78';
    g.beginPath();
    g.arc(0, 0, r.s * 0.35, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

export function attachSpace(el) {
  if (!el) return;
  if (canvas === el && started) {
    resize();
    return;
  }
  canvas = el;
  resize();
  if (!el._wcRo) {
    el._wcRo = new ResizeObserver(() => resize());
    el._wcRo.observe(el);
  }
  if (!stars.length) seedStars();
  if (!rocks.length) seedRocks();
  if (!bodies.length && w) {
    const p = makeBody('planet');
    p.y = h * 0.18;
    bodies.push(p);
    const n = makeBody('nebula');
    n.y = h * 0.35;
    n.a = 0.32;
    bodies.push(n);
  }
  load(SPACE_ART.planet);
  load(SPACE_ART.planetIce);
  load(SPACE_ART.nebula);
  load(SPACE_ART.blackhole);
  SPACE_ART.asteroids.forEach(load);
  if (!started) {
    started = true;
    onTick(tick);
    window.addEventListener('resize', resize);
  }
}

export function stopSpace() {
  canvas = null;
  ctx = null;
}
