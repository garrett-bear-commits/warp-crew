// Pre-fight win odds from the fight itself (crew-matter design §4, balance pass 2026-10-09).
//
// A contract card plays the fight it can lead to a few times, with the crew and ship exactly as they are
// now: the same fight setup a launch uses (contractFightArgs + startCrewFight), the same engine
// (applyFtlCommand + advanceFtlEncounter), the scripted 'smart' captain and Auto on. The seeds are fixed per
// offer, so the odds are deterministic, and results are cached by the fight setup, so a render that changes
// nothing replays nothing. A downed crew concedes (the odds never assume a Rally).
import { trustedNow } from '../shared/time.js';
import { contractFightArgs, startCrewFight, threatLabel } from './encounterState.js';
import { readyContractCrew } from './contractRewards.js';
import { encounterById } from './combat.js';
import { advanceFtlEncounter, applyFtlCommand, ftlPolicyStep, MAX_FIGHT_BEATS } from './ftlCombat.js';

export const ODDS_SEEDS = 8;
const CACHE_MAX = 64;
const cache = new Map();

function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0) % 2147483647;
}

/** The fixed seeds an offer's odds are played with. */
export const oddsSeeds = offerId => Array.from({ length: ODDS_SEEDS }, (_, i) => hashSeed(`${offerId}:odds:${i}`));

/** The toughest fight an offer can lead to (any route), as a contract the fight setup reads. */
export function offerFightContract(offer) {
  const content = offer?.routeContent || {};
  const ids = [...new Set([content.secureOutcome?.kind === 'combat' ? content.secureOutcome.encounter : null,
    content.routeOutcome?.kind === 'combat' ? content.routeOutcome.encounter : null, content.encounterId].filter(Boolean))];
  if (!ids.length) return null;
  // Threat follows the encounter's power, so the strongest encounter is the toughest fight.
  const encounterId = ids.sort((a, b) => encounterById(b).power - encounterById(a).power || a.localeCompare(b))[0];
  return { encounterId, profile: offer.profile, destinationId: offer.destinationId, ...(offer.wall ? { wall: { id: offer.wall.id } } : {}) };
}

/** One scripted fight to its end (smart captain, Auto on, a downed crew concedes): true for a win. */
export function playOddsFight(player, args, seed, now = trustedNow()) {
  let state = startCrewFight(player, { acceptanceId: 'odds', seed, ...args }, now);
  state = applyFtlCommand(state, { type: 'auto', auto: true }).state || state;
  for (let beat = 0; beat < MAX_FIGHT_BEATS && state.result === null; beat += 1) {
    if (state.phase === 'downed') return false;
    for (const command of ftlPolicyStep(state, 'smart').commands) {
      const applied = applyFtlCommand(state, command);
      if (applied.ok) state = applied.state;
    }
    const advanced = advanceFtlEncounter(state, null);
    if (advanced.ok === false) return false;
    state = advanced.state;
  }
  return state.result === 'win';
}

/**
 * Win odds for the offer's toughest fight with the crew aboard now, or null when it cannot fight.
 * { encounterId, threat, label, wins, fights, winPct, text }
 */
export function fightOdds(player, offer, now = trustedNow()) {
  const contract = offerFightContract(offer);
  if (!contract || !readyContractCrew(player, now).length) return null;
  const args = contractFightArgs(player, contract, now);
  // The probe fight is the signature: crew, stations, levels, kits, ship systems, guns and hull as the fight sees them.
  const probe = startCrewFight(player, { acceptanceId: 'odds', seed: 0, ...args }, now);
  const key = `${offer.id}|${JSON.stringify(probe)}`;
  if (cache.has(key)) return cache.get(key);
  let wins = 0;
  for (const seed of oddsSeeds(offer.id)) if (playOddsFight(player, args, seed, now)) wins += 1;
  const winPct = Math.round((wins / ODDS_SEEDS) * 100);
  const result = { encounterId: contract.encounterId, threat: args.threat, label: threatLabel(args.threat), wins, fights: ODDS_SEEDS, winPct, text: oddsText(wins) };
  cache.set(key, result);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return result;
}

/** Plain words for the card: "Win odds about 70%", never a false certainty from eight fights. */
export function oddsText(wins, fights = ODDS_SEEDS) {
  if (wins >= fights) return 'Win odds over 90%';
  if (wins <= 0) return 'Win odds under 10%';
  return `Win odds about ${Math.round((wins / fights) * 10) * 10}%`;
}

/** Test seam: forget cached odds. */
export function clearFightOdds() {
  cache.clear();
}
