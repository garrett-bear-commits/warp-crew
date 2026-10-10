// @ts-nocheck
import { createNewPlayer, migratePlayer, tickCrewStatus } from './systems/player.js';
import { consumeFreshStart } from './systems/qaFreshStart.js';
import { claimFuelRegen } from './systems/fuel.js';
import { prepareSession, sessionModels, persistSessionTransition } from './systems/sessionLoop.js';
import { pullOnce, pullTen, redeemMarks, buyLuck, contractHire, callUpReserve, sellReserve, benchCrew, LUCK_CAP } from './systems/gacha.js';
import { canAfford, pay, grant, hullRepairOffer, fuelCreditPrice, formatReward, clampFuel } from './systems/economy.js';
import {
  resolveExpedition,
  applyExpeditionResult,
  skipExpeditionJob,
  EXPEDITION_SKIP_GEMS,
  abortPayoutFrac,
} from './systems/expedition.js';
import { applyDailyLogin } from './systems/daily.js';
import { calendarState } from './systems/calendar.js';
import { idleHaul, WELCOME_BACK_MS } from './systems/idle.js';
import { syncAllNotifications } from './systems/notifications.js';
import { listShopProducts, PRODUCT_DEFS } from './systems/iap.js';
import { SHIPS } from './data/ships.js';
import { repairHull } from './systems/passives.js';
import {
  init as platformInit,
  markGameLoaded,
  setLoadingProgress,
  getPlayer as getJestPlayer,
  isReal,
  captureEvent,
  getEntryPayload,
  showRegistrationOverlay,
  login,
  getSubscriptions,
  beginSubscription,
  cancelSubscription,
  claimRetentionOffer,
} from './shared/platform.js';
import { renderApp } from './ui/bridge.js';
import { buyHull, switchHull } from './systems/hangar.js';
import {
  noteTutorialEvent,
  dismissTutorial,
  isTutorialActive,
  isTabUnlocked,
  isFeatureUnlocked,
  preferredTab,
  skipOrders,
} from './systems/tutorial.js';
import { prepareCrewArt, hasCrewArt } from './ui/crewArt.js';
import { cancelCrewDeparture, holdCrewForDeparture, moveCrewToDeparture, holdCrewForArrival, moveCrewToArrival, stopCrewSim } from './ui/crewWalk.js';
import { playLaunch } from './ui/spaceFlight.js';
import { playCombat, playEncounterBeat, isBattlePlaying } from './ui/combatView.js';
import { createGuidedBeatScheduler } from './ui/guidedBeatScheduler.js';
import { sfx, unlockSfx } from './ui/juice.js';
import { toggleSfxMuted, preloadSfx } from './ui/sound.js';
import { unlockMusic, setMusicScene, toggleMusicMuted } from './ui/music.js';
import { musicScene } from './data/musicManifest.js';
import { rewardEntry, rewardItems, walletGain, rewardCardRects, centreCards, flyToWallet, productArt, TIER_SOUNDS } from './ui/rewardReveal.js';
import { panelTypingMs } from './ui/transmission.js';
import { transmissionById } from './systems/campaign.js';
import { startStageLoop } from './ui/stageLoop.js';
import { preloadEssentialAssets, loadEssentialImage } from './ui/essentialPreload.js';
import { ART_VERTICAL_SLICE } from './data/artManifest.js';
import { artUrl } from './shared/artUrl.js';
import { STARTER_OFFER, starterOfferState, markStarterOffer, markWallPackSeen, wallPackState } from './systems/offers.js';
import { trustedNow, useClock } from './shared/time.js';
import { refreshCommission, subscribeCommission, cancelCommission, acceptRetention, claimCommissionDaily, syncCommission, usableTerms } from './systems/subscription.js';
import { currentWall } from './systems/walls.js';
import { createWarpcrew, readPreview } from './core/client.js';
import { readConfig } from './core/config.js';
import { readLegacySave } from './core/legacy.js';
import { renderCoreOverlay } from './ui/coreOverlay.js';
import { applyResolvedSlicePortraits, SPACE_ART } from './data/portraits.js';
import { canonicalRoomId } from './data/starterShip.js';

let app = null;
let mountId = 0;
const log = [];
let player = null;
let tab = 'ship';
let pendingCombat = null;
let sessionUi = { missionView: 'contracts', reviewedOfferId: null, selectedExpeditionId: null, selectedExpeditionCrewIds: [] };
let selectedRoom = null;
let selectedCrewId = null;
let confirmRestartSave = false;
/** The hire reveal on screen (pods and cards), and whether the odds sheet is open. UI only, never saved. */
let hireReveal = null;
/** Reward reveals waiting their turn (src/ui/rewardReveal.js). UI only, never saved. */
let rewardQueue = [];
/**
 * Story transmissions waiting their turn (src/ui/transmission.js), the panel on screen, when it opened and whether
 * its line is shown whole. UI only: the session records a transmission as seen when it queues it.
 */
let transmissionQueue = [];
let txPanel = 0;
let txOpenedAt = 0;
let txInstant = false;
/** The Almanac's open section, or null when it is shut (UI only). */
let almanacSection = null;
/** The login calendar sheet is open (UI only). It opens on the first boot of a day with a square to claim. */
let calendarOpen = false;
/** The welcome-back screen is open (UI only): on boot after an hour or more away with income in the hold. */
let welcomeBackOpen = false;
let hireOddsOpen = false;
/** Cancel-save sheet for the Captain's Commission subscription. */
let commissionWinback = false;
/** FTL-lite fight screen: crew picked for a move, and the tap-to-pause state. */
let ftlSelectedCrewId = null;
let ftlPaused = false;
let cinematic = null;
let platformStatus = 'booting';
let shopProducts = null;
let artReady = false;
let toast = null;
let toastTimer = 0;
let departureInFlight = false;
let departureRunId = 0;
let shipSequence = null;
let essentialProgress = 0;
let essentialReady = false;
let essentialScene = artUrl(ART_VERTICAL_SLICE.splash.path);
/** The game on @foundation/client (src/core/client.js); null until boot creates it. */
let wc = null;
/** Core boot phase (prompt / cloud unreachable / blocked) and this tab's leader role, for the overlay. */
let coreBoot = null;
let coreFollower = false;
let coreLive = false;

/** Preserve the saved tutorial script. migratePlayer owns script selection. */
export function restoreTutorialPlayer(savedPlayer) {
  return migratePlayer(savedPlayer);
}

export function resolveEntryTab(currentPlayer, entry, currentTab = 'ship') {
  if ([4, 5].includes(currentPlayer?.tutorial?.script) && isTutorialActive(currentPlayer)) return 'ship';
  if (entry?.notification_type === 'daily_pull') return 'crew';
  if (entry?.notification_type === 'expedition_done' || entry?.notification_type === 'fuel_full') return 'missions';
  return currentTab;
}

export function freshBootCrewMessage(currentPlayer) {
  const names = (currentPlayer?.crew || []).map(member => member.name);
  if (!names.length) return 'No crew on deck yet. Choose your captain.';
  return `Crew on deck — ${names.join(' and ')}.`;
}

/** Queue a story transmission by id or entry (unknown ids are ignored); the first one chirps as it opens. */
function showTransmission(entry) {
  const tx = typeof entry === 'string' ? transmissionById(entry) : entry;
  if (!tx?.panels?.length) return;
  transmissionQueue.push(tx);
  if (transmissionQueue.length === 1) openTransmission();
}

function openTransmission() {
  txPanel = 0;
  txOpenedAt = performance.now();
  txInstant = false;
  if (transmissionQueue[0]) sfx('beacon');
}

