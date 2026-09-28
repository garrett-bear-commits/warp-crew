// @ts-nocheck
import { createNewPlayer, migratePlayer, tickCrewStatus } from './systems/player.js';
import { loadSave, writeSave, clearSave } from './systems/save.js';
import { consumeFreshStart } from './systems/qaFreshStart.js';
import { claimFuelRegen } from './systems/fuel.js';
import { prepareSession, sessionModels, sessionAction, persistSessionTransition } from './systems/sessionLoop.js';
import { pullOnce, pullTen, buyLuck, contractHire, callUpReserve, sellReserve, benchCrew, LUCK_CAP } from './systems/gacha.js';
import { canAfford, pay, grant, hullRepairOffer, fuelCreditPrice, formatReward, clampFuel } from './systems/economy.js';
import {
  resolveExpedition,
  applyExpeditionResult,
  skipExpeditionJob,
  EXPEDITION_SKIP_GEMS,
  abortPayoutFrac,
} from './systems/expedition.js';
import { applyDailyLogin } from './systems/daily.js';
import { syncAllNotifications } from './systems/notifications.js';
import {
  listShopProducts,
  buyProduct,
  fulfillIncompletePurchases,
  retryPendingReceipts,
} from './systems/iap.js';
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
import { sfx } from './ui/juice.js';
import { startStageLoop } from './ui/stageLoop.js';
import { preloadEssentialAssets, loadEssentialImage } from './ui/essentialPreload.js';
import { ART_VERTICAL_SLICE } from './data/artManifest.js';
import { artUrl } from './shared/artUrl.js';
import { STARTER_OFFER, starterOfferState, markStarterOffer, markWallPackSeen, wallPackState } from './systems/offers.js';
import { cloudEnabled, fetchCloudSave, pushCloudSave, verifyReceipt, verifySubscriptions, fetchOwnedOneTime, trustedNow } from './shared/cloud.js';
import { refreshCommission, subscribeCommission, cancelCommission, acceptRetention, claimCommissionDaily } from './systems/subscription.js';
import { chooseSave, applyLedger, withPurchaseSkus } from './systems/cloudSync.js';
import { currentWall } from './systems/walls.js';
import { applyResolvedSlicePortraits } from './data/portraits.js';

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
/** Cancel-save sheet for the Captain's Commission subscription. */
let commissionWinback = false;
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

function pushLog(msg) {
  log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  while (log.length > 50) log.shift();
}

const SESSION_ERROR_COPY = {
  fuel_full: 'Fuel tanks are already full.',
  drydock_busy: 'The drydock is already building an upgrade.',
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
  registration_unavailable: 'Finish meeting your new crew first.',
  registration_unconfirmed: 'Jest sign-in did not finish. You can skip it.',
  stale_encounter_action: 'The fight moved on. Choose again.',
  encounter_finished: 'The fight is over. Bring the cargo aboard.',
  not_enough_fuel: 'Not enough fuel for this job.',
  hull_critical: 'Repair your hull before the next job.',
};

export function sessionFailureMessage(reason, currentPlayer = null) {
  if (reason === 'tutorial_station_required' && currentPlayer?.tutorial?.script === 5) {
    const member = currentPlayer.crew?.find(c => c.instanceId === currentPlayer.tutorial.firstHireInstanceId);
    if (member) return `Assign ${member.name} to ${member.templateId === 'merc_bolt' ? 'Shields' : 'Weapons'} first.`;
  }
  return SESSION_ERROR_COPY[reason] || 'That action is unavailable right now.';
}

function persist() {
  return saveLocal(player);
}

// ─── Cloud save and purchase verification (only when a server is configured) ───
let cloudPushTimer = null;
let cloudPushInFlight = false;

