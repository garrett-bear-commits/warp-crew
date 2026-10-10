// The reward reveal (Phase 2 design §1): one screen for everything earned, sized by the reward.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { walletGain, rewardItems, rewardTier, rewardEntry, renderRewardReveal, centreCards, productArt, TIER_SOUNDS, TIERS } from '../src/ui/rewardReveal.js';
import { PRODUCT_DEFS } from '../src/systems/iap.js';
import { WALLS } from '../src/systems/walls.js';
import { wallPackSku } from '../src/systems/offers.js';

// Only what went up counts; spends and other bookkeeping are ignored.
assert.deepEqual(walletGain({ gems: 10, credits: 500, fuel: 4 }, { gems: 110, credits: 450, fuel: 4, medals: 3 }), { gems: 100, medals: 3 });
assert.deepEqual(walletGain(undefined, { credits: 5 }), { credits: 5 });

// Reward tables become cards in a fixed order; zeros, fractions and non-currency keys (a login streak) drop out.
assert.deepEqual(rewardItems({ streak: 7, credits: 150, gems: 15, medals: 0, fuel: 1.5 }),
  [{ kind: 'gems', amount: 15 }, { kind: 'credits', amount: 150 }, { kind: 'fuel', amount: 1 }]);

// The size of the moment follows the gem worth (fuel is 10 gems a unit), and a rare crew card lifts it.
assert.equal(rewardTier([{ kind: 'credits', amount: 40 }, { kind: 'medals', amount: 2 }]), 'small');
assert.equal(rewardTier([{ kind: 'gems', amount: 15 }, { kind: 'credits', amount: 150 }]), 'medium');
assert.equal(rewardTier([{ kind: 'gems', amount: 100 }]), 'large');
assert.equal(rewardTier([{ kind: 'gems', amount: 280 }]), 'huge');
assert.equal(rewardTier([{ kind: 'credits', amount: 10 }, { kind: 'crew', rarity: 'legendary' }]), 'huge');
for (const tier of TIERS) assert.ok(TIER_SOUNDS[tier].length > 0, `${tier} has a sound`);

// Nothing to show: no reveal, so any grant can be passed.
assert.equal(rewardEntry({ source: 'purchase', title: 'Gem Pack', items: [] }), null);
assert.equal(rewardEntry({ source: 'purchase', title: 'Gem Pack', items: rewardItems({ gems: 0 }) }), null);

const entry = rewardEntry({ source: 'login', title: 'Day 7 <login>', subtitle: 'Welcome back', items: rewardItems({ gems: 15, credits: 150 }) });
assert.equal(entry.tier, 'medium');
const html = renderRewardReveal(entry);
assert.match(html, /role="dialog"/);
assert.match(html, /Day 7 &lt;login&gt;/, 'titles are escaped');
assert.match(html, /data-reward-kind="gems" data-amount="15"/);
assert.match(html, /data-reward-kind="credits" data-amount="150"/);
assert.match(html, /\+150<\/b><span>Credits/);
assert.equal((html.match(/data-act="reward-close"/g) || []).length, 2, 'tap anywhere or Collect closes it');
assert.equal(renderRewardReveal(null), '');

// Rewards shown on another screen (a contract result) fly from mid-screen, one start per currency.
const starts = centreCards({ credits: 120, medals: 4 });
assert.deepEqual(starts.map(s => s.kind), ['credits', 'medals']);
assert.ok(starts.every(s => s.rect.width > 0 && Number.isFinite(s.rect.left)));

// Wiring guard: the grants that used to be toasts now raise a reveal.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
for (const source of ['commission', 'purchase', 'expedition']) {
  assert.match(main, new RegExp(`showReward\\(rewardEntry\\(\\{ source: '${source}'|rewardEntry\\(\\{ source: '${source}'`), `${source} raises a reveal`);
}
// Session claims (the login calendar, achievements) return a reward effect that main.js turns into a reveal.
const session = readFileSync(new URL('../src/systems/sessionLoop.js', import.meta.url), 'utf8');
for (const source of ['calendar', 'achievement']) assert.match(session, new RegExp(`kind: 'reward', source: '${source}'`), `${source} returns a reward effect`);
assert.match(main, /effect\.kind === 'reward'[\s\S]{0,400}showReward\(/, 'reward effects raise a reveal');
assert.doesNotMatch(main, /showToast\(\{ title: `Day \$\{daily\.bonus\.streak\} bonus`/, 'the login bonus is no longer a toast');

// Every product in the catalog and every wall pack has its own picture, and the file is installed.
for (const sku of [...Object.keys(PRODUCT_DEFS), ...WALLS.map(wall => wallPackSku(wall.id))]) {
  const art = productArt(sku);
  assert.ok(art, `${sku} has reveal art`);
  assert.ok(existsSync(new URL(`../public${art}`, import.meta.url)), `${sku} art is installed`);
}
assert.equal(productArt('wc_unknown'), null);

console.log('reward_reveal: OK');
