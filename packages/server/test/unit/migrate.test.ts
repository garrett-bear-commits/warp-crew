import { describe, expect, it } from 'vitest';
import {
  evaluateSchemaCompatibility,
  isN1CompatibleSql,
  isUniqueContiguousChain,
  migrationOrdinal,
  migrationsBefore,
  N1_COMPAT_MARKER,
  schemaHead,
  schemaIsExactHead,
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

describe('unique contiguous ordinal chain', () => {
  it('accepts a dense unique sequence and refuses skips or duplicate prefixes', () => {
    expect(isUniqueContiguousChain(['0013_a.sql', '0014_b.sql', '0015_c.sql'])).toBe(true);
    expect(isUniqueContiguousChain(['0013_a.sql', '0015_c.sql'])).toBe(false);
    expect(isUniqueContiguousChain(['0015_a.sql', '0015_b.sql'])).toBe(false);
  });
});

describe('evaluateSchemaCompatibility (declared N-1)', () => {
  const image15 = [file('0013_outbox.sql'), file('0014_sandbox.sql'), file('0015_legacy.sql')];
  const through15 = [...image15];
  const extra16 = file('0016_validate.sql');
  const through16 = [...through15, extra16];
  const declared16 = [{ extraName: extra16.name, prefixHead: schemaHead(through15) }];

  it('exact match is bootable', () => {
    expect(evaluateSchemaCompatibility(through16, through16)).toMatchObject({
      state: 'match',
      ok: true,
      pending: [],
      mismatched: [],
      ahead: [],
    });
    expect(schemaIsExactHead({ ok: true, state: 'match' })).toBe(true);
  });

  it('a known pending file refuses', () => {
    expect(evaluateSchemaCompatibility(through16, through15)).toMatchObject({
      state: 'pending',
      ok: false,
      pending: ['0016_validate.sql'],
    });
  });

  it('checksum mismatch refuses even when names align', () => {
    const applied = [
      file('0013_outbox.sql'),
      file('0014_sandbox.sql', 'other'),
      file('0015_legacy.sql'),
    ];
    expect(evaluateSchemaCompatibility(image15, applied)).toMatchObject({
      state: 'mismatched',
      ok: false,
      mismatched: ['0014_sandbox.sql'],
    });
  });

  it('previous image through 0015 + declared 0016 is the N-1 window', () => {
    const ahead = evaluateSchemaCompatibility(image15, through16, declared16);
    expect(ahead).toMatchObject({
      state: 'ahead',
      ok: true,
      pending: [],
      ahead: ['0016_validate.sql'],
    });
    expect(schemaIsExactHead(ahead)).toBe(false);
  });

  it('undeclared extras, including a drop-everything next ordinal, refuse', () => {
    expect(evaluateSchemaCompatibility(image15, through16)).toMatchObject({
      state: 'incompatible',
      ok: false,
      ahead: ['0016_validate.sql'],
    });
    expect(
      evaluateSchemaCompatibility(image15, [...through15, file('0016_drop_everything.sql')]),
    ).toMatchObject({
      state: 'incompatible',
      ok: false,
    });
  });

  it('a skipped or duplicate ordinal chain is incompatible even when names match', () => {
    const skipped = [file('0013_a.sql'), file('0015_c.sql')];
    expect(evaluateSchemaCompatibility(skipped, skipped)).toMatchObject({
      state: 'incompatible',
      ok: false,
    });
    const dup = [file('0015_a.sql'), file('0015_b.sql')];
    expect(evaluateSchemaCompatibility(dup, dup)).toMatchObject({
      state: 'incompatible',
      ok: false,
    });
  });

  it('wrong prefix_head on a declared extra refuses', () => {
    expect(
      evaluateSchemaCompatibility(image15, through16, [
        { extraName: extra16.name, prefixHead: 'not-the-prefix' },
      ]),
    ).toMatchObject({ state: 'incompatible', ok: false });
  });
});

describe('N-1 SQL marker', () => {
  it('detects the exact comment line', () => {
    expect(isN1CompatibleSql(`${N1_COMPAT_MARKER}\nALTER TABLE t VALIDATE CONSTRAINT c;\n`)).toBe(
      true,
    );
    expect(isN1CompatibleSql('-- not a compat marker\nSELECT 1;\n')).toBe(false);
  });
});
