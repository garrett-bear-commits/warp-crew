// @ts-nocheck
import { fuelStatus } from '../systems/fuel.js';
import { formatDuration } from '../shared/timer.js';
import { visibleNodes, nodesBySector, nodeMeta, typicalPayout } from '../data/sectors.js';
import { EXPEDITION_SKIP_GEMS, visiblePlanets, previewExpedition, planetById } from '../systems/expedition.js';
import { crewPower } from '../systems/combat.js';
import { storyProgress } from '../systems/story.js';
import { SHIPS, SHIP_SYSTEMS, SYSTEM_LABEL } from '../data/ships.js';
import { listOwnedHulls, nextUpgradeCost, canBuyHull, buildMinutesFor, buildSkipGems } from '../systems/hangar.js';
import {
  currentTutorialStep,
  weekGoals,
  isFeatureUnlocked,
  unlockedTabs,
  hudChips,
  isTutorialActive,
  tutorialPhase,
  missionViews,
} from '../systems/tutorial.js';
import { readyCrew, fightingCrew } from '../systems/player.js';
import { normalizeAssignments, previewStationAssignment, stationOutputs, STATIONS } from '../systems/stations.js';
import { portraitFor, shipArtFor, SPACE_ART, ICONS, NODE_ART, planetArtFor, cinematicArtFor, SPLASH_ART } from '../data/portraits.js';
import { GACHA_COSTS, nextRepGate, CREW_CATALOG, defaultGacha, luckCreditCost, luckGemCost, PITY, LUCK_CAP, RESERVE_CAP, hireOdds, ascensionStatus } from '../systems/gacha.js';
import { currentBanner, MARK_COST } from '../data/banners.js';
import { FAMILIES, familyOf, familyCounts } from '../data/families.js';
import { passiveLabel, fuelCostFor } from '../systems/passives.js';
import { sheetFor } from './crewArt.js';
import { hullRepairOffer, formatReward, fuelCreditPrice, systemStat, visitMult, reputationRank } from '../systems/economy.js';
import { planetType } from '../data/planets.js';
import { ROOMS, SPARROW_LAYOUT, HULL_PX, roomWorldPoint, canonicalRoomId } from '../data/starterShip.js';
import { medalLevelCostFor, rankTitle, rankUpCost, STARTER_CAPTAINS, catalogById, RARITY, levelCap, ASCENSION } from '../data/crewRoster.js';
import { kitFor, describeKit } from '../data/crewKits.js';
import { syncCrewLayer, crewAgentAt } from './crewWalk.js';
import { bindFtlCrewDrag } from './ftlCrewDrag.js';
import { attachSpace } from './spaceFlight.js';
import { attachCombat, isBattlePlaying, setEncounterSnapshot } from './combatView.js';
import { renderRewardReveal } from './rewardReveal.js';
import { unlockSfx } from './juice.js';
import { isSfxMuted } from './sound.js';
import { isMusicMuted } from './music.js';
import { startStageLoop } from './stageLoop.js';
import { contractShipSignals, renderDepartureStatus, renderRoomHotspot, renderShipFeedback, renderShipSequence, roomStyle } from './shipView.js';
import { renderShipDebug, shipDebugEnabled } from './shipDebug.js';
import { WEAPON_CATALOG } from '../systems/ftlCombat.js';
import { WEAPON_PRICES, WEAPON_BLURBS, ownedWeapons, shipLoadout, weaponSlots } from '../systems/armory.js';
import { renderFtlEnemy, renderFtlShipMarkers } from './ftlView.js';
import { morphInto } from './morph.js';
import { renderMissionSwitcher, renderContractBoard, renderContractReview, renderActiveContract, renderShipEncounter, renderCombatOrders, renderAwayPicker, renderDailyPlan } from './contractView.js';
import { dailyPlan, ensureDailyLoop, MILESTONES as DAILY_MILESTONES } from '../systems/dailyLoop.js';
import { makeCamera, focusCamera, resizeCamera, zoomAt, pan, project, unproject } from './shipCamera.js';
import { createCameraController } from './shipCameraController.js';
import { artUrl } from '../shared/artUrl.js';
import { starterOfferState, starterValue, wallPackState, packValue, gemLadderValues } from '../systems/offers.js';
import { productArt } from './rewardReveal.js';
import { achievementProgress, claimableAchievements, ACHIEVEMENT_TRACKS } from '../systems/achievements.js';
import { calendarState, CALENDAR_REWARDS, CALENDAR_MILESTONES, CALENDAR_LENGTH } from '../systems/calendar.js';
import { idleHaul, formatHoldSpan, holdPercent } from '../systems/idle.js';
import { chestState, chestOdds } from '../systems/chests.js';
import { COMMISSION, commissionActive, priceCents, usableTerms } from '../systems/subscription.js';
import { currentWall } from '../systems/walls.js';
import { PRODUCT_DEFS, GEM_LADDER } from '../systems/iap.js';
import { FUEL_REFILL } from '../systems/gemSinks.js';
import { trustedNow } from '../shared/time.js';
import { renderStatusPanel, renderObjectiveHead, renderCrewRail, renderCommandBar, pixelIcon } from './hudView.js';
import { renderSectorMap } from './sectorMapView.js';
import { renderEventCard, renderEventResult, renderRouteEvent } from './eventView.js';
import { sectorMapModel } from '../systems/sectorMap.js';
import { exploreNudges } from '../systems/exploreNudge.js';

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
  if (!root.querySelector('.wc-shell') || !root.querySelector('[data-slot="coach"]') || !root.querySelector('[data-slot="fight-top"]')) {
    root._wcCameraController?.destroy();
    root._wcCameraResize?.disconnect();
    root._wcBound = false;
    root.innerHTML = buildShell();
  }
  bindOnce(root, ctx);
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

function bindOnce(root, ctx) {
  if (root._wcBound) return;
  root._wcBound = true;
  root.addEventListener('keydown', ev => trapDialogKey(root, ev));
  startStageLoop();
  bindCamera(root, ctx);
  bindCrewDrag(root);
  root.addEventListener('pointerdown', () => unlockSfx(), { once: true });
  root.addEventListener('click', (ev) => {
    const handlers = root._wcHandlers;
    if (!handlers) return;
    if (isGuidedSpotlightBlocked(root._wcPlayer, ev.target.closest('[data-act]')?.dataset.act)) {
      ev.preventDefault();
      return;
    }
    const cameraButton = ev.target.closest('[data-camera]');
    if (cameraButton && root.contains(cameraButton)) {
      const action = cameraButton.dataset.camera;
      if (action === 'ftl-focus') {
        // Pan (without zooming) so an off-screen room under fire is in view.
        const room = ROOMS.find(candidate => candidate.id === cameraButton.dataset.room);
        if (room) root._wcSetCamera(focusCamera(root._wcCamera, roomWorldPoint(room), root._wcCamera.scale));
        cameraButton.remove();
        return;
      }
      if (action === 'ftl-zoom') {
        root._wcFtlWhole = !root._wcFtlWhole;
        const stage = root.querySelector('.stage');
        const whole = root._wcFtlWhole;
        const fitFight = viewport => fightCamera(viewport, { whole });
        root._wcSetCamera(fitFight({ w: stage.clientWidth, h: stage.clientHeight }), fitFight);
        root.querySelector('.wc-shell')?.classList.toggle('ftl-whole', root._wcFtlWhole);
        return;
      }
      if (action === 'toggle') {
        root._wcCameraOpen = !root._wcCameraOpen;
        root.querySelector('.camera-controls')?.classList.toggle('is-open', root._wcCameraOpen);
        cameraButton.setAttribute('aria-expanded', String(root._wcCameraOpen));
        return;
      }
      if (action === 'focus') root._wcFocusRoom?.();
      else {
        const before = root._wcCamera.scale;
        root._wcSetCamera?.(zoomAt(root._wcCamera, action === 'zoom-in' ? 1.25 : 0.8,
          { x: root._wcCamera.viewport.w / 2, y: root._wcCamera.viewport.h / 2 }));
        if (Math.abs(root._wcCamera.scale - before) > 0.005) markCameraPractice(root, 'zoom');
      }
      return;
    }
    const captainOption = ev.target.closest('[data-captain-option]');
    if (captainOption && root.contains(captainOption)) {
      for (const option of root.querySelectorAll('[data-captain-option]')) option.setAttribute('aria-pressed', String(option === captainOption));
      root._wcCaptainChoice = captainOption.dataset.captainOption;
      return;
    }
    if (ev.target.closest('[data-act="camera-cue-dismiss"]')) {
      dismissCameraCue(root);
      return;
    }
    if (ev.target.closest('[data-act="captain-inspect"]')) {
      root._wcCaptainCardOpen = true;
      dismissCameraCue(root);
      root.querySelector('[data-slot="overlays"]')?.insertAdjacentHTML('beforeend', renderCaptainInspect(root._wcPlayer));
      return;
    }
    if (ev.target.closest('[data-act="captain-inspect-close"]')) {
      root._wcCaptainCardOpen = false;
      root.querySelector('.captain-inspect-card')?.remove();
      return;
    }
    const tabBtn = ev.target.closest('[data-tab]');
    if (tabBtn && root.contains(tabBtn)) {
      if (tabBtn.dataset.tab === 'crew' && root._wcAttentionKey) {
        try { window.sessionStorage.setItem(root._wcAttentionKey, '1'); } catch { /* storage can be unavailable */ }
      }
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
      const action = actBtn.getAttribute('data-act');
      if (action === 'station-assign' && actBtn.classList.contains('guided-station')) {
        const intent = guidedStationTap(root._wcPlayer, actBtn.dataset.room, root._wcCamera.scale, root._wcCamera.minScale);
        if (!intent) return;
        if (intent.kind === 'focus') { root._wcFocusRoom?.(intent.room); return; }
      }
      handlers.onAction(action, action === 'captain-choose'
        ? { ...actBtn.dataset, templateId: root._wcCaptainChoice || STARTER_CAPTAINS[0], name: root.querySelector('[data-captain-name]')?.value ?? '' }
        : action === 'tutorial-name'
        ? { ...actBtn.dataset, name: root.querySelector('[data-ship-name]')?.value ?? '' }
        : { ...actBtn.dataset });
      return;
    }
    if (ev.target.classList && ev.target.classList.contains('modal-backdrop') && ev.target.querySelector('.dossier')) {
      handlers.onAction('close-crew');
      return;
    }
  });
}

/** Whole-ship home view, clear of the top status panels. */
export function homeCamera(viewport) {
  const world = HULL_PX;
  const top = 92; // below the status and objective panels (they end ~84 px into the stage)
  const bottom = 20; // engine bells stay above the command bar
  const band = { w: viewport.w, h: Math.max(80, viewport.h - top - bottom) };
  const scale = Math.min(band.w / world.w, band.h / world.h);
  // Fit the ship in the band under the panels. (Framed in the full viewport,
  // the clamp would re-centre a ship that fits and slide it under the panels.)
  const framed = makeCamera(band, world, { x: world.w / 2, y: world.h / 2 }, scale);
  return { ...framed, y: framed.y + top, viewport: { w: viewport.w, h: viewport.h } };
}

/**
 * FTL-lite fights open zoomed in: the Sparrow fills the width (taller than the
 * view, drag to look around). `whole` fits the entire ship between the panels.
 */
/**
 * Zoomed in, some rooms are out of view. When an enemy gun is charging (50%+) at one of
 * them, a chip at the top or bottom edge says where; tapping it pans there.
 */
export function renderOffscreenThreats(root, encounter) {
  const camera = root?._wcCamera;
  if (!camera || !encounter?.ftl || encounter.result || encounter.downed) return '';
  const seen = new Set();
  return encounter.enemy.weapons.filter(weapon => weapon.chargePct >= 50).map(weapon => {
    const roomId = encounter.rooms[weapon.target]?.roomId;
    const room = ROOMS.find(candidate => candidate.id === roomId);
    if (!room || seen.has(room.id)) return '';
    seen.add(room.id);
    const y = project(camera, roomWorldPoint(room)).y;
    const edge = y < 24 ? 'top' : y > camera.viewport.h - 24 ? 'bottom' : null;
    if (!edge) return '';
    return `<button type="button" class="ftl-offscreen is-${edge}" data-camera="ftl-focus" data-room="${escapeHtml(room.id)}" aria-label="Incoming fire at ${escapeHtml(room.label)}. Show it">${edge === 'top' ? '▲' : '▼'} Incoming · ${escapeHtml(room.label)}</button>`;
  }).join('');
}

export function fightCamera(viewport, { whole = false } = {}) {
  const world = HULL_PX;
  const fit = Math.min(viewport.w / world.w, Math.max(80, viewport.h - 12) / world.h);
  const scale = whole ? fit : Math.max(fit, viewport.w / (world.w * FIGHT_SPAN));
  // Zoomed in, the view starts at the Bridge and runs down the decks (drag for
  // Engineering); if the whole deck stack fits, centre on it instead.
  const decksTop = world.h * (DECKS_TOP - 0.015);
  const focusY = whole ? world.h / 2 : Math.min(world.h * DECKS_MID, decksTop + viewport.h / 2 / scale);
  return makeCamera(viewport, world, { x: world.w / 2, y: focusY }, scale);
}

// Zoomed-in fights show the hull from just outside the airlock hatch to the
// same margin on starboard, so every room and the airlock stay in view.
const FIGHT_SPAN = 1 - 2 * Math.max(0, SPARROW_LAYOUT.anchors.airlock.x - 4) / 100;
const DECKS_TOP = Math.min(...ROOMS.map(room => room.top)) / 100;
const DECKS_MID = (DECKS_TOP * 100 + Math.max(...ROOMS.map(room => room.top + room.h))) / 200;

export function initialSessionCamera(viewport) {
  const camera = makeCamera(viewport, HULL_PX);
  const focused = focusCamera(camera, roomWorldPoint('bridge'), camera.maxScale * 0.8);
  return pan(focused, 0, -viewport.h * 0.2);
}

