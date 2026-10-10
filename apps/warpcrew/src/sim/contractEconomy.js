import { createNewPlayer, tickCrewStatus } from '../systems/player.js';
import { prepareSession, sessionAction, sessionModels } from '../systems/sessionLoop.js';
import { claimFuelRegen } from '../systems/fuel.js';
import { applyDailyLogin, dayKey } from '../systems/daily.js';
import { calendarState } from '../systems/calendar.js';
import { idleHaul } from '../systems/idle.js';
import { chestState, rollChest, weekKey } from '../systems/chests.js';
import { achievementProgress } from '../systems/achievements.js';
import { defaultTutorial, isTutorialActive, isFeatureUnlocked, noteTutorialEvent } from '../systems/tutorial.js';
import { pullOnce, benchCrew, callUpReserve } from '../systems/gacha.js';
import { readyContractCrew } from '../systems/contractRewards.js';
import { normalizeAssignments, STATIONS } from '../systems/stations.js';
import { fightPower } from '../systems/encounterState.js';
import { resolveExpedition, applyExpeditionResult, visiblePlanets } from '../systems/expedition.js';
import { nextUpgradeCost, upgradeSystem, buildSkipGems, SHIP_SYSTEMS } from '../systems/hangar.js';
import { markDailyMilestone, dailyPlan, MILESTONES } from '../systems/dailyLoop.js';
import { repelStatus } from '../systems/autoCombat.js';
import { ftlPolicyStep, FTL_VERSION, MAX_FIGHT_BEATS } from '../systems/ftlCombat.js';
import { reviewContractOffer } from '../systems/contracts.js';
import { WALLS, siegeState } from '../systems/walls.js';
import { FUEL_REFILL, RALLY } from '../systems/gemSinks.js';
import { STARTER_CAPTAINS, levelCap, medalLevelCostFor } from '../data/crewRoster.js';
import { hullRepairOffer, pay } from '../systems/economy.js';
import { repairHull, fuelCostFor } from '../systems/passives.js';
import { laneCheck, riskRead } from '../systems/sectorMap.js';

/** Guided captains patch the hull before a Siege-wall attempt when it is below this. */
const WALL_REPAIR_BELOW = 60;
import { NODES, STORY_BEATS, visibleNodes, gateBlockedByWall } from '../data/sectors.js';
import { laneNeighbors } from '../data/sectorMaps.js';
import { eventCandidates, resolveTravelEvent, choiceStatus, eventReward, EVENT_KINDS, EVENT_VERSION } from '../systems/travelEvents.js';
import { TRAVEL_EVENT_BY_ID } from '../data/events.js';

export const STRATEGIES = {
  cautious: { profiles: ['reliable', 'strange', 'risky'], route: 'secure', order: 'brace' },
  balanced: { profiles: ['strange', 'reliable', 'risky'], secureUnlessPushLeavesFuel: 2, burnGain: 0.10, burnFuelFloor: 1 },
  ambitious: { profiles: ['risky', 'strange', 'reliable'], route: 'push', boardChanceFloor: 0.75 },
};
/**
 * Guided-flow (script-5) knobs, used only by flow: 'guided'. The script-3 baseline ignores them.
 * wallFuelReserve: fuel kept back after a wall attempt. gems: what the free player spends earned gems on.
 *   never        — no gem spends (the free first Rally is still taken; it costs nothing).
 *   rally-refuel — paid Rally on a near miss; a 50-gem refill only when fuel-starved (cannot fund the
 *                  day's contract or the day's first wall attempt).
 *   all          — paid Rally, a refill whenever it buys another wall attempt, and drydock skips.
 */
export const GUIDED_STRATEGIES = {
  cautious: { wallFuelReserve: 3, gems: 'never' },
  balanced: { wallFuelReserve: 1, gems: 'rally-refuel' },
  ambitious: { wallFuelReserve: 0, gems: 'all' },
};
/**
 * Guided-flow crew growth (balance pass 2026-10-09), through production functions only. At the start of every
 * check-in each strategy takes the free daily hire (gacha pullOnce, as main.js doHire does), calls up a reserve
 * merc stronger than the weakest non-captain aboard (benchCrew + callUpReserve), and seats crew without a station
 * on an empty station of their own role (station-assign); the rest stay free for fires and repairs. Medals then
 * go on level-crew for the fighting crew, strongest first (the strongest whose next level is affordable). Levels
 * cost only medals and the drydock only credits, so the two never compete for a currency; `levelAt` is when in
 * the check-in the crew trains:
 *   before-fights  — cautious and balanced train first, so the day's contract and wall use the new levels.
 *   after-upgrades — ambitious puts the ship first: its evening drydock spend, then training, so the day's
 *                    fights run on yesterday's levels.
 * hires: 'free' for every strategy. None pays 500 credits or 100 gems for a hire: free play makes no purchases,
 * and a credit hire would starve the drydock.
 */
export const CREW_STRATEGIES = {
  cautious: { levelAt: 'before-fights', hires: 'free' },
  balanced: { levelAt: 'before-fights', hires: 'free' },
  ambitious: { levelAt: 'after-upgrades', hires: 'free' },
};
export const MAX_WALL_ATTEMPTS_PER_SESSION = 8;
/**
 * Guided-flow Explore policy, played after the day's contract and wall attempts (before the evening
 * upgrades and, in fights-first, before the away team leaves).
 *   fuelReserve  — fuel kept after the jump.  maxJumps — jumps per check-in.  minHull — no jump below this hull.
 *   avoid        — threat labels (the beacon card's honest risk read) the captain will not jump into.
 * Destinations: lit lanes only; unvisited beacons first, then best expected arrival value per fuel,
 * minus a strategy price on the beacon's fight share. Events use pickExploreChoice with the same policy name.
 */
export const EXPLORE_STRATEGIES = {
  cautious: { fuelReserve: 3, maxJumps: 1, minHull: 70, avoid: ['Dangerous', 'Deadly'], fightPrice: 2 },
  balanced: { fuelReserve: 2, maxJumps: 2, minHull: 50, avoid: ['Deadly'], fightPrice: 1 },
  ambitious: { fuelReserve: 1, maxJumps: 3, minHull: 35, avoid: [], fightPrice: 0 },
};
const EXPLORE_EVENT_POLICY = { cautious: 'cautious', balanced: 'balanced', ambitious: 'ambitious' };

/** Expected credit value of arriving at a beacon (non-fight outcomes, at their instant pay). */
function arrivalValue(node) {
  const outcomes = node?.outcomes || [];
  const total = outcomes.reduce((sum, outcome) => sum + outcome.w, 0) || 1;
  return outcomes.reduce((sum, outcome) => sum + (outcome.kind === 'combat' ? 0 : (outcome.w / total) * creditValue(outcome)), 0);
}

/** Gate beacons and the story beat at each that opens its sector (sectors.js). */
export const GATE_OPENS = Object.freeze({ veil_gate: 'veil_opened', ember_gate: 'ember_opened', hollow_mouth: 'hollow_opened', halo_approach: 'crown_opened' });

/**
 * The first lane hop toward a lit gate whose sector is still closed (shortest path over lit beacons), or null.
 * Balance pass 2026-10-09: a captain who broke a wall heads for the next sector's gate until it opens, as a
 * player chasing the next wall would; before, a first gate visit that rolled trade or a fight was never retried.
 */
export function gateStep(player, now) {
  const visible = new Set(visibleNodes(player, now).map(node => node.id));
  const goals = Object.keys(GATE_OPENS).filter(id => visible.has(id) && !player.flags?.[GATE_OPENS[id]] && !gateBlockedByWall(player, id));
  if (!goals.length) return null;
  const start = player.location || 'station_home';
  const from = { [start]: null };
  const queue = [start];
  while (queue.length) {
    const here = queue.shift();
    if (goals.includes(here) && here !== start) {
      let hop = here;
      while (from[hop] !== start) hop = from[hop];
      return hop;
    }
    for (const next of laneNeighbors(here).sort()) {
      if (!visible.has(next) || Object.hasOwn(from, next)) continue;
      from[next] = here;
      queue.push(next);
    }
  }
  return null;
}

/** The scripted captain's next jump from where the ship is, or null. */
export function pickExploreJump(player, strategy, now) {
  const rulesX = EXPLORE_STRATEGIES[strategy];
  const fuel = player.wallet?.fuel ?? 0;
  const toGate = gateStep(player, now);
  const options = [];
  for (const node of Object.values(NODES)) {
    if (node.id === 'station_home' || !laneCheck(player, node.id, now).ok) continue;
    const cost = fuelCostFor(player, node.fuelCost ?? 1);
    if (fuel - cost < rulesX.fuelReserve) continue;
    const risk = riskRead(player, node, now);
    if (risk.threat && rulesX.avoid.includes(risk.threat)) continue;
    const unvisited = !(player.stats?.visits?.[node.id] > 0);
    const score = (node.id === toGate ? 2000 : 0) + (unvisited ? 1000 : 0) + arrivalValue(node) / Math.max(1, cost) - rulesX.fightPrice * risk.fightPct;
    options.push({ id: node.id, fuel: cost, score, threat: risk.threat, fightPct: risk.fightPct });
  }
  return options.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0] || null;
}

