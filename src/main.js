import { createNewPlayer, readyCrew, migratePlayer } from './systems/player.js';
import { loadSave, writeSave, clearSave } from './systems/save.js';
import { claimFuelRegen } from './systems/fuel.js';
import { previewTravel, commitTravel } from './systems/travel.js';
import { pullMerc, GACHA_COSTS } from './systems/gacha.js';
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

const app = document.getElementById('app');
const log = [];
let player = null;
let tab = 'ship';
let pendingCombat = null;
let selectedAssists = [];
let platformStatus = 'booting';
let shopProducts = null;

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

async function boot() {
  setLoadingProgress(10);
  const initResult = await platformInit();
  platformStatus = isReal()
    ? `jest (${initResult.mode})`
    : `local mock (${initResult.mode})`;

  const jestPlayer = getJestPlayer();
  setLoadingProgress(40);

  const saved = loadSave();
  if (saved?.player) {
    player = migratePlayer(saved.player);
    pushLog('Welcome back, Captain.');
  } else {
    player = createNewPlayer({
      captainName: jestPlayer?.username || 'Captain',
    });
    pushLog('Career start aboard Sparrow.');
    pushLog('Phase B: Jest SDK, IAP, notification ladder.');
  }

  // Tag registration for comeback series
  player = {
    ...player,
    _jestRegistered: Boolean(jestPlayer?.registered),
    _jestPlayerId: jestPlayer?.playerId || null,
  };

  const entry = getEntryPayload();
  if (entry?.notification_type) {
    pushLog(`Opened from notification: ${entry.notification_type}`);
    captureEvent('open_from_notification', entry);
    if (entry.notification_type === 'expedition_done') tab = 'missions';
    if (entry.notification_type === 'daily_pull') tab = 'crew';
    if (entry.notification_type === 'fuel_full') tab = 'missions';
  }

  const daily = applyDailyLogin(player);
  player = daily.player;
  if (daily.isNewDay) {
    pushLog(`Login streak day ${daily.bonus.streak}. Bonus: ${JSON.stringify(daily.bonus)}`);
  }

  const claimed = claimFuelRegen(player);
  player = claimed.player;
  if (claimed.gained > 0) pushLog(`Offline fuel +${claimed.gained}.`);
  tryResolveExpedition();

  const incomplete = await fulfillIncompletePurchases(player);
  player = incomplete.player;
  if (incomplete.granted?.length) {
    pushLog(`Restored incomplete purchases: ${incomplete.granted.join(', ')}`);
  }

  try {
    shopProducts = await listShopProducts();
  } catch {
    shopProducts = null;
  }

  setLoadingProgress(90);
  await refreshNotifs();
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
  renderApp(app, {
    player,
    log,
    tab,
    pendingCombat,
    selectedAssists,
    platformStatus,
    shopProducts,
    handlers: {
      setTab: (t) => {
        tab = t;
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

async function handleAction(act, data = {}) {
  if (act === 'claim' || act === 'exp-claim') {
    const claimed = claimFuelRegen(player);
    player = claimed.player;
    const resolved = tryResolveExpedition();
    if (claimed.gained) pushLog(`Claimed +${claimed.gained} fuel.`);
    else if (!resolved) pushLog('Nothing new to claim yet.');
    await refreshNotifs();
  } else if (act === 'goto-missions') {
    tab = 'missions';
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
    } else {
      const res = commitTravel(player, preview);
      if (!res.ok) pushLog(`Travel failed: ${res.reason}`);
      else {
        player = res.player;
        logTravelResult(res.result);
        captureEvent('travel', { node: nodeId, kind: res.result.kind });
        await refreshNotifs();
      }
    }
  } else if (act === 'combat-confirm') {
    if (!pendingCombat) return;
    const res = commitTravel(player, pendingCombat, { assistsUsed: selectedAssists });
    pendingCombat = null;
    selectedAssists = [];
    if (!res.ok) pushLog(`Engage failed: ${res.reason}`);
    else {
      player = res.player;
      logTravelResult(res.result);
      captureEvent('combat', {
        success: res.result.combat?.success,
        encounter: res.result.combat?.encounter?.id,
      });
      tab = 'log';
      await refreshNotifs();
    }
  } else if (act === 'combat-cancel') {
    pendingCombat = null;
    selectedAssists = [];
    pushLog('Jump aborted. Fuel not spent.');
  } else if (act === 'exp-start') {
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
    if (player.crew.length < player.crewSlots) {
      player = { ...player, crew: [...player.crew, instance] };
      pushLog(`Hired ${instance.name} (${rarity}).`);
    } else {
      player = { ...player, wallet: grant(player.wallet, { credits: 50, medals: 2 }) };
      pushLog(`Pulled ${instance.name} (${rarity}) — no slot, sold +50cr.`);
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
    const sku = data.sku;
    pushLog(`Purchasing ${sku}…`);
    const res = await buyProduct(player, sku);
    if (!res.ok) pushLog(`Purchase failed: ${res.reason}`);
    else {
      player = res.player;
      pushLog(`Purchased ${sku}. Rewards applied.`);
      captureEvent('iap_success', { sku });
      // Soft prompt registration after first spend if guest
      const jp = getJestPlayer();
      if (jp && !jp.registered) {
        pushLog('Tip: register to keep purchases across devices.');
      }
      await refreshNotifs();
    }
  } else if (act === 'prompt-login') {
    const jp = getJestPlayer();
    if (jp?.registered) {
      pushLog(`Already registered as ${jp.username || jp.playerId}.`);
    } else if (isReal()) {
      const { loginButtonAction } = showRegistrationOverlay({
        theme: 'dark',
        message: 'Save Warp Crew progress! {{registrationCode}} is my code.',
        entryPayload: { reason: 'shop_prompt' },
        onClose: () => {},
      });
      // Auto-trigger login action for simplicity; overlay also available
      try {
        await login({ entryPayload: { reason: 'shop_prompt' } });
        const after = getJestPlayer();
        player = {
          ...player,
          _jestRegistered: Boolean(after?.registered),
          captainName: after?.username || player.captainName,
        };
        pushLog(after?.registered ? 'Registered on Jest.' : 'Login dismissed.');
      } catch (e) {
        pushLog('Login flow closed.');
        loginButtonAction?.();
      }
    } else {
      await login();
      player = { ...player, _jestRegistered: true };
      pushLog('Local mock: marked registered.');
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
    const daily = applyDailyLogin(player);
    player = daily.player;
    pushLog('Save reset.');
    await refreshNotifs();
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

boot();
