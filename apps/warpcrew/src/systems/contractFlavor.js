// @ts-nocheck
/**
 * The contract generator (Phase 3 design §3). The board's picks (profile, destination, route, encounter) are made
 * first and never change; this module then gives every daily offer a client, a job title, a cargo line, a brief in
 * the client's voice and, on most risky jobs, a set-piece twist. Each offer rolls on its own stream
 * (`<offer id>:flavor`), so flavour never moves an existing pick and a reload rolls the same card.
 */
import { CLIENTS, CARGO, JOBS, ROLLED_TWISTS, BOUNTY_MODIFIER } from '../data/clients.js';
import { NODES } from '../data/sectors.js';
import { factionOf, bountyNames } from '../data/factions.js';

const ENEMY_WORD = { corsairs: 'corsairs', scrappers: 'scrappers', swarm: 'Swarm drones', ice: 'Ice Raiders', shades: 'shades', wardens: 'Wardens', eclipse: 'Eclipse echoes' };

function hashSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stream(key) {
  let state = hashSeed(key) || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

const pick = (items, rng) => items[Math.floor(rng() * items.length)] || items[0];
const weighted = (rows, rng) => {
  let roll = rng() * rows.reduce((n, row) => n + row.w, 0);
  return rows.find(row => (roll -= row.w) < 0) || rows.at(-1);
};
const fill = (text, tokens) => text.replace(/\{(\w+)\}/g, (_, key) => tokens[key] ?? '');
const capitalise = text => text.charAt(0).toUpperCase() + text.slice(1);

/** The enemy faction a contract can fight (its route's encounter), or null for a run with no fight. */
export function offerFaction(offer) {
  const id = offer?.routeContent?.encounterId;
  return id ? factionOf(id)?.id || null : null;
}

/** Clients who post this kind of work in this sector. */
function clientsFor(profile, sector) {
  return Object.entries(CLIENTS).filter(([, client]) => client.briefs[profile]?.length && (!client.sectors || client.sectors.includes(sector)))
    .map(([id]) => id);
}

/** One offer's flavour; `used` clients are skipped so a board never shows the same client twice. */
export function flavorFor(offer, used = new Set()) {
  const rng = stream(`${offer.id}:flavor`);
  const node = NODES[offer.destinationId];
  const faction = offerFaction(offer);
  const options = clientsFor(offer.profile, node?.sector || 'spur');
  const fresh = options.filter(id => !used.has(id));
  const client = pick(fresh.length ? fresh : options, rng) || 'vell';
  const cargo = pick(CARGO, rng);
  // A line that needs an enemy is skipped on a run with no fight; a bounty or escort needs one too.
  const lines = CLIENTS[client].briefs[offer.profile].filter(([job, line]) => faction || (!line.includes('{enemy}') && !JOBS[offer.profile][job]?.twist));
  const [jobId, line] = pick(lines.length ? lines : CLIENTS.vell.briefs[offer.profile].filter(([job]) => !JOBS[offer.profile][job]?.twist), rng);
  const job = JOBS[offer.profile][jobId];
  let twist = null;
  if (offer.profile === 'risky' && faction) {
    const id = job.twist || weighted(ROLLED_TWISTS, rng).id;
    if (id === 'bounty') twist = { id, elite: { name: pick(bountyNames(faction), rng), modifier: BOUNTY_MODIFIER[faction] || 'veteran' } };
    else if (id) twist = { id };
  }
  const tokens = { cargo: cargo.long, short: cargo.short, place: node?.name || 'the lane', enemy: ENEMY_WORD[faction] || 'raiders', target: twist?.elite?.name || 'Wanted' };
  return {
    client,
    title: fill(job.alt && !line.includes('{cargo}') ? job.alt : job.title, tokens),
    brief: capitalise(fill(line, tokens)),
    flavor: { client, job: jobId, cargo: CARGO.indexOf(cargo) },
    ...(twist ? { twist } : {}),
  };
}

/**
 * Flavour every daily offer on a board (special offers keep their own words). `taken`: clients already on the board
 * (the open or next story mission's), so no client shows twice (audit 2026-10-10 L8).
 */
export function flavorBoard(offers, { taken = [] } = {}) {
  const used = new Set(taken);
  return offers.map(offer => {
    if (!['reliable', 'risky', 'strange'].includes(offer.profile) || offer.wall || offer.story || offer.loyalty || offer.fixedCopy) return offer;
    const flavor = flavorFor(offer, used);
    used.add(flavor.client);
    return { ...offer, ...flavor };
  });
}
