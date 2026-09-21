// @ts-nocheck

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function polygonCss(points) {
  return `polygon(${points.map((point) => `${point.x}% ${point.y}%`).join(', ')})`;
}

export function roomStyle(room) {
  return [
    'left:0',
    'top:0',
    'width:100%',
    'height:100%',
    `clip-path:${polygonCss(room.hitPolygon)}`,
    `--label-x:${room.labelAnchor.x}%`,
    `--label-y:${room.labelAnchor.y}%`,
  ].join(';');
}

function alertLabel(alert) {
  if (alert === 'good') return 'ready';
  if (alert === 'warn') return 'needs attention';
  if (alert) return 'active';
  return '';
}

export function renderRoomHotspot({ room, selected = false, alert = '', level = null }) {
  const tag = level == null ? room.label : `${room.label} ${level}`;
  const state = alertLabel(alert);
  const aria = [room.label, level == null ? '' : `level ${level}`, state].filter(Boolean).join(', ');
  const classes = [
    'hotspot',
    selected ? 'selected' : '',
    alert ? 'has-alert' : '',
  ].filter(Boolean).join(' ');
  return `
    <button class="${classes}"
      data-act="select-room" data-room="${escapeHtml(room.id)}"
      style="${roomStyle(room)}"
      aria-label="${escapeHtml(aria)}">
      <span class="room-tag">${escapeHtml(tag)}</span>
      ${alert ? `<span class="pip ${escapeHtml(alert)}"></span>` : ''}
    </button>`;
}
