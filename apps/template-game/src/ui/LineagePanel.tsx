// Restart (§1 "Generations are the only way backwards", ADR-007 entitlement only on restart):
// POST /v1/lineage/restart {commandId, restartId, expectedGeneration} → receipt {generation,
// entitlement} | 409 stale_generation; the client then starts fresh in the new generation (the
// old generation's state can never come back: its writes are refused stale_generation).
import { mintId } from '@foundation/client';
import { useState } from 'react';
import { useGame } from '../game.tsx';
import { useEnvelope } from './hooks.ts';

export function LineagePanel() {
  const g = useGame();
  const { api, client } = g;
  const env = useEnvelope(client, client.booted);
  const [outcome, setOutcome] = useState('');
  const [entitlement, setEntitlement] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const restart = async (): Promise<void> => {
    setBusy(true);
    try {
      // push the final state of this generation first: it stays in history as evidence
      await client.sync.push('important');
      const expected = client.sync.envelope().generation;
      const r = await api.lineage.restart({
        commandId: mintId(),
        restartId: mintId(),
        expectedGeneration: expected,
      });
      if (!r.ok) {
        setOutcome(
          r.status === 409
            ? 'stale generation — reload to pick up the newer generation'
            : `restart failed (${r.error?.error ?? `http ${r.status}`})`,
        );
        if (r.status === 409) await client.bootMachine.recheck();
        return;
      }
      client.sync.startNew(r.body.generation, 'start_new');
      setEntitlement(r.body.entitlement ?? 0);
      setOutcome(
        `restarted: generation ${r.body.generation}, entitlement ${r.body.entitlement ?? 0} gems`,
      );
      if ((r.body.entitlement ?? 0) > 0)
        client.dispatch({
          type: 'grant',
          gems: r.body.entitlement ?? 0,
          ref: `restart:${r.body.generation}`,
        });
      client.saveNow('important');
      g.bumpServer();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" data-testid="lineage-panel">
      <h2>Restart</h2>
      <p className="muted">
        Generation <b data-testid="lineage-generation">{env?.generation ?? '—'}</b>. Restarting
        opens a new generation; paid gems (entitlement) carry over.
      </p>
      <button data-testid="restart" disabled={busy} onClick={() => void restart()}>
        Restart game
      </button>
      <p className="muted" data-testid="restart-outcome">
        {outcome}
      </p>
      {entitlement !== null ? (
        <p className="muted">
          Entitlement carried: <b data-testid="restart-entitlement">{entitlement}</b>
        </p>
      ) : null}
    </section>
  );
}