/** Queue a reward reveal (null entries are ignored); the first one sounds as it opens. */
function showReward(entry) {
  if (!entry) return;
  rewardQueue.push(entry);
  if (rewardQueue.length === 1) rewardSound(entry);
}

function rewardSound(entry) {
  (TIER_SOUNDS[entry.tier] || TIER_SOUNDS.small).forEach((name, i) => sfx(name, { delay: i * 0.22 }));
}

function showToast(next) {
  toast = next || null;
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = 0;
  }
  if (toast) {
    toastTimer = setTimeout(() => {
      toast = null;
      toastTimer = 0;
      render();
    }, 4200);
  }
}

/** A shop item's player-facing name, never its internal id. */
function productName(sku) {
  return PRODUCT_DEFS[sku]?.name || 'your pack';
}

function pushLog(msg) {
  log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  while (log.length > 50) log.shift();
}

const SESSION_ERROR_COPY = {
  fuel_full: 'Fuel tanks are already full.',
  drydock_busy: 'The drydock is already building an upgrade.',
  already_owned: 'That weapon is already in the armory.',
  unknown_weapon: 'That weapon is not for sale.',
  cannot_afford: 'Not enough credits.',
  no_slot: 'Upgrade Weapons for another slot.',
  not_owned: 'Buy that weapon first.',
  in_fight: 'Refit the guns after the fight.',
  not_enough_gems: 'Not enough gems.',
  no_build: 'Nothing is building in the drydock.',
  save_failed: 'Could not save. Try again.',
  travel_fight_active: 'Finish the fight on the Ship tab first.',
  combat_pending: 'Finish the fight on the Ship tab first.',
  tutorial_action_locked: 'Finish the current step first.',
  tutorial_station_required: 'Assign your crew member to the required station first.',
  brace_required: 'Brace before the pirate fires.',
  target_weapons_required: 'Target the pirate weapons before advancing.',
  guided_encounter_unavailable: 'The distress call is no longer available.',
  ship_name_unavailable: 'Name the ship after the first job.',
  invalid_ship_name: 'Use a ship name up to 24 characters.',
  welcome_unavailable: 'The welcome recruit is no longer available.',
  not_leader: 'Warp Crew is open in another tab. Tap Play here to fly from this one.',
  registration_unavailable: 'Finish meeting your new crew first.',
  registration_unconfirmed: 'Jest sign-in did not finish. You can skip it.',
  stale_encounter_action: 'The fight moved on. Choose again.',
  encounter_finished: 'The fight is over. Bring the cargo aboard.',
  not_enough_fuel: 'Not enough fuel for this job.',
  hull_critical: 'Repair your hull before the next job.',
  // Sector map and events.
  no_lane: 'No lane from here. Jump along the lanes.',
  already_here: 'You are already here.',
  locked_node: 'That beacon is not on your charts yet.',
  siege_wall: 'A flagship holds this gate. Break its Siege wall first.',
  event_active: 'Deal with the event first.',
  stale_event: 'That event is over. Check the log.',
  no_active_event: 'That event is over. Check the log.',
  choice_unavailable: 'That choice is not available right now.',
};

export function sessionFailureMessage(reason, currentPlayer = null) {
  if (reason === 'tutorial_station_required' && currentPlayer?.tutorial?.script === 5) {
    const member = currentPlayer.crew?.find(c => c.instanceId === currentPlayer.tutorial.firstHireInstanceId);
    if (member) return `Assign ${member.name} to ${member.templateId === 'merc_bolt' ? 'Shields' : 'Weapons'} first.`;
  }
  return SESSION_ERROR_COPY[reason] || 'That action is unavailable right now.';
}

/**
 * Hand the live player to the core client (engine `set`), which saves it. A follower tab, a boot
 * prompt or a refused change leaves the core's player in place; the live copy follows it.
 */
function persist(reason = 'ui', priority) {
  if (!wc || !coreLive) return false;
  const ok = wc.commit(player, reason, priority);
  if (!ok) player = wc.state();
  return ok;
}

/** True when this tab may change the game (the core's leader tab, live, no prompt open). */
function canWrite() {
  return Boolean(wc && coreLive && !coreFollower && wc.client.leader.isLeader());
}

const subscriptionDeps = () => ({
  sdk: { getSubscriptions, beginSubscription, cancelSubscription, claimRetentionOffer },
  real: isReal(),
  // Real Jest answers are trusted only once the core server verified Jest's signature.
  verify: wc?.online ? wc.verifySubscriptions : null,
  now: trustedNow,
});

/** Pay today's Commission perks once, with a toast. */
function claimCommissionPerks() {
  const daily = claimCommissionDaily(player, trustedNow());
  if (!daily.granted) return;
  player = daily.player;
  pushLog(`Captain's Commission: +${daily.granted.gems} gems, +${daily.granted.drydockFinishes} drydock finish.`);
  showReward(rewardEntry({ source: 'commission', title: "Captain's Commission", subtitle: 'Today\'s perks',
    items: rewardItems({ gems: daily.granted.gems }) }));
}

/** Online boot work: incomplete purchases, waiting grants (any device), one-time ownership. */
async function syncServerOnBoot() {
  if (!wc?.online) return;
  const before = { ...(player?.wallet || {}) };
  // Leader only: a follower tab defers this until it leads (src/core/client.js serverSync).
  const work = await wc.serverSync();
  if (work.deferred) return;
  const { recovered, pending } = work;
  player = wc.state();
  if (pending.claimed.length || recovered.completed) {
    pushLog(`Purchases delivered: ${pending.claimed.map(g => productName(g.reason.replace(/^purchase /, ''))).join(', ') || `${recovered.completed} restored`}.`);
    showReward(rewardEntry({ source: 'purchase', title: 'Purchase delivered', subtitle: 'Thank you, Captain',
      items: rewardItems(walletGain(before, player.wallet)) }));
  }
}

async function refreshNotifs() {
  try {
    await syncAllNotifications(player, trustedNow());
  } catch (e) {
    console.warn('notif sync', e);
  }
}

function finishExpeditionResult(res) {
  const transition = applyExpeditionResult(player, res, { now: trustedNow() });
  if (!transition.ok) return;
  player = transition.player;
  const skipNote = res.skipped ? ' (skipped)' : res.aborted ? ' (extract)' : '';
  const paid = formatReward(res.rewards);
  pushLog(
    res.success
      ? `Expedition success${skipNote}! ${paid}${res.flavor ? ` — ${res.flavor}` : ''}`
      : `Expedition failed${skipNote}. ${paid}${res.flavor ? ` — ${res.flavor}` : ''}`
  );
  const reveal = res.success ? rewardEntry({ source: 'expedition', title: 'Expedition complete', subtitle: res.flavor || '',
    items: rewardItems(res.rewards) }) : null;
  if (reveal) showReward(reveal);
  else {
    showToast({ title: res.success ? 'Expedition complete' : res.aborted ? 'Early extract' : 'Expedition failed', rewards: res.rewards });
    sfx(res.success ? 'coin' : 'hit');
  }
}

function tryResolveExpedition({ force = false } = {}) {
  if (!player.activeExpedition) return false;
  const res = resolveExpedition(player.activeExpedition, { forceComplete: force, player, now: trustedNow() });
  if (!res.ready) return false;
  finishExpeditionResult(res);
  return true;
}

/**
 * What the screen shows before the core has booted: this device's last save (read only), the
 * legacy save on the first boot after the port, or a new captain. Input waits for boot.
 */
