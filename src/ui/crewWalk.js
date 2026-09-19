// @ts-nocheck
import { ROOMS, roomById, homeRoomId, ROOM_GRAPH, THRUSTERS, roomAt } from '../data/starterShip.js';
import { findPath, clampWalkable, nearestWalkableInRoom } from '../data/navGrid.js';
import { sheetFor, walkSheetFor, WALK_CELL, WALK_FRAMES } from './crewArt.js';
import { onTick } from './stageLoop.js';

const agents = new Map();
let canvas = null;
let ctx = null;
let w = 0;
let h = 0;
let dpr = 1;
let clock = 0;
let started = false;
let battle = false;
const particles = [];

const WALK_SPEED = 18;
const ARRIVE = 1.6;
const SPRITE = 52;
const DIR_ROW = { down: 0, left: 1, right: 2, up: 3 };

function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pickTask(a) {
  if (battle) return a.home;
  const opts = (ROOM_GRAPH[a.room] || ROOMS.map((r) => r.id)).filter((id) => id !== a.room);
  if (!opts.length) return a.home;
  const i = Math.floor((hash01(a.id + String(clock | 0)) + a.jitter) * opts.length) % opts.length;
  return opts[i];
}

function spawn(crew) {
  const home = homeRoomId(crew.role);
  const pos = nearestWalkableInRoom(home, hash01(crew.instanceId));
  const jitter = hash01(crew.instanceId);
  const a = {
    id: crew.instanceId,
    templateId: crew.templateId,
    role: crew.role,
    home,
    room: home,
    x: pos.x,
    y: pos.y,
    dir: jitter > 0.5 ? 'right' : 'left',
    state: 'idle',
    path: [],
    timer: 0.5 + jitter * 2.2,
    jitter,
    frame: 0,
    fps: 8,
  };
  agents.set(a.id, a);
  return a;
}

function beginWalk(a, destId) {
  const dest = nearestWalkableInRoom(destId, a.jitter);
  const pts = findPath(a.x, a.y, dest.x, dest.y);
  if (!pts.length) {
    a.state = 'idle';
    a.timer = 1.1 + a.jitter;
    return;
  }
  a.path = pts;
  a.state = 'walk';
  a.timer = 0;
}

function faceFrom(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  if (Math.abs(dy) < 0.05) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

function stepAgent(a, dt) {
  if (a.state === 'idle') {
    a.timer -= dt;
    if (a.timer <= 0) beginWalk(a, pickTask(a));
    return;
  }
  if (a.state === 'doing') {
    a.timer -= dt;
    a.frame = (a.frame + dt * 3) % WALK_FRAMES;
    if (a.timer <= 0) {
      const goHome = a.room !== a.home && a.jitter + (clock % 3) * 0.1 > 0.55;
      beginWalk(a, goHome || battle ? a.home : pickTask(a));
    }
    return;
  }

  const tgt = a.path[0];
  if (!tgt) {
    a.state = 'doing';
    a.timer = battle ? 3.2 : 2.1 + a.jitter * 2.2;
    return;
  }
  const d = dist(a, tgt);
  if (d <= ARRIVE) {
    a.x = tgt.x;
    a.y = tgt.y;
    if (tgt.room) a.room = tgt.room;
    else a.room = roomAt(a.x, a.y) || a.room;
    a.path.shift();
    if (!a.path.length) {
      a.state = 'doing';
      a.timer = battle ? 3.2 : 2.1 + a.jitter * 2.2;
    }
    return;
  }
  const ux = (tgt.x - a.x) / d;
  const uy = (tgt.y - a.y) / d;
  const step = Math.min(d, WALK_SPEED * dt);
  const nx = a.x + ux * step;
  const ny = a.y + uy * step;
  const clamped = clampWalkable(nx, ny);
  a.x = clamped.x;
  a.y = clamped.y;
  a.dir = faceFrom(ux, uy);
  a.frame = (a.frame + dt * a.fps) % WALK_FRAMES;
  a.room = roomAt(a.x, a.y) || a.room;
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
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
}

function spawnThrust(dt) {
  const rate = battle ? 70 : 38;
  for (const t of THRUSTERS) {
    const n = rate * dt;
    const extra = n - (n | 0) > Math.random() ? 1 : 0;
    const count = (n | 0) + extra;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: t.x + (Math.random() - 0.5) * 3.2,
        y: t.y + Math.random() * 1.2,
        vx: (Math.random() - 0.5) * 6,
        vy: 18 + Math.random() * 28,
        life: 0.28 + Math.random() * 0.35,
        max: 0.5,
        hue: Math.random() < 0.35 ? 190 : 28,
      });
    }
  }
}

