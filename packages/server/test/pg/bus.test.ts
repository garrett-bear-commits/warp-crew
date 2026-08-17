import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import { setupPg, type PgHarness } from './helpers.ts';
import { CommandBus } from '../../src/cqrs/bus.ts';
import { defineCommand, type ExecCtx } from '../../src/cqrs/define.ts';
import { fixedClock } from '../../src/clock/index.ts';
import { AppError } from '../../src/errors.ts';
import { requestHash } from '../../src/cqrs/hash.ts';

let h: PgHarness;
const clock = fixedClock(1_755_475_200_000);

const AddSchema = Type.Object(
  { amount: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

const Add = defineCommand<typeof AddSchema, { seq: number; total: number }>({
  type: 'test.add',
  schema: AddSchema,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '7d' },
  tx: 'required',
  replay: {
    fromStored: (r) => ({ ...r, duplicate: true }) as never,
    fromTombstone: (ref) =>
      ({ seq: Number(ref), total: -1, duplicate: true, expired: true }) as never,
  },
  outcomeRef: (r) => String(r.seq),
});

const Slow = defineCommand<typeof AddSchema, { seq: number }>({
  type: 'test.slow',
  schema: AddSchema,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '7d' },
  tx: 'required',
});

const GameCmd = defineCommand<typeof AddSchema, { ok: true }>({
  type: 'test.game',
  schema: AddSchema,
  actorPolicy: 'system',
  scope: 'game',
  lock: 'game',
  idempotency: { owner: 'system', retention: '90d' },
  tx: 'required',
});

const NoTx = defineCommand<typeof AddSchema, { echoed: number }>({
  type: 'test.notx',
  schema: AddSchema,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'none', retention: '7d' },
  tx: 'none',
});

const Failing = defineCommand<typeof AddSchema, { never: true }>({
  type: 'test.failing',
  schema: AddSchema,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '7d' },
  tx: 'required',
});

function ctx(playerKey = 'p1', over: Partial<ExecCtx> = {}): ExecCtx {
  return {
    gameId: 'template',
    env: 'dev',
    actor: { kind: 'player', playerKey, registered: false, tokenIatMs: clock.now() },
    playerKey,
    requestId: `req-${randomUUID().slice(0, 8)}`,
    now: clock.now(),
    ...over,
  };
}

let bus: CommandBus;
let executions = 0;

beforeAll(async () => {
  h = await setupPg('bus');
  await h.root.unsafe(
    `CREATE TABLE test_ledger (id BIGSERIAL PRIMARY KEY, player_key TEXT NOT NULL, seq BIGINT NOT NULL, amount INT NOT NULL, UNIQUE (player_key, seq)); GRANT SELECT, INSERT ON test_ledger TO foundation_app; GRANT USAGE, SELECT ON SEQUENCE test_ledger_id_seq TO foundation_app;`,
  );
  bus = new CommandBus({ db: h.db, clock });
  bus.register(Add, async (input, c, tx) => {
    executions++;
    const last = await tx!<
      { seq: number; total: number }[]
    >`SELECT coalesce(max(seq),0)::int AS seq, coalesce(sum(amount),0)::int AS total FROM test_ledger WHERE player_key = ${c.playerKey!}`;
    const seq = (last[0]?.seq ?? 0) + 1;
    await tx!`INSERT INTO test_ledger (player_key, seq, amount) VALUES (${c.playerKey!}, ${seq}, ${input.amount})`;
    return { seq, total: (last[0]?.total ?? 0) + input.amount };
  });
  bus.register(Slow, async (_input, c, tx) => {
    const last = await tx!<
      { seq: number }[]
    >`SELECT coalesce(max(seq),0)::int AS seq FROM test_ledger WHERE player_key = ${c.playerKey!}`;
    await new Promise((r) => setTimeout(r, 300));
    const seq = (last[0]?.seq ?? 0) + 1;
    await tx!`INSERT INTO test_ledger (player_key, seq, amount) VALUES (${c.playerKey!}, ${seq}, 1)`;
    return { seq };
  });
  bus.register(GameCmd, async () => ({ ok: true as const }));
  bus.register(NoTx, async (input) => ({ echoed: input.amount }));
  bus.register(Failing, async () => {
    throw new AppError('forbidden', 'nope');
  });
});
afterAll(async () => h?.close());

