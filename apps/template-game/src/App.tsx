// App shell: boot gate (prompts + cloud-unreachable + blocked), status bar (SyncPill, save now,
// pending review, leader/"Play here"), UpdateBanner (426), MaintenanceScreen, then every panel
// that exercises a core path. Plain CSS, stable data-testids for the acceptance suite.
import type { Clock } from '@foundation/client';
import { LoadingGate, MaintenanceScreen, UpdateBanner } from '@foundation/client/react';
import { useEffect, useState } from 'react';
import type { GameApi } from './api.ts';
import type { GameConfig } from './config.ts';
import { GameProvider, useGame, type TemplateClient } from './game.tsx';
import { BootGate } from './ui/BootGate.tsx';
import { Diagnostics } from './ui/Diagnostics.tsx';
import { InboxPanel } from './ui/InboxPanel.tsx';
import { LeaderboardPanel } from './ui/LeaderboardPanel.tsx';
import { LineagePanel } from './ui/LineagePanel.tsx';
import { PlayArea } from './ui/PlayArea.tsx';
import { RestorePanel } from './ui/RestorePanel.tsx';
import { RewardsPanel } from './ui/RewardsPanel.tsx';
import { SaleBanner } from './ui/SaleBanner.tsx';
import { Shop } from './ui/Shop.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { Toasts } from './ui/Toasts.tsx';
import { useBootState } from './ui/hooks.ts';

export function App(props: {
  cfg: GameConfig;
  client: TemplateClient;
  api: GameApi;
  clock: Clock;
  bootPromise: Promise<string | null>;
}) {
  const { client } = props;
  const boot = useBootState(client);
  const [bootDone, setBootDone] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void props.bootPromise.then((err) => {
      if (!alive) return;
      if (err === null) setBootDone(true);
      else setBootError(err);
    });
    return () => {
      alive = false;
    };
  }, [props.bootPromise]);
  const booted = bootDone && client.booted;
  return (
    <GameProvider
      cfg={props.cfg}
      client={client}
      api={props.api}
      clock={props.clock}
      booted={booted}
    >
      <Shell booted={booted} bootError={bootError} blocked={boot.blockedReason} />
    </GameProvider>
  );
}

function Shell(props: {
  booted: boolean;
  bootError: string | null;
  blocked: 'update_required' | 'erased' | 'no_identity' | null;
}) {
  const g = useGame();
  const updateRequired = g.updateRequired || props.blocked === 'update_required';
  const reload = (): void => location.reload();
  return (
    <div className="app" data-testid="app" data-booted={props.booted ? '1' : '0'}>
      <UpdateBanner visible={updateRequired} forced onReload={reload} />
      {g.live?.maintenance ? <MaintenanceScreen retry={() => void g.refreshConfig()} /> : null}
      <header className="topbar">
        <h1>Template idle</h1>
        <StatusBar booted={props.booted} />
      </header>
      <SaleBanner />
      <LoadingGate
        ready={props.booted}
        fallback={<BootGate booted={props.booted} bootError={props.bootError} />}
      >
        <main className="grid">
          <PlayArea />
          <RewardsPanel />
          <Shop />
          <InboxPanel />
          <LeaderboardPanel />
          <LineagePanel />
          <RestorePanel />
          <Diagnostics />
        </main>
      </LoadingGate>
      <Toasts />
    </div>
  );
}
