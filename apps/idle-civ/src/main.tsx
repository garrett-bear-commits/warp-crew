import { createClock, createGameClient, createStorage } from '@foundation/client';
import { ErrorBoundary, PlatformProvider } from '@foundation/client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createGameApi } from './api.ts';
import { createPlatform } from './platform.ts';
import { readConfig } from './runtime-config.ts';
import { idleCivCodec, idleCivEngine, TPS } from './sim/index.ts';
import { IdleCivProvider } from './StoreProvider.tsx';
import { App } from './ui/App.tsx';
import './styles.css';

const clock = createClock();
const cfg = readConfig(createStorage());
const platform = createPlatform(cfg, clock);
const client = createGameClient({
  engine: idleCivEngine,
  codec: idleCivCodec,
  platform,
  serverUrl: cfg.apiUrl,
  gameId: cfg.gameId,
  buildVersion: cfg.buildVersion,
  journal: 'errors_only',
  clock,
  loop: { tps: TPS },
  sync: { pushMs: cfg.pushMs },
  journalArgs: {
    assign_worker: ['profession', 'delta'],
    fund_job: ['jobId'],
    craft_tool: ['kind'],
    equip_founder_card: ['cardId'],
  },
  describeAction: (a) => {
    switch (a.type) {
      case 'assign_worker':
        return { name: a.type, args: { profession: a.profession, delta: a.delta } };
      case 'fund_job':
        return { name: a.type, args: { jobId: a.jobId } };
      case 'craft_tool':
        return { name: a.type, args: { kind: a.kind } };
      case 'equip_founder_card':
        return { name: a.type, args: { cardId: a.cardId } };
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
void bootPromise;
void api;

const g = globalThis as { __idleCiv?: unknown };
g.__idleCiv = { client, cfg, clock };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlatformProvider platform={platform} client={client}>
      <ErrorBoundary>
        <IdleCivProvider client={client}>
          <App />
        </IdleCivProvider>
      </ErrorBoundary>
    </PlatformProvider>
  </StrictMode>,
);
