// @ts-nocheck
import { createNewPlayer, migratePlayer, tickCrewStatus, grantCrewXp, applyCrewInjury } from './systems/player.js';
import { loadSave, writeSave, clearSave } from './systems/save.js';
import { claimFuelRegen } from './systems/fuel.js';
import { previewTravel, commitTravel } from './systems/travel.js';
import { pullMerc, GACHA_COSTS } from './systems/gacha.js';
import { canAfford, pay, grant, hullRepairOffer, fuelCreditPrice, formatReward, sellContract, clampFuel } from './systems/economy.js';
import {
  startExpedition,
  resolveExpedition,
  skipExpeditionJob,
  EXPEDITION_SKIP_GEMS,
  previewExpedition,
  abortPayoutFrac,
} from './systems/expedition.js';
import { applyDailyLogin } from './systems/daily.js';
import { syncAllNotifications } from './systems/notifications.js';
import {
  listShopProducts,
  buyProduct,
  fulfillIncompletePurchases,
} from './systems/iap.js';
import { repairHull, injuryMinutesFor } from './systems/passives.js';
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
import { medalLevelCostFor } from './data/crewRoster.js';
import { buyHull, switchHull, upgradeSystem } from './systems/hangar.js';
import {
  noteTutorialEvent,
  advanceTutorial,
  dismissTutorial,
  migrateTutorial,
  currentTutorialStep,
  isTutorialActive,
  isTabUnlocked,
  isFeatureUnlocked,
  grantTutorialRecruit,
  beginJoinPrompt,
  completeTutorial,
  preferredTab,
  skipOrders,
} from './systems/tutorial.js';
import { prepareCrewArt, hasCrewArt } from './ui/crewArt.js';
import { stopCrewSim } from './ui/crewWalk.js';
import { playCombat, isBattlePlaying } from './ui/combatView.js';
import { unlockSfx, sfx } from './ui/juice.js';
import { startStageLoop } from './ui/stageLoop.js';

let app = null;
let mountId = 0;
const log = [];
let player = null;
let tab = 'ship';
let pendingCombat = null;
let selectedAssists = [];
let selectedRoom = null;
let platformStatus = 'booting';
let shopProducts = null;
let artReady = false;
let toast = null;
let toastTimer = 0;

const TRAVEL_FAIL = {
  not_enough_fuel: 'Not enough fuel.',
  hull_critical: 'Hull is critical — repair in Engineering.',
  locked_node: 'That lane is locked.',
  unknown_node: 'Unknown jump.',
};

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
  writeSave(player);
}

async function refreshNotifs() {
  try {
    await syncAllNotifications(player);
  } catch (e) {
    console.warn('notif sync', e);
  }
}

