// @ts-nocheck
/**
 * Sparrow cutaway geometry, driven by the measured Sparrow v4 layout
 * (src/data/art/sparrowV4Layout.json). Everything here is in percentages of
 * the hull image; HULL_PX is the one source for the world size in pixels.
 */
import LAYOUT from './art/sparrowV4Layout.json' with { type: 'json' };

export const HULL_IMAGE = LAYOUT.image;
export const HULL_PX = Object.freeze({ w: LAYOUT.sourceSize.width, h: LAYOUT.sourceSize.height });

/** Percent point on the hull image -> world pixels inside the ship layer. */
export function worldPoint(point) {
  return { x: (point.x / 100) * HULL_PX.w, y: (point.y / 100) * HULL_PX.h };
}

const SHIP_SYSTEMS = new Set(['engines', 'shields', 'cargo', 'weapons', 'quarters', 'sensors', 'medbay']);

// Game meaning of each cutaway room (geometry comes from the layout JSON).
const ROOM_META = {
  bridge: { role: 'pilot' },
  shields: { system: 'shields' },
  weapons: { system: 'weapons', role: 'gunner' },
  sensors: { system: 'sensors', role: 'scout' },
  medbay: { system: 'medbay', role: 'medic' },
  quarters: { system: 'quarters' },
  mess: {},
  cargo: { system: 'cargo', role: 'trader' },
  armory: { role: 'security' },
  engineering: { system: 'engines', role: 'engineer' },
};

/** Room ids from the v3 hull. Nothing persisted names a cutaway room, but stale UI input may. */
export const LEGACY_ROOM_IDS = Object.freeze({ operations: 'sensors', workshop: 'weapons', stores: 'armory' });

export function canonicalRoomId(id) {
  return typeof id === 'string' && Object.hasOwn(LEGACY_ROOM_IDS, id) ? LEGACY_ROOM_IDS[id] : id;
}

const rectPolygon = (left, top, width, height) => [
  { x: left, y: top },
  { x: left + width, y: top },
  { x: left + width, y: top + height },
  { x: left, y: top + height },
];

const room = ({ id, label, left, top, width, height, workAnchor }) => ({
  id,
  name: label,
  label,
  system: ROOM_META[id]?.system || null,
  role: ROOM_META[id]?.role || null,
  hitPolygon: rectPolygon(left, top, width, height),
  walkBounds: { left, top, width, height },
  workAnchor: { ...workAnchor },
  labelAnchor: { x: left + width / 2, y: top + height / 2 },
  doorId: `door_${id}`,
  left,
  top,
  w: width,
  h: height,
  walkX: workAnchor.x,
  walkY: workAnchor.y,
});

const rooms = LAYOUT.rooms.map(room);
const cargoRoom = rooms.find((candidate) => candidate.id === 'cargo');
const airlock = { x: LAYOUT.airlock.x, y: LAYOUT.airlock.y };
// The airlock hatch sits on the port hull beside Cargo: a short passage joins them.
const AIRLOCK_PASSAGE_HALF_H = 1.6;
const airlockPassage = {
  id: 'airlock',
  left: airlock.x - 1.5,
  top: airlock.y - AIRLOCK_PASSAGE_HALF_H,
  width: cargoRoom.left + 3 - (airlock.x - 1.5),
  height: AIRLOCK_PASSAGE_HALF_H * 2,
};

export const SPARROW_LAYOUT = {
  image: HULL_IMAGE,
  sourceSize: { width: HULL_PX.w, height: HULL_PX.h },
  rooms,
  doors: LAYOUT.rooms.map((source) => ({
    id: `door_${source.id}`,
    roomId: source.id,
    room: { ...source.door.room },
    spine: { ...source.door.spine },
  })),
  halls: [
    { id: 'spine', ...LAYOUT.spine },
    airlockPassage,
  ],
  // Furniture crew walk around, measured against the v4 art (docs/art/qa/sparrow-v4-blockers.png).
  blockers: (LAYOUT.blockers || []).map((blocker) => ({ ...blocker, shape: 'rect' })),
  effects: {
    thrusters: LAYOUT.thrusters.map((thruster) => ({ x: thruster.x, y: thruster.y, size: 1 })),
  },
  anchors: {
    // Crew leaving step to Cargo's port wall, then out through the airlock.
    cargoDeparture: { x: cargoRoom.left + 2, y: airlock.y },
    airlock,
    // Where the auto-battle (v1/v2) guns fire from: the bow, ahead of the Bridge.
    nose: { x: 50, y: 5 },
  },
};

