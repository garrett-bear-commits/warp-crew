// @ts-nocheck
import { trustedNow } from '../shared/time.js';
import { normalizeAssignments, STATIONS } from '../systems/stations.js';
import { portraitFor } from '../data/portraits.js';

// 12-wide pixel glyphs: '#' draws in currentColor, '+' in the accent colour.
const GLYPHS = {
  ship: [
    '.....##.....',
    '....####....',
    '....#++#....',
    '...##++##...',
    '...######...',
    '..########..',
    '.##########.',
    '.###.##.###.',
    '.##..##..##.',
    '.#...##...#.',
    '.....++.....',
    '....+..+....',
  ],
  crew: [
    '...###......',
    '..#####.##..',
    '..#########.',
    '...###.####.',
    '....#...##..',
    '.#######+++.',
    '###########.',
    '#####.######',
    '#####.######',
    '#####.######',
  ],
  missions: [
    '....####....',
    '..##....##..',
    '.#...##...#.',
    '.#..#..#..#.',
    '#..#.++.#..#',
    '#..#.++.#..#',
    '#...#..#...#',
    '.#...##..+#.',
    '.#.......+#.',
    '..##....##..',
    '....####....',
  ],
  shop: [
    '.##########.',
    '.#++++++++#.',
    '.##########.',
    '.#.#....#.#.',
    '.#..#..#..#.',
    '.#...##...#.',
    '.#...##...#.',
    '.#..#..#..#.',
    '.#.#....#.#.',
    '.##########.',
  ],
  log: [
    '..########..',
    '..#......#..',
    '..#.++++.#..',
    '..#......#..',
    '..#.+++..#..',
    '..#......#..',
    '..#.++++.#..',
    '..#......#..',
    '..#.++...#..',
    '..########..',
  ],
  hull: [
    '...######...',
    '..#++++++#..',
    '.#+######+#.',
    '.#+#....#+#.',
    '.#+#.##.#+#.',
    '.#+#.##.#+#.',
    '.#+#....#+#.',
    '.#+######+#.',
    '..#++++++#..',
    '...######...',
  ],
  shield: [
    '.##########.',
    '.#++++++++#.',
    '.#+######+#.',
    '.#+######+#.',
    '.#+######+#.',
    '..#+####+#..',
    '..#+####+#..',
    '...#+##+#...',
    '....#++#....',
    '.....##.....',
  ],
  helm: [
    '...######...',
    '..#..##..#..',
    '.#...##...#.',
    '.#...##...#.',
    '.####++####.',
    '.#...++...#.',
    '.#..#..#..#.',
    '..##....##..',
    '...######...',
  ],
  weapons: [
    '.....##.....',
    '.....##.....',
    '...#....#...',
    '..#......#..',
    '##...++...##',
    '##...++...##',
    '..#......#..',
    '...#....#...',
    '.....##.....',
    '.....##.....',
  ],
  engineering: [
    '....#..#....',
    '..########..',
    '..##....##..',
    '.##..++..##.',
    '..#.++++.#..',
    '..#.++++.#..',
    '.##..++..##.',
    '..##....##..',
    '..########..',
    '....#..#....',
  ],
  camera: [
    '###......###',
    '#..........#',
    '#..........#',
    '.....++.....',
    '....++++....',
    '....++++....',
    '.....++.....',
    '#..........#',
    '#..........#',
    '###......###',
  ],
};

