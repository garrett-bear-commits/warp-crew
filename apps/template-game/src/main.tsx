// Composition root (§11): clock → platform → createGameClient({engine, codec, platform, serverUrl,
// gameId, buildVersion, journal}) → boot() → React root with PlatformProvider / LoadingGate /
// ErrorBoundary. boot() is started before the first render so the boot UI (checking cloud, keep
// local / adopt cloud, cloud unreachable → retry / start new) renders while the machine runs.
import { createClock, createGameClient, createStorage } from '@foundation/client';
import { PlatformProvider, ErrorBoundary } from '@foundation/client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createGameApi } from './api.ts';
import { App } from './App.tsx';
import { templateCodec } from './codec.ts';
import { readConfig } from './config.ts';
import { templateEngine, TPS } from './engine.ts';
import { createPlatform } from './platform.ts';
import './styles.css';

const clock = createClock();
// a probe of the local tier for the player id only (the client owns its own tier)
const cfg = readConfig(createStorage());
const platform = createPlatform(cfg, clock);
const client = createGameClient({
  engine: templateEngine,
  codec: templateCodec,
  platform,
  serverUrl: cfg.apiUrl,
  gameId: cfg.gameId,
  buildVersion: cfg.buildVersion,
  journal: 'errors_only',
  clock,
  loop: { tps: TPS },
  sync: { pushMs: cfg.pushMs },
  // journal: inputs only, args only for bounded schemas (never the free-text rename)
  journalArgs: { buy: ['upgrade'], grant: ['gold', 'gems'], adjust: ['gems'] },
  describeAction: (a) => {
    switch (a.type) {
      case 'buy':
        return { name: a.type, args: { upgrade: a.upgrade } };
      case 'grant':
        return { name: a.type, args: { gold: a.gold ?? 0, gems: a.gems ?? 0 } };
      case 'adjust':
        return { name: a.type, args: { gems: a.gems } };
      default:
        return { name: a.type };
    }
  },
});
const api = createGameApi({
  baseUrl: cfg.apiUrl,
  clock,
  auth: () => {
    const p = client.player;
    if (!p) return null;
    const token = platform.identity.tokenFor(p.playerId);
    return token ? { playerKey: p.playerId, token, buildVersion: cfg.buildVersion } : null;
  },
  refreshAuth: async () => (await platform.identity.refreshCredential()) !== null,
});

const bootPromise = client.boot().then(
  () => null,
  (e: unknown) => (e instanceof Error ? e.message : String(e)),
);

const g = globalThis as { __templateGame?: unknown };
g.__templateGame = { client, cfg, clock, api };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlatformProvider platform={platform} client={client}>
      <ErrorBoundary>
        <App cfg={cfg} client={client} api={api} clock={clock} bootPromise={bootPromise} />
      </ErrorBoundary>
    </PlatformProvider>
  </StrictMode>,
);