function provisionalPlayer() {
  try {
    const cfg = readConfig();
    const local = readPreview(globalThis.localStorage, cfg.gameId) || readLegacySave(globalThis.localStorage);
    if (local) return restoreTutorialPlayer(local);
  } catch { /* storage blocked */ }
  return createNewPlayer({ captainName: getJestPlayer()?.username || 'Captain' });
}

/** After boot: the welcome, daily login, offline fuel, finished expeditions and the session board. */
function hydratePlayer({ fresh, newCaptain }) {
  const jestPlayer = getJestPlayer();
  player = restoreTutorialPlayer(wc.state());
  if (fresh) pushLog('QA fresh start (?fresh=1).');
  if (!newCaptain) pushLog('Welcome back, Captain.');
  else {
    pushLog('Career start aboard Sparrow.');
    pushLog(freshBootCrewMessage(player));
  }
  if (player.captainName === 'Captain' && jestPlayer?.username) player = { ...player, captainName: jestPlayer.username };

  player = {
    ...player,
    _jestRegistered: Boolean(jestPlayer?.registered),
    _jestPlayerId: jestPlayer?.playerId || null,
  };

  if (isTutorialActive(player)) {
    tab = [4, 5].includes(player.tutorial.script) ? 'ship' : preferredTab(player, tab);
  }

  const daily = applyDailyLogin(player, trustedNow());
  if (!isTutorialActive(player) || player.tutorial?.phase === 'done') {
    player = daily.player;
    if (daily.isNewDay) pushLog(`Day ${daily.streak} in a row aboard.`);
    if (calendarState(player, trustedNow()).canClaim) calendarOpen = true;
    const haul = idleHaul(player, trustedNow());
    // An hour or more of income waiting (hours earned, not time since the clock last moved: it moves on every change).
    if (haul.ready && haul.hours * 3600000 >= WELCOME_BACK_MS) welcomeBackOpen = true;
  } else if (daily.isNewDay) {
    // Hold the day-1 streak without dumping extra currencies into the intro.
    player = {
      ...player,
      lastLoginDay: daily.player.lastLoginDay,
      loginStreak: daily.player.loginStreak,
    };
  }

  const claimed = claimFuelRegen(syncCommission(player, trustedNow()), trustedNow());
  player = tickCrewStatus(claimed.player, trustedNow());
  if (claimed.gained > 0) pushLog(`Offline fuel +${claimed.gained}.`);
  tryResolveExpedition();
  player = prepareSession(player, trustedNow());
  persist('hydrate');
  if (player.activeContract?.stage === 'return') { tab = 'ship'; selectedRoom = 'cargo'; }
  else if (player.activeTravelFight) { tab = 'ship'; selectedRoom = null; }
  else if (player.tutorial?.phase === 'away') sessionUi.missionView = 'away';
}

/** Build the core client and boot it: identity, this device's slot, the server head, reconcile. */
async function bootCore(initResult) {
  const config = readConfig();
  const jest = isReal() && initResult.mode === 'jest';
  wc = createWarpcrew({
    config,
    platformKind: jest ? 'jest' : 'mock',
    // Inside the real Jest shell a missing server disables purchasing (no local mock grants).
    jestShell: isReal(),
    sdkInit: () => platformInit(),
    onError: (error, detail) => console.warn('[warp-crew]', error, detail || ''),
  });
  useClock(wc.clock);
  // Development builds only: the core client on the console for QA (`__warpcrew.state()`).
  if (config.dev) globalThis.__warpcrew = wc;
  // QA's fresh-save link clears this device once (and, online, opens a new server generation).
  let fresh = false;
  try { fresh = consumeFreshStart({ location, history, clearSave: () => {} }); } catch { /* no location */ }
  const booted = await wc.boot({
    fresh,
    onBootState: (st) => {
      coreBoot = ['prompt', 'cloudUnreachable', 'blocked'].includes(st.phase) ? st : null;
      render();
    },
  });
  coreBoot = null;
  coreLive = true;
  const newCaptain = fresh || (booted.decision?.action === 'start_new' && !booted.importedLegacy);
  if (booted.importedLegacy) pushLog('Save moved to the new save system.');
  if (booted.decision?.action === 'adopt_remote') pushLog('Cloud save restored from another device.');
  // The core may replace the player (a deeper save from another device, a restore, a new
  // generation): the live copy follows it.
  wc.client.subscribe((published) => {
    if (published.state === player) return;
    player = published.state;
    scheduleRender();
  });
  wc.client.onEvent((event) => {
    if (event.type === 'leader') {
      coreFollower = event.role === 'follower';
      if (!coreFollower) { player = wc.state(); scheduleGuidedBeat(); }
      render();
    } else if (event.type === 'follower_blocked') {
      coreFollower = true;
      render();
    }
  });
  coreFollower = !wc.client.leader.isLeader();
  if (!wc.online && typeof document !== 'undefined') {
    // No server, no teardown beacon: write this device's slot when the page hides.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') wc?.save('immediate'); });
    globalThis.addEventListener?.('pagehide', () => wc?.save('immediate'));
  }
  platformStatus = `${jest ? `jest (${initResult.mode})` : `local mock (${initResult.mode})`} · ${wc.online ? 'cloud save' : 'saved on this device'}`;
  return { fresh, newCaptain };
}

async function boot() {
  sessionUi.guidedBeatSaveFailed = null;
  essentialProgress = 0;
  essentialReady = false;
  essentialScene = artUrl(ART_VERTICAL_SLICE.splash.path);
  try {
    player = provisionalPlayer();
    artReady = hasCrewArt();
    render();
  } catch (e) {
    console.warn('preview', e);
  }

  const sliceKeys = ['splash', 'rex', 'bolt', 'kira', 'tink', 'nemi'];
  const essentials = sliceKeys
    .map(key => ({ src: artUrl(ART_VERTICAL_SLICE[key].path), fallback: artUrl(ART_VERTICAL_SLICE[key].fallback) }));
  essentials.push({ src: SPACE_ART.hull, fallback: artUrl('art/pixel/ships/sparrow-cutaway.jpg') });
  const essentialP = preloadEssentialAssets(essentials, loadEssentialImage, progress => {
    essentialProgress = progress;
    setLoadingProgress(progress);
    render();
  }).then(paths => {
    essentialScene = paths[0];
    applyResolvedSlicePortraits(Object.fromEntries(sliceKeys.map((key, index) => [key, paths[index]])));
    essentialReady = true;
    render();
  });

  const initResult = await platformInit();
  platformStatus = isReal()
    ? `jest (${initResult.mode})`
    : `local mock (${initResult.mode})`;
  setLoadingProgress(essentialProgress);

  hydratePlayer(await bootCore(initResult));
  render();

  const entry = getEntryPayload();
  if (entry?.notification_type) {
    pushLog('Opened from a reminder.');
    captureEvent('open_from_notification', entry);
  }
  tab = resolveEntryTab(player, entry, tab);

  const crewArtP = prepareCrewArt()
    .then(() => {
      artReady = true;
      render();
    })
    .catch((e) => console.warn('crew art', e));

  try {
    await syncServerOnBoot();
  } catch (e) {
    console.warn('purchase sync', e);
  }

  try {
    const sub = await refreshCommission(player, subscriptionDeps());
    player = sub.player;
    claimCommissionPerks();
    persist('commission', 'immediate');
  } catch (e) {
    console.warn('subscription refresh', e);
  }

  try {
    shopProducts = await listShopProducts();
  } catch {
    shopProducts = null;
  }

  await Promise.all([essentialP, crewArtP, refreshNotifs().catch((e) => console.warn('notif sync', e))]);
  persist('boot');
  setLoadingProgress(essentialProgress);
  markGameLoaded();
  captureEvent('session_start', {
    platform: isReal() ? 'jest' : 'local',
    streak: player.loginStreak,
  });
  render();
  scheduleGuidedBeat();
}

