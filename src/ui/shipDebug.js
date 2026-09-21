// @ts-nocheck

const pointsAttr = (points) => points.map((point) => `${point.x},${point.y}`).join(' ');

export function shipDebugEnabled({ dev = false, search = '' } = {}) {
  return Boolean(dev) && new URLSearchParams(search).get('shipDebug') === '1';
}

export function renderShipDebug(layout) {
  const rooms = layout.rooms.map((room) => `
    <g data-debug-room="${room.id}">
      <polygon class="debug-room" points="${pointsAttr(room.hitPolygon)}"></polygon>
      <rect class="debug-walk" x="${room.walkBounds.left}" y="${room.walkBounds.top}"
        width="${room.walkBounds.width}" height="${room.walkBounds.height}"></rect>
      <circle class="debug-work" cx="${room.workAnchor.x}" cy="${room.workAnchor.y}" r="0.8"></circle>
      <text x="${room.labelAnchor.x}" y="${room.labelAnchor.y}">${room.label}</text>
    </g>`).join('');
  const halls = layout.halls.map((hall) => `
    <rect class="debug-hall" data-debug-hall="${hall.id}" x="${hall.left}" y="${hall.top}"
      width="${hall.width}" height="${hall.height}"></rect>`).join('');
  const doors = layout.doors.map((door) => `
    <g data-debug-door="${door.id}">
      <line class="debug-door" x1="${door.room.x}" y1="${door.room.y}" x2="${door.spine.x}" y2="${door.spine.y}"></line>
      <circle class="debug-door-point" cx="${door.room.x}" cy="${door.room.y}" r="0.65"></circle>
      <circle class="debug-door-point" cx="${door.spine.x}" cy="${door.spine.y}" r="0.65"></circle>
    </g>`).join('');
  const blockers = layout.blockers.map((blocker) => blocker.shape === 'ellipse'
    ? `<ellipse class="debug-blocker" data-debug-blocker="${blocker.id}" cx="${blocker.x}" cy="${blocker.y}" rx="${blocker.rx}" ry="${blocker.ry}"></ellipse>`
    : `<rect class="debug-blocker" data-debug-blocker="${blocker.id}" x="${blocker.left}" y="${blocker.top}" width="${blocker.width}" height="${blocker.height}"></rect>`
  ).join('');
  const thrusters = layout.effects.thrusters.map((thruster, index) => `
    <circle class="debug-effect" data-debug-thruster="${index}" cx="${thruster.x}" cy="${thruster.y}" r="0.8"></circle>`).join('');

  return `<svg class="ship-debug" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    ${halls}${rooms}${doors}${blockers}${thrusters}
  </svg>`;
}
