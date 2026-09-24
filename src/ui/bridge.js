// @ts-nocheck
import { fuelStatus } from '../systems/fuel.js';
import { formatDuration } from '../shared/timer.js';
import { visibleNodes, nodesBySector, nodeMeta, typicalPayout } from '../data/sectors.js';
import { EXPEDITION_SKIP_GEMS, visiblePlanets, previewExpedition, planetById } from '../systems/expedition.js';
import { crewPower } from '../systems/combat.js';
import { storyProgress } from '../systems/story.js';
import { SHIPS, SHIP_SYSTEMS, SYSTEM_LABEL } from '../data/ships.js';
import { listOwnedHulls, nextUpgradeCost, canBuyHull } from '../systems/hangar.js';
import {
  currentTutorialStep,
  weekGoals,
  isFeatureUnlocked,
  unlockedTabs,
  hudChips,
  isTutorialActive,
  tutorialPhase,
} from '../systems/tutorial.js';
import { readyCrew, fightingCrew } from '../systems/player.js';
import { portraitFor, shipArtFor, SPACE_ART, ICONS, NODE_ART, planetArtFor, cinematicArtFor, SPLASH_ART } from '../data/portraits.js';
import { GACHA_COSTS, nextRepGate, CREW_CATALOG, defaultGacha, luckCreditCost, luckGemCost, PITY, LUCK_CAP, RESERVE_CAP } from '../systems/gacha.js';
import { passiveLabel, fuelCostFor } from '../systems/passives.js';
import { sheetFor } from './crewArt.js';
import { hullRepairOffer, formatReward, fuelCreditPrice, systemStat, visitMult, reputationRank } from '../systems/economy.js';
import { INTEL_TRACKS } from '../data/intel.js';
import { planetType } from '../data/planets.js';
import { ROOMS, SPARROW_LAYOUT } from '../data/starterShip.js';
import { medalLevelCostFor, rankTitle, rankUpCost } from '../data/crewRoster.js';
import { syncCrewLayer } from './crewWalk.js';
import { attachSpace } from './spaceFlight.js';
import { attachCombat, isBattlePlaying } from './combatView.js';
import { unlockSfx } from './juice.js';
import { startStageLoop } from './stageLoop.js';
import { contractShipSignals, renderDepartureStatus, renderRoomHotspot, renderShipFeedback, renderShipSequence } from './shipView.js';
import { renderShipDebug, shipDebugEnabled } from './shipDebug.js';
import { renderMissionSwitcher, renderContractBoard, renderContractReview, renderActiveContract, renderCombatOrders, renderAwayPicker, renderDailyPlan } from './contractView.js';
import { dailyPlan, ensureDailyLoop } from '../systems/dailyLoop.js';
import { makeCamera, focusCamera, resizeCamera, zoomAt } from './shipCamera.js';
import { createCameraController } from './shipCameraController.js';
import { artUrl } from '../shared/artUrl.js';

const NAV_ICO = {
  ship: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 18H4L12 3z"/><path d="M12 10v8"/></svg>',
  crew: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.4"/><path d="M4 19c.4-3 2.6-5 5-5s4.6 2 5 5"/><path d="M14 19c.2-2 1.6-3.4 3.4-3.6 1.6.2 2.8 1.4 3.2 3.6"/></svg>',
  missions: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/></svg>',
  shop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 11H6L5 8z"/><path d="M8 8V7a4 4 0 0 1 8 0v1"/></svg>',
  log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16H7z"/><path d="M10 8h4M10 12h4M10 16h3"/></svg>',
};

const NODE_KIND_ART = {
  station: 'c',
  trade: 'b',
  travel: 'd',
  danger: 'a',
  story: 'c',
  salvage: 'a',
};

export function renderApp(root, ctx) {
  if (!root || !ctx?.player) return;
  const priorDialog = root.querySelector('[role="dialog"]');
  const priorFocus = root.ownerDocument.activeElement;
  root._wcHandlers = ctx.handlers;
  if (!root.querySelector('.wc-shell') || !root.querySelector('[data-slot="coach"]')) {
    root._wcCameraController?.destroy();
    root._wcCameraResize?.disconnect();
    root._wcBound = false;
    root.innerHTML = buildShell();
  }
  bindOnce(root);
  patchShell(root, ctx);
  syncDialogFocus(root, priorDialog, priorFocus);
}