function bindCamera(root, ctx) {
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
  const initialFit = [4, 5].includes(ctx?.player?.tutorial?.script) && !ctx.player.tutorial.completed
    ? initialSessionCamera : homeCamera;
  root._wcCamera = initialFit(size());
  root._wcCameraFit = initialFit;
  // `fitFor` re-frames an authored view (home, fight) when the stage resizes;
  // gestures and focus pass none, so a resize keeps what the player chose.
  root._wcSetCamera = (camera, fitFor = null) => {
    root._wcCamera = camera;
    root._wcCameraFit = fitFor;
    fit.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    fit.style.setProperty('--camera-scale', camera.scale);
  };
  const focus = (worldPoint, scale = root._wcCamera.maxScale) => {
    root._wcSetCamera(focusCamera(root._wcCamera, worldPoint, scale));
  };
  const roomAt = point => {
    const x = point.x / HULL_PX.w * 100;
    const y = point.y / HULL_PX.h * 100;
    return ROOMS.find(room => x >= room.left && x <= room.left + room.w && y >= room.top && y <= room.top + room.h);
  };
  root._wcFocusRoom = roomId => {
    const id = canonicalRoomId(roomId || root._wcSelectedRoom);
    const room = ROOMS.find(candidate => candidate.id === id);
    focus(room ? roomWorldPoint(room) : { x: HULL_PX.w / 2, y: HULL_PX.h / 2 });
  };
  root._wcCameraController = createCameraController({
    surface: stage,
    getCamera: () => root._wcCamera,
    setCamera: root._wcSetCamera,
    onGesture: kind => markCameraPractice(root, kind),
    onTap: point => {
      // During an FTL-lite fight the ship view stays framed; rooms are move targets, not zoom targets.
      if (root._wcBattleActive || root._wcFtlMode) return;
      const room = roomAt(point);
      if (!room) return;
      if (root._wcPlayer?.tutorial?.script === 5 && root._wcPlayer.tutorial.phase === 'assign') {
        const intent = guidedStationTap(root._wcPlayer, room.id, root._wcCamera.scale, root._wcCamera.minScale);
        if (intent?.kind === 'focus') root._wcFocusRoom(room.id);
        if (intent?.kind === 'assign') root._wcHandlers?.onAction('station-assign', { id: intent.id, station: intent.station });
        return;
      }
      if (root._wcFirstSession) return;
      if (root._wcCamera.scale <= root._wcCamera.minScale * 1.1) root._wcFocusRoom(room.id);
      else root._wcHandlers?.onAction('select-room', { act: 'select-room', room: room.id });
    },
    onFocus: point => focus(point),
  });
  root._wcSetCamera(root._wcCamera, initialFit);
  if (typeof ResizeObserver !== 'undefined') {
    root._wcCameraResize = new ResizeObserver(() => {
      const refit = root._wcCameraFit;
      root._wcSetCamera(refit ? refit(size()) : resizeCamera(root._wcCamera, size()), refit);
    });
    root._wcCameraResize.observe(stage);
  }
}

function dismissCameraCue(root) {
  root._wcCameraCueDismissed = true;
  root.querySelector('.camera-orientation-cue')?.remove();
  if (root._wcCameraCueKey) {
    try { window.sessionStorage.setItem(root._wcCameraCueKey, '1'); } catch { /* storage can be unavailable */ }
  }
}

function markCameraPractice(root, kind) {
  if (root._wcPlayer?.tutorial?.script !== 5 || root._wcPlayer.tutorial.phase !== 'assign'
    || root._wcCameraCueDismissed) return;
  if (kind === 'pan') root._wcCameraPracticedPan = true;
  if (kind === 'zoom') root._wcCameraPracticedZoom = true;
  if (root._wcCameraPracticedPan && root._wcCameraPracticedZoom) dismissCameraCue(root);
}

function buildShell() {
  const showShipDebug = shipDebugEnabled({
    dev: import.meta.env.DEV,
    search: window.location.search,
  });
  return `
    <div class="wc-shell tab-home">
      <div class="hud-bar" data-slot="hud"></div>
      <div class="ftl-top" data-slot="fight-top"></div>
      <div class="stage">
        <div class="space-stage" aria-hidden="true">
          <canvas class="space-canvas" data-slot="space"></canvas>
        </div>
        <div class="stage-hud" data-slot="stage-hud"></div>
        <div data-slot="crew-rail"></div>
        <div data-slot="ship-sequence"></div>
        <div class="ship-fit" style="width:${HULL_PX.w}px;height:${HULL_PX.h}px">
          <img class="sparrow-hull" src="${SPACE_ART.hull}" width="${HULL_PX.w}" height="${HULL_PX.h}" alt="" />
          <div class="ship-feedback-layer" data-slot="ship-feedback"></div>
          <canvas class="crew-canvas" data-slot="crew"></canvas>
          <div class="hotspot-layer" data-slot="hotspots"></div>
          <div data-slot="captain-marker"></div>
          ${showShipDebug ? renderShipDebug(SPARROW_LAYOUT) : ''}
        </div>
        <canvas class="combat-canvas" data-slot="combat"></canvas>
        <div data-slot="overlays"></div>
      </div>
      <div class="ftl-bottom" data-slot="fight-bottom"></div>
      <div class="detail-scroll" data-slot="detail"></div>
      <nav class="bottom-nav" data-slot="nav"></nav>
      <div data-slot="toast"></div>
      <div data-slot="departure-status"></div>
      <div data-slot="coach"></div>
      <div data-slot="modal"></div>
      <div data-slot="reward"></div>
    </div>
  `;
}

/** Ship feedback plus FTL room markers; while a crew member is dragged, their drop targets. */
function renderShipFeedbackSlot(root) {
  const dragging = root._wcFtlEnc ? root._wcFtlDragCrewId || null : null;
  morphInto(root.querySelector('[data-slot="ship-feedback"]'), (root._wcShipFeedback || '')
    + (root._wcFtlEnc ? renderFtlShipMarkers(root._wcFtlEnc, { selectedCrewId: dragging || root._wcFtlSelected, dragging: Boolean(dragging) }) : ''));
  // A beat re-render keeps the room under the finger lit.
  const hover = dragging && root._wcFtlDrag?.hoverRoom;
  if (hover) root.querySelector(`.ftl-move-target[data-room="${CSS.escape(hover)}"]`)?.classList.add('is-drop-hover');
}

/** Drag crew (chip or sprite) onto a room in FTL-lite fights; see ftlCrewDrag.js. */
function bindCrewDrag(root) {
  const stage = root.querySelector('.stage');
  root._wcFtlDrag = bindFtlCrewDrag(root, {
    view: () => root._wcFtlEnc || null,
    spriteAt: (x, y, pad) => {
      const rect = stage.getBoundingClientRect();
      const camera = root._wcCamera;
      return crewAgentAt(unproject(camera, { x: x - rect.left, y: y - rect.top }), pad / camera.scale);
    },
    setDragging: crewId => {
      root._wcFtlDragCrewId = crewId;
      renderShipFeedbackSlot(root);
    },
    send: dataset => root._wcHandlers?.onAction('encounter-command', dataset),
    select: crewId => root._wcHandlers?.onAction('ftl-select-crew', { act: 'ftl-select-crew', crewId }),
    edgePan: (x, y) => {
      const rect = stage.getBoundingClientRect();
      const edge = 48;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
      const dy = y < rect.top + edge ? 7 : y > rect.bottom - edge ? -7 : 0;
      if (!dy) return false;
      const before = root._wcCamera;
      root._wcSetCamera(pan(before, 0, dy));
      return root._wcCamera.y !== before.y;
    },
  });
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
    activeContractView = null,
    activeTravelView = null,
    contractReview = null,
    awayPicker = null,
    selectedRoom: requestedRoom = null,
    selectedCrewId = null,
    cinematic = null,
    shopProducts = null,
    toast = null,
    departureInFlight = false,
    now = trustedNow(),
  } = ctx;
  // Room ids from the v3 hull (operations, workshop, stores) still resolve.
  const selectedRoom = canonicalRoomId(requestedRoom);
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
  root._wcAttentionKey = `wc:crew-ready:${player.createdAt || 'existing'}:${player.dailyLoop?.dayKey || player.lastLoginDay || 'day'}`;
  root._wcCameraCueKey = `wc:camera-cue:${player.createdAt || player.captainInstanceId || 'existing'}`;
  if (!root._wcCameraCueDismissed) {
    try { root._wcCameraCueDismissed = window.sessionStorage.getItem(root._wcCameraCueKey) === '1'; } catch { /* storage can be unavailable */ }
  }
  let crewAttentionSeen = false;
  try { crewAttentionSeen = window.sessionStorage.getItem(root._wcAttentionKey) === '1'; } catch { /* storage can be unavailable */ }
  const firstSession = isTutorialActive(player) && player.tutorial?.script === 4;
  const v5Session = isTutorialActive(player) && player.tutorial?.script === 5;
  root._wcPlayer = player;
  const leavingFirstSession = root._wcFirstSession === true && !(firstSession || v5Session);
  root._wcFirstSession = firstSession || v5Session;
  if (leavingFirstSession) root._wcSetCamera(homeCamera(root._wcCamera.viewport), homeCamera);
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

  if (root._wcSetCamera && !(firstSession || v5Session) && root._wcLastSelectedRoom !== selectedRoom) {
    const roomSel = ROOMS.find(r => r.id === selectedRoom);
    const viewport = root._wcCamera.viewport;
    if (roomSel) {
      // Keep the chosen room clear of its sheet: sheets sit below upper rooms and above lower ones.
      const point = roomWorldPoint(roomSel);
      const targetY = roomSel.labelAnchor.y >= 55 ? viewport.h * 0.72 : viewport.h * 0.27;
      const focused = focusCamera(root._wcCamera, point, root._wcCamera.scale * 1.35);
      root._wcSetCamera(pan(focused, 0, targetY - viewport.h / 2));
    } else if (root._wcLastSelectedRoom && root._wcLastSelectedRoom !== 'hangar') root._wcSetCamera(homeCamera(viewport), homeCamera);
  }
  root._wcLastSelectedRoom = selectedRoom;
  // Boarders land in a room the fight panel usually covers. Once per boarding,
  // frame that room in the strip of ship still visible above the panel (the
  // camera gets that strip as its viewport), and restore the full view after.
  const boarding = player.activeEncounter?.boarders;
  const boardKey = boarding?.phase === 'aboard' && player.activeEncounter.phase === 'combat' ? `${player.activeEncounter.seed}:${boarding.landsBeat}` : null;
  if (root._wcSetCamera && boardKey && root._wcBoardFocusKey !== boardKey) {
    const boardedRoom = ROOMS.find(r => r.id === STATIONS[boarding.target]?.roomId);
    if (boardedRoom) {
      root._wcBoardFullViewport ||= root._wcCamera.viewport;
      requestAnimationFrame(() => {
        const full = root._wcBoardFullViewport;
        const stageTop = root.querySelector('.stage')?.getBoundingClientRect().top ?? 0;
        const panelTop = root.querySelector('.ship-encounter')?.getBoundingClientRect().top;
        const visibleH = Number.isFinite(panelTop) ? Math.max(120, Math.min(full.h, panelTop - stageTop)) : full.h * 0.6;
        const strip = makeCamera({ w: full.w, h: visibleH }, root._wcCamera.world);
        const point = roomWorldPoint(boardedRoom);
        root._wcSetCamera(focusCamera(strip, point, strip.maxScale * 0.7));
      });
    }
  }
  if (boardKey) root._wcBoardFocusKey = boardKey;
  else if (root._wcBoardFullViewport) {
    root._wcSetCamera(homeCamera(root._wcBoardFullViewport), homeCamera);
    root._wcBoardFullViewport = null;
  }
  root.querySelector('.wc-shell')?.classList.toggle('tab-home', isHome);
  root._wcBattleActive = fighting;
  root._wcSelectedRoom = selectedRoom;
  root.querySelector('.wc-shell')?.classList.toggle('in-battle', fighting);
  root.querySelector('.wc-shell')?.classList.toggle('first-session', firstSession || v5Session);
  root.querySelector('.wc-shell')?.setAttribute('data-phase', phase);
  root.querySelector('.bottom-nav')?.style.setProperty('--nav-cols', String(tabs.length));
  root.querySelector('.hud-bar')?.style.setProperty('--hud-cols', String(chips.length));

  setSlot(root, 'hud', renderHud(player, fuel, chips, firstSession || v5Session));
  setSlot(root, 'stage-hud', renderStageHud(locName, hullPct, shieldPct, player, selectedRoom, now, root._wcCameraOpen));
  setSlot(root, 'crew-rail', isHome && !fighting && !firstSession && !v5Session && !selectedRoom ? renderCrewRail(player) : '');
  setSlot(root, 'ship-sequence', renderShipSequence(ctx.shipSequence));
  // New captains: a one-time pointer to the sector map (coach mark, first-visit card, first-event hint).
  const nudges = exploreNudges(player);
  const exploreCoach = nudges.coach && player.flags?.splashSeen && !fighting && !player.activeEncounter && !player.activeEvent
    && !(tab === 'missions' && ctx.missionView === 'explore');
  setSlot(root, 'nav', renderNav(tab, player, expReady, tabs, coachStep, crewAttentionSeen) + (exploreCoach ? renderExploreCoach() : ''));
  // Travel events: the open card (saved) or its result (UI only) sits over every tab.
  const eventModal = !player.flags?.splashSeen ? '' : ctx.activeEventView ? renderEventCard(ctx.activeEventView, { hint: nudges.eventHint }) : ctx.eventResult ? renderEventResult(ctx.eventResult) : '';
  const baseModal = ctx.hireReveal ? renderHireReveal(ctx.hireReveal) : ctx.hireOddsOpen ? renderHireOdds(player, now)
    : ctx.confirmRestartSave ? renderRestartSaveConfirm() : ctx.commissionWinback ? renderCommissionWinback(player) : fighting ? '' : eventModal
    || (ctx.welcomeBackOpen && player.flags?.splashSeen && !isTutorialActive(player) && idleHaul(player, now).ready ? renderWelcomeBack(player, now) : '')
    || (ctx.calendarOpen && player.flags?.splashSeen && !isTutorialActive(player) ? renderCalendar(player, now) : '') || renderModals(player, { pendingCombat, combatOrders, contractReview, awayPicker, step, selectedCrewId, cinematic, confirmAbandon: ctx.confirmAbandon, jestLive: ctx.jestLive, splashProgress: ctx.splashProgress, splashReady: ctx.splashReady, splashScene: ctx.splashScene });
  const starter = starterOfferState(player, now);
  const wallPack = wallPackState(player, currentWall(player, now));
  const calm = !baseModal.trim() && isHome && !fighting && !player.activeEncounter && !selectedRoom;
  const offerModal = calm && starter.showModal ? renderStarterOffer(starter, starterValue(ctx.shopProducts || []))
    : calm && wallPack.showModal ? renderWallPack(wallPack, packValue(wallPack.sku, ctx.shopProducts || []), { modal: true }) : '';
  setSlot(root, 'modal', baseModal.trim() ? baseModal : offerModal);
  setSlot(root, 'hotspots', v5Session && phase === 'assign' ? renderV5AssignmentHotspot(player)
    : firstSession || v5Session ? '' : renderHotspots(player, fuel, expReady, selectedRoom));
  setSlot(root, 'captain-marker', v5Session && phase === 'assign' ? renderCaptainMarker(player) : '');
  // FTL-lite fights: enemy ship above the ship view, controls below, markers on the Sparrow's rooms.
  const ftlFight = isHome && player.activeEncounter?.version === 3 ? (player.activeContract ? activeContractView : activeTravelView) : null;
  const ftlEnc = ftlFight?.encounter?.ftl ? ftlFight.encounter : null;
  const ftlUi = { selectedCrewId: ctx.ftlSelectedCrewId || null, paused: Boolean(ctx.ftlPaused) };
  root.querySelector('.wc-shell')?.classList.toggle('ftl-fight', Boolean(ftlEnc));
  // The stage changes size when the fight panels appear or go: refit once layout has settled.
  if (Boolean(ftlEnc) !== Boolean(root._wcFtlMode) && root._wcSetCamera) {
    root._wcFtlMode = Boolean(ftlEnc);
    root._wcFtlWhole = false;
    root.querySelector('.wc-shell')?.classList.remove('ftl-whole');
    setTimeout(() => {
      const stage = root.querySelector('.stage');
      const viewport = { w: stage?.clientWidth || 390, h: stage?.clientHeight || 620 };
      const refit = root._wcFtlMode ? fightCamera : homeCamera;
      root._wcSetCamera(refit(viewport), refit);
    }, 60);
  }
  // Patched in place: these re-render every second and must not drop a tap mid-render.
  morphInto(root.querySelector('[data-slot="fight-top"]'), ftlEnc ? renderFtlEnemy(ftlEnc) : '');
  morphInto(root.querySelector('[data-slot="fight-bottom"]'), ftlEnc ? renderShipEncounter(ftlFight, ftlUi) : '');
  root._wcFtlEnc = ftlEnc;
  root._wcFtlSelected = ftlUi.selectedCrewId;
  root._wcShipFeedback = renderShipFeedback(contractShipSignals(player));
  if (!ftlEnc) root._wcFtlDrag?.cancel();
  renderShipFeedbackSlot(root);
  // In FTL-lite fights the overlay (zoom toggle, incoming chips) re-renders every beat: patch it in place so taps land.
  const overlaysEl = root.querySelector('[data-slot="overlays"]');
  const ftlOverlay = player.activeEncounter?.version === 3 && isHome;
  if (!ftlOverlay && overlaysEl) overlaysEl._wcMorphHtml = null;
  (ftlOverlay ? (slot, html) => morphInto(overlaysEl, html) : (slot, html) => setSlot(root, slot, html))('overlays', fighting ? '' : renderOverlays(player, { step, selectedRoom, fuel, now, tab, isHome, activeContractView, activeTravelView, cameraCueDismissed: root._wcCameraCueDismissed, captainCardOpen: root._wcCaptainCardOpen })
    + (isHome && player.activeEncounter?.version === 3 ? renderOffscreenThreats(root, (player.activeContract ? activeContractView : activeTravelView)?.encounter) : ''));
  setSlot(root, 'toast', fighting ? '' : renderToast(toast));
  // Rewards wait out a fight, then show above everything else.
  setSlot(root, 'reward', fighting ? '' : renderRewardReveal(ctx.rewardReveal));
  setSlot(root, 'departure-status', renderDepartureStatus(departureInFlight));
  const showCoach = coachStep && !step?.modal && !pendingCombat && !selectedRoom && !fighting
    && tab !== 'missions' && !cinematic && !selectedCrewId && player.flags?.splashSeen
    && (coachStep.cta || coachStep.body);
  setSlot(root, 'coach', showCoach ? renderSessionGuidance(player, now) : '');

  attachSpace(root.querySelector('[data-slot="space"]'), () => root._wcCamera, 77);
  attachCombat(root.querySelector('[data-slot="combat"]'), root.querySelector('.stage'),
    () => root._wcCamera, camera => root._wcSetCamera(camera));
  syncCrewLayer(root.querySelector('[data-slot="crew"]'), player);
  setEncounterSnapshot(player.activeEncounter);

  if (!isHome) {
    const detail = `${emptyHints(player, fuel, tab)}
          ${tab === 'missions' ? renderMissions(player, now, { ...ctx, exploreNudges: nudges }) : ''}
          ${tab === 'crew' ? renderCrew(player, now) : ''}
          ${tab === 'shop' ? renderShop(player, shopProducts, now) : ''}
          ${tab === 'log' ? renderLog(player, log, goals) : ''}`;
    setSlot(root, 'detail', detail);
  }
}

