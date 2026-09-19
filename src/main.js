import { createNewPlayer, readyCrew } from './systems/player.js';
import { loadSave, writeSave, clearSave } from './systems/save.js';
import { claimFuelRegen } from './systems/fuel.js';
import { travelTo } from './systems/travel.js';
import { pullMerc, GACHA_COSTS } from './systems/gacha.js';
import { canAfford, pay, grant } from './systems/economy.js';
import {
  PLANETS_V1,
  expeditionSuccessChance,
  startExpedition,
  resolveExpedition,
} from './systems/expedition.js';
import { crewPower } from './systems/combat.js';
import { NODES } from './data/sectors.js';
import { renderBridge } from './ui/bridge.js';
import { MEDAL_LEVEL_COST } from './data/crewRoster.js';

const app = document.getElementById('app');
const log = [];
let player = null;

function pushLog(msg) {
  log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  while (log.length > 40) log.shift();
}

function persist() {
  writeSave(player);
}

function boot() {
  const saved = loadSave();
  if (saved?.player) {
    player = saved.player;
    pushLog('Welcome back, Captain.');
  } else {
    player = createNewPlayer({ captainName: 'Captain' });
    pushLog('New career started aboard the Sparrow.');
    pushLog('Tutorial: claim fuel, travel Dust Lane, hire a third merc when you can.');
  }
  // Auto-claim fuel on boot
  const claimed = claimFuelRegen(player);
  player = claimed.player;
  if (claimed.gained > 0) pushLog(`Offline fuel +${claimed.gained}.`);
  // Resolve expedition if ready
  if (player.activeExpedition) {
    const res = resolveExpedition(player.activeExpedition);
    if (res.ready) {
      player = {
        ...player,
        wallet: grant(player.wallet, res.rewards),
        activeExpedition: null,
        crew: player.crew.map((c) =>
          res.crewInstanceIds.includes(c.instanceId) ? { ...c, status: 'ready' } : c
        ),
        stats: { ...player.stats, expeditions: (player.stats.expeditions || 0) + 1 },
      };
      pushLog(
        res.success
          ? `Expedition success! +${res.rewards.credits}cr +${res.rewards.medals} medals`
          : `Expedition failed. Recovered +${res.rewards.credits}cr`
      );
    }
  }
  persist();
  render();
}

function render() {
  renderBridge(app, {
    player,
    log,
    handlers: { onAction: handleAction },
  });
}

