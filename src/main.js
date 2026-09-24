// @ts-nocheck
import { createNewPlayer, migratePlayer, tickCrewStatus } from './systems/player.js';
import { loadSave, writeSave, clearSave } from './systems/save.js';
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
} from './shared/platform.js';
import { renderApp } from './ui/bridge.js';
import { buyHull, switchHull } from './systems/hangar.js';
import {
  noteTutorialEvent,
  dismissTutorial,
  migrateTutorial,
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
import { sfx } from './ui/juice.js';
import { startStageLoop } from './ui/stageLoop.js';

let app = null;
let mountId = 0;
const log = [];
let player = null;
let tab = 'ship';
let pendingCombat = null;
let sessionUi = { missionView: 'contracts', reviewedOfferId: null, selectedExpeditionId: null, selectedExpeditionCrewIds: [] };
let selectedRoom = null;
let selectedCrewId = null;
let cinematic = null;
let platformStatus = 'booting';
let shopProducts = null;
let artReady = false;
let toast = null;
let toastTimer = 0;
let departureInFlight = false;
let departureRunId = 0;
let shipSequence = null;

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

function persist() {
  return writeSave(player);
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
    if (new URLSearchParams(location.search).get('fresh') === '1') {
      clearSave();
      pushLog('QA fresh start (?fresh=1).');
    }
  } catch { /* ignore */ }

  const saved = loadSave();
  if (saved?.player) {
    player = migrateTutorial(migratePlayer(saved.player));
    pushLog('Welcome back, Captain.');
  } else {
    player = createNewPlayer({
      captainName: jestPlayer?.username || 'Captain',
    });
    player = migrateTutorial(player);
    pushLog('Career start aboard Sparrow.');
    pushLog('Two mercs on deck — Rex and Bolt.');
  }

  player = {
    ...player,
    _jestRegistered: Boolean(jestPlayer?.registered),
    _jestPlayerId: jestPlayer?.playerId || null,
  };

  if (isTutorialActive(player)) {
    tab = preferredTab(player, tab);
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
  player = prepareSession(player);
  if (player.activeContract?.stage === 'return') { tab = 'ship'; selectedRoom = 'cargo'; }
  else if (player.tutorial?.phase === 'away') sessionUi.missionView = 'away';
}

async function boot() {
  try {
    hydratePlayer();
    artReady = hasCrewArt();
    render();
  } catch (e) {
    console.warn('hydrate', e);
  }

  const initResult = await platformInit();
  platformStatus = isReal()
    ? `jest (${initResult.mode})`
    : `local mock (${initResult.mode})`;
  setLoadingProgress(10);

  const jestPlayer = getJestPlayer();
  if (player && jestPlayer?.username && player.captainName === 'Captain') {
    player = { ...player, captainName: jestPlayer.username };
  }
  setLoadingProgress(40);

  const entry = getEntryPayload();
  if (entry?.notification_type) {
    pushLog(`Opened from notification: ${entry.notification_type}`);
    captureEvent('open_from_notification', entry);
    if (entry.notification_type === 'expedition_done') tab = 'missions';
    if (entry.notification_type === 'daily_pull') tab = 'crew';
    if (entry.notification_type === 'fuel_full') tab = 'missions';
  }

  const artP = prepareCrewArt()
    .then(() => {
      artReady = true;
      render();
    })
    .catch((e) => console.warn('crew art', e));

  try {
    const incomplete = await fulfillIncompletePurchases(player);
    player = incomplete.player;
    if (incomplete.granted?.length) {
      pushLog(`Restored incomplete purchases: ${incomplete.granted.join(', ')}`);
    }
  } catch (e) {
    console.warn('iap restore', e);
  }

  try {
    shopProducts = await listShopProducts();
  } catch {
    shopProducts = null;
  }

  setLoadingProgress(90);
  await Promise.all([artP, refreshNotifs().catch((e) => console.warn('notif sync', e))]);
  persist();
  setLoadingProgress(100);
  markGameLoaded();
  captureEvent('session_start', {
    platform: isReal() ? 'jest' : 'local',
    streak: player.loginStreak,
  });
  render();
}

function render() {
  if (!app || !player) return;
  const ticked = tickCrewStatus(player);
  if (ticked !== player) {
    player = ticked;
    persist();
  }
  const prepared = prepareSession(player);
  if (prepared !== player && writeSave(prepared)) player = prepared;
  const models = sessionModels(player, { ...sessionUi, pendingCombat });
  sessionUi.contractPreviews = models.contractPreviews;
  renderApp(app, {
    ...sessionUi,
    ...models,
    player,
    log,
    tab,
    pendingCombat,
    selectedRoom,
    selectedCrewId,
    cinematic,
    platformStatus,
    shopProducts,
    artReady,
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
  const jp = getJestPlayer();
  const finish = (registered, username) => {
    player = {
      ...player,
      _jestRegistered: Boolean(registered),
      captainName: username || player.captainName,
    };
  };

  if (jp?.registered) {
    finish(true, jp.username);
    pushLog(`Already registered as ${jp.username || jp.playerId}.`);
    return;
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
        finish(true, after?.username);
        pushLog('Signed in to Jest.');
      } else {
        pushLog('Sign-in closed.');
      }
    } catch {
      pushLog('Login flow closed.');
      loginButtonAction?.();
    }
    return;
  }

  await login();
  const after = getJestPlayer();
  finish(true, after?.username);
  pushLog('Signed in to Jest.');
}

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

async function handleAction(act, data = {}) {
  if (isBattlePlaying()) return;
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
  const transition = sessionAction(player, { ...sessionUi, pendingCombat, tab, selectedRoom, selectedCrewId }, act, data);
  if (transition) {
    const departure = transition.effect?.kind === 'expedition';
    let startedDepartureId = null;
    const publishSessionResult = (result) => {
      player = result.player;
      sessionUi = { ...sessionUi, ...result.ui };
      if ('pendingCombat' in result.ui) pendingCombat = result.ui.pendingCombat;
      if ('tab' in result.ui) tab = result.ui.tab;
      if ('selectedRoom' in result.ui) selectedRoom = result.ui.selectedRoom;
      if ('selectedCrewId' in result.ui) selectedCrewId = result.ui.selectedCrewId;
      render();
    };
    const committed = persistSessionTransition(transition, {
      save: writeSave,
      publish: (result) => {
        if (departure) {
          startedDepartureId = ++departureRunId;
          departureInFlight = true;
          holdCrewForDeparture(transition.effect.crewInstanceIds);
        }
        if (result.effect?.kind === 'crew-arrival') holdCrewForArrival(result.player, result.effect.crewInstanceId);
        if (['launch', 'crew-arrival'].includes(result.effect?.kind)) shipSequence = result.effect.kind;
        publishSessionResult(result);
      },
      capture: captureEvent,
      animate: (effect) => {
        if (effect.result) logTravelResult(effect.result);
        if (effect.kind === 'launch') {
          playLaunch({ onDone: () => { if (shipSequence === 'launch') shipSequence = null; render(); } });
        }
        if (effect.kind === 'crew-arrival') {
          moveCrewToArrival(player, effect.crewInstanceId, { onDone: () => { if (shipSequence === 'crew-arrival') shipSequence = null; render(); } });
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
      pushLog(committed.reason === 'save_failed' ? 'Could not save. Action was not applied; please retry.' : committed.reason);
      showToast({ title: committed.reason === 'save_failed' ? 'Could not save. Please retry.' : committed.reason.replaceAll('_', ' ') });
      if (committed.reason === 'hull_critical') { tab = 'ship'; selectedRoom = 'engineering'; }
    } else if (['contract-action', 'contract-order', 'contract-claim', 'encounter-advance', 'encounter-order', 'encounter-recover', 'combat-order', 'exp-start', 'exp-launch'].includes(act)) {
      await refreshNotifs();
    }
    render();
    return;
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
  } else if (act === 'splash-dismiss') {
    player = { ...player, flags: { ...(player.flags || {}), splashSeen: true } };
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
    pushLog(`Purchasing ${sku}…`);
    const res = await buyProduct(player, sku);
    if (!res.ok) pushLog(`Purchase failed: ${res.reason}`);
    else {
      player = res.player;
      pushLog(`Purchased ${sku}. Rewards applied.`);
      showToast({ title: 'Purchase applied' });
      sfx('coin');
      captureEvent('iap_success', { sku });
      await refreshNotifs();
    }
  } else if (act === 'prompt-login') {
    await handleJoinJest({ reason: 'shop_prompt' });
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
  } else if (act === 'qa-reset') {
    clearSave();
    player = prepareSession(createNewPlayer());
    pendingCombat = null;
    sessionUi = { missionView: 'contracts', reviewedOfferId: null, selectedExpeditionId: null, selectedExpeditionCrewIds: [] };
    selectedCrewId = null;
    cinematic = null;
    tab = 'ship';
    showToast(null);
    pushLog('Save reset.');
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
    const a = r.combat.orderId || 'brace';
    const hurt = r.injured ? ` · ${r.injured} injured` : '';
    pushLog(`${r.combat.encounter.name}: ${r.combat.log} [order: ${a}]${pay ? ` · ${pay}` : ''}${hurt}`);
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
    stopCrewSim();
  };
}
