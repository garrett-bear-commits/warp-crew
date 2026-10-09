// @ts-nocheck
/**
 * Crew kits: every merc's signature move in an FTL-lite fight.
 * Design: docs/superpowers/specs/2026-10-09-crew-matter-design.md (section 3).
 *
 * A kit is { move, charge, effects }:
 * - move: the name the cast banner shouts.
 * - charge: beats from empty to ready (abilities start half charged).
 * - effects: applied in order by ftlCombat's applyAbility. Effect types and fields:
 *   charge { pct }                 all player weapons gain pct% of their charge
 *   fireNow { extraShots }         every weapon fires at full charge this beat, +extraShots each
 *   extraShots { n }               the next volley fires n extra shots per weapon
 *   pierce { n }                   the next n shots ignore shields
 *   sureHit { n, roomPct, crit, splash }  the next n shots can't miss; +roomPct% room damage; crit; hit an adjacent room
 *   freeShot { damage }            one extra shot now that ignores shields
 *   evade { bonus, beats }         +bonus evasion for beats
 *   dodgeNext { n }                the next n enemy shots miss
 *   dodgeCharge { pct }            while evade runs, each dodge adds pct% weapon charge
 *   shieldBurst { over, beats }    restore every shield layer; over: +1 layer above max for beats
 *   shieldRecharge { pct, beats }  shield recharge +pct% for beats
 *   repair { amount, rooms }       repair the worst `rooms` rooms (or 'all') and put their fires out
 *   extinguish {}                  put out every fire aboard
 *   hullPatch { amount }           restore hull
 *   haste { mult, beats }          crew repair/extinguish/repel x mult for beats
 *   allCharge { pct }              every other crew member's ability gains pct% charge
 *   stall { beats }                enemy weapons stop charging for beats
 *   slow { pct, beats }            enemy weapons charge pct% slower for beats
 *   drain { n }                    knock out n enemy shield layers and stall their recharge
 *   shieldMaxDown { n }            the enemy loses n shield layers of maximum for the fight
 *   strike { room, hull }          room integrity damage to the targeted enemy room (+ hull)
 *   offline {}                     the targeted enemy room drops to 0 integrity
 *   ignite { room }                start a fire in an enemy room ('target' or 'weapons')
 *   weakRoom { mult, beats }       the targeted enemy room takes x mult room damage for beats
 *   evasionDown { amount, beats }  enemy evasion -amount for beats
 *   brace { beats }                enemy hull damage halved for beats
 *   holdDoor { mult, beats }       boarders take x mult damage for beats (brace 2 beats if none aboard)
 *   guard { beats }                no boarder sabotage for beats
 *   lastStand { hold, beats }      once per fight: the hull cannot fall below hold for beats
 *   salvage { pct }                +pct% credits on a win (once per fight)
 *   rewind {}                      every enemy weapon's charge resets to 0
 *   fullCharge {}                  every player weapon is fully charged
 */

/** Standard moves by role: Commons (and the four captains) use these. */
export const ROLE_MOVES = Object.freeze({
  pilot: Object.freeze({ move: 'Hard Burn', charge: 14, effects: [{ type: 'evade', bonus: 25, beats: 3 }] }),
  gunner: Object.freeze({ move: 'Hot Barrels', charge: 14, effects: [{ type: 'charge', pct: 40 }] }),
  engineer: Object.freeze({ move: 'Patch Job', charge: 12, effects: [{ type: 'repair', amount: 40, rooms: 1 }] }),
  medic: Object.freeze({ move: 'Stim Round', charge: 14, effects: [{ type: 'haste', mult: 2, beats: 4 }] }),
  scout: Object.freeze({ move: 'Mark Target', charge: 14, effects: [{ type: 'sureHit', n: 3, roomPct: 50 }] }),
  trader: Object.freeze({ move: 'Bribe the Gunner', charge: 18, effects: [{ type: 'stall', beats: 3 }] }),
  security: Object.freeze({ move: 'Hold the Door', charge: 14, effects: [{ type: 'holdDoor', mult: 3, beats: 4 }] }),
});

const kit = (move, charge, effects) => Object.freeze({ move, charge, effects: Object.freeze(effects.map(e => Object.freeze(e))) });