/** At a gate's sector-opening event, the choice likeliest to open the sector (then the policy's own pick). */
export function pickGateChoice(player, ev, policy, now) {
  const preferred = pickExploreChoice(player, ev, policy, now);
  const template = TRAVEL_EVENT_BY_ID[ev.templateId];
  const share = choice => choice.outcomes.reduce((sum, outcome) => sum + (outcome.story ? outcome.w : 0), 0)
    / (choice.outcomes.reduce((sum, outcome) => sum + outcome.w, 0) || 1);
  const open = template.choices.filter(choice => choiceStatus(player, choice, now).available);
  const best = Math.max(0, ...open.map(share));
  if (!best || (preferred && share(preferred) === best)) return preferred;
  return open.filter(choice => share(choice) === best).sort((a, b) => a.id.localeCompare(b.id))[0];
}
/** contracts.js refuses a launch at or below this hull ('hull_critical'). */
const HULL_CRITICAL = 8;
const GEM_SINKS = { rally: 'rally', 'refuel-gems': 'fuel_refill', 'ship-build-skip': 'drydock_skip' };
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

/** Phase 2 sources in a run: credits by source, their share of all credits, daily chests opened, free gems a day. */
export function phase2Summary(run) {
  const by = run.totals.rewardsBySource;
  const credits = key => by[key]?.credits || 0;
  const all = Object.values(by).reduce((sum, r) => sum + (r.credits || 0), 0);
  const split = { calendar: credits('calendar'), idle: credits('idle'), chests: credits('chest:daily') + credits('chest:weekly'), achievements: credits('achievement') };
  const total = Object.values(split).reduce((a, b) => a + b, 0);
  const gems = Object.values(by).reduce((sum, r) => sum + (r.gems || 0), 0);
  return { credits: split, total, share: all ? total / all : 0, chestDays: run.days.filter(day => day.orders?.chest).length,
    gemsPerDay: Math.round((gems / run.days.length) * 10) / 10 };
}

