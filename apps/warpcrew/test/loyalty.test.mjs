// Loyalty (Phase 3 §5): every merc's writing, the thresholds, the bond scenes, the loyalty card and claim, the fight
// edge and the saves.
process.env.TZ = 'UTC';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BONDS } from '../src/data/bonds.js';
import { CREW_CATALOG, createCrewInstance } from '../src/data/crewRoster.js';
import { NODES } from '../src/data/sectors.js';
import { knownSpeaker } from '../src/data/speakers.js';
import { LOYALTY, LOYAL_REWARD, ROLE_TWIST, addLoyalty, loyaltyLevel, openedScenes, pendingScenes, loyaltyCandidate, loyaltyOffer,
  ensureLoyaltyOffer, settleLoyaltyClaim, normalizeLoyalty, contractFlyers, isLoyal } from '../src/systems/loyalty.js';
import { transmissionById } from '../src/systems/transmissions.js';
import { fightingCrew } from '../src/systems/encounterState.js';
import { prepareSession, sessionAction } from '../src/systems/sessionLoop.js';
import { migratePlayer } from '../src/systems/player.js';
import { isWarpcrewPlayer } from '../src/core/progress.js';
import { renderNoticeStrip } from '../src/ui/bridge.js';
import { renderContractBoard } from '../src/ui/contractView.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { defaultTutorialV5 } from '../src/systems/tutorialV5.js';

const now = Date.UTC(2026, 9, 12, 12);
const DEV_WORDS = /\b(tutorial|SKUs?|IAP|placeholder|TODO|level|stat|XP|buff|quest|mission|loyalty|unlock|player|NPC|reward|bonus)\b/i;
const words = text => String(text).split(/\s+/).filter(Boolean).length;
const mercs = CREW_CATALOG.filter(c => !c.id.startsWith('captain_'));
/** A guided captain past the tutorial with Rex aboard. */
const withRex = () => {
  const base = completeFreshTutorial();
  const rex = createCrewInstance('merc_rex');
  return prepareSession({ ...base, tutorial: { ...defaultTutorialV5(), phase: 'done', completed: true }, activeContract: null, activeEncounter: null,
    crew: [...base.crew.filter(m => m.templateId !== 'merc_rex'), rex], wallet: { ...base.wallet, fuel: 10 } }, now);
};

describe('bond writing', () => {
  it('every merc has two scenes, a job and a line, in the rules', () => {
    assert.deepEqual(Object.keys(BONDS).sort(), mercs.map(m => m.id).sort());
    for (const merc of mercs) {
      const bond = BONDS[merc.id];
      const sets = { scene1: bond.scene1, scene2: bond.scene2, briefing: bond.mission.briefing, debrief: bond.mission.debrief };
      assert.equal(bond.scene1.length, 2, `${merc.id} scene1 has two panels`);
      for (const [name, panels] of Object.entries(sets)) {
        assert.ok(panels.length >= 2 && panels.length <= 3, `${merc.id} ${name} has 2-3 panels`);
        for (const panel of panels) {
          assert.ok(panel.speaker === merc.id || panel.speaker === 'captain' || (knownSpeaker(panel.speaker) && !panel.speaker.startsWith('merc_')),
            `${merc.id} ${name}: speaker ${panel.speaker}`);
          assert.ok(words(panel.text) <= 30, `${merc.id} ${name}: over thirty words`);
          assert.doesNotMatch(panel.text, /\d/, `${merc.id} ${name}: numbers in words`);
          assert.doesNotMatch(panel.text, DEV_WORDS, `${merc.id} ${name}: developer words: "${panel.text}"`);
        }
      }
      assert.ok(bond.mission.brief.length <= 60, `${merc.id} card line`);
      assert.ok(NODES[bond.mission.destinationId], `${merc.id} place`);
      assert.ok(['corsairs', 'scrappers', 'swarm', 'ice', 'shades', 'wardens', 'eclipse'].includes(bond.mission.enemy), `${merc.id} enemy`);
      assert.ok(words(bond.bark) <= 12, `${merc.id} line`);
      for (const id of [`bond_${merc.id}_1`, `bond_${merc.id}_2`, `loyal_${merc.id}_brief`, `loyal_${merc.id}_debrief`]) assert.ok(transmissionById(id), id);
    }
  });
});

