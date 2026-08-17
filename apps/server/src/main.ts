// Composition root (§3 apps/server): env → config, games/<id>/ → game config + policy, createServer.
import { loadConfig, createServer, createLogger } from '@foundation/server';
import { selectGame } from './games.ts';
import { startAdminInspector } from './admin-static.ts';

const config = loadConfig();
const { game, policy } = selectGame(config.gameId);
const log = createLogger(config.logLevel);
const server = await createServer({ config, game, policy, log });
await server.start();
const admin = await startAdminInspector(config, log);

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  await admin?.close();
  await server.stop();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
