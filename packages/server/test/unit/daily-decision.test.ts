import { describe, expect, it } from 'vitest';
import {
  DAILY_PERIOD_MS,
  decideDailyClaim,
  type DailyClaimRow,
  type DailyDecisionInput,
} from '../../src/features/achievements/contract.ts';

const DAY = DAILY_PERIOD_MS;
// 2026-09-27T13:00:00.000Z
const T = Date.UTC(2026, 8, 27, 13);

const rolling = (o: Partial<DailyDecisionInput> = {}): DailyDecisionInput => ({
  cadence: 'rolling_24h',
  now: T,
  today: null,
  last: null,
  progress: 3,
  minProgress: 3,
  ladderLen: 1,
  generation: 0,
  ...o,
});

const claimAt = (at: number, o: Partial<DailyClaimRow> = {}): DailyClaimRow => ({
  day: new Date(at).toISOString().slice(0, 10),
  at,
  ladderDay: 1,
  grantKey: `daily:g0:${new Date(at).toISOString().slice(0, 10)}`,
  ...o,
});

describe('decideDailyClaim — rolling 24 h on the server clock', () => {
  it('claims the first time with a generation-scoped key and the next opening 24 h later', () => {
    expect(decideDailyClaim(rolling({ generation: 4 }))).toEqual({
      kind: 'claim',
      day: '2026-09-27',
      ladderDay: 1,
      grantKey: 'daily:g4:2026-09-27',
      nextEligibleAt: T + DAY,
    });
  });

  it('is cooling down until exactly 24 h after the last claim, returning that claim', () => {
    const last = claimAt(T);
    for (const now of [T, T + 1, T + DAY - 1]) {
      expect(decideDailyClaim(rolling({ now, last }))).toEqual({
        kind: 'cooldown',
        ladderDay: 1,
        grantKey: last.grantKey,
        nextEligibleAt: T + DAY,
      });
    }
    const open = decideDailyClaim(rolling({ now: T + DAY, last }));
    expect(open).toMatchObject({ kind: 'claim', day: '2026-09-28', nextEligibleAt: T + 2 * DAY });
  });

  it('keeps a server clock set back behind the last claim locked', () => {
    const last = claimAt(T);
    for (const now of [T - 1, T - DAY, T - 30 * DAY, Number.NaN])
      expect(decideDailyClaim(rolling({ now, last })).kind).toBe('cooldown');
  });

  it('never stacks: a week away yields one claim, and the next 24 h run from it', () => {
    const last = claimAt(T);
    const back = T + 8 * DAY + 5_000;
    const d = decideDailyClaim(rolling({ now: back, last }));
    expect(d).toMatchObject({ kind: 'claim', nextEligibleAt: back + DAY });
    const after = claimAt(back);
    expect(decideDailyClaim(rolling({ now: back + DAY - 1, last: after })).kind).toBe('cooldown');
  });

  it('refuses below minProgress with nextEligibleAt = now, but a cooldown still wins', () => {
    expect(decideDailyClaim(rolling({ progress: 2 }))).toEqual({
      kind: 'not_eligible',
      nextEligibleAt: T,
    });
    expect(decideDailyClaim(rolling({ progress: 0, minProgress: 0 })).kind).toBe('claim');
    expect(decideDailyClaim(rolling({ progress: 2, last: claimAt(T - 1) })).kind).toBe('cooldown');
  });

  it('advances the ladder only when the claim lands within 24 h of opening', () => {
    const last = claimAt(T, { ladderDay: 2 });
    expect(decideDailyClaim(rolling({ now: T + DAY, last, ladderLen: 3 }))).toMatchObject({
      ladderDay: 3,
    });
    expect(
      decideDailyClaim(rolling({ now: T + DAY, last: { ...last, ladderDay: 3 }, ladderLen: 3 })),
    ).toMatchObject({ ladderDay: 1 });
    expect(decideDailyClaim(rolling({ now: T + 2 * DAY, last, ladderLen: 3 }))).toMatchObject({
      ladderDay: 1,
    });
  });

  it('two claims 24 h apart always fall on different UTC days (primary key never collides)', () => {
    for (const offset of [0, 1, 3_600_000, 11 * 3_600_000, DAY - 1]) {
      const start = Date.UTC(2026, 8, 27) + offset;
      const next = decideDailyClaim(rolling({ now: start + DAY, last: claimAt(start) }));
      expect(next.kind).toBe('claim');
      if (next.kind === 'claim') expect(next.day).not.toBe(claimAt(start).day);
    }
  });
});

describe('decideDailyClaim — UTC day (unchanged foundation behaviour)', () => {
  const utc = (o: Partial<DailyDecisionInput> = {}): DailyDecisionInput =>
    rolling({ cadence: 'utc_day', minProgress: 0, progress: 0, ladderLen: 3, ...o });
  const midnight = Date.UTC(2026, 8, 28);

  it('claims once per UTC day with a daily:<day> key and next midnight', () => {
    expect(decideDailyClaim(utc())).toEqual({
      kind: 'claim',
      day: '2026-09-27',
      ladderDay: 1,
      grantKey: 'daily:2026-09-27',
      nextEligibleAt: midnight,
    });
    const today = claimAt(T - 3_600_000, { grantKey: 'daily:2026-09-27' });
    expect(decideDailyClaim(utc({ today, last: today }))).toEqual({
      kind: 'cooldown',
      ladderDay: 1,
      grantKey: 'daily:2026-09-27',
      nextEligibleAt: midnight,
    });
  });

  it('advances the ladder on consecutive days and resets after a gap', () => {
    const yesterday = claimAt(T - DAY, { ladderDay: 1 });
    expect(decideDailyClaim(utc({ last: yesterday }))).toMatchObject({ ladderDay: 2 });
    expect(decideDailyClaim(utc({ last: { ...yesterday, ladderDay: 3 } }))).toMatchObject({
      ladderDay: 1,
    });
    expect(decideDailyClaim(utc({ last: claimAt(T - 3 * DAY, { ladderDay: 2 }) }))).toMatchObject({
      ladderDay: 1,
    });
  });
});