function finishExpeditionResult(res) {
  player = {
    ...player,
    wallet: grant(player.wallet, res.rewards),
    activeExpedition: null,
    crew: player.crew.map((c) =>
      res.crewInstanceIds.includes(c.instanceId) ? { ...c, status: 'ready' } : c
    ),
    stats: { ...player.stats, expeditions: (player.stats.expeditions || 0) + 1 },
  };
  if (res.success) {
    player = grantCrewXp(player, res.crewInstanceIds, 18);
  } else if (!res.aborted) {
    player = applyCrewInjury(player, res.crewInstanceIds, injuryMinutesFor(player, 18));
  }
  {
    const te = noteTutorialEvent(player, 'expedition_done');
    player = te.player;
  }
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
  renderApp(app, {
    player,
    log,
    tab,
    pendingCombat,
    selectedAssists,
    selectedRoom,
    platformStatus,
    shopProducts,
    artReady,
    toast,
    handlers: {
      setTab: (t) => {
        if (isBattlePlaying()) return;
        if (!isTabUnlocked(player, t)) return;
        if (t === 'missions' && player.tutorial?.phase === 'meet' && isTutorialActive(player)) {
          player = advanceTutorial(player);
          persist();
          captureEvent('tutorial_stage', { stage: 'jump' });
        }
        tab = t;
        selectedRoom = null;
        render();
      },
      onAction: handleAction,
      toggleAssist: (id) => {
        if (selectedAssists.includes(id)) {
          selectedAssists = selectedAssists.filter((x) => x !== id);
        } else {
          selectedAssists = [...selectedAssists, id];
        }
        render();
      },
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
    if (isTutorialActive(player) || player.tutorial?.phase === 'join') {
      player = completeTutorial(player, { registered: Boolean(registered) });
      tab = 'ship';
      captureEvent('tutorial_complete', { joined: Boolean(registered) });
    }
  };

  if (jp?.registered) {
    finish(true, jp.username);
    pushLog(`Already registered as ${jp.username || jp.playerId}.`);
    return;
  }

  if (isReal()) {
    const { loginButtonAction } = showRegistrationOverlay({
      theme: 'dark',
      message: 'Save Warp Crew progress! {{registrationCode}} is my code.',
      entryPayload: { reason },
      onClose: () => {},
    });
    try {
      await login({ entryPayload: { reason } });
      const after = getJestPlayer();
      if (after?.registered) {
        finish(true, after?.username);
        pushLog('Registered on Jest. Crew, shop, and log are open.');
      } else {
        pushLog('Join closed — you can still play as guest.');
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
  pushLog('Joined Jest. Crew, shop, and log are open.');
}

function doHire({ gems = false } = {}) {
  if (!isFeatureUnlocked(player, 'gacha')) {
    pushLog('Hiring opens after your first gunner signs on.');
    return false;
  }
  const free = !gems && player.dailyPullAvailable;
  const cost = free ? GACHA_COSTS.dailyFree : gems ? GACHA_COSTS.gems : GACHA_COSTS.credits;
  if (!free && !canAfford(player.wallet, cost)) {
    pushLog(gems ? 'Need 100 gems for a hire.' : 'Need credits for a pull.');
    return false;
  }
  if (!free) player = { ...player, wallet: pay(player.wallet, cost).wallet };
  else {
    player = { ...player, dailyPullAvailable: false };
    pushLog('Daily free pull used.');
  }
  const { instance, rarity } = pullMerc({ reputation: player.wallet.reputation });
  if (player.crew.length < player.crewSlots) {
    player = { ...player, crew: [...player.crew, instance] };
    pushLog(`Hired ${instance.name} (${rarity}).`);
    {
      const te = noteTutorialEvent(player, 'hired');
      player = te.player;
    }
    showToast({ title: `${instance.name} signs on` });
    sfx('coin');
  } else {
    const sold = sellContract(rarity);
    player = { ...player, wallet: grant(player.wallet, sold) };
    pushLog(`Pulled ${instance.name} (${rarity}) — no slot, sold ${formatReward(sold)}.`);
    showToast({ title: `${instance.name} sold`, rewards: sold });
  }
  captureEvent('gacha_pull', { rarity, free, gems });
  tab = 'crew';
  return true;
}

async function handleAction(act, data = {}) {
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
  } else if (act === 'travel-to') {
    const nodeId = data.node;
    if (!nodeId) return;
    if (nodeId === player.location) {
      pushLog('Already here.');
      return;
    }
    const preview = previewTravel(player, nodeId);
    if (!preview.ok) {
      pushLog(`Travel failed: ${TRAVEL_FAIL[preview.reason] || preview.reason}`);
    } else if (preview.needsAssists) {
      pendingCombat = preview;
      selectedAssists = ['shield_boost'];
      pushLog(`Contact at ${preview.node.name} — choose assists.`);
      if (isTutorialActive(player)) {
        const te = noteTutorialEvent(player, 'combat_ready');
        player = te.player;
      }
    } else {
      const res = commitTravel(player, preview);
      if (!res.ok) pushLog(`Travel failed: ${TRAVEL_FAIL[res.reason] || res.reason}`);
      else {
        player = res.player;
        logTravelResult(res.result);
        const te = noteTutorialEvent(player, 'travel_success');
        player = te.player;
        if (te.advanced) pushLog('Tutorial: first jump logged.');
        if (res.result.rewards) {
          showToast({
            title: res.result.beat?.title || `${res.result.kind} · ${res.result.node.name}`,
            rewards: res.result.rewards,
          });
          sfx('coin');
        } else if (res.result.beat) {
          showToast({ title: res.result.beat.title });
        }
        captureEvent('travel', { node: nodeId, kind: res.result.kind });
        await refreshNotifs();
      }
    }
  } else if (act === 'combat-confirm') {
    if (!pendingCombat || isBattlePlaying()) return;
    const preview = pendingCombat;
    const assists = [...selectedAssists];
    pendingCombat = null;
    selectedAssists = [];
    tab = 'ship';
    selectedRoom = null;
    unlockSfx();
    const res = commitTravel(player, preview, { assistsUsed: assists });
    render();
    requestAnimationFrame(() => {
      playCombat({
        preview,
        win: Boolean(res.result?.combat?.success ?? res.ok),
        onDone: async () => {
          if (!res.ok) {
            pushLog(`Engage failed: ${TRAVEL_FAIL[res.reason] || res.reason}`);
            persist();
            render();
            return;
          }
          player = res.player;
          logTravelResult(res.result);
          let te = noteTutorialEvent(player, 'travel_success');
          player = te.player;
          te = noteTutorialEvent(player, 'combat_done', { rewards: res.result.rewards });
          player = te.player;
          captureEvent('combat', {
            success: res.result.combat?.success,
            encounter: res.result.combat?.encounter?.id,
          });
          tab = 'ship';
          if (!isTutorialActive(player)) {
            showToast({
              title: res.result.combat?.success ? 'Victory' : 'Hull holds',
              rewards: res.result.rewards,
            });
          }
          sfx(res.result.combat?.success ? 'win' : 'hit');
          await refreshNotifs();
          persist();
          render();
        },
      });
    });
    return;
  } else if (act === 'combat-cancel') {
    if (isTutorialActive(player) && player.tutorial?.phase === 'combat') {
      // First fight cannot be aborted — stay on the assist picker.
      render();
      return;
    }
    pendingCombat = null;
    selectedAssists = [];
    pushLog('Jump aborted. Fuel not spent.');
    if (isTutorialActive(player)) {
      const te = noteTutorialEvent(player, 'combat_abort');
      player = te.player;
    }
  } else if (act === 'exp-start') {
    if (!isFeatureUnlocked(player, 'expeditions')) {
      pushLog('Expeditions unlock after the first fight.');
      return;
    }
    if (player.activeExpedition) pushLog('Expedition already active.');
    else {
      const prev = previewExpedition(player, data.planet);
      const crew = prev.crew;
      if (!crew.length) pushLog('No ready crew.');
      else {
        const job = startExpedition({
          planetId: prev.planet.id,
          crewInstanceIds: crew.map((c) => c.instanceId),
          minutes: prev.planet.minutes,
          successChance: prev.chance,
          roleHit: prev.roleHit,
        });
        player = {
          ...player,
          activeExpedition: job,
          crew: player.crew.map((c) =>
            crew.some((x) => x.instanceId === c.instanceId) ? { ...c, status: 'expedition' } : c
          ),
        };
        const names = crew.map((c) => c.name).join(', ');
        pushLog(`Launched ${prev.planet.name} with ${names} (${(prev.chance * 100) | 0}% · ${prev.planet.minutes || 15}m).`);
        {
          const te = noteTutorialEvent(player, 'expedition_start');
          player = te.player;
        }
        captureEvent('expedition_start', { planet: prev.planet.id });
        await refreshNotifs();
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
  } else if (act === 'level-crew') {
    const c = player.crew.find((x) => x.instanceId === data.id);
    if (!c) return;
    const cost = medalLevelCostFor(c);
    if ((player.wallet.medals || 0) < cost) pushLog(`Need ${cost} medals to level ${c.name}.`);
    else {
      player = {
        ...player,
        wallet: { ...player.wallet, medals: player.wallet.medals - cost },
        crew: player.crew.map((x) =>
          x.instanceId === c.instanceId
            ? { ...x, level: x.level + 1, power: x.power + 3, xp: 0 }
            : x
        ),
      };
      pushLog(`${c.name} → Lv ${c.level + 1} (−${cost} medals).`);
      showToast({ title: `${c.name} Lv ${c.level + 1}` });
    }
  } else if (act === 'ship-upgrade') {
    if (isTutorialActive(player) && !isFeatureUnlocked(player, 'hangar')) {
      pushLog('Ship upgrades open after the intro.');
      return;
    }
    const system = data.system || 'quarters';
    const res = upgradeSystem(player, system);
    if (!res.ok) {
      pushLog(res.reason === 'cannot_afford'
        ? `Need ${JSON.stringify(res.cost)} for ${system}.`
        : `Upgrade failed: ${res.reason}`);
    } else {
      player = res.player;
      const spent = res.cost?.credits ? ` (−${res.cost.credits}cr)` : '';
      pushLog(`Upgraded ${system} to lv ${res.nextLevel}.${spent} Crew slots: ${player.crewSlots}.`);
      showToast({ title: `${system} lv ${res.nextLevel}` });
      captureEvent('ship_upgrade', { system });
    }
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
      pushLog(`Switched active hull to ${data.ship}.`);
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
      const jp = getJestPlayer();
      if (jp && !jp.registered) {
        pushLog('Tip: register to keep purchases across devices.');
      }
      await refreshNotifs();
    }
  } else if (act === 'prompt-login' || act === 'tutorial-join') {
    await handleJoinJest({ reason: act === 'tutorial-join' ? 'tutorial_peak' : 'shop_prompt' });
  } else if (act === 'tutorial-next' || act === 'tutorial-go' || act === 'tutorial-jump') {
    const step = currentTutorialStep(player);
    if (!step) return;
    if (step.id === 'meet') {
      player = advanceTutorial(player);
      tab = 'missions';
      selectedRoom = null;
      captureEvent('tutorial_stage', { stage: 'jump' });
      pushLog('Missions open. Dust Lane is the only jump.');
    } else if (step.tab) {
      tab = step.tab;
      selectedRoom = null;
    }
  } else if (act === 'tutorial-draw') {
    const granted = grantTutorialRecruit(player);
    player = granted.player;
    tab = 'crew';
    selectedRoom = null;
    pushLog(`${granted.instance.name} signs on as gunner.`);
    sfx('coin');
    captureEvent('tutorial_stage', { stage: 'recruit' });
  } else if (act === 'tutorial-to-join') {
    player = beginJoinPrompt(player);
    tab = 'ship';
    selectedRoom = null;
    captureEvent('tutorial_stage', { stage: 'join' });
    pushLog('Jest save prompt.');
  } else if (act === 'tutorial-skip-join') {
    player = completeTutorial(player, { registered: Boolean(getJestPlayer()?.registered) });
    tab = 'ship';
    captureEvent('tutorial_complete', { joined: false });
    pushLog('Playing as guest. Crew, shop, and log are open.');
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
    player = createNewPlayer();
    pendingCombat = null;
    selectedAssists = [];
    tab = 'ship';
    showToast(null);
    pushLog('Save reset.');
  }

  persist();
  render();
}

function logTravelResult(r) {
  const pay = r.rewards ? formatReward(r.rewards) : '';
  if (r.combat) {
    const a = (r.combat.assistsUsed || []).join(', ') || 'none';
    const hurt = r.injured ? ` · ${r.injured} injured` : '';
    pushLog(`${r.combat.encounter.name}: ${r.combat.log} [assists: ${a}]${pay ? ` · ${pay}` : ''}${hurt}`);
  } else if (r.already) {
    pushLog(r.flavor || `Already logged at ${r.node.name}.`);
  } else if (r.beat) {
    pushLog(`Story — ${r.beat.title}: ${r.beat.text}${pay ? ` · ${pay}` : ''}`);
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
