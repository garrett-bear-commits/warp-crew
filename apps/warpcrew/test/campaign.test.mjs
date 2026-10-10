// The campaign (Phase 3 §1-2): content rules, the unlock order, walls as chapter bosses, chapter rewards, story
// claims, the transmission player and the save checks.
process.env.TZ = 'UTC';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, MISSIONS, TRANSMISSIONS } from '../src/data/campaign.js';
import { knownSpeaker, fillStoryText, hullId, speakerFor } from '../src/data/speakers.js';
import { NODES } from '../src/data/sectors.js';
import { catalogById } from '../src/data/crewRoster.js';
import { encounterById } from '../src/systems/combat.js';
import { campaignState, ensureStoryOffer, normalizeCampaign, validCampaign, settleStoryClaim, settleChapters, reviewTransmissions,
  campaignAllowsWall, storyOffer } from '../src/systems/campaign.js';
import { currentWall, WALL_BY_ID } from '../src/systems/walls.js';
import { prepareSession, sessionAction } from '../src/systems/sessionLoop.js';
import { migratePlayer } from '../src/systems/player.js';
import { isWarpcrewPlayer } from '../src/core/progress.js';
import { renderTransmission } from '../src/ui/transmission.js';
import { renderContractBoard } from '../src/ui/contractView.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { defaultTutorialV5 } from '../src/systems/tutorialV5.js';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 12, 12);
const DEV_WORDS = /\b(tutorial|SKUs?|IAP|placeholder|TODO|level|XP|quest|mission|loyalty|unlock|player|NPC|reward|bonus)\b/i;
const words = text => String(text).split(/\s+/).filter(Boolean).length;
/** A guided captain just past the tutorial (walls apply), docked, with fuel; `script: 3` for one without walls. */
const fresh = ({ script = 5 } = {}) => {
  const base = completeFreshTutorial();
  const tutorial = script === 5 ? { ...defaultTutorialV5(), phase: 'done', completed: true } : base.tutorial;
  return prepareSession({ ...base, tutorial, activeContract: null, activeEncounter: null, wallet: { ...base.wallet, fuel: 10 } }, now);
};
const won = (player, missionId) => settleStoryClaim(player, { story: { id: missionId }, offerId: `offer_story_${missionId}_1`, result: { success: true } }).player;
const ordinary = player => settleStoryClaim(player, { offerId: 'offer_2026-10-12_reliable', result: { success: true } }).player;
const chapterDone = (player, n) => CHAPTERS[n - 1].missions.reduce((p, id) => ordinary(won(p, id)), player);

describe('campaign content', () => {
  it('every transmission is short, in known voices and in words', () => {
    for (const [id, tx] of Object.entries(TRANSMISSIONS)) {
      assert.ok(tx.panels.length >= 1 && tx.panels.length <= 4, `${id} has 1-4 panels`);
      for (const panel of tx.panels) {
        assert.ok(knownSpeaker(panel.speaker), `${id}: unknown speaker ${panel.speaker}`);
        assert.ok(words(panel.text) <= 30, `${id}: panel over thirty words: "${panel.text}"`);
        assert.doesNotMatch(panel.text.replace(/\{[a-z]+\}/g, ''), /\d/, `${id}: numbers in words: "${panel.text}"`);
        assert.doesNotMatch(panel.text, DEV_WORDS, `${id}: developer words: "${panel.text}"`);
      }
    }
  });

  it('chapters, missions, places, enemies and recruits all exist', () => {
    const used = new Set();
    for (const chapter of CHAPTERS) {
      assert.equal(chapter.missions.length, 5, `chapter ${chapter.n} has five missions`);
      assert.ok(WALL_BY_ID[chapter.wall], `chapter ${chapter.n} boss is a wall`);
      assert.ok(catalogById(chapter.recruit), `chapter ${chapter.n} recruit exists`);
      for (const tx of [chapter.open, chapter.bossIntro, chapter.bossFall]) assert.ok(TRANSMISSIONS[tx], `${tx} exists`);
      for (const id of chapter.missions) {
        const mission = MISSIONS[id];
        assert.equal(mission.chapter, chapter.n);
        assert.ok(NODES[mission.destinationId], `${id} destination`);
        assert.equal(encounterById(mission.encounterId).id, mission.encounterId, `${id} encounter`);
        assert.ok(TRANSMISSIONS[mission.briefing] && TRANSMISSIONS[mission.debrief], `${id} briefing and debrief`);
        assert.ok(knownSpeaker(mission.client), `${id} client`);
        assert.ok(mission.brief.length <= 60, `${id} card line is short`);
        used.add(mission.briefing).add(mission.debrief);
      }
      used.add(chapter.open).add(chapter.bossIntro).add(chapter.bossFall);
      if (chapter.next) used.add(chapter.next);
    }
    assert.equal(Object.keys(MISSIONS).length, 10);
    assert.deepEqual(Object.keys(TRANSMISSIONS).filter(id => !used.has(id)), [], 'every transmission is played somewhere');
    assert.equal(Object.values(MISSIONS).reduce((n, m) => n + (m.rewards.gems || 0), 0), 150, 'chapters 1-2 pay 150 gems');
  });
});

