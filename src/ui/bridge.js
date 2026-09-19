// @ts-nocheck
import { fuelStatus } from '../systems/fuel.js';
import { formatDuration } from '../shared/timer.js';
import { visibleNodes } from '../data/sectors.js';
import { PLANETS_V1, EXPEDITION_SKIP_GEMS, visiblePlanets } from '../systems/expedition.js';
import { ASSISTS, listAssists, crewPower } from '../systems/combat.js';
import { storyProgress } from '../systems/story.js';
import { SHIPS } from '../data/ships.js';
import { listOwnedHulls } from '../systems/hangar.js';
import {
  currentTutorialStep,
  weekGoals,
  isFeatureUnlocked,
  unlockedTabs,
  hudChips,
  isTutorialActive,
  tutorialPhase,
  ordersStep,
  sessionHint,
} from '../systems/tutorial.js';
import { readyCrew } from '../systems/player.js';
import { portraitFor, shipArtFor, SPACE_ART, SWARM_ART, ICONS, NODE_ART } from '../data/portraits.js';
import { GACHA_COSTS, nextRepGate, CREW_CATALOG } from '../systems/gacha.js';
import { passiveLabel, fuelCostFor } from '../systems/passives.js';
import { sheetFor } from './crewArt.js';
import { ROOMS } from '../data/starterShip.js';
import { syncCrewLayer } from './crewWalk.js';
import { attachSpace } from './spaceFlight.js';
import { attachCombat, isBattlePlaying } from './combatView.js';
import { unlockSfx } from './juice.js';
import { startStageLoop } from './stageLoop.js';

const PLANET_CLASS = {
  derelict_freighter: 'a',
  crystal_asteroid: 'b',
  ice_outpost: 'c',
  dustfall: 'd',
  tidefall_ruins: 'b',
  ledger_vault: 'c',
  swarm_husk: 'a',
  echo_shoal: 'b',
  amber_mine: 'c',
  signal_wreck: 'a',
  pirate_cache: 'd',
  aurora_ice: 'b',
};

const NAV_ICO = {
  ship: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 18H4L12 3z"/><path d="M12 10v8"/></svg>',
  crew: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.4"/><path d="M4 19c.4-3 2.6-5 5-5s4.6 2 5 5"/><path d="M14 19c.2-2 1.6-3.4 3.4-3.6 1.6.2 2.8 1.4 3.2 3.6"/></svg>',
  missions: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/></svg>',
  shop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 11H6L5 8z"/><path d="M8 8V7a4 4 0 0 1 8 0v1"/></svg>',
  log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16H7z"/><path d="M10 8h4M10 12h4M10 16h3"/></svg>',
};

export function renderApp(root, ctx) {
  if (!root || !ctx?.player) return;
  root._wcHandlers = ctx.handlers;
  if (!root.querySelector('.wc-shell') || !root.querySelector('[data-slot="coach"]')) {
    root._wcBound = false;
    root.innerHTML = buildShell();
  }
  bindOnce(root);
  patchShell(root, ctx);
}

function bindOnce(root) {
  if (root._wcBound) return;
  root._wcBound = true;
  startStageLoop();
  root.addEventListener('pointerdown', () => unlockSfx(), { once: true });
  root.addEventListener('click', (ev) => {
    const handlers = root._wcHandlers;
    if (!handlers) return;
    const tabBtn = ev.target.closest('[data-tab]');
    if (tabBtn && root.contains(tabBtn)) {
      handlers.setTab(tabBtn.getAttribute('data-tab'));
      return;
    }
    const actBtn = ev.target.closest('[data-act]');
    if (actBtn && root.contains(actBtn)) {
      handlers.onAction(actBtn.getAttribute('data-act'), { ...actBtn.dataset });
      return;
    }
    const assistBtn = ev.target.closest('[data-assist]');
    if (assistBtn && root.contains(assistBtn)) {
      handlers.toggleAssist(assistBtn.getAttribute('data-assist'));
    }
  });
}

function buildShell() {
  return `
    <div class="wc-shell tab-home">
      <div class="hud-bar" data-slot="hud"></div>
      <div class="stage">
        <div class="space-stage" aria-hidden="true">
          <canvas class="space-canvas" data-slot="space"></canvas>
        </div>
        <div class="stage-hud" data-slot="stage-hud"></div>
        <div class="ship-fit">
          <img class="sparrow-hull" src="${SPACE_ART.hull}" alt="" />
          <canvas class="crew-canvas" data-slot="crew"></canvas>
          <div class="hotspot-layer" data-slot="hotspots"></div>
        </div>
        <canvas class="combat-canvas" data-slot="combat"></canvas>
        <div data-slot="overlays"></div>
      </div>
      <div class="detail-scroll" data-slot="detail"></div>
      <nav class="bottom-nav" data-slot="nav"></nav>
      <div data-slot="toast"></div>
      <div data-slot="coach"></div>
      <div data-slot="modal"></div>
    </div>
  `;
}

