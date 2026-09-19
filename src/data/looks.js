// @ts-nocheck
/** Warp Crew merc looks — Sunnyside rig, space-reskinned. */

export const CREW_LOOKS = {
  merc_rex: { hair: 'shorthair', skin: 'tan', cloth: 'cyan', hairColor: 'brown' },
  merc_bolt: { hair: 'mophair', skin: 'deep', cloth: 'slate', hairColor: 'grey' },
  merc_jen: { hair: 'longhair', skin: 'light', cloth: 'red', hairColor: 'black' },
  merc_moss: { hair: 'bowlhair', skin: 'tan', cloth: 'green', hairColor: 'sand' },
  merc_plip: { hair: 'curlyhair', skin: 'brown', cloth: 'ochre', hairColor: 'ginger' },
  merc_kira: { hair: 'longhair', skin: 'light', cloth: 'purple', hairColor: 'black' },
  merc_syla: { hair: 'curlyhair', skin: 'light', cloth: 'cyan', hairColor: 'blonde' },
  merc_rook: { hair: 'shorthair', skin: 'brown', cloth: 'slate', hairColor: 'black' },
  merc_nemi: { hair: 'bowlhair', skin: 'light', cloth: 'green', hairColor: 'sand' },
  merc_cog: { hair: 'mophair', skin: 'deep', cloth: 'ochre', hairColor: 'grey' },
  merc_vorn: { hair: 'shorthair', skin: 'deep', cloth: 'purple', hairColor: 'black' },
  merc_quill: { hair: 'curlyhair', skin: 'light', cloth: 'blue', hairColor: 'blonde' },
  merc_isa: { hair: 'longhair', skin: 'tan', cloth: 'green', hairColor: 'brown' },
  merc_drift: { hair: 'mophair', skin: 'light', cloth: 'purple', hairColor: 'grey' },
  merc_hex: { hair: 'mophair', skin: 'deep', cloth: 'red', hairColor: 'grey' },
  merc_ada: { hair: 'longhair', skin: 'light', cloth: 'blue', hairColor: 'blonde' },
  merc_skarn: { hair: 'shorthair', skin: 'tan', cloth: 'green', hairColor: 'sand' },
  merc_lora: { hair: 'longhair', skin: 'brown', cloth: 'ochre', hairColor: 'black' },
  merc_wisp: { hair: 'curlyhair', skin: 'light', cloth: 'cyan', hairColor: 'grey' },
  merc_zephyr: { hair: 'shorthair', skin: 'tan', cloth: 'blue', hairColor: 'blonde' },
  merc_onyx: { hair: 'shorthair', skin: 'deep', cloth: 'slate', hairColor: 'black' },
  merc_prism: { hair: 'mophair', skin: 'light', cloth: 'purple', hairColor: 'grey' },
};

const ROLE_LOOK = {
  pilot: 'merc_rex',
  engineer: 'merc_bolt',
  gunner: 'merc_jen',
  medic: 'merc_moss',
  trader: 'merc_plip',
  scout: 'merc_nemi',
  security: 'merc_rook',
};

export function lookIdFor(templateId, role) {
  if (CREW_LOOKS[templateId]) return templateId;
  return ROLE_LOOK[role] || 'merc_rex';
}