const dialogButtons = dialog => [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')];
const sameAction = (element, data) => data?.act && Object.entries(data).every(([key, value]) => element.dataset?.[key] === value);

export function syncDialogFocus(root, priorDialog, priorFocus) {
  const dialog = root.querySelector('[role="dialog"]');
  if (dialog && dialog !== priorDialog) {
    if (!priorDialog) root._wcDialogReturn = { ...priorFocus?.dataset };
    const controls = dialogButtons(dialog);
    const replacement = priorDialog && controls.find(element => sameAction(element, priorFocus?.dataset));
    (replacement || controls[0])?.focus();
  } else if (!dialog && priorDialog) {
    const trigger = [...root.querySelectorAll('[data-act]')].find(element => sameAction(element, root._wcDialogReturn));
    trigger?.focus();
    root._wcDialogReturn = null;
  } else if (!dialog && priorFocus?.isConnected === false && priorFocus?.dataset?.act) {
    // A second action render can replace the just-restored triggering card.
    // Preserve only its exact action identity; never redirect to another offer.
    const replacement = [...root.querySelectorAll('[data-act]')]
      .find(element => !element.disabled && sameAction(element, priorFocus.dataset));
    replacement?.focus();
  }
}

export function trapDialogKey(root, ev) {
  const dialog = root.querySelector('[role="dialog"]');
  if (!dialog || ev.key !== 'Tab') return;
  const controls = dialogButtons(dialog);
  if (!controls.length) return;
  const active = root.ownerDocument.activeElement;
  if (!dialog.contains(active) || (ev.shiftKey && active === controls[0]) || (!ev.shiftKey && active === controls.at(-1))) {
    ev.preventDefault();
    (ev.shiftKey ? controls.at(-1) : controls[0]).focus();
  }
}

function bindOnce(root) {
  if (root._wcBound) return;
  root._wcBound = true;
  root.addEventListener('keydown', ev => trapDialogKey(root, ev));
  startStageLoop();
  bindCamera(root);
  root.addEventListener('pointerdown', () => unlockSfx(), { once: true });
  root.addEventListener('click', (ev) => {
    const handlers = root._wcHandlers;
    if (!handlers) return;
    const cameraButton = ev.target.closest('[data-camera]');
    if (cameraButton && root.contains(cameraButton)) {
      const action = cameraButton.dataset.camera;
      if (action === 'focus') root._wcFocusRoom?.();
      else root._wcSetCamera?.(zoomAt(root._wcCamera, action === 'zoom-in' ? 1.25 : 0.8,
        { x: root._wcCamera.viewport.w / 2, y: root._wcCamera.viewport.h / 2 }));
      return;
    }
    const tabBtn = ev.target.closest('[data-tab]');
    if (tabBtn && root.contains(tabBtn)) {
      handlers.setTab(tabBtn.getAttribute('data-tab'));
      return;
    }
    const actBtn = ev.target.closest('[data-act]');
    if (actBtn && root.contains(actBtn)) {
      if (actBtn.classList.contains('hotspot') && root._wcBattleActive) return;
      if (actBtn.classList.contains('hotspot') && root._wcCamera.scale <= root._wcCamera.minScale * 1.1) {
        root._wcFocusRoom?.(actBtn.dataset.room);
        return;
      }
      handlers.onAction(actBtn.getAttribute('data-act'), { ...actBtn.dataset });
      return;
    }
    if (ev.target.classList && ev.target.classList.contains('modal-backdrop') && ev.target.querySelector('.dossier')) {
      handlers.onAction('close-crew');
      return;
    }
  });
}

function bindCamera(root) {
  const stage = root.querySelector('.stage');
  const fit = root.querySelector('.ship-fit');
  const hull = fit.querySelector('.sparrow-hull');
  hull.addEventListener('error', () => {
    if (!hull.dataset.fallback) {
      hull.dataset.fallback = '1';
      hull.src = artUrl('art/pixel/ships/sparrow-cutaway.jpg');
    } else {
      hull.style.display = 'none';
      fit.style.background = '#1b2941';
    }
  });
  const size = () => ({ w: stage.clientWidth || 390, h: stage.clientHeight || 620 });
  root._wcCamera = makeCamera(size(), { w: 1152, h: 1728 });
  root._wcSetCamera = camera => {
    root._wcCamera = camera;
    fit.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
  };
  const focus = (worldPoint, scale = root._wcCamera.maxScale) => {
    root._wcSetCamera(focusCamera(root._wcCamera, worldPoint, scale));
  };
  const roomAt = point => ROOMS.find(room => point.x >= room.left * 11.52
    && point.x <= (room.left + room.w) * 11.52
    && point.y >= room.top * 17.28 && point.y <= (room.top + room.h) * 17.28);
  root._wcFocusRoom = roomId => {
    const room = ROOMS.find(candidate => candidate.id === (roomId || root._wcSelectedRoom));
    focus(room ? { x: room.labelAnchor.x * 11.52, y: room.labelAnchor.y * 17.28 }
      : { x: 576, y: 864 });
  };
  root._wcCameraController = createCameraController({
    surface: stage,
    getCamera: () => root._wcCamera,
    setCamera: root._wcSetCamera,
    onTap: point => {
      if (root._wcBattleActive) return;
      const room = roomAt(point);
      if (!room) return;
      if (root._wcCamera.scale <= root._wcCamera.minScale * 1.1) root._wcFocusRoom(room.id);
      else root._wcHandlers?.onAction('select-room', { act: 'select-room', room: room.id });
    },
    onFocus: point => focus(point),
  });
  root._wcSetCamera(root._wcCamera);
  if (typeof ResizeObserver !== 'undefined') {
    root._wcCameraResize = new ResizeObserver(() => root._wcSetCamera(resizeCamera(root._wcCamera, size())));
    root._wcCameraResize.observe(stage);
  }
}

function buildShell() {
  const showShipDebug = shipDebugEnabled({
    dev: import.meta.env.DEV,
    search: window.location.search,
  });
  return `
    <div class="wc-shell tab-home">
      <div class="hud-bar" data-slot="hud"></div>
      <div class="stage">
        <div class="space-stage" aria-hidden="true">
          <canvas class="space-canvas" data-slot="space"></canvas>
        </div>
        <div class="stage-hud" data-slot="stage-hud"></div>
        <div data-slot="ship-sequence"></div>
        <div class="ship-fit">
          <img class="sparrow-hull" src="${SPACE_ART.hull}" alt="" />
          <div class="ship-feedback-layer" data-slot="ship-feedback"></div>
          <canvas class="crew-canvas" data-slot="crew"></canvas>
          <div class="hotspot-layer" data-slot="hotspots"></div>
          ${showShipDebug ? renderShipDebug(SPARROW_LAYOUT) : ''}
        </div>
        <canvas class="combat-canvas" data-slot="combat"></canvas>
        <div data-slot="overlays"></div>
      </div>
      <div class="detail-scroll" data-slot="detail"></div>
      <nav class="bottom-nav" data-slot="nav"></nav>
      <div data-slot="toast"></div>
      <div data-slot="departure-status"></div>
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
    combatOrders = null,
    contractReview = null,
    awayPicker = null,
    selectedRoom = null,
    selectedCrewId = null,
    cinematic = null,
    shopProducts = null,
    toast = null,
    departureInFlight = false,
    now = Date.now(),
  } = ctx;
  const fuel = fuelStatus(player, now);
  const locNode = visibleNodes(player, now).find((n) => n.id === player.location);
  const locName = locNode?.name || player.location;
  const hullPct = Math.max(0, Math.min(100, player.ship?.hull ?? 100));
  const shieldPct = Math.min(100, 60 + (player.ship.systems?.shields || 1) * 10);
  const step = currentTutorialStep(player);
  const phase = tutorialPhase(player);
  const goals = weekGoals(player);
  const expReady = Boolean(player.activeExpedition && player.activeExpedition.endAt <= now);
  const isHome = tab === 'ship';
  const chips = hudChips(player);
  const tabs = unlockedTabs(player);
  const fighting = isBattlePlaying();
  let coachStep = step && !step.modal ? step : null;
  if (coachStep && coachStep.act === 'goto-missions' && tab === 'missions') {
    coachStep = {
      ...coachStep,
      title: 'Dustfall',
      body: 'Launch.',
      cta: null,
      act: null,
      spotlight: 'exp-dustfall',
    };
  } else if (coachStep && coachStep.act === 'goto-crew' && tab === 'crew') {
    coachStep = {
      ...coachStep,
      title: 'Free hire',
      body: 'Fourth berth.',
      cta: null,
      act: null,
      spotlight: null,
    };
  }

  root.querySelector('.wc-shell')?.classList.toggle('tab-home', isHome);
  root._wcBattleActive = fighting;
  root._wcSelectedRoom = selectedRoom;
  root.querySelector('.wc-shell')?.classList.toggle('in-battle', fighting);
  root.querySelector('.wc-shell')?.setAttribute('data-phase', phase);
  root.querySelector('.bottom-nav')?.style.setProperty('--nav-cols', String(tabs.length));
  root.querySelector('.hud-bar')?.style.setProperty('--hud-cols', String(chips.length));

  setSlot(root, 'hud', renderHud(player, fuel, chips));
  setSlot(root, 'stage-hud', renderStageHud(locName, hullPct, shieldPct));
  setSlot(root, 'ship-sequence', renderShipSequence(ctx.shipSequence));
  setSlot(root, 'nav', renderNav(tab, player, expReady, tabs, coachStep));
  setSlot(root, 'modal', fighting ? '' : renderModals(player, { pendingCombat, combatOrders, contractReview, awayPicker, step, selectedCrewId, cinematic, confirmAbandon: ctx.confirmAbandon }));
  setSlot(root, 'hotspots', renderHotspots(player, fuel, expReady, selectedRoom));
  setSlot(root, 'ship-feedback', renderShipFeedback(contractShipSignals(player)));
  setSlot(root, 'overlays', fighting ? '' : renderOverlays(player, { step, selectedRoom, fuel, now, tab, isHome }));
  setSlot(root, 'toast', fighting ? '' : renderToast(toast));
  setSlot(root, 'departure-status', renderDepartureStatus(departureInFlight));
  const showCoach = coachStep && !step?.modal && !pendingCombat && !selectedRoom && !fighting
    && tab !== 'missions' && !cinematic && !selectedCrewId && player.flags?.splashSeen
    && (coachStep.cta || coachStep.body);
  setSlot(root, 'coach', showCoach ? renderSessionGuidance(player, now) : '');

  attachSpace(root.querySelector('[data-slot="space"]'), () => root._wcCamera, 77);
  attachCombat(root.querySelector('[data-slot="combat"]'), root.querySelector('.stage'),
    () => root._wcCamera, camera => root._wcSetCamera(camera));
  syncCrewLayer(root.querySelector('[data-slot="crew"]'), player);

  if (!isHome) {
    const detail = `${emptyHints(player, fuel, tab)}
          ${tab === 'missions' ? renderMissions(player, now, ctx) : ''}
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
      <div class="hud-chip premium">
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
  const filled = Math.max(0, Math.min(10, Math.round(hullPct / 10)));
  const pips = Array.from({ length: 10 }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('');
  return `
        <div class="meter-chip">
          <span class="lbl">HULL</span>
          <div class="hull-pips" aria-label="Hull ${hullPct}">${pips}</div>
          <span class="pct">${hullPct}</span>
        </div>
        <div class="loc-chip">${escapeHtml(locName)}</div>
        <div class="meter-chip ghost">
          <span class="lbl">SHLD</span>
          <div class="meter shield"><span style="width:${shieldPct}%"></span></div>
        </div>
        <div class="camera-controls" aria-label="Ship view controls">
          <button type="button" data-camera="focus" aria-label="Focus ship view">Focus</button>
          <button type="button" data-camera="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" data-camera="zoom-out" aria-label="Zoom out">−</button>
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

export function renderHotspots(player, fuel, expReady, selectedRoom) {
  const signals = contractShipSignals(player);
  return ROOMS.map((r) => {
    const pip = roomPip(r, player, fuel, expReady);
    const signal = r.id === 'operations' && signals.operationsActive
      ? 'route'
      : r.id === 'cargo' && signals.cargoReady ? 'return' : '';
    const sys = r.system ? player.ship?.systems?.[r.system] || 0 : null;
    return renderRoomHotspot({
      room: r,
      selected: selectedRoom === r.id,
      alert: pip,
      signal,
      level: sys,
    });
  }).join('');
}

function renderOverlays(player, { step, selectedRoom, fuel, now, tab, isHome }) {
  const def = SHIPS[player.ship?.shipId] || SHIPS.sparrow;
  const room = ROOMS.find((r) => r.id === selectedRoom);
  const showHangar = isFeatureUnlocked(player, 'hangar');
  return `
      ${!selectedRoom && showHangar ? `<button class="ship-chip" data-act="select-room" data-room="hangar">${escapeHtml(def.name)}</button>` : ''}
      ${isHome && !selectedRoom && !isTutorialActive(player) ? renderSessionGuidance(player, now) : ''}
      ${room ? renderRoomSheet(player, room, fuel, now) : ''}
      ${selectedRoom === 'hangar' && showHangar ? renderHangarSheet(player) : ''}
  `;
}

function renderCoach(step) {
  if (!step || step.modal) return '';
  const act = step.act || 'tutorial-go';
  return `
    <div class="coach" data-spot="${escapeHtml(step.spotlight || '')}">
      ${step.kicker ? `<span class="coach-kicker">${escapeHtml(step.kicker)}</span>` : ''}
      <b>${escapeHtml(step.title)}</b>
      ${step.body ? `<span class="coach-body">${escapeHtml(step.body)}</span>` : ''}
      ${step.cta ? `<button class="primary" data-act="${act}">${escapeHtml(step.cta)}</button>` : ''}
      ${step.act && !isTutorialCta(step) ? '<button data-act="orders-skip">Got it</button>' : ''}
    </div>`;
}

export function renderSessionGuidance(player, now = Date.now()) {
  return isTutorialActive(player) ? renderCoach(currentTutorialStep(player)) : renderDailyPlan(dailyPlan(player, now));
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

function renderModals(player, { pendingCombat, combatOrders, contractReview, awayPicker, step, selectedCrewId, cinematic, confirmAbandon }) {
  if (!player.flags?.splashSeen) return renderSplash();
  if (cinematic) return renderCinematic(cinematic);
  if (confirmAbandon) return `<div class="modal-backdrop contract-backdrop"><section class="contract-sheet" role="dialog" aria-modal="true" aria-label="Break contract"><h2>Break contract?</h2><p>No pending reward. Fuel already spent is not refunded.</p><button data-act="contract-abandon-confirm" data-revision="${escapeHtml(confirmAbandon.revision)}" data-acceptance-id="${escapeHtml(confirmAbandon.acceptanceId)}">Break contract</button><button data-act="contract-abandon-cancel">Keep contract</button></section></div>`;
  if (pendingCombat) {
    return renderCombatModal(combatOrders || { title: pendingCombat.encounter?.name, orders: [], canCancel: !isTutorialActive(player) });
  }
  if (contractReview) return renderContractReview(contractReview);
  if (awayPicker) return renderAwayPicker(awayPicker);
  if (selectedCrewId) return renderDossier(player, selectedCrewId);
  if (step?.modal === 'victory') return renderVictoryModal(player, step);
  if (step?.modal === 'recruit') return renderRecruitModal(player, step);
  return '';
}

function starsHtml(n = 1) {
  const s = Math.max(1, Math.min(5, n || 1));
  return `<span class="stars">${'★'.repeat(s)}${'☆'.repeat(5 - s)}</span>`;
}

function renderSplash() {
  return `
    <div class="modal-backdrop splash-backdrop">
      <div class="splash-card">
        <img src="${SPLASH_ART}" alt="Warp Crew" />
        <div class="splash-copy">
          <h2>Warp Crew</h2>
          <p>Your ship. Your crew.</p>
          <button class="primary" data-act="splash-dismiss">Launch</button>
        </div>
      </div>
    </div>`;
}

function renderCinematic(c) {
  const src = cinematicArtFor(c.art);
  return `
    <div class="modal-backdrop">
      <div class="modal panel cinematic-modal">
        <img class="cinematic-still" src="${src}" alt="" />
        <div class="coach-kicker">Story</div>
        <h2>${escapeHtml(c.title || 'Story')}</h2>
        <p class="muted">${escapeHtml(c.text || '')}</p>
        <button class="primary" data-act="cinematic-dismiss">Continue</button>
      </div>
    </div>`;
}

function renderDossier(player, id) {
  const c = (player.crew || []).find((x) => x.instanceId === id);
  if (!c) return '';
  const rankCost = rankUpCost(c);
  const lvlCost = medalLevelCostFor(c);
  const title = rankTitle(c.rank);
  const passive = passiveLabel(c.passive);
  return `
    <div class="modal-backdrop">
      <div class="modal panel dossier">
        <div class="sheet-head">
          <div class="recruit-card dossier-head">
            ${crewPortrait(c)}
            <div>
              <b>${escapeHtml(c.name)}</b>
              <div><span class="tag">${escapeHtml(c.role)}</span><span class="tag">${escapeHtml(c.rarity)}</span></div>
              ${starsHtml(c.stars)}
              <div class="muted">${escapeHtml(title)} · Lv ${c.level} · ${c.power}${passive ? ` · ${escapeHtml(passive)}` : ''}</div>
            </div>
          </div>
          <button class="icon-close" data-act="close-crew" aria-label="Close">×</button>
        </div>
        <div class="row" style="margin-top:10px;flex-direction:column">
          ${c.status !== 'expedition' ? `<button data-act="level-crew" data-id="${c.instanceId}">Level ${c.level + 1} · ${lvlCost} medals</button>` : ''}
          <button data-act="rank-up" data-id="${c.instanceId}">Rank up · ${rankCost.medals} med · ${rankCost.credits}cr</button>
          ${c.status !== 'expedition' && (player.crew || []).length > 1 ? `<button data-act="crew-bench" data-id="${c.instanceId}">Bench to reserve</button>` : ''}
        </div>
      </div>
    </div>`;
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
  if (room.id === 'engineering' && (player.ship?.hull ?? 100) < 70) return 'warn';
  if (room.id === 'engineering' && fuel.pendingWhole) return 'good';
  if (room.id === 'cargo' && (expReady || player.activeExpedition)) return expReady ? 'good' : 'cyan';
  return '';
}

function renderVictoryModal(player, step) {
  const r = player.tutorial?.lastRewards || { credits: 120, medals: 8, reputation: 4 };
  return `
    <div class="modal-backdrop">
      <div class="modal panel victory-modal">
        <h2>${escapeHtml(step.title)}</h2>
        <p class="muted">${escapeHtml(step.body)}</p>
        <div class="reward-row">
          <div class="stat">+${r.credits || 0} cr</div>
          <div class="stat">+${r.medals || 0} med</div>
          <div class="stat">+${r.reputation || 0} rep</div>
        </div>
        <button class="primary spot-glow" data-act="tutorial-draw" data-spot-target="draw-cta">${escapeHtml(step.cta)}</button>
      </div>
    </div>`;
}

function renderRecruitModal(player, step) {
  const rec = player.tutorial?.recruit;
  const name = rec?.name || 'Jen Park';
  const role = rec?.role || 'gunner';
  const src = portraitFor(rec?.templateId || 'merc_jen', role);
  const member = player.crew.find((c) => c.templateId === (rec?.templateId || 'merc_jen'));
  const sheet = member ? sheetFor(member.templateId, member.role) : null;
  const portrait = sheet
    ? `<div class="portrait idle-portrait recruit-art" style="background-image:url('${sheet.url}')"></div>`
    : `<img class="portrait recruit-art" src="${src}" alt="" width="96" height="96" />`;
  return `
    <div class="modal-backdrop">
      <div class="modal panel recruit-modal">
        <h2>${escapeHtml(step.title)}</h2>
        <div class="recruit-card">
          ${portrait}
          <div>
            <b>${escapeHtml(name)}</b>
            <div><span class="tag">${escapeHtml(role)}</span></div>
            <div class="muted">Crew ${player.crew.length}/${player.crewSlots}</div>
          </div>
        </div>
        <button class="primary" data-act="tutorial-draw">${escapeHtml(step.cta)}</button>
      </div>
    </div>`;
}

export function renderRoomSheet(player, room, fuel, now) {
  const assigned = room.role
    ? player.crew.find((x) => x.role === room.role && x.status !== 'expedition')
    : null;
  const sheet = assigned ? sheetFor(assigned.templateId, assigned.role) : null;
  const sys = room.system ? player.ship.systems?.[room.system] || 1 : null;
  const actions = roomActions(room, player);
  const sysLine = sys != null
    ? `Lv ${sys}${room.system ? ` · ${escapeHtml(systemStat(room.system, sys))}` : ''}`
    : assigned ? escapeHtml(assigned.role) : 'Empty';
  return `
    <div class="room-sheet" data-room-position="${room.labelAnchor.y >= 55 ? 'lower' : 'upper'}">
      <div class="sheet-head">
        <div>
          <h2>${escapeHtml(room.name)}</h2>
          <div class="muted">${sysLine}</div>
        </div>
        <button class="icon-close" data-act="close-room" aria-label="Close">×</button>
      </div>
      <div class="sheet-crew">
        ${sheet ? `<div class="portrait idle-portrait" style="background-image:url('${sheet.url}')"></div>` : '<div class="portrait"></div>'}
        <div>
          <b>${assigned ? escapeHtml(assigned.name) : 'Empty'}</b>
          <div class="muted">${assigned ? `Lv ${assigned.level}` : 'Unassigned'}</div>
        </div>
      </div>
      <div class="sheet-actions">${actions}</div>
    </div>`;
}

function fuelBuyButtons(player) {
  if (isTutorialActive(player)) return '';
  const fuel = player.wallet?.fuel || 0;
  const fuelMax = player.fuelMax || 10;
  const room = Math.max(0, fuelMax - fuel);
  if (!room) return '';
  const price = fuelCreditPrice(player);
  const n5 = Math.min(5, room);
  return `
    <button data-act="buy-fuel" data-n="1">Buy 1 fuel ${price}cr</button>
    ${n5 > 1 ? `<button data-act="buy-fuel" data-n="${n5}">Buy ${n5} fuel ${price * n5}cr</button>` : ''}`;
}

function roomActions(room, player) {
  const hangar = isFeatureUnlocked(player, 'hangar');
  const crewOpen = isFeatureUnlocked(player, 'nav_crew');
  const offer = hullRepairOffer(player);
  if (room.id === 'bridge') {
    return player.tutorial?.phase === 'distress'
      ? '<button class="primary" data-act="contract-review" data-offer="offer_tutorial_distress" data-spot-target="bridge-alert">Review distress contract</button>'
      : '<button class="primary" data-act="goto-contracts">Contracts</button>';
  }
  if (room.id === 'operations') {
    const sensors = nextUpgradeCost(player, 'sensors');
    const shields = nextUpgradeCost(player, 'shields');
    return `
      <button class="primary" data-act="goto-missions">Contracts</button>
      ${hangar && sensors ? `<button data-act="ship-upgrade" data-system="sensors">Sensors ${sensors.level} · ${sensors.credits}cr</button>` : ''}
      ${hangar && shields ? `<button data-act="ship-upgrade" data-system="shields">Shields ${shields.level} · ${shields.credits}cr</button>` : ''}`;
  }
  if (room.id === 'medbay') {
    const medbay = nextUpgradeCost(player, 'medbay');
    return `
      ${crewOpen ? '<button class="primary" data-act="goto-crew">Crew</button>' : '<button class="primary" data-act="goto-missions">Jump</button>'}
      ${hangar && medbay ? `<button data-act="ship-upgrade" data-system="medbay">Medbay ${medbay.level} · ${medbay.credits}cr</button>` : ''}`;
  }
  if (room.id === 'quarters') {
    const quarters = nextUpgradeCost(player, 'quarters');
    return `
      ${crewOpen ? '<button class="primary" data-act="goto-crew">Crew</button>' : '<button class="primary" data-act="goto-missions">Jump</button>'}
      ${hangar && quarters ? `<button data-act="ship-upgrade" data-system="quarters">Quarters ${quarters.level} · ${quarters.credits}cr</button>` : ''}`;
  }
  if (room.id === 'workshop') {
    const weapons = nextUpgradeCost(player, 'weapons');
    return `
      ${crewOpen ? '<button class="primary" data-act="goto-crew">Crew</button>' : ''}
      ${hangar && weapons ? `<button data-act="ship-upgrade" data-system="weapons">Weapons ${weapons.level} · ${weapons.credits}cr</button>` : ''}`;
  }
  if (room.id === 'cargo') {
    const contract = player.activeContract;
    if (contract?.stage === 'return') return `<p>${escapeHtml(contract.result.summary)}</p><p>${escapeHtml(formatReward(contract.result.rewards))}</p><button class="primary" data-act="contract-claim" data-revision="${escapeHtml(contract.revision)}" data-acceptance-id="${escapeHtml(contract.acceptanceId)}">Bring it aboard</button>`;
    const cg = nextUpgradeCost(player, 'cargo');
    return `
      <button class="primary" data-act="goto-away">Away teams</button>
      ${fuelBuyButtons(player)}
      ${hangar && cg ? `<button data-act="ship-upgrade" data-system="cargo">Cargo ${cg.level} · ${cg.credits}cr</button>` : ''}`;
  }
  if (room.id === 'mess') {
    return crewOpen
      ? '<button class="primary" data-act="goto-crew">Crew</button>'
      : '<button class="primary" data-act="goto-missions">Jump</button>';
  }
  if (room.id === 'stores') {
    return fuelBuyButtons(player) || '<button class="primary" data-act="goto-missions">Contracts</button>';
  }
  if (room.id === 'engineering') {
    const en = nextUpgradeCost(player, 'engines');
    return `
      <button class="primary" data-act="claim">Claim fuel</button>
      ${fuelBuyButtons(player)}
      ${offer ? `<button data-act="repair-hull">Repair ${offer.cost}cr (+${offer.amount}%)</button>` : ''}
      ${hangar && en ? `<button data-act="ship-upgrade" data-system="engines">Engines ${en.level} · ${en.credits}cr</button>` : ''}`;
  }
  if (room.system && hangar) {
    const up = nextUpgradeCost(player, room.system);
    return `
      <button class="primary" data-act="ship-upgrade" data-system="${room.system}">Upgrade${up ? ` ${up.credits}cr` : ''}</button>`;
  }
  if (room.role) {
    return crewOpen
      ? '<button class="primary" data-act="goto-crew">Crew</button>'
      : '<button class="primary" data-act="goto-missions">Jump</button>';
  }
  return '';
}

function renderHangarSheet(player) {
  const shipId = player.ship?.shipId || 'sparrow';
  const def = SHIPS[shipId] || SHIPS.sparrow;
  const sys = player.ship?.systems || {};
  return `
    <div class="room-sheet hangar-sheet">
      <div class="sheet-head">
        <div>
          <h2>${escapeHtml(def.name)}</h2>
          <div class="muted">Hull ${player.ship?.hull ?? 100}% · ${player.crewSlots} berths</div>
        </div>
        <button class="icon-close" data-act="close-room" aria-label="Close">×</button>
      </div>
      ${SHIP_SYSTEMS.map((id) => {
        const lv = sys[id] || 0;
        const up = nextUpgradeCost(player, id);
        const label = SYSTEM_LABEL[id] || id;
        return `
          <div class="sys-row">
            <div>
              <b>${escapeHtml(label)} ${lv}</b>
              <div class="muted">${escapeHtml(systemStat(id, lv))}</div>
            </div>
            ${up ? `<button data-act="ship-upgrade" data-system="${id}">${up.credits}cr</button>` : '<span class="muted">MAX</span>'}
          </div>`;
      }).join('')}
      <button class="primary" data-act="goto-shop">Hangar shop</button>
    </div>`;
}

function hullLockLabel(check, ship) {
  if (!check || check.ok) return '';
  if (check.reason === 'chapter_lock') return `Ch.${check.need}+`;
  if (check.reason === 'rep_lock') return `${check.need} rep`;
  if (check.reason === 'hull_lock') return `Need ${SHIPS[check.need]?.name || check.need}`;
  if (check.reason === 'owned') return '';
  return ship.id === 'sparrow' ? '' : '';
}

function emptyHints(player, fuel, tab) {
  const bits = [];
  if (fuel.current <= 0 && tab === 'missions') bits.push('No fuel.');
  if (readyCrew(player).length === 0 && tab === 'missions') bits.push('No ready crew.');
  if (player.crew.length < player.crewSlots && player.dailyPullAvailable && tab === 'crew') bits.push('Free hire.');
  if (!bits.length) return '';
  return `<div class="empty-hint">${bits.map(escapeHtml).join(' ')}</div>`;
}

export function renderCombatModal(model = {}) {
  return `<div class="modal-backdrop combat-backdrop contract-backdrop"><section class="contract-sheet" role="dialog" aria-modal="true" aria-label="Combat orders">
    ${renderCombatOrders(model)}
    ${model.canCancel ? '<button type="button" data-act="combat-cancel">Abort</button>' : ''}
  </section></div>`;
}

function renderNodeCard(n, player, here, step) {
  const hereCls = n.id === here ? 'here' : '';
  const spot = step?.spotlight === `node-${n.id}` ? 'spot-glow' : '';
  const cost = fuelCostFor(player, n.fuelCost ?? 1);
  const art = NODE_ART[NODE_KIND_ART[n.type] || 'd'];
  const meta = nodeMeta(n);
  const visits = player.stats?.visits?.[n.id] || 0;
  const hint = typicalPayout(n);
  const worn = visits >= 2 ? ' worn' : '';
  const decay = visits && visitMult(visits) < 1 ? ` · ${Math.round(visitMult(visits) * 100)}%` : '';
  return `
    <button class="map-node hazard-${meta.hazard}${worn} ${hereCls} ${spot}" data-act="travel-to" data-node="${n.id}"
      data-spot-target="node-${n.id}"
      ${n.id === here || player.activeContract ? 'disabled' : ''} ${player.activeContract ? 'aria-describedby="explore-contract-lock"' : ''}>
      <img class="node-thumb" src="${art}" alt="" />
      <span class="map-title">${escapeHtml(n.name)}</span>
      <span class="map-meta">${cost}F · ${escapeHtml(hint)}${decay}</span>
      <span class="map-jump">${n.id === here ? 'HERE' : 'JUMP'}</span>
    </button>
  `;
}

export function renderMissions(player, now, model = {}) {
  const view = ['contracts', 'away', 'explore'].includes(model.missionView) ? model.missionView : 'contracts';
  const switcher = renderMissionSwitcher(view);
  if (view === 'contracts') {
    const board = model.contractBoard || player.contractBoard || { offers: [] };
    const content = player.activeContract
      ? renderActiveContract(model.activeContractView || player.activeContract)
      : renderContractBoard({ ...board, offers: (board.offers || []).map((offer) => ({ ...offer, completed: offer.completed || (board.completedOfferIds || []).includes(offer.id) })) });
    return switcher + content;
  }
  const exp = player.activeExpedition;
  const here = player.location;
  const nodes = visibleNodes(player, now);
  const planets = visiblePlanets(player, now);
  const showExp = isFeatureUnlocked(player, 'expeditions');
  const step = currentTutorialStep(player);
  const tight = isTutorialActive(player) && !isFeatureUnlocked(player, 'map_extra');
  const teachDust = isTutorialActive(player);
  const planetList = teachDust ? planets.filter((p) => p.id === 'dustfall') : planets;
  const { spur, veil, ember, hollow, crown } = nodesBySector(nodes);

  const mapBlock = (title, list) => list.length ? `
    <div class="sector-kicker">${escapeHtml(title)}</div>
    <div class="map-grid">
      ${list.map((n) => renderNodeCard(n, player, here, step)).join('')}
    </div>` : '';

  const mapPanel = `
    <div class="panel">
      <h2>Explore</h2>
      ${player.activeContract ? '<p class="contract-consequence" id="explore-contract-lock">Finish or abandon the active contract first.</p>' : ''}
      ${nodes.length === 0 ? '<div class="empty-hint">No routes.</div>' : ''}
      ${tight ? `<div class="map-grid">${nodes.map((n) => renderNodeCard(n, player, here, step)).join('')}</div>`
        : mapBlock('Spur', spur)
          + mapBlock('Veil', veil)
          + mapBlock('Ember', ember)
          + mapBlock('Hollow', hollow)
          + mapBlock('Crown', crown)}
    </div>`;

  const expPanel = showExp ? `
    <div class="panel away-view">
      <h2>Away</h2>
      ${exp ? renderActiveExpedition(player, exp, now) : planetList.map((p) => renderPlanetCard(player, p, teachDust)).join('')}
    </div>` : '<section class="panel away-view"><h2>Away</h2><p>Continue your first contract to unlock expeditions.</p></section>';
  return switcher + (view === 'away' ? expPanel : mapPanel);
}

function renderActiveExpedition(player, exp, now) {
  const planet = planetById(exp.payload.planetId);
  const kind = planetType(planet);
  const names = (exp.payload.crewInstanceIds || [])
    .map((id) => player.crew.find((c) => c.instanceId === id)?.name)
    .filter(Boolean)
    .join(', ');
  return `
    <div class="mission-card" style="margin-top:10px;border-color:var(--cyan)">
      <img class="planet-art" src="${planetArtFor(kind.art)}" alt="" />
      <div>
        <b>ACTIVE · ${escapeHtml(planet.name)}</b>
        <div class="muted">${(exp.payload.successChance * 100) | 0}% · ${formatDuration(Math.max(0, exp.endAt - now))} left</div>
        <div class="muted">${escapeHtml(names || 'crew out')}</div>
      </div>
      <div class="row" style="flex-direction:column;gap:6px">
        <button data-act="exp-claim">Claim</button>
        <button class="primary" data-act="exp-skip">Skip ${EXPEDITION_SKIP_GEMS}g</button>
        <button class="danger" data-act="exp-abort">Extract</button>
      </div>
    </div>
  `;
}

function renderPlanetCard(player, p, teachDust) {
  const prev = previewExpedition(player, p.id);
  const kind = planetType(p);
  const win = formatReward(prev.win);
  const fail = formatReward(prev.fail);
  const mins = p.minutes || 15;
  return `
    <div class="mission-card ${teachDust && p.id === 'dustfall' ? 'spot-glow' : ''}">
      <img class="planet-art" src="${planetArtFor(kind.art)}" alt="" />
      <div>
        <b>${escapeHtml(p.name)}</b>
        <p>Preferred role: ${escapeHtml(p.prefRole || 'Any')}</p>
        <p>Recommended crew: ${(prev.chance * 100) | 0}% success · ${mins}m</p>
        <p>Success: ${escapeHtml(win)} · Failure: ${escapeHtml(fail)}</p>
        <p>Injury risk: crew may return injured on failure.</p>
      </div>
      <button class="primary" data-act="exp-choose" data-planet="${p.id}" data-spot-target="exp-${p.id}" ${prev.crew.length ? '' : 'disabled'}>Choose crew</button>
    </div>
  `;
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
  const now = Date.now();
  const g = { ...defaultGacha(), ...(player.gacha || {}) };
  const ownedIds = new Set([
    ...(player.crew || []).map((c) => c.templateId),
    ...(player.reserve || []).map((c) => c.templateId),
  ]);
  const board = CREW_CATALOG.filter((t) => t.hireCost && !ownedIds.has(t.id) && (t.rarity === 'common' || t.rarity === 'uncommon')).slice(0, 8);
  const pityRarePct = Math.min(100, ((g.pityRare || 0) / PITY.rareHard) * 100);
  const luckMaxed = (g.luck || 0) >= LUCK_CAP;
  const reserve = player.reserve || [];
  return `
    <div class="panel">
      <h2>Crew · ${player.crew.length}/${player.crewSlots}</h2>
      <div class="muted">Power ${crewPower(fightingCrew(player))}${open ? ` · ${open} open` : ''}</div>
      ${canHire ? `
        <div class="luck-meter">
          <div class="muted">Luck ${g.luck || 0}/${LUCK_CAP} · pity ${g.pityRare || 0}/${PITY.rareHard}</div>
          <div class="pity-bar"><span style="width:${pityRarePct}%"></span></div>
          <div class="row hire-row">
            <button data-act="buy-luck" data-currency="credits" ${luckMaxed ? 'disabled' : ''}>${luckMaxed ? 'Luck max' : `Luck +1 · ${luckCreditCost(g.luck)}cr`}</button>
            <button data-act="buy-luck" data-currency="gems" ${luckMaxed ? 'disabled' : ''}>${luckMaxed ? 'Luck max' : `Luck +1 · ${luckGemCost(g.luck)}g`}</button>
          </div>
        </div>
        <div class="row hire-row">
          <button class="primary ${teachHire && free ? 'spot-glow' : ''}" data-act="gacha">
            ${free ? 'Free hire' : 'Hire 500cr'}
          </button>
          ${free ? '' : `<button data-act="gacha-gems">Hire ${GACHA_COSTS.gems.gems}g</button>`}
          <button data-act="gacha-10">10-pull ${GACHA_COSTS.gems10.gems}g</button>
        </div>` : ''}
      ${player.crew.map((c) => {
        const cost = medalLevelCostFor(c);
        const hurt = c.status === 'injured' && (c.injuredUntil || 0) > now
          ? ` · down ${formatDuration(c.injuredUntil - now)}`
          : '';
        return `
        <div class="crew-card">
          ${crewPortrait(c)}
          <div class="crew-body">
            <div class="crew-top">
              <b>${escapeHtml(c.name)}</b>
              <span class="crew-power">${c.power}</span>
            </div>
            <div class="crew-meta">${escapeHtml(c.role)} · Lv ${c.level}${hurt}</div>
            <div>${starsHtml(c.stars)}</div>
            <div class="row crew-actions">
              <button class="ghost" data-act="select-crew" data-id="${c.instanceId}">Dossier</button>
              ${isFeatureUnlocked(player, 'gacha') && c.status !== 'expedition'
                ? `<button data-act="level-crew" data-id="${c.instanceId}">Lv ${c.level + 1} · ${cost} med</button>`
                : ''}
              ${isFeatureUnlocked(player, 'gacha') && c.status !== 'expedition' && player.crew.length > 1
                ? `<button class="ghost" data-act="crew-bench" data-id="${c.instanceId}">Bench</button>`
                : ''}
            </div>
          </div>
        </div>`;
      }).join('') || '<div class="empty-hint">No crew.</div>'}
    </div>
    ${canHire && reserve.length ? `
    <div class="panel">
      <h2>Reserve · ${reserve.length}/${RESERVE_CAP}</h2>
      ${reserve.map((c) => `
        <div class="crew-card">
          ${crewPortrait(c)}
          <div class="crew-body">
            <b>${escapeHtml(c.name)}</b>
            <span class="tag">${escapeHtml(c.role)}</span>
            <div>${starsHtml(c.stars)}</div>
            <div class="row" style="margin-top:6px">
              <button class="primary" data-act="reserve-call" data-id="${c.instanceId}" ${open ? '' : 'disabled'}>Call up</button>
              <button data-act="reserve-sell" data-id="${c.instanceId}">Sell</button>
            </div>
          </div>
        </div>`).join('')}
    </div>` : ''}
    ${canHire && board.length && open ? `
    <div class="panel">
      <h2>Hire</h2>
      ${board.map((t) => `
        <div class="crew-card">
          <img class="portrait" src="${portraitFor(t.id, t.role)}" alt="" width="52" height="52" />
          <div class="crew-body">
            <div class="crew-top">
              <b>${escapeHtml(t.name)}</b>
              <span class="crew-power">${t.hireCost.credits}cr</span>
            </div>
            <div class="crew-meta">${escapeHtml(t.role)}</div>
            <div class="row crew-actions">
              <button class="primary" data-act="contract-hire" data-id="${t.id}">Sign on</button>
            </div>
          </div>
        </div>`).join('')}
    </div>` : canHire && !open ? '<div class="muted" style="margin:8px 0 16px">Berths full. Bench someone to hire.</div>' : ''}
  `;
}

export function renderPlatformLoginEntry() {
  return `<button data-act="prompt-login" style="margin-top:8px">Optional Jest sign-in</button>`;
}

function renderShop(player, shopProducts) {
  const SKU_COPY = {
    wc_fuel_5: { name: 'Fuel ×5', blurb: 'Jump five times' },
    wc_gems_100: { name: '100 gems', blurb: 'One hire, or luck' },
    wc_gems_500: { name: '500 gems', blurb: '10-pull, leftover 100' },
    wc_starter: { name: 'Starter', blurb: '10 fuel · 150g · 30 med · 500cr' },
  };
  const bySku = Object.fromEntries((shopProducts || []).map((p) => [p.sku, p]));
  const products = Object.keys(SKU_COPY).map((sku) => {
    const remote = bySku[sku] || {};
    return {
      sku,
      ...remote,
      name: SKU_COPY[sku].name,
      blurb: SKU_COPY[sku].blurb,
    };
  });
  const owned = listOwnedHulls(player);
  const shipId = player.ship?.shipId || 'sparrow';
  const qa = typeof window !== 'undefined' && /(?:^|[?&])qa=1(?:&|$)/.test(window.location.search);
  return `
    <div class="panel">
      <h2>Hangar</h2>
      <div class="muted">Credits grind. Gems skip.</div>
      ${Object.values(SHIPS).map((s) => {
        const isOwned = owned.includes(s.id);
        const isActive = shipId === s.id;
        const check = isOwned || s.id === 'sparrow' ? { ok: true } : canBuyHull(player, s.id);
        const lock = hullLockLabel(check, s);
        const price = [
          s.gemPrice ? `${s.gemPrice}g` : '',
          s.creditPrice ? `${s.creditPrice}cr` : '',
        ].filter(Boolean).join(' · ');
        return `
        <div class="hull-row">
          <img class="ship-thumb-sm" src="${shipArtFor(s.id)}" alt="" />
          <div>
            <b>${escapeHtml(s.name)}${isActive ? ' · live' : ''}</b>
            <div class="muted">${s.crewSlots}–${s.maxCrewSlots}${price ? ` · ${price}` : ''}${lock ? ` · ${escapeHtml(lock)}` : ''}</div>
          </div>
          <div class="hull-buy">
            ${isActive ? '<span class="lock-pill">Active</span>' : isOwned
              ? `<button data-act="hull-switch" data-ship="${s.id}">Switch</button>`
              : s.id === 'sparrow' ? '<span class="lock-pill">Starter</span>' : check.ok ? `
                <button class="primary" data-act="hull-buy" data-ship="${s.id}" data-currency="gems">${s.gemPrice}g</button>
                <button data-act="hull-buy" data-ship="${s.id}" data-currency="credits">${s.creditPrice}cr</button>
              ` : `<span class="lock-pill">${escapeHtml(lock || 'Locked')}</span>`}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="panel">
      <h2>Fuel</h2>
      <div class="row">${fuelBuyButtons(player) || '<span class="muted">Tanks full.</span>'}</div>
    </div>
    <div class="panel">
      <h2>Buy</h2>
      <div class="muted">Real money. Gems skip the grind.</div>
      ${products.map((p) => `
        <div class="iap-row">
          <div>
            <b>${escapeHtml(p.name)}</b>
            <div class="muted">${escapeHtml(p.blurb)}</div>
          </div>
          <button class="primary" data-act="iap-buy" data-sku="${p.sku}">${p.price != null ? `$${p.price}` : 'Buy'}</button>
        </div>
      `).join('')}
      ${renderPlatformLoginEntry()}
      ${qa ? `
      <div class="row" style="margin-top:8px">
        <button data-act="qa-gems">QA +100 gems</button>
        <button data-act="qa-fuel">QA +5 Fuel</button>
      </div>
      <button class="danger" data-act="qa-reset" style="margin-top:8px">Reset save</button>` : ''}
    </div>
  `;
}

function renderLog(player, log, goals) {
  const prog = storyProgress(player);
  const goalsDone = goals.goals.filter((g) => g.done).length;
  const collected = new Set((player.crew || []).map((c) => c.templateId)).size;
  const rank = reputationRank(player.wallet.reputation || 0);
  return `
    <div class="panel"><h2>Daily plan · ${dailyPlan(player).completed}/3</h2>${['contract', 'improve', 'away'].map(id => `<p>${ensureDailyLoop(player).dailyLoop[id] ? '✓' : '○'} ${escapeHtml(id)}</p>`).join('')}</div>
    <div class="panel">
      <h2>Career</h2>
      <div class="muted">${escapeHtml(rank.label)} · Ch.${prog.chapter} · ${collected} mercs · ${goalsDone}/${goals.goals.length} week</div>
    </div>
    <div class="panel">
      <h2>Week</h2>
      ${goals.goals.map((g) => `
        <div class="week-row ${g.done ? 'done' : ''}">
          <span class="mark">${g.done ? '●' : '○'}</span>
          <span>${escapeHtml(g.label)}</span>
          <span class="prog">${escapeHtml(g.progress)}</span>
        </div>
      `).join('')}
    </div>
    <div class="panel">
      <h2>Story</h2>
      ${prog.beats.filter((b) => b.unlocked).slice(-6).map((b) => `
        <div class="week-row">
          <span class="mark">●</span>
          <span>${escapeHtml(b.title)}</span>
          <span class="prog">Ch.${b.chapter}</span>
        </div>
      `).join('') || '<div class="muted">Jump story nodes to log beats.</div>'}
    </div>
    <div class="panel">
      <h2>Later</h2>
      ${INTEL_TRACKS.slice(0, 4).map((t) => `
        <div class="week-row">
          <span class="mark">○</span>
          <span>${escapeHtml(t.title)}</span>
          <span class="prog">${escapeHtml(t.eta)}</span>
        </div>
      `).join('')}
    </div>
    <div class="panel">
      <h2>Log</h2>
      <div class="log">${(log || []).slice(-16).map(escapeHtml).join('\n') || '—'}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&' + 'amp;', '<': '&' + 'lt;', '>': '&' + 'gt;', '"': '&' + 'quot;', "'": '&#39;' }[ch])
  );
}
