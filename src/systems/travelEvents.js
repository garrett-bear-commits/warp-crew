// @ts-nocheck
/**
 * Travel and route events (FTL-lite phase 3).
 *
 * A non-combat jump arrival opens `player.activeEvent`: a saved, validated card with its own
 * identity and seed. Jump fuel is paid when it opens; location, visits and jump count wait for
 * the choice, the same way a travel fight waits for its claim. Resolving a choice pays (or
 * opens a fight) and clears the event in one state change, so it can only pay once. The roll
 * is a hash of the event seed and the choice, so reloading never re-rolls a choice.
 */
import { NODES, STORY_BEATS, gateBlockedByWall } from '../data/sectors.js';
import { TRAVEL_EVENTS, TRAVEL_EVENT_BY_ID, ROUTE_EVENTS, ROUTE_EVENT_BY_ID } from '../data/events.js';
import { catalogById, createCrewInstance } from '../data/crewRoster.js';
import { SECTOR_MAPS } from '../data/sectorMaps.js';
import { spendFuel } from './fuel.js';
import { grant, scaleSitePayout, formatReward } from './economy.js';
import { tradePayout, injuryMinutesFor } from './passives.js';
import { applyStoryFlag } from './story.js';
import { applyCrewInjury, fightingCrew, readyCrew } from './player.js';
import { encounterById, ENCOUNTERS_V1 } from './combat.js';
import { contractThreat, threatLabel } from './encounterState.js';
import { beginTravelFight } from './travelFight.js';

export const EVENT_VERSION = 1;
export const EVENT_KINDS = ['trade', 'delivery', 'salvage', 'story'];
const CURRENCY_KEYS = ['credits', 'medals', 'reputation'];
const SECTOR_FIGHT = { spur: 'pirate_scout', veil: 'swarm_probe', ember: 'ember_raider', hollow: 'hollow_shade', crown: 'crown_warden' };
const ROLE_LABEL = { pilot: 'Pilot', gunner: 'Gunner', scout: 'Scout', engineer: 'Engineer', medic: 'Medic', security: 'Security', trader: 'Trader' };
const CAPTAIN_LABEL = { captain_cyborg: 'Cyborg captain', captain_gunner: 'Gunner captain', captain_alien: 'Alien captain', captain_droid: 'Droid captain' };
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}
const unit = (seed, salt) => hashSeed(`${seed}:${salt}`) / 4294967296;

/** The outcome fields that define a base (weight excluded). */
function baseOf(outcome) {
  const base = { kind: outcome.kind };
  for (const key of CURRENCY_KEYS) if (Number.isFinite(outcome[key])) base[key] = outcome[key];
  if (outcome.kind === 'story') base.flag = outcome.flag;
  return base;
}
const sameBase = (a, b) => JSON.stringify(baseOf(a)) === JSON.stringify(baseOf(b));

export function templateFits(template, node, base) {
  if (!template || !node || !base || !template.kinds.includes(base.kind)) return false;
  if (template.sectors && !template.sectors.includes(node.sector)) return false;
  if (template.nodes && !template.nodes.includes(node.id)) return false;
  if (template.notNodes && template.notNodes.includes(node.id)) return false;
  return true;
}

export function eventCandidates(node, base) {
  return TRAVEL_EVENTS.filter(template => templateFits(template, node, base));
}

/** Whether this arrival becomes an event (story beats already logged keep the old consolation). */
export function arrivalOpensEvent(player, node, outcome) {
  if (!node || !outcome || !EVENT_KINDS.includes(outcome.kind)) return false;
  if (outcome.kind === 'story' && (!STORY_BEATS[outcome.flag] || player.flags?.[outcome.flag])) return false;
  return eventCandidates(node, outcome).length > 0;
}

/** Weakest fight the beacon already offers, or the sector's default. */
export function eventEncounterFor(node) {
  const fights = (node?.outcomes || []).filter(outcome => outcome.kind === 'combat')
    .sort((a, b) => encounterById(a.encounter).power - encounterById(b.encounter).power || a.encounter.localeCompare(b.encounter));
  return fights[0]?.encounter || SECTOR_FIGHT[node?.sector] || 'pirate_scout';
}

