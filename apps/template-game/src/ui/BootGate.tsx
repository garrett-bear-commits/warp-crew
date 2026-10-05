// Boot UI (§5.2 State lifecycle): checkingCloud spinner; "keep local / adopt cloud" when the local
// copy is dirty and the cloud is deeper; "cloud unreachable — retry / start new" when the cache is
// empty for a returning identity; blocked (update required / erased / no identity).
import { useGame } from '../game.tsx';
import { useBootState } from './hooks.ts';

export function BootGate(props: { booted: boolean; bootError: string | null }) {
  const { client } = useGame();
  const boot = useBootState(client);
  const m = client.bootMachine;
  if (boot.phase === 'prompt' && boot.prompt) {
    const p = boot.prompt;
    return (
      <section className="boot" data-testid="boot-prompt" data-phase={boot.phase}>
        <h2>Which save do you want to keep?</h2>
        <p>
          On this device: progress {p.local.progress} (generation {p.local.generation}). In the
          cloud: progress {p.remote.progress} (seq {p.remote.seq}, generation {p.remote.generation}
          ).
        </p>
        <div className="row">
          <button data-testid="boot-keep-local" onClick={() => m.resolvePrompt('keep_local')}>
            Keep local
          </button>
          <button data-testid="boot-adopt-cloud" onClick={() => m.resolvePrompt('adopt_remote')}>
            Adopt cloud
          </button>
        </div>
      </section>
    );
  }
  if (boot.phase === 'cloudUnreachable') {
    return (
      <section className="boot" data-testid="boot-unreachable" data-phase={boot.phase}>
        <h2>Cloud unreachable</h2>
        <p>Your saved game could not be fetched. Retry, or start a new game on this device.</p>
        <div className="row">
          <button data-testid="boot-retry" onClick={() => m.retry()}>
            Retry
          </button>
          <button data-testid="boot-start-new" onClick={() => m.startNew()}>
            Start new
          </button>
        </div>
      </section>
    );
  }
  if (boot.phase === 'blocked' || props.bootError) {
    const reason = boot.blockedReason ?? 'error';
    return (
      <section
        className="boot"
        data-testid="boot-blocked"
        data-phase="blocked"
        data-reason={reason}
      >
        <h2>
          {reason === 'update_required'
            ? 'Update required'
            : reason === 'erased'
              ? 'This account was erased'
              : reason === 'no_identity'
                ? 'No identity'
                : 'Boot failed'}
        </h2>
        {props.bootError ? <p className="muted">{props.bootError}</p> : null}
        <button data-testid="boot-reload" onClick={() => location.reload()}>
          Reload
        </button>
      </section>
    );
  }
  return (
    <section className="boot" data-testid="boot-loading" data-phase={boot.phase}>
      <p>
        {boot.phase === 'checkingCloud'
          ? 'Checking cloud…'
          : boot.phase === 'reconciled'
            ? 'Starting…'
            : 'Loading…'}
      </p>
      {boot.preview ? (
        <p className="muted" data-testid="boot-preview">
          Last seen: counter {boot.preview.counter}, gold {Math.floor(boot.preview.gold)}
        </p>
      ) : null}
    </section>
  );
}