export const ROOMS = SPARROW_LAYOUT.rooms;
export const HALLWAYS = SPARROW_LAYOUT.halls.map((hall) => ({ ...hall, w: hall.width, h: hall.height }));
export const THRUSTERS = SPARROW_LAYOUT.effects.thrusters;

// Compatibility projections retained until pathing consumes the manifest directly.
export const FURNITURE = SPARROW_LAYOUT.blockers.map((blocker) => {
  if (blocker.shape === 'ellipse') return blocker;
  return {
    ...blocker,
    x: blocker.left + blocker.width / 2,
    y: blocker.top + blocker.height / 2,
    rx: blocker.width / 2,
    ry: blocker.height / 2,
  };
});

export const DOOR_PTS = Object.fromEntries(
  SPARROW_LAYOUT.doors.map((door) => [door.id, door.spine])
);

export const ROOM_GRAPH = Object.fromEntries(
  ROOMS.map((source) => [source.id, ROOMS.filter((target) => target.id !== source.id).map((target) => target.id)])
);

// Physical circulation graph: rooms connect only through their authored spine doors.
export const DOOR_ROUTE_GRAPH = {
  spine: SPARROW_LAYOUT.doors.map((door) => door.roomId),
  ...Object.fromEntries(ROOMS.map((room) => [
    room.id,
    SPARROW_LAYOUT.doors.some((door) => door.roomId === room.id) ? ['spine'] : [],
  ])),
};

const HOME_BY_ROLE = {
  pilot: 'bridge',
  engineer: 'engineering',
  gunner: 'weapons',
  medic: 'medbay',
  trader: 'cargo',
  scout: 'sensors',
  security: 'armory',
};

export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const crosses = (a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function roomAtExact(x, y) {
  return ROOMS.find((candidate) => pointInPolygon(x, y, candidate.hitPolygon)) || null;
}

export function roomById(id) {
  const key = canonicalRoomId(id);
  return ROOMS.find((candidate) => candidate.id === key) || ROOMS[0];
}

/** Room label point in world pixels (markers, camera focus, shot targets). */
export function roomWorldPoint(roomOrId) {
  const target = typeof roomOrId === 'string' ? roomById(roomOrId) : roomOrId;
  return worldPoint(target.labelAnchor);
}

export function homeRoomId(role) {
  return HOME_BY_ROLE[role] || 'mess';
}

function doorForRoom(roomId) {
  return SPARROW_LAYOUT.doors.find((door) => door.roomId === roomId) || null;
}

export function doorPoint(a, b) {
  if (!b) return doorForRoom(a)?.spine || null;
  const fromDoor = doorForRoom(a);
  const toDoor = doorForRoom(b);
  if (!fromDoor || !toDoor) return null;
  return fromDoor.spine;
}

export function pathRooms(from, to) {
  if (from === to) return [];
  const fromDoor = doorForRoom(from);
  const toDoor = doorForRoom(to);
  if (!fromDoor || !toDoor) return [];
  return [
    { ...fromDoor.room, room: from, via: 'door-exit' },
    { ...fromDoor.spine, room: null, via: 'spine' },
    { ...toDoor.spine, room: null, via: 'spine' },
    { ...toDoor.room, room: to, via: 'door-enter' },
  ];
}

export function walkWaypoints(fromId, toId) {
  if (fromId === toId) return [];
  const fromDoor = doorForRoom(fromId);
  const toDoor = doorForRoom(toId);
  const target = roomById(toId);
  if (!fromDoor || !toDoor || !target) return [];
  return [
    { ...fromDoor.room, room: fromId, via: 'door-exit' },
    { ...fromDoor.spine, room: fromId, via: 'spine' },
    { ...toDoor.spine, room: fromId, via: 'spine' },
    { ...toDoor.room, room: toId, via: 'door-enter' },
    { x: target.walkX, y: target.walkY, room: toId },
  ];
}

/** Exact room when possible; nearest-room fallback remains for legacy movement only. */
export function roomAt(x, y) {
  const exact = roomAtExact(x, y);
  if (exact) return exact.id;
  let best = null;
  let bestD = Infinity;
  for (const candidate of ROOMS) {
    const dx = x - candidate.labelAnchor.x;
    const dy = y - candidate.labelAnchor.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestD) {
      best = candidate.id;
      bestD = distance;
    }
  }
  return best;
}

