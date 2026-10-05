import type { AchievementsDocument } from '@foundation/contracts';

/** In-bundle default (ADR-012); a published document overrides it without a deploy. */
export const achievements: AchievementsDocument = {
  version: 1,
  clientClaimPremiumBudget: 50,
  achievements: [
    {
      id: 'first-hundred',
      title: 'First hundred',
      description: 'Reach 100 progress.',
      criteria: [{ source: 'client_claim', fact: 'progress', op: 'gte', value: 100 }],
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 100 }],
    },
    {
      id: 'thousandaire',
      title: 'Thousandaire',
      description: 'Hold 1000 gold at once (summary claim).',
      criteria: [{ source: 'client_claim', fact: 'summary', key: 'gold', op: 'gte', value: 1000 }],
      rewards: [{ kind: 'premium_currency', amount: 10 }],
    },
    {
      id: 'patron',
      title: 'Patron',
      description: 'Make a purchase (server fact).',
      criteria: [{ source: 'server_fact', fact: 'purchases_paid_count', op: 'gte', value: 1 }],
      rewards: [{ kind: 'premium_currency', amount: 25 }],
    },
    {
      id: 'regular',
      title: 'Regular',
      description: 'Play on 3 different days.',
      criteria: [{ source: 'server_fact', fact: 'seen_days', op: 'gte', value: 3 }],
      rewards: [{ kind: 'cosmetic', cosmeticId: 'badge-regular' }],
    },
    {
      id: 'summer-visitor',
      title: 'Summer visitor',
      description: 'Windowed: play during the summer event.',
      criteria: [{ source: 'server_fact', fact: 'seen_days', op: 'gte', value: 1 }],
      rewards: [{ kind: 'cosmetic', cosmeticId: 'hat-summer' }],
      window: { startsAt: Date.UTC(2026, 5, 1), endsAt: Date.UTC(2026, 8, 1) },
    },
  ],
};
