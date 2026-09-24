import { STARTER_CAPTAINS, createCrewInstance } from '../data/crewRoster.js';
export { STARTER_CAPTAINS };

const visibleCharacters = value => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
  .filter(({ segment }) => [...segment].some(character => !/\p{Default_Ignorable_Code_Point}/u.test(character))).length;

export function captainStationFor(role) {
  if (role === 'pilot' || role === 'scout') return 'helm';
  if (role === 'gunner') return 'weapons';
  if (role === 'engineer') return 'shields';
  return null;
}

export function chooseCaptain(player, { templateId, name, rng = Math.random } = {}) {
  if (player.captainInstanceId || player.crew?.length) return { ok: false, reason: 'captain_already_chosen', player };
  if (!STARTER_CAPTAINS.includes(templateId)) return { ok: false, reason: 'invalid_captain_template', player };
  const chosen = String(name ?? '').trim() || 'Captain';
  if (/[\p{Cc}\p{Cf}]/u.test(chosen) || visibleCharacters(chosen) < 1 || visibleCharacters(chosen) > 24) {
    return { ok: false, reason: 'invalid_captain_name', player };
  }
  const instance = { ...createCrewInstance(templateId, { rng }), isCaptain: true, customName: chosen, name: chosen };
  return {
    ok: true,
    instance,
    player: { ...player, captainInstanceId: instance.instanceId,
      crew: [instance], stationAssignments: { [instance.instanceId]: captainStationFor(instance.role) } },
  };
}
