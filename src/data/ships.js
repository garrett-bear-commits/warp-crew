// @ts-nocheck
export const SHIPS = {
  sparrow: {
    id: 'sparrow',
    name: 'Sparrow',
    crewSlots: 5,
    maxCrewSlots: 6,
    fuelBonus: 0,
    blurb: 'Reliable starter freighter. Upgradable forever.',
    upgradeCosts: {
      engines: { credits: 200 },
      shields: { credits: 250 },
      cargo: { credits: 180 },
      weapons: { credits: 300 },
      quarters: { credits: 400 },
    },
  },
  corvette: {
    id: 'corvette',
    name: 'Corvette',
    crewSlots: 6,
    maxCrewSlots: 8,
    fuelBonus: 2,
    blurb: 'Larger hull. Earn slowly or unlock early with gems.',
    gemPrice: 800,
    creditPrice: 12000,
    fuelMaxBonus: 4,
  },
  frigate: {
    id: 'frigate',
    name: 'Frigate',
    crewSlots: 8,
    maxCrewSlots: 10,
    fuelBonus: 3,
    blurb: 'Late soft-launch prestige hull (gated).',
    gemPrice: 2500,
    creditPrice: 50000,
    fuelMaxBonus: 6,
    lockedUntilChapter: 4,
  },
};

export function starterShip() {
  return {
    shipId: 'sparrow',
    systems: { engines: 1, shields: 1, cargo: 1, weapons: 1, quarters: 0 },
    cosmetics: {},
    ownedHulls: ['sparrow'],
    hull: 100,
  };
}

export function getShipDef(shipId) {
  return SHIPS[shipId] || SHIPS.sparrow;
}
