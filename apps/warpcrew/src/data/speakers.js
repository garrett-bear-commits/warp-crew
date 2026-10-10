// @ts-nocheck
/**
 * Who talks in transmissions (Phase 3, docs/design/23-world-bible.md): the recurring cast, the contract clients,
 * the two chapter bosses, the captain, any merc by template id, and a few special voices.
 */
import { artUrl } from '../shared/artUrl.js';
import { CREW_PORTRAITS, portraitFor } from './portraits.js';
import { catalogById } from './crewRoster.js';
import { enemyArtFor } from './art/enemyArt.js';
import { hireSeed } from '../systems/gacha.js';

const cast = id => artUrl(`art/pixel/cast/${id}.png`);
const client = id => artUrl(`art/pixel/clients/${id}.png`);

/** style: how the portrait is framed (plain, static for the black box, choir for the Swarm, blur for the stowaway). */
export const SPEAKERS = Object.freeze({
  vell: { name: 'Auntie Vell', from: 'The Exchange, Spur Anchor', portrait: cast('vell') },
  crane: { name: 'Silas Crane', from: 'The Gilded Hound', portrait: cast('crane') },
  tarrow: { name: 'Commodore Tarrow', from: 'Compact Navy, Spur Command', portrait: cast('tarrow') },
  choir: { name: 'Unknown signal', from: 'Somewhere in the lane', portrait: cast('choir'), style: 'choir' },
  wren: { name: 'Wren Halloway', from: 'The Sparrow, before', portrait: cast('wren') },
  blackbox: { name: 'Black box', from: 'Inside your walls', portrait: cast('wren'), style: 'static' },
  log: { name: "Ship's log", from: 'The Sparrow', portrait: artUrl('art/pixel/ships/v2/sparrow.png'), style: 'ship' },
  stowaway: { name: '???', from: 'Somewhere aboard', portrait: CREW_PORTRAITS.merc_wisp || cast('choir'), style: 'blur' },
  fenn: { name: 'Moro Fenn', from: "Haulers' Union dispatch", portrait: client('fenn'), family: 'haulers' },
  ledgers: { name: 'The Ledger Sisters', from: 'Kestrel Market', portrait: client('ledgers'), family: 'haulers' },
  sato: { name: 'Dr. Imani Sato', from: "Hope's Rest clinic", portrait: client('sato'), family: 'haven' },
  grudge: { name: 'Foreman Grudge', from: 'The Yards', portrait: client('grudge'), family: 'yards' },
  bask: { name: 'Lt. Oye Bask', from: 'Compact gate patrol', portrait: client('bask'), family: 'navy' },
  ossory: { name: 'Madame Ossory', from: 'Free Wings brokerage', portrait: client('ossory'), family: 'wings' },
  quist: { name: 'Surveyor Lio Quist', from: 'The Survey', portrait: client('quist'), family: 'survey' },
  ulama: { name: 'Ul-Ama', from: 'Tidefall brokers', portrait: client('ulama'), family: 'choirs' },
  nobody: { name: 'Nobody', from: 'No registry', portrait: client('nobody'), family: 'unbound', style: 'static' },
  sallow: { name: 'Mother Sallow', from: 'Veil Haven', portrait: client('sallow'), family: 'haven' },
  ash: { name: 'Torvald Ash', from: 'Ember foundry', portrait: client('ash'), family: 'yards' },
  corsair_king: { name: 'The Corsair King', from: 'Corsair Nest', portrait: enemyArtFor('corsair_king').image, style: 'ship' },
  constant: { name: 'The Constant', from: 'Swarm Scar', portrait: enemyArtFor('swarm_frigate').image, style: 'choir' },
});

/** The Sparrow's hull ID, from the save seed: WC-0417. */
export function hullId(player) {
  return `WC-${String((hireSeed(player) >>> 0) % 10000).padStart(4, '0')}`;
}

/** Fill the story tokens: {ship}, {captain}, {hullid}, {hullidrev}. */
export function fillStoryText(text, player) {
  const id = hullId(player);
  const ship = (typeof player?.ship?.name === 'string' && player.ship.name.trim()) || 'Sparrow';
  const captain = captainOf(player);
  return String(text || '')
    .replaceAll('{ship}', ship)
    .replaceAll('{captain}', captain?.customName || captain?.name || player?.captainName || 'Captain')
    .replaceAll('{hullidrev}', [...id].reverse().join(''))
    .replaceAll('{hullid}', id);
}

const captainOf = player => (player?.crew || []).find(member => member.isCaptain || member.instanceId === player?.captainInstanceId) || null;

/** A speaker id is known when it is in SPEAKERS, is 'captain', or names a roster merc. */
export function knownSpeaker(id) {
  return Object.hasOwn(SPEAKERS, id) || id === 'captain' || Boolean(catalogById(id));
}

/** The speaker's name, where they call from, portrait and frame style, for this save. */
export function speakerFor(id, player = null) {
  if (Object.hasOwn(SPEAKERS, id)) return { id, style: 'plain', ...SPEAKERS[id] };
  if (id === 'captain') {
    const captain = captainOf(player);
    return { id, name: captain?.customName || captain?.name || 'You', from: (typeof player?.ship?.name === 'string' && player.ship.name.trim()) || 'The Sparrow',
      portrait: portraitFor(captain?.templateId || 'captain_cyborg', captain?.role), style: 'plain' };
  }
  const merc = catalogById(id);
  if (merc) {
    const aboard = [...(player?.crew || []), ...(player?.reserve || [])].find(member => member.templateId === id);
    return { id, name: aboard?.customName || merc.name, from: aboard ? 'Aboard' : merc.origin, portrait: portraitFor(id, merc.role), style: 'plain' };
  }
  return { id, name: 'Unknown', from: '', portrait: SPEAKERS.choir.portrait, style: 'static' };
}
