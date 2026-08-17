// Core repository SQL for snapshots/generations (lifted from Barrowdeep saves.repository.ts, generalised);
// shared by the saves, lineage and admin features (not a feature entry point).
// All player-scoped writes run inside a command tx that already holds the player lock.
import type { Q, Tx } from './index.ts';
import type { SnapshotMeta, Summary } from '@foundation/contracts';
import type {
  GenerationKind,
  SaveDisposition,
  SaveEncoding,
  SaveFlag,
  SaveReason,
  SaveRefusalReason,
} from '@foundation/contracts/enums';
import type { StoredHead, LastRow } from '../features/saves/placement.ts';

export interface GenerationRow {
  generation: number;
  kind: GenerationKind;
  restart_id: string | null;
  seed_seq: string | null;
  entitlement: number;
  opened_at: Date;
}

/** Ensure the player has a lineage; returns the active generation. */
export async function ensureLineage(
  tx: Tx,
  playerKey: string,
  actor: string,
): Promise<GenerationRow> {
  const rows = await tx<
    GenerationRow[]
  >`SELECT generation, kind, restart_id, seed_seq, entitlement, opened_at FROM generations WHERE player_key = ${playerKey} ORDER BY generation DESC LIMIT 1`;
  if (rows[0]) return rows[0];
  const ins = await tx<
    GenerationRow[]
  >`INSERT INTO generations (player_key, generation, kind, actor) VALUES (${playerKey}, 0, 'initial', ${actor}) RETURNING generation, kind, restart_id, seed_seq, entitlement, opened_at`;
  return ins[0]!;
}

export async function activeGeneration(q: Q, playerKey: string): Promise<GenerationRow | null> {
  const rows = await q<
    GenerationRow[]
  >`SELECT generation, kind, restart_id, seed_seq, entitlement, opened_at FROM generations WHERE player_key = ${playerKey} ORDER BY generation DESC LIMIT 1`;
  return rows[0] ?? null;
}

interface HeadRow {
  seq: string;
  progress: string;
  session_id: string;
  saved_at: Date;
  received_at: Date;
  schema_version: number;
  summary: Summary | null;
}

/** Deepest anchored (or promoted) row WITH a blob in the given generation. */
export async function storedHead(
  q: Q,
  playerKey: string,
  generation: number,
): Promise<StoredHead | null> {
  const rows = await q<HeadRow[]>`
    SELECT s.seq, s.progress, s.session_id, s.saved_at, s.received_at, s.schema_version, s.summary
    FROM save_snapshots s
    WHERE s.player_key = ${playerKey} AND s.generation = ${generation}
      AND EXISTS (SELECT 1 FROM save_blobs b WHERE b.save_id = s.id)
      AND (s.disposition = 'anchored' OR EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = s.id AND r.action = 'promote'))
    ORDER BY s.progress DESC, s.seq DESC LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  return {
    seq: Number(r.seq),
    progress: Number(r.progress),
    sessionId: r.session_id,
    savedAt: r.saved_at.getTime(),
    receivedAt: r.received_at.getTime(),
    schemaVersion: r.schema_version,
    ...(r.summary ? { summary: r.summary } : {}),
  };
}

export async function lastRow(q: Q, playerKey: string): Promise<LastRow | null> {
  const rows = await q<
    { seq: string }[]
  >`SELECT seq FROM save_snapshots WHERE player_key = ${playerKey} ORDER BY seq DESC LIMIT 1`;
  return rows[0] ? { seq: Number(rows[0].seq) } : null;
}

export interface InsertSnapshot {
  playerKey: string;
  generation: number;
  seq: number;
  clientSeq: number;
  baseSeq: number;
  sessionId: string;
  commandId: string;
  progress: number;
  savedAt: number;
  bytes: number;
  encBytes: number;
  blobSha256: string;
  schemaVersion: number;
  buildVersion: string;
  source: 'client' | 'beacon' | 'restore' | 'admin' | 'qa_import' | 'reattach';
  disposition: Exclude<SaveDisposition, 'duplicate'>;
  rejectReason: SaveRefusalReason | null;
  flags: SaveFlag[];
  summary: Summary | null;
  enc: SaveEncoding;
  reason: SaveReason;
  /** canonical JSON */
  blobJson: string | null;
}

export async function insertSnapshot(tx: Tx, s: InsertSnapshot): Promise<number> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO save_snapshots (player_key, generation, seq, client_seq, base_seq, session_id, command_id, progress, client_progress, saved_at, bytes, enc_bytes, blob_sha256, schema_version, build_version, source, disposition, reject_reason, flags, summary, enc, reason)
    VALUES (${s.playerKey}, ${s.generation}, ${s.seq}, ${s.clientSeq}, ${s.baseSeq}, ${s.sessionId}, ${s.commandId}, ${s.progress}, ${s.progress}, ${new Date(s.savedAt)}, ${s.bytes}, ${s.encBytes}, ${s.blobSha256}, ${s.schemaVersion}, ${s.buildVersion}, ${s.source}, ${s.disposition}, ${s.rejectReason}, ${s.flags}, ${s.summary ? tx.json(s.summary as never) : null}, ${s.enc}, ${s.reason})
    RETURNING id`;
  const id = Number(rows[0]!.id);
  if (s.blobJson !== null)
    await tx`INSERT INTO save_blobs (save_id, blob) VALUES (${id}, ${Buffer.from(s.blobJson, 'utf8')})`;
  return id;
}