function drawThrusters(g, dt) {
  spawnThrust(dt);
  const pulse = 0.55 + Math.sin(clock * 14) * 0.25;
  for (const t of THRUSTERS) {
    const px = (t.x / 100) * w;
    const py = (t.y / 100) * h;
    const rad = g.createRadialGradient(px, py, 1, px, py + 10, 28);
    rad.addColorStop(0, `rgba(180,240,255,${0.55 * pulse})`);
    rad.addColorStop(0.35, `rgba(80,200,255,${0.28 * pulse})`);
    rad.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = rad;
    g.beginPath();
    g.ellipse(px, py + 8, 11, 22, 0, 0, Math.PI * 2);
    g.fill();
    const flame = g.createLinearGradient(px, py, px, py + 26);
    flame.addColorStop(0, `rgba(255,255,220,${0.7 * pulse})`);
    flame.addColorStop(0.4, `rgba(80,220,255,${0.45 * pulse})`);
    flame.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = flame;
    g.beginPath();
    g.moveTo(px - 4, py);
    g.lineTo(px + 4, py);
    g.lineTo(px + 1.5, py + 18 + pulse * 8);
    g.lineTo(px - 1.5, py + 18 + pulse * 8);
    g.closePath();
    g.fill();
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    const a = p.life / p.max;
    const px = (p.x / 100) * w;
    const py = (p.y / 100) * h;
    g.fillStyle =
      p.hue > 100
        ? `rgba(120,230,255,${a * 0.7})`
        : `rgba(255,${160 + ((1 - a) * 60) | 0},60,${a})`;
    const sz = 1.2 + a * 2.2;
    g.fillRect(px, py, sz, sz);
  }
}

function drawAgent(g, a) {
  const img = walkSheetFor(a.templateId, a.role);
  const x = (a.x / 100) * w;
  const y = (a.y / 100) * h;
  const bob = a.state === 'walk' ? Math.sin(clock * 16 + a.jitter * 8) * 1.1 : a.state === 'doing' ? Math.sin(clock * 8 + a.jitter) * 1.4 : 0;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(x, y + 1, 9, 3.2, 0, 0, Math.PI * 2);
  g.fill();

  const row = DIR_ROW[a.dir] || 0;
  const col = a.state === 'walk' ? a.frame | 0 : a.state === 'doing' ? (a.frame | 0) % 2 : 0;
  if (img && img.complete && img.naturalWidth) {
    g.imageSmoothingEnabled = false;
    g.drawImage(
      img,
      col * WALK_CELL,
      row * WALK_CELL,
      WALK_CELL,
      WALK_CELL,
      x - SPRITE / 2,
      y - SPRITE + 4 + bob,
      SPRITE,
      SPRITE
    );
  } else {
    const sheet = sheetFor(a.templateId, a.role);
    g.fillStyle = '#5ce1ff';
    g.fillRect(x - 6, y - 18 + bob, 12, 18);
    if (sheet) {
      /* fallback blob already drawn */
    }
  }
  g.restore();
}

function tick(sim, dt) {
  if (!canvas || !ctx || !w) return;
  if (!canvas.isConnected) return;
  clock += sim;
  for (const a of agents.values()) stepAgent(a, sim);
  const list = [...agents.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const d = dist(a, b);
      if (d < 5 && d > 0.01) {
        const push = ((5 - d) / 5) * 0.35;
        const sx = (a.x - b.x) / d;
        const ax = a.x + sx * push;
        const bx = b.x - sx * push;
        const ac = clampWalkable(ax, a.y);
        const bc = clampWalkable(bx, b.y);
        a.x = ac.x;
        b.x = bc.x;
      }
    }
  }
  const g = ctx;
  g.clearRect(0, 0, w, h);
  list.sort((p, q) => p.y - q.y);
  for (const a of list) drawAgent(g, a);
  drawThrusters(g, dt);
}

export function setBattleStations(on) {
  battle = Boolean(on);
  if (!battle) return;
  for (const a of agents.values()) beginWalk(a, a.home);
}

export function stopCrewSim() {
  canvas = null;
  ctx = null;
}

export function syncCrewLayer(el, player) {
  if (!el) return;
  if (el.tagName === 'CANVAS') {
    canvas = el;
    resize();
    if (!el._wcRo) {
      el._wcRo = new ResizeObserver(() => resize());
      el._wcRo.observe(el);
    }
  }
  const live = new Set();
  for (const c of player.crew || []) {
    if (c.status === 'expedition') continue;
    live.add(c.instanceId);
    if (!agents.has(c.instanceId)) spawn(c);
    const a = agents.get(c.instanceId);
    a.templateId = c.templateId;
    a.role = c.role;
    a.home = homeRoomId(c.role);
  }
  for (const [id] of agents) {
    if (live.has(id)) continue;
    agents.delete(id);
  }
  if (!started) {
    started = true;
    onTick(tick);
    window.addEventListener('resize', resize);
  }
}
