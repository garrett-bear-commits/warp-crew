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
import { renderApp } from './ui/bridge.js';
import { MEDAL_LEVEL_COST } from './data/crewRoster.js';

const app = document.getElementById('app');
const log = [];
let player = null;
let tab = 'ship';
let pendingCombat = null;
let selectedAssists = [];

function pushLog(msg) {
  log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  while (log.length > 50) log.shift();
}

function persist() {
  writeSave(player);
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

function boot() {
  const saved = loadSave();
  if (saved?.player) {
    player = migratePlayer(saved.player);
    pushLog('Welcome back, Captain.');
  } else {
    player = createNewPlayer({ captainName: 'Captain' });
    pushLog('Career start aboard Sparrow.');
    pushLog('Phase A: map travel, combat assists, gem skip, login streak.');
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
  persist();
  render();
}

function render() {
  renderApp(app, {
    player,
    log,
    tab,
    pendingCombat,
    selectedAssists,
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

function handleAction(act, data = {}) {
  if (act === 'claim' || act === 'exp-claim') {
    const claimed = claimFuelRegen(player);
    player = claimed.player;
    const resolved = tryResolveExpedition();
    if (claimed.gained) pushLog(`Claimed +${claimed.gained} fuel.`);
    else if (!resolved) pushLog('Nothing new to claim yet.');
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
      if (!res.ok) {
        pushLog(`Travel failed: ${res.reason}`);
      } else {
        player = res.player;
        logTravelResult(res.result);
      }
    }
  } else if (act === 'combat-confirm') {
    if (!pendingCombat) return;
    const res = commitTravel(player, pendingCombat, { assistsUsed: selectedAssists });
    pendingCombat = null;
    selectedAssists = [];
    if (!res.ok) {
      pushLog(`Engage failed: ${res.reason}`);
    } else {
      player = res.player;
      logTravelResult(res.result);
      tab = 'log';
    }
  } else if (act === 'combat-cancel') {
    pendingCombat = null;
    selectedAssists = [];
    pushLog('Jump aborted. Fuel not spent.');
  } else if (act === 'exp-start') {
    if (player.activeExpedition) {
      pushLog('Expedition already active.');
    } else {
      const planet = PLANETS_V1.find((p) => p.id === data.planet) || PLANETS_V1[0];
      const crew = readyCrew(player).slice(0, Math.min(2, readyCrew(player).length));
      if (!crew.length) {
        pushLog('No ready crew.');
      } else {
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
  } else if (act === 'gacha') {
    const free = player.dailyPullAvailable;
    const cost = free ? GACHA_COSTS.dailyFree : GACHA_COSTS.credits;
    if (!free && !canAfford(player.wallet, cost)) {
      pushLog('Need credits for a pull.');
      return;
    }
    if (!free) {
      player = { ...player, wallet: pay(player.wallet, cost).wallet };
    } else {
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
    tab = 'crew';
  } else if (act === 'level-crew') {
    const c = player.crew.find((x) => x.instanceId === data.id);
    if (!c) return;
    const cost = MEDAL_LEVEL_COST(c.level);
    if ((player.wallet.medals || 0) < cost) {
      pushLog(`Need ${cost} medals to level ${c.name}.`);
    } else {
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
    if (player.crewSlots < 3) {
      const cost = { credits: 150 };
      if (!canAfford(player.wallet, cost)) pushLog('Need 150 credits for 3rd slot.');
      else {
        player = { ...player, wallet: pay(player.wallet, cost).wallet, crewSlots: 3 };
        pushLog('Quarters expanded: 3 crew slots.');
      }
    } else if (player.crewSlots < 4) {
      const cost = { credits: 400 };
      if (!canAfford(player.wallet, cost)) pushLog('Need 400 credits for 4th slot.');
      else {
        player = { ...player, wallet: pay(player.wallet, cost).wallet, crewSlots: 4 };
        pushLog('Quarters expanded: 4 crew slots.');
      }
    } else pushLog('Sparrow mid-slice cap. Corvette later.');
  } else if (act === 'qa-fuel') {
    player = { ...player, wallet: { ...player.wallet, fuel: (player.wallet.fuel || 0) + 5 } };
    pushLog('QA +5 fuel.');
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
    pushLog(`Story: ${r.flag}`);
  } else {
    pushLog(`Arrived ${r.node.name}`);
  }
}

boot();
