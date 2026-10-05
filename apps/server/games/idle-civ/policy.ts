import type { GamePolicy, BlobPolicyResult } from '@foundation/server';

interface IdleCivSave {
  v: number;
  acceptedActions: number;
  population?: number;
  stocks?: { food?: { amount?: number } };
}

function isSave(v: unknown): v is IdleCivSave {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.v === 'number' &&
    Number.isInteger(o.v) &&
    o.v >= 1 &&
    typeof o.acceptedActions === 'number' &&
    Number.isFinite(o.acceptedActions) &&
    o.acceptedActions >= 0
  );
}

function unwrap(value: unknown): { envelope: boolean; state: unknown } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (typeof o.schemaVersion === 'number' && 'state' in o)
      return { envelope: true, state: o.state };
  }
  return { envelope: false, state: value };
}

export const idleCivPolicy: GamePolicy = {
  validateBlob(value): BlobPolicyResult {
    const { state } = unwrap(value);
    if (!isSave(state)) return { ok: false, reason: 'shape' };
    const food = state.stocks?.food?.amount;
    const summary: Record<string, number> = {
      counter: Math.floor(state.acceptedActions),
      population: Math.floor(state.population ?? 0),
    };
    if (typeof food === 'number') summary.food = Math.floor(food);
    return { ok: true, summary, schemaVersion: state.v };
  },
  sanitizeForQa(value) {
    const { envelope, state } = unwrap(value);
    if (!isSave(state)) return value;
    return envelope ? { ...(value as Record<string, unknown>), state } : state;
  },
  summaryPlausible(summary, progress) {
    return (summary.counter ?? 0) <= progress + 1;
  },
  maxEarnablePremium() {
    return 0;
  },
};
