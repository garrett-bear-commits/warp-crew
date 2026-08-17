import type { DailyRewardsDocument } from '@foundation/contracts';

export const dailyRewards: DailyRewardsDocument = {
  version: 1,
  ladder: [
    { day: 1, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 50 }] },
    { day: 2, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 75 }] },
    { day: 3, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 100 }] },
    { day: 4, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 125 }] },
    { day: 5, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 150 }] },
    { day: 6, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 200 }] },
    {
      day: 7,
      rewards: [
        { kind: 'soft_currency', currency: 'gold', amount: 300 },
        { kind: 'cosmetic', cosmeticId: 'badge-week' },
      ],
    },
  ],
};
