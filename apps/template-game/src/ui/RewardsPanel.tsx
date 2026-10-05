// Rewards: daily reward (POST /v1/daily/claim → claim the minted grant → dispatch), achievements
// (GET /v1/achievements/me + POST evaluate over ledgers + latest summary; unlocked → claim →
// dispatch → toast), pending grants (GET /v1/grants/pending). Grants are the one reward primitive.
import type { AchievementProgress, Grant } from '@foundation/contracts';
import { mintId } from '@foundation/client';
import { useCallback, useState } from 'react';
import { useGame } from '../game.tsx';
import { useFetched } from './useFetched.ts';

export function RewardsPanel() {
  const g = useGame();
  const { api, serverRev } = g;
  const [daily, setDaily] = useState<string>('');
  const [evalItems, setEvalItems] = useState<AchievementProgress[] | null>(null);
  const [evalOutcome, setEvalOutcome] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const fetchRewards = useCallback(async () => {
    void serverRev;
    const [me, pend] = await Promise.all([api.achievements.me(), api.grants.pending()]);
    return {
      items: me.ok ? me.body.items : [],
      pending: pend.ok ? pend.body.grants : [],
    } as { items: AchievementProgress[]; pending: Grant[] };
  }, [api, serverRev]);
  const rewards = useFetched(fetchRewards);
  const items = evalItems ?? rewards.data?.items ?? [];
  const pending = rewards.data?.pending ?? [];

  const claimDaily = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.achievements.claimDaily({ commandId: mintId() });
      if (!r.ok) {
        setDaily(`failed (${r.error?.error ?? `http ${r.status}`})`);
        return;
      }
      const b = r.body;
      if (b.outcome === 'claimed' && b.grantKey) {
        const c = await g.claimGrant(b.grantKey);
        setDaily(`claimed day ${b.day}${c?.grant ? `: ${describe(c.grant)}` : ''}`);
      } else {
        setDaily(`${b.outcome} (day ${b.day})`);
      }
    } finally {
      setBusy(false);
    }
  };

  const evaluate = async (): Promise<void> => {
    setBusy(true);
    try {
      // the evaluator reads the anchored save: push first so the claim it reads is current
      await g.client.sync.push('important');
      const r = await api.achievements.evaluate({ commandId: mintId() });
      if (!r.ok) {
        setEvalOutcome(`failed (${r.error?.error ?? `http ${r.status}`})`);
        return;
      }
      setEvalItems(r.body.items);
      // an unlock may also have been minted by the server's own reaction to the save (outbox):
      // claim every unlocked achievement whose grant is still pending, not only this call's unlocks
      const pend = await api.grants.pending();
      const pendingKeys = new Set(pend.ok ? pend.body.grants.map((x) => x.grantKey) : []);
      const claimable = r.body.items.filter(
        (it) => it.unlocked && it.grantKey && pendingKeys.has(it.grantKey),
      );
      const ids = [...new Set([...r.body.unlocked, ...claimable.map((it) => it.id)])];
      setEvalOutcome(ids.length ? `unlocked: ${ids.join(', ')}` : 'nothing new');
      for (const it of claimable) {
        const c = await g.claimGrant(it.grantKey!);
        if (c?.outcome === 'claimed') g.toast(`Achievement unlocked: ${it.id}`);
      }
      g.bumpServer();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" data-testid="rewards-panel">
      <h2>Rewards</h2>
      <div className="row">
        <button data-testid="daily-claim" disabled={busy} onClick={() => void claimDaily()}>
          Claim daily reward
        </button>
        <span className="muted" data-testid="daily-outcome">
          {daily}
        </span>
      </div>
      <h3>Achievements</h3>
      <div className="row">
        <button data-testid="achievements-evaluate" disabled={busy} onClick={() => void evaluate()}>
          Evaluate
        </button>
        <span className="muted" data-testid="achievements-outcome">
          {evalOutcome}
        </span>
      </div>
      <ul className="list" data-testid="achievements">
        {items.map((it) => (
          <li
            key={it.id}
            data-testid={`achievement-${it.id}`}
            data-unlocked={it.unlocked ? '1' : '0'}
          >
            <b>{it.id}</b> {it.unlocked ? 'unlocked' : 'locked'}{' '}
            {it.progress.map((p) => `${p.current}/${p.target} (${p.source})`).join(' ')}
            {it.grantKey ? ` · ${it.grantKey}` : ''}
          </li>
        ))}
      </ul>
      <h3>Pending grants</h3>
      <ul className="list" data-testid="pending-grants">
        {pending.length === 0 ? <li className="muted">none</li> : null}
        {pending.map((gr) => (
          <li key={gr.grantKey} data-testid="pending-grant" data-grant-key={gr.grantKey}>
            <b>{gr.title ?? gr.grantKey}</b> {describe(gr)}{' '}
            <button
              data-testid={`claim-${gr.grantKey}`}
              disabled={busy}
              onClick={() => void g.claimGrant(gr.grantKey)}
            >
              Claim
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function describe(grant: Grant): string {
  return grant.rewards
    .map((r) =>
      r.kind === 'soft_currency'
        ? `+${r.amount} ${r.currency}`
        : r.kind === 'premium_currency'
          ? `+${r.amount} gems`
          : r.kind === 'cosmetic'
            ? `cosmetic ${r.cosmeticId}`
            : `${r.qty}× ${r.itemId}`,
    )
    .join(', ');
}
