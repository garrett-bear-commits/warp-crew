// Jest SDK adapter stub — degrades to local when JestSDK missing.
// Full port from Ninefold patterns in a later pass.

const REAL = typeof window !== 'undefined' && window.JestSDK ? window.JestSDK : null;

let ready = false;
let player = { playerId: 'local-dev', registered: true };

export const isReal = () => Boolean(REAL);

export async function init() {
  if (!REAL) { ready = true; return; }
  try {
    await REAL.init({ autoLoginReminders: false });
    player = REAL.getPlayer?.() || player;
    ready = true;
  } catch (e) {
    console.warn('[platform] init', e);
    ready = true;
  }
}

export function getPlayer() { return player; }
export function isReady() { return ready; }

export async function scheduleNotification() { /* stub */ }
export async function unscheduleNotification() { /* stub */ }