export function pixelIcon(name, className = '') {
  const rows = GLYPHS[name];
  if (!rows) return '';
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      else if (c === '+') rects += `<rect class="ac" x="${x}" y="${y}" width="1" height="1"/>`;
    }
  });
  return `<svg class="px-icon ${className}" viewBox="0 0 12 ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function segmentBar(pct, kind, segments = 12) {
  const filled = Math.max(0, Math.min(segments, Math.round((pct / 100) * segments)));
  const cells = Array.from({ length: segments }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('');
  return `<div class="seg-bar ${kind}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">${cells}</div>`;
}

export function renderStatusPanel(hullPct, shieldPct) {
  return `
    <div class="status-panel" aria-label="Ship status">
      <div class="status-row hull">
        ${pixelIcon('hull')}
        <span class="lbl">HULL</span>
        ${segmentBar(hullPct, 'hull')}
        <b class="pct">${hullPct}%</b>
      </div>
      <div class="status-row shield">
        ${pixelIcon('shield')}
        <span class="lbl">SHIELD</span>
        ${segmentBar(shieldPct, 'shield')}
        <b class="pct">${shieldPct}%</b>
      </div>
    </div>`;
}

export function renderObjectiveHead(locName, stationLabel = null) {
  return `
    <div class="objective-head">
      <span class="kicker">${stationLabel ? 'STATION OUTPUT' : 'LOCATION'}</span>
      <b>${escapeHtml(stationLabel || locName)}</b>
    </div>`;
}

const STATUS_TEXT = { expedition: 'AWAY', injured: 'HURT', reserve: 'RESERVE' };

/** Left-edge roster: who is aboard, where they work, and whether they are free. */
export function renderCrewRail(player) {
  const crew = player?.crew || [];
  if (crew.length < 2) return '';
  const assignments = normalizeAssignments(player);
  const tiles = crew.map((member) => {
    const stationId = assignments[member.instanceId];
    const station = stationId ? STATIONS[stationId] : null;
    const status = STATUS_TEXT[member.status] || (station ? '' : 'IDLE');
    const target = station && !STATUS_TEXT[member.status]
      ? `data-act="select-room" data-room="${escapeHtml(station.roomId)}"`
      : 'data-tab="crew"';
    const label = [member.name, station ? station.label : 'no station', status].filter(Boolean).join(', ');
    return `
      <button type="button" class="rail-crew ${status ? `is-${status.toLowerCase()}` : 'is-working'}" ${target} aria-label="${escapeHtml(label)}">
        <img src="${escapeHtml(portraitFor(member.templateId, member.role))}" alt="" />
        ${station ? `<span class="rail-station">${pixelIcon(stationId)}</span>` : ''}
        ${status ? `<span class="rail-status">${status}</span>` : ''}
      </button>`;
  }).join('');
  return `<nav class="crew-rail" aria-label="Crew aboard"><span class="rail-title">CREW</span>${tiles}</nav>`;
}

function commandState(player, expReady, now) {
  if (expReady) return { sub: 'CLAIM', tone: 'good' };
  if (player?.activeContract) return { sub: 'EN ROUTE', tone: 'live' };
  if (player?.activeExpedition && player.activeExpedition.endAt > now) return { sub: 'AWAY', tone: 'live' };
  return { sub: 'READY', tone: 'ready' };
}

const TAB_LABELS = { ship: 'Ship', crew: 'Crew', missions: 'Contracts', shop: 'Shop', log: 'Log' };

/** Bottom command bar; Missions becomes the large centre action when unlocked. */
export function renderCommandBar(tab, player, expReady, tabs, { spotlight = null, badges = {}, now = trustedNow() } = {}) {
  const ids = tabs?.length ? tabs : ['ship'];
  const hasCenter = ids.includes('missions') && ids.length >= 3;
  const side = ids.filter((id) => !(hasCenter && id === 'missions'));
  const half = Math.ceil(side.length / 2);
  const button = (id) => {
    const spot = spotlight === `nav-${id}` ? 'spot-glow' : '';
    return `
      <button data-tab="${id}" data-spot-target="nav-${id}" class="cmd-btn ${tab === id ? 'active' : ''} ${spot}" aria-label="${TAB_LABELS[id]}">
        ${pixelIcon(id)}
        <span>${TAB_LABELS[id]}</span>
        ${badges[id] ? '<i class="nav-badge"></i>' : ''}
      </button>`;
  };
  let center = '';
  if (hasCenter) {
    const state = commandState(player, expReady, now);
    const spot = spotlight === 'nav-missions' ? 'spot-glow' : '';
    center = `
      <button data-tab="missions" data-spot-target="nav-missions" class="cmd-center tone-${state.tone} ${tab === 'missions' ? 'active' : ''} ${spot}" aria-label="Contracts, ${state.sub.toLowerCase()}">
        ${pixelIcon('missions')}
        <span>Contracts</span>
        <small>${state.sub}</small>
        ${badges.missions ? '<i class="nav-badge"></i>' : ''}
      </button>`;
  }
  return `${side.slice(0, half).map(button).join('')}${center}${side.slice(half).map(button).join('')}`;
}
