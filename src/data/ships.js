export const SHIPS = {
  sparrow: {
    id: 'sparrow',
    name: 'Sparrow',
    crewSlots: 2, // tutorial; unlocks to 4
    maxCrewSlots: 4,
    fuelBonus: 0,
    blurb: 'Reliable starter freighter. Upgradable forever.',
    upgradeCosts: {
      engines: { credits: 200 },
      shields: { credits: 250 },
      cargo: { credits: 180 },
      weapons: { credits: 300 },
      quarters: { credits: 400 }, // +crew slot toward max
    },
  },
  corvette: {
    id: 'corvette',
    name: 'Corvette',
    crewSlots: 6,
    maxCrewSlots: 6,
    fuelBonus: 2,
    blurb: 'Larger hull. Earn slowly or unlock early with Gems.',
    gemPrice: 1200,
    creditPrice: 25000,
  },
};

export function starterShip() {
  return {
    shipId: 'sparrow',
    systems: { engines: 1, shields: 1, cargo: 1, weapons: 1, quarters: 0 },
    cosmetics: {},
  };
}