export function simulateFreePlayer30Days({ seed, strategy, startAt = ECONOMY_START, flow = 'script3', sessionOrder = 'fights-first', onDayEnd = null, days = 30 }) {
  const rules = STRATEGIES[strategy];
  if (!rules) throw new Error(`Unknown strategy: ${strategy}`);
  if (!['script3', 'guided'].includes(flow)) throw new Error(`Unknown flow: ${flow}`);
  if (!['fights-first', 'away-first'].includes(sessionOrder)) throw new Error(`Unknown session order: ${sessionOrder}`);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error(`Unknown run length: ${days}`);
  const guided = flow === 'guided';
  const guide = GUIDED_STRATEGIES[strategy];
  const crewRules = CREW_STRATEGIES[strategy];
  const rng = createSeededRng(seed);
  // Preserve the approved script-3 baseline for historical 30-day comparisons.
  // flow: 'guided' plays the shipped script-5 first session, so siege walls apply.
  let player = guided ? createNewPlayer({ tutorialScript: 5, now: startAt, rng })
    : { ...createNewPlayer({ tutorialScript: 4, now: startAt, rng }), version: 7, tutorial: defaultTutorial() };
  let ui = {};
  const run = { seed, strategy, startAt, policy: { ads: false, purchases: false, skips: false, forceComplete: false },
    initialWallet: wallet(player), days: [], totals: { sources: zero(), sinks: zero(), rewardsBySource: {}, costsByAction: {} } };
  if (guided) {
    run.flow = 'guided';
    // Rotate the four starter captains across the fixed seed set (seed order), so each is played.
    const slot = ECONOMY_SEEDS.includes(seed) ? ECONOMY_SEEDS.indexOf(seed) : seed;
    run.captain = STARTER_CAPTAINS[slot % STARTER_CAPTAINS.length];
    run.gemPolicy = guide.gems;
    run.wallFuelReserve = guide.wallFuelReserve;
    run.sessionOrder = sessionOrder;
    // skips = gem-paid drydock finishes the player chose; still no purchases, ads or force completion.
    run.policy = { ...run.policy, skips: guide.gems === 'all' };
    run.wallAttempts = [];
    run.walls = {};
    run.builds = [];
  }
  const noteWalls = (day, index) => {
    for (const offer of player.contractBoard?.offers || []) {
      if (!offer.wall || run.walls[offer.wall.id]) continue;
      run.walls[offer.wall.id] = { id: offer.wall.id, pool: offer.wall.pool, arrivalDay: index + 1,
        gemsAtArrival: player.wallet.gems || 0, fuelAtArrival: player.wallet.fuel || 0, fellOnDay: null, packOffer: null };
      day.wallArrived = offer.wall.id;
    }
    for (const [id, record] of Object.entries(player.offers?.walls || {})) {
      if (run.walls[id] && !run.walls[id].packOffer) run.walls[id].packOffer = { day: index + 1, reason: record.reason };
    }
  };
  for (let index = 0; index < days; index++) {
    const now = startAt + index * 86400000;
    const day = { day: index + 1, now, startWallet: wallet(player), startHull: player.ship.hull,
      actions: [], blockedActions: [], rewardsBySource: {}, costsByAction: {}, completedContracts: 0, completedExpeditions: 0,
      offers: [], contract: null, expedition: null, improvement: null, fuel: { gained: 0, spent: 0, wasted: 0, deferredAtCap: 0 } };
    if (guided) Object.assign(day, { wallArrived: null, wallAttempts: [], improvements: [], buildCompleted: null, gemSpends: [], repairs: [],
      hires: [], callUps: [], levelUps: [] });
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
    // label: ledger bucket (defaults to the action); guided wall attempts and gem sinks get their own buckets.
    const act = (action, fields = {}, label = action) => {
      const result = sessionAction(player, actionUi(player, ui, now), action, fields, { now, rng });
      // Real-time fights take one action per second: their beats and commands are counted, not listed.
      if (['encounter-advance', 'encounter-command'].includes(action) && result.ok) day.fightSteps = (day.fightSteps || 0) + 1;
      else day.actions.push({ action, fields, ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) });
      if (!result.ok) { blocked(action, result.reason); return false; }
      const gemsBefore = player.wallet.gems || 0;
      const next = applyTransition(player, ui, result);
      account(label, next.player); ui = next.ui;
      if (action === 'contract-claim') day.completedContracts++;
      if (guided && GEM_SINKS[label]) day.gemSpends.push({ sink: GEM_SINKS[label], gems: gemsBefore - (player.wallet.gems || 0) });
      return true;
    };
    const refuel = reason => {
      if (!guided || guide.gems === 'never') return false;
      if ((player.wallet.gems || 0) < FUEL_REFILL.gems || (player.fuelMax ?? 10) - player.wallet.fuel < FUEL_REFILL.fuel) return false;
      const ok = act('refuel-gems');
      if (ok) day.gemSpends[day.gemSpends.length - 1].reason = reason;
      return ok;
    };
    // Match hydration's first-login tutorial hold before driving the intro.
    const login = applyDailyLogin(player, now);
    if (isTutorialActive(player) && player.tutorial.phase !== 'done') {
      player = { ...player, lastLoginDay: login.player.lastLoginDay, loginStreak: login.player.loginStreak };
      day.loginRewardHeld = login.isNewDay;
    } else account('daily-login', login.player);
    const rawAccrual = Math.floor(Math.max(0, now - player.fuelClaimAt) / 3600000 * player.fuelRatePerHour);
    const regen = claimFuelRegen(player, now);
    day.fuel.deferredAtCap = Math.max(0, rawAccrual - regen.gained);
    account('fuel-regen', regen.player);
    const buildBefore = player.shipBuild || null;
    player = prepareSession(tickCrewStatus(player, now), now);
    if (guided && buildBefore && !player.shipBuild) {
      // The drydock clock, not the check-in, finished this build.
      if (buildBefore.endAt > now) throw new Error('drydock build completed before its end time');
      day.buildCompleted = { ...buildBefore, completedAt: now };
    }
    if (index === 0 && guided) {
      // Shipped script-5 first session, through production transitions only.
      act('splash-dismiss');
      act('captain-choose', { templateId: run.captain, name: 'Captain' });
      act('tutorial-first-hire');
      const hired = player.crew.find(member => member.instanceId === player.tutorial.firstHireInstanceId);
      act('station-assign', { id: hired.instanceId, station: hired.templateId === 'merc_bolt' ? 'shields' : 'weapons' });
      act('tutorial-fight-start');
      const ident = () => ({ acceptanceId: player.activeEncounter.acceptanceId, revision: player.activeEncounter.revision });
      // The guided first fight: v3 asks the captain to target their Weapons room; saves from before used the v2 order.
      if (player.activeEncounter?.version === FTL_VERSION) act('encounter-command', { ...ident(), command: { type: 'target', room: 'weapons' } });
      else act('encounter-order', { ...ident(), order: 'target_weapons' });
      for (let beat = 0; beat < MAX_FIGHT_BEATS && player.tutorial.phase === 'fight'; beat++) if (!act('encounter-advance', ident())) break;
      act('contract-claim', contractIdentity(player, { action: 'claim' }));
      act('tutorial-name', { name: 'Sparrow' });
      act('tutorial-welcome-pull');
      act('tutorial-register-skip');
      if (isTutorialActive(player)) throw new Error('Guided tutorial did not finish through production transitions');
    } else if (index === 0) {
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
    // The login calendar (Phase 2 §2): today's square, once the tutorial is over. Fuel over the cap is lost.
    if (!isTutorialActive(player) && calendarState(player, now).canClaim) {
      const fuelBefore = player.wallet.fuel;
      const square = calendarState(player, now).reward;
      if (act('calendar-claim', {}, 'calendar')) day.fuel.wasted += Math.max(0, (square.fuel || 0) - (player.wallet.fuel - fuelBefore));
    }
    if (guided) noteWalls(day, index);
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
    // Income while away (Phase 2 §4), collected after the away team is home, as at a real boot. One check-in a day,
    // so the hold is full every morning but the first.
    if (!isTutorialActive(player) && idleHaul(player, now).ready) act('idle-claim', {}, 'idle');
    const launchAway = () => {
      if (!player.activeExpedition) {
        // Stable first-visible destination; party is always production-recommended.
        const planet = visiblePlanets(player, now)[0];
        if (planet && act('exp-choose', { planet: planet.id })) act('exp-start', { planet: planet.id });
        else if (!planet) blocked('exp-start', 'no_visible_planet');
      } else blocked('exp-start', 'expedition_active');
    };
    // Crew growth (CREW_STRATEGIES): medals on level-crew for the fighting crew, strongest first.
    const train = () => {
      for (let n = 0; n < 200; n++) {
        const next = readyContractCrew(player, now).find(member => (member.level || 1) < levelCap(member)
          && medalLevelCostFor(member) <= (player.wallet.medals || 0));
        if (!next) return;
        const level = next.level || 1;
        if (!act('level-crew', { id: next.instanceId })) return;
        day.levelUps.push({ id: next.instanceId, templateId: next.templateId, level: level + 1 });
      }
    };
    // The free daily hire, reserve call-ups and empty stations, like a captain on the Crew tab.
    const growCrew = () => {
      if (player.dailyPullAvailable && isFeatureUnlocked(player, 'gacha')) {
        const res = pullOnce(player, { free: true, now });
        if (!res.ok) blocked('crew-hire', res.reason);
        else {
          // main.js doHire notes a new crew member for the tutorial ledger.
          account('crew-hire', res.kind === 'hire' ? noteTutorialEvent(res.player, 'hired').player : res.player);
          day.hires.push({ templateId: res.instance.templateId, rarity: res.rarity, kind: res.kind });
        }
      }
      for (let n = 0; n < 8; n++) {
        const waiting = [...(player.reserve || [])].sort((a, b) => (b.power || 0) - (a.power || 0) || a.instanceId.localeCompare(b.instanceId))[0];
        if (!waiting) break;
        const weakest = (player.crew || []).filter(member => member.instanceId !== player.captainInstanceId && !member.isCaptain
          && member.status !== 'expedition').sort((a, b) => (a.power || 0) - (b.power || 0) || a.instanceId.localeCompare(b.instanceId))[0];
        const full = (player.crew || []).length >= (player.crewSlots || 2);
        if (full && !(weakest && (waiting.power || 0) > (weakest.power || 0))) break;
        const benched = full ? benchCrew(player, weakest.instanceId) : { ok: true, player };
        const called = benched.ok ? callUpReserve(benched.player, waiting.instanceId) : benched;
        if (!called.ok) { blocked('crew-call-up', called.reason); break; }
        account('crew-roster', called.player);
        day.callUps.push({ in: waiting.templateId, out: full ? weakest.templateId : null });
      }
      // Only onto an empty station of their own role: everyone else stays free to fight fires and repair rooms
      // (stationed crew never leave their post, so a crew seated everywhere lets a burning room burn for good).
      // A station held by a merc now in reserve counts as empty (assignStation clears them).
      const seats = normalizeAssignments(player);
      const taken = new Set((player.crew || []).map(member => seats[member.instanceId]).filter(Boolean));
      for (const member of player.crew || []) {
        if (seats[member.instanceId] || member.status !== 'ready' || (member.injuredUntil || 0) > now) continue;
        const station = Object.keys(STATIONS).find(id => !taken.has(id) && STATIONS[id].role === member.role);
        if (station && act('station-assign', { id: member.instanceId, station })) taken.add(station);
      }
    };
    if (guided && !isTutorialActive(player)) {
      growCrew();
      if (crewRules.levelAt === 'before-fights') train();
    }
    // fights-first: guided captains fight (contract, then the wall) with the whole crew aboard, then send
    // the away team. away-first keeps the baseline order, so the away party misses every fight that day.
    const awayFirst = !guided || sessionOrder === 'away-first';
    if (awayFirst) launchAway();
    // The production repair-hull handler (main.js): 25-hull patches for credits. Hull carries over between
    // FTL-lite fights, so like a real captain they patch up before a flagship (below 60 hull); for ordinary
    // contracts they patch only when the hull is critical, i.e. exactly when the launch would be refused.
    const repair = reason => {
      const floor = reason === 'wall' ? WALL_REPAIR_BELOW : HULL_CRITICAL + 1;
      while (guided && (player.ship.hull ?? 100) < floor) {
        const offer = hullRepairOffer(player);
        if (!offer || (player.wallet.credits || 0) < offer.cost) { blocked('repair-hull', 'cannot_afford'); return; }
        const patched = repairHull({ ...player, wallet: pay(player.wallet, { credits: offer.cost }).wallet }, offer.amount);
        account('hull-repair', patched.player);
        day.repairs.push({ reason, cost: offer.cost, gained: patched.gained });
      }
    };
    player = prepareSession(player, now);
    day.offers = player.contractBoard.offers.map(o => ({ id: o.id, profile: o.profile, destinationId: o.destinationId }));
    // Plays one accepted contract to its claim; returns the settled result (or null).
    const drive = (record, { wall = false } = {}) => {
      const tag = action => wall ? `wall:${action}` : action;
      let settled = null;
      // Finite stages; stop at the first failed production validation.
      for (let step = 0; step < 4 && player.activeContract; step++) {
        const stage = player.activeContract.stage;
        if (stage === 'return') {
          settled = structuredClone(player.activeContract.result);
          if (!wall) record.outcome = settled;
          act('contract-claim', contractIdentity(player, { action: 'claim' }), tag('contract-claim'));
          break;
        }
        const previews = sessionModels(player, ui, now).contractPreviews;
        if (stage === 'briefing') {
          if (!act('contract-action', contractIdentity(player, { action: 'launch' }), tag('contract-action'))) break;
        } else if (stage === 'choice') {
          let route = rules.route || 'secure';
          if (wall) route = previews.secure?.ok ? 'secure' : 'push';
          else if (strategy === 'balanced' && previews.push.ok
            && player.wallet.fuel - previews.push.cost.fuel >= rules.secureUnlessPushLeavesFuel
            && !previews.push.consequence.sameEncounter
            && JSON.stringify(previews.push.consequence) !== JSON.stringify(previews.secure.consequence)) route = 'push';
          record.route = route;
          // Route event card: the scripted policy takes the choice bound to its route.
          const routeEvent = sessionModels(player, ui, now).routeEvent;
          const choice = routeEvent?.choices.find(entry => entry.route === route) || null;
          if (choice) record.routeEvent = { id: routeEvent.id, choice: choice.id };
          if (!act('contract-action', contractIdentity(player, { action: route, ...(choice ? { choice: choice.id } : {}) }), tag('contract-action'))) break;
        } else if (stage === 'confrontation' && player.activeEncounter) {
          // Contract fights are real-time crew fights; every strategy plays disciplined orders.
          record.order = 'crew';
          // The power model's crew side as the fight starts (the reference-power calibration reads it).
          record.crewPower = fightPower(player, player.activeEncounter.encounterId, now);
          if (wall) record.remainingBefore = player.activeEncounter.enemy.remainingBefore ?? null;
          let beats = 0;
          const ftl = player.activeEncounter.version === FTL_VERSION;
          while (player.activeEncounter && !player.activeEncounter.result && beats < (ftl ? MAX_FIGHT_BEATS : 40)) {
            let encounter = player.activeEncounter;
            // FTL-lite fights: every strategy plays a disciplined captain (hold volleys, shields then guns).
            if (ftl && encounter.phase !== 'downed') {
              for (const command of ftlPolicyStep(encounter, 'smart').commands) {
                act('encounter-command', { acceptanceId: encounter.acceptanceId, revision: encounter.revision, command }, 'encounter-command');
                encounter = player.activeEncounter;
              }
            }
            const open = encounter.orderWindow?.availableOrders || [];
            let order;
            if (encounter.phase === 'downed') {
              // Baseline concedes; guided captains take the free first Rally and pay 60 gems only by policy.
              const free = player.flags?.rallyFreeUsed !== true;
              order = guided && (free || (guide.gems !== 'never' && (player.wallet.gems || 0) >= RALLY.gems)) ? 'rally' : 'concede';
              if (guided) {
                record.downed = (record.downed || 0) + 1;
                if (order === 'rally') record.rally = free ? 'free' : 'paid';
                else record.rallyDeclined = (player.wallet.gems || 0) >= RALLY.gems ? 'policy' : 'not_enough_gems';
              }
            } else order = ftl ? null : repelStatus(encounter).available ? 'repel'
              : open.includes('target_weapons') ? 'target_weapons'
                : open.includes('brace') ? 'brace'
                  : open.includes('repair') && encounter.hull <= 18 ? 'repair' : null;
            const ident = { acceptanceId: encounter.acceptanceId, revision: encounter.revision };
            const ok = order ? act('encounter-order', { ...ident, order }, order === 'rally' ? 'rally' : 'encounter-order') : act('encounter-advance', ident);
            if (!ok) break;
            beats += 1;
          }
          record.beats = beats;
          record.threat = player.activeEncounter?.enemy?.threat ?? null;
          if (player.activeContract?.stage !== 'return') {
            if (player.activeEncounter?.result === 'loss') act('encounter-recover', { acceptanceId: player.activeEncounter.acceptanceId, revision: player.activeEncounter.revision });
            break;
          }
        } else if (stage === 'confrontation') {
          let order = 'brace';
          const brace = previews['order:brace'], burn = previews['order:burn'], board = previews['order:board'];
          if (strategy === 'balanced' && burn?.ok && burn.consequence.chance - brace.consequence.chance >= rules.burnGain
            && player.wallet.fuel - burn.cost.fuel >= rules.burnFuelFloor) order = 'burn';
          if (strategy === 'ambitious') order = board?.ok && board.consequence.chance >= rules.boardChanceFloor
            ? 'board' : burn?.ok ? 'burn' : 'brace';
          record.order = order;
          record.chance = previews[`order:${order}`].consequence?.chance ?? null;
          if (!act('contract-order', contractIdentity(player, { order }))) break;
        } else { blocked('contract', `unknown_stage:${stage}`); break; }
      }
      return settled;
    };
    if (!player.activeContract) {
      const offer = rules.profiles.flatMap(profile => player.contractBoard.offers.filter(o => o.profile === profile
        && !o.wall && !player.contractBoard.completedOfferIds.includes(o.id)))[0];
      if (guided && offer) repair('contract');
      if (guided && offer && player.wallet.fuel < reviewContractOffer(player, offer.id).cost.fuel) refuel('contract');
      if (offer && act('contract-review', { offer: offer.id })) act('contract-accept', { offer: offer.id });
      else if (!offer) blocked('contract-accept', 'no_available_offer');
    }
    if (player.activeContract) {
      day.contract = { offerId: player.activeContract.offerId, profile: player.activeContract.profile, route: null, order: null, chance: null, outcome: null };
      drive(day.contract);
    }
    const buyUpgrades = () => {
      // Guided captains buy every affordable improvement the drydock allows, cheapest first.
      for (let n = 0; n < 12; n++) {
        const costs = SHIP_SYSTEMS.map(system => ({ system, cost: nextUpgradeCost(player, system) })).filter(x => x.cost)
          .sort((a, b) => a.cost.credits - b.cost.credits || a.system.localeCompare(b.system));
        const cheapest = costs.find(x => x.cost.credits <= player.wallet.credits);
        if (!cheapest) return;
        if (player.shipBuild) { blocked('ship-upgrade', 'drydock_busy'); return; }
        const level = player.ship.systems[cheapest.system] || 0;
        if (!act('ship-upgrade', { system: cheapest.system })) return;
        const improvement = { system: cheapest.system, cost: { credits: cheapest.cost.credits }, level: Math.max(1, level + 1),
          ...(player.shipBuild ? { build: { endAt: player.shipBuild.endAt, minutes: (player.shipBuild.endAt - now) / 60000 } } : {}) };
        day.improvements.push(improvement);
        day.improvement ||= improvement;
        if (!player.shipBuild) continue;
        run.builds.push({ day: index + 1, system: cheapest.system, targetLevel: player.shipBuild.targetLevel, startedAt: now, endAt: player.shipBuild.endAt });
        const skip = buildSkipGems(player.shipBuild.endAt - now);
        if (!(guide.gems === 'all' && (player.wallet.gems || 0) >= skip && act('ship-build-skip', {}, 'ship-build-skip'))) return;
        run.builds[run.builds.length - 1].skippedFor = skip;
      }
    };
    // Explore fights: the same disciplined captain as contracts. Downed captains concede (no Rally,
    // so the gem ledger and the free Rally stay with contracts and walls).
    const fightTravel = record => {
      let beats = 0;
      if (player.activeEncounter) record.crewPower = fightPower(player, player.activeEncounter.encounterId, now);
      while (player.activeEncounter && !player.activeEncounter.result && beats < MAX_FIGHT_BEATS) {
        let encounter = player.activeEncounter;
        if (encounter.version === FTL_VERSION && encounter.phase !== 'downed') {
          for (const command of ftlPolicyStep(encounter, 'smart').commands) {
            act('encounter-command', { acceptanceId: encounter.acceptanceId, revision: encounter.revision, command }, 'explore:encounter-command');
            encounter = player.activeEncounter;
          }
        }
        const ident = { acceptanceId: encounter.acceptanceId, revision: encounter.revision };
        if (encounter.phase === 'downed') record.downed = (record.downed || 0) + 1;
        const ok = encounter.phase === 'downed' ? act('encounter-order', { ...ident, order: 'concede' }, 'explore:encounter-order')
          : act('encounter-advance', ident, 'explore:encounter-advance');
        if (!ok) break;
        beats += 1;
      }
      record.beats = (record.beats || 0) + beats;
      const fight = player.activeTravelFight;
      if (fight?.stage !== 'return') { record.unsettled = true; return; }
      record.fights = (record.fights || 0) + 1;
      if (fight.result.success) record.fightWins = (record.fightWins || 0) + 1;
      act('travel-claim', { acceptanceId: fight.fightId, revision: fight.revision }, 'explore:travel-claim');
    };
    // Scripted Explore session: jump along lanes while fuel above the strategy reserve and hull allow.
    const explore = () => {
      const rulesX = EXPLORE_STRATEGIES[strategy];
      const sources = before => Object.fromEntries(CURRENCIES.map(c => [c, (player.wallet[c] || 0) - (before[c] || 0)]));
      const log = { jumps: [], stopped: null, startFuel: player.wallet.fuel, startHull: player.ship.hull ?? 100 };
      day.explore = log;
      for (let n = 0; n < rulesX.maxJumps; n++) {
        if (player.activeContract || player.activeTravelFight || player.activeEvent || player.activeEncounter) { log.stopped = 'busy'; break; }
        if ((player.ship.hull ?? 100) < rulesX.minHull) { log.stopped = 'hull_low'; break; }
        const target = pickExploreJump(player, strategy, now);
        if (!target) { log.stopped = player.wallet.fuel - 1 < rulesX.fuelReserve ? 'fuel_reserve' : 'no_lane'; break; }
        const before = wallet(player);
        const jump = { day: index + 1, from: player.location || 'station_home', to: target.id, fuel: target.fuel, kind: null, event: null, choice: null };
        if (!act('travel-to', { node: target.id }, 'explore:travel-to')) { log.stopped = 'refused'; break; }
        if (player.activeEvent) {
          jump.kind = 'event';
          jump.event = player.activeEvent.templateId;
          const ev = player.activeEvent;
          const choice = (ev.base?.kind === 'story' && Object.values(GATE_OPENS).includes(ev.base.flag) ? pickGateChoice : pickExploreChoice)(player, ev, EXPLORE_EVENT_POLICY[strategy], now);
          if (!choice) { log.stopped = 'no_choice'; log.jumps.push(jump); break; }
          jump.choice = choice.id;
          if (!act('event-choose', { eventId: player.activeEvent.eventId, choice: choice.id }, 'explore:event-choose')) { log.stopped = 'refused'; log.jumps.push(jump); break; }
          act('event-dismiss', {}, 'explore:event-dismiss');
        } else jump.kind = player.activeTravelFight ? 'fight' : 'arrive';
        if (player.activeTravelFight) {
          jump.fightFrom = jump.kind;
          fightTravel(jump);
        }
        jump.delta = sources(before);
        jump.hullAfter = player.ship.hull ?? 100;
        log.jumps.push(jump);
        if (jump.unsettled) { log.stopped = 'fight_unsettled'; break; }
      }
      if (!log.stopped) log.stopped = 'max_jumps';
    };
    if (guided) {
      buyUpgrades();
      // Evening wall: attempt the flagship while it is on the board and fuel above the strategy reserve remains.
      for (let attempt = 0; attempt < MAX_WALL_ATTEMPTS_PER_SESSION && !player.activeContract; attempt++) {
        player = prepareSession(player, now);
        noteWalls(day, index);
        const offer = player.contractBoard.offers.find(o => o.wall);
        if (!offer) break;
        const cost = reviewContractOffer(player, offer.id).cost.fuel;
        const firstToday = day.wallAttempts.length === 0;
        if (player.wallet.fuel - cost < guide.wallFuelReserve) {
          const starved = firstToday && player.wallet.fuel < cost;
          const wants = guide.gems === 'all' || (guide.gems === 'rally-refuel' && starved);
          if (!(wants && refuel(firstToday ? 'wall_first_attempt' : 'wall_extra_attempt') && player.wallet.fuel - cost >= guide.wallFuelReserve)) {
            day.wallStopped = player.wallet.fuel < cost ? 'not_enough_fuel' : 'fuel_reserve';
            break;
          }
        }
        repair('wall');
        if ((player.ship.hull ?? 100) <= HULL_CRITICAL) { day.wallStopped = 'hull_critical'; break; }
        const wall = WALLS.find(w => w.id === offer.wall.id);
        const record = { day: index + 1, wall: wall.id, offerId: offer.id, gemsBefore: player.wallet.gems || 0, fuelBefore: player.wallet.fuel, hullBefore: player.ship.hull ?? 100,
          remainingBefore: null, route: null, order: null };
        if (!(act('contract-review', { offer: offer.id }, 'wall:contract-review') && act('contract-accept', { offer: offer.id }, 'wall:contract-accept'))) break;
        const settled = drive(record, { wall: true });
        if (!settled?.wall) { record.unsettled = true; day.wallAttempts.push(record); run.wallAttempts.push(record); break; }
        const outcome = settled.wall;
        Object.assign(record, { success: settled.success, segment: outcome.segment, dealt: outcome.dealt, defeated: outcome.defeated === true,
          nearMissLoss: settled.success === false && outcome.segment > 0 && outcome.segment - outcome.dealt <= outcome.segment * RALLY.nearMissPct,
          rewards: settled.rewards, remainingAfter: siegeState(player, wall, now).remaining, beaten: player.flags?.[`wall_${wall.id}`] === true });
        day.wallAttempts.push(record); run.wallAttempts.push(record);
        if (record.beaten && run.walls[wall.id]) run.walls[wall.id].fellOnDay = index + 1;
      }
      explore();
      player = prepareSession(player, now);
      noteWalls(day, index);
      buyUpgrades();
      if (crewRules.levelAt === 'after-upgrades') train();
      if (!awayFirst) launchAway();
      if (!day.improvement) blocked('ship-upgrade', player.shipBuild ? 'drydock_busy' : 'cannot_afford');
      const costs = SHIP_SYSTEMS.map(system => ({ system, cost: nextUpgradeCost(player, system) })).filter(x => x.cost);
      day.affordabilityGaps = costs.map(({ system, cost }) => ({ system, credits: Math.max(0, cost.credits - player.wallet.credits) }));
      day.drydock = player.shipBuild ? { ...player.shipBuild } : null;
    } else {
      const costs = SHIP_SYSTEMS.map(system => ({ system, cost: nextUpgradeCost(player, system) })).filter(x => x.cost)
        .sort((a, b) => a.cost.credits - b.cost.credits || a.system.localeCompare(b.system));
      day.affordabilityGaps = costs.map(({ system, cost }) => ({ system, credits: Math.max(0, cost.credits - player.wallet.credits) }));
      const cheapest = costs.find(x => x.cost.credits <= player.wallet.credits);
      if (cheapest) {
        const result = upgradeSystem(player, cheapest.system, now);
        if (!result.ok) blocked('ship-upgrade', result.reason);
        else {
          account('ship-upgrade', result.player);
          player = markDailyMilestone(player, 'improve', now);
          day.improvement = { system: cheapest.system, cost: result.cost, level: result.nextLevel };
        }
      } else blocked('ship-upgrade', 'cannot_afford');
    }
    // Phase 2 §3 and §5: achievement tiers earned and the day's chests, as a captain on the Log tab would.
    if (!isTutorialActive(player)) {
      for (let n = 0; n < 40; n++) {
        const line = achievementProgress(player).find(item => item.ready);
        if (!line || !act('achievement-claim', { id: line.id }, 'achievement')) break;
      }
      for (const kind of ['daily', 'weekly']) {
        if (!chestState(player, now)[kind].ready) continue;
        const fuelBefore = player.wallet.fuel;
        const roll = rollChest(player, kind, kind === 'daily' ? dayKey(now) : weekKey(now));
        if (act('chest-open', { kind }, `chest:${kind}`)) day.fuel.wasted += Math.max(0, (roll.reward.fuel || 0) - (player.wallet.fuel - fuelBefore));
      }
    }
    day.orders = { points: dailyPlan(player, now).points, done: MILESTONES.filter(m => player.dailyLoop?.[m.id] === true).map(m => m.id),
      chest: player.dailyLoop?.chest === true };
    day.milestones = { ...player.dailyLoop };
    day.incompleteMilestones = ['contract', 'improve', 'away'].filter(key => !player.dailyLoop[key]);
    day.usefulAction = day.completedContracts > 0 || day.completedExpeditions > 0 || Boolean(day.improvement)
      || day.actions.some(a => a.action === 'exp-start' && a.ok);
    day.usefulSessionComplete = day.incompleteMilestones.length === 0;
    day.fuelStarved = day.blockedActions.some(a => a.reason === 'not_enough_fuel');
    day.endWallet = wallet(player); day.endHull = player.ship.hull;
    if (guided) day.crew = { size: player.crew.length, reserve: (player.reserve || []).length,
      levels: player.crew.map(member => member.level || 1), power: player.crew.reduce((sum, member) => sum + (member.power || 0), 0) };
    day.injuries = player.crew.filter(c => c.status === 'injured').map(c => ({ id: c.instanceId, until: c.injuredUntil }));
    day.pending = { contractStage: player.activeContract?.stage || null, expeditionEndsAt: player.activeExpedition?.endAt || null };
    run.days.push(day);
    // Calibration and success-test harnesses read the end-of-day save (shorter runs pass days); the run ignores the return.
    onDayEnd?.(player, day);
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
  if (guided) summarizeGuided(run);
  run.reconciliation = reconcileLedger(run);
  return run;
}

/** Per-wall siege metrics and the gem ledger, derived only from recorded attempts and ledger buckets. */
function summarizeGuided(run) {
  for (const wall of Object.values(run.walls)) {
    const attempts = run.wallAttempts.filter(a => a.wall === wall.id);
    const attemptDays = [...new Set(attempts.map(a => a.day))];
    const lastDay = wall.fellOnDay ?? 30;
    Object.assign(wall, {
      attempts: attempts.length,
      attemptDays: attemptDays.length,
      attemptsPerAttemptDay: attemptDays.length ? Math.round(attempts.length / attemptDays.length * 100) / 100 : 0,
      daysOnBoard: lastDay - wall.arrivalDay + 1,
      daysToBreak: wall.fellOnDay ? wall.fellOnDay - wall.arrivalDay + 1 : null,
      losses: attempts.filter(a => a.success === false).length,
      nearMissLosses: attempts.filter(a => a.nearMissLoss).length,
      rallies: { free: attempts.filter(a => a.rally === 'free').length, paid: attempts.filter(a => a.rally === 'paid').length },
      bestDayDamage: Math.max(0, ...attemptDays.map(d => wall.pool - Math.min(...attempts.filter(a => a.day === d).map(a => a.remainingAfter ?? wall.pool)))),
    });
  }
  const gemsBy = kind => Object.fromEntries(Object.entries(run.totals[kind]).filter(([, v]) => v.gems > 0).map(([k, v]) => [k, v.gems]));
  const spentBySink = { rally: 0, fuel_refill: 0, drydock_skip: 0 };
  for (const [bucket, gems] of Object.entries(gemsBy('costsByAction'))) {
    if (!GEM_SINKS[bucket]) throw new Error(`unclassified gem sink: ${bucket}`);
    spentBySink[GEM_SINKS[bucket]] += gems;
  }
  run.gems = { earned: run.totals.sources.gems, earnedBySource: gemsBy('rewardsBySource'),
    spent: run.totals.sinks.gems, spentBySink, end: run.finalWallet.gems,
    daysWithSpend: run.days.filter(d => d.gemSpends.some(spend => spend.gems > 0)).length };
  run.explore = summarizeExplore(run);
  const fights = [...run.days.map(d => d.contract).filter(Boolean), ...run.wallAttempts];
  const first = run.walls[WALLS[0].id];
  Object.assign(run.metrics, {
    rallies: { free: fights.filter(f => f.rally === 'free').length, paid: fights.filter(f => f.rally === 'paid').length,
      declined: fights.filter(f => f.rallyDeclined).length },
    wallArrivalDay: first?.arrivalDay ?? null,
    wallFellOnDay: first?.fellOnDay ?? null,
    wallDaysToBreak: first?.daysToBreak ?? null,
    wallAttempts: first?.attempts ?? 0,
    wallAttemptsPerAttemptDay: first?.attemptsPerAttemptDay ?? 0,
    wallNearMissLosses: first?.nearMissLosses ?? 0,
    gemsAtWall: first?.gemsAtArrival ?? null,
    gemsEarned: run.gems.earned,
    gemsSpent: run.gems.spent,
    wallsBroken: Object.values(run.walls).filter(w => w.fellOnDay).length,
    upgradeLevels: run.days.reduce((sum, d) => sum + d.improvements.length, 0),
    drydockBusyDays: run.days.filter(d => d.blockedActions.some(a => a.reason === 'drydock_busy')).length,
    hullRepairCredits: run.totals.costsByAction['hull-repair']?.credits || 0,
    exploreJumps: run.explore.jumps,
    exploreEvents: run.explore.events,
    exploreFights: run.explore.fights,
    exploreCredits: run.explore.netCredits,
    exploreCreditShare: run.totals.sources.credits ? Math.round(run.explore.earned.credits / run.totals.sources.credits * 100) : 0,
    // The free-play targets (crew-matter design §4): fight win rates by day 7 and day 30, credits per day.
    fightWinPctDay7: fightWinPct(run, 7),
    fightWinPctDay30: fightWinPct(run, 30),
    wallWinPct: run.wallAttempts.length ? Math.round(run.wallAttempts.filter(a => a.success).length / run.wallAttempts.length * 100) : null,
    creditsPerDay: Math.round(run.totals.sources.credits / run.days.length),
    crewHires: run.days.reduce((sum, d) => sum + d.hires.length, 0),
    crewLevelUps: run.days.reduce((sum, d) => sum + d.levelUps.length, 0),
    crewSize: run.finalCrew.length,
    crewPower: run.finalCrew.reduce((sum, member) => sum + (member.power || 0), 0),
  });
}

/** Percent of contract and Explore crew fights won from day 1 through `lastDay` (walls are counted apart), or null. */
function fightWinPct(run, lastDay) {
  let fights = 0, wins = 0;
  for (const day of run.days.filter(d => d.day <= lastDay)) {
    if (day.contract?.order === 'crew' && day.contract.outcome) { fights += 1; wins += day.contract.outcome.success ? 1 : 0; }
    for (const jump of day.explore?.jumps || []) { fights += jump.fights || 0; wins += jump.fightWins || 0; }
  }
  return fights ? Math.round(wins / fights * 100) : null;
}

/** Explore stats from the day logs and the explore:* ledger buckets. */
function summarizeExplore(run) {
  const jumps = run.days.flatMap(d => d.explore?.jumps || []);
  const bucket = kind => {
    const total = zero();
    for (const [key, value] of Object.entries(run.totals[kind])) if (key.startsWith('explore:')) for (const c of CURRENCIES) total[c] += value[c];
    return total;
  };
  const earned = bucket('rewardsBySource');
  const spent = bucket('costsByAction');
  const stops = {};
  for (const d of run.days) if (d.explore?.stopped) stops[d.explore.stopped] = (stops[d.explore.stopped] || 0) + 1;
  return {
    jumps: jumps.length,
    days: run.days.filter(d => d.explore?.jumps.length).length,
    events: jumps.filter(j => j.kind === 'event').length,
    fights: jumps.reduce((sum, j) => sum + (j.fights || 0), 0),
    fightWins: jumps.reduce((sum, j) => sum + (j.fightWins || 0), 0),
    eventFights: jumps.filter(j => j.kind === 'event' && j.fights).length,
    downed: jumps.reduce((sum, j) => sum + (j.downed || 0), 0),
    beacons: new Set(jumps.map(j => j.to)).size,
    sectors: [...new Set(jumps.map(j => NODES[j.to]?.sector).filter(Boolean))],
    earned, spent,
    netCredits: earned.credits - spent.credits,
    stops,
  };
}

/** Summary-only copy of a run (no daily ledgers), for sensitivity sets. */
function runSummary(run) {
  const { seed, strategy, captain, gemPolicy, wallFuelReserve, sessionOrder, policy, metrics, walls, gems, explore, builds, finalWallet, systemLevels, reconciliation } = run;
  return { seed, strategy, captain, gemPolicy, wallFuelReserve, sessionOrder, policy, metrics, walls, gems, explore, builds, finalWallet, systemLevels, reconciliation };
}

export function runEconomySeedSet({ seeds = ECONOMY_SEEDS, startAt = ECONOMY_START } = {}) {
  const strategies = Object.keys(STRATEGIES);
  const guided = sessionOrder => strategies.flatMap(strategy => seeds.map(seed => simulateFreePlayer30Days({ seed, strategy, startAt, flow: 'guided', sessionOrder })));
  return {
    seeds, startAt, runs: strategies.flatMap(strategy => seeds.map(seed => simulateFreePlayer30Days({ seed, strategy, startAt }))),
    guided: { flow: 'guided', sessionOrder: 'fights-first', runs: guided('fights-first') },
    guidedAwayFirst: { flow: 'guided', sessionOrder: 'away-first', runs: guided('away-first').map(runSummary) },
    explore: auditExploreEvents({ startAt }),
  };
}

const medianOf = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
function metricRows(lines, runs, strategy, metrics) {
  for (const [label, value, highWorst, show = x => x] of metrics) {
    const worst = runs.reduce((a, b) => (highWorst ? value(b) > value(a) : value(b) < value(a)) ? b : a);
    lines.push(`| ${strategy} | ${label} | ${show(medianOf(runs.map(value)))} | ${worst.seed} | ${show(value(worst))} |`);
  }
}
// A wall still standing on day 30 sorts as day 31 and prints as "not in 30".
const NOT_FALLEN = 31;
const fellDay = day => day ?? NOT_FALLEN;
const showDay = day => day >= NOT_FALLEN ? 'not in 30' : String(day);

export function renderEconomyMarkdown(report) {
  const lines = ['## 30-day free-player economy', '',
    `Fixed seeds: ${report.seeds.join(', ')}. Start: ${new Date(report.startAt).toISOString()}; exactly 24 hours between check-ins.`, '',
    'Day 1 includes the tutorial, its already accepted first normal offer, and active Dustfall job. Later days choose the strategy-priority offer and first visible expedition with production-recommended crew. Cheapest affordable system wins; equal costs sort by system ID. Free login-calendar gems are earned rewards; no premium grants, purchases, ads, skips, or force completion occur.', '',
    'A useful session completes all three daily milestones (contract, improvement, away launch). A useful action is any claim, upgrade, or away launch. Worst means fewest useful sessions/upgrades, most fuel-starved days, and greatest ending accumulation for each currency separately. Ties use the first listed seed. No target bands or tuning approval are implied.', '',
    'Fuel cap exclusion is recorded as deferredAtCap: production retains its claim cursor, so this accrual is banked, not permanently discarded. These daily backlog snapshots must not be summed as losses. Wasted fuel counts only discarded login-calendar and chest fuel; wallet sinks count actual deductions.', '',
    '| Strategy | Metric | Median | Worst seed | Worst value |', '|---|---|---:|---:|---:|'];
  for (const strategy of Object.keys(STRATEGIES)) {
    const runs = report.runs.filter(r => r.strategy === strategy);
    const metrics = [
      ['Useful sessions / 30', r => r.metrics.usefulSessions, false],
      ['Fuel-starved days', r => r.metrics.fuelStarvedDays, true],
      ['Upgrades / 30 days', r => r.metrics.upgrades, false],
      ...CURRENCIES.map(currency => [`End ${currency}`, r => r.finalWallet[currency], true]),
    ];
    metricRows(lines, runs, strategy, metrics);
  }
  lines.push('', `Conservation: ${report.runs.filter(r => r.reconciliation.ok).length}/${report.runs.length} runs PASS. Detailed daily ledgers: [JSON](artifacts/contract-economy-30-day.json).`, '');
  if (report.guided) lines.push(...renderGuidedMarkdown(report));
  if (report.explore) lines.push(...renderExploreMarkdown(report.explore));
  return lines.join('\n');
}

function renderGuidedMarkdown(report) {
  const strategies = Object.keys(STRATEGIES);
  const runs = report.guided.runs;
  const away = report.guidedAwayFirst?.runs || [];
  const policy = strategy => `${strategy}: wall fuel reserve ${GUIDED_STRATEGIES[strategy].wallFuelReserve}, gems ${GUIDED_STRATEGIES[strategy].gems}`;
  const lines = ['## 30-day guided-flow economy: siege walls, gems, timed drydock', '',
    `Added 2026-09-27; the script-3 section above is unchanged. Same seeds, start and one check-in every 24 hours, but each captain plays the shipped script-5 first session (captains rotate by seed: ${[...new Set(runs.map(r => r.captain))].join(', ')}), so siege walls apply. All transitions go through production session actions; wall attempts, Rally, gem refills and drydock skips are ledgered in their own buckets (wall:*, rally, refuel-gems, ship-build-skip, hull-repair).`, '',
    `Session order (fights-first): claim returned away team, patch the hull only if critical (production repair-hull: 25 hull for 35 credits), strategy contract, buy every affordable improvement the drydock allows (levels above 3 start a timed build that completes on a later check-in through prepareSession), attack the wall while it is on the board and fuel minus the attempt cost stays at or above the strategy reserve (at most ${MAX_WALL_ATTEMPTS_PER_SESSION} attempts), buy again, then launch the away team. Wall fights use the same disciplined crew orders as contracts. Gem policies: ${strategies.map(policy).join('; ')}. never = no gem spends (the free first Rally is still taken); rally-refuel = paid Rally on a near miss and a 50-gem refill only when the day's contract or first wall attempt is unaffordable; all = paid Rally, a refill whenever it buys another wall attempt, and every drydock skip it can afford. No purchases, ads or force completion; wall-pack offers are recorded when production triggers them but never bought.`, '',
    `Explore (added 2026-10-05): after the contract and the wall attempts, the captain jumps along lit lanes while fuel minus the jump stays at or above the strategy's Explore reserve and the hull is at or above its floor (${Object.entries(EXPLORE_STRATEGIES).map(([k, v]) => `${k}: reserve ${v.fuelReserve}, up to ${v.maxJumps} jump${v.maxJumps > 1 ? 's' : ''}, hull ≥ ${v.minHull}, avoids ${v.avoid.length ? v.avoid.join('/') : 'nothing'}`).join('; ')}). Unvisited beacons first, then the best expected arrival pay per fuel minus a price on the beacon's fight share. Events are resolved with the strategy's pickExploreChoice policy; Explore fights (beacon or event) use the same disciplined crew captain and concede when downed (Explore never spends the Rally). Explore actions are ledgered in explore:* buckets.`, '',
    `Crew growth and threat (added 2026-10-09, [balance pass](2026-10-09-balance-pass.md)): every check-in the captain takes the free daily hire (no paid hires), calls up a reserve merc stronger than the weakest non-captain aboard, seats crew without a station on an empty station of their own role (the rest stay free for fires and repairs) and spends medals on crew levels, strongest fighter first (${Object.entries(CREW_STRATEGIES).map(([k, v]) => `${k}: ${v.levelAt}`).join('; ')}). Fight threat comes from the encounter, the sector and a reference crew power by day played, not from the crew aboard. A captain whose next sector is still closed heads for its gate beacon on Explore and takes the event choice likeliest to open it. Fight wins count contract and Explore crew fights (a run with none counts as 100); wall attempts are counted apart.`, '',
    'Not modeled: expedition gem skips; a second check-in the same day. Injuries from a same-instant claim still block that day\'s away launch (empty_party), as in the baseline. Worst: latest wall arrival and fall, most attempts and near-miss losses, largest gem buffer at the wall (least need for a wall pack), fewest gems earned, most gems spent, most repair credits, fewest useful sessions/upgrades/walls, lowest win rates, credits per day and crew growth.', '',
    '| Strategy | Metric | Median | Worst seed | Worst value |', '|---|---|---:|---:|---:|'];
  for (const strategy of strategies) {
    metricRows(lines, runs.filter(r => r.strategy === strategy), strategy, [
      ['Useful sessions / 30', r => r.metrics.usefulSessions, false],
      ['Fuel-starved days', r => r.metrics.fuelStarvedDays, true],
      ['Upgrade days / 30', r => r.metrics.upgrades, false],
      ['Upgrade levels / 30', r => r.metrics.upgradeLevels, false],
      ['Drydock-busy days', r => r.metrics.drydockBusyDays, true],
      ['First wall arrival day', r => r.metrics.wallArrivalDay ?? NOT_FALLEN, true, showDay],
      ['First wall fell on day', r => fellDay(r.metrics.wallFellOnDay), true, showDay],
      ['First wall attempts', r => r.metrics.wallAttempts, true],
      ['First wall attempts / attempt day', r => r.metrics.wallAttemptsPerAttemptDay, true],
      ['First wall near-miss losses', r => r.metrics.wallNearMissLosses, true],
      ['Gems at first wall arrival', r => r.metrics.gemsAtWall ?? 0, true],
      ['Walls broken / 30 days', r => r.metrics.wallsBroken, false],
      ['Fight wins, days 1-7 (%)', r => r.metrics.fightWinPctDay7 ?? 100, false],
      ['Fight wins, days 1-30 (%)', r => r.metrics.fightWinPctDay30 ?? 100, false],
      ['Wall attempts won (%)', r => r.metrics.wallWinPct ?? 0, false],
      ['Credits earned per day', r => r.metrics.creditsPerDay, false],
      ['Free hires', r => r.metrics.crewHires, false],
      ['Crew levels bought', r => r.metrics.crewLevelUps, false],
      ['End crew power', r => r.metrics.crewPower, false],
      ['Gems earned', r => r.metrics.gemsEarned, false],
      ['Gems spent', r => r.metrics.gemsSpent, true],
      ['End gems', r => r.finalWallet.gems, true],
      ['Hull repair credits', r => r.metrics.hullRepairCredits, true],
      ['Explore jumps', r => r.metrics.exploreJumps, false],
      ['Explore events', r => r.metrics.exploreEvents, false],
      ['Explore fights', r => r.metrics.exploreFights, true],
      ['Explore net credits', r => r.metrics.exploreCredits, false],
      ['Explore share of credits earned (%)', r => r.metrics.exploreCreditShare, false],
    ]);
  }
  lines.push('', '### Explore per run (fights-first)', '',
    'Credits, medals and reputation are what explore:* buckets paid (event rewards, fight prizes, instant arrivals) minus Explore credit costs. Stops count the reason each check-in\'s Explore session ended.', '',
    '| Strategy | Seed | Jumps | Days exploring | Events | Fights (won) | Downed | Beacons | Sectors | Fuel | Net credits | Medals | Reputation | Stops |',
    '|---|---:|---:|---:|---:|---|---:|---:|---|---:|---:|---:|---:|---|');
  for (const run of runs) {
    const x = run.explore;
    lines.push(`| ${run.strategy} | ${run.seed} | ${x.jumps} | ${x.days} | ${x.events} | ${x.fights} (${x.fightWins}) | ${x.downed} | ${x.beacons} | ${x.sectors.join(', ') || '—'} | ${x.spent.fuel} | ${x.netCredits} | ${x.earned.medals} | ${x.earned.reputation} | ${Object.entries(x.stops).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
  }
  lines.push('', '### Walls per run (fights-first)', '',
    '| Strategy | Seed | Captain | Wall | Arrival day | Gems at arrival | Attempts | Attempt days | Attempts / attempt day | Fell on day | Days to break | Losses | Near-miss losses | Rally free/paid | Wall-pack offer |',
    '|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
  for (const run of runs) {
    const walls = Object.values(run.walls);
    if (!walls.length) lines.push(`| ${run.strategy} | ${run.seed} | ${run.captain} | none reached | | | | | | | | | | | |`);
    for (const wall of walls) {
      lines.push(`| ${run.strategy} | ${run.seed} | ${run.captain} | ${wall.id} (${wall.pool}) | ${wall.arrivalDay} | ${wall.gemsAtArrival} | ${wall.attempts} | ${wall.attemptDays} | ${wall.attemptsPerAttemptDay} | ${showDay(fellDay(wall.fellOnDay))} | ${wall.daysToBreak ?? '—'} | ${wall.losses} | ${wall.nearMissLosses} | ${wall.rallies.free}/${wall.rallies.paid} | ${wall.packOffer ? `day ${wall.packOffer.day} (${wall.packOffer.reason})` : 'none'} |`);
    }
  }
  lines.push('', '### Gem ledger per run (fights-first)', '',
    '| Strategy | Seed | Earned | Login calendar | Chests | Achievements | Wall takedowns | Other | Spent: Rally | Spent: refill | Spent: drydock skip | End gems | Rallies free/paid/declined | Useful sessions |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|');
  for (const run of runs) {
    const by = run.gems.earnedBySource;
    const login = by['calendar'] || 0, walls = by['wall:contract-claim'] || 0, achievements = by.achievement || 0;
    const chests = (by['chest:daily'] || 0) + (by['chest:weekly'] || 0);
    const r = run.metrics.rallies;
    lines.push(`| ${run.strategy} | ${run.seed} | ${run.gems.earned} | ${login} | ${chests} | ${achievements} | ${walls} | ${run.gems.earned - login - chests - achievements - walls} | ${run.gems.spentBySink.rally} | ${run.gems.spentBySink.fuel_refill} | ${run.gems.spentBySink.drydock_skip} | ${run.gems.end} | ${r.free}/${r.paid}/${r.declined} | ${run.metrics.usefulSessions} |`);
  }
  lines.push('', '### Phase 2 sources per run (fights-first)', '',
    'Credits from the login calendar, income while away, chests and achievements, and their share of all credits earned in 30 days; days the daily chest opened.', '',
    '| Strategy | Seed | Calendar | Idle | Chests | Achievements | Phase 2 share of credits | Daily chests | Free gems a day |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const run of runs) {
    const p2 = phase2Summary(run);
    lines.push(`| ${run.strategy} | ${run.seed} | ${p2.credits.calendar} | ${p2.credits.idle} | ${p2.credits.chests} | ${p2.credits.achievements} | ${Math.round(p2.share * 100)}% | ${p2.chestDays} | ${p2.gemsPerDay} |`);
  }
  if (away.length) {
    lines.push('', '### Session-order sensitivity: away team launched before the fights', '',
      'Same runs, but the away team leaves first (the baseline order), so the wall and the contract are fought without it. Medians across seeds; walls broken counts every wall.', '',
      '| Strategy | Order | First wall fell on day | First wall attempts | Walls broken | Near-miss losses (all walls) | Paid Rallies | Gems spent | Hull repair credits | Useful sessions |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const strategy of strategies) {
      for (const [order, set] of [['fights-first', runs], ['away-first', away]]) {
        const rs = set.filter(r => r.strategy === strategy);
        const m = f => medianOf(rs.map(f));
        lines.push(`| ${strategy} | ${order} | ${showDay(m(r => fellDay(r.metrics.wallFellOnDay)))} | ${m(r => r.metrics.wallAttempts)} | ${m(r => r.metrics.wallsBroken)} | ${m(r => Object.values(r.walls).reduce((s, w) => s + w.nearMissLosses, 0))} | ${m(r => r.metrics.rallies.paid)} | ${m(r => r.metrics.gemsSpent)} | ${m(r => r.metrics.hullRepairCredits)} | ${m(r => r.metrics.usefulSessions)} |`);
      }
    }
  }
  const lockout = run => run.days.filter(d => d.endHull <= HULL_CRITICAL && d.blockedActions.some(a => a.reason === 'reward_unavailable')).length;
  lines.push('', '### Script-3 baseline hull lockout (context for the section above)', '',
    'The historical script-3 runs never patch the hull. Once it reaches the critical floor every launch is refused, which the baseline records as reward_unavailable on contract-accept. Days ending in that state, per strategy (median / worst):', '',
    '| Strategy | Hull-locked days (median) | Worst seed | Worst value |', '|---|---:|---:|---:|');
  for (const strategy of strategies) {
    const rs = report.runs.filter(r => r.strategy === strategy);
    const worst = rs.reduce((a, b) => lockout(b) > lockout(a) ? b : a);
    lines.push(`| ${strategy} | ${medianOf(rs.map(lockout))} | ${worst.seed} | ${lockout(worst)} |`);
  }
  const all = [...runs, ...away];
  lines.push('', `Conservation: ${runs.filter(r => r.reconciliation.ok).length}/${runs.length} guided runs PASS (fights-first), ${away.filter(r => r.reconciliation.ok).length}/${away.length} PASS (away-first). Guided daily ledgers are in the same JSON under guided.runs; the away-first set keeps summaries only.`, '');
  if (all.some(r => !r.reconciliation.ok)) throw new Error('guided ledger failed conservation');
  return lines;
}

// ── Explore events (FTL-lite phase 3) ─────────────────────────────────────

/**
 * Scripted policies for travel events. They only use what the card shows: availability,
 * costs, the outcome odds and what each outcome pays.
 *   cautious  — fewest risky outcomes (hull, injury, fight), then best expected pay
 *   balanced  — best expected value (pay, minus costs and a price on hull, injury and fights)
 *   ambitious — highest ceiling (best single outcome), then best expected pay
 */
export const EXPLORE_POLICIES = ['cautious', 'balanced', 'ambitious'];
const EXPLORE_ROLL_SEEDS = 12;
const creditValue = r => (r.credits || 0) + 5 * (r.medals || 0) + 5 * (r.reputation || 0);

function outcomeValue(player, ev, outcome) {
  let value = 0;
  if (outcome.pay) value += creditValue(eventReward(player, ev, outcome.pay));
  if (outcome.story) value += creditValue(STORY_BEATS[ev.base.flag]?.rewards || {});
  if (outcome.hull) value -= 4 * outcome.hull;
  if (outcome.injure) value -= 40;
  if (outcome.fight) value -= 30;
  return value;
}

export function pickExploreChoice(player, ev, policy, now) {
  const template = TRAVEL_EVENT_BY_ID[ev.templateId];
  const scored = template.choices.filter(choice => choiceStatus(player, choice, now).available).map(choice => {
    const total = choice.outcomes.reduce((sum, outcome) => sum + outcome.w, 0);
    const cost = (choice.cost?.credits || 0) + 30 * (choice.cost?.fuel || 0);
    const values = choice.outcomes.map(outcome => outcomeValue(player, ev, outcome) - cost);
    return {
      choice,
      ev: choice.outcomes.reduce((sum, outcome, i) => sum + (outcome.w / total) * values[i], 0),
      risk: choice.outcomes.reduce((sum, outcome) => sum + (outcome.hull || outcome.injure || outcome.fight ? outcome.w / total : 0), 0),
      ceiling: Math.max(...values),
    };
  });
  const order = {
    cautious: (a, b) => a.risk - b.risk || b.ev - a.ev,
    balanced: (a, b) => b.ev - a.ev || a.risk - b.risk,
    ambitious: (a, b) => b.ceiling - a.ceiling || b.ev - a.ev,
  }[policy];
  return scored.sort((a, b) => order(a, b) || a.choice.id.localeCompare(b.choice.id))[0]?.choice || null;
}

/** A settled post-tutorial captain at Spur Anchor: the starter crew aboard, fuel and credits to spare. */
function exploreAuditCaptain(startAt) {
  const base = createNewPlayer({ tutorialScript: 4, now: startAt, rng: createSeededRng(7) });
  // A captain who has broken every Siege wall, so every beacon (gates included) can be audited.
  return { ...base, tutorial: { ...base.tutorial, completed: true, phase: 'done' }, location: 'station_home',
    flags: { ...(base.flags || {}), wall_spur: true, wall_veil: true, wall_ember: true, wall_hollow: true, wall_crown: true },
    wallet: { ...base.wallet, fuel: 10, credits: 1000 }, crew: base.crew.map(member => ({ ...member, status: 'ready', injuredUntil: 0 })) };
}

/**
 * Resolve every travel event at every beacon and non-combat outcome it fits, through the real
 * resolver, under each scripted policy and a fixed set of roll seeds. Compares what the event
 * pays with what the same arrival paid instantly before events (the base at pay 1).
 */
export function auditExploreEvents({ startAt = ECONOMY_START } = {}) {
  const captain = exploreAuditCaptain(startAt);
  const rows = [];
  const breaches = [];
  for (const node of Object.values(NODES)) {
    const seen = new Set();
    for (const outcome of node.outcomes || []) {
      if (!EVENT_KINDS.includes(outcome.kind)) continue;
      const key = JSON.stringify({ ...outcome, w: 0 });
      if (seen.has(key)) continue;
      seen.add(key);
      const base = { kind: outcome.kind };
      for (const currency of ['credits', 'medals', 'reputation']) if (Number.isFinite(outcome[currency])) base[currency] = outcome[currency];
      if (outcome.kind === 'story') base.flag = outcome.flag;
      for (const template of eventCandidates(node, base)) {
        const probe = { nodeId: node.id, base };
        const instant = outcome.kind === 'story' ? { credits: 0, medals: 0, reputation: 0, ...STORY_BEATS[outcome.flag]?.rewards }
          : eventReward(captain, probe, 1);
        for (const policy of EXPLORE_POLICIES) {
          const row = { node: node.id, sector: node.sector, kind: outcome.kind, template: template.id, policy, choice: null, rolls: 0,
            instant: { credits: instant.credits || 0, medals: instant.medals || 0, reputation: instant.reputation || 0 },
            paid: { credits: 0, medals: 0, reputation: 0 }, spent: { credits: 0, fuel: 0 }, fights: 0, injuries: 0, hullLoss: 0, hires: 0 };
          for (let roll = 1; roll <= EXPLORE_ROLL_SEEDS; roll++) {
            const seed = (roll * 2654435761) % 2147483647;
            const ev = { version: EVENT_VERSION, eventId: `event:${node.id}:${roll}:${seed}`, templateId: template.id, nodeId: node.id,
              fromNodeId: 'station_home', base, seed, fuelSpent: 0, openedAt: startAt };
            const player = { ...captain, activeEvent: ev };
            const choice = pickExploreChoice(player, ev, policy, startAt);
            if (!choice) continue;
            row.choice = choice.id;
            const res = resolveTravelEvent(player, { eventId: ev.eventId, choice: choice.id }, startAt);
            if (!res.ok) throw new Error(`explore audit: ${node.id}/${template.id}/${choice.id}: ${res.reason}`);
            row.rolls += 1;
            const gross = res.result.rewards || {};
            for (const currency of ['credits', 'medals', 'reputation']) {
              row.paid[currency] += gross[currency] || 0;
              // No single event result may pay more than the same arrival paid before events.
              if ((gross[currency] || 0) > (row.instant[currency] || 0)) breaches.push({ node: node.id, template: template.id, choice: choice.id, currency, paid: gross[currency], instant: row.instant[currency] });
            }
            row.spent.credits += choice.cost?.credits || 0;
            row.spent.fuel += choice.cost?.fuel || 0;
            if (res.result.fight) row.fights += 1;
            if (res.result.injured) row.injuries += 1;
            if (res.result.hired) row.hires += 1;
            row.hullLoss += res.result.hullLoss || 0;
          }
          rows.push(row);
        }
      }
    }
  }
  const summarize = list => {
    const sum = (fn) => list.reduce((total, row) => total + fn(row), 0);
    const rolls = sum(row => row.rolls) || 1;
    const instantCredits = sum(row => row.instant.credits * row.rolls) || 1;
    const instantMedals = sum(row => row.instant.medals * row.rolls) || 1;
    return {
      events: list.length,
      creditRatio: Math.round(((sum(row => row.paid.credits - row.spent.credits)) / instantCredits) * 100) / 100,
      medalRatio: Math.round((sum(row => row.paid.medals) / instantMedals) * 100) / 100,
      fightPct: Math.round((sum(row => row.fights) / rolls) * 100),
      injuryPct: Math.round((sum(row => row.injuries) / rolls) * 100),
      hullPerEvent: Math.round((sum(row => row.hullLoss) / rolls) * 10) / 10,
      fuelPerEvent: Math.round((sum(row => row.spent.fuel) / rolls) * 100) / 100,
      hires: sum(row => row.hires),
    };
  };
  const byPolicy = Object.fromEntries(EXPLORE_POLICIES.map(policy => [policy, summarize(rows.filter(row => row.policy === policy))]));
  const sectors = [...new Set(rows.map(row => row.sector))];
  const bySector = Object.fromEntries(EXPLORE_POLICIES.map(policy => [policy,
    Object.fromEntries(sectors.map(sector => [sector, summarize(rows.filter(row => row.policy === policy && row.sector === sector))]))]));
  return { rollSeeds: EXPLORE_ROLL_SEEDS, crewRoles: captain.crew.map(member => member.role), combos: rows.length / EXPLORE_POLICIES.length,
    templates: new Set(rows.map(row => row.template)).size, byPolicy, bySector, breaches, rows };
}

function renderExploreMarkdown(explore) {
  const lines = ['## Explore events (FTL-lite phase 3)', '',
    `Added 2026-10-04. Explore arrivals that used to pay instantly (trade, delivery, salvage, story) now open authored events. This audit resolves every event at every beacon and non-combat outcome it fits (${explore.combos} combinations, ${explore.templates} events) through the production resolver, ${explore.rollSeeds} roll seeds each, for a settled captain at Spur Anchor with the starter crew aboard (roles: ${explore.crewRoles.join(', ')}). Role choices for roles outside that crew are unavailable, as they would be in play. Since 2026-10-05 the guided 30-day runs above also jump on the map with these same policies (see Explore per run); their contract route choices go through the route-event cards with the strategy's existing route policy.`, '',
    'Policies use only what the card shows. cautious: fewest risky outcomes, then best expected pay. balanced: best expected value (pay minus costs, 4 credits per hull point, 40 per injury, 30 per fight). ambitious: highest single-outcome ceiling. Credit ratio is credits paid minus credit costs, divided by what the same arrivals paid instantly before events (1.00 = unchanged). Fights opened by events pay the beacon\'s normal fight prize on top (not counted here).', '',
    '| Policy | Credit ratio | Medal ratio | Fight % | Injury % | Hull / event | Fuel / event | Hires |', '|---|---:|---:|---:|---:|---:|---:|---:|'];
  for (const [policy, s] of Object.entries(explore.byPolicy)) {
    lines.push(`| ${policy} | ${s.creditRatio.toFixed(2)} | ${s.medalRatio.toFixed(2)} | ${s.fightPct} | ${s.injuryPct} | ${s.hullPerEvent} | ${s.fuelPerEvent} | ${s.hires} |`);
  }
  lines.push('', '| Policy | Sector | Combinations | Credit ratio | Fight % | Injury % | Hull / event |', '|---|---|---:|---:|---:|---:|---:|');
  for (const [policy, sectors] of Object.entries(explore.bySector)) {
    for (const [sector, s] of Object.entries(sectors)) lines.push(`| ${policy} | ${sector} | ${s.events} | ${s.creditRatio.toFixed(2)} | ${s.fightPct} | ${s.injuryPct} | ${s.hullPerEvent} |`);
  }
  lines.push('', `Ceiling check: ${explore.breaches.length ? `${explore.breaches.length} results pay above the instant value (FAIL)` : 'no event result pays more credits, medals or reputation than the same arrival paid instantly (PASS)'}.`, '');
  return lines;
}
