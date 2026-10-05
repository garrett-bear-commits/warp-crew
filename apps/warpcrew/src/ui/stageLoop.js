// @ts-nocheck
/** Single RAF for space, crew, thrusters, combat, juice. */

import { tickJuice, simScale } from './juice.js';

const ticks = new Set();
let raf = 0;
let last = 0;

export function onTick(fn) {
  ticks.add(fn);
  start();
  return () => ticks.delete(fn);
}

export function startStageLoop() {
  start();
}

export function stopStageLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
}

function start() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(loop);
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (document.hidden) {
    last = now;
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!dt) return;
  tickJuice(dt);
  const sim = dt * simScale();
  for (const fn of ticks) {
    try {
      fn(sim, dt, now);
    } catch (e) {
      console.warn('stage tick', e);
    }
  }
}
