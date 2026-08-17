// telemetry feature (§4.3): allow-listed integrity_events (≤20/call, daily budget, 30 d), request-id joins.
import type { FastifyInstance } from 'fastify';
import { IntegrityBatchBody, type IntegrityBatchResult } from '@foundation/contracts';
import { INTEGRITY_EVENT_KINDS } from '@foundation/contracts/enums';
import { defineCommand } from '../../cqrs/define.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';

type Result = Omit<IntegrityBatchResult, 'serverNow' | 'requestId'>;

export const IntegrityIngest = defineCommand<typeof IntegrityBatchBody, Result>({
  type: 'telemetry.integrity',
  schema: IntegrityBatchBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '7d' },
  tx: 'required',
  limit: 'telemetry',
});

export function registerTelemetry(app: FastifyInstance, ctx: AppContext): void {
  const { bus } = ctx;
  ctx.declaredCommands.push(IntegrityIngest);
  bus.register(IntegrityIngest, async (input, exec, tx) => {
    const t = tx!;
    const playerKey = exec.playerKey!;
    const day = new Date(exec.now).toISOString().slice(0, 10);
    const used = await t<
      { used: number }[]
    >`INSERT INTO integrity_budgets (player_key, day, used) VALUES (${playerKey}, ${day}, 0) ON CONFLICT (player_key, day) DO UPDATE SET used = integrity_budgets.used RETURNING used`;
    let remaining = Math.max(0, ctx.game.integrityDailyBudget - (used[0]?.used ?? 0));
    let accepted = 0;
    let dropped = 0;
    for (const e of input.events) {
      if (!(INTEGRITY_EVENT_KINDS as readonly string[]).includes(e.kind) || remaining <= 0) {
        dropped++;
        continue;
      }
      await t`INSERT INTO integrity_events (player_key, kind, at, detail, message, breadcrumbs, build_version, request_id, command_id)
        VALUES (${playerKey}, ${e.kind}, ${new Date(e.at)}, ${e.detail ? t.json(e.detail as never) : null}, ${e.message ? e.message.slice(0, 512) : null}, ${e.breadcrumbs ? t.json(e.breadcrumbs as never) : null}, ${e.buildVersion ?? exec.buildVersion ?? null}, ${exec.requestId}, ${input.commandId})`;
      accepted++;
      remaining--;
    }
    await t`UPDATE integrity_budgets SET used = used + ${accepted} WHERE player_key = ${playerKey} AND day = ${day}`;
    return { accepted, dropped, budgetRemaining: remaining };
  });
  route<typeof IntegrityBatchBody, typeof import('@foundation/contracts').IntegrityBatchResult>(
    app,
    ctx,
    'telemetry.integrity',
    async ({ body, exec }) =>
      bus.execute(IntegrityIngest, { commandId: body.commandId, payload: body }, exec!),
  );
}
