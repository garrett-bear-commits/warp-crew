// §8 / §9.3: restore/import manifest validated against an explicit destination; a dump from
// game=A env=prod is refused against game=B or env=lab (exit 2); a matching manifest is accepted.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseManifest,
  validateManifestAgainst,
  makeManifest,
  cliMain,
  readContractVersion,
} from '../src/index.ts';

const dump = makeManifest({
  game: 'a',
  env: 'prod',
  schemaHead: '0007',
  contractVersion: '1.0.0',
  takenAt: 1_700_000_000_000,
});

describe('validateManifestAgainst', () => {
  it('accepts a matching destination', () => {
    const v = validateManifestAgainst(dump, { game: 'a', env: 'prod' });
    expect(v.ok).toBe(true);
    expect(v.refusals).toEqual([]);
    expect(v.manifest).toEqual(dump);
  });

  it('refuses game=A env=prod against game=B, and against env=lab', () => {
    const wrongGame = validateManifestAgainst(dump, { game: 'b', env: 'prod' });
    expect(wrongGame.ok).toBe(false);
    expect(wrongGame.refusals[0]).toMatch(/game "a" but destination is game "b"/);
    const wrongEnv = validateManifestAgainst(dump, { game: 'a', env: 'lab' });
    expect(wrongEnv.ok).toBe(false);
    expect(wrongEnv.refusals[0]).toMatch(/env "prod" but destination is env "lab"/);
    const both = validateManifestAgainst(dump, { game: 'b', env: 'lab' });
    expect(both.refusals.length).toBe(2);
  });

  it('pins schemaHead when given; contractVersion drift is a warning, not a refusal', () => {
    expect(validateManifestAgainst(dump, { game: 'a', env: 'prod', schemaHead: '0007' }).ok).toBe(
      true,
    );
    const v = validateManifestAgainst(dump, { game: 'a', env: 'prod', schemaHead: '0008' });
    expect(v.ok).toBe(false);
    expect(v.refusals[0]).toMatch(/schemaHead "0007" differs/);
    const drift = validateManifestAgainst(dump, {
      game: 'a',
      env: 'prod',
      contractVersion: '2.0.0',
    });
    expect(drift.ok).toBe(true);
    expect(drift.warnings[0]).toMatch(/contractVersion 1.0.0 differs from current 2.0.0/);
  });

  it('rejects malformed manifests (missing keys, wrong types) — no destination match can rescue them', () => {
    expect(parseManifest(null).ok).toBe(false);
    expect(parseManifest({ game: 'a' }).ok).toBe(false);
    const missing = validateManifestAgainst({ game: 'a', env: 'prod' }, { game: 'a', env: 'prod' });
    expect(missing.ok).toBe(false);
    expect(missing.refusals.join('\n')).toMatch(/takenAt missing/);
    expect(missing.refusals.join('\n')).toMatch(/schemaHead missing/);
    const badTime = validateManifestAgainst(
      { ...dump, takenAt: 'yesterday' },
      { game: 'a', env: 'prod' },
    );
    expect(badTime.ok).toBe(false);
    const isoTime = validateManifestAgainst(
      { ...dump, takenAt: '2026-08-17T00:00:00Z' },
      { game: 'a', env: 'prod' },
    );
    expect(isoTime.ok).toBe(true);
    const emptyGame = validateManifestAgainst({ ...dump, game: '' }, { game: '', env: 'prod' });
    expect(emptyGame.ok).toBe(false);
  });

  it('CLI manifest-write then manifest-check: exit 0 on match, 2 on mismatch, 1 on unreadable', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'foundation-manifest-'));
    try {
      const file = join(tmp, 'backup', 'manifest.json');
      const lines: string[] = [];
      const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
      expect(
        await cliMain(
          [
            'manifest-write',
            '--game',
            'a',
            '--env',
            'prod',
            '--schema-head',
            '0007',
            '--out',
            file,
            '--now',
            '1700000000000',
          ],
          io,
        ),
      ).toBe(0);
      const written = JSON.parse(readFileSync(file, 'utf8'));
      expect(written).toEqual({
        game: 'a',
        env: 'prod',
        takenAt: 1700000000000,
        schemaHead: '0007',
        contractVersion: readContractVersion(),
      });

      expect(
        await cliMain(['manifest-check', '--manifest', file, '--game', 'a', '--env', 'prod'], io),
      ).toBe(0);
      expect(lines.join('\n')).toContain('manifest-check: OK');
      lines.length = 0;
      expect(
        await cliMain(['manifest-check', '--manifest', file, '--game', 'b', '--env', 'prod'], io),
      ).toBe(2);
      expect(lines.join('\n')).toMatch(
        /REFUSED: manifest is from game "a" but destination is game "b"/,
      );
      expect(lines.join('\n')).toContain('nothing was written');
      lines.length = 0;
      expect(
        await cliMain(['manifest-check', '--manifest', file, '--game', 'a', '--env', 'lab'], io),
      ).toBe(2);
      expect(lines.join('\n')).toMatch(/env "prod" but destination is env "lab"/);
      lines.length = 0;
      expect(
        await cliMain(
          [
            'manifest-check',
            '--manifest',
            file,
            '--game',
            'a',
            '--env',
            'prod',
            '--schema-head',
            '0009',
          ],
          io,
        ),
      ).toBe(2);
      lines.length = 0;
      writeFileSync(join(tmp, 'broken.json'), '{not json');
      expect(
        await cliMain(
          [
            'manifest-check',
            '--manifest',
            join(tmp, 'broken.json'),
            '--game',
            'a',
            '--env',
            'prod',
          ],
          io,
        ),
      ).toBe(1);
      expect(await cliMain(['manifest-check', '--manifest', file, '--game', 'a'], io)).toBe(1);
      expect(lines.join('\n')).toContain('--env <value> is required');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
