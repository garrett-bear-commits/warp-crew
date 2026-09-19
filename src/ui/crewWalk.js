// @ts-nocheck
import { ROOMS, roomById, homeRoomId, walkWaypoints, ROOM_GRAPH } from '../data/starterShip.js';
import { sheetFor } from './crewArt.js';

const agents = new Map();
let layer = null;
let raf = 0;
let lastT = 0;
let clock = 0;

const WALK_SPEED = 26; // % of hull per second
const ARRIVE = 1.4;
const SCALE = 1.62;

function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function pickTask(a) {
  const opts = (ROOM_GRAPH[a.room] || ROOMS.map((r) => r.id)).filter((id) => id !== a.room);
  if (!opts.length) return a.home;
  const i = Math.floor((hash01(a.id + String(clock | 0)) + a.jitter) * opts.length) % opts.length;
  return opts[i];
}

function spawn(crew) {
  const home = homeRoomId(crew.role);
  const room = roomById(home);
  const jitter = hash01(crew.instanceId);
  const a = {
    id: crew.instanceId,
    templateId: crew.templateId,
    role: crew.role,
    home,
    room: home,
    x: room.walkX + (jitter - 0.5) * 8,
    y: room.walkY,
    facing: jitter > 0.5 ? 1 : -1,
    state: 'idle',
    path: [],
    timer: 0.6 + jitter * 2.4,
    jitter,
    anim: 'idle',
    el: null,
  };
  agents.set(a.id, a);
  return a;
}

function ensureEl(a) {
  if (!layer) return;
  if (a.el && a.el.isConnected) return;
  const el = document.createElement('div');
  el.className = 'crew-sprite';
  el.dataset.id = a.id;
  el.dataset.anim = 'idle';
  layer.appendChild(el);
  a.el = el;
  a.anim = '';
}

function beginWalk(a, destId) {
  const pts = walkWaypoints(a.room, destId);
  if (!pts.length) {
    a.state = 'idle';
    a.timer = 1.2 + a.jitter;
    return;
  }
  a.path = pts;
  a.state = 'walk';
  a.timer = 0;
}

function stepAgent(a, dt) {
  if (a.state === 'idle') {
    a.timer -= dt;
    if (a.timer <= 0) beginWalk(a, pickTask(a));
    return;
  }

  if (a.state === 'doing') {
    a.timer -= dt;
    if (a.timer <= 0) {
      const goHome = a.room !== a.home && a.jitter + (clock % 3) * 0.1 > 0.55;
      beginWalk(a, goHome ? a.home : pickTask(a));
    }
    return;
  }

  const tgt = a.path[0];
  if (!tgt) {
    a.state = 'doing';
    a.timer = 2.2 + a.jitter * 2.4;
    return;
  }
  const d = dist(a, tgt);
  if (d <= ARRIVE) {
    a.x = tgt.x;
    a.y = tgt.y;
    if (tgt.room) a.room = tgt.room;
    a.path.shift();
    if (!a.path.length) {
      a.state = 'doing';
      a.timer = 2.2 + a.jitter * 2.4;
    }
    return;
  }
  const ux = (tgt.x - a.x) / d;
  const uy = (tgt.y - a.y) / d;
  const step = Math.min(d, WALK_SPEED * dt);
  a.x += ux * step;
  a.y += uy * step;
  if (Math.abs(ux) > 0.12) a.facing = ux < 0 ? -1 : 1;
}

function paint(a) {
  ensureEl(a);
  const el = a.el;
  if (!el) return;
  const sheet = sheetFor(a.templateId, a.role);
  const nextAnim = a.state === 'doing' ? 'doing' : a.state === 'walk' ? 'walk' : 'idle';
  if (sheet && a.anim !== nextAnim) {
    const url = nextAnim === 'doing' ? sheet.doing || sheet.idle : sheet.idle || sheet.url;
    if (url) el.style.backgroundImage = `url('${url}')`;
    el.dataset.anim = nextAnim;
    a.anim = nextAnim;
  }
  const bob = a.state === 'walk' ? Math.sin(clock * 14 + a.jitter * 8) * 2.4 : 0;
  const sx = a.facing < 0 ? -SCALE : SCALE;
  el.style.left = `${a.x}%`;
  el.style.top = `${a.y}%`;
  el.style.zIndex = String(20 + (a.y | 0));
  el.style.transform = `translate(-50%, -88%) scale(${sx}, ${SCALE}) translateY(${bob}px)`;
  el.classList.toggle('is-left', a.facing < 0);
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (!layer || document.hidden) {
    lastT = now;
    return;
  }
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (!dt) return;
  clock += dt;
  for (const a of agents.values()) stepAgent(a, dt);
  // simple separation in-room
  const list = [...agents.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.room !== b.room) continue;
      const d = dist(a, b);
      if (d < 6 && d > 0.01) {
        const push = ((6 - d) / 6) * 0.4;
        const sx = (a.x - b.x) / d;
        a.x += sx * push;
        b.x -= sx * push;
      }
    }
  }
  for (const a of agents.values()) paint(a);
}

function start() {
  if (raf) return;
  lastT = performance.now();
  raf = requestAnimationFrame(loop);
}

export function stopCrewSim() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  lastT = 0;
}

export function syncCrewLayer(el, player) {
  if (!el) return;
  layer = el;
  const live = new Set();
  for (const c of player.crew || []) {
    if (c.status === 'expedition') continue;
    live.add(c.instanceId);
    if (!agents.has(c.instanceId)) spawn(c);
    const a = agents.get(c.instanceId);
    a.templateId = c.templateId;
    a.role = c.role;
    a.home = homeRoomId(c.role);
    ensureEl(a);
  }
  for (const [id, a] of agents) {
    if (live.has(id)) continue;
    a.el?.remove();
    agents.delete(id);
  }
  start();
}
