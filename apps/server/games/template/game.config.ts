// Template game configuration (§11): features, providers, catalog, boards, origins, retention,
// maxProgressPerHour, journal mode. GAME_ID/GAME_ENV come from env; this file is selected by GAME_ID.
import { DEFAULT_BLOB_LIMITS, DEFAULT_RETENTION, type GameConfig } from '@foundation/server';
import { achievements } from './content/achievements.ts';
import { dailyRewards } from './content/daily-rewards.ts';

export const templateGame: GameConfig = {
  gameId: 'template',
  features: {
    achievements: true,
    leaderboards: true,
    inbox: true,
    liveops: true,
    telemetry: true,
    journal: true,
    purchases: true,
    grants: true,
    qa: true,
    subscriptions: true,
  },
  catalog: [
    {
      sku: 'gems_100',
      packKey: 'handful',
      baseAmount: 100,
      firstPurchaseMultiplier: 2,
      title: 'Handful of gems',
    },
    {
      sku: 'gems_550',
      packKey: 'pouch',
      baseAmount: 550,
      firstPurchaseMultiplier: 2,
      title: 'Pouch of gems',
    },
    { sku: 'gems_1200', packKey: 'bowl', baseAmount: 1200, title: 'Bowl of gems' },
  ],
  boards: [
    {
      boardKey: 'clicks',
      scoreMin: 0,
      scoreMax: 10_000_000,
      maxElapsedMs: 15 * 60_000,
      quarantineTopN: 3,
      summaryBound: { key: 'clicks', factor: 1 },
    },
  ],
  origins: ['https://jest.com', 'https://*.jest.com'],
  retention: DEFAULT_RETENTION,
  maxProgressPerHour: 36_000, // 10 accepted actions/sec sustained
  journal: 'errors_only', // ADR-020
  knownSchemaVersions: [1, 2],
  purchases: { mintPremium: 'off' }, // ADR-024: owner gate + real paid/sandbox payload validation
  subscriptions: { skus: [{ sku: 'sub_patron', title: 'Patron' }] }, // ADR-035: verified, never stored
  blobLimits: DEFAULT_BLOB_LIMITS,
  maxTokenAgeSec: 24 * 3600,
  content: { achievements, dailyRewards },
  flags: [
    {
      key: 'sale.summer',
      type: 'boolean',
      default: false,
      description:
        'Summer event banner only; checkout price always comes from the platform catalog',
    },
    { key: 'idle.rate', type: 'number', default: 1, description: 'Idle production multiplier' },
    { key: 'ui.theme', type: 'string', default: 'classic' },
  ],
  integrityDailyBudget: 200,
  journalDailyEntryBudget: 20_000,
  placementRewards: [
    { upTo: 1, rewards: [{ kind: 'premium_currency', amount: 50 }] },
    { upTo: 3, rewards: [{ kind: 'premium_currency', amount: 20 }] },
    { upTo: 10, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 500 }] },
  ],
  minBuildVersion: '0.0.0',
};
