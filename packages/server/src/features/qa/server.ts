// qa feature (lab only, §4.3): qa_ identity mint. Snapshot import lives in lineage (QaImport).
// Routes register only when GAME_ENV=lab (the route helper drops auth=lab routes elsewhere).
import type { FastifyInstance } from 'fastify';
import type { QaMintBody} from '@foundation/contracts';
import { type QaMintResult } from '@foundation/contracts';
import { mintMockToken } from '@foundation/jest-verify';
import { mintPlayerToken } from '@foundation/testkit';
import { AppError } from '../../errors.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import { randomBytes } from 'node:crypto';

export function registerQa(app: FastifyInstance, ctx: AppContext): void {
  if (ctx.config.env !== 'lab') return;
  route<typeof QaMintBody, typeof import('@foundation/contracts').QaMintResult>(
    app,
    ctx,
    'qa.mint',
    async ({ body, now }) => {
      const playerKey = body.playerId ?? `qa_${randomBytes(6).toString('hex')}`;
      let token: string;
      if (ctx.config.identityProvider === 'mock')
        token = mintMockToken(playerKey, now, body.registered ?? false);
      else {
        const secret = ctx.config.jestSecrets[0];
        if (!secret) throw new AppError('not_configured', 'no identity secret');
        token = mintPlayerToken({
          playerId: playerKey,
          gameId: ctx.config.gameId,
          secretB64: secret,
          nowMs: now,
          registered: body.registered ?? false,
        });
      }
      const out: Omit<QaMintResult, 'serverNow' | 'requestId'> = {
        playerKey,
        token,
        expiresAt: now + ctx.game.maxTokenAgeSec * 1000,
      };
      return out;
    },
  );
}
