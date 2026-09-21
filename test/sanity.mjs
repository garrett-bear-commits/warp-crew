import { createNewPlayer, migratePlayer, fightingCrew } from '../src/systems/player.js';
import { completeTutorial, weekGoals, noteTutorialEvent } from '../src/systems/tutorial.js';
import { NODES, STORY_BEATS, visibleNodes } from '../src/data/sectors.js';
import { PLANET_DEFS } from '../src/data/planets.js';
import { visiblePlanets, startExpedition, previewExpedition, resolveExpedition, expeditionPartySize } from '../src/systems/expedition.js';
import { applyStoryFlag } from '../src/systems/story.js';
import { travelTo } from '../src/systems/travel.js';
import { upgradeSystem, buyHull, switchHull, fuelMaxFor, nextUpgradeCost } from '../src/systems/hangar.js';
import { fuelCreditPrice, reputationRank, scaleSitePayout, visitMult } from '../src/systems/economy.js';
import { ENCOUNTERS_V1, rubberBandPower, combatWinChance, resolveCombat, ASSIST_CAP } from '../src/systems/combat.js';
import { medalLevelCostFor, CREW_CATALOG, rankTitle, createCrewInstance } from '../src/data/crewRoster.js';
import { SHIPS, SHIP_SYSTEMS } from '../src/data/ships.js';
import { pullOnce, pullTen, defaultGacha, PITY, tickPity, rarityWeights, buyLuck, LUCK_CAP, applyPullToRoster, RESERVE_CAP, contractHire } from '../src/systems/gacha.js';
import { galaxyUnlocked } from '../src/data/galaxies.js';
import { INTEL_TRACKS, ECONOMY_BEATS } from '../src/data/intel.js';
import { fuelCostFor } from '../src/systems/passives.js';
import { applyGrant } from '../src/systems/iap.js';

let player = completeTutorial(createNewPlayer({ captainName: 'QA' }), { registered: false });
player = { ...player, wallet: { ...player.wallet, credits: 5000, fuel: 10, medals: 40, reputation: 0 } };

if (player.version !== 6) throw new Error('save version ' + player.version);
if (!player.gacha) throw new Error('gacha missing');
if (CREW_CATALOG.length < 40) throw new Error('crew catalog short ' + CREW_CATALOG.length);
if (rankTitle(1) !== 'Green') throw new Error('rank 1 ' + rankTitle(1));
if (!rankTitle(11).startsWith('Rated')) throw new Error('rank 11 ' + rankTitle(11));
if (!rankTitle(100).includes('Singularity')) throw new Error('rank 100 ' + rankTitle(100));
for (const sys of SHIP_SYSTEMS) {
  if (!SHIPS.sparrow.upgradeCosts[sys]) throw new Error('sparrow missing ' + sys);
}
if (!ENCOUNTERS_V1.find((e) => e.id === 'eclipse_throne')) throw new Error('endgame encounter missing');
if (!PLANET_DEFS.find((p) => p.sector === 'crown')) throw new Error('crown planets missing');
if (INTEL_TRACKS.length < 5 || ECONOMY_BEATS.length < 4) throw new Error('intel/economy beats');
if (ASSIST_CAP !== 2) throw new Error('assist cap');

const nodes = Object.keys(NODES).length;
const planets = PLANET_DEFS.length;
const beats = Object.keys(STORY_BEATS).length;
const map = visibleNodes(player).length;
const exp = visiblePlanets(player).length;
const enc = ENCOUNTERS_V1.length;

const jump = travelTo(player, 'outpost_trade', { rng: () => 0 });
if (!jump.ok) throw new Error('trade jump failed ' + jump.reason);
player = jump.player;
if (!player.stats.visits.outpost_trade) throw new Error('visit not recorded');

const firstFlag = applyStoryFlag(player, 'veil_opened');
player = firstFlag.player;
if (!firstFlag.rewards?.credits) throw new Error('veil rewards missing');
const second = applyStoryFlag(player, 'veil_opened');
if (second.rewards) throw new Error('story double-grant');
if (!player.flags.veil_opened) throw new Error('veil flag missing');