const inPct = (point) => point && point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
const inRect = (point, rect, slack = 0) => point.x >= rect.left - slack && point.x <= rect.left + rect.width + slack
  && point.y >= rect.top - slack && point.y <= rect.top + rect.height + slack;

export function validateSparrowLayout() {
  const errors = [];
  const roomIds = new Set();
  const doorIds = new Set();

  if (!(HULL_PX.w > 0 && HULL_PX.h > 0)) errors.push('layout sourceSize missing');

  for (const current of ROOMS) {
    if (roomIds.has(current.id)) errors.push(`duplicate room ${current.id}`);
    roomIds.add(current.id);
    if (!Object.hasOwn(ROOM_META, current.id)) errors.push(`${current.id} has no game meaning`);
    if (!Array.isArray(current.hitPolygon) || current.hitPolygon.length < 3) {
      errors.push(`${current.id} polygon needs at least three points`);
    }
    for (const point of current.hitPolygon || []) {
      if (!inPct(point)) errors.push(`${current.id} polygon point outside hull`);
    }
    if (current.system && !SHIP_SYSTEMS.has(current.system)) {
      errors.push(`${current.id} unknown system ${current.system}`);
    }
    if (!pointInPolygon(current.workAnchor.x, current.workAnchor.y, current.hitPolygon)) {
      errors.push(`${current.id} work anchor outside room`);
    }
    const door = SPARROW_LAYOUT.doors.find((candidate) => candidate.id === current.doorId);
    if (!door || door.roomId !== current.id) errors.push(`${current.id} unresolved door ${current.doorId}`);
  }

  for (const id of Object.keys(ROOM_META)) {
    if (!roomIds.has(id)) errors.push(`layout is missing room ${id}`);
  }

  const spine = SPARROW_LAYOUT.halls.find((hall) => hall.id === 'spine');
  for (const door of SPARROW_LAYOUT.doors) {
    if (doorIds.has(door.id)) errors.push(`duplicate door ${door.id}`);
    doorIds.add(door.id);
    if (!roomIds.has(door.roomId)) errors.push(`${door.id} unknown room ${door.roomId}`);
    for (const point of [door.room, door.spine]) {
      if (!inPct(point)) errors.push(`${door.id} coordinate outside hull`);
    }
    if (spine && !inRect(door.spine, spine)) errors.push(`${door.id} spine point off the spine`);
    const owner = ROOMS.find((candidate) => candidate.id === door.roomId);
    if (owner && !inRect(door.room, owner.walkBounds, 0.01)) errors.push(`${door.id} room point outside ${door.roomId}`);
  }

  for (const [id, anchor] of Object.entries(SPARROW_LAYOUT.anchors || {})) {
    if (!inPct(anchor)) errors.push(`${id} anchor outside hull`);
  }
  for (const [index, thruster] of SPARROW_LAYOUT.effects.thrusters.entries()) {
    if (!inPct(thruster)) errors.push(`thruster ${index} outside hull`);
  }

  for (let i = 0; i < ROOMS.length; i++) {
    const center = ROOMS[i].labelAnchor;
    for (let j = i + 1; j < ROOMS.length; j++) {
      if (pointInPolygon(center.x, center.y, ROOMS[j].hitPolygon)) {
        errors.push(`${ROOMS[i].id} center overlaps ${ROOMS[j].id}`);
      }
      const otherCenter = ROOMS[j].labelAnchor;
      if (pointInPolygon(otherCenter.x, otherCenter.y, ROOMS[i].hitPolygon)) {
        errors.push(`${ROOMS[j].id} center overlaps ${ROOMS[i].id}`);
      }
    }
  }

  return errors;
}
