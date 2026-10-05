// Restore panel (§5.2 Restore, ADR-005 break-glass): history from GET /v1/saves/history; per row
// "restore forward-only" (deeper only, write local → confirm → reload) and "restore to point"
// (lineage.restoreToSeq → generation bump); "Recover from platform copy" reads the KV mirror ONCE
// (human-initiated) and goes through the forward-only restore.
import type { SnapshotMeta } from '@foundation/contracts';
import type { RestoreOutcome } from '@foundation/client';
import { useCallback, useState } from 'react';
import { useGame } from '../game.tsx';
import { useFetched } from './useFetched.ts';

export function RestorePanel() {
  const { api, client, serverRev, toast } = useGame();
  const [outcome, setOutcome] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const fetchHistory = useCallback(async () => {
    void serverRev;
    if (!open) return null;
    const r = await api.saves.history(50);
    return r.ok
      ? { items: r.body.items, generation: r.body.generation, error: null }
      : ({
          items: null,
          generation: null,
          error: r.status === 0 ? 'unreachable' : `http ${r.status}`,
        } as {
          items: SnapshotMeta[] | null;
          generation: number | null;
          error: string | null;
        });
  }, [api, open, serverRev]);
  const history = useFetched(fetchHistory);
  const items = history.data?.items ?? null;
  const generation = history.data?.generation ?? null;
  const error = history.data?.error ?? null;
  const load = async (): Promise<void> => history.reload();

  const run = async (label: string, fn: () => Promise<RestoreOutcome>): Promise<void> => {
    setBusy(true);
    try {
      const r = await fn();
      const text = r.ok
        ? `${label}: ok (${r.kind}, generation ${r.generation}, progress ${r.progress})`
        : `${label}: ${r.reason}${r.message ? ` (${r.message})` : ''}`;
      setOutcome(text);
      toast(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" data-testid="restore-panel">
      <h2>Restore</h2>
      <div className="row">
        <button
          data-testid="restore-open"
          onClick={() => {
            setOpen(true);
            void load();
          }}
        >
          {open ? 'Refresh history' : 'Open restore panel'}
        </button>
        <button
          data-testid="restore-break-glass"
          disabled={busy}
          onClick={() =>
            void run('Recover from platform copy', () => client.restore.breakGlassFromKv())
          }
        >
          Recover from platform copy
        </button>
      </div>
      {outcome ? (
        <p className="muted" data-testid="restore-outcome">
          {outcome}
        </p>
      ) : null}
      {error ? <p className="muted">History unavailable ({error})</p> : null}
      {open && items ? (
        <table className="history" data-testid="restore-history" data-generation={generation ?? ''}>
          <thead>
            <tr>
              <th>seq</th>
              <th>progress</th>
              <th>disposition</th>
              <th>reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.seq} data-testid="history-row" data-seq={s.seq} data-progress={s.progress}>
                <td>{s.seq}</td>
                <td>{s.progress}</td>
                <td>
                  {s.disposition}
                  {s.flags.length ? ` [${s.flags.join(',')}]` : ''}
                </td>
                <td>{s.reason}</td>
                <td className="row">
                  <button
                    data-testid={`restore-forward-${s.seq}`}
                    disabled={busy || !s.hasBlob}
                    onClick={() =>
                      void run(`Restore forward-only seq ${s.seq}`, () =>
                        client.restore.fromHistory(s.seq),
                      )
                    }
                  >
                    Restore forward-only
                  </button>
                  <button
                    data-testid={`restore-to-point-${s.seq}`}
                    disabled={busy || !s.hasBlob}
                    onClick={() =>
                      void run(`Restore to point seq ${s.seq}`, () =>
                        client.restore.restoreToSeq(s.seq),
                      )
                    }
                  >
                    Restore to point
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
