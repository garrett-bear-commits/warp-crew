// @ts-nocheck
/** Sparrow cutaway geometry in percentages of sparrow-hull-v3.png. */

export const HULL_PX = { w: 1152, h: 1728 };

const SHIP_SYSTEMS = new Set(['engines', 'shields', 'cargo', 'weapons', 'quarters', 'sensors', 'medbay']);

const rectPolygon = (left, top, width, height) => [
  { x: left, y: top },
  { x: left + width, y: top },
  { x: left + width, y: top + height },
  { x: left, y: top + height },
];

const room = ({
  id,
  label,
  system = null,
  role = null,
  left,
  top,
  width,
  height,
  workAnchor,
  doorId,
}) => ({
  id,
  name: label,
  label,
  system,
  role,
  hitPolygon: rectPolygon(left, top, width, height),
  walkBounds: { left, top, width, height },
  workAnchor,
  labelAnchor: { x: left + width / 2, y: top + height / 2 },
  doorId,
  left,
  top,
  w: width,
  h: height,
  walkX: workAnchor.x,
  walkY: workAnchor.y,
});

export const SPARROW_LAYOUT = {
  sourceSize: { width: HULL_PX.w, height: HULL_PX.h },
  rooms: [
    room({ id: 'bridge', label: 'Bridge', role: 'pilot', left: 38, top: 10, width: 24, height: 13, workAnchor: { x: 56, y: 20 }, doorId: 'door_bridge' }),
    room({ id: 'operations', label: 'Operations', system: 'sensors', role: 'scout', left: 28, top: 25, width: 19, height: 14, workAnchor: { x: 43, y: 35 }, doorId: 'door_operations' }),
    room({ id: 'medbay', label: 'Medbay', system: 'medbay', role: 'medic', left: 54, top: 25, width: 19, height: 14, workAnchor: { x: 58, y: 35 }, doorId: 'door_medbay' }),
    room({ id: 'quarters', label: 'Quarters', system: 'quarters', left: 27, top: 40, width: 20, height: 14, workAnchor: { x: 45, y: 52 }, doorId: 'door_quarters' }),
    room({ id: 'workshop', label: 'Workshop', system: 'weapons', role: 'gunner', left: 54, top: 40, width: 20, height: 14, workAnchor: { x: 64, y: 51 }, doorId: 'door_workshop' }),
    room({ id: 'cargo', label: 'Cargo Hold', system: 'cargo', role: 'trader', left: 25, top: 56, width: 22, height: 16, workAnchor: { x: 45, y: 69 }, doorId: 'door_cargo' }),
    room({ id: 'mess', label: 'Mess', left: 54, top: 56, width: 21, height: 16, workAnchor: { x: 56, y: 69 }, doorId: 'door_mess' }),
    room({ id: 'stores', label: 'Stores', system: 'cargo', role: 'security', left: 24, top: 73, width: 23, height: 13, workAnchor: { x: 45, y: 84 }, doorId: 'door_stores' }),
    room({ id: 'engineering', label: 'Engineering', system: 'engines', role: 'engineer', left: 54, top: 73, width: 22, height: 13, workAnchor: { x: 56, y: 84 }, doorId: 'door_engineering' }),
  ],
  doors: [
    { id: 'door_bridge', roomId: 'bridge', room: { x: 50, y: 22 }, spine: { x: 50, y: 24 } },
    { id: 'door_operations', roomId: 'operations', room: { x: 47, y: 32 }, spine: { x: 48, y: 32 } },
    { id: 'door_medbay', roomId: 'medbay', room: { x: 54, y: 32 }, spine: { x: 52, y: 32 } },
    { id: 'door_quarters', roomId: 'quarters', room: { x: 47, y: 47 }, spine: { x: 48, y: 47 } },
    { id: 'door_workshop', roomId: 'workshop', room: { x: 54, y: 47 }, spine: { x: 52, y: 47 } },
    { id: 'door_cargo', roomId: 'cargo', room: { x: 47, y: 64 }, spine: { x: 48, y: 64 } },
    { id: 'door_mess', roomId: 'mess', room: { x: 54, y: 64 }, spine: { x: 52, y: 64 } },
    { id: 'door_stores', roomId: 'stores', room: { x: 47, y: 79.5 }, spine: { x: 48, y: 79.5 } },
    { id: 'door_engineering', roomId: 'engineering', room: { x: 54, y: 79.5 }, spine: { x: 52, y: 79.5 } },
  ],
  halls: [
    { id: 'spine', left: 47.5, top: 22, width: 5, height: 67 },
  ],
  blockers: [
    { id: 'bridge_chair', shape: 'ellipse', x: 50, y: 17.5, rx: 2.5, ry: 4 },
    { id: 'operations_console', shape: 'rect', left: 28.5, top: 26, width: 12, height: 5 },
    { id: 'medbay_bed', shape: 'rect', left: 63.2, top: 26.5, width: 6.5, height: 10.5 },
    { id: 'quarters_bunks', shape: 'rect', left: 28, top: 41, width: 15, height: 10 },
    { id: 'workshop_counter', shape: 'rect', left: 57, top: 41, width: 15, height: 4 },
    { id: 'cargo_crates', shape: 'rect', left: 26, top: 57, width: 15, height: 12 },
    { id: 'mess_table', shape: 'rect', left: 58, top: 58, width: 13, height: 8 },
    { id: 'stores_crates', shape: 'rect', left: 25, top: 74, width: 14, height: 9 },
    { id: 'engineering_machine', shape: 'rect', left: 59, top: 74, width: 13, height: 8 },
  ],
  effects: {
    thrusters: [
      { x: 32.5, y: 91.2 },
      { x: 67.5, y: 91.2 },
    ],
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

const HOME_BY_ROLE = {
  pilot: 'bridge',
  engineer: 'engineering',
  gunner: 'workshop',
  medic: 'medbay',
  trader: 'cargo',
  scout: 'operations',
  security: 'stores',
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
  return ROOMS.find((candidate) => candidate.id === id) || ROOMS[0];
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

export function validateSparrowLayout() {
  const errors = [];
  const roomIds = new Set();
  const doorIds = new Set();

  for (const current of ROOMS) {
    if (roomIds.has(current.id)) errors.push(`duplicate room ${current.id}`);
    roomIds.add(current.id);
    if (!Array.isArray(current.hitPolygon) || current.hitPolygon.length < 3) {
      errors.push(`${current.id} polygon needs at least three points`);
    }
    for (const point of current.hitPolygon || []) {
      if (point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) {
        errors.push(`${current.id} polygon point outside hull`);
      }
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

  for (const door of SPARROW_LAYOUT.doors) {
    if (doorIds.has(door.id)) errors.push(`duplicate door ${door.id}`);
    doorIds.add(door.id);
    if (!roomIds.has(door.roomId)) errors.push(`${door.id} unknown room ${door.roomId}`);
    for (const point of [door.room, door.spine]) {
      if (!point || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) {
        errors.push(`${door.id} coordinate outside hull`);
      }
    }
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