/** Spend the jump fuel and open the event card. */
export function openTravelEvent(player, preview, now = Date.now()) {
  if (!preview?.ok || !preview.node || !arrivalOpensEvent(player, preview.node, preview.outcome)) return { ok: false, reason: 'bad_preview', player };
  if (player.activeContract) return { ok: false, reason: 'active_contract', player };
  if (player.activeTravelFight || player.activeEncounter) return { ok: false, reason: 'combat_pending', player };
  if (player.activeEvent) return { ok: false, reason: 'event_active', player };
  const fuelSpent = preview.fuelCost ?? 0;
  const spent = spendFuel(player, fuelSpent);
  if (!spent.ok) return { ok: false, reason: 'not_enough_fuel', player };
  const paid = spent.player;
  const node = preview.node;
  const base = baseOf(preview.outcome);
  const jump = (paid.stats?.jumps || 0) + 1;
  const seed = hashSeed(`${paid.createdAt || 0}:${jump}:${node.id}:${base.kind}:event`) % 2147483647;
  const candidates = eventCandidates(node, base).sort((a, b) => a.id.localeCompare(b.id));
  const recent = Array.isArray(paid.stats?.recentEvents) ? paid.stats.recentEvents : [];
  const start = Math.floor(unit(seed, 'template') * candidates.length);
  const rotated = candidates.map((_, i) => candidates[(start + i) % candidates.length]);
  const template = rotated.find(candidate => !recent.includes(candidate.id)) || rotated[0];
  const activeEvent = {
    version: EVENT_VERSION,
    eventId: `event:${node.id}:${jump}:${seed}`,
    templateId: template.id,
    nodeId: node.id,
    fromNodeId: String(paid.location || 'station_home'),
    base,
    seed,
    fuelSpent,
    openedAt: now,
  };
  return {
    ok: true,
    player: { ...paid, activeEvent, stats: { ...paid.stats, recentEvents: [template.id, ...recent.filter(id => id !== template.id)].slice(0, 4) } },
    analytics: { event: 'travel_event_opened', node: node.id, template: template.id, kind: base.kind, fuel: fuelSpent },
  };
}

/** Identity, catalog fit and one-thing-at-a-time. False for any tampered or torn state. */
export function validTravelEvent(player) {
  const ev = player?.activeEvent;
  if (!record(ev) || ev.version !== EVENT_VERSION || typeof ev.eventId !== 'string' || !ev.eventId.startsWith(`event:${ev.nodeId}:`)) return false;
  const node = NODES[ev.nodeId];
  const template = TRAVEL_EVENT_BY_ID[ev.templateId];
  if (!node || !template || !record(ev.base) || !EVENT_KINDS.includes(ev.base.kind)) return false;
  // A gate behind an unbroken Siege wall can never be an event's destination.
  if (gateBlockedByWall(player, ev.nodeId)) return false;
  if (!(node.outcomes || []).some(outcome => outcome.kind === ev.base.kind && sameBase(outcome, ev.base))) return false;
  if (!templateFits(template, node, ev.base)) return false;
  if (!Number.isInteger(ev.seed) || ev.seed < 0 || !ev.eventId.endsWith(`:${ev.seed}`)) return false;
  if (!Number.isFinite(ev.fuelSpent) || ev.fuelSpent < 0 || typeof ev.fromNodeId !== 'string') return false;
  if (player.activeContract || player.activeTravelFight || player.activeEncounter) return false;
  return true;
}

/** Load-time guard: drop a torn or tampered event without paying anything. */
export function normalizeEventState(player) {
  if (player?.activeEvent == null) return player;
  if (validTravelEvent(player)) return player;
  const reason = player.activeContract ? 'contract_active' : player.activeTravelFight || player.activeEncounter ? 'fight_active' : 'invalid_event_state';
  return { ...player, activeEvent: null,
    recoveryEvents: [...(player.recoveryEvents || []), { event: 'travel_event_recovered', reason }] };
}