/** Every local save also schedules a debounced upload of the latest state. */
function saveLocal(candidate) {
  // Mark unsynced progress so a newer cloud save cannot silently replace it.
  const marked = cloudEnabled() ? { ...candidate, cloudDirty: true, lastSavedAt: Date.now() } : candidate;
  if (marked !== candidate && candidate === player) player = marked;
  const ok = writeSave(marked);
  if (ok) scheduleCloudPush();
  return ok;
}

function scheduleCloudPush(delay = 3000) {
  if (!cloudEnabled()) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(pushCloudNow, delay);
}

async function pushCloudNow({ keepalive = false } = {}) {
  if (!cloudEnabled() || !player || cloudPushInFlight) return;
  cloudPushInFlight = true;
  const startedAt = Date.now();
  try {
    const result = await pushCloudSave(player, { keepalive });
    if (result.ok && result.data.conflict && player) {
      // Another device saved first. Reconcile before this device's changes can count as synced.
      await reconcileCloud(result.data.current, result.data.purchases, result.data.purchaseSkus);
    } else if (result.ok && result.data.accepted && player) {
      // Record the server sequence locally without scheduling another upload.
      // Anything saved while the upload was in flight stays dirty for the next one.
      const changedSince = (player.lastSavedAt || 0) > startedAt;
      player = { ...player, cloudSeq: result.data.seq, cloudDirty: changedSince };
      writeSave(player);
      if (changedSince) scheduleCloudPush();
    } else if (!result.ok) {
      console.warn('[cloud] save upload failed', result.reason);
    }
  } finally {
    cloudPushInFlight = false;
  }
}

const subscriptionDeps = () => ({
  sdk: { getSubscriptions, beginSubscription, cancelSubscription, claimRetentionOffer },
  real: isReal(),
  verify: cloudEnabled() ? verifySubscriptions : null,
  now: trustedNow,
});

/** Pay today's Commission perks once, with a toast. */
function claimCommissionPerks() {
  const daily = claimCommissionDaily(player, trustedNow());
  if (!daily.granted) return;
  player = daily.player;
  pushLog(`Captain's Commission: +${daily.granted.gems} gems, +${daily.granted.drydockFinishes} drydock finish.`);
  showToast({ title: "Commission daily", rewards: { gems: daily.granted.gems } });
}

const purchaseOptions = () => (cloudEnabled()
  ? { verifyReceipt, checkOwned: fetchOwnedOneTime, persist: next => { player = next; writeSave(next); } }
  : {});

async function syncCloudOnBoot() {
  if (!cloudEnabled()) return;
  const cloud = await fetchCloudSave();
  if (!cloud.ok) {
    console.warn('[cloud] load failed', cloud.reason);
    return;
  }
  await reconcileCloud(cloud.data.save, cloud.data.purchases, cloud.data.purchaseSkus);
  const retried = await retryPendingReceipts(player, purchaseOptions());
  player = retried.player;
  writeSave(player);
}

/** Merge a server save and undelivered purchases into the live player. */
async function reconcileCloud(save, purchases, purchaseSkus = {}) {
  const chosen = chooseSave(player, save, purchaseSkus);
  if (chosen.archived) {
    // Keep the losing side of a two-device conflict recoverable on the server.
    await pushCloudSave(chosen.archived, { archive: true });
    pushLog('Two devices had different progress; the furthest-along save was kept.');
  }
  if (chosen.source === 'cloud') {
    player = prepareSession(restoreTutorialPlayer(chosen.player), trustedNow());
    pushLog('Cloud save restored from another device.');
  } else player = chosen.player;
  const ledger = applyLedger(withPurchaseSkus(player, purchaseSkus), purchases);
  player = ledger.player;
  if (ledger.applied.length) pushLog(`Purchases restored: ${ledger.applied.join(', ')}`);
  // The winner is uploaded next, based on the newest server seq, so the devices converge.
  player = { ...player, cloudDirty: true };
  writeSave(player);
  scheduleCloudPush(500);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pushCloudNow({ keepalive: true });
  });
}