let renderQueued = false;
/** Render once after the current call stack (core publications arrive mid-dispatch). */
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; render(); });
}

function render() {
  if (!app || !player) return;
  // Timed systems settle when read (injuries heal, builds finish, boards refresh): the engine's
  // `prepare` commits them at the trusted now, only when something changed.
  if (canWrite()) {
    const now = trustedNow();
    if (prepareSession(tickCrewStatus(player, now), now) !== player && wc.prepare()) player = wc.state();
  }
  const renderNow = trustedNow();
  setMusicScene(musicScene(player, tab));
  // Contract cards carry win odds played from the real fight (cached by fight setup, so renders stay cheap).
  const models = sessionModels(player, { ...sessionUi, pendingCombat }, renderNow, { fightOdds: true });
  sessionUi.contractPreviews = models.contractPreviews;
  renderApp(app, {
    ...sessionUi,
    ...models,
    player,
    now: renderNow,
    log,
    tab,
    pendingCombat,
    selectedRoom,
    selectedCrewId,
    confirmRestartSave,
    commissionWinback,
    hireReveal,
    rewardReveal: rewardQueue[0] || null,
    transmission: transmissionQueue[0] || null,
    almanacSection,
    transmissionView: { panel: txPanel, instant: txInstant },
    calendarOpen,
    welcomeBackOpen,
    hireOddsOpen,
    ftlSelectedCrewId,
    ftlPaused,
    cinematic,
    platformStatus,
    jestLive: isReal(),
    shopProducts,
    artReady,
    splashProgress: essentialProgress,
    splashReady: essentialReady,
    splashScene: essentialScene,
    toast,
    departureInFlight,
    shipSequence,
    handlers: {
      setTab: (t) => {
        if (isBattlePlaying()) return;
        if (!isTabUnlocked(player, t)) return;
        if (t === 'missions') {
          handleAction(player.tutorial?.phase === 'away' ? 'goto-away' : 'goto-contracts');
          return;
        }
        tab = t;
        selectedRoom = null;
        sfx('tap');
        render();
      },
      onAction: userAction,
    },
  });
  // The core's own screens: keep-this-device / use-cloud prompt, cloud unreachable, update
  // required, and "Play here" for a second tab. They sit above the game shell.
  let overlay = app.querySelector(':scope > .wc-core-overlay');
  const html = renderCoreOverlay({ boot: coreBoot, follower: coreFollower && coreLive });
  if (!html) overlay?.remove();
  else {
    if (!overlay) {
      overlay = app.ownerDocument.createElement('div');
      overlay.className = 'wc-core-overlay';
      app.appendChild(overlay);
    }
    if (overlay.innerHTML !== html) overlay.innerHTML = html;
  }
}

async function handleJoinJest({ reason = 'shop_prompt' } = {}) {
  if (reason === 'first_session' && !isReal()) return { registered: false, unavailable: true };
  const jp = getJestPlayer();
  if (jp?.registered) {
    pushLog(`Already registered as ${jp.username || jp.playerId}.`);
    return { registered: true, username: jp.username };
  }

  if (isReal()) {
    const { loginButtonAction } = showRegistrationOverlay({
      theme: 'dark',
      message: 'Optional Jest sign-in. {{registrationCode}} is my code.',
      entryPayload: { reason },
      onClose: () => {},
    });
    try {
      // In Jest the core's identity signs in (and re-reads the player and its token).
      if (wc?.platform.name === 'jest') await wc.platform.identity.login({ reason });
      else await login({ entryPayload: { reason } });
      const after = getJestPlayer();
      if (after?.registered) {
        pushLog('Signed in to Jest.');
        return { registered: true, username: after.username };
      } else {
        pushLog('Sign-in closed.');
      }
    } catch {
      pushLog('Login flow closed.');
      loginButtonAction?.();
    }
    return { registered: false };
  }

  await login();
  const after = getJestPlayer();
  if (after?.registered) pushLog('Signed in to Jest.');
  return { registered: Boolean(after?.registered), username: after?.username };
}

const guidedBeatScheduler = createGuidedBeatScheduler({
  getPlayer: () => app ? player : null,
  advance: data => handleAction('encounter-advance', data),
  isBattlePlaying,
  // Fights hold while the app is hidden, the player is off the ship, the captain paused, or
  // another tab is playing (only the leader tab writes).
  isPaused: () => document.hidden || tab !== 'ship' || ftlPaused || !canWrite(),
  onSaveFailure: failedIdentity => {
    sessionUi.guidedBeatSaveFailed = failedIdentity;
    render();
  },
});

function scheduleGuidedBeat() { guidedBeatScheduler.schedule(); }

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'apex'];

/** One reveal card per hire: who, how rare, and what happened (new, star up, sold at max stars). */
const revealEntry = r => ({ templateId: r.instance?.templateId, name: r.instance?.name || 'Merc', rarity: r.rarity,
  kind: r.kind, stars: r.instance?.stars || 1, sold: r.sold || null, featured: r.featured === true });

/** The reveal sounds like its best card: a click, a beacon, a rally, or a fanfare for Legendary and up. */
function revealSound(results) {
  const top = results.reduce((best, r) => Math.max(best, RARITY_ORDER.indexOf(r.rarity)), 0);
  if (top >= 4) { sfx('win'); sfx('boom', { delay: 0.35 }); }
  else if (top === 3) sfx('rally');
  else if (top === 2) sfx('beacon');
  else sfx('card');
}

function doHire({ gems = false, ten = false, marks = false } = {}) {
  if (!isFeatureUnlocked(player, 'gacha')) {
    pushLog('Hiring opens after your first gunner signs on.');
    return false;
  }
  if (ten) {
    const res = pullTen(player);
    if (!res.ok) {
      pushLog(res.reason === 'cannot_afford' ? 'Need 900 gems for 10 hires.' : 'The 10 hires did not go through.');
      return false;
    }
    player = res.player;
    const rare = res.results.filter((r) => RARITY_ORDER.indexOf(r.rarity) >= 2).length;
    pushLog(`10 hires: ${rare} Rare or better. ${res.results.map(r => r.instance?.name).filter(Boolean).slice(0, 3).join(', ')}…`);
    hireReveal = { results: res.results.map(revealEntry) };
    revealSound(res.results);
    captureEvent('gacha_10', { rare, featured: res.results.filter(r => r.featured).length });
    tab = 'crew';
    return true;
  }
  const free = !gems && !marks && player.dailyPullAvailable;
  const res = marks ? redeemMarks(player) : pullOnce(player, { gems, free });
  if (!res.ok) {
    pushLog(marks ? `Need ${res.cost || 'more'} Contract Marks.` : gems ? 'Need 100 gems for a hire.' : 'Need credits for a hire.');
    return false;
  }
  player = res.player;
  const name = res.instance?.name || 'Merc';
  if (res.kind === 'hire') {
    pushLog(`Hired ${name} (${res.rarity}).`);
    const te = noteTutorialEvent(player, 'hired');
    player = te.player;
  } else if (res.kind === 'star') pushLog(`${name} stars up ★${res.instance.stars} (${res.rarity}).`);
  else if (res.kind === 'reserve') pushLog(`${name} (${res.rarity}) waits in reserve.`);
  else pushLog(`Hired ${name} (${res.rarity}) at max stars: sold for ${formatReward(res.sold)}.`);
  hireReveal = { results: [revealEntry(res)] };
  revealSound([res]);
  captureEvent('gacha_pull', { rarity: res.rarity, free, gems, marks, kind: res.kind, featured: res.featured === true });
  tab = 'crew';
  return true;
}