function doerFor(player, need, now) {
  if (!need) return { ok: true, member: null };
  if (need.captain) {
    const captain = (player.crew || []).find(member => member.instanceId === player.captainInstanceId || member.isCaptain);
    if (!captain || captain.templateId !== need.captain) return { ok: false, reason: `Needs a ${(CAPTAIN_LABEL[need.captain] || 'different captain').toLowerCase()}` };
    const ready = readyCrew(player, now).some(member => member.instanceId === captain.instanceId);
    return ready ? { ok: true, member: captain } : { ok: false, reason: `${captain.name} is ${captain.status === 'expedition' ? 'away' : 'injured'}` };
  }
  const role = need.role;
  const ready = readyCrew(player, now).filter(member => member.role === role)
    .sort((a, b) => (b.power || 0) - (a.power || 0));
  if (ready.length) return { ok: true, member: ready[0] };
  const anyone = (player.crew || []).find(member => member.role === role);
  if (anyone) return { ok: false, reason: `${anyone.name} is ${anyone.status === 'expedition' ? 'away' : 'injured'}` };
  return { ok: false, reason: `No ${ROLE_LABEL[role] || role} aboard` };
}

/** Whether a choice can be taken now, who does it, and why not. */
export function choiceStatus(player, choice, now = Date.now()) {
  const doer = doerFor(player, choice.need, now);
  if (!doer.ok) return { available: false, reason: doer.reason, doer: null };
  const fuel = choice.cost?.fuel || 0;
  const credits = choice.cost?.credits || 0;
  if ((player.wallet?.fuel ?? 0) < fuel) return { available: false, reason: `Needs ${fuel} fuel`, doer: doer.member };
  if ((player.wallet?.credits ?? 0) < credits) return { available: false, reason: `Needs ${credits} credits`, doer: doer.member };
  const hire = choice.outcomes.find(outcome => outcome.hire)?.hire;
  if (hire) {
    const template = catalogById(hire);
    if ([...(player.crew || []), ...(player.reserve || [])].some(member => member.templateId === hire)) return { available: false, reason: `${template?.name || 'They'} already crews for you`, doer: doer.member };
    if ((player.crew || []).length >= (player.crewSlots || 2)) return { available: false, reason: 'No free berth', doer: doer.member };
  }
  return { available: true, reason: null, doer: doer.member };
}

/** What `pay` of this event's base is worth to this captain right now. */
export function eventReward(player, ev, pay) {
  const fraction = Math.max(0, Math.min(1, pay || 0));
  if (!fraction) return { credits: 0, medals: 0, reputation: 0 };
  const visits = player.stats?.visits?.[ev.nodeId] || 0;
  if (ev.base.kind === 'story') {
    const beat = STORY_BEATS[ev.base.flag];
    return Object.fromEntries(CURRENCY_KEYS.map(key => [key, Math.floor((beat?.rewards?.[key] || 0) * fraction)]));
  }
  const raw = Object.fromEntries(CURRENCY_KEYS.map(key => [key, Math.floor((ev.base[key] || 0) * fraction)]));
  let reward = scaleSitePayout(raw, player, { kind: ev.base.kind, visits });
  if (ev.base.kind === 'trade' || ev.base.kind === 'delivery') reward = { ...reward, credits: tradePayout(reward.credits, fightingCrew(player)) };
  return Object.fromEntries(CURRENCY_KEYS.map(key => [key, reward[key] || 0]));
}

/** Plain-language stakes for one outcome, with the real numbers it would pay now. */
export function outcomeSummary(player, ev, outcome, now = Date.now()) {
  const bits = [];
  if (outcome.story) {
    const beat = STORY_BEATS[ev.base.flag];
    bits.push(`Story: ${beat?.title || 'a lead'}${beat?.rewards ? ` · ${formatReward(beat.rewards)}` : ''}`);
  }
  if (outcome.pay) {
    const label = formatReward(eventReward(player, ev, outcome.pay));
    bits.push(label || 'Nothing paid');
  }
  if (outcome.hire) bits.push(`${catalogById(outcome.hire)?.name || 'A merc'} joins`);
  if (outcome.hull) bits.push(`−${outcome.hull} hull`);
  if (outcome.injure) bits.push('one crew injured');
  if (outcome.fight) {
    const encounterId = eventEncounterFor(NODES[ev.nodeId]);
    const crewAboard = readyCrew(player, now).length;
    bits.push(`Fight: ${encounterById(encounterId).name} · ${crewAboard ? threatLabel(contractThreat(player, { encounterId }, now)) : 'Deadly'}`);
  }
  if (!bits.length) bits.push('Nothing paid');
  return bits.join(' · ');
}