function renderHud(player, fuel, chips, firstSession = false) {
  const map = {
    fuel: `
      <${firstSession ? 'div' : 'button'} class="hud-chip ${fuel.pendingWhole && !firstSession ? 'has-claim' : ''}" data-currency="fuel" ${firstSession ? '' : 'data-act="claim"'}>
        <img src="${ICONS.fuel}" alt="" />
        <b>${fuel.current}</b><span>/${fuel.max}</span>
        ${fuel.pendingWhole && !firstSession ? '<i class="claim-pip"></i>' : ''}
      </${firstSession ? 'div' : 'button'}>`,
    credits: `
      <div class="hud-chip" data-currency="credits">
        <img src="${ICONS.credits}" alt="" />
        <b>${player.wallet.credits}</b>
      </div>`,
    gems: `
      <div class="hud-chip premium" data-currency="gems">
        <img src="${ICONS.gems}" alt="" />
        <b>${player.wallet.gems}</b>
      </div>`,
    medals: `
      <div class="hud-chip" data-currency="medals">
        <img src="${ICONS.medals}" alt="" />
        <b>${player.wallet.medals}</b>
      </div>`,
  };
  const list = chips && chips.length ? chips : ['fuel', 'credits', 'gems', 'medals'];
  return list.map((id) => map[id] || '').join('');
}

function renderStageHud(locName, hullPct, shieldPct, player, selectedRoom, now, cameraOpen = false) {
  const stationId = Object.keys(STATIONS).find(id => STATIONS[id].roomId === selectedRoom);
  const station = stationId ? stationOutputs(player, now)[stationId] : null;
  return `
        ${renderStatusPanel(hullPct, shieldPct)}
        <div class="objective-panel" ${station ? `aria-label="${station.label} output ${station.total}"` : ''}>
          ${renderObjectiveHead(locName, station ? `${station.label} ${station.total}` : null)}
        </div>
        <div class="camera-controls${cameraOpen ? ' is-open' : ''}" aria-label="Ship view controls">
          <button type="button" data-camera="toggle" aria-label="Camera controls" aria-expanded="${cameraOpen}">${pixelIcon('camera')}</button>
          <div class="camera-actions">
          <button type="button" data-camera="focus" aria-label="Focus ship view">Focus</button>
          <button type="button" data-camera="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" data-camera="zoom-out" aria-label="Zoom out">−</button>
          </div>
        </div>
  `;
}

/** One-time coach mark over the command bar: Explore (the sector map) is open. Never blocks play. */
export function renderExploreCoach() {
  return `<aside class="explore-coach" aria-label="New: Explore">
    <p><b>New · Explore</b> Jump to beacons on the sector map.</p>
    <button type="button" class="primary" data-act="mission-view" data-view="explore">Open map</button>
    <button type="button" class="explore-coach-close" data-act="explore-nudge-dismiss" data-nudge="coach" aria-label="Dismiss">×</button>
  </aside>`;
}

/** First visit to the map: what it is and how events work. */
export function renderExploreIntro() {
  return `<aside class="explore-intro" aria-label="The sector map">
    <b>The sector map</b>
    <p>Jump along lanes; each beacon shows what you might find; events let your crew's skills change the outcome.</p>
    <button type="button" data-act="explore-nudge-dismiss" data-nudge="mapIntro">Got it</button>
  </aside>`;
}

export function renderNav(tab, player, expReady, tabs, step, crewAttentionSeen = false) {
  const ids = tabs && tabs.length ? tabs : unlockedTabs(player);
  const badges = {
    crew: tab !== 'crew' && !crewAttentionSeen && player.dailyPullAvailable && isFeatureUnlocked(player, 'gacha')
      && ((player.crew || []).length < (player.crewSlots || 0) || (player.reserve || []).length < RESERVE_CAP),
    missions: expReady,
    log: tab !== 'log' && (claimableAchievements(player) > 0 || (!isTutorialActive(player) && (calendarState(player).canClaim || chestState(player).daily.ready || chestState(player).weekly.ready))),
  };
  return renderCommandBar(tab, player, expReady, ids, { spotlight: step?.spotlight || null, badges });
}

