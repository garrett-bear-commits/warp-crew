import type { DailyRewardsDocument } from '@foundation/contracts';

export const dailyRewards: DailyRewardsDocument = {
  version: 1,
  ladder: [{ day: 1, rewards: [{ kind: 'soft_currency', currency: 'food', amount: 50 }] }],
};
