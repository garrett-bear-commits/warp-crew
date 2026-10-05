// Save codec (§11 "codec (defineSave with numbered migrations)", ADR-029 #4): the wire blob is
// `{"schemaVersion": 2, "state": …}`; older blobs migrate forward through MIGRATIONS; the decoded
// state is normalised so every field the engine reads is present and well-typed (a blob from
// history, the KV mirror or a promoted quarantined row never crashes the engine), and `v` is
// stamped to the codec's schema version because it is derived from it, not stored truth.
import { defineSave, type SaveCodec } from '@foundation/client';
import { MIGRATIONS, SCHEMA_VERSION, type TemplateState } from './engine.ts';

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const nonNegInt = (v: unknown): number => Math.max(0, Math.floor(num(v)));

/** Shape check + normalisation of a raw value at the CURRENT schema. Throws on garbage. */
export function normaliseState(raw: unknown): TemplateState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('state must be an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.counter !== 'number' || !Number.isFinite(o.counter) || o.counter < 0)
    throw new Error('state.counter must be a non-negative number');
  if (typeof o.gold !== 'number' || !Number.isFinite(o.gold) || o.gold < 0)
    throw new Error('state.gold must be a non-negative number');
  const up = (o.upgrades ?? {}) as Record<string, unknown>;
  const state: TemplateState = {
    v: SCHEMA_VERSION,
    counter: Math.floor(o.counter),
    gold: o.gold,
    gems: nonNegInt(o.gems),
    clicks: nonNegInt(o.clicks),
    upgrades: { auto: nonNegInt(up.auto), click: nonNegInt(up.click) },
    cosmetics: Array.isArray(o.cosmetics)
      ? o.cosmetics.filter((c): c is string => typeof c === 'string').slice(0, 64)
      : [],
    settledAt: nonNegInt(o.settledAt),
  };
  if (typeof o.playerName === 'string' && o.playerName.length > 0)
    state.playerName = o.playerName.slice(0, 24);
  return state;
}

export function createTemplateCodec(): SaveCodec<TemplateState> {
  return defineSave<TemplateState>({
    schemaVersion: SCHEMA_VERSION,
    migrations: MIGRATIONS,
    decode: normaliseState,
    validate: (s) => Number.isSafeInteger(s.counter) && s.counter >= 0,
  });
}

export const templateCodec: SaveCodec<TemplateState> = createTemplateCodec();
