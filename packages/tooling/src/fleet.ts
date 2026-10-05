// fleet.json (§8): one host-neutral entry per game/env consumed by check-health, deploy,
// restore-verify and the cost line. Shape only — no provider identifiers (ADR-023).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './paths.ts';

export interface FleetEntry {
  name: string;
  game: string;
  env: 'prod' | 'lab' | 'dev';
  apiUrl: string;
  staticUrl: string;
}

export interface FleetFile {
  fleet: FleetEntry[];
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const ENVS = ['prod', 'lab', 'dev'] as const;

function isHttpUrl(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateFleet(value: unknown): {
  ok: boolean;
  problems: string[];
  fleet: FleetEntry[];
} {
  const problems: string[] = [];
  const fleet: FleetEntry[] = [];
  if (!value || typeof value !== 'object' || !Array.isArray((value as FleetFile).fleet)) {
    return { ok: false, problems: ['fleet.json must be {"fleet": [ ... ]}'], fleet };
  }
  const seen = new Set<string>();
  (value as { fleet: unknown[] }).fleet.forEach((raw, i) => {
    const e = (raw ?? {}) as Partial<FleetEntry>;
    const at = `fleet[${i}]`;
    if (typeof e.name !== 'string' || !NAME_RE.test(e.name))
      problems.push(`${at}.name must match ${NAME_RE.source}`);
    else if (seen.has(e.name)) problems.push(`${at}.name "${e.name}" duplicated`);
    else seen.add(e.name);
    if (typeof e.game !== 'string' || !NAME_RE.test(e.game))
      problems.push(`${at}.game must match ${NAME_RE.source}`);
    if (!(ENVS as readonly string[]).includes(String(e.env)))
      problems.push(`${at}.env must be ${ENVS.join('|')}`);
    if (!isHttpUrl(e.apiUrl)) problems.push(`${at}.apiUrl must be an http(s) URL`);
    if (!isHttpUrl(e.staticUrl)) problems.push(`${at}.staticUrl must be an http(s) URL`);
    const extra = Object.keys(e).filter(
      (k) => !['name', 'game', 'env', 'apiUrl', 'staticUrl'].includes(k),
    );
    if (extra.length)
      problems.push(`${at} has unknown fields: ${extra.join(', ')} (keep entries host-neutral)`);
    if (
      typeof e.name === 'string' &&
      typeof e.game === 'string' &&
      typeof e.apiUrl === 'string' &&
      typeof e.staticUrl === 'string' &&
      (ENVS as readonly string[]).includes(String(e.env))
    )
      fleet.push({
        name: e.name,
        game: e.game,
        env: e.env as FleetEntry['env'],
        apiUrl: e.apiUrl,
        staticUrl: e.staticUrl,
      });
  });
  return { ok: problems.length === 0, problems, fleet };
}

export function loadFleet(
  path = resolve(repoRoot(), 'fleet.json'),
): ReturnType<typeof validateFleet> {
  return validateFleet(JSON.parse(readFileSync(path, 'utf8')));
}
