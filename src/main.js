// @ts-nocheck
import { createNewPlayer, readyCrew, migratePlayer } from './systems/player.js';
import { loadSave, writeSave, clearSave } from './systems/save.js';
import { claimFuelRegen } from './systems/fuel.js';
import { previewTravel, commitTravel } from './systems/travel.js';
import { pullMerc, GACHA_COSTS, placeCrew, runPulls, assignFromReserve } from './systems/gacha.js';
import { canAfford, pay, grant } from './systems/economy.js';
import {
  PLANETS_V1,
  expeditionSuccessChance,
  startExpedition,
  resolveExpedition,
  skipExpeditionJob,
  EXPEDITION_SKIP_GEMS,
} from './systems/expedition.js';
import { crewPower } from './systems/combat.js';
import { applyDailyLogin } from './systems/daily.js';
import { syncAllNotifications } from './systems/notifications.js';
import {
  listShopProducts,
  buyProduct,
  fulfillIncompletePurchases,
} from './systems/iap.js';
import {
  buyGemDeal,
  collectPassRewards,
} from './systems/shop.js';
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
import { MEDAL_LEVEL_COST } from './data/crewRoster.js';
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
} from './systems/tutorial.js';
import { prepareCrewArt, hasCrewArt } from './ui/crewArt.js';
import { stopCrewSim } from './ui/crewWalk.js';
import { playCombat, isBattlePlaying } from './ui/combatView.js';
import { unlockSfx } from './ui/juice.js';
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
let shopLane = 'featured';
let pullResults = null;
let artReady = false;

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
  {
    const te = noteTutorialEvent(player, 'expedition_done');
    player = te.player;
    if (te.player.tutorial?.slot4Unlocked) {
      /* slot unlock may raise crewSlots */
    }
  }
  const skipNote = res.skipped ? ' (skipped)' : '';
  pushLog(
    res.success
      ? `Expedition success${skipNote}! +${res.rewards.credits}cr +${res.rewards.medals} medals +${res.rewards.reputation} rep`
      : `Expedition failed${skipNote}. Recovered +${res.rewards.credits}cr`
  );
}

