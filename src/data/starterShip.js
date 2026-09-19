// @ts-nocheck
/** Compact 4-room tutorial Sparrow. Percents match sparrow-hull-v2.png (1008×1792). */

export const HULL_PX = { w: 1152, h: 1728 };

export const ROOMS = [
  {
    id: 'bridge',
    name: 'Bridge',
    role: 'pilot',
    system: null,
    left: 30,
    top: 6.5,
    w: 40,
    h: 17,
    walkX: 50,
    walkY: 19.5,
  },
  {
    id: 'engineering',
    name: 'Engineering',
    role: 'engineer',
    system: 'shields',
    left: 16,
    top: 25.5,
    w: 32,
    h: 25,
    walkX: 32,
    walkY: 44.5,
  },
  {
    id: 'cargo',
    name: 'Cargo Hold',
    role: 'gunner',
    system: 'cargo',
    left: 52,
    top: 25.5,
    w: 32,
    h: 25,
    walkX: 68,
    walkY: 44.5,
  },
  {
    id: 'engines',
    name: 'Engines',
    role: null,
    system: 'engines',
    left: 18,
    top: 53.5,
    w: 64,
    h: 33,
    walkX: 50,
    walkY: 76,
  },
];

export const ROOM_GRAPH = {
  bridge: ['engineering', 'cargo'],
  engineering: ['bridge', 'engines', 'cargo'],
  cargo: ['bridge', 'engines', 'engineering'],
  engines: ['engineering', 'cargo'],
};

export const DOOR_PTS = {
  'bridge|engineering': { x: 36, y: 23.8 },
  'bridge|cargo': { x: 64, y: 23.8 },
  'engineering|engines': { x: 32, y: 51 },
  'cargo|engines': { x: 68, y: 51 },
  'cargo|engineering': { x: 50, y: 38.5 },
};

/** Elliptical blockers inside rooms (percent of hull). */
export const FURNITURE = [
  { x: 50, y: 12.4, rx: 12, ry: 4.4 },
  { x: 31.5, y: 37.6, rx: 6.5, ry: 4.4 },
  { x: 68.5, y: 36.2, rx: 7.2, ry: 4.6 },
  { x: 50, y: 68.4, rx: 10.5, ry: 7.6 },
];

export const THRUSTERS = [
  { x: 31.8, y: 91.4 },
  { x: 68.2, y: 91.4 },
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
    if (door) pts.push({ x: door.x, y: door.y, room: cur });
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