// One-time offers can only be bought while their offer is live.
function res0Blocked(sku, now = trustedNow()) {
  if (sku === STARTER_OFFER.sku) return !starterOfferState(player, now).active;
  if (sku.startsWith('wc_wall_')) {
    const pack = wallPackState(player, currentWall(player, now));
    return !pack.active || pack.sku !== sku;
  }
  return false;
}

// Interface sounds for taps. Fight orders and travel make their own sounds from their effects.
const QUIET_TAP_ACTS = new Set(['encounter-advance', 'encounter-order', 'sfx-toggle', 'music-toggle', 'travel-to', 'map-select', 'tx-next']);
const CONFIRM_ACTS = new Set(['contract-accept', 'exp-launch', 'exp-start', 'event-choose', 'ship-upgrade', 'level-crew',
  'daily-improve', 'captain-choose', 'tutorial-fight-start', 'combat-order', 'contract-order']);
const COIN_ACTS = new Set(['contract-claim', 'travel-claim', 'refuel-gems']);

/** Actions from the player's own taps: sound, then the shared handler. */
async function userAction(act, data = {}) {
  unlockSfx();
  unlockMusic();
  if (act === 'map-select') sfx('beacon');
  else if (!QUIET_TAP_ACTS.has(act)) sfx(CONFIRM_ACTS.has(act) ? 'confirm' : 'tap');
  const walletBefore = { ...(player?.wallet || {}) };
  const result = await handleAction(act, data);
  if (result?.ok === false) sfx('error');
  else if (result?.ok && COIN_ACTS.has(act)) {
    sfx('coin', { delay: 0.08 });
    // Contract and fight claims keep their result screen; what they paid flies from mid-screen to the wallet.
    flyToWallet(app, centreCards(walletGain(walletBefore, player?.wallet)));
  }
  return result;
}

/** Sounds for a committed session effect (fights voice their own beats in combatView). */
function effectSound(act, effect) {
  const travelled = act === 'travel-to';
  if (effect.kind === 'launch') sfx('launch');
  else if (effect.kind === 'crew-arrival' || effect.kind === 'expedition') sfx('arrive');
  else if (effect.kind === 'event-open') { if (travelled) sfx('jump'); sfx('card', { delay: travelled ? 0.55 : 0 }); }
  else if (effect.kind === 'travel') { if (travelled) sfx('jump'); if (effect.result?.rewards) sfx('coin', { delay: travelled ? 0.6 : 0 }); }
  else if (effect.kind === 'encounter-beat' && !effect.events?.length && !effect.outcome) {
    if (travelled) sfx('jump');
    sfx('lock', { delay: travelled ? 0.5 : 0 });
  }
}

/** The core's boot prompt, cloud-unreachable sheet, update reload and "Play here". */
async function handleCoreAction(act) {
  const machine = wc?.client.bootMachine;
  if (act === 'core-adopt-cloud') machine?.resolvePrompt('adopt_remote');
  else if (act === 'core-keep-local') machine?.resolvePrompt('keep_local');
  else if (act === 'core-retry') machine?.retry();
  else if (act === 'core-start-new') machine?.startNew();
  else if (act === 'core-reload') window.location.reload();
  else if (act === 'core-play-here' && wc) {
    await wc.client.playHere();
    coreFollower = !wc.client.leader.isLeader();
    player = wc.state();
    if (!coreFollower) scheduleGuidedBeat();
  }
  render();
}

