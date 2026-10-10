// Currency tips: every top-bar chip is a button that opens a small tip (UI only, never saved).
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { fuelStatus } from '../src/systems/fuel.js';
import { hudChips } from '../src/systems/tutorial.js';
import { renderHud } from '../src/ui/bridge.js';
import { MS_PER_HOUR } from '../src/shared/timer.js';
import {
  CURRENCY_TIPS, TIP_MS, chipAriaLabel, currencyTipCopy, formatWait, fuelLine, renderCurrencyTip, tapTip, visibleTip,
} from '../src/ui/currencyTips.js';

const NOW = 1_800_000_000_000;
const words = text => text.trim().split(/\s+/).length;
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};
const withFuel = (current, { max = 10, ago = 0, rate } = {}) => {
  const base = createNewPlayer({ now: NOW, rng: () => 0.1 });
  return { ...base, fuelMax: max, fuelClaimAt: NOW - ago, ...(rate ? { fuelRatePerHour: rate } : {}), wallet: { ...base.wallet, fuel: current, credits: 200, medals: 7, gems: 12 } };
};
const hud = (player, { first = false, expReady = false, openTip = null, chips = ['fuel', 'credits', 'gems', 'medals'] } = {}) =>
  renderHud(player, fuelStatus(player, NOW), chips, first, { expReady, openTip });

