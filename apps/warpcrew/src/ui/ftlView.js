// @ts-nocheck
// FTL-lite fight screen: the enemy ship above the ship view, room markers on
// the Sparrow, and the controls strip below. Pure HTML from the session model.
import { ROOMS } from '../data/starterShip.js';
import { roomStyle } from './shipView.js';
import { enemyArtFor } from '../data/art/enemyArt.js';

const e = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const ICON_PATHS = {
  weapons: '<path d="M3 12h13M12 7l5 5-5 5"/><circle cx="19.5" cy="12" r="1.5"/>',
  shields: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  engines: '<path d="M6 8h9l4 4-4 4H6z"/><path d="M3 10h2M3 14h2"/>',
  helm: '<circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/>',
  engineering: '<path d="M14 4l6 6-3 3-6-6zM11 7l-7 7 3 3 7-7"/>',
  fire: '<path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-7 1 1 2 2 3 3 0-2-1-4 0-6z"/>',
  boarders: '<circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6M14 20c0-3 1.5-5 4-5s3 2 3 5"/>',
  reticle: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
};
export const icon = (name, cls = '') => `<svg class="ftl-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

const identity = view => `data-revision="${e(view.revision)}" data-acceptance-id="${e(view.acceptanceId)}"`;
const bar = (pct, cls = '') => `<span class="ftl-bar ${cls}"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></span>`;
/** A charge bar that fills from now to where it will be at the next beat. */
const chargeBar = (from, to, cls = '', beat = 0) => `<span class="ftl-bar ${cls}"><span class="is-filling fill-${beat % 2}" style="--from:${Math.max(0, Math.min(100, from))}%;width:${Math.max(0, Math.min(100, to))}%"></span></span>`;
const pips = (layers, max, full) => Array.from({ length: Math.max(full, max) }, (_, i) => `<i class="ftl-pip${i < layers ? ' on' : ''}${i >= max ? ' broken' : ''}"></i>`).join('');
const live = view => !view.result && !view.downed;

// A 7x11 pixel crew silhouette (head, shoulders, body, legs), tinted by the enemy family in CSS.
const ENEMY_CREW_PIXELS = '<rect x="2" y="0" width="3" height="3"/><rect x="1" y="3" width="5" height="1"/><rect x="0" y="4" width="7" height="3"/><rect x="1" y="7" width="5" height="1"/><rect x="1" y="8" width="2" height="3"/><rect x="4" y="8" width="2" height="3"/>';

/**
 * The enemy crew member stationed in a room, from the room's state only (presentation, no rules):
 * at their post when the room is whole, repairing when it is damaged, gone while it burns or is offline.
 */
export function enemyCrewState(room) {
  if (!room || room.offline || room.fire) return 'gone';
  return room.integrity < 100 || room.damaged ? 'repairing' : 'manning';
}

function enemyCrewFigure(id, room) {
  const state = enemyCrewState(room);
  if (state === 'gone') return '';
  return `<span class="ftl-enemy-crew is-${state}" data-enemy-crew="${id}" aria-hidden="true"><svg viewBox="0 0 7 11" shape-rendering="crispEdges">${ENEMY_CREW_PIXELS}</svg>${state === 'repairing' ? '<i class="ftl-enemy-spark"></i>' : ''}</span>`;
}

/** Enemy ship: its cutaway art with four targetable rooms over their real positions, hull, shields and guns. */
export function renderFtlEnemy(view) {
  if (!view?.ftl) return '';
  const enemy = view.enemy;
  const art = enemyArtFor(view.encounterId);
  const hullPct = Math.round((enemy.hull / enemy.hullMax) * 100);
  // Tutorial: their Weapons room is the one thing to tap; the rest wait until it is targeted.
  const teaching = view.guided && view.targetChosen !== true && live(view);
  const rooms = ['shields', 'weapons', 'engines', 'helm'].map(id => {
    const room = enemy.rooms[id];
    const box = art.rooms[id] || { left: 0, top: 0, width: 25, height: 25 };
    const targeted = view.target === id && live(view) && !teaching;
    const spotlight = teaching && id === 'weapons';
    const enabled = live(view) && (!teaching || spotlight);
    return `<button type="button" class="ftl-enemy-room room-${id}${targeted ? ' is-target' : ''}${room.offline ? ' is-offline' : room.damaged ? ' is-damaged' : ''}${room.fire ? ' is-burning' : ''}"
      style="left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%"
      data-enemy-room="${id}" data-act="encounter-command" data-command-type="target" data-room="${id}" ${identity(view)} ${enabled ? '' : 'disabled'}${spotlight ? ' data-primary-pulse data-spotlight-target' : ''}
      aria-pressed="${targeted}" aria-label="Target their ${e(room.label)}${room.offline ? ', offline' : ''}">
      ${enemyCrewFigure(id, room)}<span class="ftl-room-tag">${icon(id)}<b>${e(room.label)}</b></span>${room.integrity < 100 ? bar(room.integrity, 'integrity') : ''}${room.fire ? icon('fire', 'fire') : ''}${targeted ? icon('reticle', 'reticle') : ''}
    </button>`;
  }).join('');
  const guns = enemy.weapons.map(w => `<div class="ftl-enemy-gun${w.chargePct >= 70 ? ' is-hot' : ''}">
      <span>${w.shots}×${w.damage} → ${e(w.targetLabel)}</span>${chargeBar(w.chargePct, w.nextPct ?? w.chargePct, 'charge enemy', view.beat)}</div>`).join('');
  return `<section class="ftl-enemy family-${e(art.family)}${enemy.shields.layers > 0 ? ' is-shielded' : ''}${view.result === 'win' ? ' is-destroyed' : ''}" aria-label="Enemy ship">
    <header class="ftl-enemy-head">
      <b>${e(view.enemyName)}</b>${view.threatLabel ? `<span class="ftl-threat" data-threat="${e(view.threatLabel.toLowerCase())}">${e(view.threatLabel)}</span>` : ''}
      <span class="ftl-enemy-shields" aria-label="Enemy shields ${enemy.shields.layers} of ${enemy.shields.full}">${pips(enemy.shields.layers, enemy.shields.max, enemy.shields.full)}${enemy.shields.ionized ? '<i class="ftl-ionized">Ionized</i>' : ''}</span>
    </header>
    <div class="ftl-enemy-hull"><span>Hull</span>${bar(hullPct, 'hull enemy')}<b>${e(enemy.hull)}</b><small>Evade ${e(enemy.evasion)}%</small></div>
    <div class="ftl-enemy-ship" style="aspect-ratio:${art.aspect}">
      <img src="${art.image}" alt="" draggable="false" />
      <span class="ftl-enemy-bubble" aria-hidden="true"></span>
      ${rooms}
    </div>
    <div class="ftl-enemy-guns">${guns}</div>
    ${live(view) ? `<p class="ftl-hint${teaching ? ' is-teaching' : ''}">${teaching ? 'Tap their <b>Weapons</b> room. Knock out their guns and the trader is safe.' : view.targetChosen ? 'Tap a room to change target' : 'Tap a room to target it'}</p>` : ''}
  </section>`;
}

/** Markers on the Sparrow's rooms: damage, fire, boarders, incoming fire, and move targets for the selected (or dragged) crew. */
export function renderFtlShipMarkers(view, { selectedCrewId = null, dragging = false } = {}) {
  if (!view?.ftl) return '';
  const incoming = new Set(view.enemy.weapons.filter(w => w.chargePct >= 50).map(w => w.target));
  const selected = selectedCrewId && live(view) ? view.crew.find(member => member.id === selectedCrewId) : null;
  return Object.values(view.rooms).map(room => {
    const shipRoom = ROOMS.find(candidate => candidate.id === room.roomId);
    if (!shipRoom) return '';
    const boarded = view.boarders?.phase === 'aboard' && view.boarders.room === room.id;
    const status = `${room.integrity < 100 ? bar(room.integrity, 'integrity') : ''}${room.fire ? icon('fire', 'fire') : ''}${boarded ? icon('boarders', 'boarders') : ''}${incoming.has(room.id) && live(view) ? icon('reticle', 'incoming') : ''}`;
    const marker = `<div class="ftl-room-marker${room.offline ? ' is-offline' : room.damaged ? ' is-damaged' : ''}${room.fire ? ' is-burning' : ''}" style="left:${shipRoom.labelAnchor.x}%;top:${shipRoom.labelAnchor.y}%" aria-hidden="true">${status}</div>`;
    const move = selected ? `<button type="button" class="ftl-move-target${dragging ? ' is-drop-target' : ''}" style="${roomStyle(shipRoom)}" data-act="encounter-command" data-command-type="move" data-crew-id="${e(selected.id)}" data-room="${e(room.id)}" ${identity(view)} aria-label="Send ${e(selected.name)} to ${e(shipRoom.label)}"><span>${e(shipRoom.label)}</span></button>` : '';
    return marker + move;
  }).join('');
}

function renderTactics(view) {
  if (!view.tactics?.length || !live(view)) return '';
  const reason = { not_enough_fuel: 'Needs 1 fuel', used: 'Used', enemy_too_strong: 'Enemy above half hull', finished: 'Over' };
  return view.tactics.map(tactic => {
    const burn = tactic.id === 'burn';
    const title = burn ? 'Overcharge · 1F' : `Board · ${tactic.chance != null ? `${Math.round(tactic.chance * 100)}%` : '—'}`;
    const detail = burn ? (tactic.burning ? 'Guns overcharged' : '+50% charge for 8 s')
      : tactic.used ? (tactic.success ? 'Boarded' : 'Repelled') : tactic.available ? '+25% payout · failure injures crew' : '';
    const why = tactic.available ? '' : ` · ${reason[tactic.reason] || 'Unavailable'}`;
    return `<button type="button" class="ftl-tactic tactic-${e(tactic.id)}${tactic.burning ? ' is-live' : ''}" data-act="encounter-order" data-order="${e(tactic.id)}" ${identity(view)} ${tactic.available ? '' : 'disabled'}>${e(title)}<span>${e(detail)}${e(why)}</span></button>`;
  }).join('');
}

/** A crew member's signature move: fills as it charges, glows when ready, tap to use it. */
function renderAbility(view, member) {
  const a = member.ability;
  const state = a.queued ? ' is-queued' : a.ready ? ' is-ready' : '';
  const label = a.queued ? `${a.move}, going off` : a.ready ? `Use ${a.move}: ${a.text}` : `${a.move} charging, ${Math.round(a.chargePct)} percent: ${a.text}`;
  return `<button type="button" class="ftl-ability${state}" data-act="encounter-command" data-command-type="ability" data-crew-id="${e(member.id)}" ${identity(view)}
      ${a.ready && !a.queued && live(view) ? '' : 'disabled'} aria-label="${e(label)}" title="${e(a.text)}">
      <b>${e(a.move)}</b>${chargeBar(a.chargePct, a.nextPct ?? a.chargePct, 'ability-charge', view.beat)}</button>`;
}

/** Auto: abilities fire themselves when they would help. Off: the captain taps them. */
function renderAutoToggle(view) {
  if (!view.abilities || !live(view)) return '';
  return `<button type="button" class="ftl-auto${view.auto ? ' is-on' : ''}" data-act="encounter-command" data-command-type="auto" data-auto="${view.auto ? 'false' : 'true'}" ${identity(view)}
    aria-pressed="${view.auto}" aria-label="${view.auto ? 'Auto abilities on: crew use their moves themselves' : 'Auto abilities off: tap a move to use it'}">Auto<span>${view.auto ? 'On' : 'Off'}</span></button>`;
}

/** The strip under the ship view: hull, shields, guns, Hold, crew, orders, pause and the result. */
/** The short line under a weapon's name: what it does, in the fewest words. */
function weaponTag(w) {
  if (w.kind === 'ion') return 'Ion · drops a shield';
  if (w.kind === 'beam') return `Beam · ${w.damage} once shields are down`;
  if (w.kind === 'missile') return `${w.damage} · through shields · ${w.ammo ?? 0} left`;
  return `${w.shots}×${w.damage}`;
}

export function renderFtlControls(view, { selectedCrewId = null, paused = false, claimAct = 'contract-claim', claimRevision = view?.revision, claimAcceptanceId = view?.acceptanceId } = {}) {
  if (!view?.ftl) return '';
  const hullPct = Math.round((view.hull / view.hullMax) * 100);
  const status = `<div class="ftl-status">
      <div class="ftl-hull${hullPct <= 30 ? ' is-low' : ''}"><span>Hull</span>${bar(hullPct, 'hull')}<b>${e(view.hull)}</b></div>
      <div class="ftl-shield" aria-label="Shields ${view.shields.layers} of ${view.shields.full}"><span>Shield</span>${pips(view.shields.layers, view.shields.max, view.shields.full)}</div>
      <small class="ftl-evade">Evade ${e(view.evasion)}%</small>
      ${live(view) ? `<button type="button" class="ftl-pause${paused ? ' is-paused' : ''}" data-act="ftl-pause" aria-pressed="${paused}">${paused ? 'Resume' : 'Pause'}</button>` : ''}
    </div>`;
  if (view.downed) {
    const d = view.downed;
    return `<section class="ftl-controls" aria-label="Fight controls">${status}
      <div class="downed-alert" role="alert"><p><b>Hull failing.</b> ${e(view.enemyName)} has only ${e(d.enemyHull)} hull left.</p>
        <button type="button" class="primary rally-btn" data-act="encounter-order" data-order="rally" ${identity(view)} ${d.canAfford ? '' : 'disabled'}>Rally<span>${d.free ? 'Free this time · ' : `${e(d.rallyCost)} gems · `}patch the hull and fight on</span></button>
        <button type="button" class="ghost" data-act="encounter-order" data-order="concede" ${identity(view)}>Take the salvage</button></div></section>`;
  }
  if (view.result) {
    const won = view.result === 'win';
    const claim = won || view.settled
      ? `<button type="button" class="primary" data-act="${e(claimAct)}" data-revision="${e(claimRevision)}" data-acceptance-id="${e(claimAcceptanceId)}">${won ? 'Bring cargo aboard' : 'Collect salvage'}</button>`
      : `<button type="button" class="primary" data-act="encounter-recover" ${identity(view)}>Recover ship</button>`;
    return `<section class="ftl-controls is-over" aria-label="Fight result">${status}
      <p class="ftl-result" role="status">${won ? `${e(view.enemyName)} is breaking up. Bring the cargo aboard.` : `${e(view.lossReason || 'The ship needs repairs.')}${view.settled ? ' The crew pulls salvage from the wreckage.' : ''}`}</p>
      ${claim}</section>`;
  }
  const weapons = view.weapons.map(w => `<div class="ftl-weapon${w.ready ? ' is-ready' : ''}${w.ammo === 0 ? ' is-empty' : ''}" data-weapon-kind="${e(w.kind || 'laser')}">
      <b>${e(w.name)}</b><small>${e(weaponTag(w))}</small>${chargeBar(w.chargePct, w.nextPct ?? w.chargePct, 'charge', view.beat)}</div>`).join('');
  const selected = view.crew.find(member => member.id === selectedCrewId);
  const crew = view.crew.map(member => {
    const chip = `<button type="button" class="ftl-crew-chip${member.id === selectedCrewId ? ' is-selected' : ''}${member.moving ? ' is-moving' : ''}"
      data-act="ftl-select-crew" data-crew-id="${e(member.id)}" aria-pressed="${member.id === selectedCrewId}" aria-label="${e(member.name)}, in ${e(view.rooms[member.room]?.label || 'the corridor')}">
      ${member.portrait ? `<img src="${e(member.portrait)}" alt="" />` : ''}<span>${e(member.name.split(' ')[0])}</span><small>${e(view.rooms[member.room]?.label || 'Free')}</small></button>`;
    return member.ability ? `<div class="ftl-crew-card" data-crew-card="${e(member.id)}">${chip}${renderAbility(view, member)}</div>` : chip;
  }).join('');
  const boarders = view.boarders && view.boarders.phase !== 'repelled'
    ? `<p class="ftl-alert" role="status">${view.boarders.phase === 'incoming' ? `Boarding clamps on the hull. Raiders are heading for ${e(view.boarders.roomLabel)}.` : `Raiders in ${e(view.boarders.roomLabel)} · send crew to fight them`}</p>` : '';
  return `<section class="ftl-controls" aria-label="Fight controls">${status}
    <div class="ftl-weapons">${weapons}
      <button type="button" class="ftl-hold${view.hold ? ' is-on' : ''}" data-act="encounter-command" data-command-type="hold" data-hold="${view.hold ? 'false' : 'true'}" ${identity(view)} aria-pressed="${view.hold}">${view.hold ? 'Holding' : 'Hold'}<span>${view.hold ? 'Fire together' : 'Fire as ready'}</span></button>
    </div>
    ${boarders}
    <div class="ftl-crew-row">${renderAutoToggle(view)}<div class="ftl-crew" role="group" aria-label="Crew">${crew}</div></div>
    <p class="ftl-hint">${selected ? `Tap a room on the ship to send ${e(selected.name.split(' ')[0])}.` : view.abilities ? (view.auto ? 'Crew use their moves when they help. Drag crew onto a room to fight fires or repair.' : 'Tap a glowing move to use it. Drag crew onto a room to fight fires or repair.') : 'Drag crew onto a room (or tap crew, then a room) to fight fires or repair.'}</p>
    ${view.tactics?.length ? `<div class="ftl-tactics">${renderTactics(view)}</div>` : ''}
    ${view.retryBeat ? `<p role="alert">Fight progress was not saved.</p><button type="button" class="primary" data-act="encounter-advance" ${identity(view)}>Retry fight progress</button>` : ''}
  </section>`;
}
