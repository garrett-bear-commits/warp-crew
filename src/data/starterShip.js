// @ts-nocheck
/** 4-room Sparrow cutaway. Percents match sparrow-hull-v3.png (1152×1728). */

export const HULL_PX = { w: 1152, h: 1728 };

export const ROOMS = [
  {
    id: 'bridge',
    name: 'Bridge',
    role: 'pilot',
    system: null,
    left: 34,
    top: 5,
    w: 32,
    h: 14,
    walkX: 50,
    walkY: 16.5,
  },
  {
    id: 'engineering',
    name: 'Engineering',
    role: 'engineer',
    system: 'shields',
    left: 16,
    top: 24,
    w: 32,
    h: 28,
    walkX: 30,
    walkY: 40,
  },
  {
    id: 'cargo',
    name: 'Cargo Hold',
    role: 'gunner',
    system: 'cargo',
    left: 52,
    top: 24,
    w: 32,
    h: 28,
    walkX: 70,
    walkY: 40,
  },
  {
    id: 'engines',
    name: 'Engines',
    role: null,
    system: 'engines',
    left: 22,
    top: 58,
    w: 56,
    h: 28,
    walkX: 38,
    walkY: 68,
  },
];

/** Central spine + necks — the hallways crew actually walk. */
export const HALLWAYS = [
  { left: 45, top: 16, w: 10, h: 46 }, // main spine bridge → engines
  { left: 42, top: 16, w: 16, h: 6 }, // bridge neck
  { left: 46, top: 52, w: 8, h: 12 }, // engine neck
  { left: 44, top: 34, w: 12, h: 10 }, // mid crossing
];

export const ROOM_GRAPH = {
  bridge: ['engineering', 'cargo'],
  engineering: ['bridge', 'engines', 'cargo'],
  cargo: ['bridge', 'engines', 'engineering'],
  engines: ['engineering', 'cargo'],
};

export const DOOR_PTS = {
  'bridge|engineering': { x: 47, y: 19 },
  'bridge|cargo': { x: 53, y: 19 },
  'engineering|engines': { x: 48, y: 55 },
  'cargo|engines': { x: 51, y: 55 },
  'cargo|engineering': { x: 50, y: 38 },
};

/** Keep furniture off the spine so doors stay clear. */
export const FURNITURE = [
  { x: 50, y: 9.5, rx: 7, ry: 3.2 },
  { x: 27, y: 35, rx: 5, ry: 4 },
  { x: 73, y: 35, rx: 5, ry: 4 },
  { x: 50, y: 74, rx: 6, ry: 4.5 },
];

export const THRUSTERS = [
  { x: 32.5, y: 91.2 },
  { x: 67.5, y: 91.2 },
];

const HOME_BY_ROLE = {
  pilot: 'bridge',
  engineer: 'engineering',
  gunner: 'cargo',
  medic: 'engines',
  trader: 'cargo',
  scout: 'bridge',
  security: 'engines',
};

export function roomById(id) {
  return ROOMS.find((r) => r.id === id) || ROOMS[0];
}

export function homeRoomId(role) {
  return HOME_BY_ROLE[role] || 'engineering';
}

export function doorPoint(a, b) {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  return DOOR_PTS[key] || null;
}

export function pathRooms(from, to) {
  if (from === to) return [];
  const q = [[from]];
  const seen = new Set([from]);
  while (q.length) {
    const p = q.shift();
    const last = p[p.length - 1];
    for (const n of ROOM_GRAPH[last] || []) {
      if (seen.has(n)) continue;
      if (n === to) return p.slice(1).concat(to);
      seen.add(n);
      q.push(p.concat(n));
    }
  }
  return [to];
}

export function walkWaypoints(fromId, toId) {
  const hops = pathRooms(fromId, toId);
  const pts = [];
  let cur = fromId;
  for (const next of hops) {
    const door = doorPoint(cur, next);
    if (door) pts.push({ x: door.x, y: door.y, room: cur, via: 'door' });
    const r = roomById(next);
    pts.push({ x: r.walkX, y: r.walkY, room: next });
    cur = next;
  }
  return pts;
}

export function roomAt(x, y) {
  let best = null;
  let bestD = Infinity;
  for (const r of ROOMS) {
    if (x >= r.left && x <= r.left + r.w && y >= r.top && y <= r.top + r.h) return r.id;
    const cx = r.left + r.w * 0.5;
    const cy = r.top + r.h * 0.5;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = r.id;
    }
  }
  return best;
}
