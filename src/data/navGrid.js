// @ts-nocheck
/** Collision grid + A* for the Sparrow cutaway. 4-connected, no corner cut. */

import { SPARROW_LAYOUT, roomAtExact } from './starterShip.js';

export const COLS = 72;
export const ROWS = 128;
const INSET = 1.0;
const DOOR_R = 4.8;

const walk = new Uint8Array(COLS * ROWS);
const baked = { ready: false };

function idx(x, y) {
  return y * COLS + x;
}

function inRect(x, y, r, inset) {
  const width = r.width ?? r.w;
  const height = r.height ?? r.h;
  return (
    x >= r.left + inset &&
    x <= r.left + width - inset &&
    y >= r.top + inset &&
    y <= r.top + height - inset
  );
}

function inEllipse(x, y, e) {
  const dx = (x - e.x) / e.rx;
  const dy = (y - e.y) / e.ry;
  return dx * dx + dy * dy <= 1;
}

function distSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy || 1;
  let t = ((px - ax) * vx + (py - ay) * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function inHall(x, y) {
  for (const h of SPARROW_LAYOUT.halls) {
    if (inRect(x, y, h, 0.2)) return true;
  }
  return false;
}

function inDoor(x, y) {
  for (const door of SPARROW_LAYOUT.doors) {
    if (distSeg(x, y, door.room.x, door.room.y, door.spine.x, door.spine.y) < DOOR_R) return true;
  }
  return false;
}

function inBlocker(x, y, blocker) {
  if (blocker.shape === 'rect') return inRect(x, y, blocker, 0);
  return inEllipse(x, y, blocker);
}

function cellWalkable(xPct, yPct) {
  if (SPARROW_LAYOUT.blockers.some((blocker) => inBlocker(xPct, yPct, blocker))) return false;
  if (inHall(xPct, yPct)) return true;
  for (const room of SPARROW_LAYOUT.rooms) {
    if (inRect(xPct, yPct, room.walkBounds, INSET)) return true;
  }
  return inDoor(xPct, yPct);
}

function bake() {
  if (baked.ready) return;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = ((x + 0.5) / COLS) * 100;
      const py = ((y + 0.5) / ROWS) * 100;
      walk[idx(x, y)] = cellWalkable(px, py) ? 1 : 0;
    }
  }
  baked.ready = true;
}

export function isWalkablePct(x, y) {
  bake();
  const gx = Math.max(0, Math.min(COLS - 1, (x / 100) * COLS));
  const gy = Math.max(0, Math.min(ROWS - 1, (y / 100) * ROWS));
  return walk[idx(gx | 0, gy | 0)] === 1;
}

export function clampWalkable(x, y) {
  bake();
  if (isWalkablePct(x, y)) return { x, y };
  let best = { x, y };
  let bestD = Infinity;
  for (let r = 1; r <= 12; r++) {
    for (let a = 0; a < 14; a++) {
      const ang = (a / 14) * Math.PI * 2;
      const nx = x + Math.cos(ang) * r * 0.65;
      const ny = y + Math.sin(ang) * r * 0.65;
      if (!isWalkablePct(nx, ny)) continue;
      const d = Math.hypot(nx - x, ny - y);
      if (d < bestD) {
        bestD = d;
        best = { x: nx, y: ny };
      }
    }
    if (bestD < Infinity) return best;
  }
  return best;
}

function los(ax, ay, bx, by) {
  const steps = Math.max(2, Math.hypot(bx - ax, by - ay) * 1.6);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkablePct(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

function stringPull(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !los(pts[i].x, pts[i].y, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

class Heap {
  constructor() {
    this.a = [];
  }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        let s = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function findPath(x0, y0, x1, y1, { strict = false } = {}) {
  bake();
  if (strict && (!isWalkablePct(x0, y0) || !isWalkablePct(x1, y1))) return null;
  const a = strict ? { x: x0, y: y0 } : clampWalkable(x0, y0);
  const b = strict ? { x: x1, y: y1 } : clampWalkable(x1, y1);
  const sx = Math.max(0, Math.min(COLS - 1, ((a.x / 100) * COLS) | 0));
  const sy = Math.max(0, Math.min(ROWS - 1, ((a.y / 100) * ROWS) | 0));
  const gx = Math.max(0, Math.min(COLS - 1, ((b.x / 100) * COLS) | 0));
  const gy = Math.max(0, Math.min(ROWS - 1, ((b.y / 100) * ROWS) | 0));
  if (sx === gx && sy === gy) return [{ x: b.x, y: b.y, room: roomAtExact(b.x, b.y)?.id || null }];

  const open = new Heap();
  const gScore = new Float32Array(COLS * ROWS);
  gScore.fill(1e9);
  const came = new Int32Array(COLS * ROWS);
  came.fill(-1);
  const startI = idx(sx, sy);
  gScore[startI] = 0;
  open.push({ i: startI, f: Math.abs(gx - sx) + Math.abs(gy - sy) });
  const closed = new Uint8Array(COLS * ROWS);
  let found = false;

  while (open.a.length) {
    const cur = open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    const cx = cur.i % COLS;
    const cy = (cur.i / COLS) | 0;
    if (cx === gx && cy === gy) {
      found = true;
      break;
    }
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const ni = idx(nx, ny);
      if (!walk[ni] || closed[ni]) continue;
      const ng = gScore[cur.i] + 1;
      if (ng >= gScore[ni]) continue;
      gScore[ni] = ng;
      came[ni] = cur.i;
      open.push({ i: ni, f: ng + Math.abs(gx - nx) + Math.abs(gy - ny) });
    }
  }

  if (!found) return strict ? null : [{ x: b.x, y: b.y, room: roomAtExact(b.x, b.y)?.id || null }];

  const cells = [];
  let i = idx(gx, gy);
  while (i >= 0) {
    cells.push(i);
    i = came[i];
  }
  cells.reverse();
  const pts = cells.map((ci) => {
    const x = ((ci % COLS) + 0.5) / COLS * 100;
    const y = (((ci / COLS) | 0) + 0.5) / ROWS * 100;
    return { x, y, room: roomAtExact(x, y)?.id || null };
  });
  pts[pts.length - 1] = { x: b.x, y: b.y, room: roomAtExact(b.x, b.y)?.id || null };
  return stringPull(pts);
}

export function nearestWalkableInRoom(roomId, jitter = 0) {
  const r = SPARROW_LAYOUT.rooms.find((room) => room.id === roomId) || SPARROW_LAYOUT.rooms[0];
  const x = r.workAnchor.x + (jitter - 0.5) * 3;
  const y = r.workAnchor.y + (jitter - 0.35) * 1.6;
  const c = clampWalkable(x, y);
  return { ...c, room: roomId };
}
