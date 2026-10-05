// Composition root (§3 apps/server): env → config, games/<id>/ → game config + policy, createServer.
import {
  loadConfig,
  createServer,
  createLogger,
  initSentry,
  installProcessHandlers,
  logShipperFromConfig,
} from '@foundation/server';
import { selectGame } from './games.ts';
import { startAdminInspector } from './admin-static.ts';

const config = loadConfig();
const { game, policy } = selectGame(config.gameId, process.env.GAME_CONFIG);
// PostHog log shipping only when POSTHOG_LOGS_TOKEN is set; stdout logging either way.
const shipper = logShipperFromConfig(config);
const log = createLogger(config.logLevel, { ship: shipper });
// Sentry first, then the process failure policy, so a boot failure is logged, reported and
// flushed before the process exits (a rejected top-level await reaches uncaughtException).
const sentry = initSentry({
  dsn: config.sentryDsn,
  release: config.buildVersion,
  gameId: config.gameId,
  env: config.env,
});
installProcessHandlers({
  log,
  flush: (timeoutMs) => Promise.all([sentry.close(timeoutMs), shipper?.close(timeoutMs)]),
});
const server = await createServer({ config, game, policy, log, sentry });
await server.start();
const admin = await startAdminInspector(config, log, { api: server });

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  await admin?.close();
  await server.stop();
  await shipper?.close(2000);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
