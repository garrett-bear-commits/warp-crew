import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import {
  noteTutorialEvent,
  weekGoals,
  currentTutorialStep,
  defaultTutorial,
  completeTutorial,
} from '../src/systems/tutorial.js';
import { visibleNodes, STORY_BEATS, NODES } from '../src/data/sectors.js';
import { visiblePlanets, PLANETS_V1 } from '../src/systems/expedition.js';
import { storyProgress } from '../src/systems/story.js';

let p = createNewPlayer();
if (p.crewSlots !== 2) throw new Error('start slots');
if (!currentTutorialStep(p)) throw new Error('tutorial should show');

let r = noteTutorialEvent(p, 'travel_success');
p = r.player;
if (p.crewSlots !== 2) throw new Error('travel must not open third berth before combat');
if (!p.tutorial.firstTravel) throw new Error('firstTravel flag');

r = noteTutorialEvent(p, 'combat_done');
p = r.player;
if (p.crewSlots < 3) throw new Error('slot3 after combat');
if (p.tutorial.phase !== 'victory') throw new Error('victory phase after combat');
// hire third
p = { ...p, crew: [...p.crew, { ...p.crew[0], instanceId: 'x3' }] };
r = noteTutorialEvent(p, 'recruited');
p = r.player;
if (!p.tutorial.hiredThird) throw new Error('hiredThird');
p = completeTutorial(p, { registered: false });

r = noteTutorialEvent(p, 'expedition_start');
p = r.player;
r = noteTutorialEvent(p, 'expedition_done');
p = r.player;
if (p.crewSlots < 4) throw new Error('slot4 after exp');

const nodesDay1 = visibleNodes(p);
if (nodesDay1.length < 7) throw new Error('day1 nodes ' + nodesDay1.length);
// force day 5
const old = p.createdAt;
p = { ...p, createdAt: Date.now() - 5 * 86400000 };
const nodesDay5 = visibleNodes(p);
if (nodesDay5.length <= nodesDay1.length) throw new Error('day5 should unlock more nodes');
if (!nodesDay5.find((n) => n.id === 'black_canal')) throw new Error('black_canal day5');

// Veil gated
if (nodesDay5.find((n) => n.id === 'swarm_scar')) throw new Error('veil should be gated');
p = { ...p, flags: { ...p.flags, veil_opened: true }, story: { ...p.story, veilUnlocked: true } };
const veil = visibleNodes(p);
if (!veil.find((n) => n.id === 'swarm_scar')) throw new Error('veil unlock');

const planets = visiblePlanets(p);
if (planets.length < 8) throw new Error('planets day5 ' + planets.length);

const beats = Object.keys(STORY_BEATS).length;
if (beats < 10) throw new Error('story beats ' + beats);

const g = weekGoals(p);
if (g.goals.length !== 4) throw new Error('week goals');

const nodeCount = Object.keys(NODES).length;
if (nodeCount < 18) throw new Error('nodes ' + nodeCount);
if (PLANETS_V1.length < 12) throw new Error('planets total');

// migrate preserves
const m = migratePlayer({ captainName: 'T', crewSlots: 2 });
if (!m.tutorial) throw new Error('migrate tutorial');

console.log('tutorial_week.test.mjs OK', {
  nodes: nodeCount,
  planets: PLANETS_V1.length,
  beats,
  day5nodes: nodesDay5.length,
});
