// The contract generator (Phase 3 §3): clients, jobs, cargo, briefs and twists on the daily board. Flavour never moves
// a pick, a board never repeats a client, every twist turns up, the words follow the copy rules, and a reload rolls
// the same cards.
process.env.TZ = 'UTC';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateContractBoard } from '../src/systems/contracts.js';
import { flavorFor, flavorBoard } from '../src/systems/contractFlavor.js';
import { CLIENTS, JOBS, CARGO } from '../src/data/clients.js';
import { knownSpeaker } from '../src/data/speakers.js';
import { validTwist } from '../src/data/twists.js';
import { renderContractBoard } from '../src/ui/contractView.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { defaultTutorialV5 } from '../src/systems/tutorialV5.js';

const DAY = 86400000;
const start = Date.UTC(2026, 9, 12, 12);
const base = completeFreshTutorial();
const captain = (extra = {}) => ({ ...base, tutorial: { ...defaultTutorialV5(), phase: 'done', completed: true }, activeContract: null, ...extra });
const veil = captain({ flags: { ...base.flags, veil_opened: true, wall_spur: true }, story: { ...base.story, veilUnlocked: true } });
const ships = ['sparrow', 'kestrel', 'clipper'];
/** Boards for 30 days, for Spur and Veil captains in three hulls: 180 boards. */
const boards = [];
for (let d = 0; d < 30; d++) for (const who of [captain(), veil]) for (const shipId of ships) {
  boards.push(generateContractBoard({ ...who, ship: { ...who.ship, shipId } }, start + d * DAY));
}
const offers = boards.flatMap(board => board.offers);

describe('contract generator', () => {
  it('gives every daily offer a client, a matching title and a brief', () => {
    for (const offer of offers) {
      assert.ok(knownSpeaker(offer.client), `${offer.id} client`);
      assert.ok(offer.title && offer.brief, `${offer.id} words`);
      assert.doesNotMatch(offer.title + offer.brief, /\{|\}|\d/, `${offer.id} tokens filled, numbers in words: ${offer.title} | ${offer.brief}`);
      assert.ok(offer.title.length <= 30, `${offer.id} title short: ${offer.title}`);
      assert.ok(offer.brief.length <= 130, `${offer.id} brief short: ${offer.brief}`);
      if (offer.twist) assert.ok(validTwist(offer.twist), `${offer.id} twist is well formed: ${JSON.stringify(offer.twist)}`);
      if (offer.twist) assert.equal(offer.profile, 'risky', 'twists are on risky jobs');
    }
  });

  it('never repeats a client on a board, and every twist turns up', () => {
    for (const board of boards) {
      const clients = board.offers.map(offer => offer.client);
      assert.equal(new Set(clients).size, clients.length, `board ${board.dayKey} repeats a client: ${clients}`);
    }
    assert.deepEqual([...new Set(offers.map(o => o.twist?.id).filter(Boolean))].sort(), ['bounty', 'escort', 'holdout', 'rush', 'waves']);
  });

  it('reads differently: many distinct cards and combinations', () => {
    const cards = new Set(offers.map(o => `${o.title}|${o.brief}`));
    const combos = new Set(offers.map(o => `${o.client}|${o.flavor.job}|${o.twist?.id || '-'}`));
    assert.ok(cards.size >= 150, `${cards.size} distinct cards`);
    assert.ok(combos.size >= 40, `${combos.size} client-job-twist combinations`);
    assert.ok(new Set(offers.map(o => o.client)).size >= 8, 'most clients post work');
  });

  it('never moves a pick, and rolls the same card on a reload', () => {
    const now = start + 3 * DAY;
    const board = generateContractBoard(captain(), now);
    const again = generateContractBoard(captain(), now);
    assert.deepEqual(again, board);
    for (const offer of board.offers) {
      const plain = { ...offer };
      for (const key of ['client', 'title', 'brief', 'flavor', 'twist']) delete plain[key];
      const again = flavorBoard([plain])[0];
      assert.deepEqual([again.destinationId, again.routeContent], [offer.destinationId, offer.routeContent], 'route picks are untouched');
      assert.equal(flavorFor(plain).brief, flavorFor(plain).brief, 'the same card every time');
    }
  });

  it('every client has lines for what they post, and every line names a known job', () => {
    for (const [id, client] of Object.entries(CLIENTS)) {
      assert.ok(knownSpeaker(id), id);
      for (const [profile, lines] of Object.entries(client.briefs)) for (const [job, line] of lines) {
        assert.ok(JOBS[profile][job], `${id} ${profile} ${job}`);
        assert.doesNotMatch(line, /\d/, `${id}: numbers in words`);
      }
    }
    assert.ok(CARGO.every(c => !/[,\d]/.test(c.long)), 'cargo fits any sentence');
  });

  it('the card shows the client, the twist and who you fight', () => {
    const offer = offers.find(o => o.twist?.id === 'bounty');
    const html = renderContractBoard({ offers: [offer] });
    assert.match(html, /class="contract-client"/);
    assert.match(html, /data-twist="bounty"/);
    assert.ok(html.includes(offer.twist.elite.name));
    assert.match(html, /class="contract-faction"/);
  });
});
