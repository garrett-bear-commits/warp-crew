// The placement guard (§1, §7, ADR-006). Pure, framework-free, property-tested. It is the only
// place that decides where a write lands — not WHETHER it lands: everything that arrives is
// stored with a disposition. Lifted from Barrowdeep saves.domain.ts and generalised.
import type { Divergence, Summary } from '@foundation/contracts';
import type { SaveDisposition, SaveFlag, SaveRefusalReason } from '@foundation/contracts/enums';

/** What the client sent, after decoding. */
export interface SaveWrite {
  generation: number;
  /** Game-supplied monotone ordinal, safe integer ≥ 0. */
  progress: number;
  clientSeq: number;
  baseSeq: number;
  sessionId: string;
  savedAt: number;
  schemaVersion: number;
  /** false when the blob failed policy validation (malformed but still stored). */
  blobValid: boolean;
  bytes: number;
  summary?: Summary | undefined;
  /** policy.summaryPlausible verdict (undefined = no policy). */
  summaryPlausible?: boolean | undefined;
}

/** Deepest anchored (or promoted) row WITH a blob in the active generation, or null. */
export interface StoredHead {
  seq: number;
  progress: number;
  sessionId: string;
  savedAt: number;
  receivedAt: number;
  schemaVersion: number;
  summary?: Summary | undefined;
}

/** Newest stored row for the player — ANY disposition — refusals occupy seq numbers too. */
export interface LastRow {
  seq: number;
}

export interface PlacementOptions {
  activeGeneration: number;
  now: number;
  knownSchemaVersions: readonly number[];
  maxProgressPerHour: number;
  /** clock_skew flag threshold (ms). */
  clockSkewMs?: number;
}

export interface Placement {
  disposition: Exclude<SaveDisposition, 'duplicate'>;
  reason?: SaveRefusalReason;
  flags: SaveFlag[];
  /** Server-assigned seq for the new row (last.seq + 1). */
  seq: number;
  divergent?: Divergence;
}

const HOUR = 3_600_000;

export function place(
  write: SaveWrite,
  head: StoredHead | null,
  last: LastRow | null,
  opts: PlacementOptions,
): Placement {
  const seq = (last?.seq ?? 0) + 1;
  const flags: SaveFlag[] = [];
  const clockSkewMs = opts.clockSkewMs ?? 24 * HOUR;
  if (Math.abs(write.savedAt - opts.now) > clockSkewMs) flags.push('clock_skew');

  // Divergence is detected and surfaced, never refused on the backstop path (ADR-006).
  let divergent: Divergence | undefined;
  if (head && (write.baseSeq < head.seq || write.sessionId !== head.sessionId)) {
    divergent = { headSeq: head.seq, headWriterAt: head.savedAt, headSessionId: head.sessionId };
    if (head.summary) divergent.headSummary = head.summary;
  }
  const refused = (reason: SaveRefusalReason): Placement => ({
    disposition: 'stored_refused',
    reason,
    flags,
    seq,
    ...(divergent ? { divergent } : {}),
  });

  // Generations are the only way backwards: a write for another generation is refused as data.
  if (write.generation !== opts.activeGeneration) return refused('stale_generation');
  if (
    !write.blobValid ||
    !Number.isSafeInteger(write.progress) ||
    write.progress < 0 ||
    !Number.isSafeInteger(write.schemaVersion) ||
    write.schemaVersion < 1 ||
    !Number.isFinite(write.savedAt) ||
    write.bytes <= 0
  ) {
    return refused('malformed');
  }
  // A save may only get deeper (equal depth is a later state at the same depth: allowed).
  if (head && write.progress < head.progress) return refused('progress_regression');

  // Flags that quarantine: the row is stored, never the anchor, never "saved to cloud".
  if (!opts.knownSchemaVersions.includes(write.schemaVersion)) flags.push('schema_unknown');
  if (head && write.schemaVersion < head.schemaVersion) flags.push('schema_downgrade');
  if (head && opts.maxProgressPerHour > 0) {
    const elapsedHours = Math.max((opts.now - head.receivedAt) / HOUR, 1 / 60);
    const allowed = opts.maxProgressPerHour * elapsedHours;
    if (write.progress - head.progress > allowed) flags.push('progress_jump');
  }
  if (write.summaryPlausible === false) flags.push('implausible_summary');

  const quarantine = flags.some(
    (f) =>
      f === 'schema_unknown' ||
      f === 'schema_downgrade' ||
      f === 'progress_jump' ||
      f === 'implausible_summary',
  );
  return {
    disposition: quarantine ? 'stored_quarantined' : 'anchored',
    flags,
    seq,
    ...(divergent ? { divergent } : {}),
  };
}

/** The anchor is the deepest anchored (or promoted) row in the active generation: pure selector for tests. */
export function selectAnchor<
  T extends {
    generation: number;
    progress: number;
    seq: number;
    disposition: SaveDisposition;
    promoted?: boolean;
    hasBlob: boolean;
  },
>(rows: readonly T[], activeGeneration: number): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.generation !== activeGeneration) continue;
    if (!(r.disposition === 'anchored' || (r.disposition === 'stored_quarantined' && r.promoted)))
      continue;
    if (!best || r.progress > best.progress || (r.progress === best.progress && r.seq > best.seq))
      best = r;
  }
  return best;
}
