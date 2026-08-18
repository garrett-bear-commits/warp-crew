// Route helpers: every HTTP route is declared in @foundation/contracts ROUTES and registered here
// by id, so method/path/schemas/auth come from one place and a test can assert coverage.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Static, TSchema } from '@sinclair/typebox';
import { ROUTE_BY_ID, type RouteDef } from '@foundation/contracts/routes';
import { HEADERS } from '@foundation/contracts/enums';
import { AppError } from '../errors.ts';
import type { AppContext } from './context.ts';
import type { ExecCtx } from '../cqrs/define.ts';
import {
  authenticateAdmin,
  authenticateOps,
  authenticatePlayer,
  authenticatePlayerFromParts,
  requireScope,
} from '../auth/index.ts';
import { compareBuildVersions } from './versions.ts';

export interface HandlerArgs<B, P, Q> {
  req: FastifyRequest;
  reply: FastifyReply;
  body: B;
  params: P;
  query: Q;
  /** null only for public routes without player headers */
  exec: ExecCtx | null;
  requestId: string;
  now: number;
}

type Strip<R> = Omit<R, 'serverNow' | 'requestId'>;

export type RouteHandler<
  B extends TSchema | undefined,
  R extends TSchema,
  P extends TSchema | undefined = undefined,
  Q extends TSchema | undefined = undefined,
> = (
  args: HandlerArgs<
    B extends TSchema ? Static<B> : undefined,
    P extends TSchema ? Static<P> : Record<string, string>,
    Q extends TSchema ? Static<Q> : Record<string, string>
  >,
) => Promise<Strip<Static<R>> | { __status: number; body: Strip<Static<R>> }>;

function headerBag(req: FastifyRequest) {
  return {
    get(name: string): string | undefined {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    },
  };
}

function ip(req: FastifyRequest): string {
  return req.ip || 'unknown';
}

export const seenThrottle = new Map<string, number>();

async function buildExec(
  ctx: AppContext,
  route: RouteDef,
  req: FastifyRequest,
): Promise<ExecCtx | null> {
  const now = ctx.clock.now();
  const base = {
    gameId: ctx.config.gameId,
    env: ctx.config.env,
    requestId: req.requestId,
    now,
    ip: ip(req),
  } as const;
  const build = headerBag(req).get(HEADERS.buildVersion);
  const withBuild = (e: ExecCtx): ExecCtx => (build ? { ...e, buildVersion: build } : e);
  const authFail = async (e: unknown) => {
    const v = await ctx.limiter.hit(`ip.authfail:${ip(req)}`, 'ip.authfail');
    if (!v.allowed)
      throw new AppError('rate_limited', 'too many auth failures', {
        retryAfterMs: v.retryAfterMs,
      });
    throw e;
  };
  switch (route.auth) {
    case 'public': {
      const claimed = headerBag(req).get(HEADERS.playerKey);
      if (!claimed) return null;
      try {
        const a = authenticatePlayer(ctx.identity, ctx.config.gameId, now, headerBag(req));
        return withBuild({ ...base, actor: a.actor, playerKey: a.playerKey });
      } catch (e) {
        return authFail(e);
      }
    }
    case 'player': {
      let a;
      try {
        a = authenticatePlayer(ctx.identity, ctx.config.gameId, now, headerBag(req));
      } catch (e) {
        return authFail(e);
      }
      checkBuild(ctx, build);
      return withBuild({ ...base, actor: a.actor, playerKey: a.playerKey });
    }
    case 'beacon': {
      const b = (req.body ?? {}) as { playerKey?: string; token?: string };
      let a;
      try {
        a = authenticatePlayerFromParts(ctx.identity, ctx.config.gameId, now, b.playerKey, b.token);
      } catch (e) {
        return authFail(e);
      }
      return withBuild({ ...base, actor: a.actor, playerKey: a.playerKey });
    }
    case 'admin': {
      let actor;
      try {
        actor = authenticateAdmin(ctx.config.adminKeys, headerBag(req));
      } catch (e) {
        return authFail(e);
      }
      if (route.adminScope) {
        try {
          requireScope(actor, route.adminScope);
        } catch (e) {
          // write attempts from read keys alert (§7)
          ctx.log.warn(
            { adminKeyId: actor.keyId, route: route.id, requestId: req.requestId },
            'admin scope violation',
          );
          throw e;
        }
      }
      return { ...base, actor, adminKeyId: actor.keyId };
    }
    case 'ops': {
      try {
        return { ...base, actor: authenticateOps(ctx.config.opsSecret, headerBag(req)) };
      } catch (e) {
        return authFail(e);
      }
    }
    case 'lab': {
      if (ctx.config.env !== 'lab') throw new AppError('not_found', 'not found');
      try {
        return { ...base, actor: authenticateOps(ctx.config.opsSecret, headerBag(req)) };
      } catch (e) {
        return authFail(e);
      }
    }
  }
}

