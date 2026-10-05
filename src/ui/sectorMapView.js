// @ts-nocheck
/** Sector map (FTL-lite phase 3): beacons joined by lanes, and the card for the tapped beacon. */

const e = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const GLYPH = {
  station: '<path d="M12 3v14M7 8h10M5 13c0 4 3 7 7 7s7-3 7-7"/>',
  trade: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  travel: '<path d="M5 7l5 5-5 5M12 7l5 5-5 5"/>',
  salvage: '<path d="M14 6a4 4 0 0 0 5 5l-8 8-3-3 8-8a4 4 0 0 0-2-2z"/>',
  story: '<path d="M12 13v8M8 9a5 5 0 0 1 8 0M5 6a9 9 0 0 1 14 0"/><circle cx="12" cy="12" r="1.5"/>',
  danger: '<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17v.5"/>',
  gate: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>',
  lock: '<rect x="6" y="11" width="12" height="9" rx="1"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  ship: '<path d="M12 3l5 15-5-3-5 3z"/>',
};

export function mapGlyph(name, className = 'map-glyph') {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${GLYPH[name] || GLYPH.travel}</svg>`;
}

const TYPE_LABEL = { station: 'Dock', trade: 'Market', travel: 'Lane', salvage: 'Salvage', story: 'Signal', danger: 'Danger' };
const REASON = {
  no_lane: 'No lane from here. Jump along the lanes.',
  siege_wall: 'Siege wall: break this sector\'s flagship to open the gate.',
  locked_node: 'Not on your charts yet.',
  already_here: 'You are here.',
};
const BUSY = {
  contract: 'Finish or abandon the active contract first.',
  fight: 'Your crew is fighting. Finish it on the Ship tab.',
  event: 'Deal with the event first.',
};

function beaconButton(b) {
  const icon = b.wallLocked ? 'lock' : b.gate ? 'gate' : b.type;
  const cls = ['map-beacon', `type-${b.type}`, `hazard-${b.hazard}`, b.here ? 'is-here' : '', b.reachable ? 'is-reachable' : '',
    b.visits ? 'is-visited' : '', b.border ? 'is-border' : '', b.wallLocked ? 'is-walled' : '', b.selected ? 'is-selected' : ''].filter(Boolean).join(' ');
  const where = `${b.name}${b.here ? ', you are here' : b.reachable ? `, ${b.fuel} fuel` : ''}`;
  return `<button type="button" class="${cls}" data-act="map-select" data-node="${e(b.id)}" style="left:${b.x}%;top:${(b.y / b.mapHeight) * 100}%"
    aria-label="${e(where)}" aria-pressed="${b.selected ? 'true' : 'false'}">
    <span class="beacon-dot">${mapGlyph(icon)}${b.here ? `<span class="beacon-ship">${mapGlyph('ship', 'map-glyph ship')}</span>` : ''}</span>
    <span class="beacon-name">${e(b.name)}</span>
    ${b.reachable ? `<span class="beacon-fuel">${e(b.fuel)}F</span>` : ''}
  </button>`;
}

function beaconCard(card, model) {
  const blocked = model.busy ? BUSY[model.busy] : !card.laneOk ? REASON[card.reason] || 'Out of reach.' : !card.canAfford ? `Needs ${card.fuel} fuel. You have ${model.fuel}.` : null;
  const via = card.via === 'limp_home' ? 'Hull critical: you can limp home from anywhere.' : card.via === 'stranded' ? 'No lane onward: Spur Anchor is in reach.' : null;
  const mix = card.mix.length ? card.mix.map(item => `<li class="mix-${e(item.kind)}"><b>${e(item.pct)}%</b> ${e(item.label)}</li>`).join('') : '<li>Dock, repairs, the merc board</li>';
  return `<section class="beacon-card" aria-label="${e(card.name)}">
    <header><span class="beacon-card-icon">${mapGlyph(card.wallLocked ? 'lock' : card.gate ? 'gate' : card.type)}</span>
      <div><b>${e(card.name)}</b><small>${e(TYPE_LABEL[card.type] || card.type)}${card.border ? ` · ${e(card.sector)}` : ''}${card.visits ? ` · visited ${e(card.visits)}×` : ''}</small></div></header>
    <p>${e(card.blurb)}</p>
    <p class="beacon-risk risk-${e((card.risk.threat || 'none').toLowerCase())}">${e(card.risk.label)}</p>
    <ul class="beacon-mix" aria-label="What you might find">${mix}</ul>
    ${via ? `<p class="beacon-note">${e(via)}</p>` : ''}
    ${card.here ? '<p class="beacon-note">You are here.</p>' : `<button type="button" class="primary beacon-jump" data-act="travel-to" data-node="${e(card.id)}" ${card.reachable && card.canAfford ? '' : 'disabled'}
      ${blocked ? 'aria-describedby="beacon-blocked"' : ''}>Jump · ${e(card.fuel)} fuel</button>
    ${blocked ? `<p class="beacon-note" id="beacon-blocked">${e(blocked)}</p>` : ''}`}
  </section>`;
}

/** The Explore view: sector chips, the lane map, and the tapped beacon's card. */
export function renderSectorMap(model) {
  if (!model) return '';
  const selectedId = model.card?.id || null;
  const chips = model.sectors.length > 1 ? `<div class="sector-chips" role="group" aria-label="Sectors">${model.sectors.map(sector => `<button type="button" data-act="map-sector" data-sector="${e(sector.id)}" aria-pressed="${sector.current ? 'true' : 'false'}" class="${sector.current ? 'is-current' : ''}">${e(sector.name)}</button>`).join('')}</div>` : '';
  const lanes = model.lanes.map(lane => `<line x1="${lane.x1}" y1="${lane.y1}" x2="${lane.x2}" y2="${lane.y2}" class="${lane.live ? 'live' : ''}"/>`).join('');
  const beacons = model.beacons.map(b => beaconButton({ ...b, mapHeight: model.height, selected: b.id === selectedId })).join('');
  return `<div class="sector-map-view">
    <div class="sector-map-head"><h2>${e(model.sectorName)}</h2><span>At ${e(model.hereName)} · ${e(model.fuel)} fuel</span></div>
    ${chips}
    ${model.busy ? `<p class="contract-consequence" id="explore-${model.busy === 'contract' ? 'contract' : model.busy === 'fight' ? 'fight' : 'event'}-lock">${e(BUSY[model.busy])}</p>` : ''}
    <div class="sector-map" style="aspect-ratio:${model.width}/${model.height}">
      <svg class="sector-lanes" viewBox="0 0 ${model.width} ${model.height}" preserveAspectRatio="none" aria-hidden="true">${lanes}</svg>
      ${beacons}
    </div>
    <p class="sector-map-legend">Tap a beacon. Lit lanes lead from where you are.</p>
    ${model.card ? beaconCard(model.card, model) : ''}
  </div>`;
}
