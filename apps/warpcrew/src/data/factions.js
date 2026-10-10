// @ts-nocheck
/**
 * Enemy factions (Phase 3 world design §4): who flies each encounter, the one thing they do differently in a
 * fight and how to beat it. The fight rules and their numbers live in src/systems/ftlCombat.js (FACTION_RULES).
 */

/** mechanics: the rules the fight engine runs for this faction (see ftlCombat.js). */
export const FACTIONS = Object.freeze(Object.fromEntries([
  { id: 'corsairs', name: 'Corsairs', chip: 'Corsairs · missiles', mechanics: ['missiles'],
    mechanic: 'One of their guns fires a missile that flies straight through shields.',
    counter: 'Keep a pilot at the helm to dodge it, and hit their Weapons room.' },
  { id: 'scrappers', name: 'Scrappers', chip: 'Scrappers · boarders', mechanics: ['boarders'],
    mechanic: 'They clamp on and send a boarding party into one of your rooms.',
    counter: 'Keep security free and send them at the boarders.' },
  { id: 'swarm', name: 'Swarm', chip: 'Swarm · drones', mechanics: ['drones', 'regrow'],
    mechanic: 'Drone swarms strip shields, and the hull grows back unless it is burning.',
    counter: 'Set them on fire and finish them fast.' },
  { id: 'ice', name: 'Ice Raiders', chip: 'Ice Raiders · ion', mechanics: ['ion'],
    mechanic: 'Ion hits freeze one of your rooms for a few seconds, and they board.',
    counter: 'Send an engineer into a frozen room: it thaws twice as fast.' },
  { id: 'shades', name: 'Shades', chip: 'Shades · cloak', mechanics: ['cloak'],
    mechanic: 'Every so often they cloak, and every shot fired at them misses.',
    counter: 'Hold fire while they are cloaked. Wreck their Helm and they cannot cloak.' },
  { id: 'wardens', name: 'Wardens', chip: 'Wardens · harmonics', mechanics: ['harmonics'],
    mechanic: 'Harmonic shields recharge twice as fast while their Shields room is above half.',
    counter: 'Hit their Shields room until it is below half.' },
  { id: 'eclipse', name: 'Eclipse', chip: 'Eclipse · it learned', mechanics: ['cloak', 'regrow'],
    mechanic: 'It cloaks like a Shade and grows back like the Swarm.',
    counter: 'Hold fire while it is cloaked, wreck its Helm and keep it burning.' },
].map(faction => [faction.id, Object.freeze({ ...faction, mechanics: Object.freeze(faction.mechanics) })])));

export const ENCOUNTER_FACTION = Object.freeze({
  pirate_scout: 'corsairs', pirate_wing: 'corsairs', pirate_ace: 'corsairs', corsair_king: 'corsairs',
  scrapper_gang: 'scrappers', ember_raider: 'scrappers',
  swarm_probe: 'swarm', swarm_skirmish: 'swarm', swarm_frigate: 'swarm', swarm_brood: 'swarm',
  ice_raiders: 'ice',
  veil_wraith: 'shades', hollow_shade: 'shades',
  crown_warden: 'wardens', eclipse_throne: 'wardens',
  eclipse_echo: 'eclipse',
});

/** The faction flying an encounter, or null for an id no faction claims. */
export function factionOf(encounterId) {
  return FACTIONS[ENCOUNTER_FACTION[String(encounterId)]] || null;
}

/** Does this faction run a fight rule ('missiles', 'drones', 'regrow', 'ion', 'cloak', 'harmonics', 'boarders')? */
export const factionHas = (factionId, mechanic) => Boolean(FACTIONS[factionId]?.mechanics.includes(mechanic));

/** Elites (the Bounty twist, later The Rift): a named captain with one modifier. */
export const ELITE_MODIFIERS = Object.freeze({
  armored: Object.freeze({ id: 'armored', label: 'Armored', rule: 'One extra shield layer.' }),
  veteran: Object.freeze({ id: 'veteran', label: 'Veteran', rule: 'Their crew repairs half again as fast.' }),
  overclocked: Object.freeze({ id: 'overclocked', label: 'Overclocked', rule: 'Their guns charge a quarter faster.' }),
  heavy: Object.freeze({ id: 'heavy', label: 'Heavy', rule: 'Almost a third more hull.' }),
});

export const ELITE_NAMES = Object.freeze({
  corsairs: Object.freeze(['Two-Tooth Marrik', 'Captain Halfpay', 'Lady Saltwire', 'Dimmy the Knife']),
  scrappers: Object.freeze(['Big Ferro', 'Old Sprocket', 'Nails Okonkwo', 'Auntie Grind']),
  swarm: Object.freeze(['The Hum', 'Mother of Probes', 'The Itch', 'Many Small Teeth']),
  ice: Object.freeze(['Glacier Jo', 'Frostbite Vane', 'The Polite Avalanche']),
  shades: Object.freeze(['The Unlisted', 'Mister Nobody', 'The Draft in the Room']),
  wardens: Object.freeze(['Assessor Gilt', 'Magistrate Vey', 'The Late Fee']),
  eclipse: Object.freeze(['The Second Draft', 'Echo of Echoes', 'It Remembers You']),
});

const ALL_ELITE_NAMES = new Set(Object.values(ELITE_NAMES).flat());

/** A well-formed elite: exactly { name, modifier }, a known name and a known modifier. */
export function validElite(elite) {
  return Boolean(elite && typeof elite === 'object' && !Array.isArray(elite)
    && Object.keys(elite).length === 2 && ALL_ELITE_NAMES.has(elite.name) && Object.hasOwn(ELITE_MODIFIERS, elite.modifier));
}

/** "Two-Tooth Marrik · Armored" for the enemy plate. */
export const eliteLabel = elite => (validElite(elite) ? `${elite.name} · ${ELITE_MODIFIERS[elite.modifier].label}` : '');
