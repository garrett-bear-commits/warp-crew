// Boot: connect, migrate, listen. Configuration comes only from the environment.
import postgres from 'postgres';
import { buildApp } from './app.js';
import { validSecret } from './auth.js';
import { createStore, migrate } from './store.js';

const env = process.env;
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const devAuth = env.WARPCREW_DEV_AUTH === '1';
// Fail closed: refuse to listen rather than run in a state that accepts everyone or no one.
// Dev auth only runs on an explicitly development server.
if (devAuth && env.NODE_ENV !== 'development') {
  console.error('[warp-crew] WARPCREW_DEV_AUTH requires NODE_ENV=development. Refusing to start.');
  process.exit(1);
}
if (devAuth) console.warn('[warp-crew] WARPCREW_DEV_AUTH is ON: x-player-id is trusted without a token. Never use this with real players.');
if (!validSecret(env.JEST_PLAYER_SECRET) || !env.JEST_GAME_ID) {
  console.error('[warp-crew] JEST_PLAYER_SECRET must be the base64 Jest secret (>= 16 bytes) and JEST_GAME_ID must be set. Refusing to start.');
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, { ssl: env.PGSSL === 'off' ? false : 'prefer', max: 10 });
await migrate(sql);
const app = buildApp({
  store: createStore(sql, { grantSandbox: env.JEST_GRANT_SANDBOX === '1' }),
  secret: env.JEST_PLAYER_SECRET,
  gameId: env.JEST_GAME_ID,
  devAuth,
  grantSandbox: env.JEST_GRANT_SANDBOX === '1',
  // No cross-origin access unless the game's origins are listed explicitly.
  allowOrigins: (env.ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  logger: true,
});
await app.listen({ port: Number(env.PORT) || 8787, host: '0.0.0.0' });
