// "Server truth" model (§9): an in-memory implementation of the server placement rules —
// deepest anchored wins per generation, refusals stored (200 + reason, ADR-019), replay by
// commandId (request-hash checked → 422 idempotency_mismatch on payload drift; an anchored
// original replays `duplicate`, a refused/quarantined original replays its ORIGINAL disposition
// with reason/flags — audit F3, from the commands row or the tombstone alike), stale generation
// refused, generations only move forward, GET current exposes the anchor + pendingQuarantine
// (also with `empty: true` when the only writes are quarantined), lineage restoreToSeq/reattach
// with 409 stale_generation. Auth: mock tokens.
// Serves both the unit flows (through fakeFetch) and the fast-check model runs.
import type {
  ErrorEnvelope,
  GenerationReceipt,
  SaveBlobResponse,
  SaveCurrentResponse,
  SaveWriteBody,
  SaveWriteResult,
  SnapshotMeta,
} from '@foundation/contracts';
import type { SaveDisposition, SaveFlag, SaveRefusalReason } from '@foundation/contracts/enums';
import { json, type FakeCall, type FakeFetch } from '@foundation/testkit';

export interface ServerRow {
  seq: number;
  generation: number;
  progress: number;
  disposition: SaveDisposition;
  reason?: SaveRefusalReason;
  flags: SaveFlag[];
  commandId: string;
  blob: string;
  enc: 'json' | 'gzip+b64';
  schemaVersion: number;
  sessionId: string;
  baseSeq: number;
  clientSeq: number;
  savedAt: number;
  receivedAt: number;
  summary?: Record<string, number>;
  source: 'client' | 'beacon';
}

export interface ServerOptions {
  gameId: string;
  now: () => number;
  /** Player key this model instance holds; other keys get their own instance (see forPlayer). */
  playerKey?: string;
  knownSchemaVersions?: number[];
  /** progress_jump quarantine threshold; 0 disables (default). */
  maxProgressPerHour?: number;
}

/** Server replay rule (mirror of packages/server/src/features/saves/server.ts replaySaveResult). */
export function replaySaveResult(stored: SaveWriteResult): SaveWriteResult {
  if (stored.disposition === 'anchored') return { ...stored, disposition: 'duplicate' };
  return { ...stored };
}