function crewText(text, member) {
  return String(text || '').replaceAll('{crew}', member?.name || 'Your crew');
}

/** Card model for the open event. */
export function eventView(player, now = Date.now()) {
  if (!validTravelEvent(player)) return null;
  const ev = player.activeEvent;
  const template = TRAVEL_EVENT_BY_ID[ev.templateId];
  const node = NODES[ev.nodeId];
  return {
    eventId: ev.eventId,
    title: template.title,
    text: template.text,
    nodeName: node.name,
    sectorName: SECTOR_MAPS[node.sector]?.name || node.sector,
    kind: ev.base.kind,
    choices: template.choices.map(choice => {
      const status = choiceStatus(player, choice, now);
      const total = choice.outcomes.reduce((sum, outcome) => sum + outcome.w, 0);
      const tag = choice.need?.role ? ROLE_LABEL[choice.need.role] : choice.need?.captain ? CAPTAIN_LABEL[choice.need.captain] : null;
      return {
        id: choice.id,
        label: choice.label,
        tag,
        doer: status.doer?.name || null,
        available: status.available,
        reason: status.reason,
        cost: choice.cost?.fuel ? `${choice.cost.fuel} fuel` : choice.cost?.credits ? `${choice.cost.credits} credits` : null,
        odds: choice.outcomes.map(outcome => ({
          pct: Math.round((outcome.w / total) * 100),
          summary: outcomeSummary(player, ev, outcome, now),
          risky: Boolean(outcome.hull || outcome.injure || outcome.fight),
        })),
      };
    }),
  };
}

/** Roll for a choice: the same choice on the same event always lands the same way. */
export function rollOutcome(ev, choice) {
  const total = choice.outcomes.reduce((sum, outcome) => sum + outcome.w, 0);
  let r = unit(ev.seed, `choice:${choice.id}`) * total;
  for (const outcome of choice.outcomes) {
    r -= outcome.w;
    if (r < 0) return outcome;
  }
  return choice.outcomes[choice.outcomes.length - 1];
}

