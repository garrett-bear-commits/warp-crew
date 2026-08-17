// Leaderboard (§7): start run (server stamps started_at, issues a seed) → play N clicks → submit
// {score, summary:{clicks}} (summary-bounded, level 2) → outcome/visibility/rank; public top list
// (no ids); /me; moderated display names; placements claim.
import type { BoardMeResponse, BoardTopResponse } from '@foundation/contracts';
import { mintId } from '@foundation/client';
import { useGameState } from '@foundation/client/react';
import { useCallback, useState } from 'react';
import { BOARD_KEY } from '../config.ts';
import { useGame } from '../game.tsx';
import { useFetched } from './useFetched.ts';

export function LeaderboardPanel() {
  const g = useGame();
  const { api, client, serverRev } = g;
  const clicks = useGameState(client, (s) => s.clicks);
  const [run, setRun] = useState<{ runId: string; clicksAtStart: number; seed: string } | null>(
    null,
  );
  const [outcome, setOutcome] = useState('');
  const [name, setName] = useState('');
  const [nameOutcome, setNameOutcome] = useState('');
  const fetchBoard = useCallback(async () => {
    void serverRev;
    const [t, m] = await Promise.all([api.boards.top(BOARD_KEY), api.boards.me(BOARD_KEY)]);
    return {
      top: t.ok ? t.body : null,
      me: m.ok ? m.body : null,
    } as { top: BoardTopResponse | null; me: BoardMeResponse | null };
  }, [api, serverRev]);
  const board = useFetched(fetchBoard);
  const top = board.data?.top ?? null;
  const me = board.data?.me ?? null;
  const load = async (): Promise<void> => board.reload();

  const start = async (): Promise<void> => {
    const runId = mintId();
    const r = await api.boards.start(BOARD_KEY, { commandId: mintId(), runId });
    if (!r.ok) {
      setOutcome(`start failed (${r.error?.error ?? `http ${r.status}`})`);
      return;
    }
    setRun({ runId, clicksAtStart: clicks, seed: r.body.seed });
    setOutcome(`run started (season ${r.body.seasonKey}, rules ${r.body.rulesVersion})`);
  };
  const submit = async (): Promise<void> => {
    if (!run) return;
    const score = clicks - run.clicksAtStart;
    const r = await api.boards.submit(BOARD_KEY, {
      commandId: mintId(),
      runId: run.runId,
      score,
      summary: { clicks: score },
    });
    if (!r.ok) {
      setOutcome(`submit failed (${r.error?.error ?? `http ${r.status}`})`);
      return;
    }
    const b = r.body;
    setOutcome(
      `${b.outcome}${b.visibility ? ` · ${b.visibility}` : ''}${b.rank !== undefined ? ` · rank ${b.rank}` : ''}${b.verificationLevel !== undefined ? ` · L${b.verificationLevel}` : ''} · score ${score}`,
    );
    setRun(null);
    await load();
  };
  const setDisplayName = async (): Promise<void> => {
    const r = await api.boards.setName({ commandId: mintId(), displayName: name.trim() });
    if (!r.ok) {
      setNameOutcome(`failed (${r.error?.error ?? `http ${r.status}`})`);
      return;
    }
    setNameOutcome(`${r.body.displayName}${r.body.moderated ? ' (moderated)' : ''}`);
    client.dispatch({ type: 'rename', name: r.body.displayName });
    await load();
  };
  const claimPlacement = async (receiptId: string): Promise<void> => {
    const r = await api.boards.claimPlacement({ commandId: mintId(), receiptId });
    if (r.ok && r.body.outcome === 'claimed' && r.body.grantKey)
      await g.claimGrant(r.body.grantKey);
    await load();
  };

  return (
    <section className="panel" data-testid="leaderboard-panel">
      <h2>Leaderboard: {BOARD_KEY}</h2>
      <p className="muted" data-testid="board-status">
        season {top?.seasonKey ?? '—'} · {top?.status ?? 'unknown'}
      </p>
      <div className="row">
        <button data-testid="run-start" disabled={run !== null} onClick={() => void start()}>
          Start run
        </button>
        <button data-testid="run-submit" disabled={run === null} onClick={() => void submit()}>
          Submit run{run ? ` (${clicks - run.clicksAtStart} clicks)` : ''}
        </button>
      </div>
      <p className="muted" data-testid="run-outcome">
        {outcome}
      </p>
      <ol className="list" data-testid="board-top">
        {top?.entries.map((e) => (
          <li key={`${e.rank}-${e.displayName}`} data-testid="board-entry">
            #{e.rank} {e.displayName} — {e.score}
          </li>
        ))}
      </ol>
      <p className="muted" data-testid="board-me">
        {me?.best
          ? `best ${me.best.score} (${me.best.visibility}${me.best.rank !== undefined ? `, rank ${me.best.rank}` : ''})`
          : 'no submission yet'}{' '}
        · name {me?.displayName ?? '—'}
      </p>
      {me?.placements.length ? (
        <ul className="list" data-testid="placements">
          {me.placements.map((p) => (
            <li key={p.receiptId}>
              {p.seasonKey} rank {p.rank} {p.state}{' '}
              {p.state === 'confirmed' && p.grantKey ? (
                <button onClick={() => void claimPlacement(p.receiptId)}>Claim placement</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row">
        <input
          data-testid="name-input"
          value={name}
          maxLength={24}
          placeholder="Display name"
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <button
          data-testid="name-set"
          disabled={!name.trim()}
          onClick={() => void setDisplayName()}
        >
          Set name
        </button>
        <span className="muted" data-testid="name-outcome">
          {nameOutcome}
        </span>
      </div>
    </section>
  );
}