// ---- Markup: every chip is a button with an aria-label ----------------------------------------------------------
{
  const player = withFuel(7);
  const html = hud(player);
  for (const id of ['fuel', 'credits', 'gems', 'medals']) {
    assert.match(html, new RegExp(`<button type="button" class="hud-chip[^"]*" data-currency="${id}" data-tip="${id}"`), id);
  }
  assert.equal((html.match(/<button/g) || []).length, 4);
  assert.doesNotMatch(html, /<div class="hud-chip/);
  assert.match(html, /aria-label="Credits: 200\. What are credits\?"/);
  assert.match(html, /aria-label="Medals: 7\. What are medals\?"/);
  assert.match(html, /aria-label="Gems: 12\. What are gems\?"/);
  assert.match(html, /aria-label="Fuel: 7 of 10\. What is fuel\?"/);
  assert.match(html, /<b>200<\/b>/);
  assert.match(html, /<b>7<\/b><span>\/10<\/span>/);
}

// ---- The chips that show still follow hudChips(), and all of them are buttons, even in the tutorial ---------------
{
  const fresh = createNewPlayer({ now: NOW, rng: () => 0.1 });
  const chips = hudChips(fresh);
  assert.ok(chips.includes('fuel') && chips.includes('credits'));
  const html = hud(fresh, { chips, first: true });
  assert.equal((html.match(/<button/g) || []).length, chips.length);
  for (const id of chips) assert.match(html, new RegExp(`data-tip="${id}"`));
  // The tutorial tap is a tip only: the fuel chip carries no claim action there, even with fuel waiting.
  const waiting = withFuel(2, { ago: 3 * MS_PER_HOUR });
  assert.ok(fuelStatus(waiting, NOW).pendingWhole > 0);
  assert.doesNotMatch(hud(waiting, { chips, first: true, expReady: true }), /data-act=/);
}

// ---- Fuel keeps its claim; nothing waiting means the tap is only a tip -----------------------------------------------
{
  assert.doesNotMatch(hud(withFuel(7)), /data-act=/);
  const waiting = hud(withFuel(2, { ago: 3 * MS_PER_HOUR }));
  assert.match(waiting, /data-currency="fuel" data-tip="fuel" data-act="claim" data-source="hud"/);
  assert.match(waiting, /has-claim/);
  assert.match(waiting, /3 waiting to collect\. What is fuel\?/);
  // A finished away team is claimed through the same chip.
  assert.match(hud(withFuel(7), { expReady: true }), /data-act="claim" data-source="hud"/);
  // Open state is exposed to assistive tech.
  assert.match(hud(withFuel(7), { openTip: 'credits' }), /data-tip="credits"[^>]*aria-expanded="true"/);
  assert.match(hud(withFuel(7), { openTip: 'credits' }), /data-tip="fuel"[^>]*aria-expanded="false"/);
}

// ---- Tip copy ---------------------------------------------------------------------------------------------------------
{
  const player = withFuel(7, { ago: 30 * 60_000 });
  const copy = id => currencyTipCopy(id, player, NOW);
  assert.deepEqual(copy('credits'), { name: 'Credits', body: 'Every contract pays credits. They buy ship upgrades, fuel and new crew.', live: '' });
  assert.deepEqual(copy('medals'), { name: 'Medals', body: 'Contracts pay medals. They level up your crew.', live: '' });
  assert.deepEqual(copy('gems'), { name: 'Gems', body: 'Rare: from the story, the calendar, chests and the Shop. They hire crew and speed things up.', live: '' });
  assert.equal(copy('fuel').name, 'Fuel');
  assert.equal(copy('fuel').body, 'Launching a contract or jumping uses fuel. One comes back every hour.');
  assert.equal(copy('nope'), null);
  for (const id of Object.keys(CURRENCY_TIPS)) {
    const { body } = copy(id);
    assert.ok(words(body) <= 22, `${id}: ${words(body)} words`);
    assert.doesNotMatch(body, /\bberth\b/i);
  }
  const markup = renderCurrencyTip({ id: 'credits', at: NOW }, player, NOW);
  assert.match(markup, /<b>Credits<\/b>/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /<img src="[^"]+" alt="" \/>/);
  assert.equal(renderCurrencyTip(null, player, NOW), '');
}

// ---- The fuel line uses the real regen numbers -----------------------------------------------------------------------
{
  // 7 of 10, half an hour into the next unit: 30 min + 2 more hours.
  assert.equal(fuelLine(withFuel(7, { ago: 30 * 60_000 }), NOW), 'Full in 2 h 30 min.');
  // 7 of 10, just claimed: three full hours.
  assert.equal(fuelLine(withFuel(7), NOW), 'Full in 3 h.');
  assert.equal(currencyTipCopy('fuel', withFuel(7), NOW).live, 'Full in 3 h.');
  // A faster tank: 2 an hour and one missing is under an hour.
  assert.equal(fuelLine(withFuel(9, { rate: 2 }), NOW), 'Full in 30 min.');
  assert.match(currencyTipCopy('fuel', withFuel(9, { rate: 2 }), NOW).body, /Two come back every hour\.$/);
  assert.equal(fuelLine(withFuel(10), NOW), 'Tank full.');
  assert.equal(fuelLine(withFuel(10, { ago: 20 * MS_PER_HOUR }), NOW), 'Tank full.');
  // Fuel waiting that would fill the tank is not "full in" anything yet.
  assert.equal(fuelLine(withFuel(8, { ago: 5 * MS_PER_HOUR }), NOW), 'Full once collected.');
  // What the tap just collected leads the line.
  const after = withFuel(9, { ago: 0 });
  assert.equal(currencyTipCopy('fuel', after, NOW, { collected: 2 }).live, 'Collected 2 fuel. Full in 1 h.');
  assert.equal(currencyTipCopy('fuel', withFuel(10), NOW, { collected: 3 }).live, 'Collected 3 fuel. Tank full.');
  assert.equal(formatWait(61_000), '2 min');
  assert.equal(formatWait(MS_PER_HOUR), '1 h');
  assert.equal(formatWait(MS_PER_HOUR + 60_000), '1 h 1 min');
}

// ---- One tip at a time: second tap, timeout, tab change, anything in the way -----------------------------------------
{
  let state = tapTip(null, 'credits', { now: NOW, tab: 'ship' });
  assert.deepEqual(state, { id: 'credits', at: NOW, tab: 'ship', collected: 0 });
  assert.equal(visibleTip(state, { now: NOW + 100, tab: 'ship' }), state);
  // Another chip replaces it (never two at once).
  const other = tapTip(state, 'gems', { now: NOW + 200, tab: 'ship' });
  assert.equal(other.id, 'gems');
  // The same chip again closes it.
  assert.equal(tapTip(state, 'credits', { now: NOW + 300, tab: 'ship' }), null);
  // Five seconds closes it.
  assert.equal(TIP_MS, 5000);
  assert.ok(visibleTip(state, { now: NOW + TIP_MS - 1, tab: 'ship' }));
  assert.equal(visibleTip(state, { now: NOW + TIP_MS, tab: 'ship' }), null);
  // A tab change closes it.
  assert.equal(visibleTip(state, { now: NOW + 100, tab: 'crew' }), null);
  // A fight or a modal sheet closes it, and it never opens over one.
  assert.equal(visibleTip(state, { now: NOW + 100, tab: 'ship', blocked: true }), null);
  assert.equal(visibleTip(null, { now: NOW, tab: 'ship' }), null);
  // Unknown ids do nothing.
  assert.equal(tapTip(state, 'bogus', { now: NOW, tab: 'ship' }), state);
}

// ---- A tip is UI only: nothing here touches the save ------------------------------------------------------------------
{
  const player = deepFreeze(withFuel(2, { ago: 3 * MS_PER_HOUR }));
  const before = JSON.stringify(player);
  const fuel = fuelStatus(player, NOW);
  hud(player);
  chipAriaLabel('fuel', player, fuel);
  for (const id of Object.keys(CURRENCY_TIPS)) renderCurrencyTip(tapTip(null, id, { now: NOW, tab: 'ship' }), player, NOW);
  fuelLine(player, NOW);
  assert.equal(JSON.stringify(player), before);
}

console.log('currency_tips ok');