async function refreshNotifs() {
  try {
    await syncAllNotifications(player);
  } catch (e) {
    console.warn('notif sync', e);
  }
}

function finishExpeditionResult(res) {
  const transition = applyExpeditionResult(player, res);
  if (!transition.ok) return;
  player = transition.player;
  const skipNote = res.skipped ? ' (skipped)' : res.aborted ? ' (extract)' : '';
  const paid = formatReward(res.rewards);
  pushLog(
    res.success
      ? `Expedition success${skipNote}! ${paid}${res.flavor ? ` — ${res.flavor}` : ''}`
      : `Expedition failed${skipNote}. ${paid}${res.flavor ? ` — ${res.flavor}` : ''}`
  );
  showToast({
    title: res.success ? 'Expedition complete' : res.aborted ? 'Early extract' : 'Expedition failed',
    rewards: res.rewards,
  });
  sfx(res.success ? 'coin' : 'hit');
}

function tryResolveExpedition({ force = false } = {}) {
  if (!player.activeExpedition) return false;
  const res = resolveExpedition(player.activeExpedition, { forceComplete: force, player });
  if (!res.ready) return false;
  finishExpeditionResult(res);
  return true;
}

function hydratePlayer() {
  const jestPlayer = getJestPlayer();

  try {
    if (consumeFreshStart({ location, history, clearSave })) {
      pushLog('QA fresh start (?fresh=1).');
    }
  } catch { /* ignore */ }

  const saved = loadSave();
  if (saved?.player) {
    player = restoreTutorialPlayer(saved.player);
    pushLog('Welcome back, Captain.');
  } else {
    player = createNewPlayer({
      captainName: jestPlayer?.username || 'Captain',
    });
    pushLog('Career start aboard Sparrow.');
    pushLog(freshBootCrewMessage(player));
  }

  player = {
    ...player,
    _jestRegistered: Boolean(jestPlayer?.registered),
    _jestPlayerId: jestPlayer?.playerId || null,
  };

  if (isTutorialActive(player)) {
    tab = [4, 5].includes(player.tutorial.script) ? 'ship' : preferredTab(player, tab);
  }

  const daily = applyDailyLogin(player);
  if (!isTutorialActive(player) || player.tutorial?.phase === 'done') {
    player = daily.player;
    if (daily.isNewDay) {
      pushLog(`Login streak day ${daily.bonus.streak}. Bonus: ${JSON.stringify(daily.bonus)}`);
      showToast({ title: `Day ${daily.bonus.streak} bonus`, rewards: daily.bonus });
      sfx('coin');
    }
  } else if (daily.isNewDay) {
    // Hold the day-1 streak without dumping extra currencies into the intro.
    player = {
      ...player,
      lastLoginDay: daily.player.lastLoginDay,
      loginStreak: daily.player.loginStreak,
    };
  }

  const claimed = claimFuelRegen(player);
  player = tickCrewStatus(claimed.player);
  if (claimed.gained > 0) pushLog(`Offline fuel +${claimed.gained}.`);
  tryResolveExpedition();
  player = prepareSession(player, trustedNow());
  if (player.activeContract?.stage === 'return') { tab = 'ship'; selectedRoom = 'cargo'; }
  else if (player.activeTravelFight) { tab = 'ship'; selectedRoom = null; }
  else if (player.tutorial?.phase === 'away') sessionUi.missionView = 'away';
}

