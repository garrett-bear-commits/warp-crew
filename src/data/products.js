// @ts-nocheck
/**
 * Product catalog shared by the game and the purchase server. Pure data: the
 * server imports this to decide grants, so the client never names its reward.
 */
const gems = (sku, amount, name) => ({ sku, name, blurb: `+${amount} gems`, grant: { gems: amount } });
const wallPack = (sector, name, grant) => ({
  sku: `wc_wall_${sector}`, name, blurb: 'One time only · helps break this sector\'s flagship', oneTime: true, wall: sector, grant,
});

/**
 * Every product and every discount is its own SKU; nothing sells below $1.99.
 * Prices live in the Jest console (cents); these are the grants.
 */
export const PRODUCT_DEFS = {
  wc_gems_s: gems('wc_gems_s', 100, 'Gem Pouch'),
  wc_gems_m: gems('wc_gems_m', 280, 'Gem Pack'),
  wc_gems_l: gems('wc_gems_l', 600, 'Gem Crate'),
  wc_gems_xl: gems('wc_gems_xl', 1300, 'Gem Vault'),
  wc_gems_xxl: gems('wc_gems_xxl', 3500, 'Gem Hoard'),
  wc_starter_kit: {
    sku: 'wc_starter_kit',
    name: "New Captain's Kit",
    blurb: 'One time only: gems, fuel, medals and credits',
    oneTime: true,
    grant: { fuel: 10, gems: 250, medals: 50, credits: 800 },
  },
  wc_wall_spur: wallPack('spur', 'Corsair Breaker Pack', { gems: 300, medals: 80, credits: 1500, fuel: 10, drydockFinishes: 1 }),
  wc_wall_veil: wallPack('veil', 'Frigate Breaker Pack', { gems: 450, medals: 120, credits: 3000, fuel: 10, drydockFinishes: 1 }),
  wc_wall_ember: wallPack('ember', 'Raider Breaker Pack', { gems: 600, medals: 160, credits: 5000, fuel: 10, drydockFinishes: 2 }),
  wc_wall_hollow: wallPack('hollow', 'Shade Breaker Pack', { gems: 800, medals: 220, credits: 8000, fuel: 10, drydockFinishes: 2 }),
  wc_wall_crown: wallPack('crown', 'Throne Breaker Pack', { gems: 950, medals: 280, credits: 12000, fuel: 10, drydockFinishes: 3 }),
};

/** Gem ladder rungs, used for honest value comparisons. */
export const GEM_LADDER = ['wc_gems_s', 'wc_gems_m', 'wc_gems_l', 'wc_gems_xl', 'wc_gems_xxl'];

