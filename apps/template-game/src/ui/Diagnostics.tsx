// Sync diagnostics: generation, acked seq, client seq, storage mode (blocked ≠ empty), leader
// role, last verdict, boot decision, live-ops flags (the "flag at 50 %" and "idle.rate" publishes
// are visible here), config refresh, cloud head re-check, PrivacyPanel (diagnostics toggle only).
import { PrivacyPanel } from '@foundation/client/react';
import { useState } from 'react';
import { useGame } from '../game.tsx';
import { useBootState, useEnvelope, useLeaderRole } from './hooks.ts';

export function Diagnostics() {
  const g = useGame();
  const { client, live } = g;
  const boot = useBootState(client);
  const role = useLeaderRole(client);
  const env = useEnvelope(client, client.booted);
  const [busy, setBusy] = useState(false);
  const recheck = async (): Promise<void> => {
    setBusy(true);
    try {
      await client.bootMachine.recheck();
      await g.refreshConfig();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" data-testid="diagnostics">
      <h2>Diagnostics</h2>
      <dl className="kv">
        <dt>Player</dt>
        <dd data-testid="diag-player">{client.player?.playerId ?? '—'}</dd>
        <dt>Platform</dt>
        <dd data-testid="diag-platform">{client.platform.name}</dd>
        <dt>Build</dt>
        <dd data-testid="diag-build">{g.cfg.buildVersion}</dd>
        <dt>Generation</dt>
        <dd data-testid="diag-generation">{env?.generation ?? '—'}</dd>
        <dt>Acked seq</dt>
        <dd data-testid="diag-seq">{env?.lastAckedSeq ?? '—'}</dd>
        <dt>Client seq</dt>
        <dd data-testid="diag-client-seq">{env?.clientSeq ?? '—'}</dd>
        <dt>Progress</dt>
        <dd data-testid="diag-progress">{env?.progress ?? '—'}</dd>
        <dt>Dirty</dt>
        <dd data-testid="diag-dirty">{env ? String(env.dirty) : '—'}</dd>
        <dt>Storage mode</dt>
        <dd data-testid="diag-storage-mode">{client.storage.mode}</dd>
        <dt>Leader</dt>
        <dd data-testid="diag-leader">{role}</dd>
        <dt>Last verdict</dt>
        <dd data-testid="diag-verdict">{env?.lastVerdict ?? '—'}</dd>
        <dt>Boot</dt>
        <dd data-testid="diag-boot">
          {boot.phase}
          {boot.decision ? ` · ${boot.decision.action} (${boot.decision.reason})` : ''}
        </dd>
        <dt>Flags</dt>
        <dd data-testid="diag-flags">{live?.flags ? JSON.stringify(live.flags) : '—'}</dd>
        <dt>Kill switches</dt>
        <dd data-testid="diag-kill-switches">{live ? JSON.stringify(live.killSwitches) : '—'}</dd>
        <dt>Min build</dt>
        <dd data-testid="diag-min-build">{live?.minBuildVersion ?? '—'}</dd>
        <dt>Config error</dt>
        <dd data-testid="diag-config-error">{g.liveError ?? '—'}</dd>
        <dt>Notes</dt>
        <dd data-testid="diag-notes">{boot.notes.join(' | ') || '—'}</dd>
      </dl>
      <div className="row">
        <button data-testid="config-refresh" onClick={() => void g.refreshConfig()}>
          Refresh config
        </button>
        <button data-testid="cloud-recheck" disabled={busy} onClick={() => void recheck()}>
          Check cloud
        </button>
      </div>
      <PrivacyPanel diagnostics={g.diagnostics} onChange={g.setDiagnostics} />
    </section>
  );
}