async function handleAction(act, data = {}) {
  if (act.startsWith('core-')) return handleCoreAction(act);
  if (isBattlePlaying()) return;
  if (act === 'sfx-toggle') {
    const muted = toggleSfxMuted();
    if (!muted) sfx('tap');
    render();
    return;
  }
  if (act === 'music-toggle') {
    toggleMusicMuted();
    sfx('tap');
    render();
    return;
  }
  // Input waits for the core to boot; afterwards the live copy starts from the core's player.
  if (!coreLive) return;
  player = wc.state();
  if (act === 'restart-save') {
    if (tab !== 'log' || isTutorialActive(player)) return;
    confirmRestartSave = true;
    render();
    return;
  }
  if (act === 'restart-save-cancel') {
    confirmRestartSave = false;
    render();
    return;
  }
  if (act === 'restart-save-confirm') {
    if (!confirmRestartSave) return;
    // Online: a new save generation on the server (the old one stays restorable by support).
    // Offline: this device's save is cleared. Either way the page reloads into a new captain.
    const restarted = await wc.restart();
    if (!restarted.ok) {
      confirmRestartSave = false;
      showToast({ title: 'Could not restart save. Try again.' });
      render();
      return;
    }
    window.location.reload();
    return;
  }
  // Tutorial CTAs navigate to or invoke the same production actions as the board.
  if (['tutorial-next', 'tutorial-go', 'tutorial-jump'].includes(act)) {
    const phase = player.tutorial?.phase;
    if (phase === 'distress' || (phase === 'launch' && !player.activeContract)) {
      return handleAction('contract-review', { offer: 'offer_tutorial_distress' });
    }
    if (phase === 'recruit') return handleAction('tutorial-draw');
    if (phase === 'away') return handleAction('exp-choose', { planet: 'dustfall' });
    if (phase === 'return') { tab = 'ship'; selectedRoom = 'cargo'; render(); return; }
    return handleAction('goto-contracts');
  }
  if (act === 'ftl-select-crew') {
    ftlSelectedCrewId = ftlSelectedCrewId === data.crewId ? null : data.crewId || null;
    render();
    return;
  }
  if (act === 'ftl-pause') {
    ftlPaused = !ftlPaused;
    render();
    if (!ftlPaused) scheduleGuidedBeat();
    return;
  }
  if (act === 'encounter-command' && !data.command) {
    const type = data.commandType;
    data = { ...data, command: type === 'hold' ? { type, hold: data.hold === 'true' }
      : type === 'move' ? { type, crewId: data.crewId, room: data.room }
      : type === 'ability' ? { type, crewId: data.crewId }
      : type === 'auto' ? { type, auto: data.auto === 'true' } : { type, room: data.room } };
    if (type === 'move') ftlSelectedCrewId = null;
  }
  if (!player.activeEncounter || player.activeEncounter.result) { ftlSelectedCrewId = null; ftlPaused = false; }
  // Claiming closes its sheet. The session answers these acts and returns, so this must run first.
  if (act === 'calendar-claim') calendarOpen = false;
  if (act === 'idle-claim') welcomeBackOpen = false;
  // The engine runs sessionAction and commits its player; the core saves it.
  const ran = wc.session(act, data, { ...sessionUi, pendingCombat, tab, selectedRoom, selectedCrewId });
  const transition = ran.result;
  if (transition) {
    const departure = transition.effect?.kind === 'expedition';
    let startedDepartureId = null;
    const publishSessionResult = (result) => {
      player = result.player;
      sessionUi = { ...sessionUi, ...result.ui };
      if (result.effect?.kind === 'encounter-beat') sessionUi.guidedBeatSaveFailed = null;
      if ('pendingCombat' in result.ui) pendingCombat = result.ui.pendingCombat;
      if ('tab' in result.ui) tab = result.ui.tab;
      if ('selectedRoom' in result.ui) selectedRoom = result.ui.selectedRoom;
      if ('selectedCrewId' in result.ui) selectedCrewId = result.ui.selectedCrewId;
      render();
    };
    const committed = persistSessionTransition(transition, {
      save: () => ran.committed,
      publish: (result) => {
        if (departure) {
          startedDepartureId = ++departureRunId;
          departureInFlight = true;
          holdCrewForDeparture(transition.effect.crewInstanceIds);
        }
        if (result.effect?.kind === 'crew-arrival') holdCrewForArrival(result.player, result.effect.crewInstanceId);
        // Story first: a briefing, debrief or chapter finale plays before any reward flies (Phase 3 §1).
        for (const id of result.transmissions || []) showTransmission(id);
        if (['launch', 'crew-arrival'].includes(result.effect?.kind)) shipSequence = result.effect.kind === 'crew-arrival'
          ? { kind: 'crew-arrival', member: result.player.crew.find(c => c.instanceId === result.effect.crewInstanceId) }
          : 'launch';
        publishSessionResult(result);
      },
      capture: captureEvent,
      animate: (effect) => {
        effectSound(act, effect);
        if ((effect.kind === 'travel' || effect.kind === 'combat') && effect.result) logTravelResult(effect.result);
        if (effect.kind === 'launch') {
          playLaunch({ onDone: () => { if (shipSequence === 'launch') shipSequence = null; render(); } });
        }
        if (effect.kind === 'crew-arrival') {
          moveCrewToArrival(player, effect.crewInstanceId, { onDone: () => { if (shipSequence?.kind === 'crew-arrival') shipSequence = null; render(); } });
        }
        if (effect.kind === 'expedition') {
          const reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
          moveCrewToDeparture(player, effect.crewInstanceIds, {
            reducedMotion,
            onDone: () => {
              if (startedDepartureId !== departureRunId) return;
              departureInFlight = false;
              render();
            },
          });
        }
        if (effect.kind === 'combat') {
          if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            showToast({ title: effect.win ? 'Victory' : 'Hull holds' });
          } else {
            playCombat({ preview: effect.preview, win: effect.win, onDone: () => render() });
          }
        }
        if (effect.kind === 'encounter-beat') playEncounterBeat(effect.events);
        if (effect.kind === 'reward') {
          showReward(rewardEntry({ source: effect.source, title: effect.title, subtitle: effect.subtitle,
            art: effect.art ? artUrl(effect.art) : null, cta: effect.cta, tier: effect.tier,
            items: [...(effect.crew ? [{ kind: 'crew', ...effect.crew }] : []), ...(effect.shard ? [{ kind: 'shard', ...effect.shard }] : []),
              ...rewardItems(effect.rewards)] }));
        }
      },
    });
    if (!committed.ok) {
      const message = sessionFailureMessage(committed.reason, player);
      pushLog(message);
      showToast({ title: message });
      if (committed.reason === 'hull_critical') { tab = 'ship'; selectedRoom = 'engineering'; }
    } else if (['contract-action', 'contract-order', 'contract-claim', 'encounter-order', 'encounter-recover', 'combat-order', 'travel-claim', 'exp-start', 'exp-launch', 'ship-upgrade', 'ship-build-skip', 'weapon-buy',
      // Phase 2: the hold-full text follows the hold (collecting it, a station change) and the day's claims.
      'idle-claim', 'station-assign', 'calendar-claim', 'chest-open', 'level-crew'].includes(act)
      // Beats come every second in real-time fights: refresh notifications only when one ends.
      || (act === 'encounter-advance' && (!player.activeEncounter || player.activeEncounter.result))) {
      await refreshNotifs();
    }
    render();
    if (committed.ok) scheduleGuidedBeat();
    return committed;
  }
  if (act === 'select-room') {
    const room = canonicalRoomId(data.room);
    selectedRoom = selectedRoom === room ? null : room;
    render();
    return;
  }
  if (act === 'close-room') {
    selectedRoom = null;
    render();
    return;
  }
  if (act === 'calendar-open' || act === 'calendar-close') {
    calendarOpen = act === 'calendar-open';
    render();
    return;
  }
  if (act === 'welcome-close') {
    welcomeBackOpen = false;
    render();
    return;
  }
  if (act === 'tx-next' || act === 'tx-skip') {
    const tx = transmissionQueue[0];
    if (!tx) return;
    const typing = !txInstant && performance.now() - txOpenedAt < panelTypingMs(tx.panels[txPanel]?.text);
    if (act === 'tx-next' && typing) txInstant = true;
    else if (act === 'tx-next' && txPanel < tx.panels.length - 1) {
      txPanel += 1;
      txOpenedAt = performance.now();
      txInstant = false;
      sfx('tap');
    } else {
      transmissionQueue.shift();
      openTransmission();
    }
    render();
    return;
  }
  if (act === 'almanac-open' || act === 'almanac-section' || act === 'almanac-close') {
    almanacSection = act === 'almanac-close' ? null : data.section || almanacSection || 'story';
    render();
    return;
  }
  if (act === 'tx-replay') {
    showTransmission(data.id);
    render();
    return;
  }
  if (act === 'reward-close') {
    const cards = rewardCardRects(app);
    rewardQueue.shift();
    render();
    flyToWallet(app, cards);
    if (rewardQueue[0]) rewardSound(rewardQueue[0]);
    return;
  }
  if (act === 'close-toast') {
    showToast(null);
    render();
    return;
  }
  if (act === 'claim' || act === 'exp-claim') {
    const claimed = claimFuelRegen(syncCommission(player, trustedNow()), trustedNow());
    player = claimed.player;
    const resolved = tryResolveExpedition();
    if (claimed.gained) {
      pushLog(`Claimed +${claimed.gained} fuel.`);
      showToast({ title: `+${claimed.gained} fuel` });
    } else if (!resolved) pushLog('Nothing new to claim yet.');
    await refreshNotifs();
  } else if (act === 'goto-ship') {
    tab = 'ship';
    selectedRoom = null;
  } else if (act === 'goto-missions') {
    if (!isTabUnlocked(player, 'missions')) return;
    tab = 'missions';
    selectedRoom = null;
  } else if (act === 'goto-crew') {
    if (!isTabUnlocked(player, 'crew')) return;
    tab = 'crew';
    selectedRoom = null;
  } else if (act === 'goto-shop') {
    if (!isTabUnlocked(player, 'shop')) return;
    tab = 'shop';
    selectedRoom = null;
  } else if (act === 'orders-skip') {
    player = skipOrders(player);
  } else if (act === 'repair-hull') {
    const offer = hullRepairOffer(player);
    if (!offer) {
      pushLog('Hull is already sound.');
    } else if (!canAfford(player.wallet, { credits: offer.cost })) {
      pushLog(`Need ${offer.cost} credits to patch hull.`);
    } else {
      player = { ...player, wallet: pay(player.wallet, { credits: offer.cost }).wallet };
      const r = repairHull(player, offer.amount);
      player = r.player;
      pushLog(`Patched hull +${r.gained}% (−${offer.cost}cr).`);
      showToast({ title: `Hull +${r.gained}%` });
      sfx('coin');
    }
  } else if (act === 'buy-fuel') {
    const max = player.fuelMax || 10;
    const room = Math.max(0, max - (player.wallet.fuel || 0));
    if (!room) {
      pushLog('Tanks are full.');
    } else {
      const n = Math.min(Math.max(1, Number(data.n) || 1), room);
      const price = fuelCreditPrice(player);
      const cost = price * n;
      if (!canAfford(player.wallet, { credits: cost })) {
        pushLog(`Need ${cost} credits for ${n} fuel.`);
      } else {
        const paid = pay(player.wallet, { credits: cost });
        const wallet = clampFuel({ ...paid.wallet, fuel: (paid.wallet.fuel || 0) + n }, max);
        player = { ...player, wallet };
        pushLog(`Bought ${n} fuel (−${cost}cr).`);
        showToast({ title: `+${n} fuel` });
        sfx('coin');
      }
    }
  } else if (act === 'exp-skip') {
    if (!player.activeExpedition) return;
    const cost = { gems: EXPEDITION_SKIP_GEMS };
    if (!canAfford(player.wallet, cost)) {
      pushLog(`Need ${EXPEDITION_SKIP_GEMS} gems to skip.`);
      return;
    }
    player = {
      ...player,
      wallet: pay(player.wallet, cost).wallet,
      activeExpedition: skipExpeditionJob(player.activeExpedition, trustedNow()),
    };
    tryResolveExpedition({ force: true });
    pushLog(`Spent ${EXPEDITION_SKIP_GEMS} gems to finish expedition.`);
    captureEvent('expedition_skip', {});
    await refreshNotifs();
  } else if (act === 'exp-abort') {
    if (!player.activeExpedition) return;
    const job = player.activeExpedition;
    const frac = abortPayoutFrac(job, trustedNow());
    const ids = job.payload.crewInstanceIds || [];
    if (frac > 0) {
      const res = resolveExpedition(job, { forceComplete: true, player, abortFrac: frac, rng: () => 1, now: trustedNow() });
      finishExpeditionResult(res);
    } else {
      player = {
        ...player,
        activeExpedition: null,
        crew: player.crew.map((c) =>
          ids.includes(c.instanceId) ? { ...c, status: 'ready' } : c
        ),
      };
      pushLog('Early extract — too soon for salvage.');
    }
    await refreshNotifs();
  } else if (act === 'gacha' || act === 'gacha-gems') {
    doHire({ gems: act === 'gacha-gems' });
    await refreshNotifs();
  } else if (act === 'gacha-10') {
    doHire({ ten: true });
    await refreshNotifs();
  } else if (act === 'gacha-marks') {
    doHire({ marks: true });
  } else if (act === 'hire-reveal-close') {
    hireReveal = null;
  } else if (act === 'hire-odds') {
    hireOddsOpen = true;
  } else if (act === 'hire-odds-close') {
    hireOddsOpen = false;
  } else if (act === 'buy-luck') {
    const res = buyLuck(player, data.currency || 'credits');
    if (!res.ok) {
      pushLog(res.reason === 'luck_cap' ? `Luck is capped at ${LUCK_CAP}.` : `Need ${formatReward(res.cost)} for luck.`);
    } else {
      player = res.player;
      pushLog(`Luck ${res.luck}. Odds tilt.`);
      showToast({ title: `Luck ${res.luck}` });
    }
  } else if (act === 'reserve-call') {
    const res = callUpReserve(player, data.id);
    if (!res.ok) pushLog(res.reason === 'no_slot' ? 'No open berth.' : 'Could not call them up.');
    else {
      player = res.player;
      pushLog(`${res.instance.name} called up.`);
      showToast({ title: `${res.instance.name} on deck` });
    }
  } else if (act === 'reserve-sell') {
    const res = sellReserve(player, data.id);
    if (!res.ok) pushLog('Could not sell them.');
    else {
      player = res.player;
      pushLog(`Sold ${res.instance.name} ${formatReward(res.sold)}.`);
      showToast({ title: `${res.instance.name} sold`, rewards: res.sold });
    }
  } else if (act === 'crew-bench') {
    const res = benchCrew(player, data.id);
    if (!res.ok) {
      pushLog(res.reason === 'reserve_full' ? 'Reserve bay is full.'
        : res.reason === 'last_crew' ? 'Keep at least one merc aboard.'
        : res.reason === 'away' ? 'They are on an expedition.'
        : 'Could not bench them.');
    } else {
      player = res.player;
      selectedCrewId = null;
      pushLog(`${res.instance.name} benched to reserve.`);
      showToast({ title: `${res.instance.name} → reserve` });
    }
  } else if (act === 'contract-hire') {
    const res = contractHire(player, data.id);
    if (!res.ok) {
      pushLog(res.reason === 'cannot_afford' ? `Need ${formatReward(res.cost)} to hire.`
        : res.reason === 'no_slot' ? 'No open berth.'
        : res.reason === 'owned' ? 'Already on the crew.'
        : 'Could not hire them.');
    } else {
      player = res.player;
      pushLog(`Contract: ${res.instance.name} signs on.`);
      const te = noteTutorialEvent(player, 'hired');
      player = te.player;
      showToast({ title: `${res.instance.name} signs on` });
      sfx('coin');
    }
  } else if (act === 'select-crew') {
    selectedCrewId = data.id || null;
  } else if (act === 'close-crew') {
    selectedCrewId = null;
  } else if (act === 'cinematic-dismiss') {
    cinematic = null;
  } else if (act === 'hull-buy') {
    if (!isFeatureUnlocked(player, 'shop')) {
      pushLog('Hangar unlocks after the intro.');
      return;
    }
    const res = buyHull(player, data.ship, data.currency || 'gems');
    if (!res.ok) {
      pushLog(res.reason === 'cannot_afford'
        ? `Not enough ${data.currency === 'credits' ? 'credits' : 'gems'} for the ${SHIPS[data.ship]?.name || 'hull'}.`
        : res.reason === 'chapter_lock'
          ? `Locked until story chapter ${res.need}.`
          : res.reason === 'rep_lock'
            ? `Need ${res.need} reputation.`
            : res.reason === 'hull_lock'
              ? `Need the ${SHIPS[res.need]?.name || 'previous'} hull first.`
              : 'Could not buy that hull.');
    } else {
      player = res.player;
      pushLog(`Acquired ${res.def.name}! Crew capacity ${res.def.crewSlots}.`);
      showToast({ title: `${res.def.name} acquired` });
      captureEvent('hull_buy', { ship: data.ship, currency: data.currency });
    }
  } else if (act === 'hull-switch') {
    const res = switchHull(player, data.ship);
    if (!res.ok) pushLog('Could not switch hulls.');
    else {
      player = res.player;
      const extra = [];
      if (res.parked) extra.push(`${res.parked} benched`);
      if (res.sold?.length) extra.push(`${res.sold.length} sold (bay full)`);
      pushLog(`Switched to the ${SHIPS[data.ship]?.name || 'new hull'}.${extra.length ? ' ' + extra.join(', ') + '.' : ''}`);
      if (res.sold?.length) showToast({ title: 'Overflow sold', rewards: res.granted });
    }
  } else if (act === 'iap-buy') {
    if (!isFeatureUnlocked(player, 'shop')) {
      pushLog('Shop unlocks after the intro.');
      return;
    }
    const sku = data.sku;
    if (res0Blocked(sku)) {
      pushLog('That offer is no longer available.');
      render();
      return;
    }
    pushLog(`Buying ${productName(sku)}…`);
    const walletBefore = { ...player.wallet };
    // The core server verifies the receipt and mints the pack as a grant; the grant is claimed
    // and applied (src/core/purchases.js), then the Jest purchase is completed.
    const res = await wc.purchases.buy(sku);
    player = wc.state();
    if (!res.ok && res.reason === 'pending_verification') {
      pushLog('Purchase received. Confirming with the server; it will apply automatically.');
      showToast({ title: 'Purchase received — confirming' });
    } else if (!res.ok && res.reason === 'already_owned') {
      pushLog('You already own this pack.');
    } else if (!res.ok && res.reason === 'pending_delivery') {
      pushLog('Purchase received. Delivery will finish automatically on the next launch.');
      showToast({ title: 'Purchase received — delivering' });
    } else if (!res.ok && res.reason === 'not_leader') {
      pushLog(SESSION_ERROR_COPY.not_leader);
    } else if (!res.ok && res.reason === 'cancelled') {
      pushLog('Purchase cancelled.');
    } else if (!res.ok) {
      pushLog('The purchase did not go through.');
      if (res.reason === 'store_unavailable') showToast({ title: 'Store unavailable. Try again later.' });
    } else {
      if (sku === STARTER_OFFER.sku) player = markStarterOffer(player, { purchased: true, seen: true });
      if (sku.startsWith('wc_wall_')) player = markWallPackSeen(player, sku.slice('wc_wall_'.length));
      pushLog(`Bought ${productName(sku)}. Rewards are aboard.`);
      const reveal = rewardEntry({ source: 'purchase', title: productName(sku), subtitle: 'Thank you, Captain', art: productArt(sku),
        items: rewardItems(walletGain(walletBefore, player.wallet)) });
      if (reveal) showReward(reveal);
      else { showToast({ title: 'Purchase applied' }); sfx('coin'); }
      captureEvent('iap_success', { sku });
      await refreshNotifs();
    }
  } else if (act === 'commission-subscribe') {
    if (!isFeatureUnlocked(player, 'shop')) return;
    const res = await subscribeCommission(player, subscriptionDeps());
    player = res.player;
    if (res.ok) {
      pushLog("Captain's Commission active.");
      showToast({ title: "Commission active" });
      sfx('coin');
      captureEvent('subscription_start', { sku: 'wc_sub_commission' });
      claimCommissionPerks();
    } else if (res.reason === 'pending_verification') {
      pushLog('Subscription received. Confirming; perks apply on the next launch.');
    } else if (res.reason !== 'cancelled') {
      pushLog(res.reason === 'guest_not_allowed' ? 'Sign in to Jest to subscribe.' : `Subscription unavailable: ${res.reason}`);
    }
  } else if (act === 'commission-cancel') {
    // Jest allows one cancel-save discount; offer it before the real cancel.
    const offer = player.commission?.retentionOffer;
    // Pitch the discount only with complete, verified terms; otherwise go straight to Jest's cancel.
    if (Number.isInteger(offer?.price) && offer.price > 0 && Number.isInteger(offer.durationPeriods) && offer.durationPeriods > 0
      && usableTerms(player.commission?.terms)) {
      commissionWinback = true;
      captureEvent('subscription_winback_shown', {});
    } else return handleAction('commission-cancel-confirm');
  } else if (act === 'commission-stay') {
    commissionWinback = false;
    const res = await acceptRetention(player, subscriptionDeps());
    player = res.player;
    if (res.ok) {
      pushLog('Thanks for staying, Captain. Your discount starts at the next renewal.');
      showToast({ title: 'Discount applied' });
      captureEvent('subscription_winback_accepted', {});
    } else pushLog(`Could not apply the discount (${res.reason}). Try again.`);
  } else if (act === 'commission-cancel-confirm') {
    commissionWinback = false;
    const res = await cancelCommission(player, subscriptionDeps());
    player = res.player;
    if (res.ok) {
      pushLog("Commission cancelled. Perks continue until the paid period ends.");
      captureEvent('subscription_cancel', {});
    } else if (res.reason !== 'kept') pushLog(`Cancel failed: ${res.reason}`);
  } else if (act === 'commission-winback-close') {
    commissionWinback = false;
  } else if (act === 'wall-pack-dismiss') {
    player = markWallPackSeen(player, data.wall);
    captureEvent('offer_dismissed', { offer: 'wall_pack', wall: data.wall });
  } else if (act === 'starter-dismiss') {
    player = markStarterOffer(player, { seen: true });
    captureEvent('offer_dismissed', { offer: 'starter', reason: player.offers?.starter?.reason });
  } else if (act === 'prompt-login') {
    const result = await handleJoinJest({ reason: 'shop_prompt' });
    if (result.registered) player = { ...player, _jestRegistered: true, captainName: result.username || player.captainName };
  } else if (act === 'tutorial-register-start') {
    if (![4, 5].includes(player.tutorial?.script) || player.tutorial.phase !== 'register') return;
    const result = await handleJoinJest({ reason: 'first_session' });
    if (result.registered) return handleAction('tutorial-register-complete', { registered: true, username: result.username });
    render();
    return;
  } else if (act === 'tutorial-dismiss') {
    player = dismissTutorial(player);
    if (player.tutorial?.completed) {
      pushLog('Intro complete.');
    }
  } else if (act === 'qa-fuel') {
    player = { ...player, wallet: { ...player.wallet, fuel: (player.wallet.fuel || 0) + 5 } };
    pushLog('QA +5 fuel.');
    await refreshNotifs();
  } else if (act === 'qa-gems') {
    player = { ...player, wallet: { ...player.wallet, gems: (player.wallet.gems || 0) + 100 } };
    pushLog('QA +100 gems.');
  }

  const saved = persist();
  if (saved && !player.activeExpedition) {
    if (departureInFlight) {
      departureRunId++;
      departureInFlight = false;
    }
    cancelCrewDeparture();
  }
  render();
}

