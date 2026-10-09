// Hiring: the rarity cap, the featured "Between Jobs" banner, Contract Marks, seeded hires and the odds shown.
// Design: docs/superpowers/specs/2026-10-09-crew-matter-design.md, section 7.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rarityWeights, pullMerc, pullOnce, pullTen, redeemMarks, hireOdds, hireSeed, RARITY_CAPS, REP_GATES, LUCK_CAP, defaultGacha } from '../src/systems/gacha.js';
import { currentBanner, FEATURED_ROTATION, BANNER_DAYS, BANNER_EPOCH, MARK_COST } from '../src/data/banners.js';
import { catalogById } from '../src/data/crewRoster.js';
import { createNewPlayer } from '../src/systems/player.js';

const share = (w, keys) => keys.reduce((sum, k) => sum + w[k], 0) / Object.values(w).reduce((sum, v) => sum + v, 0);
const epoch = (days, hour = 12) => { const [y, m, d] = BANNER_EPOCH.split('-').map(Number); return new Date(y, m - 1, d + days, hour).getTime(); };
let seed = 11;
const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

test('reputation and Luck lift the odds up to a cap; base rates are unchanged', () => {
  const base = rarityWeights(0, 0);
  assert.equal(Math.round(share(base, ['legendary', 'mythic', 'apex']) * 10000) / 100, 0.7);
  let previous = 0;
  for (const rep of [0, ...REP_GATES, 9999]) {
    for (const luck of [0, 5, LUCK_CAP]) {
      const w = rarityWeights(rep, luck);
      const plus = share(w, ['legendary', 'mythic', 'apex']);
      assert.ok(plus <= RARITY_CAPS.legendaryPlus + 1e-9, `Legendary+ capped at rep ${rep} luck ${luck}`);
      assert.ok(share(w, ['mythic', 'apex']) <= RARITY_CAPS.mythicPlus + 1e-9);
      if (luck === 0) { assert.ok(plus >= previous - 1e-9, 'more reputation never lowers the top odds'); previous = plus; }
    }
  }
});

test('the banner rotates every 14 game days and reruns forever', () => {
  assert.equal(currentBanner(epoch(0)).index, 0);
  assert.equal(currentBanner(epoch(0)).daysLeft, BANNER_DAYS);
  assert.equal(currentBanner(epoch(BANNER_DAYS - 1)).daysLeft, 1);
  assert.equal(currentBanner(epoch(BANNER_DAYS)).index, 1);
  assert.equal(currentBanner(epoch(BANNER_DAYS * FEATURED_ROTATION.length)).index, 0, 'the rotation reruns');
  assert.ok(currentBanner(epoch(-3)).index >= 0, 'before the epoch still names a banner');
  for (const banner of FEATURED_ROTATION) {
    const star = catalogById(banner.featured);
    assert.ok(star && MARK_COST[star.rarity], `${banner.id} features a Legendary or Epic merc`);
    for (const id of banner.rateUp) assert.equal(catalogById(id)?.rarity, 'rare', `${id} is a rate-up Rare`);
  }
});

test('the featured 50/50: a miss makes the next one at that rarity a sure thing', () => {
  const banner = currentBanner(epoch(0));
  const star = catalogById(banner.featured);
  let hits = 0;
  let missesFollowedByHit = 0;
  let misses = 0;
  for (let i = 0; i < 400; i++) {
    const first = pullMerc({ rng, banner, guaranteedRarity: star.rarity, gacha: defaultGacha() });
    assert.equal(first.featured, first.template.id === star.id);
    if (first.featured) { hits++; continue; }
    misses++;
    const second = pullMerc({ rng, banner, guaranteedRarity: star.rarity, gacha: { ...defaultGacha(), featuredGuarantee: true } });
    if (second.template.id === star.id) missesFollowedByHit++;
  }
  assert.ok(hits > 150 && hits < 250, `about half land on the featured merc (${hits}/400)`);
  assert.equal(missesFollowedByHit, misses, 'after a miss the featured merc is guaranteed');
  const rares = Array.from({ length: 600 }, () => pullMerc({ rng, banner, guaranteedRarity: 'rare' }).template.id);
  const rateUp = rares.filter(id => banner.rateUp.includes(id)).length / rares.length;
  assert.ok(rateUp > 0.5 && rateUp < 0.7, `rate-up Rares come up about 61% of Rare hires (${Math.round(rateUp * 100)}%)`);
});

