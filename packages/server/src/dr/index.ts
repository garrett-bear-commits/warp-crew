// Disaster-recovery primitives (§8, audit F4). Three distinct facts, three distinct markers:
//  - live_integrity_verified_at: the LIVE database's newest anchored blobs re-hash correctly (a
//    weekly self-check; it says nothing about backups).
//  - restore_verified_at: written ONLY after `verifyIsolatedRestore` succeeded against a database
//    restored elsewhere (PITR / dump) whose manifest names THIS game + environment.
//  - erasure tombstones: `exportErasures` writes the erasure ledger (mirrored with backups) and
//    `replayErasures` re-applies it after any restore so erased players stay erased.
// Managed PITR / object storage stay external; everything here runs against plain Postgres URLs and
// files so it is testable locally.
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import type { Q } from '../db/index.ts';
import { checkSchema, schemaIsExactHead } from '../db/migrate.ts';
import { sha256Hex } from '../db/canonical.ts';

export interface BackupManifest {
  game: string;
  env: string;
  takenAt: number;
  schemaHead: string;
  contractVersion: string;
}

export interface LiveIntegrityReport {
  sampled: number;
  ok: number;
  verified: boolean;
  at: number;
}

/** Re-hash the newest anchored blobs on the LIVE database and mark live_integrity_verified_at. */
export async function verifyLiveIntegrity(
  q: Q,
  now: number,
  sampleSize = 50,
): Promise<LiveIntegrityReport> {
  const rows = await q<
    { id: string; blob_sha256: string }[]
  >`SELECT s.id, s.blob_sha256 FROM save_snapshots s JOIN save_blobs b ON b.save_id = s.id WHERE s.disposition = 'anchored' ORDER BY s.received_at DESC LIMIT ${sampleSize}`;
  let ok = 0;
  const mismatched: string[] = [];
  for (const r of rows) {
    const b = await q<{ blob: Buffer }[]>`SELECT blob FROM save_blobs WHERE save_id = ${r.id}`;
    if (b[0] && sha256Hex(b[0].blob.toString('utf8')) === r.blob_sha256) ok++;
    else mismatched.push(r.id);
  }
  const verified = ok === rows.length;
  // A mismatch fails the job, so the runner logs and captures it with the save ids.
  if (!verified)
    throw new Error(
      `live integrity: ${mismatched.length} of ${rows.length} anchored blobs failed re-hash (save ids ${mismatched.slice(0, 20).join(', ')})`,
    );
  if (verified) {
    await q`INSERT INTO ops_markers (key, value) VALUES ('live_integrity_verified_at', ${q.json({ at: now, sampled: rows.length })}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }
  return { sampled: rows.length, ok, verified, at: now };
}

export interface RestoreVerifyInput {
  /** Connection URL of the RESTORED (isolated) database — never the live one. */
  restoredUrl: string;
  /** Manifest that travelled with the backup. */
  manifest: BackupManifest;
  /** Explicit destination the operator names; refuse on mismatch before reading anything. */
  destination: { game: string; env: string };
  /** Expected schema head (disk migrations); the restored DB must be at head. */
  sampleSize?: number;
  /** Erasure tombstones exported from the live database, replayed into the restored copy. */
  erasures?: ErasureRecord[];
}

export interface RestoreVerifyReport {
  ok: boolean;
  checks: {
    manifestMatchesDestination: boolean;
    schemaAtHead: boolean;
    schemaHead: string | null;
    blobsSampled: number;
    blobsOk: number;
    anchorsReadable: boolean;
    erasuresReplayed: number;
  };
  problems: string[];
}

/**
 * Verify a database restored somewhere else: manifest names this game/env, schema is at head,
 * anchored blobs re-hash, the anchor query runs, erasure tombstones replay. Nothing is written to
 * the live database here; the caller records `restore_verified_at` (see markRestoreVerified) only
 * when `ok`.
 */
export async function verifyIsolatedRestore(
  input: RestoreVerifyInput,
): Promise<RestoreVerifyReport> {
  const problems: string[] = [];
  const manifestMatchesDestination =
    input.manifest.game === input.destination.game && input.manifest.env === input.destination.env;
  if (!manifestMatchesDestination) {
    problems.push(
      `manifest is for ${input.manifest.game}/${input.manifest.env}, destination is ${input.destination.game}/${input.destination.env}`,
    );
    return {
      ok: false,
      checks: {
        manifestMatchesDestination,
        schemaAtHead: false,
        schemaHead: null,
        blobsSampled: 0,
        blobsOk: 0,
        anchorsReadable: false,
        erasuresReplayed: 0,
      },
      problems,
    };
  }
  const sql = postgres(input.restoredUrl, { max: 1, onnotice: () => {} });
  try {
    const st = await checkSchema(sql);
    const atExactHead = schemaIsExactHead(st);
    if (!atExactHead)
      problems.push(
        `restored schema not at exact head: state=${st.state} pending=[${st.pending.join(',')}] mismatched=[${st.mismatched.join(',')}] ahead=[${st.ahead.join(',')}]`,
      );
    if (input.manifest.schemaHead && st.head && input.manifest.schemaHead !== st.head)
      problems.push(
        `manifest schemaHead ${input.manifest.schemaHead.slice(0, 12)} ≠ restored ${st.head.slice(0, 12)}`,
      );
    const rows = await sql<
      { id: string; blob_sha256: string }[]
    >`SELECT s.id, s.blob_sha256 FROM save_snapshots s JOIN save_blobs b ON b.save_id = s.id WHERE s.disposition = 'anchored' ORDER BY s.received_at DESC LIMIT ${input.sampleSize ?? 50}`;
    let blobsOk = 0;
    for (const r of rows) {
      const b = await sql<{ blob: Buffer }[]>`SELECT blob FROM save_blobs WHERE save_id = ${r.id}`;
      if (b[0] && sha256Hex(b[0].blob.toString('utf8')) === r.blob_sha256) blobsOk++;
    }
    if (blobsOk !== rows.length)
      problems.push(`${rows.length - blobsOk} anchored blob(s) failed re-hash`);
    let anchorsReadable = false;
    try {
      await sql`SELECT count(*) FROM (SELECT DISTINCT ON (player_key) player_key FROM save_snapshots WHERE disposition = 'anchored' ORDER BY player_key, progress DESC LIMIT 1) x`;
      anchorsReadable = true;
    } catch (e) {
      problems.push(`anchor query failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    let erasuresReplayed = 0;
    if (input.erasures && input.erasures.length) {
      const r = await replayErasures(sql as unknown as Q, input.erasures, 'restore-verify');
      erasuresReplayed = r.applied;
      if (r.failed.length) problems.push(`erasure replay failed for ${r.failed.join(', ')}`);
    }
    return {
      ok: problems.length === 0,
      checks: {
        manifestMatchesDestination,
        schemaAtHead: atExactHead,
        schemaHead: st.head,
        blobsSampled: rows.length,
        blobsOk,
        anchorsReadable,
        erasuresReplayed,
      },
      problems,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Record a successful isolated-restore verification on the LIVE database (ops reads it). */
export async function markRestoreVerified(
  q: Q,
  report: RestoreVerifyReport,
  now: number,
): Promise<void> {
  if (!report.ok)
    throw new Error('refusing to mark restore_verified_at: verification did not pass');
  await q`INSERT INTO ops_markers (key, value) VALUES ('restore_verified_at', ${q.json({ at: now, checks: report.checks } as never)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

// ─── erasure tombstones ─────────────────────────────────────────────────────

export interface ErasureRecord {
  playerKey: string;
  generation: number;
  reason: string;
  actor: string;
  ticketRef: string | null;
  at: number;
}

export interface ErasureExport {
  manifest: BackupManifest;
  erasures: ErasureRecord[];
}

export async function exportErasures(q: Q, manifest: BackupManifest): Promise<ErasureExport> {
  const rows = await q<
    {
      player_key: string;
      generation: number;
      reason: string;
      actor: string;
      ticket_ref: string | null;
      at: Date;
    }[]
  >`SELECT player_key, generation, reason, actor, ticket_ref, at FROM erasures ORDER BY at, id`;
  return {
    manifest,
    erasures: rows.map((r) => ({
      playerKey: r.player_key,
      generation: r.generation,
      reason: r.reason,
      actor: r.actor,
      ticketRef: r.ticket_ref,
      at: r.at.getTime(),
    })),
  };
}

export function writeErasureExport(path: string, e: ErasureExport): void {
  const lines = [
    JSON.stringify({ manifest: e.manifest }),
    ...e.erasures.map((r) => JSON.stringify(r)),
  ];
  writeFileSync(path, lines.join('\n') + '\n');
}

export function readErasureExport(path: string): ErasureExport {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const head = JSON.parse(lines[0] ?? '{}') as { manifest?: BackupManifest };
  if (!head.manifest) throw new Error('erasure export lacks a manifest header line');
  return {
    manifest: head.manifest,
    erasures: lines.slice(1).map((l) => JSON.parse(l) as ErasureRecord),
  };
}

/**
 * Re-apply erasure tombstones after a restore: for every record whose erasure is missing in the
 * target, run erase_player() and append the erasures row (idempotent by player+generation+at).
 */
export async function replayErasures(
  q: Q,
  records: readonly ErasureRecord[],
  actor: string,
): Promise<{ applied: number; alreadyPresent: number; failed: string[] }> {
  let applied = 0;
  let alreadyPresent = 0;
  const failed: string[] = [];
  for (const r of records) {
    try {
      const present = await q<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM erasures WHERE player_key = ${r.playerKey} AND generation = ${r.generation} AND at = ${new Date(r.at)}`;
      if ((present[0]?.n ?? 0) > 0) {
        alreadyPresent++;
        continue;
      }
      const n = await q<{ n: number }[]>`SELECT erase_player(${r.playerKey}) AS n`;
      await q`INSERT INTO players (player_key, erased_at) VALUES (${r.playerKey}, ${new Date(r.at)}) ON CONFLICT (player_key) DO UPDATE SET erased_at = COALESCE(players.erased_at, EXCLUDED.erased_at), entry_payload = NULL`;
      await q`INSERT INTO erasures (player_key, generation, reason, actor, ticket_ref, erased_rows, at) VALUES (${r.playerKey}, ${r.generation}, ${r.reason}, ${`${actor} (replay of ${r.actor})`}, ${r.ticketRef}, ${n[0]?.n ?? 0}, ${new Date(r.at)})`;
      applied++;
    } catch (e) {
      failed.push(`${r.playerKey}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { applied, alreadyPresent, failed };
}
