// Regression tests for the Phase 3 audit (docs/audits/2026-10-10-phase3-audit.md): one test per finding.
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { createCrewInstance, CREW_CATALOG } from '../src/data/crewRoster.js';
import { generateContractBoard, acceptContract, commitContractAction, previewContractAction } from '../src/systems/contracts.js';
import { validFtlBody } from '../src/systems/ftlCombat.js';
import { applyEncounterAction } from '../src/systems/encounterState.js';
import { addLoyalty, contractFlyers, ensureLoyaltyOffer, loyaltyCardFor, LOYALTY } from '../src/systems/loyalty.js';
import { settleStoryClaim, settleChapters, reviewTransmissions, storyOffer, markSeen, campaignState } from '../src/systems/campaign.js';
import { storyEntries } from '../src/systems/almanac.js';
import { CHAPTERS, MISSIONS } from '../src/data/campaign.js';
import { factionOf, STORY_ELITES } from '../src/data/factions.js';
import { WALL_BY_ID, wallOffer } from '../src/systems/walls.js';
import { prepareSession, sessionAction } from '../src/systems/sessionLoop.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { defaultTutorialV5 } from '../src/systems/tutorialV5.js';

const NOW = Date.UTC(2030, 8, 22, 12);
const DAY = 86400000;
const clone = value => JSON.parse(JSON.stringify(value));
const ROLE_KEY = { gunner: 'critChance', engineer: 'repairBonus', medic: 'assistCharge', trader: 'tradeCredits', scout: 'expeditionSuccess', security: 'pirateResist', pilot: 'fuelCostReduce' };

/** A guided captain past the tutorial, with fuel and these extra crew, holding a launched risky contract. */
function launched(extraCrew = [], extra = {}) {
  let p = createNewPlayer({ tutorialScript: 4, now: NOW, rng: () => 0.1 });
  p = { ...p, tutorial: { ...p.tutorial, completed: true, phase: 'done' }, wallet: { ...p.wallet, fuel: 20 },
    crew: [...p.crew.map(member => ({ ...member, power: 40 })), ...extraCrew], crewSlots: p.crew.length + extraCrew.length + 1, ...extra };
  p = { ...p, contractBoard: generateContractBoard(p, NOW) };
  const offer = p.contractBoard.offers.find(o => o.profile === 'risky');
  p = acceptContract(p, offer.id, NOW).player;
  for (const id of ['launch', 'push']) p = commitContractAction(p, previewContractAction(p, { id }, NOW), { now: NOW, rng: () => 0.5 }).player;
  return p;
}
const guided = () => {
  const base = completeFreshTutorial();
  return prepareSession({ ...base, tutorial: { ...defaultTutorialV5(), phase: 'done', completed: true }, activeContract: null, activeEncounter: null,
    wallet: { ...base.wallet, fuel: 10 } }, NOW);
};

test('H1: a Loyal 5-star merc of every role fights in a valid fight', () => {
  for (const [role, key] of Object.entries(ROLE_KEY)) {
    const best = CREW_CATALOG.filter(t => t.role === role && t.id.startsWith('merc_')).sort((a, b) => (b.passive?.[key] || 0) - (a.passive?.[key] || 0))[0];
    const merc = createCrewInstance(best.id, { stars: 5, instanceId: `${best.id}_loyal` });
    const p = launched([merc], { loyalty: { points: { [best.id]: 60 }, loyal: [best.id] } });
    const fight = p.activeEncounter;
    assert.ok(fight?.crew.some(c => c.kit === best.id), `${best.id} fights`);
    assert.equal(validFtlBody(fight), true, `${best.id}: the fight passes the save check`);
    assert.ok(applyEncounterAction(p, { acceptanceId: fight.acceptanceId, revision: fight.revision }, NOW).ok, `${best.id}: the first beat goes through`);
    assert.ok(migratePlayer(clone(p)).activeEncounter, `${best.id}: a reload keeps the fight`);
  }
});