async function boot() {
  sessionUi.guidedBeatSaveFailed = null;
  essentialProgress = 0;
  essentialReady = false;
  essentialScene = artUrl(ART_VERTICAL_SLICE.splash.path);
  try {
    hydratePlayer();
    artReady = hasCrewArt();
    render();
  } catch (e) {
    console.warn('hydrate', e);
  }

  const sliceKeys = ['splash', 'rex', 'bolt', 'kira', 'tink', 'nemi'];
  const essentials = sliceKeys
    .map(key => ({ src: artUrl(ART_VERTICAL_SLICE[key].path), fallback: artUrl(ART_VERTICAL_SLICE[key].fallback) }));
  essentials.push({ src: artUrl('art/space/sparrow-hull-v3.png'), fallback: artUrl('art/pixel/ships/sparrow-cutaway.jpg') });
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

  const jestPlayer = getJestPlayer();
  if (player && jestPlayer?.username && player.captainName === 'Captain') {
    player = { ...player, captainName: jestPlayer.username };
  }

  const entry = getEntryPayload();
  if (entry?.notification_type) {
    pushLog(`Opened from notification: ${entry.notification_type}`);
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
    await syncCloudOnBoot();
  } catch (e) {
    console.warn('cloud sync', e);
  }

  try {
    const incomplete = await fulfillIncompletePurchases(player, purchaseOptions());
    player = incomplete.player;
    if (incomplete.granted?.length) {
      pushLog(`Restored incomplete purchases: ${incomplete.granted.join(', ')}`);
    }
  } catch (e) {
    console.warn('iap restore', e);
  }

  try {
    const sub = await refreshCommission(player, subscriptionDeps());
    player = sub.player;
    claimCommissionPerks();
  } catch (e) {
    console.warn('subscription refresh', e);
  }

  try {
    shopProducts = await listShopProducts();
  } catch {
    shopProducts = null;
  }

  await Promise.all([essentialP, crewArtP, refreshNotifs().catch((e) => console.warn('notif sync', e))]);
  persist();
  setLoadingProgress(essentialProgress);
  markGameLoaded();
  captureEvent('session_start', {
    platform: isReal() ? 'jest' : 'local',
    streak: player.loginStreak,
  });
  render();
  scheduleGuidedBeat();
}

function render() {
  if (!app || !player) return;
  const ticked = tickCrewStatus(player);
  if (ticked !== player) {
    player = ticked;
    persist();
  }
  const prepared = prepareSession(player, trustedNow());
  if (prepared !== player && saveLocal(prepared)) player = prepared;
  const renderNow = trustedNow();
  const models = sessionModels(player, { ...sessionUi, pendingCombat }, renderNow);
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
        render();
      },
      onAction: handleAction,
    },
  });
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
      await login({ entryPayload: { reason } });
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
  // Fights hold while the app is hidden or the player is off the ship.
  isPaused: () => document.hidden || tab !== 'ship',
  onSaveFailure: failedIdentity => {
    sessionUi.guidedBeatSaveFailed = failedIdentity;
    render();
  },
});

function scheduleGuidedBeat() { guidedBeatScheduler.schedule(); }

function doHire({ gems = false, ten = false } = {}) {
  if (!isFeatureUnlocked(player, 'gacha')) {
    pushLog('Hiring opens after your first gunner signs on.');
    return false;
  }
  if (ten) {
    const res = pullTen(player);
    if (!res.ok) {
      pushLog(res.reason === 'cannot_afford' ? 'Need 900 gems for a 10-pull.' : `10-pull failed: ${res.reason}`);
      return false;
    }
    player = res.player;
    const rare = res.results.filter((r) => ['rare', 'epic', 'legendary', 'mythic', 'apex'].includes(r.rarity)).length;
    const names = res.results.slice(0, 3).map((r) => r.instance?.name).filter(Boolean).join(', ');
    pushLog(`10-pull: ${rare} rare+. ${names}${res.results.length > 3 ? '…' : ''}`);
    showToast({ title: `10-pull · ${rare} rare+` });
    sfx('coin');
    captureEvent('gacha_10', { rare });
    tab = 'crew';
    return true;
  }
  const free = !gems && player.dailyPullAvailable;
  const res = pullOnce(player, { gems, free });
  if (!res.ok) {
    pushLog(gems ? 'Need 100 gems for a hire.' : 'Need credits for a pull.');
    return false;
  }
  player = res.player;
  const name = res.instance?.name || 'Merc';
  if (res.kind === 'hire') {
    pushLog(`Hired ${name} (${res.rarity}).`);
    const te = noteTutorialEvent(player, 'hired');
    player = te.player;
    showToast({ title: `${name} signs on` });
    sfx('coin');
  } else if (res.kind === 'star') {
    pushLog(`${name} stars up ★${res.instance.stars} (${res.rarity}).`);
    showToast({ title: `${name} ★${res.instance.stars}` });
    sfx('coin');
  } else if (res.kind === 'reserve') {
    pushLog(`${name} (${res.rarity}) waits in reserve.`);
    showToast({ title: `${name} → reserve` });
  } else {
    pushLog(`Pulled ${name} (${res.rarity}) — ${res.kind === 'cap' ? 'max stars' : 'no slot'}, sold ${formatReward(res.sold)}.`);
    showToast({ title: `${name} sold`, rewards: res.sold });
  }
  captureEvent('gacha_pull', { rarity: res.rarity, free, gems, kind: res.kind });
  tab = 'crew';
  return true;
}