describe('campaign order', () => {
  it('opens the first mission straight after the tutorial, then waits one ordinary contract each time', () => {
    let p = fresh();
    assert.equal(campaignState(p).missionId, 'c1_first_job');
    assert.equal(p.contractBoard.offers[0].id, 'offer_story_c1_first_job_1', 'the story card is first on the board');
    assert.equal(p.contractBoard.offers.filter(o => !o.story).length, 3, 'three daily offers as before');
    p = won(p, 'c1_first_job');
    assert.deepEqual([campaignState(p).missionId, campaignState(p).waiting], [null, 'contract']);
    assert.equal(ensureStoryOffer(p, now).contractBoard.offers.some(o => o.story), false, 'no story card while it waits');
    p = ordinary(p);
    assert.equal(campaignState(p).missionId, 'c1_big_mabel');
    assert.equal(ensureStoryOffer(p, now).contractBoard.offers[0].story.id, 'c1_big_mabel');
  });

  it('a lost mission stays open, and a retry gets a new card', () => {
    let p = fresh();
    p = settleStoryClaim(p, { story: { id: 'c1_first_job' }, offerId: 'offer_story_c1_first_job_1', result: { success: false } }).player;
    assert.equal(campaignState(p).missionId, 'c1_first_job');
    p = { ...p, contractBoard: { ...p.contractBoard, completedOfferIds: [...p.contractBoard.completedOfferIds, 'offer_story_c1_first_job_1'] } };
    assert.equal(storyOffer(p, 'c1_first_job').id, 'offer_story_c1_first_job_2');
  });

  it('a non-story contract with a story tag pays nothing extra', () => {
    const p = fresh();
    const res = settleStoryClaim(p, { story: { id: 'c1_first_job' }, offerId: 'offer_2026-10-12_risky', result: { success: true } });
    assert.equal(res.bonus, null);
    assert.equal(normalizeCampaign(res.player.campaign).done.length, 0);
  });

  it('chapter 2 waits for the Veil, and the Spur wall waits for chapter 1', () => {
    const later = now + 5 * DAY;
    let p = fresh();
    assert.equal(campaignAllowsWall(p, WALL_BY_ID.spur), false);
    assert.equal(currentWall(p, later), null, 'no boss before the story missions');
    p = chapterDone(p, 1);
    assert.equal(campaignAllowsWall(p, WALL_BY_ID.spur), true);
    assert.equal(campaignState(p).waiting, 'boss');
    assert.equal(campaignAllowsWall(p, WALL_BY_ID.ember), true, 'walls without a chapter are unchanged');
  });
});

describe('chapter completion', () => {
  it('the boss falling opens the gate, a named merc joins and the finale plays, once', () => {
    let p = chapterDone(fresh(), 1);
    p = { ...p, flags: { ...p.flags, wall_spur: true } };
    const done = settleChapters(p, now);
    assert.deepEqual(done.transmissions, ['c1_boss_fall', 'c2_open']);
    assert.equal(done.recruits[0].templateId, 'merc_kal');
    assert.ok([...done.player.crew, ...done.player.reserve].some(m => m.templateId === 'merc_kal'));
    assert.equal(done.player.flags.veil_opened, true, 'the Veil Gate opens');
    assert.equal(campaignState(done.player).missionId, 'c2_past_the_gate', 'chapter 2 starts at once');
    assert.equal(settleChapters(done.player, now).transmissions.length, 0, 'never twice');
    assert.equal(settleChapters(p, now).recruits[0].instanceId, done.recruits[0].instanceId, 'the recruit is seeded: a replay names the same crew member');
  });

  it('captains without walls finish a chapter when its gate opens', () => {
    let p = chapterDone(fresh({ script: 3 }), 1);
    assert.equal(settleChapters(p, now).transmissions.length, 0);
    p = { ...p, flags: { ...p.flags, veil_opened: true }, story: { ...p.story, veilUnlocked: true } };
    assert.deepEqual(settleChapters(p, now).transmissions, ['c1_boss_fall', 'c2_open']);
  });

  it('chapter 2 ends with Wisp and the Ember teaser', () => {
    let p = chapterDone(fresh(), 1);
    p = settleChapters({ ...p, flags: { ...p.flags, wall_spur: true } }, now).player;
    p = chapterDone(p, 2);
    const done = settleChapters({ ...p, flags: { ...p.flags, wall_veil: true } }, now);
    assert.deepEqual(done.transmissions, ['c2_boss_fall', 'c3_tease']);
    assert.equal(done.recruits[0].templateId, 'merc_wisp');
    assert.equal(campaignState(done.player).complete, true);
  });
});

