// @ts-nocheck
/** Presentation-only juice: trauma shake, hitstop; sound effects come from sound.js. */

let trauma = 0;
let freeze = 0;
const reduced =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function addTrauma(amt) {
  if (reduced) return;
  trauma = Math.min(1, trauma + amt);
}

export function hitstop(sec = 0.05) {
  if (reduced) return;
  freeze = Math.max(freeze, sec);
}

export function simScale() {
  return freeze > 0 ? 0 : 1;
}

export function tickJuice(dt) {
  if (freeze > 0) freeze = Math.max(0, freeze - dt);
  trauma = Math.max(0, trauma - dt * 1.8);
}

export function shakeOffset() {
  if (trauma <= 0.002) return { x: 0, y: 0, r: 0 };
  const s = trauma * trauma;
  const t = performance.now() * 0.04;
  return {
    x: Math.sin(t * 1.7) * 10 * s,
    y: Math.cos(t * 2.1) * 8 * s,
    r: Math.sin(t * 1.3) * 0.8 * s,
  };
}

export function applyShake(el) {
  if (!el) return;
  const o = shakeOffset();
  if (o.x === 0 && o.y === 0) {
    if (el.style.transform) el.style.transform = '';
    return;
  }
  el.style.transform = `translate(${o.x.toFixed(2)}px, ${o.y.toFixed(2)}px) rotate(${o.r.toFixed(2)}deg)`;
}

// Sound lives in sound.js (Kenney CC0 clips through Web Audio); re-exported for existing callers.
export { sfx, unlockSfx } from './sound.js';
