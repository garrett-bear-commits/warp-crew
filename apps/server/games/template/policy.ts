// Template game policy (§11): validateBlob, summary extraction, sanitizeForQa, plausibility.
import type { GamePolicy, BlobPolicyResult } from '@foundation/server';

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

export const templatePolicy: GamePolicy = {
  validateBlob(value): BlobPolicyResult {
    if (!isSave(value)) return { ok: false, reason: 'shape' };
    const summary: Record<string, number> = {
      counter: Math.floor(value.counter),
      gold: Math.floor(value.gold),
    };
    if (typeof value.gems === 'number') summary.gems = Math.floor(value.gems);
    if (typeof value.clicks === 'number') summary.clicks = Math.floor(value.clicks);
    return { ok: true, summary, schemaVersion: value.v };
  },
  sanitizeForQa(value) {
    if (!isSave(value)) return value;
    const { playerName: _drop, ...rest } = value;
    return rest;
  },
  summaryPlausible(summary, progress) {
    // counter is the progress ordinal in the template game: the summary must not claim more counter than progress
    return (summary.counter ?? 0) <= progress + 1;
  },
  maxEarnablePremium(progress) {
    return Math.floor(progress / 100) * 5;
  },
};
