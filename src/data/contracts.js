// @ts-nocheck
/** Authored copy and classification helpers for the daily Contract Board. */

export const CONTRACT_PROFILES = [
  {
    id: 'reliable',
    icon: 'contract_reliable',
    danger: 'Low',
    routeLengths: [2],
    rewardFamily: 'credits and reputation',
    favoredTrait: { kind: 'role', id: 'trader', label: 'Trader', why: 'Trade contacts know how to close a clean deal.' },
    titles: ['Steady Freight', 'Clear-Lane Delivery', 'Dockside Promise'],
    briefs: ['A dependable run with a ledger waiting at the other end.', 'Keep the cargo moving and the books come out clean.', 'A familiar route with honest work on the manifest.'],
  },
  {
    id: 'risky',
    icon: 'contract_risky',
    danger: 'High',
    routeLengths: [3],
    rewardFamily: 'credits and medals',
    favoredTrait: { kind: 'role', id: 'gunner', label: 'Gunner', why: 'A gunner turns a dangerous contract into a payout.' },
    titles: ['Belt Intercept', 'Hostile Signal', 'Raiders on the Clock'],
    briefs: ['The payoff is real if the threat does not get there first.', 'Someone is taking shots at the lane. Meet them prepared.', 'A hot contract with medals for a captain who holds course.'],
  },
  {
    id: 'strange',
    icon: 'contract_strange',
    danger: 'Guarded',
    routeLengths: [2, 3],
    rewardFamily: 'story and salvage',
    favoredTrait: { kind: 'system', id: 'sensors', label: 'Sensors', why: 'Sensors can separate a useful signal from a trap.' },
    titles: ['Uncatalogued Echo', 'Derelict Whisper', 'Signal Beyond the Lane'],
    briefs: ['A strange transmission is asking for a careful crew.', 'The wreckage is old, but its beacon is new.', 'Follow the anomaly before it fades back into static.'],
  },
];

export const CONTRACT_PROFILE_BY_ID = Object.fromEntries(CONTRACT_PROFILES.map((profile) => [profile.id, profile]));

export function outcomeWeights(node) {
  return (node?.outcomes || []).reduce((weights, outcome) => {
    weights[outcome.kind] = (weights[outcome.kind] || 0) + (Number(outcome.w) || 0);
    return weights;
  }, {});
}

export function combatWeight(node) {
  return outcomeWeights(node).combat || 0;
}

export function storySalvageWeight(node) {
  const weights = outcomeWeights(node);
  return (weights.story || 0) + (weights.salvage || 0);
}

export function qualifiesForProfile(profileId, node) {
  if (profileId === 'reliable') return ['trade', 'travel'].includes(node?.type) && combatWeight(node) <= 25;
  if (profileId === 'risky') return node?.type === 'danger' || combatWeight(node) >= 40;
  if (profileId === 'strange') return ['story', 'salvage'].includes(node?.type);
  return false;
}