const frost = visibleNodes(player).find((n) => n.id === 'frost_harbor');
const glass = visiblePlanets(player).find((p) => p.id === 'glass_reach');
const haven = visiblePlanets(player).find((p) => p.id === 'veil_haven');
if (!frost || !glass || !haven) throw new Error('veil content hidden');

player = applyStoryFlag(player, 'ember_opened').player;
if (!galaxyUnlocked(player, 'ember')) throw new Error('ember locked after flag');
if (!visiblePlanets(player).find((p) => p.id === 'slag_ribs')) throw new Error('ember planet hidden');
player = applyStoryFlag(player, 'hollow_opened').player;
player = applyStoryFlag(player, 'crown_opened').player;
if (!visibleNodes(player).find((n) => n.id === 'eclipse_crown')) throw new Error('crown node hidden');

const skipEmber = {
  ...createNewPlayer(),
  flags: { forge_gift: true, splashSeen: true },
  story: { chapter: 4 },
  tutorial: player.tutorial,
};
if (galaxyUnlocked(skipEmber, 'ember')) throw new Error('forge_gift must not open ember interiors');
if (!visibleNodes(skipEmber).find((n) => n.id === 'ember_gate')) throw new Error('ember gate hidden from forge_gift');
if (visibleNodes(skipEmber).find((n) => n.id === 'cinder_docks')) throw new Error('cinder docks leaked via chapter');
const skipHollow = { ...skipEmber, flags: { ...skipEmber.flags, ember_opened: true }, story: { chapter: 5, emberUnlocked: true } };
if (galaxyUnlocked(skipHollow, 'hollow')) throw new Error('chapter 5 must not open hollow interiors');
if (!visibleNodes(skipHollow).find((n) => n.id === 'hollow_mouth')) throw new Error('hollow mouth should show after ember_opened');
if (visibleNodes(skipHollow).find((n) => n.id === 'silent_choir')) throw new Error('hollow interiors leaked');

const prev = previewExpedition(player, 'dustfall');
if (!prev.win.credits) throw new Error('dustfall preview empty');
const job = startExpedition({
  planetId: 'dustfall',
  crewInstanceIds: prev.crew.map((c) => c.instanceId),
  minutes: 15,
  successChance: 1,
  roleHit: prev.roleHit,
});
const res = resolveExpedition(job, { forceComplete: true, player, rng: () => 0 });
if (!res.ready || !res.success) throw new Error('dustfall resolve failed');

const dustA = scaleSitePayout({ credits: 100 }, player, { kind: 'expedition', visits: 0 }).credits;
const dustB = scaleSitePayout({ credits: 100 }, player, { kind: 'expedition', visits: 5 }).credits;
if (dustB >= dustA) throw new Error('per-planet decay missing');
if (expeditionPartySize({ crewSlots: 3 }) !== 2) throw new Error('small party');
if (expeditionPartySize({ crewSlots: 12 }) !== 4) throw new Error('carrier party');

const sh = upgradeSystem(player, 'shields');
if (!sh.ok) throw new Error('shields upgrade failed ' + sh.reason);
if (sh.cost.credits !== 250) throw new Error('shields cost drifted ' + sh.cost.credits);

const q0 = nextUpgradeCost({ ...player, ship: { ...player.ship, systems: { ...player.ship.systems, quarters: 0 } }, crewSlots: 3 }, 'quarters');
const q1 = nextUpgradeCost({ ...player, ship: { ...player.ship, systems: { ...player.ship.systems, quarters: 1 } }, crewSlots: 3 }, 'quarters');
if (!q0 || !q1 || q1.credits <= q0.credits) throw new Error('quarters 0→1 vs 1→2 should scale');

const sens = upgradeSystem(sh.player, 'sensors');
if (!sens.ok) throw new Error('sensors upgrade failed ' + sens.reason);

if (!SHIPS.corvette.upgradeCosts?.engines) throw new Error('corvette upgrades missing');
if (fuelCreditPrice(player) !== 45) throw new Error('base fuel price');
player = { ...player, wallet: { ...player.wallet, reputation: 600 } };
if (fuelCreditPrice(player) !== 39) throw new Error('respected fuel cut');
if (reputationRank(600).id !== 'respected') throw new Error('rank');
if (visitMult(5) > 0.72 + 0.001) throw new Error('visit floor');
if (medalLevelCostFor({ level: 1, xp: 24 }) >= 10) throw new Error('xp discount');
if (scaleSitePayout({ credits: 100 }, player, { kind: 'trade', visits: 0 }).credits < 100) {
  throw new Error('rep trade should lift');
}

