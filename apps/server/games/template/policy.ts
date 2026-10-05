// Template game policy (§11): validateBlob, summary extraction, sanitizeForQa, plausibility.
// The client codec (ADR-029 #4) writes `{"schemaVersion": n, "state": {...}}`; a bare state
// (older writers, fixtures) is accepted too. The schema the server records is the game's own
// `state.v` — the field the migrations maintain — so a claim in the wire envelope never
// outranks the blob itself.
import type { GamePolicy, BlobPolicyResult } from '@foundation/server';
import { grantProblem } from '../grant-vocabulary.ts';
import { templateGrants } from './grants.ts';

interface TemplateSave {
  v: number;
  counter: number;
  gold: number;
  gems?: number;
  clicks?: number;
  upgrades?: Record<string, number>;
  playerName?: string;
}

function isSave(v: unknown): v is TemplateSave {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.v === 'number' &&
    Number.isInteger(o.v) &&
    o.v >= 1 &&
    typeof o.counter === 'number' &&
    Number.isFinite(o.counter) &&
    o.counter >= 0 &&
    typeof o.gold === 'number' &&
    Number.isFinite(o.gold) &&
    o.gold >= 0
  );
}

/** `{schemaVersion, state}` envelope (client codec) or a bare state. */
function unwrap(value: unknown): { envelope: boolean; state: unknown } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (typeof o.schemaVersion === 'number' && 'state' in o)
      return { envelope: true, state: o.state };
  }
  return { envelope: false, state: value };
}

export const templatePolicy: GamePolicy = {
  validateBlob(value): BlobPolicyResult {
    const { state } = unwrap(value);
    if (!isSave(state)) return { ok: false, reason: 'shape' };
    const summary: Record<string, number> = {
      counter: Math.floor(state.counter),
      gold: Math.floor(state.gold),
    };
    if (typeof state.gems === 'number') summary.gems = Math.floor(state.gems);
    if (typeof state.clicks === 'number') summary.clicks = Math.floor(state.clicks);
    return { ok: true, summary, schemaVersion: state.v };
  },
  sanitizeForQa(value) {
    const { envelope, state } = unwrap(value);
    if (!isSave(state)) return value;
    const { playerName: _drop, ...rest } = state;
    return envelope ? { ...(value as Record<string, unknown>), state: rest } : rest;
  },
  summaryPlausible(summary, progress) {
    // counter is the progress ordinal in the template game: the summary must not claim more counter than progress
    return (summary.counter ?? 0) <= progress + 1;
  },
  maxEarnablePremium(progress) {
    return Math.floor(progress / 100) * 5;
  },
  grantRewardProblem: (rewards) => grantProblem(templateGrants, rewards),
};
