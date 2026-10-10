// @ts-nocheck
/**
 * The Captain's Almanac screen (Phase 3 §6): a book with five sections. Presentation only; the model is
 * src/systems/almanac.js almanacModel. Taps: `almanac-section` (data-section), `almanac-close`, `tx-replay` (data-id).
 */
import { artUrl } from '../shared/artUrl.js';
import { portraitFor } from '../data/portraits.js';
import { FAMILIES, familyOf } from '../data/families.js';
import { enemyArtFor } from '../data/art/enemyArt.js';
import { almanacModel } from '../systems/almanac.js';
import { loyaltyLevel, hasBond } from '../systems/loyalty.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LOCKED = '<span class="alm-locked">Not yet</span>';
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const SECTOR_NAMES = { spur: 'The Spur', veil: 'Veil Edge', ember: 'Ember Reach', hollow: 'Hollow Expanse', crown: 'Crown Halo' };

function storySection(section) {
  const chapters = [...new Set(section.entries.map(e => e.chapter))];
  return chapters.map(n => `<h3 class="alm-sub">Chapter ${n}</h3><ul class="alm-list">${section.entries.filter(e => e.chapter === n).map(entry => entry.open
    ? `<li><span>${esc(entry.title)}</span><button type="button" class="ghost" data-act="tx-replay" data-id="${esc(entry.id)}">Replay</button></li>`
    : `<li class="is-locked"><span>???</span>${LOCKED}</li>`).join('')}</ul>`).join('');
}

function crewSection(section, player) {
  return `<ul class="alm-crew">${section.entries.map(({ merc, open }) => {
    if (!open) return `<li class="is-locked rarity-${esc(merc.rarity)}"><img class="alm-silhouette" src="${esc(portraitFor(merc.id, merc.role))}" alt="" /><b>???</b><small>${esc(cap(merc.rarity))} · answers the hiring beacon</small></li>`;
    const family = FAMILIES[familyOf(merc.id)];
    const bond = hasBond(merc.id) ? loyaltyLevel(player, merc.id).label : '';
    return `<li class="rarity-${esc(merc.rarity)}"><details><summary><img src="${esc(portraitFor(merc.id, merc.role))}" alt="" /><b>${esc(merc.name)}</b><small>${esc(cap(merc.rarity))} ${esc(merc.role)}${bond ? ` · ${esc(bond)}` : ''}</small></summary>
      <div class="alm-file">${family ? `<p class="muted">${esc(family.name)} · from ${esc(merc.origin)}</p>` : `<p class="muted">From ${esc(merc.origin)}</p>`}
      ${merc.quote ? `<blockquote>“${esc(merc.quote)}”</blockquote>` : ''}<p>${esc(merc.history || merc.blurb)}</p></div></details></li>`;
  }).join('')}</ul>`;
}

function enemiesSection(section) {
  return section.factions.map(({ faction, open, ships }) => `<article class="alm-faction${open ? '' : ' is-locked'}">
    <header><img src="${esc(artUrl(`art/pixel/ui/faction-${faction.id}.png`))}" alt="" /><div><b>${open ? esc(faction.name) : '???'}</b>
      <small>${open ? esc(faction.chip) : 'Not met yet'}</small></div></header>
    ${open ? `<p><b>Their trick.</b> ${esc(faction.mechanic)}</p><p><b>Beat it.</b> ${esc(faction.counter)}</p>` : ''}
    <ul class="alm-ships">${ships.map(ship => ship.open
      ? `<li><img src="${esc(enemyArtFor(ship.id).image)}" alt="" /><span><b>${esc(ship.encounter.name)}</b><small>${esc(ship.encounter.blurb)}</small></span><span class="alm-record">${ship.record[0]} won · ${ship.record[1]} lost</span></li>`
      : `<li class="is-locked"><span><b>???</b></span>${LOCKED}</li>`).join('')}</ul></article>`).join('');
}

function placesSection(section) {
  const sectors = [...new Set(section.entries.map(e => e.node.sector))];
  return sectors.map(sector => `<h3 class="alm-sub">${esc(SECTOR_NAMES[sector] || sector)}</h3><ul class="alm-list">${section.entries.filter(e => e.node.sector === sector)
    .map(({ node, open }) => (open ? `<li><span><b>${esc(node.name)}</b><small>${esc(node.blurb)}</small></span></li>` : `<li class="is-locked"><span>???</span>${LOCKED}</li>`)).join('')}</ul>`).join('');
}

function discoveriesSection(section) {
  return `<ul class="alm-list">${section.entries.map(({ beat, open }) => (open
    ? `<li><span><b>${esc(beat.title)}</b><small>${esc(beat.text)}</small></span></li>`
    : `<li class="is-locked"><span>???</span>${LOCKED}</li>`)).join('')}</ul>`;
}

/** The Almanac sheet on one section (default: Story). */
export function renderAlmanac(player, sectionId = 'story') {
  const model = almanacModel(player);
  const section = model.sections.find(s => s.id === sectionId) || model.sections[0];
  const body = { story: storySection, crew: crewSection, enemies: enemiesSection, places: placesSection, discoveries: discoveriesSection }[section.id](section, player);
  return `<div class="modal-backdrop alm-backdrop"><section class="alm-book" role="dialog" aria-modal="true" aria-label="Captain's Almanac">
    <header class="alm-head" style="background-image:linear-gradient(90deg, rgba(14, 22, 38, 0.92), rgba(14, 22, 38, 0.2) 70%), url('${esc(artUrl('art/pixel/cinematic/v2/almanac.png'))}')">
      <div><span class="modal-kicker">Captain's Almanac</span><b>${model.percent}% filled in</b><small>${model.open} of ${model.total} entries</small></div>
      <button type="button" class="icon-close" data-act="almanac-close" aria-label="Close the Almanac">×</button>
    </header>
    <nav class="alm-tabs" aria-label="Almanac sections">${model.sections.map(s => `<button type="button" data-act="almanac-section" data-section="${s.id}" aria-pressed="${s.id === section.id}">${esc(s.label)}<small>${s.open}/${s.total}</small></button>`).join('')}</nav>
    <div class="alm-body">${body}</div>
  </section></div>`;
}

/** The Log tab's way in: the book, how full it is. */
export function renderAlmanacCard(player) {
  const model = almanacModel(player);
  return `<button type="button" class="panel alm-card" data-act="almanac-open"><img src="${esc(artUrl('art/pixel/ui/almanac.png'))}" alt="" />
    <span><b>Captain's Almanac</b><small>${model.percent}% filled in · story, crew files, enemies, places, discoveries</small></span></button>`;
}
