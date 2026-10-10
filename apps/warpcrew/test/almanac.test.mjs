// The Captain's Almanac (Phase 3 §6): every entry has a way in, the counts are right, the session records crew and
// fights, the screen shows what is open and hides the rest, and the save checks refuse edits.
process.env.TZ = 'UTC';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRANSMISSIONS } from '../src/data/campaign.js';
import { NODES, STORY_BEATS } from '../src/data/sectors.js';
import { CREW_CATALOG, STARTER_CAPTAINS, createCrewInstance } from '../src/data/crewRoster.js';
import { ENCOUNTERS_V1 } from '../src/systems/combat.js';
import { almanacModel, almanacPercent, storyEntries, noteCrew, noteFight, normalizeAlmanac } from '../src/systems/almanac.js';
import { ACHIEVEMENT_BY_ID, achievementGemTotal, ACHIEVEMENT_GEM_BUDGET } from '../src/systems/achievements.js';
import { prepareSession, sessionAction } from '../src/systems/sessionLoop.js';
import { migratePlayer } from '../src/systems/player.js';
import { isWarpcrewPlayer } from '../src/core/progress.js';
import { renderAlmanac, renderAlmanacCard } from '../src/ui/almanacView.js';
import { renderLog } from '../src/ui/bridge.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';

const now = Date.UTC(2026, 9, 12, 12);
const fresh = () => prepareSession({ ...completeFreshTutorial(), activeContract: null, activeEncounter: null }, now);
const MERCS = CREW_CATALOG.filter(c => !STARTER_CAPTAINS.includes(c.id));
/** A captain who has seen, met, fought, visited and found everything. */
function everything() {
  let p = fresh();
  p = { ...p, almanac: { seen: storyEntries().map(e => e.id), crew: MERCS.map(m => m.id) },
    stats: { ...p.stats, visits: Object.fromEntries(Object.keys(NODES).map(id => [id, 1])) },
    flags: { ...p.flags, ...Object.fromEntries(Object.keys(STORY_BEATS).map(id => [id, true])) } };
  for (const encounter of ENCOUNTERS_V1) p = noteFight(p, encounter.id, true);
  return p;
}

describe('almanac contents', () => {
  it('holds every campaign transmission once, in order', () => {
    const ids = storyEntries().map(e => e.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), Object.keys(TRANSMISSIONS).sort());
  });

  it('counts each section and reaches 100% only with everything', () => {
    const model = almanacModel(fresh());
    assert.deepEqual(model.sections.map(s => [s.id, s.total]), [['story', storyEntries().length], ['crew', MERCS.length],
      ['enemies', 7 + ENCOUNTERS_V1.length], ['places', Object.keys(NODES).length], ['discoveries', Object.keys(STORY_BEATS).length]]);
    assert.ok(model.percent < 10, `a new captain starts nearly empty (${model.percent}%)`);
    assert.equal(almanacPercent(everything()), 100);
  });

  it('records crew ever aboard and each fight, once per result', () => {
    let p = fresh();
    p = noteCrew({ ...p, reserve: [createCrewInstance('merc_vex')] });
    assert.ok(p.almanac.crew.includes('merc_vex'));
    p = noteCrew({ ...p, reserve: [] });
    assert.ok(p.almanac.crew.includes('merc_vex'), 'a file stays open after they leave');
    p = noteFight(noteFight(p, 'pirate_scout', true), 'pirate_scout', false);
    assert.deepEqual(p.almanac.enemies.pirate_scout, [1, 1]);
    assert.equal(noteFight(p, 'not_a_ship', true), p);
    const model = almanacModel(p);
    assert.equal(model.sections.find(s => s.id === 'enemies').factions.find(f => f.id === 'corsairs').open, true);
  });

  it('the session keeps the crew record up to date, and a UI-only tap writes nothing', () => {
    const p = prepareSession({ ...fresh(), reserve: [createCrewInstance('merc_isa')] }, now);
    assert.ok(p.almanac.crew.includes('merc_isa'));
    assert.deepEqual(sessionAction(p, {}, 'map-select', { node: 'lane_a' }, { now }).player, p);
  });

  it('the Archivist line reads the Almanac and keeps achievement gems in budget', () => {
    assert.equal(ACHIEVEMENT_BY_ID.archivist.read(everything()), 100);
    assert.ok(achievementGemTotal() <= ACHIEVEMENT_GEM_BUDGET);
  });
});

describe('almanac screen', () => {
  it('shows what is open and hides the rest', () => {
    const p = noteFight(noteCrew({ ...fresh(), reserve: [createCrewInstance('merc_vex')] }), 'veil_wraith', false);
    const crew = renderAlmanac(p, 'crew');
    assert.match(crew, /Vex/);
    assert.match(crew, /answers the hiring beacon/);
    const enemies = renderAlmanac(p, 'enemies');
    assert.match(enemies, /Their trick/);
    assert.match(enemies, /0 won · 1 lost/);
    assert.match(renderAlmanac(p, 'story'), /\?\?\?/);
    assert.match(renderAlmanac(everything(), 'story'), /data-act="tx-replay"/);
    assert.match(renderAlmanacCard(p), /data-act="almanac-open"/);
    assert.match(renderLog(p, [], { goals: [] }), /Captain's Almanac/);
  });
});

describe('almanac saves', () => {
  it('cleans odd records and the validator refuses edits', () => {
    assert.deepEqual(normalizeAlmanac({ seen: ['c1_open', 'x'], crew: ['merc_rex', 'merc_rex', 'captain_cyborg'], enemies: { pirate_scout: [2, -1], bogus: [1, 1] } }),
      { seen: ['c1_open'], crew: ['merc_rex'], enemies: { pirate_scout: [2, 0] } });
    const p = everything();
    assert.ok(isWarpcrewPlayer(migratePlayer(p)));
    assert.equal(isWarpcrewPlayer({ ...p, almanac: { ...p.almanac, enemies: { pirate_scout: [1] } } }), false);
    assert.equal(isWarpcrewPlayer({ ...p, almanac: { ...p.almanac, crew: ['merc_rex', 'merc_rex'] } }), false);
  });
});