function handleAction(act) {
  const now = Date.now();
  if (act === 'claim') {
    const claimed = claimFuelRegen(player, now);
    player = claimed.player;
    if (player.activeExpedition) {
      const res = resolveExpedition(player.activeExpedition);
      if (res.ready) {
        player = {
          ...player,
          wallet: grant(player.wallet, res.rewards),
          activeExpedition: null,
          crew: player.crew.map((c) =>
            res.crewInstanceIds.includes(c.instanceId) ? { ...c, status: 'ready' } : c
          ),
          stats: { ...player.stats, expeditions: (player.stats.expeditions || 0) + 1 },
        };
        pushLog(res.success ? 'Expedition complete — success!' : 'Expedition complete — rough return.');
      } else {
        pushLog('Expedition still underway.');
      }
    }
    pushLog(claimed.gained ? `Claimed +${claimed.gained} fuel.` : 'No fuel to claim yet.');
  } else if (act === 'travel') {
    // Simple chooser: list linked-ish nodes (all except current for v1 slice)
    const options = Object.values(NODES).filter((n) => n.id !== player.location);
    const pick = options[Math.floor(Math.random() * options.length)];
    // Prefer player-facing prompt
    const choice = window.prompt(
      'Travel to node id:\n' + options.map((n) => `${n.id} (${n.fuelCost} fuel) — ${n.name}`).join('\n'),
      pick.id
    );
    if (!choice) return;
    const res = travelTo(player, choice.trim(), { assistsUsed: ['shield_boost'] });
    if (!res.ok) {
      pushLog(`Travel failed: ${res.reason}`);
    } else {
      player = res.player;
      const r = res.result;
      if (r.kind === 'combat') {
        pushLog(`${r.combat.encounter.name}: ${r.combat.log}`);
      } else if (r.rewards) {
        pushLog(`${r.kind} at ${r.node.name}. Rewards: ${JSON.stringify(r.rewards)}`);
      } else if (r.flag) {
        pushLog(`Story: ${r.flag}`);
      } else {
        pushLog(`Arrived at ${r.node.name}.`);
      }
    }
  } else if (act === 'expedition') {
    if (player.activeExpedition) {
      pushLog('Expedition already active.');
    } else {
      const planet = PLANETS_V1[0];
      const crew = readyCrew(player).slice(0, Math.min(2, readyCrew(player).length));
      if (!crew.length) {
        pushLog('No ready crew for expedition.');
      } else {
        const power = crewPower(crew);
        const chance = expeditionSuccessChance({
          crewPower: power,
          planetDifficulty: planet.difficulty,
        });
        const job = startExpedition({
          planetId: planet.id,
          crewInstanceIds: crew.map((c) => c.instanceId),
          hours: planet.hours,
          successChance: chance,
        });
        player = {
          ...player,
          activeExpedition: job,
          crew: player.crew.map((c) =>
            crew.some((x) => x.instanceId === c.instanceId) ? { ...c, status: 'expedition' } : c
          ),
        };
        pushLog(`Expedition to ${planet.name} launched (${(chance * 100) | 0}% · ${planet.hours}h).`);
      }
    }
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
    pushLog('Early extract. Expedition failed.');
  } else if (act === 'gacha') {
    const free = player.dailyPullAvailable;
    const cost = free ? GACHA_COSTS.dailyFree : GACHA_COSTS.credits;
    if (!free && !canAfford(player.wallet, cost)) {
      pushLog('Not enough credits for a pull.');
      return;
    }
    if (!free) {
      const paid = pay(player.wallet, cost);
      player = { ...player, wallet: paid.wallet };
    } else {
      player = { ...player, dailyPullAvailable: false };
    }
    const { instance, rarity } = pullMerc({ reputation: player.wallet.reputation });
    if (player.crew.length < player.crewSlots) {
      player = { ...player, crew: [...player.crew, instance] };
      pushLog(`Hired ${instance.name} (${rarity}).`);
    } else {
      // auto-dismiss for credits
      player = {
        ...player,
        wallet: grant(player.wallet, { credits: 50, medals: 2 }),
      };
      pushLog(`Pulled ${instance.name} (${rarity}) — no slot, sold contract +50cr.`);
    }
  } else if (act === 'crew') {
    // Level first ready crew if medals allow
    const c = readyCrew(player)[0];
    if (!c) {
      pushLog('No ready crew.');
    } else {
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
    }
  } else if (act === 'ship') {
    // Unlock 3rd slot cheap for early progression
    if (player.crewSlots < 3) {
      const cost = { credits: 150 };
      if (!canAfford(player.wallet, cost)) {
        pushLog('Need 150 credits to expand crew quarters (slot 3).');
      } else {
        const paid = pay(player.wallet, cost);
        player = { ...player, wallet: paid.wallet, crewSlots: 3 };
        pushLog('Crew quarters expanded: 3 slots.');
      }
    } else if (player.crewSlots < 4) {
      const cost = { credits: 400 };
      if (!canAfford(player.wallet, cost)) {
        pushLog('Need 400 credits for 4th slot.');
      } else {
        const paid = pay(player.wallet, cost);
        player = { ...player, wallet: paid.wallet, crewSlots: 4 };
        pushLog('Crew quarters expanded: 4 slots.');
      }
    } else {
      pushLog('Shipyard: Sparrow at mid-slice cap. Corvette coming soon.');
    }
  } else if (act === 'qa-fuel') {
    player = { ...player, wallet: { ...player.wallet, fuel: (player.wallet.fuel || 0) + 5 } };
    pushLog('QA +5 fuel.');
  } else if (act === 'qa-gems') {
    player = { ...player, wallet: { ...player.wallet, gems: (player.wallet.gems || 0) + 100 } };
    pushLog('QA +100 gems.');
  } else if (act === 'qa-reset') {
    clearSave();
    player = createNewPlayer();
    pushLog('Save reset.');
  }

  // Story unlock: 3rd slot hint after first combat win
  if (player.stats.combatsWon >= 1 && player.crewSlots === 2) {
    pushLog('Shipyard can expand to a 3rd crew slot.');
  }

  persist();
  render();
}

boot();