const rich = () => {
  const p = createNewPlayer({ now: epoch(0), rng: () => 0.3 });
  return { ...p, crewSlots: 6, wallet: { ...p.wallet, gems: 100000, credits: 100000 } };
};

test('every hire earns a Contract Mark; marks hire the featured merc outright', () => {
  let player = rich();
  player = pullOnce(player, { gems: true, now: epoch(0) }).player;
  assert.equal(player.gacha.marks, 1);
  player = pullTen(player, { now: epoch(0) }).player;
  assert.equal(player.gacha.marks, 11);
  assert.equal(redeemMarks(player, epoch(0)).reason, 'not_enough_marks');
  player = { ...player, gacha: { ...player.gacha, marks: 205 } };
  const star = currentBanner(epoch(0)).featured;
  const redeemed = redeemMarks(player, epoch(0));
  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.instance.templateId, star);
  assert.equal(redeemed.player.gacha.marks, 205 - MARK_COST[catalogById(star).rarity]);
  assert.ok([...redeemed.player.crew, ...(redeemed.player.reserve || [])].some(c => c.templateId === star));
});

test("hires come from the save's own seeded stream: the same save rolls the same, another save differs", () => {
  const a = rich();
  const b = { ...rich(), createdAt: (a.createdAt || 0) + 1, captainInstanceId: 'someone_else' };
  assert.notEqual(hireSeed(a), hireSeed(b));
  const roll = p => pullTen(p, { now: epoch(0) }).results.map(r => r.instance.templateId).join(',');
  assert.equal(roll(a), roll(a), 'reproducible');
  assert.notEqual(roll(a), roll(b), 'per save');
  const once = pullOnce(a, { gems: true, now: epoch(0) });
  assert.ok(Number.isInteger(once.player.gacha.seed), 'the seed is kept once used');
});

test('the odds shown add up and say what the banner and pity do', () => {
  const odds = hireOdds(rich(), epoch(0));
  assert.ok(Math.abs(odds.rows.reduce((sum, r) => sum + r.pct, 0) - 100) < 0.05);
  assert.equal(odds.featured.sharePct, 50);
  assert.equal(odds.pity.legendary.hard, 80);
  assert.equal(odds.marks.cost, MARK_COST[catalogById(odds.banner.featured).rarity]);
  const guaranteed = hireOdds({ ...rich(), gacha: { ...defaultGacha(), featuredGuarantee: true } }, epoch(0));
  assert.equal(guaranteed.featured.sharePct, 100);
});

test('a full reserve never throws away a rarer hire: the weakest waiting merc makes room', async () => {
  const { applyPullToRoster, RESERVE_CAP } = await import('../src/systems/gacha.js');
  const { createCrewInstance } = await import('../src/data/crewRoster.js');
  const commons = ['merc_rex', 'merc_bolt', 'merc_jen', 'merc_moss', 'merc_plip', 'merc_tess', 'merc_dax', 'merc_nub', 'merc_pip', 'merc_juno', 'merc_greaves'];
  const reserve = Array.from({ length: RESERVE_CAP }, (_, i) => ({ ...createCrewInstance(commons[i % commons.length], { instanceId: `r${i}` }), templateId: `filler_${i}`, status: 'reserve' }));
  const player = { crew: [createCrewInstance('merc_kira', { instanceId: 'k' })], crewSlots: 1, reserve, wallet: { credits: 0, medals: 0 } };
  const epic = createCrewInstance('merc_skarn', { instanceId: 'skarn' });
  const placed = applyPullToRoster(player, epic);
  assert.equal(placed.kind, 'reserve', 'the Epic is kept');
  assert.equal(placed.player.reserve.length, RESERVE_CAP);
  assert.ok(placed.player.reserve.some(c => c.instanceId === 'skarn'));
  assert.ok(placed.bumped && placed.player.wallet.credits > 0, 'the weakest waiting merc was sold to make room');
  const common = applyPullToRoster(player, createCrewInstance('merc_rex', { instanceId: 'rex2' }));
  assert.equal(common.kind, 'sold', 'a hire no rarer than anyone waiting is sold as before');
});