// One-time offers can only be bought while their offer is live.
function res0Blocked(sku) {
  if (sku === STARTER_OFFER.sku) return !starterOfferState(player).active;
  if (sku.startsWith('wc_wall_')) {
    const pack = wallPackState(player, currentWall(player));
    return !pack.active || pack.sku !== sku;
  }
  return false;
}

async function handleAction(act, data = {}) {
  if (isBattlePlaying()) return;
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
    const jestPlayer = getJestPlayer();
    const fresh = prepareSession(createNewPlayer({ captainName: jestPlayer?.username || 'Captain' }));
    fresh._jestRegistered = Boolean(jestPlayer?.registered);
    fresh._jestPlayerId = jestPlayer?.playerId || null;
    if (!saveLocal(fresh)) {
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
  const transition = sessionAction(player, { ...sessionUi, pendingCombat, tab, selectedRoom, selectedCrewId }, act, data, { now: trustedNow() });
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
      save: saveLocal,
      publish: (result) => {
        if (departure) {
          startedDepartureId = ++departureRunId;
          departureInFlight = true;
          holdCrewForDeparture(transition.effect.crewInstanceIds);
        }
        if (result.effect?.kind === 'crew-arrival') holdCrewForArrival(result.player, result.effect.crewInstanceId);
        if (['launch', 'crew-arrival'].includes(result.effect?.kind)) shipSequence = result.effect.kind === 'crew-arrival'
          ? { kind: 'crew-arrival', member: result.player.crew.find(c => c.instanceId === result.effect.crewInstanceId) }
          : 'launch';
        publishSessionResult(result);
      },
      capture: captureEvent,
      animate: (effect) => {
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
      },
    });
    if (!committed.ok) {
      const message = sessionFailureMessage(committed.reason, player);
      pushLog(message);
      showToast({ title: message });
      if (committed.reason === 'hull_critical') { tab = 'ship'; selectedRoom = 'engineering'; }
    } else if (['contract-action', 'contract-order', 'contract-claim', 'encounter-advance', 'encounter-order', 'encounter-recover', 'combat-order', 'travel-claim', 'exp-start', 'exp-launch', 'ship-upgrade', 'ship-build-skip'].includes(act)) {
      await refreshNotifs();
    }
    render();
    if (committed.ok) scheduleGuidedBeat();
    return committed;
  }
  if (act === 'select-room') {
    selectedRoom = selectedRoom === data.room ? null : data.room;
    render();
    return;
  }
  if (act === 'close-room') {
    selectedRoom = null;
    render();
    return;
  }
  if (act === 'close-toast') {
    showToast(null);
    render();
    return;
  }
  if (act === 'claim' || act === 'exp-claim') {
    const claimed = claimFuelRegen(player);
    player = claimed.player;
    const resolved = tryResolveExpedition();
    if (claimed.gained) {
      pushLog(`Claimed +${claimed.gained} fuel.`);
      showToast({ title: `+${claimed.gained} fuel` });
    } else if (!resolved) pushLog('Nothing new to claim yet.');
    await refreshNotifs();
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
      activeExpedition: skipExpeditionJob(player.activeExpedition),
    };
    tryResolveExpedition({ force: true });
    pushLog(`Spent ${EXPEDITION_SKIP_GEMS} gems to finish expedition.`);
    captureEvent('expedition_skip', {});
    await refreshNotifs();
  } else if (act === 'exp-abort') {
    if (!player.activeExpedition) return;
    const job = player.activeExpedition;
    const frac = abortPayoutFrac(job);
    const ids = job.payload.crewInstanceIds || [];
    if (frac > 0) {
      const res = resolveExpedition(job, { forceComplete: true, player, abortFrac: frac, rng: () => 1 });
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
    if (!res.ok) pushLog(res.reason === 'no_slot' ? 'No open berth.' : `Reserve failed: ${res.reason}`);
    else {
      player = res.player;
      pushLog(`${res.instance.name} called up.`);
      showToast({ title: `${res.instance.name} on deck` });
    }
  } else if (act === 'reserve-sell') {
    const res = sellReserve(player, data.id);
    if (!res.ok) pushLog(`Sell failed: ${res.reason}`);
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
        : `Bench failed: ${res.reason}`);
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
        : `Hire failed: ${res.reason}`);
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
        ? `Cannot afford ${data.ship} (${data.currency}).`
        : res.reason === 'chapter_lock'
          ? `Locked until story chapter ${res.need}.`
          : res.reason === 'rep_lock'
            ? `Need ${res.need} reputation.`
            : res.reason === 'hull_lock'
              ? `Need ${res.need} hull first.`
              : `Hull buy failed: ${res.reason}`);
    } else {
      player = res.player;
      pushLog(`Acquired ${res.def.name}! Crew capacity ${res.def.crewSlots}.`);
      showToast({ title: `${res.def.name} acquired` });
      captureEvent('hull_buy', { ship: data.ship, currency: data.currency });
    }
  } else if (act === 'hull-switch') {
    const res = switchHull(player, data.ship);
    if (!res.ok) pushLog(`Switch failed: ${res.reason}`);
    else {
      player = res.player;
      const extra = [];
      if (res.parked) extra.push(`${res.parked} benched`);
      if (res.sold?.length) extra.push(`${res.sold.length} sold (bay full)`);
      pushLog(`Switched active hull to ${data.ship}.${extra.length ? ' ' + extra.join(', ') + '.' : ''}`);
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
    pushLog(`Purchasing ${sku}…`);
    const res = await buyProduct(player, sku, purchaseOptions());
    if (!res.ok && res.reason === 'pending_verification') {
      player = res.player;
      pushLog('Purchase received. Confirming with the server; it will apply automatically.');
      showToast({ title: 'Purchase received — confirming' });
    } else if (!res.ok && res.reason === 'already_owned') {
      player = res.player;
      pushLog('You already own this pack.');
    } else if (!res.ok) pushLog(`Purchase failed: ${res.reason}`);
    else {
      player = res.player;
      if (sku === STARTER_OFFER.sku) player = markStarterOffer(player, { purchased: true, seen: true });
      if (sku.startsWith('wc_wall_')) player = markWallPackSeen(player, sku.slice('wc_wall_'.length));
      pushLog(`Purchased ${sku}. Rewards applied.`);
      showToast({ title: 'Purchase applied' });
      sfx('coin');
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
    if (player.commission?.retentionOffer) {
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
    pushLog(`Story — ${r.beat.title}: ${r.beat.text}${pay ? ` · ${pay}` : ''}`);
    if (r.beat.art) {
      cinematic = { title: r.beat.title, text: r.beat.text, art: r.beat.art };
    }
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
