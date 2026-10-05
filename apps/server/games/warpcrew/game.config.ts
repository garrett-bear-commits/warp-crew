// Warp Crew game configuration (§11). Only what the Warp Crew client uses: identity and saves
// (always on), purchases with bundle and one-time packs and the grants that deliver them,
// subscriptions (Captain's Commission), and telemetry. GAME_ID is the exact Jest audience;
// GAME_CONFIG=warpcrew selects this file (apps/server/src/games.ts).
//
// The catalog repeats apps/warpcrew/src/data/products.js (the API image does not carry the game
// client): apps/server/test/unit/warpcrew-parity.test.ts fails when they differ.
import { DEFAULT_BLOB_LIMITS, DEFAULT_RETENTION, type GameConfig } from '@foundation/server';
import type { GrantReward } from '@foundation/contracts';

const gems = (amount: number): GrantReward => ({ kind: 'premium_currency', amount });
const soft = (currency: 'credits' | 'medals' | 'fuel', amount: number): GrantReward => ({
  kind: 'soft_currency',
  currency,
  amount,
});
const finishes = (qty: number): GrantReward => ({ kind: 'item', itemId: 'drydockFinishes', qty });

/** A sector wall pack: one time only, a bundle in the grant vocabulary (products.js wallPack). */
const wallPack = (
  sector: string,
  title: string,
  g: { gems: number; medals: number; credits: number; fuel: number; drydockFinishes: number },
): GameConfig['catalog'][number] => ({
  sku: `wc_wall_${sector}`,
  packKey: `wall_${sector}`,
  baseAmount: g.gems,
  title,
  oneTime: true,
  rewards: [
    gems(g.gems),
    soft('medals', g.medals),
    soft('credits', g.credits),
    soft('fuel', g.fuel),
    finishes(g.drydockFinishes),
  ],
});

export const warpcrewGame: GameConfig = {
  gameId: 'warpcrew',
  features: {
    achievements: false,
    leaderboards: false,
    inbox: false,
    liveops: false,
    telemetry: true,
    journal: false,
    purchases: true,
    grants: true,
    qa: false,
    subscriptions: true,
  },
  // Gem packs grant baseAmount gems and carry no first-purchase bonus (products.js has none).
  catalog: [
    { sku: 'wc_gems_s', packKey: 'gems_s', baseAmount: 100, title: 'Gem Pouch' },
    { sku: 'wc_gems_m', packKey: 'gems_m', baseAmount: 280, title: 'Gem Pack' },
    { sku: 'wc_gems_l', packKey: 'gems_l', baseAmount: 600, title: 'Gem Crate' },
    { sku: 'wc_gems_xl', packKey: 'gems_xl', baseAmount: 1300, title: 'Gem Vault' },
    { sku: 'wc_gems_xxl', packKey: 'gems_xxl', baseAmount: 3500, title: 'Gem Hoard' },
    {
      sku: 'wc_starter_kit',
      packKey: 'starter_kit',
      baseAmount: 250,
      title: "New Captain's Kit",
      oneTime: true,
      rewards: [soft('fuel', 10), gems(250), soft('medals', 50), soft('credits', 800)],
    },
    wallPack('spur', 'Corsair Breaker Pack', {
      gems: 300,
      medals: 80,
      credits: 1500,
      fuel: 10,
      drydockFinishes: 1,
    }),
    wallPack('veil', 'Frigate Breaker Pack', {
      gems: 450,
      medals: 120,
      credits: 3000,
      fuel: 10,
      drydockFinishes: 1,
    }),
    wallPack('ember', 'Raider Breaker Pack', {
      gems: 600,
      medals: 160,
      credits: 5000,
      fuel: 10,
      drydockFinishes: 2,
    }),
    wallPack('hollow', 'Shade Breaker Pack', {
      gems: 800,
      medals: 220,
      credits: 8000,
      fuel: 10,
      drydockFinishes: 2,
    }),
    wallPack('crown', 'Throne Breaker Pack', {
      gems: 950,
      medals: 280,
      credits: 12000,
      fuel: 10,
      drydockFinishes: 3,
    }),
  ],
  // Captain's Commission (products.js SUBSCRIPTION_DEFS): perks are the client's; the server only
  // verifies the signed list. Sandbox subscriptions follow purchases.mintSandbox.
  subscriptions: { skus: [{ sku: 'wc_sub_commission', title: "Captain's Commission" }] },
  boards: [],
  // Jest hosts the game; the GitHub Pages build is the QA and playtest host.
  origins: ['https://jest.com', 'https://*.jest.com', 'https://garrett-bear-commits.github.io'],
  retention: DEFAULT_RETENTION,
  // progressOf (policy.ts) counts jumps, fights won, expeditions and contracts claimed: a captain
  // makes a handful a minute at most, so 600/h only quarantines edited or replayed saves.
  maxProgressPerHour: 600,
  journal: 'errors_only', // ADR-020
  // player.version (src/systems/player.js SAVE_VERSION) is the save schema; migratePlayer reads
  // every version back to 1 and writes 9.
  knownSchemaVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  // ADR-024: no premium is minted from receipts until real Jest receipts are validated in Lab and
  // the owner approves; sandbox delivery is its own owner decision.
  purchases: { mintPremium: 'off' },
  blobLimits: DEFAULT_BLOB_LIMITS,
  maxTokenAgeSec: 24 * 3600,
  // Required by GameConfig; unused while achievements and daily are off (the client runs its own
  // daily loop).
  content: {
    achievements: { version: 1, clientClaimPremiumBudget: 0, achievements: [] },
    dailyRewards: {
      version: 1,
      ladder: [{ day: 1, rewards: [{ kind: 'soft_currency', currency: 'credits', amount: 1 }] }],
    },
  },
  flags: [],
  integrityDailyBudget: 200,
  journalDailyEntryBudget: 20_000,
  minBuildVersion: '0.0.0',
};