describe('loyalty rules', () => {
  it('thresholds open the scenes in order, and only for mercs', () => {
    let p = withRex();
    assert.equal(loyaltyLevel(p, 'merc_rex').id, 'new');
    let res = addLoyalty(p, ['merc_rex', 'captain_cyborg'], LOYALTY.trusted);
    assert.deepEqual(res.opened, ['bond_merc_rex_1']);
    assert.equal(res.player.loyalty.points.captain_cyborg, undefined, 'captains have none');
    p = res.player;
    assert.deepEqual(pendingScenes(p), ['bond_merc_rex_1']);
    assert.match(renderNoticeStrip({ ...p, calendar: { cycle: 1, claimed: 1, lastDay: '2026-10-12' } }, now), /data-act="bond-scene" data-id="bond_merc_rex_1"/);
    const played = sessionAction(p, {}, 'bond-scene', { id: 'bond_merc_rex_1' }, { now });
    assert.deepEqual(played.transmissions, ['bond_merc_rex_1']);
    assert.deepEqual(pendingScenes(played.player), []);
    assert.equal(sessionAction(p, {}, 'bond-scene', { id: 'bond_merc_rex_2' }, { now }).ok, false, 'a closed scene cannot be played');
    res = addLoyalty(played.player, ['merc_rex'], 100);
    assert.equal(res.player.loyalty.points.merc_rex, LOYALTY.max, 'capped');
    assert.deepEqual(res.opened, ['bond_merc_rex_2']);
    assert.deepEqual(openedScenes(res.player, 'merc_rex'), ['bond_merc_rex_1', 'bond_merc_rex_2', 'loyal_merc_rex_brief']);
  });

  it('play earns at most two a day per merc, so the loyalty job takes about three weeks', () => {
    let p = withRex();
    for (let n = 0; n < 5; n++) p = addLoyalty(p, ['merc_rex'], LOYALTY.contract, { now }).player;
    assert.equal(p.loyalty.points.merc_rex, LOYALTY.dailyCap, 'five contracts in a day earn the cap');
    p = addLoyalty(p, ['merc_rex'], LOYALTY.away, { now }).player;
    assert.equal(p.loyalty.points.merc_rex, LOYALTY.dailyCap, 'an away team counts towards the same cap');
    p = addLoyalty(p, ['merc_rex'], LOYALTY.contract, { now: now + 86400000 }).player;
    assert.equal(p.loyalty.points.merc_rex, LOYALTY.dailyCap + 1, 'a new day earns again');
    assert.ok(Math.ceil(LOYALTY.mission / LOYALTY.dailyCap) >= 18 && Math.ceil(LOYALTY.mission / LOYALTY.dailyCap) <= 24);
    assert.ok(isWarpcrewPlayer(migratePlayer(p)));
    assert.equal(isWarpcrewPlayer({ ...p, loyalty: { ...p.loyalty, today: { merc_rex: 11 } } }), false);
  });

  it('flyers are the crew aboard, not the captain or the away team', () => {
    const p = withRex();
    const away = { ...p, crew: p.crew.map(m => (m.templateId === 'merc_rex' ? { ...m, status: 'expedition' } : m)) };
    assert.ok(contractFlyers(p).includes('merc_rex'));
    assert.ok(!contractFlyers(away).includes('merc_rex'));
    assert.ok(contractFlyers(p).every(id => !id.startsWith('captain_')));
  });

  it('a ready merc gets a loyalty card with their twist, and winning it makes them Loyal once', () => {
    let p = addLoyalty(withRex(), ['merc_rex'], LOYALTY.mission).player;
    assert.equal(loyaltyCandidate(p), 'merc_rex');
    p = ensureLoyaltyOffer(p);
    const card = p.contractBoard.offers.find(o => o.loyalty);
    assert.equal(card.id, 'offer_loyal_merc_rex_1');
    assert.equal(card.twist.id, ROLE_TWIST.pilot);
    assert.match(renderContractBoard({ offers: [card] }), /Loyalty/);
    const contract = { loyalty: { templateId: 'merc_rex' }, offerId: card.id, result: { success: true } };
    const gems = p.wallet.gems || 0;
    const won = settleLoyaltyClaim(p, contract, ['merc_rex']);
    assert.ok(isLoyal(won.player, 'merc_rex'));
    assert.equal(won.player.wallet.gems, gems + LOYAL_REWARD.gems);
    assert.deepEqual(won.transmissions, ['loyal_merc_rex_debrief']);
    assert.equal(settleLoyaltyClaim(won.player, contract, []).bonus, null, 'never twice');
    assert.equal(ensureLoyaltyOffer(won.player).contractBoard.offers.some(o => o.loyalty), false, 'the card goes');
    const lost = settleLoyaltyClaim(p, { ...contract, result: { success: false } }, ['merc_rex']);
    assert.equal(isLoyal(lost.player, 'merc_rex'), false);
    const forged = settleLoyaltyClaim(p, { ...contract, offerId: 'offer_2026-10-12_risky' }, []);
    assert.equal(forged.bonus, null, 'only the loyalty card counts');
  });

  it('a Loyal merc fights sharper', () => {
    const p = withRex();
    const before = fightingCrew(p, now, { kits: true }).find(m => m.kit === 'merc_rex');
    const loyal = { ...p, loyalty: { points: { merc_rex: 60 }, loyal: ['merc_rex'] } };
    const after = fightingCrew(loyal, now, { kits: true }).find(m => m.kit === 'merc_rex');
    assert.ok(after.grade > before.grade);
    assert.ok(after.bonus >= before.bonus);
  });

  it('the loyalty card falls back to the Spur when their place is still shut', () => {
    const p = addLoyalty(withRex(), ['merc_skarn'], LOYALTY.mission).player;
    const offer = loyaltyOffer(p, 'merc_harrow');
    assert.ok(NODES[offer.destinationId].sector === 'spur' || NODES[offer.destinationId].sector === NODES[BONDS.merc_harrow.mission.destinationId].sector);
  });
});

describe('loyalty saves', () => {
  it('cleans odd records and the validator refuses edits', () => {
    assert.deepEqual(normalizeLoyalty({ points: { merc_rex: 99, captain_cyborg: 5, bogus: 3, merc_jen: -2 }, loyal: ['merc_rex', 'merc_rex', 'x'] }),
      { points: { merc_rex: 60, merc_jen: 0 }, loyal: ['merc_rex'] });
    const p = addLoyalty(withRex(), ['merc_rex'], 12).player;
    assert.ok(isWarpcrewPlayer(migratePlayer(p)));
    assert.equal(isWarpcrewPlayer({ ...p, loyalty: { points: { merc_rex: 12.5 } } }), false);
    assert.equal(isWarpcrewPlayer({ ...p, loyalty: { points: {}, loyal: ['merc_rex', 'merc_rex'] } }), false);
  });
});
