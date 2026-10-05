// @ts-nocheck
/**
 * Warp Crew merc looks — Sunnyside rig, space-reskinned.
 * hair/skin/cloth/hairColor drive the runtime idle portraits (crewArt.sheetFor).
 * family/variant/tone/suit/gear/glow drive the baked ship sprites that
 * scripts/crew-rig/build_crew_sheets.py writes to public/art/crew/.
 */

export const CREW_LOOKS = {
  captain_cyborg: { hair: 'shorthair', skin: 'tan', cloth: 'cyan', hairColor: 'black', family: 'human', suit: 'ochre', rigHairColor: 'brown', gear: 'cybereye stubble', glow: 'cyan' },
  captain_gunner: { hair: 'longhair', skin: 'brown', cloth: 'red', hairColor: 'black', family: 'human', gear: 'headset gloves', glow: 'red' },
  captain_alien: { hair: 'curlyhair', skin: 'light', cloth: 'purple', hairColor: 'grey', family: 'alien', variant: 'grey', tone: 'greygreen', suit: 'umber', glow: 'amber' },
  captain_droid: { hair: 'mophair', skin: 'deep', cloth: 'slate', hairColor: 'grey', family: 'droid', variant: 'dome', tone: 'rust', suit: 'slate', glow: 'amber' },
  merc_rex: { hair: 'shorthair', skin: 'tan', cloth: 'cyan', hairColor: 'brown', family: 'human', gear: 'headset stubble' },
  merc_bolt: { hair: 'mophair', skin: 'deep', cloth: 'slate', hairColor: 'grey', family: 'droid', variant: 'box', tone: 'hazard', glow: 'red' },
  merc_jen: { hair: 'longhair', skin: 'light', cloth: 'red', hairColor: 'black', family: 'human', gear: 'goggles gloves' },
  merc_moss: { hair: 'bowlhair', skin: 'tan', cloth: 'green', hairColor: 'sand', family: 'droid', variant: 'dome', tone: 'ivory', glow: 'green' },
  merc_plip: { hair: 'curlyhair', skin: 'brown', cloth: 'ochre', hairColor: 'ginger', family: 'alien', variant: 'antennae', tone: 'moss', glow: 'amber' },
  merc_kira: { hair: 'longhair', skin: 'light', cloth: 'purple', hairColor: 'black', family: 'human', gear: 'cybereye gloves', glow: 'red' },
  merc_syla: { hair: 'curlyhair', skin: 'light', cloth: 'cyan', hairColor: 'blonde', family: 'alien', variant: 'fins', tone: 'sand', glow: 'cyan' },
  merc_rook: { hair: 'shorthair', skin: 'brown', cloth: 'slate', hairColor: 'black', family: 'human', gear: 'helmet visor', glow: 'amber' },
  merc_nemi: { hair: 'bowlhair', skin: 'light', cloth: 'green', hairColor: 'sand', family: 'alien', variant: 'antennae', tone: 'violet', glow: 'cyan' },
  merc_cog: { hair: 'mophair', skin: 'deep', cloth: 'ochre', hairColor: 'grey', family: 'droid', variant: 'box', tone: 'rust', glow: 'amber' },
  merc_vorn: { hair: 'shorthair', skin: 'deep', cloth: 'purple', hairColor: 'black', family: 'alien', variant: 'crest', tone: 'crimson', glow: 'amber' },
  merc_quill: { hair: 'curlyhair', skin: 'light', cloth: 'blue', hairColor: 'blonde', family: 'alien', variant: 'crest', tone: 'sand', glow: 'green' },
  merc_isa: { hair: 'longhair', skin: 'tan', cloth: 'green', hairColor: 'brown', family: 'human', gear: 'headset', glow: 'green' },
  merc_drift: { hair: 'mophair', skin: 'light', cloth: 'purple', hairColor: 'grey', family: 'alien', variant: 'grey', tone: 'ash', glow: 'cyan' },
  merc_hex: { hair: 'mophair', skin: 'deep', cloth: 'red', hairColor: 'grey', family: 'droid', variant: 'sentinel', tone: 'blackops', glow: 'red' },
  merc_ada: { hair: 'longhair', skin: 'light', cloth: 'blue', hairColor: 'blonde', family: 'droid', variant: 'dome', tone: 'ivory', glow: 'cyan' },
  merc_skarn: { hair: 'shorthair', skin: 'tan', cloth: 'green', hairColor: 'sand', family: 'alien', variant: 'crest', tone: 'glass', glow: 'cyan' },
  merc_lora: { hair: 'longhair', skin: 'brown', cloth: 'ochre', hairColor: 'black', family: 'human', gear: 'cybereye', glow: 'violet' },
  merc_wisp: { hair: 'curlyhair', skin: 'light', cloth: 'cyan', hairColor: 'grey', family: 'alien', variant: 'tendrils', tone: 'violet', glow: 'violet' },
  merc_zephyr: { hair: 'shorthair', skin: 'tan', cloth: 'blue', hairColor: 'blonde', family: 'alien', variant: 'fins', tone: 'teal', glow: 'cyan' },
  merc_onyx: { hair: 'shorthair', skin: 'deep', cloth: 'slate', hairColor: 'black', family: 'human', gear: 'cybereye scar stubble gloves', glow: 'red' },
  merc_prism: { hair: 'mophair', skin: 'light', cloth: 'purple', hairColor: 'grey', family: 'droid', variant: 'sentinel', tone: 'chrome', glow: 'violet' },
  merc_tess: { hair: 'longhair', skin: 'tan', cloth: 'cyan', hairColor: 'brown', family: 'human', gear: 'headset' },
  merc_dax: { hair: 'shorthair', skin: 'tan', cloth: 'red', hairColor: 'brown', family: 'human', gear: 'scar stubble gloves' },
  merc_nub: { hair: 'mophair', skin: 'deep', cloth: 'ochre', hairColor: 'grey', family: 'droid', variant: 'box', tone: 'gunmetal', glow: 'cyan' },
  merc_pip: { hair: 'curlyhair', skin: 'tan', cloth: 'ochre', hairColor: 'ginger', family: 'human', rigHair: 'spikeyhair', gear: 'goggles' },
  merc_juno: { hair: 'bowlhair', skin: 'light', cloth: 'green', hairColor: 'black', family: 'human', gear: 'visor', glow: 'cyan' },
  merc_greaves: { hair: 'shorthair', skin: 'tan', cloth: 'slate', hairColor: 'brown', family: 'human', gear: 'helmet visor stubble', glow: 'red' },
  merc_yara: { hair: 'longhair', skin: 'brown', cloth: 'green', hairColor: 'black', family: 'human', gear: 'headset', glow: 'green' },
  merc_brink: { hair: 'mophair', skin: 'light', cloth: 'slate', hairColor: 'grey', family: 'human', gear: 'goggles scar' },
  merc_oso: { hair: 'shorthair', skin: 'brown', cloth: 'slate', hairColor: 'black', family: 'human', gear: 'helmet visor', glow: 'amber' },
  merc_orla: { hair: 'longhair', skin: 'light', cloth: 'cyan', hairColor: 'blonde', family: 'human', gear: 'visor', glow: 'green' },
  merc_tink: { hair: 'mophair', skin: 'deep', cloth: 'ochre', hairColor: 'ginger', family: 'droid', variant: 'dome', tone: 'hazard', glow: 'cyan' },
  merc_kal: { hair: 'shorthair', skin: 'tan', cloth: 'blue', hairColor: 'black', family: 'human', gear: 'headset scar' },
  merc_vex: { hair: 'curlyhair', skin: 'light', cloth: 'cyan', hairColor: 'blonde', family: 'alien', variant: 'crest', tone: 'teal', glow: 'red' },
  merc_moth: { hair: 'longhair', skin: 'tan', cloth: 'ochre', hairColor: 'black', family: 'human', gear: 'goggles' },
  merc_reed: { hair: 'mophair', skin: 'light', cloth: 'slate', hairColor: 'grey', family: 'droid', variant: 'dome', tone: 'chrome', glow: 'cyan' },
  merc_rune: { hair: 'longhair', skin: 'tan', cloth: 'ochre', hairColor: 'brown', family: 'human', gear: 'goggles gloves stubble' },
  merc_ashen: { hair: 'shorthair', skin: 'tan', cloth: 'green', hairColor: 'sand', family: 'human', gear: 'helmet visor', glow: 'cyan' },
  merc_nyx: { hair: 'curlyhair', skin: 'light', cloth: 'purple', hairColor: 'grey', family: 'alien', variant: 'tendrils', tone: 'ash', glow: 'violet' },
  merc_coil: { hair: 'mophair', skin: 'deep', cloth: 'slate', hairColor: 'grey', family: 'droid', variant: 'box', tone: 'chrome', glow: 'green' },
  merc_solace: { hair: 'longhair', skin: 'light', cloth: 'green', hairColor: 'blonde', family: 'human', gear: 'visor', glow: 'cyan' },
  merc_harrow: { hair: 'shorthair', skin: 'tan', cloth: 'blue', hairColor: 'black', family: 'human', gear: 'headset cybereye', glow: 'cyan' },
  merc_eclipse: { hair: 'mophair', skin: 'deep', cloth: 'red', hairColor: 'black', family: 'alien', variant: 'crest', tone: 'violet', glow: 'violet' },
  merc_archon: { hair: 'mophair', skin: 'light', cloth: 'ochre', hairColor: 'blonde', family: 'droid', variant: 'sentinel', tone: 'brass', glow: 'amber' },
  merc_voidwake: { hair: 'shorthair', skin: 'deep', cloth: 'purple', hairColor: 'grey', family: 'alien', variant: 'tendrils', tone: 'void', glow: 'violet' },
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
