import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdleCivProvider } from '../../src/StoreProvider.tsx';
import { IncognitoBanner } from '../../src/ui/App.tsx';
import { Hud } from '../../src/ui/Hud.tsx';
import { Overlays } from '../../src/ui/Overlays.tsx';
import { Workforce } from '../../src/ui/Workforce.tsx';
import { fakeClient } from './fake-client.ts';

describe('portrait UI', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
  });

  it('assigns Foragers through the dock and shows the Work Kit overlay', () => {
    host = document.createElement('div');
    document.body.append(host);
    const client = fakeClient();
    root = createRoot(host);
    act(() => {
      root!.render(
        <IdleCivProvider client={client}>
          <Hud />
          <Workforce />
          <Overlays />
        </IdleCivProvider>,
      );
    });
    expect(host.querySelector('[data-testid="laborers"]')?.textContent).toContain('5');
    const plus = host.querySelector('[data-testid="plus-forager"]') as HTMLButtonElement;
    expect(plus).toBeTruthy();
    for (let i = 0; i < 5; i++) {
      act(() => {
        plus.click();
      });
    }
    expect(host.querySelector('[data-testid="count-forager"]')?.textContent).toBe('5');
    expect(host.querySelector('[data-testid="overlay-kit"]')).toBeTruthy();
    act(() => {
      (host!.querySelector('[data-testid="equip-kit"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-testid="overlay-kit"]')).toBeNull();
    expect(host.textContent).toContain('Woven Baskets');
    expect(host.querySelector('[data-testid="fund-hut"]')).toBeTruthy();
  });

  it('keeps the disposable-session warning and discard action visible', () => {
    host = document.createElement('div');
    document.body.append(host);
    const onDiscard = vi.fn();
    root = createRoot(host);
    act(() => {
      root!.render(
        <IncognitoBanner
          details={{
            playerKey: 'player-42',
            seq: 27,
            generation: 4,
            onDiscard,
          }}
        />,
      );
    });
    const banner = host.querySelector('[data-testid="incognito-banner"]');
    expect(banner?.textContent).toContain('Disposable player snapshot');
    expect(banner?.textContent).toContain('player-42 · save #27 · generation 4');
    expect(banner?.textContent).toContain('Nothing here can be saved');
    act(() => {
      (banner!.querySelector('button') as HTMLButtonElement).click();
    });
    expect(onDiscard).toHaveBeenCalledOnce();
  });
});
