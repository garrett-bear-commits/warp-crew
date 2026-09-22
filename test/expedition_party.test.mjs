import { createNewPlayer } from '../src/systems/player.js';
import {
  expeditionCrewOptions,
  recommendedExpeditionCrewIds,
  previewExpedition,
  validateExpeditionParty,
} from '../src/systems/expedition.js';

const player = { ...createNewPlayer(), crewSlots: 4 };
const options = expeditionCrewOptions(player, 'dustfall');
if (options.length !== 2 || options.some((x) => !x.reasons.length)) throw new Error('options and reasons');
const recommended = recommendedExpeditionCrewIds(player, 'dustfall');
const one = [recommended[0]];
const preview = previewExpedition(player, 'dustfall', one);
if (preview.crew.length !== 1 || preview.crew[0].instanceId !== one[0]) throw new Error('selected party');
if (validateExpeditionParty(player, 'dustfall', []).ok) throw new Error('empty party');
if (validateExpeditionParty(player, 'dustfall', ['missing']).ok) throw new Error('unknown crew');

const [first, second] = player.crew;
if (validateExpeditionParty(player, 'dustfall', [first.instanceId, first.instanceId]).ok) throw new Error('duplicate crew');
const away = { ...player, crew: [{ ...first, status: 'expedition' }, second] };
if (validateExpeditionParty(away, 'dustfall', [first.instanceId]).ok) throw new Error('away crew');
const now = Date.UTC(2026, 8, 21, 12);
const injured = { ...player, crew: [{ ...first, status: 'injured', injuredUntil: now + 1 }, second] };
if (validateExpeditionParty(injured, 'dustfall', [first.instanceId], now).ok) throw new Error('active injury');
const expired = { ...player, crew: [{ ...first, status: 'injured', injuredUntil: now - 1 }, second] };
if (!expeditionCrewOptions(expired, 'dustfall', now).some((crew) => crew.instanceId === first.instanceId)) throw new Error('expired injury option');
if (!validateExpeditionParty(expired, 'dustfall', [first.instanceId], now).ok) throw new Error('expired injury valid');
if (previewExpedition(expired, 'dustfall', [first.instanceId], now).crew[0]?.instanceId !== first.instanceId) throw new Error('expired injury preview');
const overflow = {
  ...player,
  crew: [...player.crew, { ...first, instanceId: 'third_ready_crew', status: 'ready' }],
};
if (validateExpeditionParty(overflow, 'dustfall', overflow.crew.map((crew) => crew.instanceId)).ok) throw new Error('party overflow');
console.log('expedition_party.test.mjs OK');
