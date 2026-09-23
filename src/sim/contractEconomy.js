import { createNewPlayer, tickCrewStatus } from '../systems/player.js';
import { prepareSession, sessionAction, sessionModels } from '../systems/sessionLoop.js';
import { claimFuelRegen } from '../systems/fuel.js';
import { applyDailyLogin } from '../systems/daily.js';
import { isTutorialActive } from '../systems/tutorial.js';
import { resolveExpedition, applyExpeditionResult, visiblePlanets } from '../systems/expedition.js';
import { nextUpgradeCost, upgradeSystem, SHIP_SYSTEMS } from '../systems/hangar.js';
import { markDailyMilestone } from '../systems/dailyLoop.js';

export const STRATEGIES = {
  cautious: { profiles: ['reliable', 'strange', 'risky'], route: 'secure', order: 'brace' },
  balanced: { profiles: ['strange', 'reliable', 'risky'], secureUnlessPushLeavesFuel: 2, burnGain: 0.10, burnFuelFloor: 1 },
  ambitious: { profiles: ['risky', 'strange', 'reliable'], route: 'push', boardChanceFloor: 0.75 },
};
export const ECONOMY_SEEDS = [4219, 17031, 88421, 240911, 990001];
export const ECONOMY_START = Date.UTC(2026, 8, 22, 12);
const CURRENCIES = ['credits', 'fuel', 'gems', 'medals', 'reputation'];
const zero = () => Object.fromEntries(CURRENCIES.map(key => [key, 0]));
const wallet = player => Object.fromEntries(CURRENCIES.map(key => [key, player.wallet[key] || 0]));

export function createSeededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function applyTransition(player, ui, result) {
  if (!result?.ok) throw new Error(`simulation transition failed: ${result?.reason || 'unknown'}`);
  return { player: result.player, ui: { ...ui, ...(result.ui || {}) } };
}
function contractIdentity(player, fields = {}) {
  return { ...fields, revision: player.activeContract.revision, acceptanceId: player.activeContract.acceptanceId };
}
function actionUi(player, ui, now) {
  return { ...ui, contractPreviews: sessionModels(player, ui, now).contractPreviews };
}

export function reconcileLedger(run) {
  const differences = {};
  for (const currency of CURRENCIES) {
    const difference = run.finalWallet[currency] - run.initialWallet[currency]
      - run.totals.sources[currency] + run.totals.sinks[currency];
    if (difference !== 0) differences[currency] = difference;
  }
  return { ok: Object.keys(differences).length === 0, differences };
}

