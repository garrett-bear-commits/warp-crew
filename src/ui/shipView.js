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

function contractSignalLabel(signal) {
  if (signal === 'route') return 'route active';
  if (signal === 'return') return 'reward ready';
  return '';
}

export function contractShipSignals(player) {
  const stage = player?.activeContract?.stage;
  return {
    operationsActive: Boolean(stage && stage !== 'return' && stage !== 'claimed'),
    cargoReady: stage === 'return',
    firstRepairLit: player?.flags?.sparrowFirstRepair === true,
    berth3Open: player?.flags?.berth3Opened === true && (player?.crewSlots || 0) >= 3,
  };
}

export function renderShipFeedback(signals = {}) {
  if (!signals.firstRepairLit && !signals.berth3Open) return '';
  return `
    ${signals.firstRepairLit ? `<div class="sparrow-first-repair is-lit" role="img" aria-label="Sparrow repair online">
      <span class="repair-light" aria-hidden="true"></span>
      <span class="repair-prop" aria-hidden="true"></span>
    </div>` : ''}
    ${signals.berth3Open ? '<div class="sparrow-berth-open" role="img" aria-label="Third berth open"><span aria-hidden="true">3</span></div>' : ''}`;
}

export function renderDepartureStatus(active) {
  if (!active) return '';
  return '<div class="departure-status" id="departure-status-message" role="status" aria-live="polite">Away team boarding through Cargo…</div>';
}

export function renderShipSequence(sequence) {
  const message = sequence === 'launch' ? 'Sparrow launched · en route'
    : sequence === 'crew-arrival' ? 'Jen aboard · heading to Workshop' : '';
  return message ? `<div class="ship-sequence-status" role="status" aria-live="polite">${message}</div>` : '';
}

export function renderRoomHotspot({ room, selected = false, alert = '', signal = '', level = null }) {
  const tag = level == null ? room.label : `${room.label} ${level}`;
  const state = contractSignalLabel(signal) || alertLabel(alert);
  const aria = [room.label, level == null ? '' : `level ${level}`, state].filter(Boolean).join(', ');
  const classes = [
    'hotspot',
    selected ? 'selected' : '',
    alert ? 'has-alert' : '',
    signal === 'route' ? 'contract-route' : '',
    signal === 'return' ? 'contract-return' : '',
  ].filter(Boolean).join(' ');
  return `
    <button class="${classes}"
      data-act="select-room" data-room="${escapeHtml(room.id)}"
      style="${roomStyle(room)}"
      aria-label="${escapeHtml(aria)}">
      ${alert ? `<span class="pip ${escapeHtml(alert)}"></span>` : ''}
      ${signal ? `<span class="ship-signal" aria-hidden="true">${signal === 'route' ? 'ROUTE' : 'REWARD'}</span>` : ''}
    </button>
    <span class="room-tag" data-room-label="${escapeHtml(room.id)}" aria-hidden="true"
      style="--label-x:${room.labelAnchor.x}%;--label-y:${room.labelAnchor.y}%">${escapeHtml(tag)}</span>`;
}
