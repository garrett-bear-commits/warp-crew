// @ts-nocheck
import { SPACE_ART } from '../data/portraits.js';
import { onTick } from './stageLoop.js';
import { addTrauma, hitstop, sfx, unlockSfx, applyShake } from './juice.js';
import { setBattleStations } from './crewWalk.js';

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

export function attachCombat(el, stage) {
  ensureFx();
  canvas = el;
  stageEl = stage || el?.parentElement;
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
  let nose = { x: w * 0.5, y: h * 0.2 };
  let px = w * 0.78;
  let py = h * 0.2;
  if (canvas && stageEl) {
    const ship = stageEl.querySelector('.ship-fit');
    const cr = canvas.getBoundingClientRect();
    if (ship && cr.width) {
      const sr = ship.getBoundingClientRect();
      nose = {
        x: sr.left - cr.left + sr.width * 0.5,
        y: sr.top - cr.top + sr.height * 0.07,
      };
      px = Math.min(w - 64, sr.right - cr.left + 12);
      py = Math.max(56, sr.top - cr.top + sr.height * 0.08);
    }
  }
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
    pirate: { x: px + 80, y: -30, tx: px, ty: py, a: 0, dead: 0 },
    nose,
    nextVolley: 0.55,
    volley: 0,
  };
  setBattleStations(true);
  if (canvas) canvas.classList.add('is-live');
  sfx('lock');
}

function spawnLaser(from, to, ally) {
  battle.lasers.push({
    x0: from.x,
    y0: from.y,
    x1: to.x,
    y1: to.y,
    life: 0.14,
    max: 0.14,
    ally,
  });
  battle.sparks.push({
    x: to.x,
    y: to.y,
    life: 0.28,
    max: 0.28,
    n: 8 + ((Math.random() * 5) | 0),
  });
  battle.flashes.push({ x: from.x, y: from.y, life: 0.08, ally });
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
  b.t += dt;
  const g = ctx;
  g.clearRect(0, 0, w, h);

  const p = b.pirate;
  const ease = 1 - Math.exp(-dt * 4.2);
  if (b.win && b.t > 2.7) {
    p.dead += dt;
    p.x += 40 * dt;
    p.y -= 18 * dt;
    p.a = Math.max(0, 1 - p.dead * 1.6);
  } else {
    p.x += (p.tx - p.x) * ease;
    p.y += (p.ty - p.y) * ease;
    p.a = Math.min(1, p.a + dt * 3);
  }

  // dim
  g.fillStyle = `rgba(3,5,12,${Math.min(0.45, b.t * 0.6)})`;
  g.fillRect(0, 0, w, h);

  // pirate
  g.save();
  g.globalAlpha = p.a;
  g.translate(p.x, p.y);
  if (p.dead) g.rotate(p.dead * 0.6);
  const pw = 118;
  const ph = 70;
  if (pirateImg.complete && pirateImg.naturalWidth) {
    g.drawImage(pirateImg, -pw / 2, -ph / 2, pw, ph);
  } else {
    g.fillStyle = '#c45';
    g.beginPath();
    g.moveTo(40, 0);
    g.lineTo(-36, 18);
    g.lineTo(-36, -18);
    g.closePath();
    g.fill();
  }
  g.restore();

  // volleys
  if (b.t > 0.55 && b.t < 2.65 && b.t >= b.nextVolley) {
    b.nextVolley = b.t + 0.28;
    b.volley++;
    const ally = b.volley % 2 === 1;
    const jitter = () => (Math.random() - 0.5) * 18;
    if (ally) {
      spawnLaser(
        { x: b.nose.x + jitter() * 0.3, y: b.nose.y },
        { x: p.x + jitter(), y: p.y + jitter() },
        true
      );
      b.enemyHp = Math.max(0, b.enemyHp - (b.win ? 0.18 : 0.08));
      addTrauma(0.22);
      hitstop(0.03);
      sfx('pew');
      setTimeout(() => sfx('hit'), 40);
    } else {
      spawnLaser(
        { x: p.x, y: p.y },
        { x: b.nose.x + jitter(), y: b.nose.y + 30 + jitter() },
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
        x: p.x + (Math.random() - 0.5) * 40,
        y: p.y + (Math.random() - 0.5) * 24,
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
    g.save();
    g.strokeStyle = L.ally ? `rgba(92,225,255,${0.25 + a * 0.75})` : `rgba(255,90,90,${0.25 + a * 0.75})`;
    g.shadowColor = L.ally ? '#5ce1ff' : '#ff6b6b';
    g.shadowBlur = 12;
    g.lineWidth = 2 + a * 2;
    g.beginPath();
    g.moveTo(L.x0, L.y0);
    g.lineTo(L.x1, L.y1);
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
    if (impactImg.complete && impactImg.naturalWidth && a > 0.4) {
      const sz = 28 + (1 - a) * 36;
      g.globalAlpha = a * 0.8;
      g.drawImage(impactImg, s.x - sz / 2, s.y - sz / 2, sz, sz);
      g.globalAlpha = 1;
    }
    g.fillStyle = `rgba(255,220,140,${a})`;
    for (let k = 0; k < s.n; k++) {
      const ang = (k / s.n) * Math.PI * 2 + b.t * 6;
      const rad = (1 - a) * 22;
      g.fillRect(s.x + Math.cos(ang) * rad, s.y + Math.sin(ang) * rad, 2, 2);
    }
  }

  // HP bars
  drawBar(g, 16, 10, w * 0.4, 'SPARROW', b.playerHp, '#3ddc97');
  drawBar(g, w - 16 - w * 0.4, 10, w * 0.4, b.name.toUpperCase(), b.enemyHp, '#ff6b6b');

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
