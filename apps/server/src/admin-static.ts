// Admin inspector: static page on a SEPARATE origin (ADR-021) with a strict CSP. Serves the built
// admin-inspector/dist when present; otherwise the port stays closed.
//
// The admin origin can be the only public door to the admin API: when the game's web proxy 404s
// /api/admin, this origin forwards /admin/v1/* (that prefix only) into the API in-process.
// Nothing else of the API (/v1, /ops, /qa, /health) is reachable here. This is the local
// development origin (:8081); a hosted deploy can do the same with a reverse proxy in front of a
// private API (and Cloudflare Access in front of the proxy, CF_ACCESS_*).
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import { HEADERS } from '@foundation/contracts/enums';
import { CF_ACCESS_JWT_HEADER, envelope, type Server, type ServerConfig } from '@foundation/server';

/** The one API prefix the admin origin forwards. */
export const ADMIN_API_PREFIX = '/admin/v1/';

const FORWARDED_REQUEST_HEADERS = [
  'content-type',
  'accept',
  HEADERS.adminKeyId,
  HEADERS.adminSecret,
  HEADERS.requestId,
  HEADERS.idempotencyKey,
  // Cloudflare Access's token, when Access is in front; the API checks it.
  CF_ACCESS_JWT_HEADER,
] as const;
const FORWARDED_RESPONSE_HEADERS = ['content-type', HEADERS.requestId, 'retry-after'] as const;

function originOf(url: string): string {
  if (!url) return '';
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? '' : origin;
  } catch {
    return '';
  }
}

/** connect-src is always this origin (the forwarder); an explicit API origin is allowed as well. */
export function inspectorCsp(apiOrigin = ''): string {
  const extra = originOf(apiOrigin);
  return [
    `default-src 'none'`,
    `script-src 'self'`,
    `style-src 'self'`,
    `img-src 'self' data:`,
    `connect-src 'self'${extra ? ` ${extra}` : ''}`,
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join('; ');
}

/**
 * The operator's address, derived like a web proxy derives a player's: a platform edge (e.g.
 * Railway's) connects from its own address and puts the client in X-Real-IP; without it the peer
 * is the client. A client's own X-Forwarded-For is never trusted.
 */
export function adminClientIp(req: FastifyRequest): string | undefined {
  const h = req.headers['x-real-ip'];
  const real = (Array.isArray(h) ? h[0] : h)?.trim();
  if (real && isIP(real)) return real;
  return req.socket.remoteAddress || undefined;
}

/** Path + query to forward, after resolving dot segments; null unless it stays under the prefix. */
export function adminForwardPath(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl, 'http://admin.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'http://admin.invalid' || !url.pathname.startsWith(ADMIN_API_PREFIX))
    return null;
  return `${url.pathname}${url.search}`;
}

export interface AdminOriginOptions {
  /** The API that /admin/v1/* is forwarded to, in-process. */
  api: Pick<Server, 'app' | 'ctx'>;
  /** Built inspector; default admin-inspector/dist next to src. */
  distDir?: string;
}

/** The admin origin app (not listening), or null when the inspector is not built. */
export async function buildAdminOrigin(
  config: ServerConfig,
  log: Logger,
  opts: AdminOriginOptions,
): Promise<FastifyInstance | null> {
  const dir =
    opts.distDir ??
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'admin-inspector', 'dist');
  if (!existsSync(dir)) {
    log.info({ dir }, 'admin inspector not built; admin origin not started');
    return null;
  }
  const api = opts.api;
  // A body the API would accept always fits (its limit grows with the game's blob limit).
  const app = Fastify({
    logger: false,
    bodyLimit: api.app.initialConfig.bodyLimit ?? 1024 * 1024,
    genReqId: () => randomUUID(),
  });
  const csp = inspectorCsp(config.publicUrl);
  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', csp);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('cache-control', 'no-store');
  });
  // Bodies pass through as bytes: the API parses and validates them.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  const now = () => api.ctx.clock.now();
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send(envelope('not_found', 'not found', req.id, now()));
  });
  app.setErrorHandler((err: { statusCode?: number; message?: string }, req, reply) => {
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) log.error({ err, requestId: req.id }, 'admin origin request failed');
    const code = status === 413 ? 'payload_too_large' : status === 500 ? 'internal' : 'bad_request';
    void reply
      .status(status)
      .send(envelope(code, status === 500 ? 'internal error' : err.message, req.id, now()));
  });

  async function forward(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const path = adminForwardPath(req.url);
    if (!path) return reply.callNotFound();
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const v = req.headers[name];
      if (typeof v === 'string') headers[name] = v;
    }
    const ip = adminClientIp(req);
    if (ip) headers['x-forwarded-for'] = ip;
    const res = await api.app.inject({
      method: req.method as 'GET' | 'POST' | 'HEAD',
      url: path,
      headers,
      remoteAddress: '127.0.0.1',
      ...(Buffer.isBuffer(req.body) ? { payload: req.body } : {}),
    });
    void reply.status(res.statusCode);
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const v = res.headers[name];
      if (v !== undefined) void reply.header(name, v);
    }
    return reply.send(res.rawPayload);
  }
  app.route({ method: ['GET', 'POST'], url: `${ADMIN_API_PREFIX}*`, handler: forward });

  await app.register(fastifyStatic, { root: dir, index: ['index.html'] });
  return app;
}

export async function startAdminInspector(
  config: ServerConfig,
  log: Logger,
  opts: AdminOriginOptions,
): Promise<{ close(): Promise<void>; port: number } | null> {
  const app = await buildAdminOrigin(config, log, opts);
  if (!app) return null;
  await app.listen({ port: config.adminPort, host: config.host });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.adminPort;
  log.info(
    { port, csp: inspectorCsp(config.publicUrl) },
    `admin inspector listening (separate origin, strict CSP, forwards ${ADMIN_API_PREFIX}*)`,
  );
  return { close: () => app.close(), port };
}
