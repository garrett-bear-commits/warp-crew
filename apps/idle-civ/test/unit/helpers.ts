import { createRngStreams, type Ctx } from '@foundation/client';
import { idleCivEngine, type IdleCivAction, type IdleCivState } from '../../src/sim/index.ts';

export const T0 = 1_700_000_000_000;

export function ctx(tick = 0, now = T0 + tick * 1000): Ctx {
  return { now, rng: createRngStreams(1).sim, tick, catchUp: false };
}

export function fresh(): IdleCivState {
  return idleCivEngine.newState({ now: T0, seed: 1, rng: createRngStreams(1).sim });
}

export function apply(state: IdleCivState, action: IdleCivAction, tick = 0): IdleCivState {
  return idleCivEngine.apply(state, action, ctx(tick)).state;
}

export function advanceMinutes(state: IdleCivState, minutes: number, tick = 0): IdleCivState {
  return advanceSeconds(state, Math.round(minutes * 60), tick);
}

export function advanceSeconds(state: IdleCivState, seconds: number, tick = 0): IdleCivState {
  const step = idleCivEngine.step;
  if (!step) throw new Error('engine.step missing');
  return step(state, Math.max(0, Math.round(seconds)), ctx(tick)).state;
}

export function names(state: IdleCivState): string[] {
  return state.telemetry.map((e) => e.name);
}
