// Backup / export / QA-snapshot manifests (§8 "wrong-target protection is operational"):
// {game, env, takenAt, schemaHead, contractVersion}. Restore/import tooling validates a manifest
// against an EXPLICIT destination (--game --env) and refuses on mismatch before writing anything.

export interface BackupManifest {
  game: string;
  env: string;
  /** Epoch ms (matches QaImportBody.manifest.takenAt); ISO strings are accepted on read. */
  takenAt: number | string;
  schemaHead: string;
  contractVersion: string;
}

export interface Destination {
  game: string;
  env: string;
  /** When given, the manifest's schemaHead must match (restore into a schema at a different head is refused). */
  schemaHead?: string;
  /** When given, a contractVersion mismatch is reported as a warning (data is still importable). */
  contractVersion?: string;
}

export interface ManifestVerdict {
  ok: boolean;
  /** Hard refusals: exit 2. */
  refusals: string[];
  /** Soft notes (contract drift). */
  warnings: string[];
  manifest?: BackupManifest;
}

const REQUIRED: Array<keyof BackupManifest> = [
  'game',
  'env',
  'takenAt',
  'schemaHead',
  'contractVersion',
];

export function parseManifest(
  value: unknown,
): { ok: true; manifest: BackupManifest } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, problems: ['manifest must be a JSON object'] };
  const o = value as Record<string, unknown>;
  for (const k of REQUIRED) if (!(k in o)) problems.push(`manifest.${k} missing`);
  for (const k of ['game', 'env', 'schemaHead', 'contractVersion'] as const) {
    if (k in o && (typeof o[k] !== 'string' || (o[k] as string).length === 0))
      problems.push(`manifest.${k} must be a non-empty string`);
  }
  if ('takenAt' in o) {
    const t = o.takenAt;
    const okNum = typeof t === 'number' && Number.isFinite(t) && t >= 0;
    const okIso = typeof t === 'string' && Number.isFinite(Date.parse(t));
    if (!okNum && !okIso) problems.push('manifest.takenAt must be epoch ms or an ISO date string');
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    manifest: {
      game: o.game as string,
      env: o.env as string,
      takenAt: o.takenAt as number | string,
      schemaHead: o.schemaHead as string,
      contractVersion: o.contractVersion as string,
    },
  };
}

/** Refuse unless manifest.game/env (and schemaHead when pinned) equal the explicit destination. */
export function validateManifestAgainst(value: unknown, dest: Destination): ManifestVerdict {
  const parsed = parseManifest(value);
  if (!parsed.ok) return { ok: false, refusals: parsed.problems, warnings: [] };
  const m = parsed.manifest;
  const refusals: string[] = [];
  const warnings: string[] = [];
  if (m.game !== dest.game)
    refusals.push(
      `REFUSED: manifest is from game "${m.game}" but destination is game "${dest.game}"`,
    );
  if (m.env !== dest.env)
    refusals.push(`REFUSED: manifest is from env "${m.env}" but destination is env "${dest.env}"`);
  if (dest.schemaHead !== undefined && m.schemaHead !== dest.schemaHead)
    refusals.push(
      `REFUSED: manifest schemaHead "${m.schemaHead}" differs from destination schemaHead "${dest.schemaHead}"`,
    );
  if (dest.contractVersion !== undefined && m.contractVersion !== dest.contractVersion)
    warnings.push(
      `contractVersion ${m.contractVersion} differs from current ${dest.contractVersion} (check legacy fixture replay)`,
    );
  return { ok: refusals.length === 0, refusals, warnings, manifest: m };
}

export function makeManifest(input: {
  game: string;
  env: string;
  schemaHead: string;
  contractVersion: string;
  takenAt: number;
}): BackupManifest {
  return {
    game: input.game,
    env: input.env,
    takenAt: input.takenAt,
    schemaHead: input.schemaHead,
    contractVersion: input.contractVersion,
  };
}