test('L1: loyalty goes only to the crew the job launched with', () => {
  const vex = createCrewInstance('merc_vex', { instanceId: 'merc_vex_late' });
  const p = launched();
  const flyers = contractFlyers({ ...p, crew: [...p.crew, vex] }, p.activeContract);
  assert.ok(!flyers.includes('merc_vex'), 'a merc hired after the launch did not fly');
  assert.ok(flyers.every(id => !id.startsWith('captain_')), 'never the captain');
  assert.ok(flyers.length > 0);
});

test('L2: moving the clock back never resets the daily loyalty cap', () => {
  let p = guided();
  const days = [NOW, NOW, NOW, NOW + DAY, NOW, NOW + DAY, NOW, NOW - DAY, NOW + DAY];
  for (const at of days) p = addLoyalty(p, ['merc_rex'], LOYALTY.contract, { now: at }).player;
  assert.ok(p.loyalty.points.merc_rex <= 2 * LOYALTY.dailyCap, `two days earn at most ${2 * LOYALTY.dailyCap}, got ${p.loyalty.points.merc_rex}`);
});

test('L3: a saved fight with its faction block removed is refused on load', () => {
  const p = launched();
  assert.ok(p.activeEncounter.faction, 'the fight carries its faction');
  const { faction: _gone, ...stripped } = p.activeEncounter;
  const loaded = migratePlayer(clone({ ...p, activeEncounter: stripped }));
  assert.equal(loaded.activeEncounter?.faction ?? null, null);
  assert.notDeepEqual(loaded.activeEncounter, stripped, 'the edited fight is not kept as it was');
});

test('L4: both routes of a risky card fight the faction it names', () => {
  for (let d = 0; d < 40; d++) {
    for (const flags of [{}, { veil_opened: true, wall_spur: true, ember_opened: true, hollow_opened: true, crown_opened: true }]) {
      let p = createNewPlayer({ tutorialScript: 4, now: NOW, rng: () => 0.1 });
      p = { ...p, tutorial: { ...p.tutorial, completed: true, phase: 'done' }, flags: { ...p.flags, ...flags },
        story: { ...p.story, veilUnlocked: true, emberUnlocked: true, hollowUnlocked: true, crownUnlocked: true } };
      for (const offer of generateContractBoard(p, NOW + d * DAY).offers.filter(o => o.profile === 'risky')) {
        const { routeOutcome, secureOutcome } = offer.routeContent;
        assert.equal(factionOf(secureOutcome.encounter)?.id, factionOf(routeOutcome.encounter)?.id, `${offer.id} at ${offer.destinationId}`);
      }
    }
  }
});

test('L5: a chapter recruit is shown after the action, not instead of it', () => {
  let p = { ...completeFreshTutorial(), activeContract: null, activeEncounter: null };
  for (const id of CHAPTERS[0].missions.slice(0, 4)) p = settleStoryClaim(settleStoryClaim(p, { story: { id }, offerId: `offer_story_${id}_1`, result: { success: true } }).player, { offerId: 'x', result: { success: true } }).player;
  p = prepareSession({ ...p, flags: { ...p.flags, veil_opened: true }, story: { ...p.story, veilUnlocked: true }, wallet: { ...p.wallet, fuel: 10 } }, NOW);
  const offer = p.contractBoard.offers.find(o => o.story?.id === 'c1_tarrow_terms');
  p = sessionAction(p, {}, 'contract-accept', { offer: offer.id }, { now: NOW }).player;
  p = { ...p, activeContract: { ...p.activeContract, stage: 'return', result: { success: true, rewards: { credits: 10, medals: 1, reputation: 0, gems: 0, fuel: 0 }, hullLoss: 0, injuredCrewId: null, storyFlag: null, summary: 'Done.' } } };
  const r = sessionAction(p, {}, 'contract-claim', { revision: p.activeContract.revision, acceptanceId: p.activeContract.acceptanceId }, { now: NOW });
  assert.ok(r.ok, r.reason);
  assert.equal(r.effect.source, 'story', "the mission's own reveal is kept");
  assert.equal(r.reveals.length, 1);
  assert.match(r.reveals[0].title, /Kal Vesper joins the crew/);
});

