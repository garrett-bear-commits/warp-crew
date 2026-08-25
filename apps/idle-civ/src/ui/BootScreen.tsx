import { useIdleCiv } from '../StoreProvider.tsx';

export function BootScreen() {
  const phase = useIdleCiv((s) => s.bootPhase);
  const err = useIdleCiv((s) => s.bootError);
  const enter = useIdleCiv((s) => s.enterCamp);
  const retry = useIdleCiv((s) => s.retryBoot);
  if (phase === 'cloudUnreachable') {
    return (
      <section className="sheet" data-testid="boot-unreachable">
        <h2>Camp site</h2>
        <p>No cloud save. Play on this device.</p>
        <button data-testid="boot-start-new" onClick={enter}>
          Enter camp
        </button>
        <button data-testid="boot-retry" onClick={retry}>
          Retry
        </button>
      </section>
    );
  }
  if (phase === 'blocked' || err) {
    return (
      <section className="sheet" data-testid="boot-blocked">
        <h2>Cannot open the camp</h2>
        {err ? <p>{err}</p> : null}
        <button onClick={() => location.reload()}>Reload</button>
      </section>
    );
  }
  return (
    <section className="sheet" data-testid="boot-loading">
      <p>{phase === 'checkingCloud' ? 'Checking the settlement…' : 'Walking into camp…'}</p>
    </section>
  );
}
