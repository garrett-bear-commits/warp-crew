import { createNewPlayer } from '../src/systems/player.js';
import { buyHull, upgradeSystem } from '../src/systems/hangar.js';
import { applyStoryFlag, storyProgress } from '../src/systems/story.js';
import { CREW_CATALOG } from '../src/data/crewRoster.js';
import { NODES } from '../src/data/sectors.js';
import { pullMerc } from '../src/systems/gacha.js';

if (CREW_CATALOG.length < 20) throw new Error('expected expanded crew');
if (Object.keys(NODES).length < 10) throw new Error('expected expanded nodes');

let p = createNewPlayer();
p = { ...p, wallet: { ...p.wallet, gems: 1000, credits: 20000 } };

const r = buyHull(p, 'corvette', 'gems');
if (!r.ok) throw new Error('corvette buy ' + r.reason);
if (r.player.crewSlots < 6) throw new Error('corvette slots');
if (!r.player.ship.ownedHulls.includes('corvette')) throw new Error('owned');

const up = upgradeSystem(r.player, 'shields');
if (!up.ok) throw new Error('upgrade ' + up.reason);

const st = applyStoryFlag(up.player, 'veil_opened');
if (!st.player.story.veilUnlocked) throw new Error('veil flag');
const prog = storyProgress(st.player);
if (prog.done < 1) throw new Error('story progress');

const pull = pullMerc({ reputation: 0, rng: () => 0.01 });
if (!pull.instance?.name) throw new Error('gacha');

console.log('phase_c.test.mjs OK', CREW_CATALOG.length, 'mercs', Object.keys(NODES).length, 'nodes');
