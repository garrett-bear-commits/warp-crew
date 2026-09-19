// @ts-nocheck
/**
 * Warp Crew IAP — copied from Pixel Starships (SavySoda) store shape.
 * Starbux → Gems. Membership, Season Pass, Daily Sales, gem ladder, value packs.
 * App Store list (PSS): $0.99 / $1.99 / $3.99 membership / $4.99 / $9.99 pass /
 * $19.99 bundle / $49.99 / $99.99. Wiki gem rates: 500/$5 … 14k/$100.
 */

export const SEASON_ID = 's1_veil';
export const MEMBERSHIP_MS = 30 * 24 * 60 * 60 * 1000;

export const SHOP_LANES = [
  { id: 'featured', label: 'Featured' },
  { id: 'gems', label: 'Gems' },
  { id: 'daily', label: 'Daily' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'hangar', label: 'Hangar' },
];

/** Pixel Starships Starbux pack ladder, renamed. */
export const GEM_PACKS = [
  { sku: 'wc_gems_180', name: 'Clip of Gems', usd: 0.99, gems: 180, blurb: '180 gems · entry clip' },
  { sku: 'wc_gems_500', name: 'Roll of Gems', usd: 4.99, gems: 500, blurb: '500 gems · +0% bonus' },
  { sku: 'wc_gems_1200', name: 'Stash of Gems', usd: 9.99, gems: 1200, blurb: '1,200 gems · +20% bonus', tag: 'popular' },
  { sku: 'wc_gems_2500', name: 'Case of Gems', usd: 19.99, gems: 2500, blurb: '2,500 gems · +25% bonus' },
  { sku: 'wc_gems_6500', name: 'Vault of Gems', usd: 49.99, gems: 6500, blurb: '6,500 gems · +30% bonus' },
  { sku: 'wc_gems_14000', name: 'Hold of Gems', usd: 99.99, gems: 14000, blurb: '14,000 gems · +40% bonus', tag: 'best' },
];

export const PRODUCT_CATALOG = {
  wc_fuel_5: {
    sku: 'wc_fuel_5',
    name: 'Fuel Cell ×5',
    blurb: 'Instant +5 fuel — energy refill',
    usd: 0.99,
    lane: 'fuel',
    grant: { fuel: 5 },
  },
  wc_fuel_20: {
    sku: 'wc_fuel_20',
    name: 'Fuel Drum ×20',
    blurb: 'Fill the tanks. +20 fuel',
    usd: 4.99,
    lane: 'fuel',
    grant: { fuel: 20 },
  },
  wc_captain: {
    sku: 'wc_captain',
    name: "Captain's First Pack",
    blurb: 'Once. Gems, fuel, medals, one rare hire.',
    usd: 4.99,
    lane: 'featured',
    once: true,
    grant: { gems: 400, fuel: 8, medals: 40, credits: 400 },
    extra: 'rare_pull',
  },
  wc_member: {
    sku: 'wc_member',
    name: 'Captain Membership',
    blurb: '30 days. Daily gems + fuel. Faster regen.',
    usd: 3.99,
    lane: 'featured',
    grant: { gems: 80 },
    extra: 'membership',
  },
  wc_pass: {
    sku: 'wc_pass',
    name: 'Season Pass',
    blurb: 'Premium track on this week’s goals.',
    usd: 9.99,
    lane: 'featured',
    grant: { gems: 200, medals: 20 },
    extra: 'pass',
  },
  wc_pass_bundle: {
    sku: 'wc_pass_bundle',
    name: 'Season Pass Bundle',
    blurb: 'Pass + Stash of Gems. Best mid-pack.',
    usd: 19.99,
    lane: 'featured',
    grant: { gems: 1400, medals: 20 },
    extra: 'pass',
  },
  wc_dropship: {
    sku: 'wc_dropship',
    name: 'Dropship ×10',
    blurb: 'Ten crew draws — PSS dropship analog.',
    usd: 9.99,
    lane: 'featured',
    grant: {},
    extra: 'pulls_10',
  },
  wc_daily_special: {
    sku: 'wc_daily_special',
    name: 'Daily Special',
    blurb: 'Rotates. 220 gems + 3 fuel.',
    usd: 1.99,
    lane: 'daily',
    grant: { gems: 220, fuel: 3, medals: 8 },
  },
};

for (const p of GEM_PACKS) {
  PRODUCT_CATALOG[p.sku] = {
    sku: p.sku,
    name: p.name,
    blurb: p.blurb,
    usd: p.usd,
    lane: 'gems',
    tag: p.tag,
    grant: { gems: p.gems },
  };
}

/** Premium track rewards (PSS season pass → week goals). */
export const PASS_PREMIUM = {
  jumps_5: { gems: 40, medals: 8 },
  combat_3: { gems: 50, medals: 10 },
  exp_2: { gems: 40, credits: 200 },
  rep_25: { gems: 60, medals: 12 },
  story_2: { gems: 50 },
  crew_4: { gems: 80, medals: 15 },
  corvette_or_ch2: { gems: 120, medals: 20 },
};

export const MEMBER_DAILY = { gems: 40, fuel: 1, medals: 15 };
export const MEMBER_FUEL_MULT = 1.25;

export function formatUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return `$${v.toFixed(2)}`;
}