function checkBuild(ctx: AppContext, build: string | undefined): void {
  if (!build) return;
  const min = ctx.liveops.minBuildVersion();
  if (min && compareBuildVersions(build, min) < 0)
    throw new AppError('build_too_old', `build ${build} < minBuildVersion ${min}`, {
      minBuildVersion: min,
    });
}

/**
 * Register a route from the contracts registry. The handler returns the payload without
 * serverNow/requestId (added here). Return {__status, body} for a non-200 success (409 CAS).
 */
export function route<
  B extends TSchema | undefined,
  R extends TSchema,
  P extends TSchema | undefined = undefined,
  Q extends TSchema | undefined = undefined,
>(app: FastifyInstance, ctx: AppContext, id: string, handler: RouteHandler<B, R, P, Q>): void {
  const def = ROUTE_BY_ID.get(id);
  if (!def) throw new Error(`route ${id} is not declared in @foundation/contracts`);
  if (def.auth === 'lab' && ctx.config.env !== 'lab') return; // QA routes register only in lab
  const schema: Record<string, unknown> = {};
  if (def.body) schema.body = def.body;
  if (def.params) schema.params = def.params;
  if (def.query) schema.querystring = def.query;
  const isWrite = def.method !== 'GET';
  app.route({
    method: def.method,
    url: def.path,
    schema,
    // admin Idempotency-Key header maps directly to commandId (§4.1)
    preValidation: async (req) => {
      if (def.auth === 'admin' && isWrite) {
        const key = headerBag(req).get(HEADERS.idempotencyKey);
        const b = req.body as Record<string, unknown> | undefined;
        if (key && b && typeof b === 'object' && b.commandId === undefined) b.commandId = key;
      }
    },
    handler: async (req, reply) =>
      ctx.sentry.span(
        {
          name: `${def.method} ${def.path}`,
          op: 'http.server',
          attributes: { 'http.request.method': def.method, 'http.route': def.path },
        },
        async (setStatus) => {
          try {
            const r = await handleRoute(req, reply);
            setStatus(reply.statusCode);
            return r;
          } catch (e) {
            setStatus(e instanceof AppError ? e.status : 500);
            throw e;
          }
        },
      ),
  });

  async function handleRoute(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    {
      const exec = await buildExec(ctx, def!, req);
      if (isWrite && exec && (exec.actor.kind === 'player' || exec.actor.kind === 'admin')) {
        const v = await ctx.limiter.hit(`ip.write:${ip(req)}`, 'ip.write');
        if (!v.allowed)
          throw new AppError('rate_limited', 'per-IP write ceiling', {
            retryAfterMs: v.retryAfterMs,
          });
      }
      if (exec?.actor.kind === 'player') void ctx.onPlayerSeen?.(exec);
      const now = ctx.clock.now();
      const out = await handler({
        req,
        reply,
        body: req.body as never,
        params: req.params as never,
        query: req.query as never,
        exec,
        requestId: req.requestId,
        now,
      });
      const o = out as { __status?: number; body?: unknown };
      if (o && typeof o === 'object' && typeof o.__status === 'number') {
        reply.status(o.__status);
        return { ...(o.body as object), serverNow: ctx.clock.now(), requestId: req.requestId };
      }
      return { ...(out as object), serverNow: ctx.clock.now(), requestId: req.requestId };
    }
  }
}

/** Test/boot helper: which contract routes are registered on this app. */
export function registeredRouteIds(app: FastifyInstance): Set<string> {
  const ids = new Set<string>();
  const printed = app.printRoutes({ commonPrefix: false });
  for (const r of ROUTE_BY_ID.values()) {
    const path = r.path.replace(/:([A-Za-z0-9_]+)/g, ':$1');
    if (app.hasRoute({ method: r.method, url: path })) ids.add(r.id);
  }
  void printed;
  return ids;
}
