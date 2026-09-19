// @ts-nocheck
/** First five Warp Crew mercs — Sunnyside rig, space-reskinned. */

export const CREW_LOOKS = {
  merc_rex: { hair: 'shorthair', skin: 'tan', cloth: 'cyan', hairColor: 'brown' },
  merc_bolt: { hair: 'mophair', skin: 'deep', cloth: 'slate', hairColor: 'grey' },
  merc_jen: { hair: 'longhair', skin: 'light', cloth: 'red', hairColor: 'black' },
  merc_moss: { hair: 'bowlhair', skin: 'tan', cloth: 'green', hairColor: 'sand' },
  merc_plip: { hair: 'curlyhair', skin: 'brown', cloth: 'ochre', hairColor: 'ginger' },
};

const ROLE_LOOK = {
  pilot: 'merc_rex',
  engineer: 'merc_bolt',
  gunner: 'merc_jen',
  medic: 'merc_moss',
  trader: 'merc_plip',
  scout: 'merc_plip',
  security: 'merc_rex',
};

export function lookIdFor(templateId, role) {
  if (CREW_LOOKS[templateId]) return templateId;
  return ROLE_LOOK[role] || 'merc_rex';
}
