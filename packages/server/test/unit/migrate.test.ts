import { describe, expect, it } from 'vitest';
import {
  SCHEMA_COMPAT_AHEAD,
  evaluateSchemaCompatibility,
  migrationOrdinal,
  migrationsBefore,
} from '../../src/db/migrate.ts';

const file = (name: string, checksum = 'c'): { name: string; checksum: string } => ({
  name,
  checksum,
});

describe('migrationOrdinal / migrationsBefore', () => {
  it('selects by parsed numeric prefix so a future 0016 cannot leak into a pre-0015 fixture', () => {
    const names = ['0014_saves.sql', '0015_legacy.sql', '0016_validate.sql'];
    expect(names.map(migrationOrdinal)).toEqual([14, 15, 16]);
    expect(
      migrationsBefore(
        names.map((name) => file(name)),
        15,
      ).map((f) => f.name),
    ).toEqual(['0014_saves.sql']);
    expect(
      migrationsBefore(
        names.map((name) => file(name)),
        15,
      ).some((f) => f.name.startsWith('0016')),
    ).toBe(false);
  });
});

describe('evaluateSchemaCompatibility (N-1 boot policy)', () => {
  const image14 = [file('0013_outbox.sql'), file('0014_sandbox.sql')];
  const through14 = [...image14];
  const through15 = [...image14, file('0015_legacy.sql')];
  const through16 = [...through15, file('0016_validate.sql')];

  it('exact match is bootable', () => {
    expect(evaluateSchemaCompatibility(through16, through16)).toMatchObject({
      state: 'match',
      ok: true,
      pending: [],
      mismatched: [],
      ahead: [],
    });
  });

  it('a known pending file refuses', () => {
    expect(evaluateSchemaCompatibility(through16, through14)).toMatchObject({
      state: 'pending',
      ok: false,
      pending: ['0015_legacy.sql', '0016_validate.sql'],
    });
  });

  it('checksum mismatch refuses even when names align', () => {
    const applied = [file('0013_outbox.sql'), file('0014_sandbox.sql', 'other')];
    expect(evaluateSchemaCompatibility(image14, applied)).toMatchObject({
      state: 'mismatched',
      ok: false,
      mismatched: ['0014_sandbox.sql'],
    });
  });

  it(`previous image + contiguous suffix of length ≤ ${SCHEMA_COMPAT_AHEAD} is the N-1 window`, () => {
    expect(evaluateSchemaCompatibility(image14, through15)).toMatchObject({
      state: 'ahead',
      ok: true,
      pending: [],
      ahead: ['0015_legacy.sql'],
    });
    expect(evaluateSchemaCompatibility(image14, through16)).toMatchObject({
      state: 'ahead',
      ok: true,
      pending: [],
      ahead: ['0015_legacy.sql', '0016_validate.sql'],
    });
  });

  it('a third extra file or a non-contiguous ordinal is incompatible', () => {
    const threeAhead = [...through16, file('0017_extra.sql')];
    expect(evaluateSchemaCompatibility(image14, threeAhead)).toMatchObject({
      state: 'incompatible',
      ok: false,
    });
    expect(
      evaluateSchemaCompatibility(image14, [...through14, file('0016_skip.sql')]),
    ).toMatchObject({
      state: 'incompatible',
      ok: false,
      ahead: ['0016_skip.sql'],
    });
  });
});
