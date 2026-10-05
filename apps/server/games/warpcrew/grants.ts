// Warp Crew grant reward vocabulary (games/grant-vocabulary.ts): the rewards the Warp Crew client
// applies (apps/warpcrew/src/systems/iap.js applyGrant): gems (premium), credits, medals and fuel
// (wallet soft currencies) and drydock finishes (a counted item, player.drydockFinishes). Currency
// and item ids are the keys of the grants in apps/warpcrew/src/data/products.js, and each maximum
// is the most one Warp Crew product grants (Gem Hoard: 3,500 gems; Throne Breaker Pack: 12,000
// credits, 280 medals, 3 drydock finishes; every fuel grant is 10), so a support grant never
// exceeds the largest purchase. The policy refuses anything else at mint time; the admin
// inspector and admin CLI build their reward fields from it. A parity test
// (apps/server/test/unit/warpcrew-parity.test.ts) keeps this list equal to what products.js uses.
import type { GrantVocabulary } from '../grant-vocabulary.ts';

export const warpcrewGrants: GrantVocabulary = {
  premiumName: 'gems',
  fields: [
    {
      kind: 'amount',
      name: 'gems',
      label: 'Gem',
      note: 'free',
      max: 3_500,
      reward: { kind: 'premium_currency' },
    },
    {
      kind: 'amount',
      name: 'credits',
      label: 'Credit',
      max: 12_000,
      reward: { kind: 'soft_currency', currency: 'credits' },
    },
    {
      kind: 'amount',
      name: 'medals',
      label: 'Medal',
      max: 280,
      reward: { kind: 'soft_currency', currency: 'medals' },
    },
    {
      kind: 'amount',
      name: 'fuel',
      label: 'Fuel',
      plural: 'Fuel',
      max: 10,
      reward: { kind: 'soft_currency', currency: 'fuel' },
    },
    {
      kind: 'amount',
      // CLI flag names are lowercase with dashes (scripts/admin.mjs grantFlags).
      name: 'drydock-finishes',
      label: 'Drydock finish',
      plural: 'Drydock finishes',
      max: 3,
      reward: { kind: 'item', itemId: 'drydockFinishes' },
    },
  ],
};
