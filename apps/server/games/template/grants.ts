// Template game grant reward vocabulary (games/grant-vocabulary.ts): gems and gold, the two
// rewards its client applies (apps/template-game/src/game.tsx applyGrant). The policy refuses
// anything else at mint time; the admin inspector and admin CLI build their reward fields from it.
import type { GrantVocabulary } from '../grant-vocabulary.ts';

export const templateGrants: GrantVocabulary = {
  premiumName: 'gems',
  fields: [
    {
      kind: 'amount',
      name: 'gems',
      label: 'Gem',
      note: 'free',
      max: 100_000,
      reward: { kind: 'premium_currency' },
    },
    {
      kind: 'amount',
      name: 'gold',
      label: 'Gold',
      plural: 'Gold',
      max: 1_000_000_000,
      reward: { kind: 'soft_currency', currency: 'gold' },
    },
  ],
};
