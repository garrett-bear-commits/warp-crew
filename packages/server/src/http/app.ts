// buildApp(): Fastify 5 + TypeBox type provider, request-context correlation ids, one error
// envelope, CORS allowlist, text/plain JSON parser (beacon), health routes. Features register
// their routes through the helpers in ./route.ts.
import Fastify, {
  LogController,
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
import { traceHeadersOf } from './trace.ts';

/** Token rejections our own signer could not cause: a wrong secret or audience, or a bad token. */
const SYSTEMIC_AUTH = new Set(['bad_signature', 'wrong_audience', 'bad_alg', 'malformed']);

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
    logController: new LogController({ disableRequestLogging: true }),
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
  // Every answered request but health checks counts toward this instance's outcome rates.
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(req.routeOptions?.url ?? req.url).startsWith('/health'))
      ctx.httpStats.record(reply.statusCode, ctx.clock.now());
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
      // Sentry trace propagation from the browser (errorReporting.ts sentryTraceHeaders).
      'sentry-trace',
      'baggage',
    ],
    exposedHeaders: [HEADERS.requestId],
    maxAge: 600,
  });

  // What every log line and Sentry event about a request carries: its id (the client's
  // correlationId), route, method, status and the build that sent it.
  const requestContext = (
    req: FastifyRequest,
    status: number,
    code?: string,
  ): Record<string, unknown> => {
    const build = req.headers[HEADERS.buildVersion];
    return {
      requestId: req.requestId,
      route: req.routeOptions?.url ?? req.url,
      method: req.method,
      status,
      ...(code ? { code } : {}),
      ...(typeof build === 'string' ? { buildVersion: build.slice(0, 64) } : {}),
    };
  };

  app.setErrorHandler((err, req, reply) => {
    const now = ctx.clock.now();
    if (err instanceof AppError) {
      const context = {
        ...requestContext(req, err.status, err.code),
        ...(err.details !== undefined ? { details: err.details } : {}),
      };
      const reason = (err.details as { reason?: unknown } | undefined)?.reason;
      if (err.status >= 500) {
        ctx.sentry.captureException(err, context, { trace: traceHeadersOf(req) });
        // The error object, not its message: pino keeps the stack, `cause` and pg fields.
        req.log.error({ err, ...context }, 'request failed');
      } else {
        // Expired tokens and rate limits are routine: logged at info, every other refusal warns.
        const routine = err.status === 401 || err.status === 429;
        req.log[routine ? 'info' : 'warn']({ ...context, reason: err.message }, 'request refused');
        // A refused purchase verification may leave a charged player without gems.
        if (req.routeOptions?.url?.startsWith('/v1/purchases/verify'))
          ctx.sentry.captureException(err, context, {
            fingerprint: ['purchase-verify-refused', err.code, String(reason ?? '')],
            trace: traceHeadersOf(req),
          });
        // A token our own signer could not have issued (wrong secret or audience, not expiry)
        // refuses every player: one warning issue per reason.
        else if (
          err.code === 'unauthorized' &&
          typeof reason === 'string' &&
          SYSTEMIC_AUTH.has(reason)
        )
          ctx.sentry.captureMessage(`Player token rejected: ${reason}`, {
            level: 'warning',
            fingerprint: ['auth-rejected', reason],
            context: { ...context, reason },
            trace: traceHeadersOf(req),
          });
      }
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
      // A request the contract refuses is a client and server out of step (or a bug): one warning
      // issue per route, with the failing paths.
      const route = req.routeOptions?.url ?? req.url;
      const context = {
        ...requestContext(req, 400, 'validation_failed'),
        validation: fe.validation,
      };
      req.log.warn(context, 'request failed validation');
      ctx.sentry.captureMessage('Request failed contract validation', {
        level: 'warning',
        fingerprint: ['validation-failed', route],
        context,
        trace: traceHeadersOf(req),
      });
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
      req.log.warn(requestContext(req, 413, 'payload_too_large'), 'request refused');
      return reply
        .status(413)
        .send(envelope('payload_too_large', 'body too large', req.requestId, now));
    }
    if (fe.statusCode === 415 || fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      req.log.warn(requestContext(req, 400, 'bad_request'), 'unsupported media type');
      return reply
        .status(400)
        .send(envelope('bad_request', 'unsupported media type', req.requestId, now));
    }
    if (
      fe.statusCode === 400 ||
      fe.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
      fe.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
    ) {
      req.log.warn(
        { ...requestContext(req, 400, 'bad_request'), reason: fe.message },
        'request refused',
      );
      return reply
        .status(400)
        .send(envelope('bad_request', fe.message ?? 'bad request', req.requestId, now));
    }
    if (fe.statusCode === 404)
      return reply.status(404).send(envelope('not_found', 'not found', req.requestId, now));
    const context = requestContext(req, 500, 'internal');
    req.log.error({ err, ...context }, 'unhandled error');
    ctx.sentry.captureException(err, context, { trace: traceHeadersOf(req) });
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
