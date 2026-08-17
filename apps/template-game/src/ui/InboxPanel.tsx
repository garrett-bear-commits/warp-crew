// Inbox (support letters + announcements from GET /v1/inbox; server-side read state; letters with
// a grantKey are claimable) rendered by the adapter's Inbox shell, plus code redemption
// (POST /v1/codes/redeem) behind the RegistrationGate (codes are a registered-only feature by
// server policy when a campaign says so).
import type { InboxLetter } from '@foundation/contracts';
import { mintId } from '@foundation/client';
import { Inbox, RegistrationGate } from '@foundation/client/react';
import { useCallback, useState } from 'react';
import { useGame } from '../game.tsx';
import { describe } from './RewardsPanel.tsx';

export function InboxPanel() {
  const g = useGame();
  const { api, client, serverRev } = g;
  const [version, setVersion] = useState(0);
  const [unread, setUnread] = useState<number | null>(null);
  const load = useCallback(async () => {
    // serverRev + version are part of the loader identity so the Inbox shell re-fetches
    void serverRev;
    void version;
    const r = await api.inbox.list();
    if (!r.ok) throw new Error(r.error?.error ?? `http ${r.status}`);
    setUnread(r.body.unread);
    return r.body;
  }, [api, serverRev, version]);
  const onRead = async (l: InboxLetter): Promise<void> => {
    await api.inbox.read({ commandId: mintId(), letterIds: [l.id] });
    setVersion((v) => v + 1);
  };
  const onClaim = async (l: InboxLetter): Promise<void> => {
    if (!l.grantKey) return;
    await g.claimGrant(l.grantKey);
    setVersion((v) => v + 1);
  };

  const [code, setCode] = useState('');
  const [codeOutcome, setCodeOutcome] = useState('');
  const redeem = async (): Promise<void> => {
    const r = await api.grants.redeemCode({ commandId: mintId(), code: code.trim() });
    if (!r.ok) {
      setCodeOutcome(`failed (${r.error?.error ?? `http ${r.status}`})`);
      return;
    }
    const b = r.body;
    if (b.outcome === 'redeemed' && b.grant) {
      g.applyGrant(b.grant);
      setCodeOutcome(`redeemed: ${describe(b.grant)}`);
      g.bumpServer();
    } else setCodeOutcome(b.outcome);
  };

  return (
    <section className="panel" data-testid="inbox-panel">
      <h2>
        Inbox{' '}
        {unread !== null ? (
          <span className="pill" data-testid="inbox-unread">
            {unread} unread
          </span>
        ) : null}
      </h2>
      <button data-testid="inbox-refresh" onClick={() => setVersion((v) => v + 1)}>
        Refresh inbox
      </button>
      <div data-testid="inbox">
        <Inbox
          load={load}
          onRead={(l) => void onRead(l)}
          onClaim={(l) => void onClaim(l)}
          empty="No messages"
        />
      </div>
      <h3>Redeem a code</h3>
      <RegistrationGate
        registered={client.player?.registered === true}
        prompt={<p data-testid="codes-gate">Sign in to redeem codes.</p>}
      >
        <div className="row">
          <input
            data-testid="code-input"
            value={code}
            placeholder="CODE-XXXX"
            onChange={(e) => setCode(e.currentTarget.value)}
          />
          <button
            data-testid="code-redeem"
            disabled={code.trim().length < 4}
            onClick={() => void redeem()}
          >
            Redeem
          </button>
          <span className="muted" data-testid="code-outcome">
            {codeOutcome}
          </span>
        </div>
      </RegistrationGate>
    </section>
  );
}
