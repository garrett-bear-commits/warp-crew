// @ts-nocheck
/** Compact 4-room tutorial Sparrow. Pixel layout matches sparrow-starter.png (320×448). */

export const HULL_PX = { w: 320, h: 448 };

export const ROOMS = [
  {
    id: 'bridge',
    name: 'Bridge',
    role: 'pilot',
    system: null,
    left: 27.5,
    top: 7.14,
    w: 45,
    h: 22.32,
    walkX: 50,
    walkY: 26.34,
  },
  {
    id: 'engineering',
    name: 'Engineering',
    role: 'engineer',
    system: 'shields',
    left: 11.25,
    top: 33.04,
    w: 38.75,
    h: 27.68,
    walkX: 30.63,
    walkY: 56.25,
  },
  {
    id: 'cargo',
    name: 'Cargo Hold',
    role: 'gunner',
    system: 'cargo',
    left: 50,
    top: 33.04,
    w: 38.75,
    h: 27.68,
    walkX: 69.38,
    walkY: 56.25,
  },
  {
    id: 'engines',
    name: 'Engines',
    role: null,
    system: 'engines',
    left: 18.75,
    top: 64.29,
    w: 62.5,
    h: 25,
    walkX: 50,
    walkY: 84.82,
  },
];

export const ROOM_GRAPH = {
  bridge: ['engineering', 'cargo'],
  engineering: ['bridge', 'engines', 'cargo'],
  cargo: ['bridge', 'engines', 'engineering'],
  engines: ['engineering', 'cargo'],
};

const DOOR_PTS = {
  'bridge|engineering': { x: 38.75, y: 31.25 },
  'bridge|cargo': { x: 61.25, y: 31.25 },
  'engineering|engines': { x: 33.75, y: 62.5 },
  'cargo|engines': { x: 66.25, y: 62.5 },
  'cargo|engineering': { x: 50, y: 46.43 },
};

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