/** Deterministic string hash for the request_hash (canonical payload without auth/transport). */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export class ServerTruth {
  rows: ServerRow[] = [];
  generation = 0;
  generationKind = 'initial';
  erased = false;
  /** Client lineage.restart business keys (restartId → opened generation). */
  private readonly restartById = new Map<string, { generation: number; entitlement: number }>();
  /** Command replay store: commandId → {hash, result} (full row, 7 d retention on the server). */
  commands = new Map<string, { hash: string; result: SaveWriteResult }>();
  /** Idempotency tombstones (> 7 d): kept for as long as the snapshot exists; same replay shape. */
  tombstones = new Map<string, { hash: string; result: SaveWriteResult }>();
  /** Fault knobs. */
  down = false;
  forceStatus: 401 | 426 | 429 | 503 | null = null;
  requestCount = 0;
  private readonly known: number[];
  private readonly maxPerHour: number;
  private readonly o: ServerOptions;
  private playerKey: string | undefined;
  private readonly others = new Map<string, ServerTruth>();

  constructor(o: ServerOptions) {
    this.o = o;
    this.known = o.knownSchemaVersions ?? [1, 2];
    this.maxPerHour = o.maxProgressPerHour ?? 0;
    this.playerKey = o.playerKey;
  }

  /** Per-player isolation: the first key seen binds to this instance; others get their own. */
  forPlayer(key: string): ServerTruth {
    if (this.playerKey === undefined) this.playerKey = key;
    if (key === this.playerKey) return this;
    let m = this.others.get(key);
    if (!m) {
      m = new ServerTruth({ ...this.o, playerKey: key });
      this.others.set(key, m);
    }
    return m;
  }

  /** Retention: the full commands rows age out (> 7 d) into tombstones; replay is unchanged. */
  pruneCommandRows(): void {
    for (const [id, c] of this.commands) this.tombstones.set(id, c);
    this.commands.clear();
  }

  /** Deepest anchored row with a blob in the given generation (the anchor). */
  anchor(generation = this.generation): ServerRow | null {
    let best: ServerRow | null = null;
    for (const r of this.rows) {
      if (r.generation !== generation || r.disposition !== 'anchored') continue;
      if (!best || r.progress > best.progress || (r.progress === best.progress && r.seq > best.seq))
        best = r;
    }
    return best;
  }

  private lastSeq(): number {
    return this.rows.reduce((m, r) => Math.max(m, r.seq), 0);
  }

  private pendingQuarantine(): SaveRow | null {
    const a = this.anchor();
    let best: ServerRow | null = null;
    for (const r of this.rows) {
      if (r.generation !== this.generation || r.disposition !== 'stored_quarantined') continue;
      if (a && r.progress <= a.progress) continue;
      if (!best || r.progress > best.progress) best = r;
    }
    return best;
  }

  private meta(r: ServerRow): SnapshotMeta {
    const out: SnapshotMeta = {
      seq: r.seq,
      generation: r.generation,
      progress: r.progress,
      clientSeq: r.clientSeq,
      baseSeq: r.baseSeq,
      sessionId: r.sessionId,
      commandId: r.commandId,
      savedAt: r.savedAt,
      receivedAt: r.receivedAt,
      bytes: r.blob.length,
      encBytes: r.blob.length,
      blobSha256: hash(r.blob).padStart(64, '0'),
      schemaVersion: r.schemaVersion,
      buildVersion: 'test',
      reason: 'autosave',
      disposition: r.disposition,
      flags: r.flags,
      hasBlob: true,
    };
    if (r.reason) out.rejectReason = r.reason;
    if (r.summary) out.summary = r.summary;
    return out;
  }

  /** The placement guard (mirror of packages/server/src/features/saves/placement.ts). */
  write(
    body: SaveWriteBody,
    source: 'client' | 'beacon' = 'client',
  ): { status: 200; body: SaveWriteResult } | { status: 422 | 403; body: ErrorEnvelope } {
    const now = this.o.now();
    if (this.erased)
      return {
        status: 403,
        body: { error: 'forbidden', correlationId: 'model', details: { erased: true } },
      };
    const { commandId, ...payload } = body;
    const h = hash(JSON.stringify(payload));
    const seen = this.commands.get(commandId) ?? this.tombstones.get(commandId);
    if (seen) {
      if (seen.hash !== h)
        return { status: 422, body: { error: 'idempotency_mismatch', correlationId: 'model' } };
      return {
        status: 200,
        body: { ...replaySaveResult(seen.result), requestId: 'model', serverNow: now },
      };
    }
    const seq = this.lastSeq() + 1;
    const head = this.anchor();
    const flags: SaveFlag[] = [];
    let divergent: SaveWriteResult['divergent'];
    if (head && (body.baseSeq < head.seq || body.sessionId !== head.sessionId)) {
      divergent = { headSeq: head.seq, headWriterAt: head.savedAt, headSessionId: head.sessionId };
    }
    let blobValid = true;
    try {
      const v = JSON.parse(body.blob) as unknown;
      blobValid = !!v && typeof v === 'object' && !Array.isArray(v);
    } catch {
      blobValid = false;
    }
    let disposition: SaveDisposition;
    let reason: SaveRefusalReason | undefined;
    if (body.generation !== this.generation) {
      disposition = 'stored_refused';
      reason = 'stale_generation';
    } else if (!blobValid || !Number.isSafeInteger(body.progress) || body.progress < 0) {
      disposition = 'stored_refused';
      reason = 'malformed';
    } else if (head && body.progress < head.progress) {
      disposition = 'stored_refused';
      reason = 'progress_regression';
    } else {
      if (!this.known.includes(body.schemaVersion)) flags.push('schema_unknown');
      if (head && body.schemaVersion < head.schemaVersion) flags.push('schema_downgrade');
      if (head && this.maxPerHour > 0) {
        const hours = Math.max((now - head.receivedAt) / 3_600_000, 1 / 60);
        if (body.progress - head.progress > this.maxPerHour * hours) flags.push('progress_jump');
      }
      disposition = flags.length ? 'stored_quarantined' : 'anchored';
    }
    const row: ServerRow = {
      seq,
      generation: this.generation,
      progress: body.progress,
      disposition,
      flags,
      commandId,
      blob: body.blob,
      enc: body.enc,
      schemaVersion: body.schemaVersion,
      sessionId: body.sessionId,
      baseSeq: body.baseSeq,
      clientSeq: body.clientSeq,
      savedAt: body.savedAt,
      receivedAt: now,
      source,
    };
    if (reason) row.reason = reason;
    if (body.summary) row.summary = body.summary;
    this.rows.push(row);
    const currentProgress =
      disposition === 'anchored'
        ? Math.max(body.progress, head?.progress ?? 0)
        : (head?.progress ?? 0);
    const result: SaveWriteResult = {
      disposition,
      seq,
      currentProgress,
      generation: this.generation,
      blobSha256: hash(body.blob).padStart(64, '0'),
      requestId: 'model',
      serverNow: now,
    };
    if (reason) result.reason = reason;
    if (flags.length) result.flags = flags;
    if (divergent) result.divergent = divergent;
    this.commands.set(commandId, { hash: h, result });
    return { status: 200, body: result };
  }

  current(withBlob: boolean): SaveCurrentResponse {
    const now = this.o.now();
    const lineage = {
      generation: this.generation,
      kind: this.generationKind as 'initial',
      openedAt: 0,
    };
    if (this.erased)
      return {
        empty: true,
        generation: this.generation,
        lineage,
        erased: true,
        requestId: 'model',
        serverNow: now,
      };
    const a = this.anchor();
    const out: SaveCurrentResponse = {
      empty: !a,
      generation: this.generation,
      lineage,
      requestId: 'model',
      serverNow: now,
    };
    const pq = this.pendingQuarantine();
    if (pq)
      out.pendingQuarantine = {
        seq: pq.seq,
        progress: pq.progress,
        flags: pq.flags,
        receivedAt: pq.receivedAt,
      };
    if (a) {
      out.snapshot = this.meta(a);
      if (withBlob) {
        out.blob = a.blob;
        out.enc = a.enc;
      }
    }
    return out;
  }

  blob(seq: number): SaveBlobResponse | null {
    const r = this.rows.find((x) => x.seq === seq);
    if (!r) return null;
    return {
      seq: r.seq,
      generation: r.generation,
      enc: r.enc,
      blob: r.blob,
      blobSha256: hash(r.blob).padStart(64, '0'),
      requestId: 'model',
      serverNow: this.o.now(),
    };
  }

  /** Another device / admin opens a new generation (restart) — optionally seeding it with a snapshot. */
  restart(seed?: { progress: number; blob: string }): number {
    this.generation++;
    this.generationKind = 'restart';
    if (seed) this.seedRow(seed.progress, seed.blob);
    return this.generation;
  }

  /** Player POST /v1/lineage/restart: CAS on expectedGeneration, idempotent on restartId. */
  openRestart(
    expectedGeneration: number,
    restartId: string,
    entitlement = 0,
  ): { status: 200; body: GenerationReceipt } | { status: 409; body: ErrorEnvelope } {
    const existing = this.restartById.get(restartId);
    if (existing)
      return {
        status: 200,
        body: {
          generation: existing.generation,
          kind: 'restart',
          entitlement: existing.entitlement,
          duplicate: true,
          requestId: 'model',
          serverNow: this.o.now(),
        },
      };
    if (expectedGeneration !== this.generation)
      return {
        status: 409,
        body: {
          error: 'stale_generation',
          correlationId: 'model',
          details: { generation: this.generation },
        },
      };
    this.generation++;
    this.generationKind = 'restart';
    this.restartById.set(restartId, { generation: this.generation, entitlement });
    return {
      status: 200,
      body: {
        generation: this.generation,
        kind: 'restart',
        entitlement,
        duplicate: false,
        requestId: 'model',
        serverNow: this.o.now(),
      },
    };
  }

  /** Another device writes an anchored snapshot directly (deepest wins applies). */
  otherDeviceWrite(progress: number, blob: string, generation = this.generation): SaveWriteResult {
    const body: SaveWriteBody = {
      commandId: `other-${this.rows.length + 1}-${progress}`,
      generation,
      clientSeq: 0,
      baseSeq: this.anchor()?.seq ?? 0,
      sessionId: '00000000-0000-4000-8000-00000000dead',
      progress,
      savedAt: this.o.now(),
      schemaVersion: 2,
      buildVersion: 'other',
      enc: 'json',
      reason: 'autosave',
      blob,
    };
    return this.write(body).body as SaveWriteResult;
  }

  private seedRow(progress: number, blob: string): ServerRow {
    const row: ServerRow = {
      seq: this.lastSeq() + 1,
      generation: this.generation,
      progress,
      disposition: 'anchored',
      flags: [],
      commandId: `seed-${this.generation}-${this.lastSeq() + 1}`,
      blob,
      enc: 'json',
      schemaVersion: 2,
      sessionId: '00000000-0000-4000-8000-0000000005ee',
      baseSeq: 0,
      clientSeq: 0,
      savedAt: this.o.now(),
      receivedAt: this.o.now(),
      source: 'client',
    };
    this.rows.push(row);
    return row;
  }

  restoreToSeq(
    seq: number,
    expectedGeneration: number,
  ): { status: 200; body: GenerationReceipt } | { status: 409 | 404; body: ErrorEnvelope } {
    if (expectedGeneration !== this.generation)
      return {
        status: 409,
        body: {
          error: 'stale_generation',
          correlationId: 'model',
          details: { generation: this.generation },
        },
      };
    const src = this.rows.find((r) => r.seq === seq);
    if (!src) return { status: 404, body: { error: 'not_found', correlationId: 'model' } };
    this.generation++;
    this.generationKind = 'player_restore';
    const row = this.seedRow(src.progress, src.blob);
    return {
      status: 200,
      body: {
        generation: this.generation,
        kind: 'player_restore',
        seedSeq: row.seq,
        duplicate: false,
        requestId: 'model',
        serverNow: this.o.now(),
      },
    };
  }

  reattach(
    clientGeneration: number,
    expectedServerGeneration: number,
    snapshot: { progress: number; blob: string },
  ): { status: 200; body: GenerationReceipt } | { status: 409; body: ErrorEnvelope } {
    if (expectedServerGeneration !== this.generation)
      return {
        status: 409,
        body: {
          error: 'stale_generation',
          correlationId: 'model',
          details: { generation: this.generation },
        },
      };
    this.generation = Math.max(clientGeneration, this.generation + 1);
    this.generationKind = 'reattach';
    const row = this.seedRow(snapshot.progress, snapshot.blob);
    return {
      status: 200,
      body: {
        generation: this.generation,
        kind: 'reattach',
        seedSeq: row.seq,
        duplicate: false,
        requestId: 'model',
        serverNow: this.o.now(),
      },
    };
  }

  /** Register every route on a fakeFetch. */
  mount(ff: FakeFetch): void {
    const now = () => this.o.now();
    const err = (status: number, error: ErrorEnvelope['error'], details?: unknown): Response =>
      json(status, {
        error,
        correlationId: 'model',
        ...(details !== undefined ? { details } : {}),
        serverNow: now(),
      });
    const auth = (playerKey: string | undefined, token: string | undefined): boolean => {
      if (!playerKey || !token) return false;
      const parts = token.split('.');
      return parts[0] === 'mock' && parts[1] === playerKey;
    };
    const guard = (call: FakeCall, beacon = false): { model: ServerTruth } | Response => {
      this.requestCount++;
      if (this.down) throw new TypeError('network down');
      if (this.forceStatus === 401) return err(401, 'unauthorized');
      if (this.forceStatus === 426) return err(426, 'build_too_old', { minBuildVersion: '9.9.9' });
      if (this.forceStatus === 429) return err(429, 'rate_limited', { retryAfterMs: 1_000 });
      if (this.forceStatus === 503) return err(503, 'retry_later', { retryAfterMs: 500 });
      let key: string | undefined;
      let token: string | undefined;
      if (beacon) {
        const b = call.body as { playerKey?: string; token?: string };
        key = b.playerKey;
        token = b.token;
      } else {
        key = call.headers['x-player-key'];
        token = call.headers['authorization']?.replace(/^Bearer /, '');
      }
      if (!auth(key, token)) return err(401, 'unauthorized');
      return { model: this.forPlayer(key!) };
    };
    ff.on('PUT', '/v1/saves', (call) => {
      const g = guard(call);
      if (g instanceof Response) return g;
      const r = g.model.write(call.body as SaveWriteBody, 'client');
      return json(r.status, r.body);
    });
    ff.on('POST', '/v1/saves/beacon', (call) => {
      const g = guard(call, true);
      if (g instanceof Response) return g;
      const {
        playerKey: _p,
        token: _t,
        requestId: _r,
        ...body
      } = call.body as SaveWriteBody & { playerKey: string; token: string; requestId?: string };
      const r = g.model.write(body, 'beacon');
      return json(r.status, r.body);
    });
    ff.on('GET', '/v1/saves/current', (call) => {
      const g = guard(call);
      if (g instanceof Response) return g;
      return json(200, g.model.current(!call.url.includes('meta=1')));
    });
    ff.on('GET', '/v1/saves/history/', (call) => {
      const g = guard(call);
      if (g instanceof Response) return g;
      const m = /history\/(\d+)\/blob/.exec(call.url);
      const b = m ? g.model.blob(Number(m[1])) : null;
      return b ? json(200, b) : err(404, 'not_found');
    });
    ff.on('POST', '/v1/lineage/restart', (call) => {
      const g = guard(call);
      if (g instanceof Response) return g;
      const b = call.body as { restartId: string; expectedGeneration: number };
      const r = g.model.openRestart(b.expectedGeneration, b.restartId);
      return json(r.status, r.body);
    });
    ff.on('POST', '/v1/lineage/restoreToSeq', (call) => {
      const g = guard(call);
      if (g instanceof Response) return g;
      const b = call.body as { seq: number; expectedGeneration: number };
      const r = g.model.restoreToSeq(b.seq, b.expectedGeneration);
      return json(r.status, r.body);
    });
    ff.on('POST', '/v1/lineage/reattach', (call) => {
      const g = guard(call);
      if (g instanceof Response) return g;
      const b = call.body as {
        clientGeneration: number;
        expectedServerGeneration: number;
        snapshot: { progress: number; blob: string };
      };
      const r = g.model.reattach(b.clientGeneration, b.expectedServerGeneration, b.snapshot);
      return json(r.status, r.body);
    });
    ff.on('POST', '/v1/journal', (call) => {
      const g = guard(call);
      if (g instanceof Response) return g;
      const b = call.body as { entries: unknown[]; fromSeq: number };
      return json(200, {
        accepted: b.entries.length,
        dropped: 0,
        nextSeq: b.fromSeq + b.entries.length,
        outcome: 'stored',
        requestId: 'model',
        serverNow: now(),
      });
    });
    ff.on('POST', '/v1/telemetry/integrity', (call) => {
      const g = guard(call);
      if (g instanceof Response) return g;
      const b = call.body as { events: unknown[] };
      return json(200, {
        accepted: b.events.length,
        dropped: 0,
        budgetRemaining: 100,
        requestId: 'model',
        serverNow: now(),
      });
    });
  }
}

type SaveRow = ServerRow;