/** Uncommon and rarer mercs: their own moves. Commons fall back to ROLE_MOVES. */
export const CREW_KITS = Object.freeze({
  // Uncommon: the standard move with a twist.
  merc_kira: kit('Short Fuse', 14, [{ type: 'charge', pct: 40 }, { type: 'extraShots', n: 1 }]),
  merc_syla: kit('Harmonic Haggle', 18, [{ type: 'stall', beats: 3 }, { type: 'drain', n: 1 }]),
  merc_rook: kit('The Stare', 14, [{ type: 'holdDoor', mult: 3, beats: 6 }]),
  merc_nemi: kit('Echo Ping', 14, [{ type: 'sureHit', n: 4, roomPct: 50 }]),
  merc_cog: kit('Thesis Defense', 12, [{ type: 'repair', amount: 40, rooms: 2 }]),
  merc_yara: kit('No Waiting Room', 14, [{ type: 'haste', mult: 2, beats: 4 }, { type: 'repair', amount: 10, rooms: 'all' }]),
  merc_brink: kit('Static Plot', 14, [{ type: 'sureHit', n: 3, roomPct: 50 }, { type: 'evasionDown', amount: 10, beats: 4 }]),
  merc_oso: kit('The Quiet Way', 14, [{ type: 'holdDoor', mult: 3, beats: 4 }, { type: 'brace', beats: 3 }]),
  merc_orla: kit('Pass the Clamp', 14, [{ type: 'haste', mult: 2, beats: 6 }]),
  merc_tink: kit('Enthusiastic Maintenance', 12, [{ type: 'repair', amount: 40, rooms: 1 }, { type: 'extinguish' }]),

  // Rare: a unique move.
  merc_vorn: kit('Four-Arm Oath', 18, [{ type: 'shieldBurst', over: 1, beats: 6 }, { type: 'guard', beats: 6 }]),
  merc_quill: kit('Cold Read', 16, [{ type: 'pierce', n: 3 }]),
  merc_isa: kit('Field Surgery', 18, [{ type: 'hullPatch', amount: 8 }]),
  merc_drift: kit('Borrowed Wind', 15, [{ type: 'dodgeNext', n: 2 }]),
  merc_hex: kit('Target Lock', 16, [{ type: 'sureHit', n: 4, roomPct: 0, crit: true }]),
  merc_kal: kit('Customs Cutter', 16, [{ type: 'evade', bonus: 20, beats: 4 }, { type: 'slow', pct: 30, beats: 4 }]),
  merc_vex: kit('The Note Lands', 15, [{ type: 'freeShot', damage: 6 }]),
  merc_moth: kit('Already Sold It', 18, [{ type: 'stall', beats: 4 }, { type: 'salvage', pct: 20 }]),
  merc_reed: kit('Floor Plan', 16, [{ type: 'weakRoom', mult: 2, beats: 6 }]),

  // Epic: a unique move with a second effect.
  merc_ada: kit('I Feel It', 18, [{ type: 'allCharge', pct: 50 }, { type: 'haste', mult: 2, beats: 3 }]),
  merc_skarn: kit('Cleave Along the Grain', 18, [{ type: 'strike', room: 40, hull: 4 }]),
  merc_lora: kit('Better Lighting', 20, [{ type: 'stall', beats: 5 }, { type: 'drain', n: 1 }]),
  merc_wisp: kit('Already in the Room', 20, [{ type: 'offline' }]),
  merc_rune: kit('The Rib Sings', 18, [{ type: 'repair', amount: 50, rooms: 'all' }, { type: 'extinguish' }]),
  merc_ashen: kit('The Interesting Part', 18, [{ type: 'brace', beats: 5 }]),
  merc_nyx: kit('The Hallway Moved', 20, [{ type: 'evade', bonus: 100, beats: 3 }]),
  merc_coil: kit('Yard Alive', 18, [{ type: 'shieldBurst', over: 0, beats: 0 }, { type: 'shieldRecharge', pct: 50, beats: 6 }]),

  // Legendary and above: rule-breakers.
  merc_zephyr: kit('Laugh at Gauges', 20, [{ type: 'evade', bonus: 40, beats: 6 }, { type: 'dodgeCharge', pct: 15 }]),
  merc_onyx: kit('The Sequel', 22, [{ type: 'fireNow', extraShots: 1 }]),
  merc_prism: kit('I Am the Hull', 24, [{ type: 'hullPatch', amount: 20 }, { type: 'repair', amount: 100, rooms: 'all' }]),
  merc_solace: kit('Later', 22, [{ type: 'lastStand', hold: 25, beats: 8 }, { type: 'haste', mult: 2, beats: 4 }]),
  merc_harrow: kit('A Better Angle', 20, [{ type: 'sureHit', n: 3, roomPct: 0, splash: true }]),
  merc_eclipse: kit('Hunt Instinct', 22, [{ type: 'freeShot', damage: 5, shots: 3 }, { type: 'ignite', room: 'weapons' }]),
  merc_archon: kit('Editing', 26, [{ type: 'hullPatch', amount: 15 }, { type: 'shieldBurst', over: 0, beats: 0 },
    { type: 'repair', amount: 100, rooms: 'all' }, { type: 'shieldMaxDown', n: 1 }]),
  merc_voidwake: kit('Revoke Distance', 24, [{ type: 'rewind' }, { type: 'fullCharge' }]),
});

