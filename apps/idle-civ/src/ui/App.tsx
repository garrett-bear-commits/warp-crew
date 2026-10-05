import { LoadingGate } from '@foundation/client/react';
import { useIdleCiv } from '../StoreProvider.tsx';
import { BootScreen } from './BootScreen.tsx';
import { CityCanvas } from './CityCanvas.tsx';
import { Hud } from './Hud.tsx';
import { Overlays } from './Overlays.tsx';
import { Workforce } from './Workforce.tsx';

export interface IncognitoBannerDetails {
  playerKey: string;
  seq: number;
  generation: number;
  onDiscard(): void;
}

export function App(props: { incognito?: IncognitoBannerDetails }) {
  const booted = useIdleCiv((s) => s.booted);
  const overlay = useIdleCiv((s) => s.overlay);
  return (
    <div
      className="phone"
      data-testid="app"
      data-booted={booted ? '1' : '0'}
      data-overlay={overlay}
    >
      {props.incognito ? <IncognitoBanner details={props.incognito} /> : null}
      <LoadingGate ready={booted} fallback={<BootScreen />}>
        <Hud />
        <CityCanvas />
        <Workforce />
        <Overlays />
        <Toasts />
      </LoadingGate>
    </div>
  );
}

export function IncognitoBanner(props: { details: IncognitoBannerDetails }) {
  const { details } = props;
  return (
    <aside className="incognito-banner" data-testid="incognito-banner" role="status">
      <div>
        <strong>Disposable player snapshot</strong>
        <span>
          Player {details.playerKey} · save #{details.seq} · generation {details.generation}
        </span>
        <small>Nothing here can be saved. Closing this window discards every change.</small>
      </div>
      <button type="button" onClick={details.onDiscard}>
        Discard &amp; close
      </button>
    </aside>
  );
}

function Toasts() {
  const toasts = useIdleCiv((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" data-testid="toasts">
      {toasts.slice(-3).map((t) => (
        <div key={t.id} className="toast" data-testid="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}