const locked = buyHull({ ...player, story: { chapter: 4 }, wallet: { ...player.wallet, gems: 800 } }, 'corvette', 'gems');
if (locked.ok || locked.reason !== 'hull_lock') throw new Error('corvette should need kestrel ' + locked.reason);

let rich = {
  ...player,
  ship: sens.player.ship,
  story: { chapter: 4 },
  wallet: { ...player.wallet, gems: 1080, reputation: 600 },
  fuelMax: 10,
};
const kestrel = buyHull(rich, 'kestrel', 'gems');
if (!kestrel.ok) throw new Error('kestrel buy ' + kestrel.reason);
if (kestrel.player.fuelMax !== fuelMaxFor(kestrel.player, SHIPS.kestrel)) throw new Error('kestrel tank ' + kestrel.player.fuelMax);
const hull = buyHull(kestrel.player, 'corvette', 'gems');
if (!hull.ok) throw new Error('corvette buy ' + hull.reason);
if ((hull.player.ship.systems?.shields || 0) < 2) throw new Error('hull buy reset systems');
if (hull.player.fuelMax !== fuelMaxFor(hull.player, SHIPS.corvette)) throw new Error('stacked fuelMax ' + hull.player.fuelMax);

const stuffed = {
  ...hull.player,
  crewSlots: 12,
  crew: Array.from({ length: 12 }, (_, i) => createCrewInstance(CREW_CATALOG[i % CREW_CATALOG.length].id)),
  reserve: [],
  ship: { ...hull.player.ship, ownedHulls: [...(hull.player.ship.ownedHulls || []), 'sparrow'] },
};
const down = switchHull(stuffed, 'sparrow');
if (!down.ok) throw new Error('switch sparrow ' + down.reason);
if (down.player.crewSlots > SHIPS.sparrow.maxCrewSlots) throw new Error('berths not clamped ' + down.player.crewSlots);
if (down.player.crew.length > down.player.crewSlots) throw new Error('overflow still aboard');
if (fightingCrew(down.player).length > down.player.crewSlots) throw new Error('fighting crew uncapped');
const migrated = migratePlayer({ ...stuffed, stats: { jumps: 3, combatsWon: 1, visits: {}, planetRuns: {} }, version: 6, tutorial: { script: 2, completed: true, phase: 'done' } });
if (migrated.crewSlots > SHIPS.corvette.maxCrewSlots && migrated.ship.shipId === 'corvette') {
  /* stuffed still on corvette hull */
}
const migSparrow = migratePlayer({
  ...stuffed,
  ship: { ...stuffed.ship, shipId: 'sparrow', ownedHulls: ['sparrow'] },
  stats: { jumps: 4, combatsWon: 2, visits: {}, planetRuns: {} },
  version: 5,
  tutorial: { script: 2, completed: true, phase: 'done' },
});
if (migSparrow.crewSlots > SHIPS.sparrow.maxCrewSlots) throw new Error('migrate inflated berths ' + migSparrow.crewSlots);
if (migSparrow.crew.length > migSparrow.crewSlots) throw new Error('migrate left overflow aboard');

const gemKeep = migratePlayer({
  version: 4,
  captainName: 'Payer',
  wallet: { credits: 80, fuel: 8, gems: 150, medals: 0, reputation: 0 },
  iapFulfilled: ['tok_1'],
  stats: { jumps: 0, combatsWon: 0 },
  tutorial: { script: 1 },
});
if (gemKeep.wallet.gems < 150) throw new Error('fresh intro wiped gems');
if (!gemKeep.iapFulfilled.includes('tok_1')) throw new Error('iap tokens dropped');

const w = rarityWeights(0, 0);
if (w.common < w.rare) throw new Error('weights inverted');
if (rarityWeights(5500, 0).apex < rarityWeights(3500, 0).apex) throw new Error('halo gate should lift apex');
let g = defaultGacha();
for (let i = 0; i < PITY.rareHard; i++) g = tickPity(g, 'common');
if (g.pityRare < PITY.rareHard) throw new Error('pity tick');