export function simulateFreePlayer30Days({ seed, strategy, startAt = ECONOMY_START }) {
  const rules = STRATEGIES[strategy];
  if (!rules) throw new Error(`Unknown strategy: ${strategy}`);
  const rng = createSeededRng(seed);
  let player = createNewPlayer({ now: startAt, rng });
  let ui = {};
  const run = { seed, strategy, startAt, policy: { ads: false, purchases: false, skips: false, forceComplete: false },
    initialWallet: wallet(player), days: [], totals: { sources: zero(), sinks: zero(), rewardsBySource: {}, costsByAction: {} } };
  for (let index = 0; index < 30; index++) {
    const now = startAt + index * 86400000;
    const day = { day: index + 1, now, startWallet: wallet(player), startHull: player.ship.hull,
      actions: [], blockedActions: [], rewardsBySource: {}, costsByAction: {}, completedContracts: 0, completedExpeditions: 0,
      offers: [], contract: null, expedition: null, improvement: null, fuel: { gained: 0, spent: 0, wasted: 0, deferredAtCap: 0 } };
    const account = (source, next) => {
      for (const currency of CURRENCIES) {
        const delta = (next.wallet[currency] || 0) - (player.wallet[currency] || 0);
        if (!delta) continue;
        const kind = delta > 0 ? 'rewardsBySource' : 'costsByAction';
        day[kind][source] ||= zero(); run.totals[kind][source] ||= zero();
        day[kind][source][currency] += Math.abs(delta);
        run.totals[kind][source][currency] += Math.abs(delta);
        run.totals[delta > 0 ? 'sources' : 'sinks'][currency] += Math.abs(delta);
        if (currency === 'fuel') day.fuel[delta > 0 ? 'gained' : 'spent'] += Math.abs(delta);
      }
      player = next;
    };
    const blocked = (action, reason) => day.blockedActions.push({ action, reason });
    const act = (action, fields = {}) => {
      const result = sessionAction(player, actionUi(player, ui, now), action, fields, { now, rng });
      day.actions.push({ action, fields, ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) });
      if (!result.ok) { blocked(action, result.reason); return false; }
      const next = applyTransition(player, ui, result);
      account(action, next.player); ui = next.ui;
      if (action === 'contract-claim') day.completedContracts++;
      return true;
    };
    // Match hydration's first-login tutorial hold before driving the intro.
    const login = applyDailyLogin(player, now);
    if (isTutorialActive(player) && player.tutorial.phase !== 'done') {
      player = { ...player, lastLoginDay: login.player.lastLoginDay, loginStreak: login.player.loginStreak };
      day.loginRewardHeld = login.isNewDay;
    } else {
      const fuelBefore = player.wallet.fuel;
      account('daily-login', login.player);
      day.fuel.wasted += Math.max(0, (login.bonus?.fuel || 0) - (player.wallet.fuel - fuelBefore));
    }
    const rawAccrual = Math.floor(Math.max(0, now - player.fuelClaimAt) / 3600000 * player.fuelRatePerHour);
    const regen = claimFuelRegen(player, now);
    day.fuel.deferredAtCap = Math.max(0, rawAccrual - regen.gained);
    account('fuel-regen', regen.player);
    player = prepareSession(tickCrewStatus(player, now), now);
    if (index === 0) {
      const distress = player.contractBoard.offers[0];
      act('contract-review', { offer: distress.id });
      act('contract-accept', { offer: distress.id });
      act('contract-action', contractIdentity(player, { action: 'launch' }));
      act('contract-order', contractIdentity(player, { order: 'brace' }));
      act('contract-claim', contractIdentity(player, { action: 'claim' }));
      act('tutorial-draw');
      const first = player.contractBoard.offers[0];
      act('contract-review', { offer: first.id });
      act('contract-accept', { offer: first.id });
      act('exp-choose', { planet: 'dustfall' });
      act('exp-start', { planet: 'dustfall' });
      if (isTutorialActive(player)) throw new Error('Tutorial did not finish through production transitions');
    }
    if (player.activeExpedition) {
      const result = resolveExpedition(player.activeExpedition, { now, rng, player });
      if (result.ready) {
        const transition = applyExpeditionResult(player, result, { now });
        if (!transition.ok) throw new Error(transition.reason);
        account('expedition-claim', transition.player);
        day.completedExpeditions++;
        day.expedition = { planet: result.planet.id, success: result.success, rewards: result.rewards };
      } else blocked('expedition-claim', 'not_ready');
    }
    if (!player.activeExpedition) {
      // Stable first-visible destination; party is always production-recommended.
      const planet = visiblePlanets(player, now)[0];
      if (planet && act('exp-choose', { planet: planet.id })) act('exp-start', { planet: planet.id });
      else if (!planet) blocked('exp-start', 'no_visible_planet');
    } else blocked('exp-start', 'expedition_active');
    player = prepareSession(player, now);
    day.offers = player.contractBoard.offers.map(o => ({ id: o.id, profile: o.profile, destinationId: o.destinationId }));
    if (!player.activeContract) {
      const offer = rules.profiles.flatMap(profile => player.contractBoard.offers.filter(o => o.profile === profile
        && !player.contractBoard.completedOfferIds.includes(o.id)))[0];
      if (offer && act('contract-review', { offer: offer.id })) act('contract-accept', { offer: offer.id });
      else if (!offer) blocked('contract-accept', 'no_available_offer');
    }
    if (player.activeContract) {
      day.contract = { offerId: player.activeContract.offerId, profile: player.activeContract.profile, route: null, order: null, chance: null, outcome: null };
      // Finite stages; stop at the first failed production validation.
      for (let step = 0; step < 4 && player.activeContract; step++) {
        const stage = player.activeContract.stage;
        if (stage === 'return') {
          day.contract.outcome = structuredClone(player.activeContract.result);
          act('contract-claim', contractIdentity(player, { action: 'claim' }));
          break;
        }
        const previews = sessionModels(player, ui, now).contractPreviews;
        if (stage === 'briefing') {
          if (!act('contract-action', contractIdentity(player, { action: 'launch' }))) break;
        } else if (stage === 'choice') {
          let route = rules.route || 'secure';
          if (strategy === 'balanced' && previews.push.ok
            && player.wallet.fuel - previews.push.cost.fuel >= rules.secureUnlessPushLeavesFuel
            && !previews.push.consequence.sameEncounter
            && JSON.stringify(previews.push.consequence) !== JSON.stringify(previews.secure.consequence)) route = 'push';
          day.contract.route = route;
          if (!act('contract-action', contractIdentity(player, { action: route }))) break;
        } else if (stage === 'confrontation') {
          let order = 'brace';
          const brace = previews['order:brace'], burn = previews['order:burn'], board = previews['order:board'];
          if (strategy === 'balanced' && burn?.ok && burn.consequence.chance - brace.consequence.chance >= rules.burnGain
            && player.wallet.fuel - burn.cost.fuel >= rules.burnFuelFloor) order = 'burn';
          if (strategy === 'ambitious') order = board?.ok && board.consequence.chance >= rules.boardChanceFloor
            ? 'board' : burn?.ok ? 'burn' : 'brace';
          day.contract.order = order;
          day.contract.chance = previews[`order:${order}`].consequence?.chance ?? null;
          if (!act('contract-order', contractIdentity(player, { order }))) break;
        } else { blocked('contract', `unknown_stage:${stage}`); break; }
      }
    }
    const costs = SHIP_SYSTEMS.map(system => ({ system, cost: nextUpgradeCost(player, system) })).filter(x => x.cost)
      .sort((a, b) => a.cost.credits - b.cost.credits || a.system.localeCompare(b.system));
    day.affordabilityGaps = costs.map(({ system, cost }) => ({ system, credits: Math.max(0, cost.credits - player.wallet.credits) }));
    const cheapest = costs.find(x => x.cost.credits <= player.wallet.credits);
    if (cheapest) {
      const result = upgradeSystem(player, cheapest.system);
      if (!result.ok) blocked('ship-upgrade', result.reason);
      else {
        account('ship-upgrade', result.player);
        player = markDailyMilestone(player, 'improve', now);
        day.improvement = { system: cheapest.system, cost: result.cost, level: result.nextLevel };
      }
    } else blocked('ship-upgrade', 'cannot_afford');
    day.milestones = { ...player.dailyLoop };
    day.incompleteMilestones = ['contract', 'improve', 'away'].filter(key => !player.dailyLoop[key]);
    day.usefulAction = day.completedContracts > 0 || day.completedExpeditions > 0 || Boolean(day.improvement)
      || day.actions.some(a => a.action === 'exp-start' && a.ok);
    day.usefulSessionComplete = day.incompleteMilestones.length === 0;
    day.fuelStarved = day.blockedActions.some(a => a.reason === 'not_enough_fuel');
    day.endWallet = wallet(player); day.endHull = player.ship.hull;
    day.injuries = player.crew.filter(c => c.status === 'injured').map(c => ({ id: c.instanceId, until: c.injuredUntil }));
    day.pending = { contractStage: player.activeContract?.stage || null, expeditionEndsAt: player.activeExpedition?.endAt || null };
    run.days.push(day);
  }
  run.finalWallet = wallet(player);
  run.systemLevels = { ...player.ship.systems };
  run.finalCrew = player.crew;
  run.totals.net = Object.fromEntries(CURRENCIES.map(key => [key, run.finalWallet[key] - run.initialWallet[key]]));
  run.metrics = { usefulSessions: run.days.filter(d => d.usefulSessionComplete).length,
    noUsefulActionDays: run.days.filter(d => !d.usefulAction).length,
    fuelStarvedDays: run.days.filter(d => d.fuelStarved).length,
    upgrades: run.days.filter(d => d.improvement).length,
    completedContracts: run.days.reduce((sum, d) => sum + d.completedContracts, 0),
    completedExpeditions: run.days.reduce((sum, d) => sum + d.completedExpeditions, 0) };
  run.reconciliation = reconcileLedger(run);
  return run;
}

