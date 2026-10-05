// names feature: screens a player-typed name with Jev before the game shows or sends it (jev.ts).
// Stateless and outside any transaction: nothing is stored, and a Jev call never holds a lock.
import type { FastifyInstance } from 'fastify';
import { NameCheckBody, type NameCheckResult } from '@foundation/contracts';
import { defineCommand } from '../../cqrs/define.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import { createNameModerator, type NameModerator } from './jev.ts';

type Result = Omit<NameCheckResult, 'serverNow' | 'requestId'>;

export const NameCheck = defineCommand<typeof NameCheckBody, Result>({
  type: 'names.check',
  schema: NameCheckBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'none', retention: '7d' },
  tx: 'none',
  limit: 'names',
});

export function registerNames(
  app: FastifyInstance,
  ctx: AppContext,
  moderator: NameModerator = createNameModerator({
    apiKey: ctx.config.typesafeApiKey,
    log: ctx.log,
    report: (error, status) =>
      ctx.sentry.captureException(
        error,
        { command: 'names.check', ...(status !== null ? { status } : {}) },
        { level: 'warning', fingerprint: ['jev-unavailable', String(status ?? 'network')] },
      ),
  }),
): void {
  const { bus } = ctx;
  if (!ctx.config.typesafeApiKey)
    ctx.log.warn('TYPESAFE_API_KEY is unset: names.check answers unchecked');
  ctx.declaredCommands.push(NameCheck);
  bus.register(NameCheck, async (input) => ({ verdict: await moderator.check(input.name) }));
  route<typeof NameCheckBody, typeof import('@foundation/contracts').NameCheckResult>(
    app,
    ctx,
    'names.check',
    async ({ body, exec }) =>
      bus.execute(NameCheck, { commandId: body.commandId, payload: body }, exec!),
  );
}
