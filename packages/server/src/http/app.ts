// buildApp(): Fastify 5 + TypeBox type provider, request-context correlation ids, one error
// envelope, CORS allowlist, text/plain JSON parser (beacon), health routes. Features register
// their routes through the helpers in ./route.ts.
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import cors from '@fastify/cors';
import { TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox';
import { randomUUID } from 'node:crypto';
import { HEADERS, CONTRACT_VERSION } from '@foundation/contracts/enums';
import type { ErrorEnvelope } from '@foundation/contracts';
import { AppError } from '../errors.ts';
import type { AppContext } from './context.ts';
import { registerHealthRoutes } from '../health/index.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Correlation id (server-generated or forwarded x-request-id); never idempotency state. */
    requestId: string;
    /** Server clock at request start. */
    startedAt: number;
  }
}

const REQ_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function envelope(
  code: ErrorEnvelope['error'],
  message: string | undefined,
  correlationId: string,
  serverNow: number,
  details?: unknown,
): ErrorEnvelope {
  const e: ErrorEnvelope = { error: code, correlationId, serverNow };
  if (message) e.message = message;
  if (details !== undefined) e.details = details;
  return e;
}

export function buildFastify(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    loggerInstance: ctx.log as unknown as FastifyBaseLogger,
    disableRequestLogging: true,
    trustProxy: 1,
    bodyLimit: Math.max(ctx.game.blobLimits.maxEncodedBytes + 8 * 1024, 64 * 1024),
    genReqId: (req) => {
      const h = req.headers[HEADERS.requestId];
      const v = Array.isArray(h) ? h[0] : h;
      return v && REQ_ID_RE.test(v) ? v : randomUUID();
    },
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: 'array',
        useDefaults: false,
        allErrors: false,
      },
    },
  });
  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  app.decorateRequest('requestId', '');
  app.decorateRequest('startedAt', 0);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    req.requestId = req.id;
    req.startedAt = ctx.clock.now();
    reply.header(HEADERS.requestId, req.requestId);
    reply.header('cache-control', 'no-store');
  });

  // text/plain JSON parser: the beacon route carries auth in a text/plain body (no preflight).
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new AppError('bad_request', 'text/plain body must be JSON'), undefined);
    }
  });

  const origins = new Set([...ctx.config.clientOrigins, ...ctx.game.origins]);
  const originPatterns = [...origins]
    .filter((o) => o.includes('*'))
    .map(
      (o) =>
        new RegExp(
          '^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+') + '$',
          'i',
        ),
    );
  void app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / non-browser
      if (origins.has(origin) || originPatterns.some((p) => p.test(origin))) return cb(null, true);
      if (ctx.config.env !== 'prod' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
        return cb(null, true);
      cb(null, false);
    },
    methods: ['GET', 'PUT', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      HEADERS.playerKey,
      HEADERS.authorization,
      HEADERS.requestId,
      HEADERS.buildVersion,
      HEADERS.adminKeyId,
      HEADERS.adminSecret,
      HEADERS.idempotencyKey,
    ],
    exposedHeaders: [HEADERS.requestId],
    maxAge: 600,
  });

  app.setErrorHandler((err, req, reply) => {
    const now = ctx.clock.now();
    if (err instanceof AppError) {
      if (err.status >= 500)
        req.log.error(
          { err: err.message, code: err.code, requestId: req.requestId },
          'request failed',
        );
      else if (err.status !== 401 && err.status !== 429)
        req.log.warn(
          { code: err.code, requestId: req.requestId, msg: err.message },
          'request refused',
        );
      return reply
        .status(err.status)
        .send(envelope(err.code, err.message, req.requestId, now, err.details));
    }
    const fe = err as {
      validation?: unknown;
      statusCode?: number;
      code?: string;
      message?: string;
    };
    if (fe.validation) {
      return reply
        .status(400)
        .send(
          envelope(
            'validation_failed',
            'request does not match the contract',
            req.requestId,
            now,
            fe.validation,
          ),
        );
    }
    if (fe.statusCode === 413 || fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply
        .status(413)
        .send(envelope('payload_too_large', 'body too large', req.requestId, now));
    }
    if (fe.statusCode === 415 || fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply
        .status(400)
        .send(envelope('bad_request', 'unsupported media type', req.requestId, now));
    }
    if (
      fe.statusCode === 400 ||
      fe.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
      fe.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
    ) {
      return reply
        .status(400)
        .send(envelope('bad_request', fe.message ?? 'bad request', req.requestId, now));
    }
    if (fe.statusCode === 404)
      return reply.status(404).send(envelope('not_found', 'not found', req.requestId, now));
    req.log.error({ err, requestId: req.requestId }, 'unhandled error');
    return reply.status(500).send(envelope('internal', 'internal error', req.requestId, now));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(envelope('not_found', 'not found', req.requestId, ctx.clock.now()));
  });

  registerHealthRoutes(app, ctx);
  app.log.info(
    { contractVersion: CONTRACT_VERSION, gameId: ctx.config.gameId, env: ctx.config.env },
    'app built',
  );
  return app;
}