export async function refusedBlobsThisHour(q: Q, playerKey: string, now: number): Promise<number> {
  const rows = await q<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM save_snapshots s JOIN save_blobs b ON b.save_id = s.id WHERE s.player_key = ${playerKey} AND s.disposition = 'stored_refused' AND s.received_at >= ${new Date(now - 3_600_000)}`;
  return rows[0]?.n ?? 0;
}

export interface SnapshotRow {
  id: string;
  seq: string;
  generation: number;
  progress: string;
  client_seq: string;
  base_seq: string;
  session_id: string;
  command_id: string;
  saved_at: Date;
  received_at: Date;
  bytes: number;
  enc_bytes: number;
  blob_sha256: string;
  schema_version: number;
  build_version: string;
  reason: SaveReason;
  disposition: Exclude<SaveDisposition, 'duplicate'>;
  reject_reason: SaveRefusalReason | null;
  flags: SaveFlag[];
  summary: Summary | null;
  enc: SaveEncoding;
  has_blob: boolean;
  review_action: 'promote' | 'reject' | null;
  review_at: Date | null;
}

const SNAPSHOT_COLS = `s.id, s.seq, s.generation, s.progress, s.client_seq, s.base_seq, s.session_id, s.command_id, s.saved_at, s.received_at, s.bytes, s.enc_bytes, s.blob_sha256, s.schema_version, s.build_version, s.reason, s.disposition, s.reject_reason, s.flags, s.summary, s.enc,
  EXISTS (SELECT 1 FROM save_blobs b WHERE b.save_id = s.id) AS has_blob,
  (SELECT r.action FROM save_reviews r WHERE r.save_id = s.id) AS review_action,
  (SELECT r.at FROM save_reviews r WHERE r.save_id = s.id) AS review_at`;

export function toMeta(r: SnapshotRow): SnapshotMeta {
  const m: SnapshotMeta = {
    seq: Number(r.seq),
    generation: r.generation,
    progress: Number(r.progress),
    clientSeq: Number(r.client_seq),
    baseSeq: Number(r.base_seq),
    sessionId: r.session_id,
    commandId: r.command_id,
    savedAt: r.saved_at.getTime(),
    receivedAt: r.received_at.getTime(),
    bytes: r.bytes,
    encBytes: r.enc_bytes,
    blobSha256: r.blob_sha256,
    schemaVersion: r.schema_version,
    buildVersion: r.build_version,
    reason: r.reason,
    disposition: r.disposition,
    flags: r.flags,
    hasBlob: r.has_blob,
  };
  if (r.reject_reason) m.rejectReason = r.reject_reason;
  if (r.summary) m.summary = r.summary;
  if (r.review_action && r.review_at)
    m.review = { action: r.review_action, at: r.review_at.getTime() };
  return m;
}

/** The read anchor: deepest anchored-or-promoted in the generation (blob or not — the anchor's blob is never pruned). */
export async function anchorRow(
  q: Q,
  playerKey: string,
  generation: number,
): Promise<SnapshotRow | null> {
  const rows = await q.unsafe<SnapshotRow[]>(
    `SELECT ${SNAPSHOT_COLS} FROM save_snapshots s
     WHERE s.player_key = $1 AND s.generation = $2
       AND (s.disposition = 'anchored' OR EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = s.id AND r.action = 'promote'))
     ORDER BY s.progress DESC, s.seq DESC LIMIT 1`,
    [playerKey, generation],
  );
  return rows[0] ?? null;
}

/** Deepest unreviewed quarantined row deeper than the anchor in the generation. */
export async function pendingQuarantineRow(
  q: Q,
  playerKey: string,
  generation: number,
  anchorProgress: number | null,
): Promise<SnapshotRow | null> {
  const rows = await q.unsafe<SnapshotRow[]>(
    `SELECT ${SNAPSHOT_COLS} FROM save_snapshots s
     WHERE s.player_key = $1 AND s.generation = $2 AND s.disposition = 'stored_quarantined'
       AND NOT EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = s.id)
       AND ($3::bigint IS NULL OR s.progress > $3::bigint)
     ORDER BY s.progress DESC, s.seq DESC LIMIT 1`,
    [playerKey, generation, anchorProgress],
  );
  return rows[0] ?? null;
}

export async function snapshotBySeq(
  q: Q,
  playerKey: string,
  seq: number,
): Promise<SnapshotRow | null> {
  const rows = await q.unsafe<SnapshotRow[]>(
    `SELECT ${SNAPSHOT_COLS} FROM save_snapshots s WHERE s.player_key = $1 AND s.seq = $2`,
    [playerKey, seq],
  );
  return rows[0] ?? null;
}

export async function blobById(q: Q, id: number): Promise<string | null> {
  const rows = await q<{ blob: Buffer }[]>`SELECT blob FROM save_blobs WHERE save_id = ${id}`;
  return rows[0] ? rows[0].blob.toString('utf8') : null;
}

export async function history(
  q: Q,
  playerKey: string,
  generation: number | null,
  limit: number,
  beforeSeq: number | null,
): Promise<SnapshotRow[]> {
  return q.unsafe<SnapshotRow[]>(
    `SELECT ${SNAPSHOT_COLS} FROM save_snapshots s
     WHERE s.player_key = $1 AND ($2::int IS NULL OR s.generation = $2::int) AND ($3::bigint IS NULL OR s.seq < $3::bigint)
     ORDER BY s.seq DESC LIMIT $4`,
    [playerKey, generation, beforeSeq, limit],
  );
}

export async function openGeneration(
  tx: Tx,
  o: {
    playerKey: string;
    kind: GenerationKind;
    restartId?: string | null;
    seedSeq?: number | null;
    entitlement?: number;
    reason?: string | null;
    actor: string;
  },
): Promise<GenerationRow> {
  const cur = await activeGeneration(tx, o.playerKey);
  const next = (cur?.generation ?? -1) + 1;
  const rows = await tx<GenerationRow[]>`
    INSERT INTO generations (player_key, generation, kind, restart_id, seed_seq, entitlement, reason, actor)
    VALUES (${o.playerKey}, ${next}, ${o.kind}, ${o.restartId ?? null}, ${o.seedSeq ?? null}, ${o.entitlement ?? 0}, ${o.reason ?? null}, ${o.actor})
    RETURNING generation, kind, restart_id, seed_seq, entitlement, opened_at`;
  return rows[0]!;
}

export async function generationByRestartId(
  q: Q,
  playerKey: string,
  restartId: string,
): Promise<GenerationRow | null> {
  const rows = await q<
    GenerationRow[]
  >`SELECT generation, kind, restart_id, seed_seq, entitlement, opened_at FROM generations WHERE player_key = ${playerKey} AND restart_id = ${restartId}`;
  return rows[0] ?? null;
}

export async function isErased(q: Q, playerKey: string): Promise<boolean> {
  const rows = await q<
    { erased: boolean }[]
  >`SELECT (erased_at IS NOT NULL) AS erased FROM players WHERE player_key = ${playerKey}`;
  return rows[0]?.erased ?? false;
}
