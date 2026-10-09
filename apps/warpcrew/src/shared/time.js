// Trusted time for monetized timers (drydock builds, offer windows, siege resets, subscription
// grace). Once the core client is up this is its clock: server-anchored after the first server
// answer (an RTT-filtered median offset, packages/client/src/clock), so a device clock that is
// simply wrong cannot finish builds while online. Offline, the device clock is all there is.

/** @type {{ now(): number } | null} */
let clock = null;

/** Point trustedNow at the core client's clock (main.js does this at boot). */
export function useClock(next) {
  clock = next && typeof next.now === 'function' ? next : null;
}

export function trustedNow() {
  return clock ? clock.now() : Date.now();
}

/**
 * The game day: the player's local calendar date (YYYY-MM-DD). Every daily reset uses it (login
 * streak, free hire, Commission perks, contract board, daily plan, siege damage) so they all turn
 * over together at local midnight.
 */
export function localDayKey(now = trustedNow(), offsetDays = 0) {
  const d = new Date(now);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const dd = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
