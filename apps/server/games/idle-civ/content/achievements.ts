import type { AchievementsDocument } from '@foundation/contracts';

export const achievements: AchievementsDocument = {
  version: 1,
  clientClaimPremiumBudget: 0,
  achievements: [
    {
      id: 'food-stable',
      title: 'The camp eats',
      description: 'Stabilize Food.',
      criteria: [{ source: 'client_claim', fact: 'progress', op: 'gte', value: 1 }],
      rewards: [{ kind: 'cosmetic', cosmeticId: 'campfire-glow' }],
    },
  ],
};
