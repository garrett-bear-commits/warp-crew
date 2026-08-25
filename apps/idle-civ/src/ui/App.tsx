import { LoadingGate } from '@foundation/client/react';
import { useIdleCiv } from '../StoreProvider.tsx';
import { BootScreen } from './BootScreen.tsx';
import { CityCanvas } from './CityCanvas.tsx';
import { Hud } from './Hud.tsx';
import { Overlays } from './Overlays.tsx';
import { Workforce } from './Workforce.tsx';

export function App() {
  const booted = useIdleCiv((s) => s.booted);
  const overlay = useIdleCiv((s) => s.overlay);
  return (
    <div
      className="phone"
      data-testid="app"
      data-booted={booted ? '1' : '0'}
      data-overlay={overlay}
    >
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
