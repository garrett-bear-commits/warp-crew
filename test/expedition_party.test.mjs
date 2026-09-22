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
console.log('expedition_party.test.mjs OK');
