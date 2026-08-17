// Status bar: SyncPill (§5.2 player-visible sync status), Save now, "pending review" from
// pendingQuarantine (a deeper quarantined save awaits review on the server), leader/follower
// with "Play here" (§5.2 multi-tab).
import { SyncPill } from '@foundation/client/react';
import { useGame } from '../game.tsx';
import { useBootState, useLeaderRole } from './hooks.ts';

export function StatusBar(props: { booted: boolean }) {
  const { client } = useGame();
  const boot = useBootState(client);
  const role = useLeaderRole(client);
  const pq = boot.pendingQuarantine;
  return (
    <div className="statusbar">
      <span data-testid="sync-pill">
        <SyncPill client={client} refreshMs={1000} />
      </span>
      <button
        data-testid="save-now"
        disabled={!props.booted || role !== 'leader'}
        onClick={() => client.saveNow('important')}
      >
        Save now
      </button>
      {pq ? (
        <span className="pill warn" data-testid="pending-review" data-seq={pq.seq}>
          Newer save pending review (seq {pq.seq}, progress {pq.progress}, {pq.flags.join(',')})
        </span>
      ) : null}
      <span className="pill" data-testid="leader-role" data-role={role}>
        {role === 'leader' ? 'Playing here' : role === 'follower' ? 'Open in another tab' : '…'}
      </span>
      {role === 'follower' ? (
        <button data-testid="play-here" onClick={() => void client.playHere()}>
          Play here
        </button>
      ) : null}
    </div>
  );
}
