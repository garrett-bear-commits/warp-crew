import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  defineModals,
  ErrorBoundary,
  Inbox,
  LoadingGate,
  MaintenanceScreen,
  PlatformProvider,
  PrivacyPanel,
  RegistrationGate,
  SyncPill,
  UpdateBanner,
  useEffects,
  useGameState,
  useSaveSync,
  useVisibility,
  Z_TABLE,
} from '../../src/react/index.tsx';
import { makeWorld, type Client } from '../helpers/world.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactNode): { root: Root; el: HTMLElement; unmount(): void } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return {
    root,
    el,
    unmount() {
      act(() => root.unmount());
      el.remove();
    },
  };
}

describe('react shells (§5.3)', () => {
  it('LoadingGate calls markLoaded exactly once when ready flips true', () => {
    const w = makeWorld();
    const { platform } = w.newClient();
    const view = (ready: boolean) => (
      <PlatformProvider platform={platform}>
        <LoadingGate ready={ready} fallback={<span className="fb">loading</span>}>
          <span className="content">game</span>
        </LoadingGate>
      </PlatformProvider>
    );
    const m = mount(view(false));
    expect(m.el.querySelector('.fb')).not.toBeNull();
    expect(platform.controls.loadedCount()).toBe(0);
    act(() => m.root.render(view(true)));
    expect(m.el.querySelector('.content')?.textContent).toBe('game');
    act(() => m.root.render(view(true)));
    act(() => m.root.render(view(false)));
    act(() => m.root.render(view(true)));
    expect(platform.controls.loadedCount()).toBe(1);
    m.unmount();
  });

  it('RegistrationGate hides children for guests', () => {
    const m = mount(
      <RegistrationGate registered={false} prompt={<i>sign in</i>}>
        <b>codes</b>
      </RegistrationGate>,
    );
    expect(m.el.querySelector('b')).toBeNull();
    expect(m.el.querySelector('i')?.textContent).toBe('sign in');
    act(() =>
      m.root.render(
        <RegistrationGate registered={true}>
          <b>codes</b>
        </RegistrationGate>,
      ),
    );
    expect(m.el.querySelector('b')?.textContent).toBe('codes');
    m.unmount();
  });

  it('RegistrationGate exposes an awaitable platform login action without blocking dismissal', async () => {
    const login = vi.fn(async () => {});
    const m = mount(
      <RegistrationGate registered={false} onLogin={login} loginLabel="Keep my progress">
        <b>registered content</b>
      </RegistrationGate>,
    );

    const button = m.el.querySelector('.foundation-registration-login') as HTMLButtonElement;
    expect(button.textContent).toBe('Keep my progress');
    await act(async () => button.click());
    expect(login).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
    expect(m.el.querySelector('b')).toBeNull();
    m.unmount();
  });

  it('RegistrationGate login does not submit an enclosing form', async () => {
    const login = vi.fn(async () => {});
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const m = mount(
      <form onSubmit={submit}>
        <RegistrationGate registered={false} onLogin={login}>
          <b>registered content</b>
        </RegistrationGate>
      </form>,
    );

    const button = m.el.querySelector('.foundation-registration-login') as HTMLButtonElement;
    await act(async () => button.click());

    expect(login).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    m.unmount();
  });

  it('ErrorBoundary reports a game_error integrity event with breadcrumbs through the client and can reset', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    const errors: unknown[] = [];
    let explode = true;
    function Boom() {
      if (explode) throw new Error('kaboom');
      return <span className="ok">ok</span>;
    }
    const origError = console.error;
    console.error = () => {};
    const m = mount(
      <PlatformProvider platform={platform} client={client}>
        <ErrorBoundary
          onError={(e) => errors.push(e)}
          fallback={(_e, reset) => (
            <button className="reset" onClick={reset}>
              reset
            </button>
          )}
        >
          <Boom />
        </ErrorBoundary>
      </PlatformProvider>,
    );
    console.error = origError;
    expect(errors.length).toBe(1);
    const reported = platform.controls.reported();
    expect(reported[0]?.kind).toBe('game_error');
    expect(reported[0]?.message).toContain('kaboom');
    expect(reported[0]?.breadcrumbs?.some((b) => b.name === 'inc')).toBe(true);
    expect(reported[0]?.detail).toMatchObject({ boundary: true });
    // Where in the tree it broke, trimmed to the integrity event's bound.
    expect(reported[0]?.detail?.componentStack).toContain('Boom');
    explode = false;
    act(() => (m.el.querySelector('.reset') as HTMLButtonElement).click());
    expect(m.el.querySelector('.ok')).not.toBeNull();
    m.unmount();
  });

  it('useGameState re-renders on dispatch; useEffects drains by kind; useVisibility follows the platform', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    let renders = 0;
    function View() {
      renders++;
      const count = useGameState(client, (s) => s.count);
      const dings = useEffects(client, ['ding']);
      const visible = useVisibility();
      return (
        <div>
          <span className="count">{count}</span>
          <span className="dings">{dings.length}</span>
          <span className="vis">{visible ? 'v' : 'h'}</span>
        </div>
      );
    }
    const m = mount(
      <PlatformProvider platform={platform} client={client}>
        <View />
      </PlatformProvider>,
    );
    expect(m.el.querySelector('.count')?.textContent).toBe('0');
    act(() => client.dispatch({ type: 'inc', n: 2 }));
    expect(m.el.querySelector('.count')?.textContent).toBe('2');
    expect(m.el.querySelector('.dings')?.textContent).toBe('1');
    const before = renders;
    act(() => client.dispatch({ type: 'noop' }));
    expect(m.el.querySelector('.count')?.textContent).toBe('2');
    expect(renders).toBe(before);
    act(() => platform.controls.setVisible(false));
    expect(m.el.querySelector('.vis')?.textContent).toBe('h');
    m.unmount();
  });

  it('SyncPill + useSaveSync show the player-visible status and update on verdicts', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    let view: ReturnType<typeof useSaveSync> | null = null;
    function Probe() {
      view = useSaveSync(client as Client, 1_000);
      return null;
    }
    const m = mount(
      <PlatformProvider platform={platform} client={client}>
        <SyncPill client={client} />
        <Probe />
      </PlatformProvider>,
    );
    expect(m.el.querySelector('.foundation-sync-pill')?.textContent).toBe('Saved on this device');
    client.dispatch({ type: 'inc', n: 1 });
    await act(async () => {
      await client.sync.push('important');
    });
    expect(m.el.querySelector('.foundation-sync-pill')?.textContent).toMatch(/^Saved to cloud/);
    expect(m.el.querySelector('.foundation-sync-saved_to_cloud')).not.toBeNull();
    expect((view as unknown as ReturnType<typeof useSaveSync>).lastVerdict).toBe('synced');
    expect((view as unknown as ReturnType<typeof useSaveSync>).pendingReview).toBeNull();
    m.unmount();
  });

  it('useSaveSync.pendingReview: an empty-cache device against an empty-with-pendingQuarantine head learns a newer save awaits review (audit F8)', async () => {
    const w = makeWorld({ localStorage: null });
    const pq = { seq: 4, progress: 12, flags: ['progress_jump'], receivedAt: 1 };
    w.ff.on(
      'GET',
      '/v1/saves/current',
      () =>
        new Response(
          JSON.stringify({
            empty: true,
            generation: 0,
            pendingQuarantine: pq,
            requestId: 'r',
            serverNow: w.clock.now(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const { client, platform } = w.newClient();
    await client.boot();
    let view: ReturnType<typeof useSaveSync> | null = null;
    function Probe() {
      view = useSaveSync(client as Client, 1_000);
      return null;
    }
    const m = mount(
      <PlatformProvider platform={platform} client={client}>
        <Probe />
      </PlatformProvider>,
    );
    expect((view as unknown as ReturnType<typeof useSaveSync>).pendingReview).toEqual(pq);
    m.unmount();
  });

  it('defineModals stacks by the ONE Z table; UpdateBanner/MaintenanceScreen/PrivacyPanel/Inbox render with className hooks', async () => {
    const modals = defineModals({
      offer: {
        id: 'offer',
        render: (p: { sku: string }, ctl) => (
          <button className="offer" onClick={ctl.close}>
            {p.sku}
          </button>
        ),
      },
      toast: { id: 'toast', layer: 'toast', render: () => <span className="toast">hi</span> },
    });
    let diag = false;
    const letters = [
      {
        id: 1,
        kind: 'support' as const,
        title: 'Hello',
        body: 'Sorry about that',
        grantKey: 'g1',
        createdAt: 0,
      },
      {
        id: 2,
        kind: 'announcement' as const,
        title: 'Sale',
        body: 'Half off',
        createdAt: 0,
        readAt: 1,
      },
    ];
    const read: number[] = [];
    const claimed: number[] = [];
    const m = mount(
      <div>
        <modals.ModalHost />
        <UpdateBanner visible forced onReload={() => {}} />
        <MaintenanceScreen message="brb" />
        <PrivacyPanel diagnostics={diag} onChange={(v) => (diag = v)} />
        <Inbox
          load={async () => ({ letters, unread: 1 })}
          onRead={(l) => read.push(l.id)}
          onClaim={(l) => claimed.push(l.id)}
        />
      </div>,
    );
    act(() => modals.open('offer', { sku: 'pack' }));
    act(() => modals.open('toast', {}));
    const hosts = Array.from(m.el.querySelectorAll('.foundation-modal')) as HTMLElement[];
    expect(hosts.length).toBe(2);
    expect(hosts[0]!.style.zIndex).toBe(String(Z_TABLE.modal));
    expect(hosts[1]!.style.zIndex).toBe(String(Z_TABLE.toast));
    act(() => (m.el.querySelector('.offer') as HTMLButtonElement).click());
    expect(m.el.querySelectorAll('.foundation-modal').length).toBe(1);
    act(() => modals.closeAll());
    expect(m.el.querySelectorAll('.foundation-modal').length).toBe(0);
    expect(m.el.querySelector('.foundation-update-reload')?.textContent).toBe('Update now');
    expect(m.el.querySelector('.foundation-maintenance')?.textContent).toContain('brb');
    const cb = m.el.querySelector('.foundation-privacy input') as HTMLInputElement;
    act(() => {
      cb.click();
    });
    expect(diag).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(m.el.querySelectorAll('.foundation-letter').length).toBe(2);
    act(() => (m.el.querySelector('.foundation-letter-read') as HTMLButtonElement).click());
    act(() => (m.el.querySelector('.foundation-letter-claim') as HTMLButtonElement).click());
    expect(read).toEqual([1]);
    expect(claimed).toEqual([1]);
    expect(m.el.querySelector('.foundation-letter.is-read')).not.toBeNull();
    m.unmount();
  });
});
