// @ts-nocheck
import { SPACE_ART } from '../data/portraits.js';
import { onTick } from './stageLoop.js';
import { addTrauma, hitstop, sfx, unlockSfx, applyShake } from './juice.js';
import { setBattleStations } from './crewWalk.js';
import { effectScreenPoint } from './worldProjection.js';

let canvas = null;
let stageEl = null;
let ctx = null;
let w = 0;
let h = 0;
let dpr = 1;
let battle = null;
let started = false;
let pirateImg = null;
let impactImg = null;
let getCamera = null;

function img(src) {
  const im = new Image();
  im.src = src;
  return im;
}

function ensureFx() {
  if (!pirateImg) pirateImg = img(SPACE_ART.pirate);
  if (!impactImg) impactImg = img(SPACE_ART.impact);
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

export function attachCombat(el, stage, cameraGetter) {
  ensureFx();
  canvas = el;
  stageEl = stage || el?.parentElement;
  getCamera = cameraGetter;
  if (el) {
    resize();
    el.style.pointerEvents = 'none';
    if (!el._wcRo) {
      el._wcRo = new ResizeObserver(() => resize());
      el._wcRo.observe(el);
    }
  }
  if (!started) {
    started = true;
    onTick(tick);
    window.addEventListener('resize', resize);
  }
}

export function isBattlePlaying() {
  return Boolean(battle);
}

export function playCombat({ preview, win = true, onDone } = {}) {
  unlockSfx();
  resize();
  const nose = { worldX: 576, worldY: 121 };
  const pirateTarget = { worldX: 1030, worldY: 240 };
  const name = preview?.encounter?.name || 'Pirate Scout';
  battle = {
    t: 0,
    win,
    name,
    onDone,
    playerHp: 1,
    enemyHp: 1,
    lasers: [],
    sparks: [],
    flashes: [],
    done: false,
    pirate: { worldX: 1100, worldY: -100,
      targetWorldX: pirateTarget.worldX, targetWorldY: pirateTarget.worldY, a: 0, dead: 0 },
    nose,
    nextVolley: 0.55,
    volley: 0,
  };
  setBattleStations(true);
  if (canvas) canvas.classList.add('is-live');
  sfx('lock');
  if (!ctx) {
    const cb = onDone;
    setTimeout(() => {
      battle = null;
      setBattleStations(false);
      if (canvas) canvas.classList.remove('is-live');
      cb?.();
    }, 400);
  }
}

function spawnLaser(from, to, ally) {
  battle.lasers.push({
    from: { worldX: from.worldX, worldY: from.worldY },
    to: { worldX: to.worldX, worldY: to.worldY },
    life: 0.14,
    max: 0.14,
    ally,
  });
  battle.sparks.push({
    worldX: to.worldX,
    worldY: to.worldY,
    life: 0.28,
    max: 0.28,
    n: 8 + ((Math.random() * 5) | 0),
  });
  battle.flashes.push({ worldX: from.worldX, worldY: from.worldY, life: 0.08, ally });
}

function tick(sim, dt) {
  if (stageEl) applyShake(stageEl);
  if (!battle || !ctx) {
    if (canvas && !battle) {
      ctx?.clearRect(0, 0, w, h);
      canvas.classList.remove('is-live');
    }
    return;
  }
  const b = battle;
  const camera = getCamera?.() || { x: 0, y: 0, scale: 1 };
  b.t += dt;
  const g = ctx;
  g.clearRect(0, 0, w, h);

  const p = b.pirate;
  const ease = 1 - Math.exp(-dt * 4.2);
  if (b.win && b.t > 2.7) {
    p.dead += dt;
    p.worldX += 180 * dt;
    p.worldY -= 80 * dt;
    p.a = Math.max(0, 1 - p.dead * 1.6);
  } else {
    p.worldX += (p.targetWorldX - p.worldX) * ease;
    p.worldY += (p.targetWorldY - p.worldY) * ease;
    p.a = Math.min(1, p.a + dt * 3);
  }

  // dim
  g.fillStyle = `rgba(3,5,12,${Math.min(0.45, b.t * 0.6)})`;
  g.fillRect(0, 0, w, h);

  // pirate
  g.save();
  g.globalAlpha = p.a;
  const piratePoint = effectScreenPoint(camera, p);
  g.translate(piratePoint.x, piratePoint.y);
  if (p.dead) g.rotate(p.dead * 0.6);
  const pw = 500 * camera.scale;
  const ph = 300 * camera.scale;
  if (pirateImg?.complete && pirateImg.naturalWidth) {
    g.drawImage(pirateImg, -pw / 2, -ph / 2, pw, ph);
  } else {
    g.fillStyle = '#c45';
    g.beginPath();
    g.moveTo(pw * 0.34, 0);
    g.lineTo(-pw * 0.3, ph * 0.26);
    g.lineTo(-pw * 0.3, -ph * 0.26);
    g.closePath();
    g.fill();
  }
  g.restore();

  // volleys
  if (b.t > 0.55 && b.t < 2.65 && b.t >= b.nextVolley) {
    b.nextVolley = b.t + 0.28;
    b.volley++;
    const ally = b.volley % 2 === 1;
    const jitter = () => (Math.random() - 0.5) * 80;
    if (ally) {
      spawnLaser(
        { worldX: b.nose.worldX + jitter() * 0.3, worldY: b.nose.worldY },
        { worldX: p.worldX + jitter(), worldY: p.worldY + jitter() },
        true
      );
      b.enemyHp = Math.max(0, b.enemyHp - (b.win ? 0.18 : 0.08));
      addTrauma(0.22);
      hitstop(0.03);
      sfx('pew');
      setTimeout(() => sfx('hit'), 40);
    } else {
      spawnLaser(
        { worldX: p.worldX, worldY: p.worldY },
        { worldX: b.nose.worldX + jitter(), worldY: b.nose.worldY + 130 + jitter() },
        false
      );
      b.playerHp = Math.max(0.35, b.playerHp - (b.win ? 0.06 : 0.16));
      addTrauma(0.34);
      hitstop(0.045);
      sfx('pew');
      setTimeout(() => sfx('hit'), 50);
    }
  }

  if (b.win && b.t > 2.72 && !b.boomed) {
    b.boomed = true;
    addTrauma(0.7);
    hitstop(0.09);
    sfx('boom');
    for (let i = 0; i < 22; i++) {
      b.sparks.push({
        worldX: p.worldX + (Math.random() - 0.5) * 180,
        worldY: p.worldY + (Math.random() - 0.5) * 110,
        life: 0.4 + Math.random() * 0.3,
        max: 0.55,
        n: 10,
      });
    }
  }

  // lasers
  for (let i = b.lasers.length - 1; i >= 0; i--) {
    const L = b.lasers[i];
    L.life -= dt;
    if (L.life <= 0) {
      b.lasers.splice(i, 1);
      continue;
    }
    const a = L.life / L.max;
    const from = effectScreenPoint(camera, L.from);
    const to = effectScreenPoint(camera, L.to);
    g.save();
    g.strokeStyle = L.ally ? `rgba(92,225,255,${0.25 + a * 0.75})` : `rgba(255,90,90,${0.25 + a * 0.75})`;
    g.shadowColor = L.ally ? '#5ce1ff' : '#ff6b6b';
    g.shadowBlur = 12;
    g.lineWidth = 2 + a * 2;
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.stroke();
    g.restore();
  }

  for (let i = b.sparks.length - 1; i >= 0; i--) {
    const s = b.sparks[i];
    s.life -= dt;
    if (s.life <= 0) {
      b.sparks.splice(i, 1);
      continue;
    }
    const a = s.life / s.max;
    const point = effectScreenPoint(camera, s);
    if (impactImg?.complete && impactImg.naturalWidth && a > 0.4) {
      const sz = (120 + (1 - a) * 150) * camera.scale;
      g.globalAlpha = a * 0.8;
      g.drawImage(impactImg, point.x - sz / 2, point.y - sz / 2, sz, sz);
      g.globalAlpha = 1;
    }
    g.fillStyle = `rgba(255,220,140,${a})`;
    for (let k = 0; k < s.n; k++) {
      const ang = (k / s.n) * Math.PI * 2 + b.t * 6;
      const rad = (1 - a) * 100 * camera.scale;
      g.fillRect(point.x + Math.cos(ang) * rad, point.y + Math.sin(ang) * rad, 2, 2);
    }
  }

  // HP bars
  const barY = Math.max(50, h - 46);
  drawBar(g, 16, barY, w * 0.4, 'SPARROW', b.playerHp, '#3ddc97');
  drawBar(g, w - 16 - w * 0.4, barY, w * 0.4, b.name.toUpperCase(), b.enemyHp, '#ff6b6b');

  if (b.t > 3.45 && !b.done) {
    b.done = true;
    if (b.win) sfx('win');
    const cb = b.onDone;
    setTimeout(() => {
      battle = null;
      setBattleStations(false);
      if (canvas) {
        ctx?.clearRect(0, 0, w, h);
        canvas.classList.remove('is-live');
      }
      if (stageEl) stageEl.style.transform = '';
      cb?.();
    }, 180);
  }
}

function drawBar(g, x, y, width, label, pct, color) {
  g.save();
  g.font = '700 11px Rajdhani, sans-serif';
  g.fillStyle = '#8aa0bd';
  g.fillText(label, x, y + 10);
  g.fillStyle = '#071018';
  g.fillRect(x, y + 14, width, 8);
  g.fillStyle = color;
  g.fillRect(x, y + 14, width * Math.max(0, pct), 8);
  g.strokeStyle = '#1e2d45';
  g.strokeRect(x, y + 14, width, 8);
  g.restore();
}
