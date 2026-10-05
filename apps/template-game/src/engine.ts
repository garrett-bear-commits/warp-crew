// Template idle game engine (§5.1, §11): Engine<S,A,E> — pure, seeded, two RNG streams, progressOf
// = accepted-action count + idle ticks (monotone), summary = the only fields the server reads.
// Mutation model: in-place inside apply/step; the adapter publishes {state, rev}.
import type { Engine, Ctx, Summary } from '@foundation/client';

export interface TemplateState {
  v: number;
  /** progress ordinal: accepted actions + settled idle ticks (monotone) */
  counter: number;
  gold: number;
  gems: number;
  clicks: number;
  upgrades: { auto: number; click: number };
  cosmetics: string[];
  /** last server-anchored now the state settled at (ms) */
  settledAt: number;
  playerName?: string;
}

export type TemplateAction =
  | { type: 'click' }
  | { type: 'buy'; upgrade: 'auto' | 'click' }
  | { type: 'grant'; gold?: number; gems?: number; cosmetic?: string; ref: string }
  | { type: 'adjust'; gems: number; ref: string }
  | { type: 'rename'; name: string };

export type TemplateEffect =
  | { kind: 'coin'; tick: number; payload: { amount: number } }
  | { kind: 'sparkle'; tick: number; ttlTicks: number; payload: { seed: number } }
  | { kind: 'toast'; tick: number; payload: { text: string } };

export const SCHEMA_VERSION = 2;
export const TPS = 5;

export const upgradeCost = (kind: 'auto' | 'click', level: number): number =>
  Math.floor((kind === 'auto' ? 25 : 10) * 1.6 ** level);
export const clickValue = (s: TemplateState): number => 1 + s.upgrades.click;
export const autoPerTick = (s: TemplateState): number => s.upgrades.auto; // gold per tick from auto-clickers

export const templateEngine: Engine<TemplateState, TemplateAction, TemplateEffect> = {
  newState(init) {
    return {
      v: SCHEMA_VERSION,
      counter: 0,
      gold: 0,
      gems: 0,
      clicks: 0,
      upgrades: { auto: 0, click: 0 },
      cosmetics: [],
      settledAt: init.now,
    };
  },
  apply(state, action, ctx: Ctx) {
    const effects: TemplateEffect[] = [];
    switch (action.type) {
      case 'click': {
        const v = clickValue(state);
        state.gold += v;
        state.clicks += 1;
        state.counter += 1;
        effects.push({ kind: 'coin', tick: ctx.tick, payload: { amount: v } });
        if (ctx.rng.next() < 0.1)
          effects.push({
            kind: 'sparkle',
            tick: ctx.tick,
            ttlTicks: 10,
            payload: { seed: ctx.rng.int(1000) },
          });
        break;
      }
      case 'buy': {
        const cost = upgradeCost(action.upgrade, state.upgrades[action.upgrade]);
        if (state.gold >= cost) {
          state.gold -= cost;
          state.upgrades[action.upgrade] += 1;
          state.counter += 1;
          effects.push({
            kind: 'toast',
            tick: ctx.tick,
            payload: { text: `Bought ${action.upgrade} upgrade` },
          });
        }
        break;
      }
      case 'grant': {
        // rewards arrive from server grants (claimed): soft/premium/cosmetic
        if (action.gold) state.gold += action.gold;
        if (action.gems) state.gems += action.gems;
        if (action.cosmetic && !state.cosmetics.includes(action.cosmetic))
          state.cosmetics.push(action.cosmetic);
        state.counter += 1;
        effects.push({ kind: 'toast', tick: ctx.tick, payload: { text: `Reward: ${action.ref}` } });
        break;
      }
      case 'adjust': {
        // unconditional boot instruction from the server (refund/make-good)
        state.gems = Math.max(0, state.gems + action.gems);
        state.counter += 1;
        break;
      }
      case 'rename': {
        state.playerName = action.name.slice(0, 24);
        break;
      }
    }
    return { state, effects };
  },
  // No producers → nothing to simulate: the loop consumes no ticks (and publishes nothing) until the
  // first auto-clicker is bought. Step and onGap are exact no-ops in that state anyway.
  isPaused: (state) => autoPerTick(state) === 0,
  step(state, dtTicks, ctx) {
    const effects: TemplateEffect[] = [];
    const income = autoPerTick(state) * dtTicks;
    if (income > 0) {
      state.gold += income;
      state.counter += dtTicks;
      if (!ctx.catchUp) effects.push({ kind: 'coin', tick: ctx.tick, payload: { amount: income } });
    }
    return { state, effects };
  },
  onGap(state, gap, ctx) {
    // offline credit: capped, MUST NOT raise progressOf (counter unchanged); credit = min(deviceGap, serverGap + tol) is computed by the adapter
    const ticks = Math.min(Math.floor(gap.serverSec * TPS), 8 * 3600 * TPS);
    const income = autoPerTick(state) * ticks;
    state.gold += income;
    return {
      state,
      effects:
        income > 0
          ? [{ kind: 'toast', tick: ctx.tick, payload: { text: `Welcome back: +${income} gold` } }]
          : [],
    };
  },
  settle(state, ctx) {
    state.settledAt = ctx.now;
    return state;
  },
  progressOf: (s) => s.counter,
  summary(s): Summary {
    return { counter: s.counter, gold: Math.floor(s.gold), gems: s.gems, clicks: s.clicks };
  },
};

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Numbered save migrations (defineSave: migrations[k] converts a raw value at schema k into k+1).
 * 1 → 2 added gems/clicks/cosmetics.
 */
export const MIGRATIONS: Record<number, (old: unknown) => unknown> = {
  1: (raw) => {
    const old = asRecord(raw);
    return {
      ...old,
      v: 2,
      gems: typeof old.gems === 'number' ? old.gems : 0,
      clicks: typeof old.clicks === 'number' ? old.clicks : 0,
      cosmetics: Array.isArray(old.cosmetics) ? old.cosmetics : [],
    };
  },
};
