// new-server / new-feature scaffolds into a temp dir; registry lines are printed, never written.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scaffoldGameServer,
  scaffoldFeature,
  featureSources,
  renameTemplateSource,
  camelCase,
  pascalCase,
  cliMain,
} from '../src/index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'foundation-scaffold-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('naming', () => {
  it('camel/pascal from game ids', () => {
    expect(camelCase('my-game_two')).toBe('myGameTwo');
    expect(pascalCase('my-game')).toBe('MyGame');
    expect(pascalCase('inbox')).toBe('Inbox');
  });
  it('renameTemplateSource swaps identifiers only', () => {
    const src =
      "export const templateGame = { gameId: 'template' }; // Template game\nGAME_ID=template\ntemplatePolicy TemplateSave";
    const out = renameTemplateSource(src, 'puzzle-x');
    expect(out).toBe(
      "export const puzzleXGame = { gameId: 'puzzle-x' }; // PuzzleX game\nGAME_ID=puzzle-x\npuzzleXPolicy PuzzleXSave",
    );
  });
});

describe('scaffoldGameServer', () => {
  it('copies games/template into games/<id> with renamed identifiers and prints the registry line', () => {
    const gamesDir = join(tmp, 'games');
    const r = scaffoldGameServer({ gameId: 'puzzle-x', gamesDir });
    expect(r.dir).toBe(join(gamesDir, 'puzzle-x'));
    for (const f of [
      'game.config.ts',
      'policy.ts',
      'content/achievements.ts',
      'content/daily-rewards.ts',
      '.env.example',
    ]) {
      expect(existsSync(join(r.dir, f)), f).toBe(true);
    }
    const cfg = readFileSync(join(r.dir, 'game.config.ts'), 'utf8');
    expect(cfg).toContain('export const puzzleXGame');
    expect(cfg).toContain("gameId: 'puzzle-x'");
    expect(cfg).not.toMatch(/templateGame|gameId: 'template'/);
    const policy = readFileSync(join(r.dir, 'policy.ts'), 'utf8');
    expect(policy).toContain('export const puzzleXPolicy');
    expect(policy).not.toContain('templatePolicy');
    const env = readFileSync(join(r.dir, '.env.example'), 'utf8');
    expect(env).toContain('GAME_ID=puzzle-x');
    expect(r.registryLine).toBe("  'puzzle-x': { game: puzzleXGame, policy: puzzleXPolicy },");
    expect(r.importLines[0]).toContain("from '../games/puzzle-x/game.config.ts'");
    expect(r.checklist.join('\n')).toMatch(/aud/);
    expect(r.checklist.join('\n')).toMatch(/PITR/);
    expect(r.checklist.join('\n')).toMatch(/Sentry/);
    expect(r.checklist.join('\n')).toMatch(/[Mm]onitor/);
    expect(r.checklist.join('\n')).toMatch(/[Hh]ost/);
    // the real games.ts registry was not touched
    expect(readFileSync(resolve(root, 'apps/server/src/games.ts'), 'utf8')).not.toContain(
      'puzzle-x',
    );
  });

  it('refuses bad ids, "template", and existing dirs', () => {
    const gamesDir = join(tmp, 'games');
    expect(() => scaffoldGameServer({ gameId: 'Bad Id', gamesDir })).toThrow(/game id must match/);
    expect(() => scaffoldGameServer({ gameId: 'template', gamesDir })).toThrow(/source game/);
    scaffoldGameServer({ gameId: 'dup', gamesDir });
    expect(() => scaffoldGameServer({ gameId: 'dup', gamesDir })).toThrow(/already exists/);
  });

  it('CLI new-server prints files, registry line and checklist', async () => {
    const lines: string[] = [];
    const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
    expect(await cliMain(['new-server', '--game', 'runner', '--dir', join(tmp, 'g')], io)).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain("'runner': { game: runnerGame, policy: runnerPolicy },");
    expect(out).toContain('Half-day checklist for game "runner"');
    expect(readdirSync(join(tmp, 'g', 'runner')).sort()).toEqual([
      '.env.example',
      'content',
      'game.config.ts',
      'grants.ts',
      'policy.ts',
    ]);
  });
});

describe('scaffoldFeature', () => {
  it('writes contract/server/client entry points that satisfy the feature-shape guard', () => {
    const featuresDir = join(tmp, 'features');
    const r = scaffoldFeature({ name: 'gifts', featuresDir });
    expect(r.files.map((f) => f.slice(r.dir.length + 1)).sort()).toEqual([
      'client.ts',
      'contract.ts',
      'server.ts',
    ]);
    const server = readFileSync(join(r.dir, 'server.ts'), 'utf8');
    expect(server).toContain(
      'export function registerGifts(_app: FastifyInstance, _ctx: AppContext): void',
    );
    const client = readFileSync(join(r.dir, 'client.ts'), 'utf8');
    expect(client).toContain('export function giftsClient(_api: Api)');
    expect(client).not.toMatch(/from 'node:|@sinclair\/typebox/);
    const contract = readFileSync(join(r.dir, 'contract.ts'), 'utf8');
    expect(contract).toContain('export {};');
    // no cross-feature implementation imports (ADR-013)
    for (const f of r.files)
      expect(readFileSync(f, 'utf8')).not.toMatch(/from '\.\.\/[a-z]+\/(server|client)\.ts'/);
    expect(r.compositionLines[0]).toBe(
      "import { registerGifts } from './features/gifts/server.ts';",
    );
    expect(r.compositionLines[1]).toContain('registerGifts(app, ctx);');
    expect(() => scaffoldFeature({ name: 'gifts', featuresDir })).toThrow(/already exists/);
    expect(() => scaffoldFeature({ name: 'Gifts', featuresDir })).toThrow(
      /feature name must match/,
    );
    expect(featureSources('two-words')['server.ts']).toContain('registerTwoWords');
    expect(featureSources('two-words')['client.ts']).toContain('twoWordsClient');
  });

  it('CLI new-feature prints the composition-root line', async () => {
    const lines: string[] = [];
    const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
    expect(await cliMain(['new-feature', '--name', 'gifts', '--dir', join(tmp, 'f')], io)).toBe(0);
    expect(lines.join('\n')).toContain(
      "import { registerGifts } from './features/gifts/server.ts';",
    );
    expect(existsSync(resolve(root, 'packages/server/src/features/gifts'))).toBe(false);
  });
});