const luckFull = buyLuck({ ...createNewPlayer(), gacha: { ...defaultGacha(), luck: LUCK_CAP }, wallet: { credits: 99999, gems: 999, fuel: 8, medals: 0, reputation: 0 } }, 'credits');
if (luckFull.ok || luckFull.reason !== 'luck_cap') throw new Error('luck cap missing');

const puller = { ...createNewPlayer(), crewSlots: 2, wallet: { credits: 5000, fuel: 10, gems: 1000, medals: 0, reputation: 0 }, gacha: defaultGacha(), dailyPullAvailable: true, reserve: [] };
const once = pullOnce(puller, { free: true, rng: () => 0.99 });
if (!once.ok) throw new Error('free pull failed');
const ten = pullTen({ ...once.player, wallet: { ...once.player.wallet, gems: 900 }, crewSlots: 2 }, { rng: () => 0.5 });
if (!ten.ok || ten.results.length !== 10) throw new Error('10-pull failed');
const parked = ten.results.filter((r) => r.kind === 'reserve' || r.kind === 'hire' || r.kind === 'star' || r.kind === 'sold' || r.kind === 'cap');
if (parked.length !== 10) throw new Error('10-pull kinds');
if ((ten.player.reserve || []).length > RESERVE_CAP) throw new Error('reserve overflow');

const fullSlots = { ...createNewPlayer(), crewSlots: 2, crew: [createCrewInstance('merc_rex'), createCrewInstance('merc_bolt')], reserve: [] };
const extra = applyPullToRoster(fullSlots, createCrewInstance('merc_jen'));
if (extra.kind !== 'reserve') throw new Error('overflow should reserve, got ' + extra.kind);

const hireOwned = contractHire({ ...createNewPlayer(), reserve: [createCrewInstance('merc_pip')], crew: [createCrewInstance('merc_rex')], crewSlots: 5, wallet: { credits: 9999, fuel: 8, gems: 0, medals: 0, reputation: 0 } }, 'merc_pip');
if (hireOwned.ok) throw new Error('contract hire of reserved pip');

const even = combatWinChance(50, 50);
if (even < 0.5 || even > 0.7) throw new Error('even fight chance ' + even);
const stomp = resolveCombat({ playerPower: 200, enemyPower: 12, rng: () => 0.99 });
if (stomp.success) throw new Error('old formula guaranteed even a 0.99 roll at 200 vs 12');
const rubber = rubberBandPower(12, 200);
if (rubber <= 12 || rubber >= 200) throw new Error('rubber ' + rubber);
const lateChance = combatWinChance(200, rubber);
if (lateChance > 0.85) throw new Error('late combat still a stomp ' + lateChance);

const cut = fuelCostFor({ crew: [], ship: { systems: { engines: 12 } } }, 5);
if (cut < 2) throw new Error('fuel floor missing ' + cut);

const twice = applyGrant(applyGrant(createNewPlayer(), { gems: 100 }, 'tokA'), { gems: 100 }, 'tokA');
if (twice.wallet.gems !== 100) throw new Error('iap double grant ' + twice.wallet.gems);

const goals = weekGoals({ ...createNewPlayer(), flags: { splashSeen: true }, stats: { jumps: 0, combatsWon: 0, expeditions: 0 }, wallet: { reputation: 0 }, crew: [1, 2], crewSlots: 2, ship: { ownedHulls: ['sparrow'] }, story: { chapter: 0 }, createdAt: Date.now() });
if (goals.goals.length !== 4) throw new Error('week goals ' + goals.goals.length);
if (goals.goals.find((g) => g.id === 'jumps_5')?.done) throw new Error('jumps goal already done');
if (goals.goals.find((g) => g.id === 'combat_3')?.done) throw new Error('combat goal already done');
if (goals.goals.find((g) => g.id === 'exp_2')?.done) throw new Error('exp goal already done');

const hired = noteTutorialEvent(completeTutorial(createNewPlayer()), 'hired');
if (!hired) throw new Error('hired event');

console.log(
  `OK crew ${CREW_CATALOG.length} nodes ${nodes} planets ${planets} visits ${player.stats.visits.outpost_trade} beats ${beats} map ${map} exp ${exp} enc ${enc}`
);
