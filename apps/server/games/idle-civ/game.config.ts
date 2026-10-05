import { DEFAULT_BLOB_LIMITS, DEFAULT_RETENTION, type GameConfig } from '@foundation/server';
import { achievements } from './content/achievements.ts';
import { dailyRewards } from './content/daily-rewards.ts';

export const idleCivGame: GameConfig = {
  gameId: 'idle-civ',
  features: {
    achievements: true,
    leaderboards: false,
    inbox: true,
    liveops: true,
    telemetry: true,
    journal: true,
    purchases: false,
    grants: true,
    qa: true,
  },
  catalog: [],
  boards: [],
  origins: ['https://jest.com', 'https://*.jest.com', 'http://localhost:5174'],
  retention: DEFAULT_RETENTION,
  maxProgressPerHour: 2_000,
  journal: 'errors_only',
  knownSchemaVersions: [1],
  purchases: { mintPremium: 'off' },
  blobLimits: DEFAULT_BLOB_LIMITS,
  maxTokenAgeSec: 24 * 3600,
  content: { achievements, dailyRewards },
  flags: [
    {
      key: 'slice.camp_hamlet',
      type: 'boolean',
      default: true,
      description: 'Camp → Hamlet tracer is the live slice',
    },
  ],
  integrityDailyBudget: 200,
  journalDailyEntryBudget: 20_000,
  minBuildVersion: '0.0.0',
};
