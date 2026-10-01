// Scaffolds (§10 new-server, ADR-013 new-feature). Pure-ish: paths are injectable so tests
// scaffold into a temp dir. Nothing here edits registries (games.ts, server.ts) — the exact line
// to add is printed instead.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { repoRoot } from './paths.ts';

export const GAME_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
export const FEATURE_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function camelCase(id: string): string {
  const parts = id.split(/[-_]+/).filter(Boolean);
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
}

export function pascalCase(id: string): string {
  const c = camelCase(id);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Replace `template`/`Template` identifiers with the new game id (camel / Pascal). */
export function renameTemplateSource(src: string, gameId: string): string {
  return src
    .replace(/\btemplateGame\b/g, `${camelCase(gameId)}Game`)
    .replace(/\btemplatePolicy\b/g, `${camelCase(gameId)}Policy`)
    .replace(/\btemplateGrants\b/g, `${camelCase(gameId)}Grants`)
    .replace(/gameId: 'template'/g, `gameId: '${gameId}'`)
    .replace(/GAME_ID=template\b/g, `GAME_ID=${gameId}`)
    .replace(/\bTemplate game\b/g, `${pascalCase(gameId)} game`)
    .replace(/\bTemplateSave\b/g, `${pascalCase(gameId)}Save`);
}

function copyTree(
  from: string,
  to: string,
  transform: (rel: string, src: string) => string,
): string[] {
  const written: string[] = [];
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dst = join(to, entry);
    if (statSync(src).isDirectory()) {
      written.push(...copyTree(src, dst, (rel, s) => transform(`${entry}/${rel}`, s)));
      continue;
    }
    const content = readFileSync(src, 'utf8');
    writeFileSync(dst, transform(entry, content));
    written.push(dst);
  }
  return written;
}

export interface NewServerResult {
  dir: string;
  files: string[];
  registryLine: string;
  importLines: string[];
  checklist: string[];
}

export function scaffoldGameServer(opts: {
  gameId: string;
  gamesDir?: string;
  templateDir?: string;
}): NewServerResult {
  const { gameId } = opts;
  if (!GAME_ID_RE.test(gameId) || gameId.length > 64)
    throw new Error(`game id must match ${GAME_ID_RE.source} (≤ 64 chars)`);
  if (gameId === 'template') throw new Error('"template" is the source game; pick another id');
  const root = repoRoot();
  const gamesDir = opts.gamesDir ?? resolve(root, 'apps/server/games');
  const templateDir = opts.templateDir ?? resolve(root, 'apps/server/games/template');
  if (!existsSync(join(templateDir, 'game.config.ts')))
    throw new Error(`template dir ${templateDir} lacks game.config.ts`);
  const dir = join(gamesDir, gameId);
  if (existsSync(dir)) throw new Error(`${dir} already exists; refusing to overwrite`);
  const files = copyTree(templateDir, dir, (_rel, src) => renameTemplateSource(src, gameId));
  const camel = camelCase(gameId);
  const relDir = `../games/${gameId}`;
  return {
    dir,
    files: files.sort(),
    importLines: [
      `import { ${camel}Game } from '${relDir}/game.config.ts';`,
      `import { ${camel}Policy } from '${relDir}/policy.ts';`,
    ],
    registryLine: `  '${gameId}': { game: ${camel}Game, policy: ${camel}Policy },`,
    checklist: clientChecklist(gameId),
  };
}

/** §10: the written half-day client checklist (game id, aud, secrets, PITR, Sentry, monitor, host). */
export function clientChecklist(gameId: string): string[] {
  return [
    `Half-day checklist for game "${gameId}" (§10):`,
    `  1. Game id: GAME_ID=${gameId} in the service env (or GAME_ID=<platform audience> with GAME_CONFIG=${gameId}); add the registry line to apps/server/src/games.ts.`,
    `  2. Audience: confirm the platform token \`aud\` for ${gameId} and pin it in the game config / identity provider.`,
    `  3. Secrets: JEST_JWS_SECRETS (base64 ≥ 16 bytes, newest first), OPS_SECRET (≥ 16 chars), ADMIN_KEYS (sha256 hex + scopes) — run \`foundation preflight --env-file <path>\`.`,
    `  4. Database: one Postgres per game per env; enable PITR before first traffic; record the backup/sleep settings.`,
    `  5. Sentry: create the server project, set SENTRY_DSN, tag releases with BUILD_VERSION.`,
    `  6. Monitor: point the external uptime check at /health/ops?assert=page with the ops secret; one cron monitor reading job_runs.`,
    `  7. Host: pick the static host for the client (hashed assets + no-cache index.html via \`foundation deploy-static\`), set CLIENT_ORIGINS + PUBLIC_URL, add the entry to fleet.json.`,
    `  8. Grants: list the rewards the client applies in games/${gameId}/grants.ts and point the admin inspector and admin CLI at it.`,
    `  9. Verify: \`foundation check-health --url <api> --assert page --ops-secret <s>\` green on Lab, then a canary write/read with a qa_ identity.`,
  ];
}

export interface NewFeatureResult {
  dir: string;
  files: string[];
  compositionLines: string[];
}

export function featureSources(
  name: string,
): Record<'contract.ts' | 'server.ts' | 'client.ts', string> {
  const pascal = pascalCase(name);
  const camel = camelCase(name);
  return {
    'contract.ts': [
      `// ${name} contract entry (isomorphic): re-export the feature's types and closed enums from`,
      `// @foundation/contracts here once they exist. Other features may import ONLY this file (ADR-013).`,
      `export {};`,
      ``,
    ].join('\n'),
    'server.ts': [
      `// ${name} feature (§4.3): declare commands with defineCommand, register handlers on ctx.bus,`,
      `// mount routes with route(). Registers nothing yet.`,
      `import type { FastifyInstance } from 'fastify';`,
      `import type { AppContext } from '../../http/context.ts';`,
      ``,
      `export function register${pascal}(_app: FastifyInstance, _ctx: AppContext): void {}`,
      ``,
    ].join('\n'),
    'client.ts': [
      `// ${name} client entry (browser-safe): thin fetch wrapper over the feature routes, types only.`,
      `import type { Api } from '../../http/client-fetch.ts';`,
      ``,
      `export function ${camel}Client(_api: Api) {`,
      `  return {};`,
      `}`,
      ``,
    ].join('\n'),
  };
}

export function scaffoldFeature(opts: { name: string; featuresDir?: string }): NewFeatureResult {
  const { name } = opts;
  if (!FEATURE_NAME_RE.test(name))
    throw new Error(`feature name must match ${FEATURE_NAME_RE.source}`);
  const featuresDir = opts.featuresDir ?? resolve(repoRoot(), 'packages/server/src/features');
  const dir = join(featuresDir, name);
  if (existsSync(dir)) throw new Error(`${dir} already exists; refusing to overwrite`);
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const [file, src] of Object.entries(featureSources(name))) {
    const p = join(dir, file);
    writeFileSync(p, src);
    files.push(p);
  }
  const pascal = pascalCase(name);
  return {
    dir,
    files,
    compositionLines: [
      `import { register${pascal} } from './features/${name}/server.ts';`,
      `register${pascal}(app, ctx); // packages/server/src/server.ts, after the existing register* calls`,
    ],
  };
}

/** Relative display path from repo root (posix separators). */
export function displayPath(p: string): string {
  return relative(repoRoot(), p).split(sep).join('/');
}