export function runEconomySeedSet({ seeds = ECONOMY_SEEDS, startAt = ECONOMY_START } = {}) {
  return { seeds, startAt, runs: Object.keys(STRATEGIES).flatMap(strategy => seeds.map(seed => simulateFreePlayer30Days({ seed, strategy, startAt }))) };
}

export function renderEconomyMarkdown(report) {
  const lines = ['## 30-day free-player economy', '',
    `Fixed seeds: ${report.seeds.join(', ')}. Start: ${new Date(report.startAt).toISOString()}; exactly 24 hours between check-ins.`, '',
    'Day 1 includes the tutorial, its already accepted first normal offer, and active Dustfall job. Later days choose the strategy-priority offer and first visible expedition with production-recommended crew. Cheapest affordable system wins; equal costs sort by system ID. Free daily-login gems are earned rewards; no premium grants, purchases, ads, skips, or force completion occur.', '',
    'A useful session completes all three daily milestones (contract, improvement, away launch). A useful action is any claim, upgrade, or away launch. Worst means fewest useful sessions/upgrades, most fuel-starved days, and greatest ending accumulation for each currency separately. Ties use the first listed seed. No target bands or tuning approval are implied.', '',
    'Fuel cap exclusion is recorded as deferredAtCap: production retains its claim cursor, so this accrual is banked, not permanently discarded. These daily backlog snapshots must not be summed as losses. Wasted fuel counts only discarded daily-login grants; wallet sinks count actual deductions.', '',
    '| Strategy | Metric | Median | Worst seed | Worst value |', '|---|---|---:|---:|---:|'];
  for (const strategy of Object.keys(STRATEGIES)) {
    const runs = report.runs.filter(r => r.strategy === strategy);
    const metrics = [
      ['Useful sessions / 30', r => r.metrics.usefulSessions, false],
      ['Fuel-starved days', r => r.metrics.fuelStarvedDays, true],
      ['Upgrades / 30 days', r => r.metrics.upgrades, false],
      ...CURRENCIES.map(currency => [`End ${currency}`, r => r.finalWallet[currency], true]),
    ];
    for (const [label, value, highWorst] of metrics) {
      const sorted = runs.map(value).sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      const worst = runs.reduce((a, b) => (highWorst ? value(b) > value(a) : value(b) < value(a)) ? b : a);
      lines.push(`| ${strategy} | ${label} | ${median} | ${worst.seed} | ${value(worst)} |`);
    }
  }
  lines.push('', `Conservation: ${report.runs.filter(r => r.reconciliation.ok).length}/${report.runs.length} runs PASS. Detailed daily ledgers: [JSON](artifacts/contract-economy-30-day.json).`, '');
  return lines.join('\n');
}
