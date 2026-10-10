// @ts-nocheck
/**
 * Contract twists (Phase 3 world design §3): one rule that changes the fight and the pay. The contract carries
 * `twist = { id, elite? }`; the fight engine (src/systems/ftlCombat.js) runs the rule and reports
 * `{ id, met }`; contractRewards.js pays it. Twists never apply to Siege-wall fights or the guided first fight.
 */
import { ELITE_MODIFIERS, validElite } from './factions.js';

/** Rule numbers the fight reads. */
export const TWIST_RULES = Object.freeze({
  escort: Object.freeze({ hull: 30, aimPct: 35 }),
  rush: Object.freeze({ beats: 30 }),
  holdout: Object.freeze({ beats: 35, damageMult: 1.2 }),
  waves: Object.freeze({ hullPct: 60 }),
});

/**
 * pay: credits multiplier when the rule is met (on a won fight), `missed` when it is not; bounty also pays
 * half again in medals. A lost fight pays the usual salvage, whatever the twist.
 */
export const TWISTS = Object.freeze({
  escort: Object.freeze({ id: 'escort', label: 'Escort', rule: 'A freighter flies beside you. Keep it alive.',
    pay: Object.freeze({ met: 1.25, missed: 0.7 }) }),
  rush: Object.freeze({ id: 'rush', label: 'Rush', rule: 'Win within 30 seconds for a bonus.',
    pay: Object.freeze({ met: 1.35, missed: 1 }) }),
  bounty: Object.freeze({ id: 'bounty', label: 'Bounty', rule: 'The enemy is a named elite with a nasty trick.',
    pay: Object.freeze({ met: 1.4, missed: 1, medals: 1.5 }) }),
  holdout: Object.freeze({ id: 'holdout', label: 'Holdout', rule: 'Survive 35 seconds or wreck them. They hit harder.',
    pay: Object.freeze({ met: 1.15, missed: 1 }) }),
  waves: Object.freeze({ id: 'waves', label: 'Two waves', rule: 'When the first ship falls, a second one arrives.',
    pay: Object.freeze({ met: 1.4, missed: 1 }) }),
});

export const TWIST_IDS = Object.freeze(Object.keys(TWISTS));

const rec = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** A well-formed twist: a known id; a bounty carries a valid elite and nothing else does. */
export function validTwist(twist) {
  if (!rec(twist) || !Object.hasOwn(TWISTS, twist.id)) return false;
  if (twist.id === 'bounty') return Object.keys(twist).length === 2 && validElite(twist.elite);
  return Object.keys(twist).length === 1;
}

/** Just the contract-side fields, copied: { id } or { id, elite: { name, modifier } }. Null when not valid. */
export function cleanTwist(twist) {
  if (!validTwist(twist)) return null;
  return twist.id === 'bounty' ? { id: 'bounty', elite: { name: twist.elite.name, modifier: twist.elite.modifier } } : { id: twist.id };
}

const times = mult => `×${mult}`;

/** What the contract card shows: { id, label, rule, payLine }. Null when the twist is not valid. */
export function describeTwist(twist) {
  if (!validTwist(twist)) return null;
  const def = TWISTS[twist.id];
  const rule = twist.id === 'bounty'
    ? `${twist.elite.name}, ${ELITE_MODIFIERS[twist.elite.modifier].label.toLowerCase()}: ${ELITE_MODIFIERS[twist.elite.modifier].rule.toLowerCase().replace(/\.$/, '')}.`
    : def.rule;
  const payLine = {
    escort: `Pay ${times(def.pay.met)} if it survives, ${times(def.pay.missed)} if not`,
    rush: `Pay ${times(def.pay.met)} if you win in time`,
    bounty: `Pay ${times(def.pay.met)}, medals ${times(def.pay.medals)}`,
    holdout: `Pay ${times(def.pay.met)} on a win`,
    waves: `Pay ${times(def.pay.met)} on a win`,
  }[twist.id];
  return { id: twist.id, label: def.label, rule, payLine };
}

/**
 * Twist pay on a fight's rewards. `outcome` is the fight's `{ id, met }`; `won` says whether the fight was won.
 * Credits take the twist's multiplier (met or missed), bounty medals take theirs; a lost fight is unchanged.
 */
export function applyTwistPay(rewards, outcome, won) {
  const def = TWISTS[outcome?.id];
  if (!def || !won) return rewards;
  const mult = outcome.met ? def.pay.met : def.pay.missed;
  return {
    ...rewards,
    credits: Math.round((rewards.credits || 0) * mult),
    ...(outcome.met && def.pay.medals ? { medals: Math.round((rewards.medals || 0) * def.pay.medals) } : {}),
  };
}

/** One line for the debrief: how the twist went. Null for a lost fight (it pays the usual salvage). */
export function twistOutcomeLine(twist, outcome) {
  if (!validTwist(twist) || outcome?.id !== twist.id || typeof outcome.met !== 'boolean') return null;
  const lines = {
    escort: outcome.met ? 'The freighter made it, and so did its paperwork.' : 'The freighter did not make it. The pay remembers.',
    rush: outcome.met ? 'Done inside the clock.' : 'Done, but too slow for the bonus.',
    bounty: `${twist.elite?.name || 'The elite'} is out of the bounty business.`,
    holdout: 'You held out. They will write about it, briefly.',
    waves: 'Both waves are down.',
  };
  return outcome.met || twist.id === 'escort' || twist.id === 'rush' ? lines[twist.id] : null;
}
