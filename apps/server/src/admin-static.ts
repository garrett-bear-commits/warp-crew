// Admin inspector: static page on a SEPARATE origin (ADR-021) with a strict CSP. Serves the built
// admin-inspector/dist when present; otherwise the port stays closed.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import type { ServerConfig } from '@foundation/server';

export function inspectorCsp(apiOrigin: string): string {
  return [
    `default-src 'none'`,
    `script-src 'self'`,
    `style-src 'self'`,
    `img-src 'self' data:`,
    `connect-src ${apiOrigin || "'self'"}`,
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join('; ');
}

export async function startAdminInspector(
  config: ServerConfig,
  log: Logger,
  distDir?: string,
): Promise<{ close(): Promise<void>; port: number } | null> {
  const dir =
    distDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'admin-inspector', 'dist');
  if (!existsSync(dir)) {
    log.info({ dir }, 'admin inspector not built; admin origin not started');
    return null;
  }
  const app = Fastify({ logger: false });
  const apiOrigin = config.publicUrl || `http://localhost:${config.port}`;
  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', inspectorCsp(apiOrigin));
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('cache-control', 'no-store');
  });
  await app.register(fastifyStatic, { root: dir, index: ['index.html'] });
  await app.listen({ port: config.adminPort, host: config.host });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.adminPort;
  log.info({ port, apiOrigin }, 'admin inspector listening (separate origin, strict CSP)');
  return { close: () => app.close(), port };
}
