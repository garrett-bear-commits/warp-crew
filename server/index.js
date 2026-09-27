// Boot: connect, migrate, listen. Configuration comes only from the environment.
import postgres from 'postgres';
import { buildApp } from './app.js';
import { createStore, migrate } from './store.js';

const env = process.env;
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const devAuth = env.WARPCREW_DEV_AUTH === '1';
if (devAuth) console.warn('[warp-crew] WARPCREW_DEV_AUTH is ON: x-player-id is trusted without a token. Never use this with real players.');
if (!devAuth && (!env.JEST_PLAYER_SECRET || !env.JEST_GAME_ID)) {
  console.warn('[warp-crew] JEST_PLAYER_SECRET or JEST_GAME_ID missing: every request and receipt will be refused.');
}

const sql = postgres(env.DATABASE_URL, { ssl: env.PGSSL === 'off' ? false : 'prefer', max: 10 });
await migrate(sql);
const app = buildApp({
  store: createStore(sql),
  secret: env.JEST_PLAYER_SECRET,
  gameId: env.JEST_GAME_ID,
  devAuth,
  allowOrigins: (env.ALLOW_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean),
  logger: true,
});
await app.listen({ port: Number(env.PORT) || 8787, host: '0.0.0.0' });