test('L6: story and loyalty tags must be well formed and from their own card', () => {
  const p = launched();
  const edited = { ...p, activeContract: { ...p.activeContract, story: { id: 'constructor', chapter: 1 }, loyalty: { templateId: 'merc_rex' } } };
  const loaded = migratePlayer(clone(edited));
  assert.equal(loaded.activeContract.story, undefined);
  assert.equal(loaded.activeContract.loyalty, undefined);
  const res = settleStoryClaim(guided(), { story: { id: 'constructor' }, offerId: 'offer_story_constructor_1', result: { success: true } });
  assert.equal(res.bonus, null);
  assert.deepEqual(res.transmissions, []);
});

test('L7: the loyalty card on show stays until played; the other ready merc waits', () => {
  const base = guided();
  let p = { ...base, crew: [...base.crew, createCrewInstance('merc_rex'), createCrewInstance('merc_bolt', { instanceId: 'merc_bolt_2' })],
    loyalty: { points: { merc_rex: 44, merc_bolt: 42 }, loyal: [] } };
  p = ensureLoyaltyOffer(p);
  assert.equal(loyaltyCardFor(p), 'merc_rex');
  p = ensureLoyaltyOffer({ ...p, loyalty: { ...p.loyalty, points: { merc_rex: 44, merc_bolt: 50 } } });
  assert.equal(loyaltyCardFor(p), 'merc_rex', 'the card does not swap when another merc pulls ahead');
});

test("L8: a board never repeats the story card's client", () => {
  for (let d = 0; d < 30; d++) {
    const p = prepareSession({ ...guided(), contractBoard: null }, NOW + d * DAY);
    const clients = p.contractBoard.offers.map(o => o.client).filter(Boolean);
    assert.equal(new Set(clients).size, clients.length, `day ${d}: ${clients}`);
  }
});

test('L9: a story elite never comes back as a daily bounty', () => {
  for (let d = 0; d < 120; d++) {
    const board = generateContractBoard({ ...guided(), flags: { ...guided().flags, veil_opened: true }, story: { veilUnlocked: true } }, NOW + d * DAY);
    for (const offer of board.offers) assert.ok(!STORY_ELITES.includes(offer.twist?.elite?.name), `${offer.id}: ${offer.title}`);
  }
});

test('L10: the board-seen event counts the daily offers, story card or not', () => {
  const p = guided();
  assert.ok(p.contractBoard.offers.some(o => o.story), 'a story card is on the board');
  const r = sessionAction(p, {}, 'mission-view', { view: 'contracts' }, { now: NOW });
  const seen = r.events.find(e => e.event === 'contract_board_seen');
  assert.ok(seen, 'the event fires with a story card on the board');
  assert.equal(seen.fields.destinationIds.length, 3, 'it lists the three daily offers');
});

test('L11: every story entry can be seen in play, with walls and without', () => {
  for (const script of [5, 3]) {
    let p = { ...completeFreshTutorial(), activeContract: null, activeEncounter: null };
    if (script === 5) p = { ...p, tutorial: { ...defaultTutorialV5(), phase: 'done', completed: true } };
    const play = ids => { p = markSeen(p, ids.filter(Boolean)); };
    for (const chapter of CHAPTERS) {
      for (const id of chapter.missions) {
        play(reviewTransmissions(p, storyOffer(p, id)));
        const won = settleStoryClaim(p, { story: { id }, offerId: `offer_story_${id}_1`, result: { success: true } });
        p = settleStoryClaim(won.player, { offerId: 'x', result: { success: true } }).player;
        play(won.transmissions);
      }
      if (script === 5) {
        play(reviewTransmissions(p, wallOffer(p, WALL_BY_ID[chapter.wall], NOW)));
        p = { ...p, flags: { ...p.flags, [`wall_${chapter.wall}`]: true } };
      } else p = { ...p, flags: { ...p.flags, [chapter.gateFlag]: true }, story: { ...p.story, veilUnlocked: true } };
      const done = settleChapters(p, NOW);
      p = done.player;
      play(done.transmissions);
    }
    const seen = new Set(p.almanac.seen);
    assert.deepEqual(storyEntries().map(e => e.id).filter(id => !seen.has(id)), [], `script ${script}: every story entry is seen`);
    assert.equal(campaignState(p).complete, true);
  }
});
