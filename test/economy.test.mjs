import { canAfford, pay, grant } from '../src/systems/economy.js';
import { pullMerc, rarityWeights } from '../src/systems/gacha.js';
import { resolveCombat } from '../src/systems/combat.js';
import { expeditionSuccessChance } from '../src/systems/expedition.js';

const w = { credits: 100, gems: 0 };
if (!canAfford(w, { credits: 50 })) throw new Error('afford');
const paid = pay(w, { credits: 40 });
if (paid.wallet.credits !== 60) throw new Error('pay');
const g = grant(paid.wallet, { medals: 5 });
if (g.medals !== 5) throw new Error('grant');

const pull = pullMerc({ reputation: 0, rng: () => 0.99 });
if (!pull.instance?.name) throw new Error('pull');

const weights = rarityWeights(0);
if (weights.common < weights.legendary) throw new Error('weights inverted');

const combat = resolveCombat({ playerPower: 100, enemyPower: 20, assistsUsed: ['overcharge'], rng: () => 0.5 });
if (!combat.success) throw new Error('expected win');

const chance = expeditionSuccessChance({ crewPower: 50, planetDifficulty: 40 });
if (chance <= 0.05 || chance >= 0.95) throw new Error('chance bounds');

console.log('economy.test.mjs OK');