/** Captains use their role's standard move, called a Captain's Order. */
const CAPTAIN_ROLES = Object.freeze({ captain_cyborg: 'pilot', captain_gunner: 'gunner', captain_alien: 'scout', captain_droid: 'engineer' });

/** The kit for a template id and role; unknown ids fall back to the role's standard move. */
export function kitFor(templateId, role) {
  if (CREW_KITS[templateId]) return CREW_KITS[templateId];
  const r = CAPTAIN_ROLES[templateId] || role;
  return ROLE_MOVES[r] || null;
}

/** Every effect type the engine knows; tests check every kit uses only these. */
export const EFFECT_TYPES = Object.freeze(['charge', 'fireNow', 'extraShots', 'pierce', 'sureHit', 'freeShot', 'evade',
  'dodgeNext', 'dodgeCharge', 'shieldBurst', 'shieldRecharge', 'repair', 'extinguish', 'hullPatch', 'haste', 'allCharge',
  'stall', 'slow', 'drain', 'shieldMaxDown', 'strike', 'offline', 'ignite', 'weakRoom', 'evasionDown', 'brace', 'holdDoor',
  'guard', 'lastStand', 'salvage', 'rewind', 'fullCharge']);

const TEXT = {
  charge: e => `guns +${e.pct}% charge`,
  fullCharge: () => 'our guns fully charged',
  fireNow: e => `every gun fires now${e.extraShots ? `, +${e.extraShots} shot each` : ''}`,
  extraShots: e => `next volley +${e.n} shot${e.n > 1 ? 's' : ''} per gun`,
  pierce: e => `next ${e.n} shots ignore shields`,
  sureHit: e => `next ${e.n} shots can't miss${e.crit ? ' and crit' : ''}${e.roomPct ? `, +${e.roomPct}% system damage` : ''}${e.splash ? ', and hit a second room' : ''}`,
  freeShot: e => `${e.shots > 1 ? `${e.shots} shots` : 'a shot'} of ${e.damage} through shields`,
  evade: e => (e.bonus >= 100 ? `every enemy shot misses for ${e.beats}s` : `+${e.bonus}% dodge for ${e.beats}s`),
  dodgeCharge: e => `each dodge adds ${e.pct}% gun charge`,
  dodgeNext: e => `the next ${e.n} enemy shots miss`,
  shieldBurst: e => (e.over ? `shields full, +1 extra layer for ${e.beats}s` : 'shields back to full'),
  shieldRecharge: e => `shields recharge ${e.pct}% faster for ${e.beats}s`,
  repair: e => (e.rooms === 'all' ? `repair ${e.amount} in every room` : `repair ${e.amount} in the worst ${e.rooms > 1 ? `${e.rooms} rooms` : 'room'}`),
  extinguish: () => 'put out every fire',
  hullPatch: e => `+${e.amount} hull`,
  haste: e => `crew work ${e.mult}x faster for ${e.beats}s`,
  allCharge: e => `everyone else's move +${e.pct}%`,
  stall: e => `their guns stop charging for ${e.beats}s`,
  slow: e => `their guns charge ${e.pct}% slower for ${e.beats}s`,
  drain: e => `knock out ${e.n} enemy shield layer${e.n > 1 ? 's' : ''}`,
  shieldMaxDown: e => `they lose ${e.n} shield layer for the fight`,
  strike: e => `smash the target room${e.hull ? ` (+${e.hull} hull damage)` : ''}`,
  offline: () => 'knock the target room offline',
  ignite: e => (e.room === 'weapons' ? 'set their weapons room on fire' : 'set the target room on fire'),
  weakRoom: e => `target room takes ${e.mult}x damage for ${e.beats}s`,
  evasionDown: e => `they dodge ${e.amount}% less for ${e.beats}s`,
  brace: e => `enemy hits halved for ${e.beats}s`,
  holdDoor: e => `boarders take ${e.mult}x damage for ${e.beats}s (or brace if none)`,
  guard: e => `boarders can't sabotage for ${e.beats}s`,
  lastStand: e => `once a fight: hull can't fall below ${e.hold} for ${e.beats}s`,
  salvage: e => `+${e.pct}% credits if you win`,
  rewind: () => 'their guns reset to zero',
};

/** One plain sentence for a kit, e.g. "Guns +40% charge, and next volley +1 shot per gun." */
export function describeKit(kit) {
  if (!kit) return '';
  const parts = kit.effects.map(e => TEXT[e.type]?.(e)).filter(Boolean);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}` : parts[0] || '';
  return text ? `${text[0].toUpperCase()}${text.slice(1)}.` : '';
}