describe('story in the session', () => {
  it('a story card plays its briefing once, and the review offers a replay', () => {
    let p = fresh();
    const offer = p.contractBoard.offers[0];
    let r = sessionAction(p, {}, 'contract-review', { offer: offer.id }, { now });
    assert.deepEqual(r.transmissions, ['c1_open', 'c1m1_brief']);
    assert.deepEqual(r.player.almanac.seen, ['c1_open', 'c1m1_brief']);
    r = sessionAction(r.player, {}, 'contract-review', { offer: offer.id }, { now });
    assert.deepEqual(r.transmissions, []);
    assert.deepEqual(reviewTransmissions(r.player, offer), []);
    const accepted = sessionAction(r.player, r.ui, 'contract-accept', { offer: offer.id }, { now });
    assert.deepEqual(accepted.player.activeContract.story, { id: 'c1_first_job', chapter: 1 });
  });

  it('claiming a won story mission pays its bonus and plays the debrief', () => {
    let p = fresh();
    const offer = p.contractBoard.offers[0];
    p = sessionAction(p, {}, 'contract-accept', { offer: offer.id }, { now }).player;
    const rewards = { credits: 40, medals: 3, reputation: 1, gems: 0, fuel: 0 };
    p = { ...p, activeContract: { ...p.activeContract, stage: 'return', result: { success: true, rewards, hullLoss: 0, injuredCrewId: null, storyFlag: null, summary: 'Done.' } } };
    const gems = p.wallet.gems || 0;
    const r = sessionAction(p, {}, 'contract-claim', { revision: p.activeContract.revision, acceptanceId: p.activeContract.acceptanceId }, { now });
    assert.ok(r.ok, r.reason);
    assert.deepEqual(r.transmissions, ['c1m1_debrief']);
    assert.equal(r.player.wallet.gems, gems + MISSIONS.c1_first_job.rewards.gems);
    assert.equal(r.effect.source, 'story');
    assert.deepEqual(normalizeCampaign(r.player.campaign).done, ['c1_first_job']);
  });
});

describe('transmission player and card', () => {
  it('fills the tokens, names the speaker and escapes text', () => {
    const p = fresh();
    const html = renderTransmission({ id: 'x', panels: [{ speaker: 'choir', text: '{hullidrev} <b>' }] }, p);
    assert.match(html, /Unknown signal/);
    assert.ok(html.includes([...hullId(p)].reverse().join('')));
    assert.ok(html.includes('&lt;b&gt;') && !html.includes('<span style="--w:1"><b>'), 'story text is escaped');
    assert.match(fillStoryText('{ship} {hullid}', p), /^\S+ WC-\d{4}$/);
    assert.equal(speakerFor('merc_kal', p).name, 'Kal Vesper');
    assert.equal(renderTransmission(null, p), '');
  });

  it('the story card shows its client, set piece and story pay', () => {
    const p = ordinary(won(fresh(), 'c1_first_job'));
    const offer = storyOffer(p, 'c1_big_mabel');
    const html = renderContractBoard({ offers: [offer] });
    assert.match(html, /Story · Chapter 1/);
    assert.match(html, /Moro Fenn/);
    assert.match(html, /data-twist="escort"/);
    assert.match(html, /Story pay on a win/);
  });
});

describe('transmission wiring', () => {
  it('main.js queues every published transmission, with or without an effect (phone QA 2026-10-10)', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const publish = main.slice(main.indexOf('publish: (result) => {'), main.indexOf('capture: captureEvent'));
    assert.match(publish, /for \(const id of result\.transmissions \|\| \[\]\) showTransmission\(id\);/);
    assert.ok(publish.indexOf('showTransmission') < publish.indexOf('publishSessionResult(result)'), 'queued before the render');
  });
});

describe('campaign saves', () => {
  it('migrates, cleans and refuses edited values', () => {
    const p = won(fresh(), 'c1_first_job');
    assert.ok(isWarpcrewPlayer(migratePlayer(p)));
    assert.deepEqual(normalizeCampaign({ done: ['c1_big_mabel', 'nope', 'c1_first_job', 'c1_first_job'], since: -4 }), { done: ['c1_first_job', 'c1_big_mabel'], since: 0, chapters: [] });
    assert.equal(validCampaign({ done: ['c1_first_job', 'c1_first_job'], since: 0 }), false);
    assert.equal(isWarpcrewPlayer({ ...p, campaign: { done: ['x'], since: 1000 } }), false);
    assert.equal(isWarpcrewPlayer({ ...p, campaign: { done: ['a', 'a'], since: 1 } }), false);
    assert.equal(isWarpcrewPlayer({ ...p, almanac: { seen: 'c1_open' } }), false);
    assert.equal(isWarpcrewPlayer({ ...p, loyalty: { points: { merc_rex: 61 } } }), false);
    assert.equal(isWarpcrewPlayer({ ...p, loyalty: { points: { merc_rex: 12 }, loyal: ['merc_rex'] } }), true);
    const odd = migratePlayer({ ...p, campaign: { done: 'all', since: 'x' }, almanac: { seen: ['c1_open', 'bogus', 'c1_open'] } });
    assert.deepEqual([odd.campaign, odd.almanac.seen], [{ done: [], since: 0, chapters: [] }, ['c1_open']]);
  });
});