export function renderHotspots(player, fuel, expReady, selectedRoom) {
  const signals = contractShipSignals(player);
  return ROOMS.map((r) => {
    const pip = roomPip(r, player, fuel, expReady);
    const signal = r.id === 'sensors' && signals.routeActive
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

export function guidedStationTap(player, roomId, scale, minScale) {
  if (player?.tutorial?.script !== 5 || player.tutorial.phase !== 'assign') return null;
  const member = player.crew?.find(c => c.instanceId === player.tutorial.firstHireInstanceId);
  if (!member) return null;
  const station = member.templateId === 'merc_bolt' ? 'shields' : member.templateId === 'merc_jen' ? 'weapons' : null;
  if (!station || STATIONS[station].roomId !== canonicalRoomId(roomId)) return null;
  return scale <= minScale * 1.1 ? { kind: 'focus', room: roomId }
    : { kind: 'assign', id: member.instanceId, station };
}

function renderV5AssignmentHotspot(player) {
  const member = player.crew?.find(c => c.instanceId === player.tutorial.firstHireInstanceId);
  const station = member?.templateId === 'merc_bolt' ? 'shields' : 'weapons';
  const room = ROOMS.find(r => r.id === STATIONS[station].roomId);
  if (!member || !room) return '';
  return `<button type="button" class="hotspot guided-station" data-act="station-assign" data-room="${escapeHtml(room.id)}" data-id="${escapeHtml(member.instanceId)}" data-station="${station}" style="${roomStyle(room)}" aria-label="Assign ${escapeHtml(member.name)} to ${escapeHtml(STATIONS[station].label)}"><span class="ship-signal" aria-hidden="true">${escapeHtml(STATIONS[station].label)}</span></button>`;
}

export function renderOverlays(player, { step, selectedRoom, fuel, now, tab, isHome, activeContractView, activeTravelView = null, cameraCueDismissed = false, captainCardOpen = false }) {
  // Contract confrontations and Explore jumps share one ship fight panel.
  const fightView = player.activeContract ? activeContractView : activeTravelView;
  // FTL-lite fights: only the zoom toggle sits over the ship view (drag and pinch also work).
  if (isHome && player.activeEncounter?.version === 3) return '<button type="button" class="ftl-zoom" data-camera="ftl-zoom"><span class="when-zoomed">Whole ship</span><span class="when-whole">Zoom in</span></button>';
  if (isHome && player.activeEncounter) return renderShipEncounter({ ...fightView,
    encounter: { ...fightView?.encounter, version: player.activeEncounter.version,
      weaponDisabled: player.activeEncounter.orders?.targetWeapons?.used === true
        && player.activeEncounter.enemy?.weaponDisabledThroughBeat >= player.activeEncounter.beat } });
  if (isHome && player.tutorial?.script === 5 && !player.tutorial.completed) {
    return `${renderSessionGuidance(player, now)}${player.tutorial.phase === 'assign' && !cameraCueDismissed
      ? '<aside class="camera-orientation-cue" aria-label="Ship camera help"><p>Drag to look around. Pinch to zoom. Tap your captain.</p><button type="button" data-act="camera-cue-dismiss" aria-label="Dismiss camera help">Got it</button></aside>' : ''}
      ${captainCardOpen ? renderCaptainInspect(player) : ''}`;
  }
  if (isHome && player.tutorial?.script === 4 && !player.tutorial.completed) return renderSessionGuidance(player, now);
  if (isHome && player.activeContract?.stage === 'choice' && activeContractView?.actions?.length) {
    return renderRouteEvent(activeContractView.routeEvent, activeContractView);
  }
  if (isHome && player.tutorial?.script === 4 && player.tutorial.completed && !player.activeContract
    && !selectedRoom && (player.stats?.contractsCompleted || 0) <= 1) return `<aside class="first-session-cue" aria-label="Next job"><p>Next job is ready.</p><button class="primary" data-act="goto-contracts">See contracts</button><small>Away teams are on Missions when you're ready.</small></aside>`;
  if (isHome && player.tutorial?.script === 5 && player.tutorial.completed && !player.activeContract
    && !selectedRoom && (player.stats?.contractsCompleted || 0) <= 1) return '<button type="button" class="next-job-callout" data-act="goto-contracts" aria-label="Your crew is ready for another job. See contracts">Crew ready · See contracts</button>';
  const def = SHIPS[player.ship?.shipId] || SHIPS.sparrow;
  const room = ROOMS.find((r) => r.id === canonicalRoomId(selectedRoom));
  const showHangar = isFeatureUnlocked(player, 'hangar');
  return `
      ${!selectedRoom && showHangar ? `<button class="ship-chip" data-act="select-room" data-room="hangar">${escapeHtml(def.name)}</button>` : ''}
      ${isHome && !selectedRoom && !player.activeEncounter ? renderHoldChip(player, now) + renderNoticeStrip(player, now) : ''}
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

export function renderSessionGuidance(player, now = trustedNow()) {
  if (player.tutorial?.script === 5 && !player.tutorial.completed) {
    const phase = player.tutorial.phase;
    if (phase === 'assign') {
      const member = player.crew?.find(c => c.instanceId === player.tutorial.firstHireInstanceId);
      if (!member) return '';
      const station = member.templateId === 'merc_bolt' ? 'shields' : 'weapons';
      const label = station === 'shields' ? 'Shields' : 'Weapons';
      return `<aside class="first-session-cue" aria-label="First assignment"><p>${escapeHtml(member.name)} is ready. Put ${escapeHtml(member.name)} at ${label}.</p><button class="primary" data-primary-pulse data-spotlight-target data-act="station-assign" data-id="${escapeHtml(member.instanceId)}" data-station="${station}">Assign ${escapeHtml(member.name)} to ${label}</button></aside>`;
    }
    if (phase === 'fight' && !player.activeEncounter) {
      return `<aside class="first-session-cue first-session-spotlight distress-transmission" aria-label="Trader distress"><div class="distress-heading"><span class="distress-dot" aria-hidden="true"></span><b>DISTRESS SIGNAL</b><span>LIVE</span></div><div class="distress-scene" role="img" aria-label="Pirate scout firing on a trader ship"><img class="distress-trader" src="${escapeHtml(SPACE_ART.trader)}" alt="" /><span class="distress-laser" aria-hidden="true"></span><span class="distress-impact" aria-hidden="true"></span><img class="distress-pirate" src="${escapeHtml(SPACE_ART.pirate)}" alt="" /></div><p>Pirates are firing on a trader. Help them.</p><button class="primary" data-primary-pulse data-spotlight-target data-act="tutorial-fight-start">Intercept</button></aside>`;
    }
    return '';
  }
  if (player.tutorial?.script === 4 && !player.tutorial.completed) {
    if (player.tutorial.phase === 'station') {
      const bolt = player.crew.find(member => member.templateId === 'merc_bolt');
      return `<aside class="first-session-cue" aria-label="First job"><p>Distress call: send Bolt to Shields.</p><button class="primary" data-act="station-assign" data-id="${escapeHtml(bolt?.instanceId || '')}" data-station="shields">Send Bolt to Shields</button></aside>`;
    }
    if (player.tutorial.phase === 'fight' && !player.activeEncounter) {
      return '<aside class="first-session-cue" aria-label="Distress call"><p>Distress call from Dust Lane.</p><button class="primary" data-act="tutorial-fight-start">Answer call</button></aside>';
    }
    return '';
  }
  return isTutorialActive(player) ? renderCoach(currentTutorialStep(player)) : renderDailyPlan(dailyPlan(player, now));
}

export function isGuidedSpotlightBlocked(player, action) {
  return player?.tutorial?.script === 5 && !player.tutorial.completed
    && player.tutorial.phase === 'fight' && !player.activeEncounter
    && action !== 'tutorial-fight-start';
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

function renderModals(player, { pendingCombat, combatOrders, contractReview, awayPicker, step, selectedCrewId, cinematic, confirmAbandon, jestLive, splashProgress, splashReady, splashScene }) {
  if (!player.flags?.splashSeen) return renderSplash({ progress: splashProgress, ready: splashReady, scene: splashScene });
  if (player.tutorial?.script === 5 && !player.tutorial.completed) return renderV5Modal(player, { jestLive });
  if (player.tutorial?.script === 4 && !player.tutorial.completed) return renderV4Modal(player, { jestLive });
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

function identityCard(c, { compact = false } = {}) {
  const station = c.currentJob || c.job || 'Ready for duty';
  return `<div class="crew-identity${compact ? ' compact' : ''}${c.ascension ? ` ascension-${Math.min(3, c.ascension)}` : ''}"><img class="portrait" src="${escapeHtml(portraitFor(c.templateId || c.id, c.role))}" alt="" /><div class="crew-identity-copy"><b>${escapeHtml(c.name)}</b><div class="crew-meta">${escapeHtml(c.role)} · ${escapeHtml(c.rarity || 'Common')} · ${starsHtml(c.stars)}</div><div class="crew-meta">${escapeHtml(station)}</div><div class="crew-meta">Power ${escapeHtml(c.power ?? c.basePower ?? 10)} · Lv ${escapeHtml(c.level ?? 1)}</div></div></div>`;
}

export function renderV5Modal(player, { jestLive = false } = {}) {
  const phase = player.tutorial?.phase;
  if (phase === 'captain') {
    const labels = { captain_cyborg: ['Cyborg', 'Pilot', 'Helm'], captain_gunner: ['Human', 'Gunner', 'Weapons'], captain_alien: ['Alien', 'Scout', 'Helm'], captain_droid: ['Droid', 'Engineer', 'Shields'] };
    return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal v5-modal" role="dialog" aria-modal="true" aria-label="Choose your captain"><span class="modal-kicker">Your first command</span><h2>Choose your captain</h2><p>Pick the person who will command and work aboard the Sparrow.</p><div class="captain-grid">${STARTER_CAPTAINS.map((id, index) => {
      const [species, role, job] = labels[id];
      return `<button type="button" class="captain-option" data-captain-option="${id}" aria-pressed="${index === 0}"><img src="${escapeHtml(portraitFor(id, role.toLowerCase()))}" alt="" /><span><b>${species}</b><small>${role} · ${job}</small><small>★ Common · Power 10</small></span></button>`;
    }).join('')}</div><label for="captain-name">Captain name</label><input id="captain-name" data-captain-name maxlength="48" value="Captain" autocomplete="off" /><button class="primary" data-act="captain-choose" data-primary-pulse>Take command</button></section></div>`;
  }
  if (phase === 'hire') {
    const captain = player.crew?.find(c => c.instanceId === player.captainInstanceId);
    const bolt = captain?.role === 'gunner';
    const recruit = CREW_CATALOG.find(c => c.id === (bolt ? 'merc_bolt' : 'merc_jen'));
    const member = { ...recruit, templateId: recruit?.id, name: recruit?.name || (bolt ? 'Bolt' : 'Jen Park'), stars: 1, level: 1, currentJob: bolt ? 'Shields · keeps the Sparrow protected' : 'Weapons · fires on the pirate' };
    return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal v5-modal" role="dialog" aria-modal="true" aria-label="First hire"><span class="modal-kicker">Crew · step 1 of 4</span><h2>One free crew member</h2>${identityCard(member)}<p>${escapeHtml(member.name)} can work beside your captain.</p><button class="primary" data-primary-pulse data-act="tutorial-first-hire">Hire for free</button></section></div>`;
  }
  if (phase === 'name_ship') return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal v5-modal" role="dialog" aria-modal="true" aria-label="Name your ship"><span class="modal-kicker">Crew · step 3 of 4</span><h2>Cargo aboard. Third berth open.</h2><p>Give your ship a name or keep Sparrow.</p><label for="ship-name">Ship name</label><input id="ship-name" data-ship-name maxlength="24" value="${escapeHtml(player.ship?.name || 'Sparrow')}" autocomplete="off" /><button class="primary" data-primary-pulse data-act="tutorial-name">Keep sailing</button></section></div>`;
  if (phase === 'pull') return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal v5-modal" role="dialog" aria-modal="true" aria-label="Free recruit"><span class="modal-kicker">Crew · step 4 of 4</span><div class="recruit-beacon" aria-hidden="true">${pixelIcon('crew')}</div><h2>Third berth ready</h2><p>Meet one free Uncommon recruit.</p><button class="primary" data-primary-pulse data-act="tutorial-welcome-pull">Meet your recruit</button></section></div>`;
  if (phase === 'register') {
    const member = player.crew?.find(c => c.instanceId === player.tutorial.welcomeInstanceId);
    const station = player.tutorial.suggestedRole === 'away' ? 'Future Away team' : player.tutorial.suggestedStation === 'weapons' ? 'Weapons' : 'Shields';
    const reveal = member ? `<div class="reveal-portrait" data-rarity="${escapeHtml(member.rarity || 'common')}"><img src="${escapeHtml(portraitFor(member.templateId, member.role))}" alt="" /></div>` : '';
    const tags = member ? `<div class="reveal-tags"><span class="reveal-rarity" data-rarity="${escapeHtml(member.rarity || 'common')}">${escapeHtml(member.rarity || 'common')}</span><span>${starsHtml(member.stars)}</span><span>${escapeHtml(member.role)}</span></div><p class="reveal-line">${escapeHtml(station)} · Power ${escapeHtml(member.power ?? 10)}</p>` : '';
    return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal v5-modal recruit-reveal" role="dialog" aria-modal="true" aria-label="New crew aboard"><span class="modal-kicker">New crew aboard</span>${reveal}<h2>${escapeHtml(member?.name || 'New recruit')} joins the crew</h2>${tags}<p class="reveal-note">Progress is saved in this browser. Jest sign-in is optional.</p>${jestLive ? '<button type="button" data-act="tutorial-register-start">Sign in to Jest</button>' : '<p class="reveal-note">Jest sign-in is unavailable in this preview.</p>'}<button class="primary" data-primary-pulse data-act="tutorial-register-skip">Continue to ship</button></section></div>`;
  }
  return '';
}

function renderCaptainMarker(player) {
  const captain = player.crew?.find(c => c.instanceId === player.captainInstanceId);
  if (!captain) return '';
  const stationId = player.stationAssignments?.[captain.instanceId];
  const room = ROOMS.find(r => r.id === STATIONS[stationId]?.roomId) || ROOMS.find(r => r.id === 'bridge');
  return `<button type="button" class="captain-marker" data-act="captain-inspect" style="left:${room.labelAnchor.x}%;top:${room.labelAnchor.y}%" aria-label="Inspect captain ${escapeHtml(captain.name)}"><img src="${escapeHtml(portraitFor(captain.templateId, captain.role))}" alt="" /><span>Captain</span></button>`;
}

function renderCaptainInspect(player) {
  const captain = player?.crew?.find(c => c.instanceId === player.captainInstanceId);
  return captain ? `<aside class="captain-inspect-card" aria-label="Captain ${escapeHtml(captain.name)}">${identityCard({ ...captain, currentJob: STATIONS[player.stationAssignments?.[captain.instanceId]]?.label || 'On deck' }, { compact: true })}<button type="button" data-act="captain-inspect-close" aria-label="Close captain card">Close</button></aside>` : '';
}

export function renderSplash({ progress = 0, ready = false, scene = SPLASH_ART } = {}) {
  const pct = Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
  return `
    <div class="modal-backdrop splash-backdrop" role="dialog" aria-modal="true" aria-label="Warp Crew opening">
      <div class="splash-scene" role="img" aria-label="Mercenary crew on a ship looking out into space">
        ${scene ? `<img src="${escapeHtml(scene)}" alt="" />` : ''}
      </div>
      <div class="splash-shade" aria-hidden="true"></div>
      <div class="splash-content">
        <div class="splash-logo" aria-label="Warp Crew"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3 42 24 24 45 6 24 24 3Z"/><path d="M24 10v28M11 24h26M17 17l14 14M31 17 17 31"/></svg><span>WARP<br>CREW</span></div>
        <div class="splash-copy">
          <div class="splash-loading"><div class="splash-loading-label"><span>${ready ? 'Ship ready' : 'Loading ship'}</span><span>${pct}%</span></div><div class="splash-progress" role="progressbar" aria-label="Ship loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div></div>
          <button type="button" class="primary" data-act="splash-dismiss" ${ready ? '' : 'disabled'}>Board ship</button>
        </div>
      </div>
    </div>`;
}

export function renderV4Modal(player, { jestLive = false } = {}) {
  const phase = player.tutorial.phase;
  if (phase === 'name') return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal" role="dialog" aria-modal="true" aria-label="Name your ship"><h2>Cargo aboard; third berth open.</h2><p>Name your ship.</p><label for="ship-name">Ship name</label><input id="ship-name" data-ship-name maxlength="24" value="${escapeHtml(player.ship?.name || 'Sparrow')}" autocomplete="off" /><button class="primary" data-act="tutorial-name">Continue</button></section></div>`;
  if (phase === 'pull') return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal" role="dialog" aria-modal="true" aria-label="Welcome crew"><h2>One free crew member</h2><p>Guaranteed Uncommon crew for your open berth.</p><button class="primary" data-act="tutorial-welcome-pull">Meet your crew</button></section></div>`;
  if (phase === 'register') {
    const member = player.crew.find(crew => crew.instanceId === player.tutorial.welcomeInstanceId);
    const suggestion = player.tutorial.suggestedRole === 'away' ? 'Good for a future Away team.'
      : player.tutorial.suggestedStation === 'weapons' ? 'Try them at Weapons.' : 'Try them at Shields.';
    return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal" role="dialog" aria-modal="true" aria-label="Jest sign-in"><h2>${escapeHtml(member?.name || 'Crew member')} joins the crew</h2><p>Uncommon ${escapeHtml(member?.role || 'crew')} · ${escapeHtml(suggestion)}</p><p>Progress is saved in this browser; Jest sign-in is optional.</p>${jestLive ? '<button class="primary" data-act="tutorial-register-start">Sign in to Jest</button>' : '<p>Jest sign-in is unavailable in this preview.</p>'}<button class="${jestLive ? '' : 'primary'}" data-act="tutorial-register-skip">Continue to ship</button></section></div>`;
  }
  return '';
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

/** The merc's signature move, their line and their story (crew-matter design: the bios finally show). */
function dossierStory(c) {
  const kit = kitFor(c.templateId, c.role);
  const family = FAMILIES[familyOf(c.templateId)];
  const familyLine = family ? `<p class="dossier-family"><span class="modal-kicker">Family</span> ${escapeHtml(family.name)} · two aboard: ${escapeHtml(family.bonus[0])}; four: ${escapeHtml(family.bonus[1])}</p>` : '';
  const move = kit ? `<div class="dossier-move"><span class="modal-kicker">Signature move</span><b>${escapeHtml(kit.move)}</b><p>${escapeHtml(describeKit(kit))}</p></div>` : '';
  const quote = c.quote ? `<blockquote class="dossier-quote">“${escapeHtml(c.quote)}”</blockquote>` : '';
  const history = c.history ? `<p class="dossier-history">${escapeHtml(c.history)}</p>` : '';
  return move || quote || history || familyLine ? `<div class="dossier-story">${move}${familyLine}${quote}${history}</div>` : '';
}

/** Stars, the level cap, shards and the next Ascension step. */
function dossierGrowth(player, c) {
  const status = ascensionStatus(c, player.wallet);
  const tier = ASCENSION[c.ascension || 0];
  const why = { needs_5_stars: 'Reach 5 stars first (duplicates star them up).', needs_shards: `Needs ${status.next?.shards} shards (duplicates past 5 stars).`,
    needs_medals: `Needs ${status.next?.medals} medals.` }[status.reason] || '';
  return `<div class="dossier-growth">
    <div><span>Level cap</span><b>${levelCap(c)}</b></div>
    <div><span>Shards</span><b>${c.shards || 0}${status.next ? ` / ${status.next.shards}` : ''}</b></div>
    <div><span>Ascension</span><b>${escapeHtml(tier.name || 'None yet')}</b></div>
    ${status.next ? `<button class="${status.reason ? '' : 'primary'}" data-act="crew-ascend" data-id="${escapeHtml(c.instanceId)}" ${status.reason ? 'disabled' : ''}>Ascend to ${escapeHtml(status.next.name)} · ${status.next.medals} medals</button>
      <p class="muted">${status.reason ? escapeHtml(why) : 'Their move charges faster, the level cap rises by 10, and they earn a frame.'}</p>` : '<p class="muted">Fully ascended: a Legend.</p>'}
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
          <div class="recruit-card dossier-head">${identityCard({ ...c, currentJob: STATIONS[player.stationAssignments?.[c.instanceId]]?.label || 'Ready for duty' })}<div class="muted">${escapeHtml(title)}${passive ? ` · ${escapeHtml(passive)}` : ''}</div></div>
          <button class="icon-close" data-act="close-crew" aria-label="Close">×</button>
        </div>
        ${dossierStory(c)}
        ${dossierGrowth(player, c)}
        <div class="row" style="margin-top:10px;flex-direction:column">
          ${c.status !== 'expedition' ? (c.level >= levelCap(c)
            ? `<button disabled>Level ${c.level} is the cap · ${c.stars < 5 ? 'star up to raise it' : 'ascend to raise it'}</button>`
            : `<button data-act="level-crew" data-id="${c.instanceId}">Level ${c.level + 1} · ${lvlCost} medals</button>`) : ''}
          <button data-act="rank-up" data-id="${c.instanceId}">Rank up · ${rankCost.medals} med · ${rankCost.credits}cr</button>
          ${!c.isCaptain && c.status !== 'expedition' && (player.crew || []).length > 1 ? `<button data-act="crew-bench" data-id="${c.instanceId}">Bench to reserve</button>` : ''}
        </div>
      </div>
    </div>`;
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
  const stationId = Object.keys(STATIONS).find(id => STATIONS[id].roomId === room.id);
  const assignments = normalizeAssignments(player);
  const output = stationId ? stationOutputs(player, now)[stationId] : null;
  const assignedId = stationId ? Object.keys(assignments).find(id => assignments[id] === stationId) : null;
  const assigned = stationId
    ? player.crew.find(c => c.instanceId === assignedId) || player.reserve?.find(c => c.instanceId === assignedId)
    : room.role ? player.crew.find(c => c.role === room.role && c.status !== 'expedition') : null;
  const sys = room.system ? player.ship.systems?.[room.system] || 1 : null;
  const actions = roomActions(room, player);
  const sysLine = sys != null
    ? `Lv ${sys}${room.system ? ` · ${escapeHtml(systemStat(room.system, sys))}` : ''}`
    : assigned ? escapeHtml(assigned.role) : 'Empty';
  const crewChoices = stationId ? `
    <div class="sheet-output"><span>${output.label} output</span><b>${output.total}</b><small>${output.baseline} + ${output.bonus} crew bonus · ${output.staffedBy ? 'staffed' : assigned ? 'assigned · unavailable' : 'open station'}</small></div>
    <div class="sheet-kicker">Who works here?</div>
    <div class="row crew-actions">
      ${player.crew.map(c => {
        const preview = previewStationAssignment(player, c.instanceId, stationId, now);
        const label = preview.ok ? `${preview.after} (${preview.delta >= 0 ? '+' : ''}${preview.delta})` : 'Unavailable';
        return `<button class="station-crew${assignments[c.instanceId] === stationId ? ' is-current' : ''}" data-act="station-assign" data-id="${escapeHtml(c.instanceId)}" data-station="${stationId}" ${preview.ok ? '' : 'disabled'}><img src="${escapeHtml(portraitFor(c.templateId, c.role))}" alt="" /><span>${escapeHtml(c.name)}</span><b>${label}${assignments[c.instanceId] === stationId ? ' · assigned' : ''}</b></button>`;
      }).join('')}
    </div>` : '';
  return `
    <div class="room-sheet" data-room-position="${room.labelAnchor.y >= 55 ? 'lower' : 'upper'}">
      <div class="sheet-head">
        <div>
          <h2>${escapeHtml(room.name)}</h2>
          <div class="muted">${sysLine}</div>
        </div>
        <button class="icon-close" data-act="close-room" aria-label="Close">×</button>
      </div>
      <div class="sheet-crew">${assigned ? identityCard({ ...assigned, currentJob: `${stationId ? STATIONS[stationId].label : room.name}${output && !output.staffedBy ? ' · unavailable' : ''}` }, { compact: true }) : '<span>Empty station</span>'}</div>
      ${crewChoices}
      <div class="sheet-actions">${actions}</div>
    </div>`;
}

function gemRefuelButton(player) {
  if (isTutorialActive(player) || !hudChips(player).includes('gems')) return '';
  const room = (player.fuelMax ?? 10) - (player.wallet?.fuel || 0);
  return `<button data-act="refuel-gems" ${room >= FUEL_REFILL.fuel ? '' : 'disabled'}>Refuel +${FUEL_REFILL.fuel} · ${FUEL_REFILL.gems}g${room < FUEL_REFILL.fuel ? ' · needs room for 5' : ''}</button>`;
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

function upgradeButton(player, system, label, next) {
  const build = player.shipBuild;
  if (build?.system === system) {
    const left = Math.max(0, build.endAt - trustedNow());
    const skip = (player.drydockFinishes || 0) > 0 ? `Finish · ${player.drydockFinishes} token${player.drydockFinishes === 1 ? '' : 's'}` : `Skip ${buildSkipGems(left)}g`;
    return `<button class="upgrade-btn is-building" data-act="ship-build-skip"><span>Building ${escapeHtml(label)} Lv ${build.targetLevel} · ${formatDuration(left)} left</span><b>${skip}</b></button>`;
  }
  const minutes = buildMinutesFor(next.level + 1);
  const timing = minutes ? ` · ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`} build` : '';
  return `<button class="upgrade-btn" data-act="ship-upgrade" data-system="${system}" ${build ? 'disabled' : ''}><span>Upgrade ${escapeHtml(label)} → Lv ${next.level + 1}${timing}${build ? ' · drydock busy' : ''}</span><b>${next.credits}cr</b></button>`;
}

/** Weapons room: the fitted guns, the ones in storage, and the ones for sale. */
export function renderArmory(player) {
  const slots = weaponSlots(player);
  const fitted = shipLoadout(player);
  const owned = ownedWeapons(player);
  const credits = player.wallet?.credits || 0;
  const inFight = Boolean(player.activeEncounter && !player.activeEncounter.result);
  const row = id => {
    const w = WEAPON_CATALOG[id];
    const slot = fitted.indexOf(id);
    let actions;
    if (slot >= 0) actions = `<span class="tag">Slot ${slot + 1}</span>`;
    else if (owned.includes(id)) {
      actions = Array.from({ length: slots }, (_, i) => `<button data-act="weapon-equip" data-weapon="${id}" data-slot="${i}" ${inFight ? 'disabled' : ''}>${i < fitted.length ? `Swap slot ${i + 1}` : `Fit slot ${i + 1}`}</button>`).join('');
    } else {
      const price = WEAPON_PRICES[id];
      actions = `<button data-act="weapon-buy" data-weapon="${id}" ${credits >= price && !inFight ? '' : 'disabled'}>Buy ${price}cr</button>`;
    }
    return `<div class="armory-row" data-weapon-kind="${w.kind}"><div><b>${escapeHtml(w.name)}</b><small>${escapeHtml(WEAPON_BLURBS[id] || '')}</small></div><div class="row">${actions}</div></div>`;
  };
  return `
    <div class="armory">
      <div class="sheet-kicker">Armory · ${fitted.length}/${slots} slots fitted${slots < 4 ? ` · more slots at Weapons Lv ${slots === 2 ? 4 : 8}` : ''}</div>
      ${Object.keys(WEAPON_CATALOG).map(row).join('')}
    </div>`;
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
  if (room.id === 'sensors') {
    const sensors = nextUpgradeCost(player, 'sensors');
    return `
      <button class="primary" data-act="goto-missions">Contracts</button>
      ${hangar && sensors ? `${upgradeButton(player, 'sensors', 'Sensors', sensors)}` : ''}`;
  }
  if (room.id === 'shields') {
    const shields = nextUpgradeCost(player, 'shields');
    return hangar && shields ? upgradeButton(player, 'shields', 'Shields', shields) : '';
  }
  if (room.id === 'medbay') {
    const medbay = nextUpgradeCost(player, 'medbay');
    return `
      ${crewOpen ? '<button class="ghost" data-act="goto-crew">Manage crew</button>' : '<button class="primary" data-act="goto-missions">Jump</button>'}
      ${hangar && medbay ? `${upgradeButton(player, 'medbay', 'Medbay', medbay)}` : ''}`;
  }
  if (room.id === 'quarters') {
    const quarters = nextUpgradeCost(player, 'quarters');
    return `
      ${crewOpen ? '<button class="ghost" data-act="goto-crew">Manage crew</button>' : '<button class="primary" data-act="goto-missions">Jump</button>'}
      ${hangar && quarters ? `${upgradeButton(player, 'quarters', 'Quarters', quarters)}` : ''}`;
  }
  if (room.id === 'weapons') {
    const weapons = nextUpgradeCost(player, 'weapons');
    return `
      ${crewOpen ? '<button class="ghost" data-act="goto-crew">Manage crew</button>' : ''}
      ${hangar && weapons ? `${upgradeButton(player, 'weapons', 'Weapons', weapons)}` : ''}
      ${hangar ? renderArmory(player) : ''}`;
  }
  if (room.id === 'cargo') {
    const contract = player.activeContract;
    if (contract?.stage === 'return') return `<p>${escapeHtml(contract.result.summary)}</p><p>${escapeHtml(formatReward(contract.result.rewards))}</p><button class="primary" data-act="contract-claim" data-revision="${escapeHtml(contract.revision)}" data-acceptance-id="${escapeHtml(contract.acceptanceId)}">Bring it aboard</button>`;
    const cg = nextUpgradeCost(player, 'cargo');
    return `
      <button class="primary" data-act="goto-away">Away teams</button>
      ${fuelBuyButtons(player)}
      ${hangar && cg ? `${upgradeButton(player, 'cargo', 'Cargo', cg)}` : ''}`;
  }
  if (room.id === 'mess') {
    return crewOpen
      ? '<button class="ghost" data-act="goto-crew">Manage crew</button>'
      : '<button class="primary" data-act="goto-missions">Jump</button>';
  }
  if (room.id === 'armory') {
    return fuelBuyButtons(player) || '<button class="primary" data-act="goto-missions">Contracts</button>';
  }
  if (room.id === 'engineering') {
    const en = nextUpgradeCost(player, 'engines');
    return `
      <button class="primary" data-act="claim">Claim fuel</button>
      ${fuelBuyButtons(player)}
      ${gemRefuelButton(player)}
      ${offer ? `<button data-act="repair-hull">Repair ${offer.cost}cr (+${offer.amount}%)</button>` : ''}
      ${hangar && en ? `${upgradeButton(player, 'engines', 'Engines', en)}` : ''}`;
  }
  if (room.system && hangar) {
    const up = nextUpgradeCost(player, room.system);
    return `
      ${up ? upgradeButton(player, room.system, SYSTEM_LABEL[room.system] || room.system, up) : ''}`;
  }
  if (room.role) {
    return crewOpen
      ? '<button class="ghost" data-act="goto-crew">Manage crew</button>'
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
            ${up ? upgradeButton(player, id, label, up) : '<span class="muted">MAX</span>'}
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
      ${n.id === here || player.activeContract || player.activeTravelFight ? 'disabled' : ''} ${player.activeContract ? 'aria-describedby="explore-contract-lock"' : player.activeTravelFight ? 'aria-describedby="explore-fight-lock"' : ''}>
      <img class="node-thumb" src="${art}" alt="" />
      <span class="map-title">${escapeHtml(n.name)}</span>
      <span class="map-meta">${cost}F · ${escapeHtml(hint)}${decay}</span>
      <span class="map-jump">${n.id === here ? 'HERE' : 'JUMP'}</span>
    </button>
  `;
}

export function renderMissions(player, now, model = {}) {
  const views = missionViews(player);
  const view = views.includes(model.missionView) ? model.missionView : 'contracts';
  const nudges = model.exploreNudges || {};
  const switcher = renderMissionSwitcher(view, views, { fresh: nudges.coach ? ['explore'] : [] });
  if (view === 'contracts') {
    const board = model.contractBoard || player.contractBoard || { offers: [] };
    const content = player.activeContract
      ? renderActiveContract(model.activeContractView || player.activeContract)
      : renderContractBoard({ ...board, offers: (board.offers || []).map((offer) => ({ ...offer, completed: offer.completed || (board.completedOfferIds || []).includes(offer.id) })) });
    const pack = !player.activeContract ? wallPackState(player, currentWall(player, now)) : { active: false };
    return switcher + content + (pack.active ? renderWallPack(pack, packValue(pack.sku, model.shopProducts || [])) : '');
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
      ${!player.activeContract && player.activeTravelFight ? `<p class="contract-consequence" id="explore-fight-lock">${player.activeTravelFight.stage === 'return' ? 'Bring the prize aboard on the Ship tab first.' : 'Your crew is fighting. Return to the Ship tab.'}</p>` : ''}
      ${nodes.length === 0 ? '<div class="empty-hint">No routes.</div>' : ''}
      ${tight ? `<div class="map-grid">${nodes.map((n) => renderNodeCard(n, player, here, step)).join('')}</div>`
        : mapBlock('Spur', spur)
          + mapBlock('Veil', veil)
          + mapBlock('Ember', ember)
          + mapBlock('Hollow', hollow)
          + mapBlock('Crown', crown)}
    </div>`;
  // Sector map (FTL-lite phase 3) replaces the node grid outside the legacy script-2 tutorial.
  const sectorPanel = tight ? mapPanel : `<div class="panel sector-panel">${nudges.mapIntro ? renderExploreIntro() : ''}${renderSectorMap(model.sectorMap || sectorMapModel(player, model, now))}</div>`;

  const expPanel = showExp ? `
    <div class="panel away-view">
      <h2>Away</h2>
      ${exp ? renderActiveExpedition(player, exp, now) : planetList.map((p) => renderPlanetCard(player, p, teachDust)).join('')}
    </div>` : '<section class="panel away-view"><h2>Away</h2><p>Continue your first contract to unlock expeditions.</p></section>';
  return switcher + (view === 'away' ? expPanel : sectorPanel);
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
        <div class="away-stats"><span><small>Success</small>${(prev.chance * 100) | 0}%</span><span><small>Time</small>${mins}m</span><span><small>Best role</small>${escapeHtml(p.prefRole || 'Any')}</span></div>
        <p class="away-reward"><b>Success:</b> ${escapeHtml(win)}<br><b>Failure:</b> ${escapeHtml(fail)}</p>
        <p class="away-risk">Injury risk: crew may return injured on failure.</p>
      </div>
      <button class="away-choose" data-act="exp-choose" data-planet="${p.id}" data-spot-target="exp-${p.id}" ${prev.crew.length ? '' : 'disabled'}>Choose crew</button>
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

const rarityLabel = id => RARITY[id]?.label || 'Common';

/** Families aboard: two of a family give a bonus, four a bigger one (crew-matter design §6). */
function renderFamilies(player) {
  const counts = familyCounts((player.crew || []).map(c => c.templateId));
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  return `<div class="family-strip" aria-label="Families aboard">${rows.map(([id, n]) => {
    const f = FAMILIES[id];
    const tier = n >= 4 ? 2 : n >= 2 ? 1 : 0;
    const text = tier ? f.bonus[tier - 1] : `one more for ${f.bonus[0]}`;
    return `<span class="family-chip${tier ? ' is-live' : ''}"><b>${escapeHtml(f.name)} ×${n}</b><small>${escapeHtml(text)}</small></span>`;
  }).join('')}</div>`;
}

/** "Between Jobs": the featured merc, rate-up Rares, hire buttons, Contract Marks, pity and the odds link. */
function renderHireBanner(player, { free, teachHire, showGems, now }) {
  const g = { ...defaultGacha(), ...(player.gacha || {}) };
  const banner = currentBanner(now);
  const star = catalogById(banner.featured);
  const kit = kitFor(star.id, star.role);
  const markCost = MARK_COST[star.rarity];
  const marksPct = Math.min(100, Math.round(((g.marks || 0) / markCost) * 100));
  const luckMaxed = (g.luck || 0) >= LUCK_CAP;
  const rateUp = banner.rateUp.map(id => catalogById(id)).filter(Boolean);
  return `
    <section class="panel recruit-panel hire-banner rarity-${escapeHtml(star.rarity)}">
      <div class="banner-card">
        <img class="banner-art" src="${escapeHtml(portraitFor(star.id, star.role))}" alt="" />
        <div class="banner-copy">
          <span class="modal-kicker">Between jobs · ${banner.daysLeft} day${banner.daysLeft === 1 ? '' : 's'} left</span>
          <h2>${escapeHtml(star.name)}</h2>
          <span class="rarity-tag rarity-${escapeHtml(star.rarity)}">${escapeHtml(rarityLabel(star.rarity))}</span> <span class="banner-role">${escapeHtml(star.role)}</span>
          <p class="banner-pitch">${escapeHtml(banner.pitch)}</p>
          ${kit ? `<p class="banner-move"><b>${escapeHtml(kit.move)}</b> ${escapeHtml(describeKit(kit))}</p>` : ''}
        </div>
      </div>
      <div class="banner-rateup"><span>Rare hires favour</span>${rateUp.map(t => `<span class="rateup-chip"><img src="${escapeHtml(portraitFor(t.id, t.role))}" alt="" />${escapeHtml(t.name)}</span>`).join('')}</div>
      <div class="hire-buttons">
        <button class="primary recruit-main ${teachHire && free ? 'spot-glow' : ''}" data-act="gacha">${free ? 'Free hire' : `Hire · ${GACHA_COSTS.credits.credits}cr`}</button>
        ${showGems ? `${free ? '' : `<button data-act="gacha-gems">Hire · ${GACHA_COSTS.gems.gems} gems</button>`}
        <button class="hire-ten" data-act="gacha-10">10 hires · ${GACHA_COSTS.gems10.gems} gems<small>Rare or better guaranteed</small></button>` : ''}
      </div>
      <div class="marks-row">
        <div class="marks-copy"><span>Contract Marks</span><b>${g.marks || 0} / ${markCost}</b></div>
        <div class="marks-bar" aria-hidden="true"><span style="width:${marksPct}%"></span></div>
        <button data-act="gacha-marks" ${(g.marks || 0) >= markCost ? 'class="primary"' : 'disabled'}>Hire ${escapeHtml(star.name.replace(/^Captain /, '').split(' ')[0])}</button>
      </div>
      <p class="pity-line">${g.featuredGuarantee ? `Next ${escapeHtml(rarityLabel(star.rarity))} hire is ${escapeHtml(star.name)}. ` : ''}Legendary within ${Math.max(1, PITY.legendHard - (g.pityLegend || 0))} hires · Rare within ${Math.max(1, PITY.rareHard - (g.pityRare || 0))}
        <button type="button" class="link-btn" data-act="hire-odds">Odds</button></p>
      <details class="luck-meter">
        <summary>Improve odds · Luck ${g.luck || 0}/${LUCK_CAP}</summary>
        <div class="row hire-row">
          <button data-act="buy-luck" data-currency="credits" ${luckMaxed ? 'disabled' : ''}>${luckMaxed ? 'Luck max' : `Luck +1 · ${luckCreditCost(g.luck)}cr`}</button>
          ${showGems ? `<button data-act="buy-luck" data-currency="gems" ${luckMaxed ? 'disabled' : ''}>${luckMaxed ? 'Luck max' : `Luck +1 · ${luckGemCost(g.luck)}g`}</button>` : ''}
        </div>
      </details>
    </section>`;
}

/** The odds, in the game (crew-matter design: transparent odds). */
export function renderHireOdds(player, now = trustedNow()) {
  const odds = hireOdds(player, now);
  const star = catalogById(odds.banner.featured);
  return `<div class="modal-backdrop"><section class="modal panel hire-odds" role="dialog" aria-modal="true" aria-label="Hiring odds">
    <div class="sheet-head"><h2>Hiring odds</h2><button class="icon-close" data-act="hire-odds-close" aria-label="Close">×</button></div>
    <table class="odds-table"><tbody>${odds.rows.map(r => `<tr class="rarity-${escapeHtml(r.rarity)}"><th>${escapeHtml(rarityLabel(r.rarity))}</th><td>${r.pct.toFixed(r.pct < 1 ? 2 : 1)}%</td></tr>`).join('')}</tbody></table>
    <ul class="odds-notes">
      <li>When a hire is ${escapeHtml(rarityLabel(odds.featured.rarity))}, it is ${escapeHtml(star.name)} ${odds.featured.guaranteed ? '<b>for sure</b> (your last one missed)' : `${odds.featured.sharePct}% of the time; a miss makes the next one certain`}.</li>
      <li>Rare hires are one of this banner's two favoured Rares ${odds.rateUpSharePct}% of the time.</li>
      <li>Pity: a Rare or better is guaranteed within ${odds.pity.rare.hard} hires, a Legendary within ${odds.pity.legendary.hard}. Odds climb after ${odds.pity.rare.soft} and ${odds.pity.legendary.soft}.</li>
      <li>Every hire earns a Contract Mark. ${odds.marks.cost} marks hire ${escapeHtml(star.name)} outright; leftover marks carry over.</li>
      <li>Reputation and Luck raise these odds, up to 3% for Legendary or better.</li>
    </ul></section></div>`;
}

const REVEAL_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'apex'];

/** The reveal: docking pods that light up in their rarity, one big card for a single hire, a grid for ten. */
export function renderHireReveal(reveal) {
  if (!reveal?.results?.length) return '';
  const top = reveal.results.reduce((best, r) => (REVEAL_ORDER.indexOf(r.rarity) > REVEAL_ORDER.indexOf(best) ? r.rarity : best), 'common');
  const big = ['legendary', 'mythic', 'apex'].includes(top);
  const note = r => (r.kind === 'star' ? `★${r.stars}` : r.kind === 'shard' ? '+1 shard' : r.kind === 'cap' ? `Max stars · ${escapeHtml(formatReward(r.sold || {}))}`
    : r.kind === 'sold' ? `Reserve full · sold` : r.kind === 'reserve' ? 'New · reserve' : 'New');
  const card = (r, i, single) => {
    const t = catalogById(r.templateId);
    const kit = t ? kitFor(t.id, t.role) : null;
    return `<article class="reveal-card rarity-${escapeHtml(r.rarity)}${r.featured ? ' is-featured' : ''}${single ? ' is-single' : ''}" style="--i:${i}">
      <div class="reveal-pod" aria-hidden="true"></div>
      <img src="${escapeHtml(portraitFor(r.templateId, t?.role))}" alt="" />
      <b>${escapeHtml(r.name)}</b><span class="rarity-tag rarity-${escapeHtml(r.rarity)}">${escapeHtml(rarityLabel(r.rarity))}</span>
      <small>${r.featured ? 'Featured · ' : ''}${note(r)}</small>
      ${single && kit ? `<p class="reveal-move"><b>${escapeHtml(kit.move)}</b> ${escapeHtml(describeKit(kit))}</p>` : ''}
      ${single && t?.quote ? `<q>${escapeHtml(t.quote)}</q>` : ''}
    </article>`;
  };
  const single = reveal.results.length === 1;
  return `<div class="modal-backdrop hire-reveal-backdrop tier-${escapeHtml(top)}">
    <section class="hire-reveal" role="dialog" aria-modal="true" aria-label="${single ? 'New hire' : 'New hires'}">
      ${big ? '<div class="priority-transmission" role="status">Priority transmission</div>' : ''}
      <div class="reveal-grid${single ? ' is-single' : ''}">${reveal.results.map((r, i) => card(r, i, single)).join('')}</div>
      <button class="primary" data-act="hire-reveal-close">${single ? 'Welcome aboard' : 'Continue'}</button>
    </section></div>`;
}

export function renderCrew(player, now = trustedNow()) {
  const canHire = isFeatureUnlocked(player, 'gacha');
  const free = player.dailyPullAvailable;
  const open = Math.max(0, player.crewSlots - player.crew.length);
  const teachHire = player.tutorial?.ordersBeat === 'hire';
  const g = { ...defaultGacha(), ...(player.gacha || {}) };
  const ownedIds = new Set([
    ...(player.crew || []).map((c) => c.templateId),
    ...(player.reserve || []).map((c) => c.templateId),
  ]);
  const board = CREW_CATALOG.filter((t) => t.hireCost && !ownedIds.has(t.id) && (t.rarity === 'common' || t.rarity === 'uncommon')).slice(0, 8);
  const pityRarePct = Math.min(100, ((g.pityRare || 0) / PITY.rareHard) * 100);
  const luckMaxed = (g.luck || 0) >= LUCK_CAP;
  const reserve = player.reserve || [];
  const assignments = normalizeAssignments(player);
  const outputs = stationOutputs(player, now);
  const showGems = hudChips(player).includes('gems');
  return `
    <section class="panel roster-head">
      <h2>Crew · ${player.crew.length}/${player.crewSlots}</h2>
      <div class="roster-stats">
        <div><span>Power</span><b>${crewPower(fightingCrew(player))}</b></div>
        <div><span>Open berths</span><b>${open}</b></div>
      </div>
      ${renderFamilies(player)}
      <div class="station-strip" aria-label="Station output">${Object.entries(outputs).map(([id, output]) => `<div class="station-out"><span>${escapeHtml(output.label)}</span><b>${output.total}</b></div>`).join('')}</div>
    </section>
    ${canHire ? renderHireBanner(player, { free, teachHire, showGems, now }) : ''}
    <section class="crew-list">
      ${player.crew.map((c) => {
        const cost = medalLevelCostFor(c);
        const hurt = c.status === 'injured' && (c.injuredUntil || 0) > now
          ? ` · down ${formatDuration(c.injuredUntil - now)}`
          : '';
        return `
        <article class="crew-card panel">
          <div class="crew-body">
            ${identityCard({ ...c, currentJob: assignments[c.instanceId] ? `${STATIONS[assignments[c.instanceId]].label} · working` : 'On deck' })}
            ${hurt ? `<div class="crew-meta crew-hurt">${hurt.slice(3)}</div>` : ''}
            <div class="station-grid" role="group" aria-label="Assign ${escapeHtml(c.name)} to a station">
              ${Object.entries(STATIONS).map(([id, station]) => {
                const preview = previewStationAssignment(player, c.instanceId, id, now);
                const label = preview.ok ? `${preview.after} (${preview.delta >= 0 ? '+' : ''}${preview.delta})` : 'Unavailable';
                return `<button class="station-pick${assignments[c.instanceId] === id ? ' is-current' : ''}" data-act="station-assign" data-id="${escapeHtml(c.instanceId)}" data-station="${id}" ${preview.ok ? '' : 'disabled'}>${escapeHtml(station.label)} ${label}</button>`;
              }).join('')}
            </div>
            <div class="row crew-actions">
              <button class="ghost" data-act="select-crew" data-id="${c.instanceId}">Dossier</button>
              ${isFeatureUnlocked(player, 'gacha') && c.status !== 'expedition'
                ? (c.level >= levelCap(c) ? `<button class="level-up" disabled>Lv ${c.level} · max</button>`
                  : `<button class="level-up" data-act="level-crew" data-id="${c.instanceId}">Lv ${c.level + 1} · ${cost} med</button>`)
                : ''}
              ${assignments[c.instanceId] ? `<button class="ghost" data-act="station-assign" data-id="${escapeHtml(c.instanceId)}" data-station="">Leave station</button>` : ''}
              ${isFeatureUnlocked(player, 'gacha') && !c.isCaptain && c.status !== 'expedition' && player.crew.length > 1
                ? `<button class="ghost" data-act="crew-bench" data-id="${c.instanceId}">Bench</button>`
                : ''}
            </div>
          </div>
        </article>`;
      }).join('') || '<div class="empty-hint">No crew.</div>'}
    </section>
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
    </div>` : canHire && !open ? '<div class="muted" style="margin:8px 0 16px">Berths full. A new recruit joins reserve.</div>' : ''}
  `;
}

export function renderPlatformLoginEntry() {
  return `<button data-act="prompt-login" style="margin-top:8px">Optional Jest sign-in</button>`;
}

function starterContents(value) {
  const g = value?.grant || { gems: 250, fuel: 10, medals: 50, credits: 800 };
  return `<ul class="kit-contents">
    <li><img src="${ICONS.gems}" alt="" /><b>${g.gems}</b><span>gems</span></li>
    <li><img src="${ICONS.fuel}" alt="" /><b>${g.fuel}</b><span>fuel</span></li>
    <li><img src="${ICONS.medals}" alt="" /><b>${g.medals}</b><span>medals</span></li>
    <li><img src="${ICONS.credits}" alt="" /><b>${g.credits}</b><span>credits</span></li>
  </ul>`;
}

function starterPrice(value) {
  return value ? `$${value.price.toFixed(2)}` : 'Buy';
}

function starterSaving(value) {
  // Only claim value the live prices support: compare with the gem pack at the same price.
  return value?.morePct > 0
    ? `<p class="kit-saving">${value.morePct}% more than the $${value.rung.price.toFixed(2)} ${escapeHtml(value.rung.name)} (${value.rung.gems} gems), counting fuel at its gem price. Medals and credits are extra.</p>` : '';
}

function starterClock(state) {
  const hours = Math.floor(state.remainingMs / 3600000);
  const minutes = Math.floor((state.remainingMs % 3600000) / 60000);
  return hours >= 1 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function renderWallPack(state, value, { modal = false } = {}) {
  const def = PRODUCT_DEFS[state.sku];
  const g = def.grant;
  const lead = state.reason === 'near_miss'
    ? 'So close. This pack gets the crew ready to finish the flagship.'
    : 'This flagship has held for days. This pack gives the crew what it needs to break through.';
  const body = `<span class="modal-kicker">One time only · this wall</span>
    <h2>${escapeHtml(def.name)}</h2>
    <p>${escapeHtml(lead)}</p>
    <ul class="kit-contents">
      <li><img src="${ICONS.gems}" alt="" /><b>${g.gems}</b><span>gems</span></li>
      <li><img src="${ICONS.medals}" alt="" /><b>${g.medals}</b><span>medals</span></li>
      <li><img src="${ICONS.credits}" alt="" /><b>${g.credits}</b><span>credits</span></li>
      <li><img src="${ICONS.fuel}" alt="" /><b>${g.fuel}</b><span>fuel</span></li>
    </ul>
    <p class="kit-note">+ ${g.drydockFinishes} instant drydock finish${g.drydockFinishes === 1 ? '' : 'es'}</p>
    ${starterSaving(value)}
    <button class="primary" data-act="iap-buy" data-sku="${state.sku}">${starterPrice(value)}</button>`;
  return modal
    ? `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal starter-offer" role="dialog" aria-modal="true" aria-label="${escapeHtml(def.name)}">${body}<button class="ghost" data-act="wall-pack-dismiss" data-wall="${state.wallId}">Maybe later</button><p class="kit-note">Stays available until this wall falls. Can only be bought once.</p></section></div>`
    : `<section class="panel starter-card wall-pack-card">${body}</section>`;
}

const dollars = cents => `$${(cents / 100).toFixed(2)}`;

/** Captain's Commission: one subscription, trial and cancel-save handled by Jest. */
export function renderCommissionCard(player, now = trustedNow()) {
  const c = player.commission || {};
  const { perks } = COMMISSION;
  const perkList = `<ul class="kit-contents">
      <li><img src="${ICONS.gems}" alt="" /><b>${perks.dailyGems}</b><span>gems daily</span></li>
      <li><img src="${ICONS.fuel}" alt="" /><b>+${perks.fuelMaxBonus}</b><span>fuel tank</span></li>
    </ul>
    <p class="kit-note">+ ${perks.dailyDrydockFinishes} free drydock finish every day</p>`;
  if (commissionActive(player, now)) {
    return `<section class="panel starter-card commission-card">
      <span class="modal-kicker">Subscription · active</span>
      <h2>${escapeHtml(COMMISSION.name)}</h2>
      ${perkList}
      <p class="kit-note">${c.cancelRequested ? 'Cancelled. Perks continue until the paid period ends.' : c.lastClaimDay ? "Today's perks are in your hold." : 'Perks arrive each day you play.'}</p>
      ${c.cancelRequested ? '' : '<button class="ghost" data-act="commission-cancel">Cancel subscription</button>'}
    </section>`;
  }
  // Terms come from Jest's verified catalog; with none, no price is promised and no checkout is offered.
  const terms = usableTerms(c.terms);
  const trial = c.trialEligible !== false;
  const period = { weekly: 'week', monthly: 'month', yearly: 'year' }[terms?.billingPeriod] || 'month';
  const price = terms ? `${terms.currency && terms.currency !== 'USD' ? `${terms.currency} ` : ''}${dollars(terms.priceCents)}/${period}` : '';
  return `<section class="panel starter-card commission-card">
    <span class="modal-kicker">Subscription</span>
    <h2>${escapeHtml(COMMISSION.name)}</h2>
    ${perkList}
    ${terms ? `<button class="primary" data-act="commission-subscribe">${trial ? `Start ${COMMISSION.trialDays}-day free trial` : `Subscribe · ${price}`}</button>
    <p class="kit-note">${trial ? `Then ${price}. ` : ''}Cancel anytime.</p>`
    : '<p class="kit-note">Subscriptions are unavailable right now.</p>'}
  </section>`;
}

/** Cancel-save: Jest's one-time retention discount on the same subscription. */
export function renderCommissionWinback(player) {
  // Show exactly what Jest will apply (price in cents, like products).
  const offer = player.commission?.retentionOffer;
  // Only offered with verified renewal terms (see commission-cancel in main.js).
  const terms = usableTerms(player.commission?.terms);
  if (!terms || !priceCents(offer?.price) || !(offer.durationPeriods > 0)) return '';
  const periods = offer?.durationPeriods;
  const unit = { weekly: 'week', monthly: 'month', yearly: 'year' }[terms?.billingPeriod] || 'period';
  const cur = terms?.currency && terms.currency !== 'USD' ? `${terms.currency} ` : '';
  const price = `${cur}${dollars(priceCents(offer?.price))}`;
  return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal starter-offer" role="dialog" aria-modal="true" aria-label="Keep your Commission">
    <span class="modal-kicker">Before you go</span>
    <h2>Stay aboard for ${price}/${unit}?</h2>
    <p>Keep every Commission perk for ${price} a ${unit} for your next ${periods === 1 ? unit : `${periods} ${unit}s`}.${terms ? ` Then it returns to ${cur}${dollars(terms.priceCents)}.` : ''}</p>
    <button class="primary" data-act="commission-stay">Stay for ${price}/${unit}</button>
    <button class="ghost" data-act="commission-cancel-confirm">Cancel anyway</button>
    <button class="ghost" data-act="commission-winback-close">Back</button>
  </section></div>`;
}

export function renderStarterOffer(state, value) {
  const lead = state.reason === 'first_loss'
    ? 'Rough fight. This kit gets the Sparrow back in the air with a stronger crew behind it.'
    : "You've got the hang of the Sparrow. This kit helps you push further, faster.";
  return `<div class="modal-backdrop first-session-backdrop"><section class="first-session-modal starter-offer" role="dialog" aria-modal="true" aria-label="New Captain's Kit">
    <span class="modal-kicker">One time only · ${starterClock(state)} left</span>
    <h2>New Captain's Kit</h2>
    <p>${escapeHtml(lead)}</p>
    ${starterContents(value)}
    ${starterSaving(value)}
    <button class="primary" data-act="iap-buy" data-sku="wc_starter_kit">${starterPrice(value)}</button>
    <button class="ghost" data-act="starter-dismiss">Maybe later</button>
    <p class="kit-note">Stays in the Shop until the timer ends. Can only be bought once.</p>
  </section></div>`;
}

function renderStarterCard(state, value) {
  return `<section class="panel starter-card">
    <span class="modal-kicker">One time only · ${starterClock(state)} left</span>
    <h2>New Captain's Kit</h2>
    ${starterContents(value)}
    ${starterSaving(value)}
    <button class="primary" data-act="iap-buy" data-sku="wc_starter_kit">${starterPrice(value)}</button>
  </section>`;
}

export function renderShop(player, shopProducts, now = trustedNow()) {
  // Gem packs as cards: art, the gems, and a value badge computed from real prices (never invented).
  const values = gemLadderValues(shopProducts || []);
  const bySku = Object.fromEntries((shopProducts || []).map((p) => [p.sku, p]));
  const products = GEM_LADDER.map((sku) => ({ sku, ...PRODUCT_DEFS[sku], ...(bySku[sku] || {}), name: PRODUCT_DEFS[sku].name, value: values[sku] || null }));
  const owned = listOwnedHulls(player);
  const shipId = player.ship?.shipId || 'sparrow';
  const qa = typeof window !== 'undefined' && /(?:^|[?&])qa=1(?:&|$)/.test(window.location.search);
  // Show owned hulls plus the next one to chase; the rest stay folded.
  const hullRows = Object.values(SHIPS);
  const lastOwned = Math.max(0, ...hullRows.map((h, i) => (owned.includes(h.id) || h.id === shipId ? i : 0)));
  const visibleHulls = Math.min(hullRows.length, lastOwned + 2);
  const starter = starterOfferState(player, now);
  const wallPack = wallPackState(player, currentWall(player, now));
  const featured = [
    starter.active ? renderStarterCard(starter, starterValue(shopProducts || [])) : '',
    wallPack.active ? renderWallPack(wallPack, packValue(wallPack.sku, shopProducts || [])) : '',
  ].join('');
  return `
    ${featured ? `<div class="panel shop-featured"><h2>For you</h2>${featured}</div>` : ''}
    <div class="panel">
      <h2>Gems</h2>
      <div class="muted">Gems buy time: Rally, fuel, drydock finishes and hires.</div>
      <ul class="gem-grid">
        ${products.map((p) => `
        <li class="gem-card${p.value?.best ? ' is-best' : ''}">
          ${p.value?.best ? '<span class="gem-ribbon">Best value</span>' : ''}
          <img src="${escapeHtml(productArt(p.sku))}" alt="" />
          <b>${escapeHtml(p.name)}</b>
          <span class="gem-amount">${p.grant.gems.toLocaleString('en-US')} gems</span>
          ${p.value?.morePct ? `<span class="gem-badge">+${p.value.morePct}% more</span>` : '<span class="gem-badge is-empty" aria-hidden="true"></span>'}
          <button class="primary" data-act="iap-buy" data-sku="${p.sku}">${p.price != null ? `$${p.price.toFixed(2)}` : 'Buy'}</button>
        </li>`).join('')}
      </ul>
    </div>
    ${renderCommissionCard(player, now)}
    <div class="panel">
      <h2>Fuel</h2>
      <div class="row">${fuelBuyButtons(player) || '<span class="muted">Tanks full.</span>'}</div>
    </div>
    <div class="panel">
      <h2>Hangar</h2>
      <div class="muted">Credits buy hulls slowly. Gems buy them now.</div>
      ${hullRows.slice(0, visibleHulls).map((s) => {
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
      ${hullRows.length > visibleHulls ? `<details class="hull-more"><summary>All hulls · ${hullRows.length - visibleHulls} more</summary>
        ${hullRows.slice(visibleHulls).map((s) => {
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
      </details>` : ''}
    </div>
    <div class="panel">
      ${renderPlatformLoginEntry()}
      ${qa ? `
      <div class="row" style="margin-top:8px">
        <button data-act="qa-gems">QA +100 gems</button>
        <button data-act="qa-fuel">QA +5 Fuel</button>
      </div>` : ''}
    </div>
  `;
}

export function renderQaSettings() {
  const muted = isSfxMuted();
  const musicOff = isMusicMuted();
  return `<div class="panel qa-settings"><h2>Settings</h2><p class="row"><button type="button" data-act="sfx-toggle" aria-pressed="${muted ? 'false' : 'true'}">Sound: ${muted ? 'Off' : 'On'}</button> <button type="button" data-act="music-toggle" aria-pressed="${musicOff ? 'false' : 'true'}">Music: ${musicOff ? 'Off' : 'On'}</button></p><p class="muted">Start the game again on this device.</p><button class="danger" data-act="restart-save">Restart save</button></div>`;
}

export function renderRestartSaveConfirm() {
  return `<div class="modal-backdrop contract-backdrop"><section class="contract-sheet" role="dialog" aria-modal="true" aria-label="Restart save confirmation"><h2>Restart your save?</h2><p>This erases this browser's Warp Crew progress and starts you over from the very beginning. Your Jest account stays signed in. This cannot be undone.</p><button class="danger" data-act="restart-save-confirm">Erase progress and restart</button><button data-act="restart-save-cancel">Keep my save</button></section></div>`;
}

/**
 * The hub's notice strip (Phase 2 §7): one button per thing waiting to be collected, newest kind last. The hold has
 * its own chip (it pulses when full), so it is not repeated here; the wall pack shows only while its offer is live.
 */
export function renderNoticeStrip(player, now = trustedNow()) {
  if (isTutorialActive(player)) return '';
  const items = [];
  const cal = calendarState(player, now);
  if (cal.canClaim) items.push({ attrs: 'data-act="calendar-open"', icon: 'art/pixel/ui/merc-pod.png', label: `Login calendar: day ${cal.nextDay} is ready` });
  const chests = chestState(player, now);
  if (chests.daily.ready) items.push({ attrs: 'data-act="chest-open" data-kind="daily"', icon: 'art/pixel/ui/chest-daily.png', label: 'Daily chest ready' });
  if (chests.weekly.ready) items.push({ attrs: 'data-act="chest-open" data-kind="weekly"', icon: 'art/pixel/ui/chest-weekly.png', label: 'Weekly chest ready' });
  const ready = achievementProgress(player).find(line => line.ready);
  if (ready) items.push({ attrs: 'data-tab="log"', icon: `art/pixel/ui/ach-${ready.track}.png`, label: `Achievement to claim: ${ready.title}` });
  const wall = currentWall(player, now);
  const pack = wallPackState(player, wall);
  if (pack.active) items.push({ attrs: 'data-act="goto-shop"', icon: `art/pixel/ui/wall-${pack.wallId}.png`, label: `${pack.wallId[0].toUpperCase()}${pack.wallId.slice(1)} wall pack in the shop` });
  if (!items.length) return '';
  return `<nav class="notice-strip" aria-label="Ready to collect">${items.map(item => `<button type="button" class="notice-btn" ${item.attrs} aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.label)}"><img src="${artUrl(item.icon)}" alt="" /><i class="notice-dot" aria-hidden="true"></i></button>`).join('')}</nav>`;
}

/** The ship's hold (Phase 2 §4): what the stations earned while you were away, and a tap to collect it. */
export function renderHoldChip(player, now = trustedNow()) {
  if (isTutorialActive(player) || !player?.idle) return '';
  const haul = idleHaul(player, now);
  const pct = holdPercent(haul);
  const amount = haul.credits ? `+${haul.credits.toLocaleString('en-US')}` : 'Hold';
  const label = haul.ready ? `Collect the hold: ${haul.credits} credits${haul.medals ? `, ${haul.medals} medals` : ''}, ${pct}% full` : `Hold ${pct}% full`;
  return `<button type="button" class="hold-chip${haul.full ? ' is-full' : ''}${haul.ready ? ' is-ready' : ''}" ${haul.ready ? 'data-act="idle-claim"' : 'disabled'} aria-label="${escapeHtml(label)}">
    <img src="${artUrl('art/pixel/ui/hold.png')}" alt="" /><span class="hold-amt">${escapeHtml(amount)}</span>
    <span class="hold-bar" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="hold-pct">${haul.full ? 'Full' : `${pct}%`}</span>
  </button>`;
}

/** Welcome back, Captain: after an hour or more away, the haul and how full the hold got. */
export function renderWelcomeBack(player, now = trustedNow()) {
  const haul = idleHaul(player, now);
  const pct = holdPercent(haul);
  const lines = [haul.credits ? `<li><img src="${ICONS.credits}" alt="" /><b>+${haul.credits.toLocaleString('en-US')}</b> credits</li>` : '',
    haul.medals ? `<li><img src="${ICONS.medals}" alt="" /><b>+${haul.medals.toLocaleString('en-US')}</b> medals</li>` : ''].join('');
  return `<div class="modal-backdrop welcome-backdrop">
    <section class="welcome-sheet" role="dialog" aria-modal="true" aria-label="Welcome back">
      <img class="welcome-art" src="${artUrl('art/pixel/cinematic/v2/welcome-back.png')}" alt="" />
      <span class="modal-kicker">While you were away</span>
      <h2>Welcome back, Captain</h2>
      <p>Your crew kept the stations running for ${escapeHtml(formatHoldSpan(haul.hours))}.</p>
      <ul class="welcome-haul">${lines}</ul>
      <div class="welcome-hold"><span>Hold</span><span class="hold-bar"><i style="width:${pct}%"></i></span><b>${haul.full ? 'Full' : `${pct}%`}</b></div>
      ${haul.full ? `<p class="muted">A full hold stops earning. It holds ${haul.capHours} hours; each Cargo level adds 1.</p>` : ''}
      <button class="primary" data-act="idle-claim">Collect</button>
      <button data-act="welcome-close">Later</button>
    </section>
  </div>`;
}

/** The login calendar sheet (Phase 2 design §2): 28 squares, today's glowing, the day-28 hire pod. */
export function renderCalendar(player, now = trustedNow()) {
  const state = calendarState(player, now);
  const icon = reward => reward.hire ? artUrl('art/pixel/ui/merc-pod.png')
    : reward.gems ? ICONS.gems : reward.marks ? artUrl('art/pixel/ui/marks.png') : reward.fuel ? ICONS.fuel
      : reward.medals && !reward.credits ? ICONS.medals : ICONS.credits;
  const label = reward => reward.hire ? 'Epic hire' : reward.gems ? `${reward.gems} gems` : reward.marks ? `${reward.marks} Marks`
    : reward.fuel ? `${reward.fuel} fuel` : reward.medals && !reward.credits ? `${reward.medals} medals` : `${reward.credits} cr`;
  // On the square the icon names the currency, so only the amount shows (the full words are in the aria-label).
  const short = reward => reward.hire ? 'Epic' : String(reward.gems || reward.marks || reward.fuel || (reward.medals && !reward.credits ? reward.medals : reward.credits));
  const squares = CALENDAR_REWARDS.map((reward, i) => {
    const day = i + 1;
    const done = day <= state.claimed;
    const today = day === state.nextDay && state.canClaim;
    const big = CALENDAR_MILESTONES.includes(day);
    return `<li class="cal-day${done ? ' is-done' : ''}${today ? ' is-today' : ''}${big ? ' is-big' : ''}" aria-label="Day ${day}: ${escapeHtml(label(reward))}${done ? ', claimed' : ''}">
      <span class="cal-num">${day}</span><img src="${escapeHtml(icon(reward))}" alt="" /><small>${escapeHtml(short(reward))}</small>
    </li>`;
  }).join('');
  return `<div class="modal-backdrop calendar-backdrop">
    <section class="calendar-sheet" role="dialog" aria-modal="true" aria-label="Login calendar">
      <span class="modal-kicker">Cycle ${state.cycle} · day ${Math.min(state.nextDay, CALENDAR_LENGTH)} of ${CALENDAR_LENGTH}</span>
      <h2>Captain's log-in</h2>
      <p class="muted">One square a day. Miss a day and it waits for you.</p>
      <ol class="cal-grid">${squares}</ol>
      ${state.canClaim ? '<button class="primary" data-act="calendar-claim">Claim today</button>' : '<p class="muted">Today\'s square is claimed. Back tomorrow.</p>'}
      <button data-act="calendar-close">${state.canClaim ? 'Later' : 'Close'}</button>
    </section>
  </div>`;
}

/** Achievements (Phase 2 design §5): one row per line with its track badge, progress to the next tier and a claim. */
export function renderAchievements(player) {
  const lines = achievementProgress(player);
  const ready = lines.filter(line => line.ready).length;
  const label = Object.fromEntries(ACHIEVEMENT_TRACKS.map(track => [track.id, track.label]));
  const rows = [...lines].sort((a, b) => Number(b.ready) - Number(a.ready)).map(line => {
    const goal = line.next?.goal;
    const pct = goal ? Math.min(100, Math.round((line.value / goal) * 100)) : 100;
    const reward = line.next ? formatReward(line.next.reward) : '';
    return `<li class="ach-row${line.ready ? ' is-ready' : ''}${line.next ? '' : ' is-complete'}">
      <img src="${artUrl(`art/pixel/ui/ach-${line.track}.png`)}" alt="" />
      <div class="ach-body">
        <b>${escapeHtml(line.title)}</b><span class="ach-track">${escapeHtml(label[line.track])}</span>
        <span class="ach-pips" aria-label="Tier ${line.claimed} of ${line.tiers}">${'●'.repeat(line.claimed)}${'○'.repeat(line.tiers - line.claimed)}</span>
        ${line.next ? `<div class="ach-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(line.value, goal)}"><span style="width:${pct}%"></span></div>
        <small>${Math.min(line.value, goal).toLocaleString('en-US')} / ${goal.toLocaleString('en-US')} ${escapeHtml(line.unit)} · ${escapeHtml(reward)}</small>` : '<small>All tiers done</small>'}
      </div>
      ${line.ready ? `<button class="primary" data-act="achievement-claim" data-id="${line.id}">Claim</button>` : ''}
    </li>`;
  }).join('');
  return `<div class="panel achievements-panel"><h2>Achievements${ready ? ` · ${ready} to claim` : ''}</h2><ul class="ach-list">${rows}</ul></div>`;
}

/** A chest's "Possible contents": the fixed part and each bonus with its odds (Jest's rule for random rewards). */
function renderChestOdds(kind) {
  const odds = chestOdds(kind);
  return `<details class="chest-odds"><summary>Possible contents</summary>
    <p>Always: ${odds.fixed.map(item => escapeHtml(item.label)).join(', ')}.</p>
    <p>Plus one of:</p><ul>${odds.bonus.map(item => `<li><span>${escapeHtml(item.label)}</span><b>${item.chance}%</b></li>`).join('')}</ul>
  </details>`;
}

/** The day's orders (Phase 2 §3): five tasks worth points toward the daily chest, and the weekly chest. */
export function renderOrders(player, now = trustedNow()) {
  const plan = dailyPlan(player, now);
  const state = ensureDailyLoop(player, now).dailyLoop;
  const chests = chestState(player, now);
  const pct = Math.min(100, Math.round((plan.points / plan.goal) * 100));
  const rows = DAILY_MILESTONES.map(m => {
    const done = state[m.id] === true;
    return `<div class="week-row ${done ? 'done' : ''}"><span class="mark">${done ? '●' : '○'}</span><span>${escapeHtml(m.label)}</span><span class="prog">${done ? 'Done' : `+${m.points}`}</span></div>`;
  }).join('');
  const tutorial = isTutorialActive(player);
  const daily = chests.daily;
  const weekly = chests.weekly;
  const dailyAction = tutorial ? '' : daily.ready ? '<button class="primary" data-act="chest-open" data-kind="daily">Open</button>'
    : daily.opened ? '<span class="muted">Opened · new orders tomorrow</span>' : `<span class="muted">${Math.min(plan.points, plan.goal)} / ${plan.goal} points</span>`;
  const weeklyAction = tutorial ? '' : weekly.ready ? '<button class="primary" data-act="chest-open" data-kind="weekly">Open</button>'
    : weekly.opened ? '<span class="muted">Opened · next one from Monday</span>' : `<span class="muted">${weekly.count} / ${weekly.goal} daily chests</span>`;
  return `<div class="panel orders-panel">
    <h2>Daily orders · ${Math.min(plan.points, plan.goal)}/${plan.goal}</h2>
    <div class="orders-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${plan.goal}" aria-valuenow="${Math.min(plan.points, plan.goal)}"><span style="width:${pct}%"></span></div>
    ${rows}
    <div class="chest-row${daily.ready ? ' is-ready' : ''}"><img src="${artUrl(daily.opened ? 'art/pixel/ui/chest-daily-open.png' : 'art/pixel/ui/chest-daily.png')}" alt="" />
      <div><b>Daily chest</b><small>Free with ${plan.goal} points of orders</small></div>${dailyAction}</div>
    ${renderChestOdds('daily')}
    <div class="chest-row${weekly.ready ? ' is-ready' : ''}"><img src="${artUrl(weekly.opened ? 'art/pixel/ui/chest-weekly-open.png' : 'art/pixel/ui/chest-weekly.png')}" alt="" />
      <div><b>Weekly chest</b><small>Open ${weekly.goal} daily chests this week (Monday to Sunday) <span class="chest-pips" aria-label="${weekly.count} of ${weekly.goal}">${'●'.repeat(weekly.count)}${'○'.repeat(weekly.goal - weekly.count)}</span></small></div>${weeklyAction}</div>
    ${renderChestOdds('weekly')}
  </div>`;
}

export function renderLog(player, log, goals) {
  const prog = storyProgress(player);
  const collected = new Set((player.crew || []).map((c) => c.templateId)).size;
  const rank = reputationRank(player.wallet.reputation || 0);
  const cal = calendarState(player);
  return `
    ${isTutorialActive(player) ? '' : `<div class="panel calendar-row"><img src="${artUrl('art/pixel/ui/merc-pod.png')}" alt="" />
      <div><h2>Login calendar</h2><span class="muted">${cal.canClaim ? `Day ${cal.nextDay} of ${CALENDAR_LENGTH} is ready` : `Day ${cal.claimed} of ${CALENDAR_LENGTH} claimed · back tomorrow`}</span></div>
      <button class="${cal.canClaim ? 'primary' : ''}" data-act="calendar-open">${cal.canClaim ? 'Claim' : 'View'}</button></div>`}
    ${renderOrders(player)}
    ${renderAchievements(player)}
    <div class="panel">
      <h2>Career</h2>
      <div class="muted">${escapeHtml(rank.label)} · Ch.${prog.chapter} · ${collected} mercs</div>
    </div>
    <div class="panel">
      <h2>Story</h2>
      ${prog.beats.filter((b) => b.unlocked).slice(-6).map((b) => `
        <div class="week-row">
          <span class="mark">●</span>
          <span>${escapeHtml(b.title)}</span>
          <span class="prog">Ch.${b.chapter}</span>
        </div>
      `).join('') || '<div class="muted">Story beacons you visit show up here.</div>'}
    </div>
    <div class="panel">
      <h2>Log</h2>
      <div class="log">${(log || []).slice(-16).map(escapeHtml).join('\n') || '—'}</div>
    </div>
    ${renderQaSettings()}
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&' + 'amp;', '<': '&' + 'lt;', '>': '&' + 'gt;', '"': '&' + 'quot;', "'": '&#39;' }[ch])
  );
}