function logTravelResult(r) {
  const pay = r.rewards ? formatReward(r.rewards) : '';
  if (r.combat) {
    const hurt = r.injured ? ` · ${r.injured} injured` : '';
    const how = r.combat.crewFight ? `${r.combat.success ? 'won' : 'salvage'} in ${r.combat.beats} beats` : `order: ${r.combat.orderId || 'brace'}`;
    pushLog(`${r.combat.encounter.name}: ${r.combat.log} [${how}]${pay ? ` · ${pay}` : ''}${hurt}`);
  } else if (r.already) {
    pushLog(r.flavor || `Already logged at ${r.node.name}.`);
  } else if (r.beat) {
    pushLog(`Discovery — ${r.beat.title}: ${r.beat.text}${pay ? ` · ${pay}` : ''}`);
    // Gate openings play as a one-panel transmission over their scene (Phase 3 §1).
    if (r.beat.art) showTransmission({ id: `beat_${r.beat.art}`, kicker: 'Discovery', title: r.beat.title, art: `art/pixel/cinematic/v2/${r.beat.art}.png`,
      panels: [{ speaker: 'log', text: r.beat.text }] });
  } else if (r.flavor) {
    pushLog(`${r.kind} @ ${r.node.name}: ${r.flavor}${pay ? ` · ${pay}` : ''}`);
  } else if (r.rewards) {
    pushLog(`${r.kind} @ ${r.node.name}: ${pay}`);
  } else if (r.flag) {
    pushLog(`Story: ${r.flag}`);
  } else {
    pushLog(`Arrived ${r.node.name}`);
  }
}

export function mountWarpCrew(rootEl) {
  const gen = ++mountId;
  app = rootEl;
  startStageLoop();
  // Sound files load after first paint and never hold up boot.
  setTimeout(() => { if (mountId === gen) preloadSfx(); }, 1500);
  // Audio may only start inside a gesture: any tap counts, tabs and splash included.
  for (const type of ['click', 'touchend', 'keydown']) rootEl?.addEventListener?.(type, () => { unlockSfx(); unlockMusic(); }, { passive: true });
  boot().catch((err) => {
    if (mountId !== gen) return;
    console.error(err);
    const el = app || rootEl || document.body;
    el.innerHTML = `<div id="boot" class="error">Warp Crew failed to load.\n\n${err && err.stack ? err.stack : err}</div>`;
  });
  return () => {
    if (mountId === gen) app = null;
    guidedBeatScheduler.cancel();
    stopCrewSim();
  };
}
