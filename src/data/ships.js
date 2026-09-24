// @ts-nocheck
/** Hull tree + system upgrades. Costs scale forever. */

export const SHIP_SYSTEMS = ['engines', 'shields', 'cargo', 'weapons', 'quarters', 'sensors', 'medbay'];

export const SYSTEM_LABEL = {
  engines: 'Engines',
  shields: 'Shields',
  cargo: 'Cargo',
  weapons: 'Weapons',
  quarters: 'Quarters',
  sensors: 'Sensors',
  medbay: 'Medbay',
};

function hull(id, name, extra) {
  return {
    id,
    name,
    tier: extra.tier,
    crewSlots: extra.crewSlots,
    maxCrewSlots: extra.maxCrewSlots,
    fuelBonus: extra.fuelBonus || 0,
    fuelMaxBonus: extra.fuelMaxBonus || 0,
    gemPrice: extra.gemPrice ?? null,
    creditPrice: extra.creditPrice ?? null,
    lockedUntilChapter: extra.lockedUntilChapter || 0,
    lockedUntilRep: extra.lockedUntilRep || 0,
    requiresHull: extra.requiresHull || null,
    tradeBias: extra.tradeBias || 0,
    weaponBias: extra.weaponBias || 0,
    blurb: extra.blurb,
    history: extra.history || extra.blurb,
    upgradeCosts: extra.upgradeCosts,
  };
}

const sys = (e, s, c, w, q, se, m) => ({
  engines: { credits: e },
  shields: { credits: s },
  cargo: { credits: c },
  weapons: { credits: w },
  quarters: { credits: q },
  sensors: { credits: se },
  medbay: { credits: m },
});

export const SHIPS = {
  sparrow: hull('sparrow', 'Sparrow', {
    tier: 1, crewSlots: 5, maxCrewSlots: 6, fuelBonus: 0, fuelMaxBonus: 0,
    blurb: 'Reliable starter freighter. Upgradable forever.',
    history: 'Yard-surplus box with a honest jump drive. Captains outgrow the Sparrow. They never stop loving it.',
    upgradeCosts: sys(200, 250, 180, 300, 400, 220, 240),
  }),
  kestrel: hull('kestrel', 'Kestrel', {
    tier: 2, crewSlots: 5, maxCrewSlots: 7, fuelBonus: 1, fuelMaxBonus: 2,
    gemPrice: 280, creditPrice: 4000, lockedUntilChapter: 1, lockedUntilRep: 40,
    blurb: 'Courier hull. Cheap berths, honest engines.',
    history: 'The first upgrade most Spur crews can actually afford. Fast, thin-skinned, always for sale at Kestrel Market.',
    upgradeCosts: sys(240, 280, 210, 340, 440, 250, 260),
  }),
  corvette: hull('corvette', 'Corvette', {
    tier: 3, crewSlots: 6, maxCrewSlots: 8, fuelBonus: 2, fuelMaxBonus: 4,
    gemPrice: 800, creditPrice: 12000, lockedUntilChapter: 2, requiresHull: 'kestrel',
    blurb: 'Larger hull. Earn slowly or unlock early with gems.',
    history: 'Forge Moon still pours these ribs. A corvette is when a crew stops looking like a joke to pirates.',
    upgradeCosts: sys(320, 380, 280, 450, 520, 340, 360),
  }),
  clipper: hull('clipper', 'Clipper', {
    tier: 4, crewSlots: 6, maxCrewSlots: 8, fuelBonus: 2, fuelMaxBonus: 4,
    gemPrice: 1400, creditPrice: 28000, lockedUntilChapter: 3, requiresHull: 'corvette',
    tradeBias: 0.08,
    blurb: 'Trader’s hull. Long hold, long invoices.',
    history: 'Clippers run Ledger Moon and Aurora with fat cargo and thin guns. Captains who live on trade swear by them.',
    upgradeCosts: sys(360, 400, 240, 480, 560, 360, 380),
  }),
  frigate: hull('frigate', 'Frigate', {
    tier: 5, crewSlots: 8, maxCrewSlots: 10, fuelBonus: 3, fuelMaxBonus: 6,
    gemPrice: 2500, creditPrice: 50000, lockedUntilChapter: 4, requiresHull: 'corvette',
    blurb: 'Soft-launch prestige hull. Real war deck.',
    history: 'A frigate is the smallest ship navies still salute. Mercenary frigates get saluted, then shot at.',
    upgradeCosts: sys(480, 560, 420, 680, 740, 500, 520),
  }),
  destroyer: hull('destroyer', 'Destroyer', {
    tier: 6, crewSlots: 8, maxCrewSlots: 11, fuelBonus: 3, fuelMaxBonus: 7,
    gemPrice: 4000, creditPrice: 90000, lockedUntilChapter: 5, lockedUntilRep: 600, requiresHull: 'frigate',
    weaponBias: 0.1,
    blurb: 'Gun hull. Pirates stop waving.',
    history: 'Dorsal turret, ugly lines, beautiful kill-logs. Built to make Swarm probes reconsider.',
    upgradeCosts: sys(560, 640, 480, 520, 820, 560, 580),
  }),
  cruiser: hull('cruiser', 'Cruiser', {
    tier: 7, crewSlots: 10, maxCrewSlots: 13, fuelBonus: 4, fuelMaxBonus: 8,
    gemPrice: 6000, creditPrice: 160000, lockedUntilChapter: 6, requiresHull: 'frigate',
    blurb: 'Fleet-weight hull. Mid-game throne.',
    history: 'Twin stacks and a war-room. Cruisers turn a mercenary company into a rumor other companies fear.',
    upgradeCosts: sys(720, 800, 640, 880, 960, 740, 760),
  }),
  carrier: hull('carrier', 'Carrier', {
    tier: 8, crewSlots: 12, maxCrewSlots: 16, fuelBonus: 5, fuelMaxBonus: 10,
    gemPrice: 9000, creditPrice: 280000, lockedUntilChapter: 7, lockedUntilRep: 1000, requiresHull: 'cruiser',
    blurb: 'Deck for extra berths and drop teams.',
    history: 'A carrier is how you take a crew of sixteen into Veil and still have a medic who isn’t also the cook.',
    upgradeCosts: sys(900, 980, 820, 1080, 880, 920, 900),
  }),
  dreadnought: hull('dreadnought', 'Dreadnought', {
    tier: 9, crewSlots: 14, maxCrewSlots: 18, fuelBonus: 6, fuelMaxBonus: 12,
    gemPrice: 14000, creditPrice: 480000, lockedUntilChapter: 8, lockedUntilRep: 2000, requiresHull: 'cruiser',
    weaponBias: 0.12,
    blurb: 'Endgame fortress. Slow, endless, paid for in years or gems.',
    history: 'Prow cannon, stacked armor, a name that docks whisper. F2P captains get here in a long career. Paying captains get here angry and early.',
    upgradeCosts: sys(1200, 1320, 1080, 1400, 1280, 1180, 1200),
  }),
};

export function starterShip() {
  return {
    shipId: 'sparrow',
    name: 'Sparrow',
    systems: { engines: 1, shields: 1, cargo: 1, weapons: 1, quarters: 0, sensors: 0, medbay: 0 },
    cosmetics: {},
    ownedHulls: ['sparrow'],
    hull: 100,
  };
}

export function getShipDef(shipId) {
  return SHIPS[shipId] || SHIPS.sparrow;
}

export function hullLine() {
  return Object.values(SHIPS).sort((a, b) => a.tier - b.tier);
}