/** Resolve the open event with one choice. Pays once and clears the event, or opens a fight. */
export function resolveTravelEvent(player, { eventId, choice: choiceId } = {}, now = Date.now()) {
  const ev = player?.activeEvent;
  if (!ev) return { ok: false, reason: 'no_active_event', player };
  if (!validTravelEvent(player)) return { ok: false, reason: 'invalid_event_state', player };
  if (ev.eventId !== eventId) return { ok: false, reason: 'stale_event', player };
  const template = TRAVEL_EVENT_BY_ID[ev.templateId];
  const choice = template.choices.find(entry => entry.id === choiceId);
  if (!choice) return { ok: false, reason: 'unknown_choice', player };
  const status = choiceStatus(player, choice, now);
  if (!status.available) return { ok: false, reason: 'choice_unavailable', player };
  const outcome = rollOutcome(ev, choice);
  const node = NODES[ev.nodeId];

  let next = { ...player, activeEvent: null };
  if (choice.cost?.fuel) {
    const spent = spendFuel(next, choice.cost.fuel);
    if (!spent.ok) return { ok: false, reason: 'not_enough_fuel', player };
    next = spent.player;
  }
  if (choice.cost?.credits) next = { ...next, wallet: { ...next.wallet, credits: (next.wallet.credits || 0) - choice.cost.credits } };

  const result = { kind: ev.base.kind, node, event: { id: template.id, title: template.title, choice: choice.id, choiceLabel: choice.label },
    flavor: crewText(outcome.text, status.doer), rewards: null, hullLoss: 0, injured: null, hired: null, beat: null, flag: null, fight: false };

  // Arrival waits for the fight claim when the event turns into a fight.
  if (!outcome.fight) {
    const visits = { ...(next.stats?.visits || {}) };
    visits[ev.nodeId] = (visits[ev.nodeId] || 0) + 1;
    next = { ...next, location: ev.nodeId, stats: { ...next.stats, visits, jumps: (next.stats?.jumps || 0) + 1 } };
  }
  // Payouts read the visit count from before this arrival, as instant arrivals did.
  const before = { ...next, stats: player.stats };
  let rewards = { credits: 0, medals: 0, reputation: 0 };
  if (outcome.pay) {
    const reward = eventReward(before, ev, outcome.pay);
    next = { ...next, wallet: grant(next.wallet, reward) };
    rewards = reward;
  }
  if (outcome.story) {
    const applied = applyStoryFlag(next, ev.base.flag);
    if (applied.already) {
      const consolation = scaleSitePayout({ credits: 18, medals: 1, reputation: 0 }, before, { kind: 'salvage', visits: player.stats?.visits?.[ev.nodeId] || 0 });
      next = { ...next, wallet: grant(next.wallet, consolation) };
      rewards = { credits: rewards.credits + (consolation.credits || 0), medals: rewards.medals + (consolation.medals || 0), reputation: rewards.reputation };
    } else {
      next = applied.player;
      result.beat = applied.beat;
      result.flag = ev.base.flag;
      for (const key of [...CURRENCY_KEYS, 'gems']) if (applied.rewards?.[key]) rewards[key] = (rewards[key] || 0) + applied.rewards[key];
    }
  }
  if (outcome.hull) {
    const hull = next.ship?.hull ?? 100;
    const after = Math.max(1, hull - outcome.hull);
    result.hullLoss = hull - after;
    next = { ...next, ship: { ...next.ship, hull: after, hullRepairAt: now } };
  }
  if (outcome.injure) {
    const squad = fightingCrew(next, now);
    if (squad.length) {
      const pick = squad[Math.floor(unit(ev.seed, `injure:${choice.id}`) * squad.length)];
      next = applyCrewInjury(next, [pick.instanceId], injuryMinutesFor(next, 20), now);
      result.injured = pick.name;
    }
  }
  if (outcome.hire) {
    const instance = createCrewInstance(outcome.hire, { rng: () => unit(ev.seed, `hire:${choice.id}`) });
    next = { ...next, crew: [...next.crew, instance] };
    result.hired = { instanceId: instance.instanceId, name: instance.name };
  }
  result.rewards = Object.values(rewards).some(Boolean) ? rewards : null;

  const analytics = { event: 'travel_event_resolved', node: ev.nodeId, template: template.id, choice: choice.id,
    fight: Boolean(outcome.fight), hullLoss: result.hullLoss, injured: Boolean(result.injured), hired: result.hired?.name || null,
    ...(result.rewards || {}) };
  if (outcome.fight) {
    const encounterId = eventEncounterFor(node);
    if (!ENCOUNTERS_V1.some(entry => entry.id === encounterId)) return { ok: false, reason: 'unknown_encounter', player };
    const begun = beginTravelFight(next, { ok: true, node, fuelCost: 0, outcome: { kind: 'combat', encounter: encounterId } }, now);
    if (!begun.ok) return { ok: false, reason: begun.reason, player };
    result.fight = true;
    result.encounter = encounterId;
    return { ok: true, player: begun.player, result, analytics, fightAnalytics: begun.analytics };
  }
  return { ok: true, player: next, result, analytics };
}

// ── Contract route events ────────────────────────────────────────────────

/** The route event a contract shows at its choice stage: fixed by the contract's route seed. */
export function routeEventFor(contract) {
  if (!contract || contract.profile === 'distress') return null;
  const fits = ROUTE_EVENTS.filter(event => event.profiles.includes(contract.profile));
  if (!fits.length) return null;
  return fits[Math.floor(unit(contract.routeSeed, `${contract.acceptanceId}:route-event`) * fits.length)];
}

/** Check a route-event choice id against the contract and the action it claims to be. */
export function routeChoiceMatches(contract, choiceId, actionId) {
  const event = routeEventFor(contract);
  const choice = event?.choices.find(entry => entry.id === choiceId);
  return Boolean(choice && choice.route === actionId);
}

export { ROUTE_EVENT_BY_ID };
