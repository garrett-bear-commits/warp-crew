import {
  announceIncognitoLoaded,
  announceIncognitoFailed,
  announceIncognitoReady,
  createClock,
  createStorage,
  readIncognitoSessionRequest,
  waitForIncognitoSnapshot,
  type IncognitoOpener,
  type IncognitoSessionRequest,
  type PlatformAdapter,
} from '@foundation/client';
import { ErrorBoundary, PlatformProvider } from '@foundation/client/react';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createGameApi } from './api.ts';
import { createIdleCivClient, type IdleCivGameClient } from './client.ts';
import { createIdleCivIncognitoRuntime } from './incognito.ts';
import { createPlatform } from './platform.ts';
import { readConfig, type RuntimeConfig } from './runtime-config.ts';
import { IdleCivProvider } from './StoreProvider.tsx';
import { App } from './ui/App.tsx';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
const incognitoRequest = readIncognitoSessionRequest(globalThis.location?.hash ?? '');

if (incognitoRequest) {
  renderLaunch(root, 'Waiting for the operator console…');
  void startIncognito(root, incognitoRequest).catch((error: unknown) => {
    announceIncognitoFailed(incognitoRequest);
    try {
      globalThis.opener = null;
    } catch {
      // The error screen remains isolated by the exact-origin protocol if opener is read-only.
    }
    renderLaunch(
      root,
      error instanceof Error ? error.message : 'The disposable snapshot could not be opened.',
      true,
    );
  });
} else {
  startNormal(root);
}

function startNormal(target: Root): void {
  const clock = createClock();
  const cfg = readConfig(createStorage());
  const platform = createPlatform(cfg, clock);
  const client = createIdleCivClient({ cfg, clock, platform });
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
  void client.boot().catch(() => undefined);
  const g = globalThis as { __idleCiv?: unknown };
  g.__idleCiv = { client, cfg, clock, api };
  renderGame(target, { client, cfg, platform });
}

async function startIncognito(target: Root, request: IncognitoSessionRequest): Promise<void> {
  const opener = globalThis.opener as IncognitoOpener | null;
  if (!opener) throw new Error('Operator console is unavailable.');
  const pending = waitForIncognitoSnapshot(request, { opener });
  announceIncognitoReady(request, opener);
  const snapshot = await pending;
  const clock = createClock();
  const runtime = await createIdleCivIncognitoRuntime({ snapshot, clock });
  try {
    await runtime.client.boot();
  } catch (error) {
    runtime.client.destroy();
    runtime.session.dispose();
    throw error;
  }
  announceIncognitoLoaded(request, opener);
  try {
    globalThis.opener = null;
  } catch {
    // Some embedded browsers expose a read-only opener; origin/source checks already fence it.
  }
  const discard = (): void => {
    runtime.client.destroy();
    runtime.session.dispose();
    globalThis.close();
  };
  const g = globalThis as { __idleCiv?: unknown };
  g.__idleCiv = {
    client: runtime.client,
    cfg: runtime.cfg,
    clock,
    incognito: runtime.session.source,
  };
  renderGame(target, {
    client: runtime.client,
    cfg: runtime.cfg,
    platform: runtime.platform,
    incognito: { ...runtime.session.source, onDiscard: discard },
  });
}

function renderGame(
  target: Root,
  o: {
    client: IdleCivGameClient;
    cfg: RuntimeConfig;
    platform: PlatformAdapter;
    incognito?: { playerKey: string; seq: number; generation: number; onDiscard(): void };
  },
): void {
  target.render(
    <StrictMode>
      <PlatformProvider platform={o.platform} client={o.client}>
        <ErrorBoundary>
          <IdleCivProvider client={o.client}>
            <App {...(o.incognito ? { incognito: o.incognito } : {})} />
          </IdleCivProvider>
        </ErrorBoundary>
      </PlatformProvider>
    </StrictMode>,
  );
}

function renderLaunch(target: Root, message: string, error = false): void {
  target.render(
    <main className={`incognito-launch${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>
      <p className="eyebrow">Disposable snapshot</p>
      <h1>{error ? 'Could not start session' : 'Preparing isolated game'}</h1>
      <p>{message}</p>
      {error ? (
        <button type="button" onClick={() => globalThis.close()}>
          Close window
        </button>
      ) : null}
    </main>,
  );
}