function setSlot(root, name, html) {
  const el = root.querySelector(`[data-slot="${name}"]`);
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

function patchShell(root, ctx) {
  const {
    player,
    log,
    tab,
    pendingCombat = null,
    selectedAssists = [],
    selectedRoom = null,
    shopProducts = null,
    toast = null,
    now = Date.now(),
  } = ctx;
  const fuel = fuelStatus(player, now);
  const locNode = visibleNodes(player, now).find((n) => n.id === player.location);
  const locName = locNode?.name || player.location;
  const hullPct = Math.max(0, Math.min(100, player.ship?.hull ?? 100));
  const shieldPct = Math.min(100, 60 + (player.ship.systems?.shields || 1) * 10);
  const step = currentTutorialStep(player);
  const orders = ordersStep(player);
  const hint = sessionHint(player, { fuel, now });
  const phase = tutorialPhase(player);
  const goals = weekGoals(player);
  const expReady = Boolean(player.activeExpedition && player.activeExpedition.endAt <= now);
  const isHome = tab === 'ship';
  const chips = hudChips(player);
  const tabs = unlockedTabs(player);
  const fighting = isBattlePlaying();
  let coachStep = step && !step.modal ? step : orders;
  if (coachStep && coachStep.act === 'goto-missions' && tab === 'missions') {
    coachStep = {
      ...coachStep,
      title: 'Launch Dustfall',
      body: 'Short scrap run. Salvage lands when they return.',
      cta: null,
      act: null,
      spotlight: 'exp-dustfall',
    };
  } else if (coachStep && coachStep.act === 'goto-crew' && tab === 'crew') {
    coachStep = {
      ...coachStep,
      title: 'Free hire',
      body: 'Fill the fourth berth. Reputation weights the board.',
      cta: null,
      act: null,
      spotlight: null,
    };
  }

  root.querySelector('.wc-shell')?.classList.toggle('tab-home', isHome);
  root.querySelector('.wc-shell')?.classList.toggle('in-battle', fighting);
  root.querySelector('.wc-shell')?.setAttribute('data-phase', phase);
  root.querySelector('.bottom-nav')?.style.setProperty('--nav-cols', String(tabs.length));
  root.querySelector('.hud-bar')?.style.setProperty('--hud-cols', String(chips.length));

  setSlot(root, 'hud', renderHud(player, fuel, chips));
  setSlot(root, 'stage-hud', renderStageHud(locName, hullPct, shieldPct));
  setSlot(root, 'nav', renderNav(tab, player, expReady, tabs, coachStep));
  setSlot(root, 'modal', fighting ? '' : renderModals(player, { pendingCombat, selectedAssists, step }));
  setSlot(root, 'hotspots', renderHotspots(player, fuel, expReady, selectedRoom));
  setSlot(root, 'overlays', fighting ? '' : renderOverlays(player, { step, selectedRoom, fuel, now, tab, hint, isHome }));
  setSlot(root, 'toast', fighting ? '' : renderToast(toast));
  const showCoach = coachStep && !step?.modal && !pendingCombat && !selectedRoom && !fighting
    && (coachStep.cta || coachStep.body);
  setSlot(root, 'coach', showCoach ? renderCoach(coachStep) : '');

  attachSpace(root.querySelector('[data-slot="space"]'));
  attachCombat(root.querySelector('[data-slot="combat"]'), root.querySelector('.stage'));
  syncCrewLayer(root.querySelector('[data-slot="crew"]'), player);

  if (!isHome) {
    const detail = `${emptyHints(player, fuel, tab)}
          ${tab === 'missions' ? renderMissions(player, now) : ''}
          ${tab === 'crew' ? renderCrew(player) : ''}
          ${tab === 'shop' ? renderShop(player, shopProducts) : ''}
          ${tab === 'log' ? renderLog(player, log, goals) : ''}`;
    setSlot(root, 'detail', detail);
  }
}

function renderHud(player, fuel, chips) {
  const map = {
    fuel: `
      <button class="hud-chip ${fuel.pendingWhole ? 'has-claim' : ''}" data-act="claim">
        <img src="${ICONS.fuel}" alt="" />
        <b>${fuel.current}</b><span>/${fuel.max}</span>
        ${fuel.pendingWhole ? '<i class="claim-pip"></i>' : ''}
      </button>`,
    credits: `
      <div class="hud-chip">
        <img src="${ICONS.credits}" alt="" />
        <b>${player.wallet.credits}</b>
      </div>`,
    gems: `
      <div class="hud-chip">
        <img src="${ICONS.gems}" alt="" />
        <b>${player.wallet.gems}</b>
      </div>`,
    medals: `
      <div class="hud-chip">
        <img src="${ICONS.medals}" alt="" />
        <b>${player.wallet.medals}</b>
      </div>`,
  };
  const list = chips && chips.length ? chips : ['fuel', 'credits', 'gems', 'medals'];
  return list.map((id) => map[id] || '').join('');
}

function renderStageHud(locName, hullPct, shieldPct) {
  return `
        <div class="meter-chip">
          <span class="lbl">HULL</span>
          <div class="meter hull"><span style="width:${hullPct}%"></span></div>
          <span class="pct">${hullPct}</span>
        </div>
        <div class="loc-chip">${escapeHtml(locName)}</div>
        <div class="meter-chip">
          <span class="lbl">SHLD</span>
          <div class="meter shield"><span style="width:${shieldPct}%"></span></div>
          <span class="pct">${shieldPct}</span>
        </div>
  `;
}

function renderNav(tab, player, expReady, tabs, step) {
  const ids = tabs && tabs.length ? tabs : unlockedTabs(player);
  const labels = { ship: 'Ship', crew: 'Crew', missions: 'Missions', shop: 'Shop', log: 'Log' };
  const badge = {
    ship: false,
    crew: player.dailyPullAvailable && isFeatureUnlocked(player, 'gacha'),
    missions: expReady,
    shop: false,
    log: false,
  };
  return ids.map((id) => {
    const spot = step?.spotlight === `nav-${id}` ? 'spot-glow' : '';
    return navBtn(id, labels[id], tab, badge[id], spot);
  }).join('');
}

function renderHotspots(player, fuel, expReady, selectedRoom) {
  return ROOMS.map((r) => {
    const pip = roomPip(r, player, fuel, expReady);
    return `
              <button class="hotspot ${selectedRoom === r.id ? 'selected' : ''}"
                data-act="select-room" data-room="${r.id}"
                style="left:${r.left}%;top:${r.top}%;width:${r.w}%;height:${r.h}%"
                aria-label="${escapeHtml(r.name)}">
                ${pip ? `<span class="pip ${pip}"></span>` : ''}
              </button>`;
  }).join('');
}

function renderOverlays(player, { step, selectedRoom, fuel, now, tab, hint, isHome }) {
  const def = SHIPS[player.ship?.shipId] || SHIPS.sparrow;
  const room = ROOMS.find((r) => r.id === selectedRoom);
  const showHangar = isFeatureUnlocked(player, 'hangar');
  return `
      ${!selectedRoom && showHangar ? `<button class="ship-chip" data-act="select-room" data-room="hangar">${escapeHtml(def.name)}</button>` : ''}
      ${isHome && !selectedRoom && hint ? `<button class="next-chip" data-act="${hint.act}" ${hint.room ? `data-room="${hint.room}"` : ''}>${escapeHtml(hint.kicker)} · ${escapeHtml(hint.title)}</button>` : ''}
      ${room ? renderRoomSheet(player, room, fuel, now) : ''}
      ${selectedRoom === 'hangar' && showHangar ? renderHangarSheet(player) : ''}
  `;
}

function renderCoach(step) {
  if (!step || step.modal) return '';
  const act = step.act || 'tutorial-go';
  return `
    <div class="coach" data-spot="${escapeHtml(step.spotlight || '')}">
      <div class="coach-kicker">${escapeHtml(step.kicker || '')}</div>
      <h2>${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.body)}</p>
      ${step.cta ? `<button class="primary" data-act="${act}">${escapeHtml(step.cta)}</button>` : ''}
      ${step.act && !isTutorialCta(step) ? '<button data-act="orders-skip">Got it</button>' : ''}
    </div>`;
}

function isTutorialCta(step) {
  return !step.act || step.act === 'tutorial-go';
}

function renderToast(toast) {
  if (!toast) return '';
  const r = toast.rewards || {};
  const bits = [
    r.credits ? `+${r.credits} cr` : '',
    r.medals ? `+${r.medals} medals` : '',
    r.reputation ? `+${r.reputation} rep` : '',
    r.gems ? `+${r.gems} g` : '',
    r.fuel ? `+${r.fuel} fuel` : '',
  ].filter(Boolean);
  return `
    <div class="toast toast-slim reward-toast">
      <h2>${escapeHtml(toast.title)}</h2>
      ${bits.length ? `<span class="muted">${escapeHtml(bits.join(' · '))}</span>` : ''}
      <button class="icon-close" data-act="close-toast" aria-label="Dismiss">×</button>
    </div>`;
}

function renderModals(player, { pendingCombat, selectedAssists, step }) {
  if (pendingCombat) {
    return renderCombatModal(pendingCombat, selectedAssists, isTutorialActive(player));
  }
  if (step?.modal === 'victory') return renderVictoryModal(player, step);
  if (step?.modal === 'recruit') return renderRecruitModal(player, step);
  if (step?.modal === 'join') return renderJoinModal(player, step);
  return '';
}

function navBtn(id, label, tab, badge, extraClass = '') {
  return `
    <button data-tab="${id}" data-spot-target="nav-${id}" class="${tab === id ? 'active' : ''} ${extraClass}">
      ${NAV_ICO[id] || ''}
      <span>${label}</span>
      ${badge ? '<i class="nav-badge"></i>' : ''}
    </button>`;
}

function roomPip(room, player, fuel, expReady) {
  if (room.id === 'engines' && fuel.pendingWhole) return 'good';
  if (room.id === 'engineering' && (player.ship?.hull ?? 100) < 70) return 'warn';
  if (room.id === 'cargo' && (expReady || player.activeExpedition)) return expReady ? 'good' : 'cyan';
  return '';
}

function renderVictoryModal(player, step) {
  const r = player.tutorial?.lastRewards || { credits: 120, medals: 8, reputation: 4 };
  return `
    <div class="modal-backdrop">
      <div class="modal panel victory-modal">
        <div class="coach-kicker">${escapeHtml(step.kicker)}</div>
        <h2>${escapeHtml(step.title)}</h2>
        <p class="muted">${escapeHtml(step.body)}</p>
        <div class="reward-row">
          <div class="stat"><img class="stat-ico" src="${ICONS.credits}" alt="" /> Credits <b>+${r.credits || 0}</b></div>
          <div class="stat"><img class="stat-ico" src="${ICONS.medals}" alt="" /> Medals <b>+${r.medals || 0}</b></div>
          <div class="stat">Rep <b>+${r.reputation || 0}</b></div>
        </div>
        <button class="primary spot-glow" data-act="tutorial-draw" data-spot-target="draw-cta">${escapeHtml(step.cta)}</button>
      </div>
    </div>`;
}

function renderRecruitModal(player, step) {
  const rec = player.tutorial?.recruit;
  const name = rec?.name || 'Jen Park';
  const role = rec?.role || 'gunner';
  const blurb = rec?.blurb || 'Station security washout.';
  const src = portraitFor(rec?.templateId || 'merc_jen', role);
  const member = player.crew.find((c) => c.templateId === (rec?.templateId || 'merc_jen'));
  const sheet = member ? sheetFor(member.templateId, member.role) : null;
  const portrait = sheet
    ? `<div class="portrait idle-portrait recruit-art" style="background-image:url('${sheet.url}')"></div>`
    : `<img class="portrait recruit-art" src="${src}" alt="" width="96" height="96" />`;
  return `
    <div class="modal-backdrop">
      <div class="modal panel recruit-modal">
        <div class="coach-kicker">${escapeHtml(step.kicker)}</div>
        <h2>${escapeHtml(step.title)}</h2>
        <div class="recruit-card">
          ${portrait}
          <div>
            <b>${escapeHtml(name)}</b>
            <div><span class="tag">${escapeHtml(role)}</span><span class="tag">common</span></div>
            <p class="muted">${escapeHtml(blurb)}</p>
            <p class="muted">Crew ${player.crew.length}/${player.crewSlots}</p>
          </div>
        </div>
        <button class="primary" data-act="tutorial-to-join">${escapeHtml(step.cta)}</button>
      </div>
    </div>`;
}

function renderJoinModal(player, step) {
  const names = (player.crew || []).map((c) => c.name).slice(0, 3).join(', ');
  return `
    <div class="modal-backdrop">
      <div class="modal panel join-modal">
        <div class="coach-kicker">${escapeHtml(step.kicker)}</div>
        <h2>${escapeHtml(step.title)}</h2>
        <p>${escapeHtml(step.body)}</p>
        <p class="muted">${escapeHtml(names)} are waiting on a save.</p>
        <button class="primary" data-act="tutorial-join">${escapeHtml(step.cta)}</button>
        <button data-act="tutorial-skip-join">Play as guest</button>
      </div>
    </div>`;
}

function renderRoomSheet(player, room, fuel, now) {
  const assigned = room.role
    ? player.crew.find((x) => x.role === room.role && x.status !== 'expedition')
    : null;
  const sheet = assigned ? sheetFor(assigned.templateId, assigned.role) : null;
  const sys = room.system ? player.ship.systems?.[room.system] || 1 : null;
  const actions = roomActions(room, player);
  return `
    <div class="room-sheet">
      <div class="sheet-head">
        <div>
          <h2>${escapeHtml(room.name)}</h2>
          <div class="muted">${sys != null ? `System lv ${sys}` : assigned ? escapeHtml(assigned.role) : 'Unassigned'}</div>
        </div>
        <button class="icon-close" data-act="close-room" aria-label="Close">×</button>
      </div>
      <div class="sheet-crew">
        ${sheet ? `<div class="portrait idle-portrait" style="background-image:url('${sheet.url}')"></div>` : '<div class="portrait"></div>'}
        <div>
          <b>${assigned ? escapeHtml(assigned.name) : 'Empty'}</b>
          <div class="muted">${assigned ? `Lv ${assigned.level} · ${escapeHtml(assigned.status)}` : 'Tap Crew to assign later'}</div>
        </div>
      </div>
      <div class="sheet-actions">${actions}</div>
    </div>`;
}

function roomActions(room, player) {
  const hangar = isFeatureUnlocked(player, 'hangar');
  const crewOpen = isFeatureUnlocked(player, 'nav_crew');
  if (room.id === 'bridge') {
    return '<button class="primary" data-act="goto-missions">Open missions</button>';
  }
  if (room.id === 'engineering') {
    const hull = player.ship?.hull ?? 100;
    return `
      ${crewOpen ? '<button class="primary" data-act="goto-crew">Crew bay</button>' : '<button class="primary" data-act="goto-missions">Open missions</button>'}
      ${hull < 100 ? `<button data-act="repair-hull">Repair hull 35cr (${hull}%)</button>` : ''}
      ${hangar ? '<button data-act="ship-upgrade" data-system="shields">Upgrade shields</button>' : ''}`;
  }
  if (room.id === 'cargo') {
    return `
      <button class="primary" data-act="goto-missions">${hangar ? 'Expeditions' : 'Missions'}</button>
      ${hangar ? '<button data-act="ship-upgrade" data-system="cargo">Upgrade cargo</button>' : ''}`;
  }
  if (room.id === 'engines') {
    return `
      <button class="primary" data-act="claim">Claim fuel</button>
      ${hangar ? '<button data-act="ship-upgrade" data-system="engines">Upgrade engines</button>' : ''}`;
  }
  if (room.system && hangar) {
    return `<button class="primary" data-act="ship-upgrade" data-system="${room.system}">Upgrade ${escapeHtml(room.system)}</button>`;
  }
  if (room.role) {
    return crewOpen
      ? '<button class="primary" data-act="goto-crew">Open crew</button>'
      : '<button class="primary" data-act="goto-missions">Open missions</button>';
  }
  return '';
}

function renderHangarSheet(player) {
  const owned = listOwnedHulls(player);
  const shipId = player.ship?.shipId || 'sparrow';
  const sys = player.ship?.systems || {};
  return `
    <div class="room-sheet">
      <div class="sheet-head">
        <div>
          <h2>Hangar</h2>
          <div class="muted">Hull ${player.ship?.hull ?? 100}% · berths ${player.crewSlots}</div>
        </div>
        <button class="icon-close" data-act="close-room" aria-label="Close">×</button>
      </div>
      ${Object.values(SHIPS).map((s) => {
        const isOwned = owned.includes(s.id);
        const isActive = shipId === s.id;
        return `
          <div class="mission-card" style="margin-bottom:8px">
            <img class="ship-thumb" src="${shipArtFor(s.id)}" alt="" />
            <div>
              <b>${escapeHtml(s.name)}${isActive ? ' · ACTIVE' : isOwned ? ' · OWNED' : ''}</b>
              <div class="muted">Crew ${s.crewSlots}–${s.maxCrewSlots}</div>
            </div>
            ${isActive ? '<button disabled>Active</button>' : isOwned
              ? `<button data-act="hull-switch" data-ship="${s.id}">Switch</button>`
              : '<button data-act="goto-shop">Buy</button>'}
          </div>`;
      }).join('')}
      <div class="row" style="margin-top:8px">
        <button data-act="ship-upgrade" data-system="weapons">Weapons lv ${sys.weapons || 1}</button>
        <button data-act="ship-upgrade" data-system="quarters">Expand berth</button>
      </div>
    </div>`;
}

function emptyHints(player, fuel, tab) {
  const bits = [];
  if (fuel.current <= 0 && tab === 'missions') {
    bits.push('No fuel — wait for regen, Claim pending, or buy fuel in SHOP.');
  }
  if (readyCrew(player).length === 0 && tab === 'missions') {
    bits.push('No ready crew — wait for expedition return or hire on CREW.');
  }
  if (player.crew.length < player.crewSlots && player.dailyPullAvailable && tab === 'crew') {
    bits.push(`Free hire ready — fill ${player.crewSlots - player.crew.length} open slot(s).`);
  }
  if (!bits.length) return '';
  return `<div class="empty-hint">${bits.map(escapeHtml).join('<br/>')}</div>`;
}

function renderCombatModal(pending, selectedAssists, tutorial = false) {
  const assists = listAssists({ tutorial });
  const assistPower = selectedAssists.reduce((s, id) => s + (ASSISTS[id]?.power || 0), 0);
  const art = SPACE_ART.pirate || SWARM_ART;
  return `
    <div class="modal-backdrop">
      <div class="modal panel">
        <div class="combat-head">
          <img class="swarm-art" src="${art}" alt="" />
          <div>
            <h2>${tutorial ? 'First contact' : 'Combat'} · ${escapeHtml(pending.encounter.name)}</h2>
            <div class="muted">${escapeHtml(pending.node.name)} · fuel −${pending.fuelCost}</div>
          </div>
        </div>
        ${tutorial ? '<p class="muted">Shield Boost is primed. One tap to engage.</p>' : ''}
        <div class="stat-row" style="margin:10px 0">
          <div class="stat">Your power <b>${pending.playerPower}</b></div>
          <div class="stat">Enemy <b>${pending.encounter.power}</b></div>
          <div class="stat">Assists <b>+${assistPower}</b></div>
        </div>
        ${tutorial ? '' : '<div class="muted" style="margin-bottom:8px">Pick assists (free in v1)</div>'}
        <div class="row">
          ${assists.map((a) => `
            <button data-assist="${a.id}" class="${selectedAssists.includes(a.id) ? 'primary' : ''}">
              ${escapeHtml(a.name)} (+${a.power})
            </button>
          `).join('')}
        </div>
        <div class="row" style="margin-top:12px">
          <button class="primary spot-glow" data-act="combat-confirm" data-spot-target="combat-engage">Engage</button>
          ${tutorial ? '' : '<button data-act="combat-cancel">Abort jump</button>'}
        </div>
      </div>
    </div>
  `;
}

const NODE_KIND_ART = {
  station: 'c',
  trade: 'b',
  travel: 'd',
  danger: 'a',
  story: 'c',
  salvage: 'a',
};

function renderMissions(player, now) {
  const exp = player.activeExpedition;
  const here = player.location;
  const nodes = visibleNodes(player, now);
  const planets = visiblePlanets(player, now);
  const showExp = isFeatureUnlocked(player, 'expeditions');
  const step = currentTutorialStep(player);
  const tight = isTutorialActive(player) && !isFeatureUnlocked(player, 'map_extra');
  const teachDust = player.tutorial?.ordersBeat === 'exp';
  const planetList = teachDust ? planets.filter((p) => p.id === 'dustfall') : planets;

  const mapPanel = `
    <div class="panel">
      <h2>${tight ? 'First jump' : 'Star map'}</h2>
      <div class="muted">${tight ? 'One lane is open. Jump Dust Lane.' : 'Spend fuel. Trade, salvage, or fight. Assists on combat jumps.'}</div>
      ${nodes.length === 0 ? '<div class="empty-hint">No routes — something is wrong with map data.</div>' : ''}
      <div class="map-grid">
        ${nodes.map((n) => {
          const hereCls = n.id === here ? 'here' : '';
          const spot = step?.spotlight === `node-${n.id}` ? 'spot-glow' : '';
          const cost = fuelCostFor(player, n.fuelCost ?? 1);
          const art = NODE_ART[NODE_KIND_ART[n.type] || 'd'];
          return `
            <button class="map-node ${hereCls} ${spot}" data-act="travel-to" data-node="${n.id}"
              data-spot-target="node-${n.id}"
              ${n.id === here ? 'disabled' : ''}>
              <img class="node-thumb" src="${art}" alt="" />
              <span class="map-title">${escapeHtml(n.name)}</span>
              <span class="map-meta">${n.type} · ${cost}F${n.sector === 'veil' ? ' · Veil' : ''}</span>
              <span class="map-blurb">${escapeHtml(n.blurb || '')}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>`;
  const expPanel = showExp ? `
    <div class="panel">
      <h2>Expeditions</h2>
      <div class="muted">${teachDust ? 'Start with Dustfall — short scrap run.' : `Crew leaves the ship. ${EXPEDITION_SKIP_GEMS}g skip.`}</div>
      ${exp ? `
        <div class="mission-card" style="margin-top:10px;border-color:var(--cyan)">
          <img class="planet-art" src="${NODE_ART[PLANET_CLASS[exp.payload.planetId] || 'a']}" alt="" />
          <div>
            <b>ACTIVE · ${escapeHtml(planetName(exp.payload.planetId))}</b>
            <div class="muted">${(exp.payload.successChance * 100) | 0}% · ${formatDuration(Math.max(0, exp.endAt - now))} left</div>
          </div>
          <div class="row" style="flex-direction:column;gap:6px">
            <button data-act="exp-claim">Claim</button>
            <button class="primary" data-act="exp-skip">Skip ${EXPEDITION_SKIP_GEMS}g</button>
            <button class="danger" data-act="exp-abort">Extract</button>
          </div>
        </div>
      ` : planetList.map((p) => `
        <div class="mission-card ${teachDust && p.id === 'dustfall' ? 'spot-glow' : ''}">
          <img class="planet-art" src="${NODE_ART[PLANET_CLASS[p.id] || 'a']}" alt="" />
          <div>
            <b>${escapeHtml(p.name)}</b>
            <div class="muted">${escapeHtml(p.blurb)}</div>
            <div class="muted">Diff ${p.difficulty} · ${p.minutes}m</div>
          </div>
          <button class="primary" data-act="exp-start" data-planet="${p.id}" data-spot-target="exp-${p.id}">Launch</button>
        </div>
      `).join('')}
    </div>` : '';
  return teachDust ? expPanel + mapPanel : mapPanel + expPanel;
}

function planetName(id) {
  return PLANETS_V1.find((p) => p.id === id)?.name || id;
}

function crewPortrait(c) {
  const sheet = sheetFor(c.templateId, c.role);
  if (sheet) {
    return `<div class="portrait idle-portrait" style="background-image:url('${sheet.url}')"></div>`;
  }
  return `<img class="portrait" src="${portraitFor(c.templateId, c.role)}" alt="" width="64" height="64" />`;
}

function renderCrew(player) {
  const canHire = isFeatureUnlocked(player, 'gacha');
  const free = player.dailyPullAvailable;
  const open = Math.max(0, player.crewSlots - player.crew.length);
  const teachHire = player.tutorial?.ordersBeat === 'hire';
  return `
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h2>Crew Bay · ${player.crew.length}/${player.crewSlots}</h2>
      </div>
      <div class="muted">Power ${crewPower(readyCrew(player))} · Rep ${player.wallet.reputation || 0} · ${nextRepGate(player.wallet.reputation || 0).label}${open ? ` · ${open} open` : ''}</div>
      ${canHire ? `
        <div class="row hire-row">
          <button class="primary ${teachHire && free ? 'spot-glow' : ''}" data-act="gacha">
            ${free ? 'Free hire' : 'Hire 500cr'}
          </button>
          ${free ? '' : `<button data-act="gacha-gems">Hire ${GACHA_COSTS.gems.gems}g</button>`}
        </div>` : ''}
      ${player.crew.map((c) => `
        <div class="crew-card">
          ${crewPortrait(c)}
          <div class="crew-body">
            <b>${escapeHtml(c.name)}</b>
            <span class="tag">${escapeHtml(c.role)}</span>
            <span class="tag">${escapeHtml(c.rarity)}</span>
            <span class="tag">Lv ${c.level}</span>
            <span class="tag">${escapeHtml(c.status)}</span>
            <div class="muted">Power ${c.power} · ${escapeHtml(c.species)}${passiveLabel(c.passive) ? ` · ${escapeHtml(passiveLabel(c.passive))}` : ''}</div>
            <div class="muted">${escapeHtml(c.blurb || '')}</div>
            ${isFeatureUnlocked(player, 'gacha')
              ? `<button data-act="level-crew" data-id="${c.instanceId}">Level up (medals)</button>`
              : ''}
          </div>
        </div>
      `).join('') || '<div class="empty-hint">No crew — hire from the board.</div>'}
    </div>
  `;
}

function renderShop(player, shopProducts) {
  const products = shopProducts || [
    { sku: 'wc_fuel_5', name: 'Fuel Cell ×5', blurb: '+5 fuel' },
    { sku: 'wc_gems_100', name: 'Gem Pack 100', blurb: '+100 gems' },
    { sku: 'wc_gems_500', name: 'Gem Crate 500', blurb: '+500 gems' },
    { sku: 'wc_starter', name: 'Starter Pack', blurb: 'Fuel + gems + medals' },
  ];
  const planets = ['b', 'c', 'a', 'd'];
  const owned = listOwnedHulls(player);
  const shipId = player.ship?.shipId || 'sparrow';
  return `
    <div class="panel">
      <h2>Hangar</h2>
      <div class="muted">Larger hulls: credits (grind) or gems (fast).</div>
      ${Object.values(SHIPS).map((s) => {
        const isOwned = owned.includes(s.id);
        const isActive = shipId === s.id;
        return `
        <div class="mission-card">
          <img class="ship-thumb" src="${shipArtFor(s.id)}" alt="" />
          <div>
            <b>${escapeHtml(s.name)}${isActive ? ' · ACTIVE' : isOwned ? ' · OWNED' : ''}</b>
            <div class="muted">${escapeHtml(s.blurb)}</div>
            <div class="muted">Crew ${s.crewSlots}–${s.maxCrewSlots}
              ${s.gemPrice ? ` · ${s.gemPrice}g` : ''}
              ${s.creditPrice ? ` · ${s.creditPrice}cr` : ''}
              ${s.lockedUntilChapter ? ` · Ch.${s.lockedUntilChapter}+` : ''}
            </div>
          </div>
          <div class="row" style="flex-direction:column;gap:4px">
            ${isActive ? '<button disabled>Active</button>' : isOwned
              ? `<button data-act="hull-switch" data-ship="${s.id}">Switch</button>`
              : s.id === 'sparrow' ? '<button disabled>Starter</button>' : `
                <button class="primary" data-act="hull-buy" data-ship="${s.id}" data-currency="gems">Gems</button>
                <button data-act="hull-buy" data-ship="${s.id}" data-currency="credits">Credits</button>
              `}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="panel">
      <h2>Shop</h2>
      <div class="muted">Sandbox IAP for QA. Real Jest payments later.</div>
      ${products.map((p, i) => `
        <div class="mission-card">
          <img class="planet-art" src="${NODE_ART[planets[i % planets.length]]}" alt="" />
          <div>
            <b>${escapeHtml(p.name)}</b>
            <div class="muted">${escapeHtml(p.blurb || p.remoteName || p.sku)}</div>
            <div class="muted">${p.price != null ? `${p.price} ${p.currency || 'USD'}` : 'sandbox'}</div>
          </div>
          <button class="primary" data-act="iap-buy" data-sku="${p.sku}">Buy</button>
        </div>
      `).join('')}
      <div class="row" style="margin-top:8px">
        <button data-act="prompt-login">Register / Login</button>
        <button data-act="qa-gems">QA +100 gems</button>
        <button data-act="qa-fuel">QA +5 Fuel</button>
      </div>
      <button class="danger" data-act="qa-reset" style="margin-top:8px">Reset save</button>
    </div>
  `;
}

function renderLog(player, log, goals) {
  const prog = storyProgress(player);
  const goalsDone = goals.goals.filter((g) => g.done).length;
  const nextGoal = goals.goals.find((g) => !g.done);
  const collected = new Set((player.crew || []).map((c) => c.templateId)).size;
  const gate = nextRepGate(player.wallet.reputation || 0);
  const power = crewPower(readyCrew(player));
  return `
    <div class="panel">
      <h2>Career</h2>
      <div class="muted">Streak ${player.loginStreak || 0} · Hull ${player.ship?.hull ?? 100}% · Power ${power}</div>
      <div class="muted">Collection ${collected}/${CREW_CATALOG.length} · ${escapeHtml(gate.label)}</div>
    </div>
    <div class="panel">
      <h2>Week goals · Day ${goals.careerDay}</h2>
      <div class="muted">${goalsDone}/${goals.goals.length} complete${nextGoal ? ` · next: ${escapeHtml(nextGoal.label)}` : ''}</div>
      ${goals.goals.map((g) => `
        <div class="crew-card ${g.done ? 'goal-done' : ''}">
          <b>${g.done ? '✓' : '○'} ${escapeHtml(g.label)}</b>
          <span class="tag">${escapeHtml(g.progress)}</span>
        </div>
      `).join('')}
    </div>
    <div class="panel">
      <h2>Story · Eclipse Swarm</h2>
      <div class="muted">Chapter ${prog.chapter} · ${prog.done}/${prog.total} beats</div>
      ${prog.beats.map((b) => `
        <div class="crew-card">
          <b>${b.unlocked ? '✓' : '○'} ${escapeHtml(b.title)}</b>
          <span class="tag">Ch.${b.chapter}</span>
          <div class="muted">${b.unlocked ? escapeHtml(b.text) : '???'}</div>
        </div>
      `).join('')}
    </div>
    <div class="panel">
      <h2>Captain's Log</h2>
      <div class="log">${(log || []).slice(-24).map(escapeHtml).join('\n') || 'No entries.'}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
