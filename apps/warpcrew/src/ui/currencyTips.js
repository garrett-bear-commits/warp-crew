// @ts-nocheck
// Currency tips: tap a top-bar chip and a small tip opens under it. UI only, never saved.
// The state helpers below are pure so tests can drive them without a browser.
import { fuelStatus } from '../systems/fuel.js';
import { MS_PER_HOUR } from '../shared/timer.js';
import { ICONS } from '../data/portraits.js';

/** How long a tip stays open. Its `at` and every `now` here are one UI clock (performance.now() in the bridge), not game time. */
export const TIP_MS = 5000;

export const CURRENCY_TIPS = {
  fuel: { name: 'Fuel', noun: 'fuel', question: 'What is fuel?',
    body: 'Launching a contract or jumping uses fuel.' },
  credits: { name: 'Credits', noun: 'credits', question: 'What are credits?',
    body: 'Every contract pays credits. They buy ship upgrades, fuel and new crew.' },
  medals: { name: 'Medals', noun: 'medals', question: 'What are medals?',
    body: 'Contracts pay medals. They level up your crew.' },
  gems: { name: 'Gems', noun: 'gems', question: 'What are gems?',
    body: 'Rare: from the story, the calendar, chests and the Shop. They hire crew and speed things up.' },
};

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** "3 h", "2 h 30 min", "45 min": whole minutes, rounded up. */
export function formatWait(ms) {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The fuel facts a tip needs, from the real regen numbers. */
export function fuelFacts(player, now) {
  const fuel = fuelStatus(player, now);
  const msPerUnit = MS_PER_HOUR / Math.max(fuel.ratePerHour, 0.0001);
  let fullInMs = 0;
  if (!fuel.isFull) {
    const missing = Math.max(0, fuel.max - fuel.current - fuel.pendingWhole);
    fullInMs = missing > 0 ? Math.max(0, fuel.nextUnitAt - now) + (missing - 1) * msPerUnit : 0;
  }
  return { ...fuel, msPerUnit, fullInMs };
}

/** "Full in 3 h." or "Tank full." (or, when fuel is waiting to be collected, say so). */
export function fuelLine(player, now) {
  const facts = fuelFacts(player, now);
  if (facts.isFull) return 'Tank full.';
  if (facts.fullInMs <= 0) return 'Full once collected.';
  return `Full in ${formatWait(facts.fullInMs)}.`;
}

export function fuelRegenCopy(ratePerHour = 1) {
  const n = Math.round(ratePerHour);
  if (n === 1 || ratePerHour <= 1) return 'One comes back every hour.';
  return `${WORDS[n] || n} come back every hour.`;
}

/** The lines of one tip: { name, body, live }. `collected` is fuel just claimed by this tap. */
export function currencyTipCopy(id, player, now, { collected = 0 } = {}) {
  const tip = CURRENCY_TIPS[id];
  if (!tip) return null;
  if (id !== 'fuel') return { name: tip.name, body: tip.body, live: '' };
  const facts = fuelFacts(player, now);
  return {
    name: tip.name,
    body: `${tip.body} ${fuelRegenCopy(facts.ratePerHour)}`,
    live: `${collected > 0 ? `Collected ${collected} fuel. ` : ''}${fuelLine(player, now)}`,
  };
}

/** aria-label for a top-bar chip, e.g. "Credits: 200. What are credits?" */
export function chipAriaLabel(id, player, fuel) {
  const tip = CURRENCY_TIPS[id];
  if (!tip) return '';
  if (id === 'fuel') {
    const waiting = fuel?.pendingWhole > 0 ? ` ${fuel.pendingWhole} waiting to collect.` : '';
    return `Fuel: ${fuel?.current ?? player.wallet?.fuel ?? 0} of ${fuel?.max ?? player.fuelMax ?? 10}.${waiting} ${tip.question}`;
  }
  return `${tip.name}: ${player.wallet?.[id] ?? 0}. ${tip.question}`;
}

/** Tap on a chip: the same chip closes its tip, any other chip opens its own. */
export function tapTip(state, id, { now, tab = null } = {}) {
  if (!CURRENCY_TIPS[id]) return state || null;
  if (state?.id === id) return null;
  return { id, at: now, tab, collected: 0 };
}

/** What the screen should show now: the state, or null when it timed out, the tab changed or something is in the way. */
export function visibleTip(state, { now, tab = null, blocked = false } = {}) {
  if (!state || blocked) return null;
  if (now - state.at >= TIP_MS) return null;
  if (state.tab !== tab) return null;
  return state;
}

export function renderCurrencyTip(state, player, now) {
  const copy = state && currencyTipCopy(state.id, player, now, { collected: state.collected });
  if (!copy) return '';
  return `
    <div class="currency-tip" role="status" data-tip-for="${state.id}">
      <img src="${ICONS[state.id]}" alt="" />
      <div class="currency-tip-text">
        <b>${copy.name}</b>
        <p>${copy.body}</p>
        ${copy.live ? `<p class="currency-tip-live">${copy.live}</p>` : ''}
      </div>
    </div>`;
}

/**
 * Line the tip up under its chip (px, measured): clamp inside the screen and aim the arrow at the chip's centre.
 * The numbers go on the slot, not the tip, so a re-render of the tip never loses them or restarts its fade.
 */
export function placeTip(tipEl, chipEl, slotEl) {
  if (!tipEl || !chipEl || !slotEl) return;
  const slot = slotEl.getBoundingClientRect();
  const chip = chipEl.getBoundingClientRect();
  const width = tipEl.offsetWidth || 0;
  const margin = 8;
  const center = chip.left + chip.width / 2 - slot.left;
  const left = Math.max(margin, Math.min(center - width / 2, slot.width - margin - width));
  const arrow = Math.max(16, Math.min(center - left, width - 16));
  slotEl.style.setProperty('--tip-left', `${Math.round(left)}px`);
  slotEl.style.setProperty('--tip-arrow', `${Math.round(arrow)}px`);
}
