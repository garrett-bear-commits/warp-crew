// Outbox is the only fan-out (§4.1, ADR-004): rows written in the originating tx; delivery state
// per consumer with leases, bounded backoff, dead letters (ops alert) and replay. Reactions never
// write ledgers directly: a reaction that mints a grant or sends a letter dispatches a deterministic
// system command with commandId = uuidv5(outbox:<id>:<consumer>) through the bus.
import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import type { Db, Tx } from '../db/index.ts';
import type { ServerClock } from '../clock/index.ts';

export interface OutboxMessage {
  id: number;
  kind: string;
  playerKey: string | null;
  payload: unknown;
  commandId: string | null;
  createdAt: number;
}

export interface OutboxConsumer {
  name: string;
  /** Kinds this consumer wants; '*' for all. */
  kinds: readonly string[] | '*';
  handle(msg: OutboxMessage, deps: { deterministicCommandId: string }): Promise<void>;
}

/** Deterministic UUID (v5-shaped, SHA-1 free: sha256-derived) for outbox:<id>:<consumer>. */
export function deterministicCommandId(outboxId: number, consumer: string): string {
  const h = createHash('sha256').update(`outbox:${outboxId}:${consumer}`).digest('hex');
  // format as a UUID with version nibble 8 (unambiguous, not colliding with client v4/v7)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Write an outbox row + one pending delivery per registered consumer, inside the caller's tx. */
export async function emitOutbox(
  tx: Tx,
  msg: { kind: string; playerKey?: string | null; payload: unknown; commandId?: string | null },
  consumers: readonly OutboxConsumer[],
  nowMs?: number,
): Promise<number> {
  const rows = await tx<
    { id: number }[]
  >`INSERT INTO outbox (kind, player_key, payload, command_id) VALUES (${msg.kind}, ${msg.playerKey ?? null}, ${tx.json(msg.payload as never)}, ${msg.commandId ?? null}) RETURNING id`;
  const id = Number(rows[0]!.id);
  for (const c of consumers) {
    if (c.kinds !== '*' && !c.kinds.includes(msg.kind)) continue;
    if (nowMs !== undefined)
      await tx`INSERT INTO outbox_deliveries (outbox_id, consumer, state, next_attempt_at) VALUES (${id}, ${c.name}, 'pending', ${new Date(nowMs)})`;
    else
      await tx`INSERT INTO outbox_deliveries (outbox_id, consumer, state) VALUES (${id}, ${c.name}, 'pending')`;
  }
  return id;
}

export interface OutboxOptions {
  maxAttempts?: number;
  leaseMs?: number;
  batch?: number;
  /** backoff(attempt) → ms */
  backoffMs?: (attempt: number) => number;
}

export interface DrainResult {
  delivered: number;
  failed: number;
  dead: number;
  /** finalisations refused because the lease had been taken over by another worker */
  stale: number;
}

export class Outbox {
  #consumers: OutboxConsumer[] = [];
  #db: Db;
  #clock: ServerClock;
  #opts: Required<OutboxOptions>;
  #log: { warn(o: object, m: string): void; error(o: object, m: string): void } | undefined;

  constructor(
    db: Db,
    clock: ServerClock,
    opts: OutboxOptions = {},
    log?: { warn(o: object, m: string): void; error(o: object, m: string): void },
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#log = log;
    this.#opts = {
      maxAttempts: opts.maxAttempts ?? 8,
      leaseMs: opts.leaseMs ?? 30_000,
      batch: opts.batch ?? 50,
      backoffMs: opts.backoffMs ?? ((attempt) => Math.min(60 * 60_000, 1000 * 2 ** attempt)),
    };
  }

  register(consumer: OutboxConsumer): void {
    if (this.#consumers.some((c) => c.name === consumer.name))
      throw new Error(`outbox consumer ${consumer.name} registered twice`);
    this.#consumers.push(consumer);
  }

  consumers(): readonly OutboxConsumer[] {
    return this.#consumers;
  }

  /** emit inside a caller-owned transaction */
  emit(
    tx: Tx,
    msg: { kind: string; playerKey?: string | null; payload: unknown; commandId?: string | null },
  ): Promise<number> {
    return emitOutbox(tx, msg, this.#consumers, this.#clock.now());
  }

  /**
   * Drain: take a lease per (row, consumer), deliver, finalise. Each delivery is its own tx so a
   * crash mid-batch leaves at most one leased row that expires and is retried (at-least-once; the
   * consumer's deterministic commandId makes redelivery idempotent).
   */
  async drain(): Promise<DrainResult> {
    const out: DrainResult = { delivered: 0, failed: 0, dead: 0, stale: 0 };
    const now = new Date(this.#clock.now());
    const leaseUntil = new Date(this.#clock.now() + this.#opts.leaseMs);
    // Every lease carries a fresh lease_token; finalisation is only accepted from the token holder
    // (audit F6): a worker whose lease expired and was re-leased by another worker cannot flip the
    // row's state (its UPDATE matches zero rows and is counted as `stale`).
    const leased = await this.#db.sql<
      { outbox_id: number; consumer: string; attempts: number; lease_token: string }[]
    >`
      WITH cand AS (
        SELECT outbox_id, consumer FROM outbox_deliveries
        WHERE (state = 'pending' OR (state = 'leased' AND lease_until < ${now})) AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at LIMIT ${this.#opts.batch}
        FOR UPDATE SKIP LOCKED)
      UPDATE outbox_deliveries d SET state = 'leased', lease_until = ${leaseUntil}, lease_token = gen_random_uuid(), attempts = d.attempts + 1
      FROM cand WHERE d.outbox_id = cand.outbox_id AND d.consumer = cand.consumer
      RETURNING d.outbox_id, d.consumer, d.attempts, d.lease_token`;
    for (const l of leased) {
      const r = await this.deliverLeased(l);
      out[r]++;
    }
    return out;
  }

  /** Deliver one leased row and finalise it as its lease-token owner. Exposed for concurrency tests. */
  async deliverLeased(l: {
    outbox_id: number;
    consumer: string;
    attempts: number;
    lease_token: string;
  }): Promise<'delivered' | 'failed' | 'dead' | 'stale'> {
    const consumer = this.#consumers.find((c) => c.name === l.consumer);
    const rows = await this.#db.sql<
      {
        id: number;
        kind: string;
        player_key: string | null;
        payload: unknown;
        command_id: string | null;
        created_at: Date;
      }[]
    >`SELECT id, kind, player_key, payload, command_id, created_at FROM outbox WHERE id = ${l.outbox_id}`;
    const row = rows[0];
    if (!row) return 'stale';
    const msg: OutboxMessage = {
      id: Number(row.id),
      kind: row.kind,
      playerKey: row.player_key,
      payload: row.payload,
      commandId: row.command_id,
      createdAt: row.created_at.getTime(),
    };
    try {
      if (!consumer) throw new Error(`no consumer registered for ${l.consumer}`);
      await consumer.handle(msg, {
        deterministicCommandId: deterministicCommandId(msg.id, consumer.name),
      });
      const done = await this.#db
        .sql`UPDATE outbox_deliveries SET state = 'delivered', delivered_at = ${new Date(this.#clock.now())}, lease_until = NULL, lease_token = NULL, last_error = NULL WHERE outbox_id = ${l.outbox_id} AND consumer = ${l.consumer} AND lease_token = ${l.lease_token}`;
      if (done.count === 0) {
        this.#log?.warn(
          { outboxId: l.outbox_id, consumer: l.consumer },
          'stale lease: delivery finalisation ignored',
        );
        return 'stale';
      }
      return 'delivered';
    } catch (e) {
      const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (l.attempts >= this.#opts.maxAttempts) {
        const dead = await this.#db.tx(async (tx) => {
          const u =
            await tx`UPDATE outbox_deliveries SET state = 'dead', lease_until = NULL, lease_token = NULL, last_error = ${err} WHERE outbox_id = ${l.outbox_id} AND consumer = ${l.consumer} AND lease_token = ${l.lease_token}`;
          if (u.count === 0) return false;
          await tx`INSERT INTO outbox_dead_letters (outbox_id, consumer, attempts, last_error) VALUES (${l.outbox_id}, ${l.consumer}, ${l.attempts}, ${err})`;
          return true;
        });
        if (!dead) return 'stale';
        this.#log?.error(
          { outboxId: l.outbox_id, consumer: l.consumer, err },
          'outbox delivery dead-lettered',
        );
        return 'dead';
      }
      const next = new Date(this.#clock.now() + this.#opts.backoffMs(l.attempts));
      const u = await this.#db
        .sql`UPDATE outbox_deliveries SET state = 'pending', lease_until = NULL, lease_token = NULL, last_error = ${err}, next_attempt_at = ${next} WHERE outbox_id = ${l.outbox_id} AND consumer = ${l.consumer} AND lease_token = ${l.lease_token}`;
      if (u.count === 0) return 'stale';
      this.#log?.warn(
        { outboxId: l.outbox_id, consumer: l.consumer, attempt: l.attempts, err },
        'outbox delivery failed; will retry',
      );
      return 'failed';
    }
  }

  /** outbox.replay(id, consumer): re-queue a dead (or any) delivery; marks the dead letter replayed. */
  /** outbox.replay(id, consumer): re-queue a dead (or any) delivery; marks the dead letter replayed. */
  async replay(outboxId: number, consumer: string, by: string): Promise<boolean> {
    return this.#db.tx((tx) => this.replayInTx(tx, outboxId, consumer, by));
  }

  /**
   * Same as replay() but inside a caller-owned transaction (the admin command's tx): never opens
   * a second connection while the command holds one (PG_POOL=1 must not deadlock) and rolls back
   * with the command.
   */
  async replayInTx(tx: Tx, outboxId: number, consumer: string, by: string): Promise<boolean> {
    const now = new Date(this.#clock.now());
    const r =
      await tx`UPDATE outbox_deliveries SET state = 'pending', attempts = 0, lease_until = NULL, lease_token = NULL, next_attempt_at = ${now}, last_error = NULL WHERE outbox_id = ${outboxId} AND consumer = ${consumer}`;
    if (r.count === 0) {
      // no delivery row yet (consumer registered later): create one
      const exists = await tx<{ id: number }[]>`SELECT id FROM outbox WHERE id = ${outboxId}`;
      if (!exists[0]) return false;
      await tx`INSERT INTO outbox_deliveries (outbox_id, consumer, state, next_attempt_at) VALUES (${outboxId}, ${consumer}, 'pending', ${now})`;
    }
    await tx`UPDATE outbox_dead_letters SET replayed_at = ${now}, replayed_by = ${by} WHERE outbox_id = ${outboxId} AND consumer = ${consumer} AND replayed_at IS NULL`;
    return true;
  }

  async stats(
    sql: Sql = this.#db.sql,
  ): Promise<{ pending: number; lagSeconds: number; deadLetters: number }> {
    const p = await sql<
      { pending: number; oldest: Date | null }[]
    >`SELECT count(*)::int AS pending, min(o.created_at) AS oldest FROM outbox_deliveries d JOIN outbox o ON o.id = d.outbox_id WHERE d.state IN ('pending', 'leased')`;
    const d = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM outbox_dead_letters WHERE replayed_at IS NULL`;
    const oldest = p[0]?.oldest;
    return {
      pending: p[0]?.pending ?? 0,
      lagSeconds: oldest ? Math.max(0, (this.#clock.now() - oldest.getTime()) / 1000) : 0,
      deadLetters: d[0]?.n ?? 0,
    };
  }
}
