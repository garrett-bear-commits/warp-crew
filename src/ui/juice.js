// @ts-nocheck
/** Presentation-only juice: trauma shake, hitstop, Web Audio stings. */

let trauma = 0;
let freeze = 0;
let ctx = null;
let master = null;
let unlocked = false;
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

export function unlockSfx() {
  if (unlocked) {
    if (ctx?.state === 'suspended') ctx.resume();
    return;
  }
  unlocked = true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function beep({ freq = 440, freq2 = 0, dur = 0.08, type = 'square', gain = 0.2, slide = 0 }) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  if (freq2) {
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'triangle';
    o2.frequency.value = freq2;
    g2.gain.setValueAtTime(gain * 0.5, t0);
    g2.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o2.connect(g2);
    g2.connect(master);
    o2.start(t0);
    o2.stop(t0 + dur + 0.02);
  }
}

function noise(dur = 0.06, gain = 0.18) {
  if (!ctx || !master) return;
  const n = Math.max(1, (ctx.sampleRate * dur) | 0);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 900;
  src.buffer = buf;
  g.gain.value = gain;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start();
}

export function sfx(name) {
  if (!ctx) return;
  const jitter = 0.92 + Math.random() * 0.16;
  if (name === 'pew') beep({ freq: 720 * jitter, dur: 0.07, type: 'square', gain: 0.12, slide: -420 });
  else if (name === 'hit') {
    noise(0.07, 0.2);
    beep({ freq: 180 * jitter, dur: 0.09, type: 'sawtooth', gain: 0.1, slide: -80 });
  } else if (name === 'boom') {
    noise(0.18, 0.28);
    beep({ freq: 90, dur: 0.22, type: 'sine', gain: 0.22, slide: -50 });
  } else if (name === 'win') {
    beep({ freq: 523, freq2: 784, dur: 0.16, type: 'triangle', gain: 0.16 });
    setTimeout(() => beep({ freq: 659, freq2: 988, dur: 0.22, type: 'triangle', gain: 0.14 }), 90);
  } else if (name === 'lock') {
    beep({ freq: 440, dur: 0.05, type: 'square', gain: 0.08 });
  }
}