describe('command bus on real Postgres', () => {
  it('assertComplete reports missing handlers', () => {
    const other = defineCommand({
      type: 'test.other',
      schema: AddSchema,
      actorPolicy: 'player',
      scope: 'player',
      lock: 'player',
      idempotency: { owner: 'client', retention: '7d' },
      tx: 'required',
    });
    expect(() => bus.assertComplete([Add, other])).toThrow(/test.other/);
    expect(() => bus.assertComplete([Add, Slow, GameCmd, NoTx, Failing])).not.toThrow();
  });

  it('executes and finalises the commands row in one transaction', async () => {
    const commandId = randomUUID();
    const r = await bus.execute(Add, { commandId, payload: { amount: 5 } }, ctx('p1'));
    expect(r).toEqual({ seq: 1, total: 5 });
    const rows =
      await h.root`SELECT status, result, duration_ms, trace_id, actor, retention FROM commands WHERE command_id = ${commandId}`;
    expect(rows[0]!.status).toBe('done');
    expect(rows[0]!.result).toEqual({ seq: 1, total: 5 });
    expect(rows[0]!.actor).toBe('player');
    expect(rows[0]!.retention).toBe('7d');
    expect(rows[0]!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('duplicate commandId → replays the stored result without re-executing (fromStored hook applied)', async () => {
    const commandId = randomUUID();
    const before = executions;
    const a = await bus.execute(Add, { commandId, payload: { amount: 7 } }, ctx('p1'));
    const b = await bus.execute(Add, { commandId, payload: { amount: 7 } }, ctx('p1'));
    expect(executions).toBe(before + 1);
    expect(b).toEqual({ ...a, duplicate: true });
    const ledger = await h.root`SELECT count(*)::int AS n FROM test_ledger WHERE player_key = 'p1'`;
    expect(ledger[0]!.n).toBe(2);
  });

  it('same commandId, different payload → 422 idempotency_mismatch (payload frozen incl. every field)', async () => {
    const commandId = randomUUID();
    await bus.execute(Add, { commandId, payload: { amount: 1 } }, ctx('p1'));
    await expect(
      bus.execute(Add, { commandId, payload: { amount: 2 } }, ctx('p1')),
    ).rejects.toMatchObject({ code: 'idempotency_mismatch', status: 422 });
  });

  it('same commandId, different command type → 422 (request_hash covers commandType)', async () => {
    const commandId = randomUUID();
    await bus.execute(Add, { commandId, payload: { amount: 1 } }, ctx('p1'));
    await expect(
      bus.execute(Slow, { commandId, payload: { amount: 1 } }, ctx('p1')),
    ).rejects.toMatchObject({ code: 'idempotency_mismatch' });
    expect(requestHash('a', { x: 1 })).not.toBe(requestHash('b', { x: 1 }));
    expect(requestHash('a', { x: 1, y: 2 })).toBe(requestHash('a', { y: 2, x: 1 }));
  });

  it('scope_key isolates commandIds per player; the same id for two players is two commands', async () => {
    const commandId = randomUUID();
    const a = await bus.execute(Add, { commandId, payload: { amount: 3 } }, ctx('pA'));
    const b = await bus.execute(Add, { commandId, payload: { amount: 3 } }, ctx('pB'));
    expect(a).toEqual({ seq: 1, total: 3 });
    expect(b).toEqual({ seq: 1, total: 3 });
  });

  it('concurrent duplicates: exactly one executes; the other replays after the wait (no 500)', async () => {
    const commandId = randomUUID();
    const before = executions;
    const results = await Promise.all([
      bus.execute(Add, { commandId, payload: { amount: 9 } }, ctx('pc')),
      bus.execute(Add, { commandId, payload: { amount: 9 } }, ctx('pc')),
      bus.execute(Add, { commandId, payload: { amount: 9 } }, ctx('pc')),
    ]);
    expect(executions).toBe(before + 1);
    const seqs = results.map((r) => r.seq);
    expect(new Set(seqs).size).toBe(1);
    const dups = results.filter((r) => (r as { duplicate?: boolean }).duplicate).length;
    expect(dups).toBe(2);
  });

  it('concurrent distinct commands for one player serialise under the player lock (seq never collides)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        bus.execute(Slow, { commandId: randomUUID(), payload: { amount: 1 } }, ctx('pl')),
      ),
    );
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('game-scoped commands use scope_key=game and the game lock', async () => {
    const commandId = randomUUID();
    const c: ExecCtx = { ...ctx('irrelevant'), actor: { kind: 'system', name: 'test' } };
    delete (c as { playerKey?: string }).playerKey;
    await bus.execute(GameCmd, { commandId, payload: { amount: 0 } }, c);
    const rows =
      await h.root`SELECT scope_key, actor FROM commands WHERE command_id = ${commandId}`;
    expect(rows[0]).toEqual({ scope_key: 'game', actor: 'system:test' });
  });

  it('actor policy is enforced (player cannot run a system command; wrong admin scope forbidden)', async () => {
    await expect(
      bus.execute(GameCmd, { commandId: randomUUID(), payload: { amount: 0 } }, ctx('p1')),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('validation failures are 400 and never touch the database', async () => {
    const commandId = randomUUID();
    await expect(
      bus.execute(Add, { commandId, payload: { amount: -1 } as never }, ctx('p1')),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      bus.execute(Add, { commandId, payload: { amount: 1, extra: true } as never }, ctx('p1')),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const rows = await h.root`SELECT 1 FROM commands WHERE command_id = ${commandId}`;
    expect(rows.length).toBe(0);
  });

  it('non-uuid commandId is refused for idempotent commands', async () => {
    await expect(
      bus.execute(Add, { commandId: 'abc', payload: { amount: 1 } }, ctx('p1')),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('a failing handler rolls back the ledger write, records a failed row, and a retry re-executes', async () => {
    const commandId = randomUUID();
    await expect(
      bus.execute(Failing, { commandId, payload: { amount: 1 } }, ctx('pf')),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const rows =
      await h.root`SELECT status, error_code FROM commands WHERE command_id = ${commandId}`;
    expect(rows[0]).toEqual({ status: 'failed', error_code: 'forbidden' });
    await expect(
      bus.execute(Failing, { commandId, payload: { amount: 1 } }, ctx('pf')),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // a different payload against a failed row is still a mismatch
    await expect(
      bus.execute(Failing, { commandId, payload: { amount: 2 } }, ctx('pf')),
    ).rejects.toMatchObject({ code: 'idempotency_mismatch' });
  });

  it('step-up: value commands refuse tokens older than 5 minutes', async () => {
    const StepUp = defineCommand<typeof AddSchema, { ok: true }>({
      type: 'test.stepup',
      schema: AddSchema,
      actorPolicy: 'player',
      scope: 'player',
      lock: 'player',
      idempotency: { owner: 'client', retention: '7d' },
      tx: 'required',
      stepUp: true,
    });
    bus.register(StepUp, async () => ({ ok: true as const }));
    const old = ctx('p1', {
      actor: {
        kind: 'player',
        playerKey: 'p1',
        registered: false,
        tokenIatMs: clock.now() - 6 * 60_000,
      },
    });
    await expect(
      bus.execute(StepUp, { commandId: randomUUID(), payload: { amount: 0 } }, old),
    ).rejects.toMatchObject({ code: 'unauthorized', details: { stepUp: true } });
    await expect(
      bus.execute(StepUp, { commandId: randomUUID(), payload: { amount: 0 } }, ctx('p1')),
    ).resolves.toEqual({ ok: true });
  });

  it('tx: none commands run without a transaction and without idempotency', async () => {
    const r = await bus.execute(
      NoTx,
      { commandId: 'not-needed', payload: { amount: 4 } },
      ctx('p1'),
    );
    expect(r).toEqual({ echoed: 4 });
  });

  it('offline > 7 days: retry of an old commandId whose full row was pruned → duplicate + original seq via tombstone, no 500', async () => {
    const commandId = randomUUID();
    const first = await bus.execute(Add, { commandId, payload: { amount: 11 } }, ctx('pold'));
    // age the row past 7d and run retention (as the app role: SECURITY DEFINER)
    await h.root`UPDATE commands SET received_at = now() - interval '8 days' WHERE command_id = ${commandId}`;
    await h.db.sql`SELECT apply_retention()`;
    const gone = await h.root`SELECT 1 FROM commands WHERE command_id = ${commandId}`;
    expect(gone.length).toBe(0);
    const tomb =
      await h.root`SELECT outcome_ref, type FROM command_tombstones WHERE command_id = ${commandId}`;
    expect(tomb[0]).toEqual({ outcome_ref: String(first.seq), type: 'test.add' });
    const again = await bus.execute(Add, { commandId, payload: { amount: 11 } }, ctx('pold'));
    expect(again).toMatchObject({ seq: first.seq, duplicate: true, expired: true });
    // and a different payload against the tombstone is still a mismatch
    await expect(
      bus.execute(Add, { commandId, payload: { amount: 12 } }, ctx('pold')),
    ).rejects.toMatchObject({ code: 'idempotency_mismatch' });
  });

  it('expired without a tombstone hook → bad_request, never a 500 or a re-execution', async () => {
    const commandId = randomUUID();
    await bus.execute(Slow, { commandId, payload: { amount: 1 } }, ctx('pexp'));
    await h.root`UPDATE commands SET received_at = now() - interval '8 days' WHERE command_id = ${commandId}`;
    await h.db.sql`SELECT apply_retention()`;
    await expect(
      bus.execute(Slow, { commandId, payload: { amount: 1 } }, ctx('pexp')),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('admin actor: every command is audited in admin_actions', async () => {
    const AdminCmd = defineCommand<typeof AddSchema, { ok: true }>({
      type: 'test.admin',
      schema: AddSchema,
      actorPolicy: { admin: 'support' },
      scope: 'game',
      lock: 'game',
      idempotency: { owner: 'client', retention: '1y' },
      tx: 'required',
    });
    bus.register(AdminCmd, async () => ({ ok: true as const }));
    const commandId = randomUUID();
    const c: ExecCtx = {
      gameId: 'template',
      env: 'dev',
      actor: { kind: 'admin', keyId: 'k1', scopes: ['support'] },
      adminKeyId: 'k1',
      requestId: 'r',
      now: clock.now(),
    };
    await bus.execute(AdminCmd, { commandId, payload: { amount: 0 } }, c);
    const audit =
      await h.root`SELECT admin_key_id, scope, command_type, outcome FROM admin_actions WHERE command_id = ${commandId}`;
    expect(audit[0]).toEqual({
      admin_key_id: 'k1',
      scope: 'support',
      command_type: 'test.admin',
      outcome: 'ok',
    });
    const readOnly: ExecCtx = { ...c, actor: { kind: 'admin', keyId: 'k2', scopes: ['read'] } };
    await expect(
      bus.execute(AdminCmd, { commandId: randomUUID(), payload: { amount: 0 } }, readOnly),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
