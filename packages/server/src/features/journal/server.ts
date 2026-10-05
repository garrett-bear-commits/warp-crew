// journal feature (§4.3, ADR-016, ADR-020): journal_entries (partitioned 90 d, per-call/day caps,
// fromSeq monotonic, kind allowlist per build), repro bundle assembly.
import type { FastifyInstance } from 'fastify';
import { JournalShipBody, type JournalShipResult } from '@foundation/contracts';
import { LIMITS } from '@foundation/contracts/enums';
import { defineCommand } from '../../cqrs/define.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import type { Q } from '../../db/index.ts';

type Result = Omit<JournalShipResult, 'serverNow' | 'requestId'>;

export const JournalShip = defineCommand<typeof JournalShipBody, Result>({
  type: 'journal.ship',
  schema: JournalShipBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '7d' },
  tx: 'required',
  limit: 'journal',
  replay: { fromStored: (r) => ({ ...r, outcome: 'duplicate' }) },
});

/** Repro bundle: snapshot N blob + journal entries after it (§4.3 "repro bundle assembly"). */
export async function reproBundle(
  q: Q,
  playerKey: string,
  generation: number,
  fromSeq: number,
  limit = 5000,
): Promise<{
  entries: Array<{
    seq: number;
    tick: number;
    at: number;
    kind: string;
    name: string;
    args: unknown;
  }>;
}> {
  const rows = await q<
    { seq: string; tick: string; at: Date; kind: string; name: string; args: unknown }[]
  >`SELECT seq, tick, at, kind, name, args FROM journal_entries WHERE player_key = ${playerKey} AND generation = ${generation} AND seq >= ${fromSeq} ORDER BY seq LIMIT ${limit}`;
  return {
    entries: rows.map((r) => ({
      seq: Number(r.seq),
      tick: Number(r.tick),
      at: r.at.getTime(),
      kind: r.kind,
      name: r.name,
      args: r.args,
    })),
  };
}

export function registerJournal(app: FastifyInstance, ctx: AppContext): void {
  const { bus } = ctx;
  ctx.declaredCommands.push(JournalShip);
  bus.register(JournalShip, async (input, exec, tx): Promise<Result> => {
    const t = tx!;
    if (ctx.game.journal === 'off')
      return {
        accepted: 0,
        dropped: input.entries.length,
        nextSeq: input.fromSeq,
        outcome: 'disabled',
      };
    const playerKey = exec.playerKey!;
    const bytes = Buffer.byteLength(JSON.stringify(input.entries));
    if (bytes > LIMITS.journalMaxBytesPerCall)
      return {
        accepted: 0,
        dropped: input.entries.length,
        nextSeq: input.fromSeq,
        outcome: 'refused_budget',
      };
    const day = new Date(exec.now).toISOString().slice(0, 10);
    const cur = await t<
      { next_seq: string; used_today: number; day: string }[]
    >`SELECT next_seq, used_today, day::text FROM journal_cursors WHERE player_key = ${playerKey} AND generation = ${input.generation}`;
    const next = cur[0] ? Number(cur[0].next_seq) : 0;
    const usedToday = cur[0] && cur[0].day === day ? cur[0].used_today : 0;
    if (input.fromSeq < next)
      return {
        accepted: 0,
        dropped: input.entries.length,
        nextSeq: next,
        outcome: 'refused_non_monotonic',
      };
    if (usedToday + input.entries.length > ctx.game.journalDailyEntryBudget)
      return {
        accepted: 0,
        dropped: input.entries.length,
        nextSeq: next,
        outcome: 'refused_budget',
      };
    let seq = input.fromSeq;
    for (const e of input.entries) {
      await t`INSERT INTO journal_entries (player_key, generation, seq, tick, at, kind, name, args, build_version, received_at) VALUES (${playerKey}, ${input.generation}, ${seq}, ${e.tick}, ${new Date(e.now)}, ${e.kind}, ${e.name}, ${e.args ? t.json(e.args as never) : null}, ${input.buildVersion}, ${new Date(exec.now)})`;
      seq++;
    }
    await t`INSERT INTO journal_cursors (player_key, generation, next_seq, day, used_today) VALUES (${playerKey}, ${input.generation}, ${seq}, ${day}, ${usedToday + input.entries.length})
      ON CONFLICT (player_key, generation) DO UPDATE SET next_seq = EXCLUDED.next_seq, day = EXCLUDED.day, used_today = EXCLUDED.used_today`;
    return { accepted: input.entries.length, dropped: 0, nextSeq: seq, outcome: 'stored' };
  });
  route<typeof JournalShipBody, typeof import('@foundation/contracts').JournalShipResult>(
    app,
    ctx,
    'journal.ship',
    async ({ body, exec }) =>
      bus.execute(JournalShip, { commandId: body.commandId, payload: body }, exec!),
  );

  // monthly partitions: ensure current + next month exist (boot + daily)
  ctx.jobs.push({
    name: 'journal.partitions',
    intervalMs: 24 * 3_600_000,
    runOnStart: true,
    async run() {
      const now = new Date(ctx.clock.now());
      const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10);
      const m1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
        .toISOString()
        .slice(0, 10);
      const a = await ctx.db.sql<
        { p: string }[]
      >`SELECT ensure_journal_partition(${m0}::date) AS p`;
      const b = await ctx.db.sql<
        { p: string }[]
      >`SELECT ensure_journal_partition(${m1}::date) AS p`;
      return { partitions: [a[0]?.p, b[0]?.p] };
    },
  });
}