function tryResolveExpedition({ force = false } = {}) {
  if (!player.activeExpedition) return false;
  const res = resolveExpedition(player.activeExpedition, { forceComplete: force });
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
    }
  } else if (daily.isNewDay) {
    // Hold the day-1 streak without dumping extra currencies into the intro.
    player = {
      ...player,
      lastLoginDay: daily.player.lastLoginDay,
      loginStreak: daily.player.loginStreak,
      dailyPullAvailable: false,
    };
  }

  const claimed = claimFuelRegen(player);
  player = claimed.player;
  if (claimed.gained > 0) pushLog(`Offline fuel +${claimed.gained}.`);
  tryResolveExpedition();
  const pass = collectPassRewards(player);
  if (Object.keys(pass.gained || {}).length) {
    player = pass.player;
    pushLog(`Season pass: ${JSON.stringify(pass.gained)}`);
  } else {
    player = pass.player;
  }

  try {
    const qa = new URLSearchParams(location.search).get('qa');
    if (qa === 'shop') {
      player = completeTutorial(player, { registered: false });
      player = {
        ...player,
        wallet: {
          ...player.wallet,
          gems: Math.max(player.wallet.gems || 0, 250),
          credits: Math.max(player.wallet.credits || 0, 800),
          medals: Math.max(player.wallet.medals || 0, 20),
        },
        dailyPullAvailable: true,
      };
      tab = 'shop';
      shopLane = 'featured';
      pushLog('QA shop lane.');
    }
  } catch { /* ignore */ }
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
  renderApp(app, {
    player,
    log,
    tab,
    pendingCombat,
    selectedAssists,
    selectedRoom,
    platformStatus,
    shopProducts,
    shopLane,
    pullResults,
    artReady,
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
  if (act === 'claim' || act === 'exp-claim') {
    const claimed = claimFuelRegen(player);
    player = claimed.player;
    const resolved = tryResolveExpedition();
    if (claimed.gained) pushLog(`Claimed +${claimed.gained} fuel.`);
    else if (!resolved) pushLog('Nothing new to claim yet.');
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
    shopLane = data.lane || 'hangar';
  } else if (act === 'travel-to') {
    const nodeId = data.node;
    if (!nodeId) return;
    if (nodeId === player.location) {
      pushLog('Already here.');
      return;
    }
    const preview = previewTravel(player, nodeId);
    if (!preview.ok) {
      pushLog(`Travel failed: ${preview.reason}`);
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
      if (!res.ok) pushLog(`Travel failed: ${res.reason}`);
      else {
        player = res.player;
        logTravelResult(res.result);
        const te = noteTutorialEvent(player, 'travel_success');
        player = te.player;
        if (te.advanced) pushLog('Tutorial: first jump logged.');
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
            pushLog(`Engage failed: ${res.reason}`);
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
          if (isTutorialActive(player)) {
            captureEvent('tutorial_stage', { stage: player.tutorial?.phase });
            tab = 'ship';
          } else {
            tab = 'log';
          }
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
      const planet = PLANETS_V1.find((p) => p.id === data.planet) || PLANETS_V1[0];
      const crew = readyCrew(player).slice(0, Math.min(2, readyCrew(player).length));
      if (!crew.length) pushLog('No ready crew.');
      else {
        const chance = expeditionSuccessChance({
          crewPower: crewPower(crew),
          planetDifficulty: planet.difficulty,
        });
        const job = startExpedition({
          planetId: planet.id,
          crewInstanceIds: crew.map((c) => c.instanceId),
          minutes: planet.minutes,
          successChance: chance,
        });
        player = {
          ...player,
          activeExpedition: job,
          crew: player.crew.map((c) =>
            crew.some((x) => x.instanceId === c.instanceId) ? { ...c, status: 'expedition' } : c
          ),
        };
        pushLog(`Launched ${planet.name} (${(chance * 100) | 0}% · ${planet.minutes}m).`);
        {
          const te = noteTutorialEvent(player, 'expedition_start');
          player = te.player;
        }
        captureEvent('expedition_start', { planet: planet.id });
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
    const ids = player.activeExpedition.payload.crewInstanceIds || [];
    player = {
      ...player,
      activeExpedition: null,
      crew: player.crew.map((c) =>
        ids.includes(c.instanceId) ? { ...c, status: 'ready' } : c
      ),
    };
    pushLog('Early extract — expedition failed.');
    await refreshNotifs();
  } else if (act === 'gacha') {
    if (!isFeatureUnlocked(player, 'gacha')) {
      pushLog('Hiring opens after your first gunner signs on.');
      return;
    }
    const free = player.dailyPullAvailable;
    const cost = free ? GACHA_COSTS.dailyFree : GACHA_COSTS.credits;
    if (!free && !canAfford(player.wallet, cost)) {
      pushLog('Need credits for a pull.');
      return;
    }
    if (!free) player = { ...player, wallet: pay(player.wallet, cost).wallet };
    else {
      player = { ...player, dailyPullAvailable: false };
      pushLog('Daily free pull used.');
    }
    const { instance, rarity } = pullMerc({ reputation: player.wallet.reputation });
    const placed = placeCrew(player, instance);
    player = placed.player;
    if (placed.dest === 'deck') {
      pushLog(`Hired ${instance.name} (${rarity}).`);
      {
        const te = noteTutorialEvent(player, 'hired');
        player = te.player;
      }
    } else {
      pushLog(`Hired ${instance.name} (${rarity}) — reserve (no slot).`);
    }
    captureEvent('gacha_pull', { rarity, free });
    tab = 'crew';
    await refreshNotifs();
  } else if (act === 'level-crew') {
    const c = player.crew.find((x) => x.instanceId === data.id);
    if (!c) return;
    const cost = MEDAL_LEVEL_COST(c.level);
    if ((player.wallet.medals || 0) < cost) pushLog(`Need ${cost} medals to level ${c.name}.`);
    else {
      player = {
        ...player,
        wallet: { ...player.wallet, medals: player.wallet.medals - cost },
        crew: player.crew.map((x) =>
          x.instanceId === c.instanceId
            ? { ...x, level: x.level + 1, power: x.power + 3 }
            : x
        ),
      };
      pushLog(`${c.name} → Lv ${c.level + 1} (−${cost} medals).`);
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
      pushLog(`Upgraded ${system}. Crew slots: ${player.crewSlots}.`);
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
      if (res.doubled) pushLog('First gem pack doubled.');
      else pushLog(`Purchased ${sku}. Rewards applied.`);
      if (res.pulled?.length) {
        pullResults = res.pulled;
        tab = 'crew';
      }
      captureEvent('iap_success', { sku, doubled: Boolean(res.doubled) });
      const jp = getJestPlayer();
      if (jp && !jp.registered) {
        pushLog('Tip: register to keep purchases across devices.');
      }
      await refreshNotifs();
    }
  } else if (act === 'shop-lane') {
    shopLane = data.lane || 'featured';
  } else if (act === 'shop-buy-daily') {
    const res = buyGemDeal(player, data.offer);
    if (!res.ok) {
      pushLog(res.reason === 'cannot_afford' ? 'Need more gems for that sale.' : 'Sale already bought.');
    } else {
      player = res.player;
      pushLog(`Daily sale picked up.`);
      captureEvent('daily_sale', { offer: data.offer });
    }
  } else if (act === 'gacha-10') {
    if (!isFeatureUnlocked(player, 'gacha')) {
      pushLog('Hiring opens after your first gunner signs on.');
    } else if (!canAfford(player.wallet, GACHA_COSTS.gems10)) {
      pushLog('Need 900 gems for a 10-hire.');
      tab = 'shop';
      shopLane = 'gems';
      selectedRoom = null;
    } else {
      player = { ...player, wallet: pay(player.wallet, GACHA_COSTS.gems10).wallet };
      const res = runPulls(player, 10);
      player = res.player;
      pullResults = res.pulled;
      const rares = res.pulled.filter((p) => ['rare', 'epic', 'legendary'].includes(p.rarity)).length;
      pushLog(`10-hire complete. ${rares} rare+.`);
      captureEvent('gacha_10', { rares });
      tab = 'crew';
    }
  } else if (act === 'pass-collect') {
    const res = collectPassRewards(player);
    player = res.player;
    if (!Object.keys(res.gained || {}).length) pushLog('No pass rewards ready.');
    else pushLog(`Pass claimed: ${JSON.stringify(res.gained)}`);
  } else if (act === 'close-pulls') {
    pullResults = null;
  } else if (act === 'crew-assign') {
    const res = assignFromReserve(player, data.id);
    if (!res.ok) pushLog(res.reason === 'no_slot' ? 'No open deck slot.' : 'Reserve hire missing.');
    else {
      player = res.player;
      pushLog('Moved hire onto the deck.');
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
    pullResults = null;
    shopLane = 'featured';
    tab = 'ship';
    pushLog('Save reset.');
  }

  const passTick = collectPassRewards(player);
  if (Object.keys(passTick.gained || {}).length) {
    player = passTick.player;
    pushLog(`Season pass: ${JSON.stringify(passTick.gained)}`);
  }

  persist();
  render();
}

function logTravelResult(r) {
  if (r.combat) {
    const a = (r.combat.assistsUsed || []).join(', ') || 'none';
    pushLog(`${r.combat.encounter.name}: ${r.combat.log} [assists: ${a}]`);
  } else if (r.rewards) {
    pushLog(`${r.kind} @ ${r.node.name}: ${JSON.stringify(r.rewards)}`);
  } else if (r.flag) {
    if (r.beat) pushLog(`Story — ${r.beat.title}: ${r.beat.text}`);
    else pushLog(`Story: ${r.flag}`);
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
