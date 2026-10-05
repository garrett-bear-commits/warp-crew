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
