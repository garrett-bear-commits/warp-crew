// Shop (§7 money): catalog mirrored client-side; paused SKUs (GET /v1/config killSwitches.skus)
// are hidden; buy = platform.payments.begin(sku) → purchaseSigned → POST /v1/purchases/verify
// (the signed receipt is the only input) → recorded | duplicate | rejected + granted amount; a
// purchase grant (minting on) is claimed like any other grant; sandbox receipts record and never
// mint. Purchases + entitlement from GET /v1/purchases/mine.
import type { PurchaseRecord, PurchasesMineResponse } from '@foundation/contracts';
import { mintId } from '@foundation/client';
import { useCallback, useState } from 'react';
import { CATALOG } from '../config.ts';
import { useGame } from '../game.tsx';
import { useSale } from './SaleBanner.tsx';
import { useFetched } from './useFetched.ts';

export function Shop() {
  const g = useGame();
  const { api, client, live, serverRev } = g;
  const sale = useSale();
  const [outcome, setOutcome] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const fetchMine = useCallback(async (): Promise<PurchasesMineResponse | null> => {
    void serverRev;
    const r = await api.purchases.mine();
    return r.ok ? r.body : null;
  }, [api, serverRev]);
  const mine = useFetched(fetchMine).data;
  const purchases: PurchaseRecord[] = mine?.purchases ?? [];
  const entitlement = mine?.entitlement ?? null;
  const disabled = mine?.purchasesDisabled ?? false;

  const buy = async (sku: string): Promise<void> => {
    setBusy(true);
    try {
      let begin;
      try {
        begin = await client.platform.payments.begin(sku);
      } catch (e) {
        setOutcome(`payments error: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (begin.kind === 'cancel') {
        setOutcome('cancelled');
        return;
      }
      if (begin.kind === 'error') {
        setOutcome(`payments error: ${begin.message}`);
        return;
      }
      if (!begin.purchaseSigned) {
        setOutcome('no signed receipt from the platform — nothing recorded');
        return;
      }
      const r = await api.purchases.verify({
        commandId: mintId(),
        purchaseSigned: begin.purchaseSigned,
      });
      if (!r.ok) {
        setOutcome(`verify failed (${r.error?.error ?? `http ${r.status}`})`);
        return;
      }
      const b = r.body;
      const p = b.purchase;
      if (b.outcome === 'rejected') {
        setOutcome(`rejected${b.reason ? ` (${b.reason})` : ''}`);
        return;
      }
      const cls = p?.classification ?? 'unclassified';
      const granted = p?.granted ?? 0;
      setOutcome(
        `${b.outcome} (${cls}) — granted ${granted}${granted === 0 && cls === 'sandbox' ? ' (sandbox never mints)' : ''}`,
      );
      if (p?.grantKey && granted > 0) await g.claimGrant(p.grantKey);
      await client.platform.payments.complete(begin.purchaseToken);
      g.bumpServer();
    } finally {
      setBusy(false);
    }
  };

  const paused = new Set(live?.killSwitches.skus ?? []);
  return (
    <section className="panel" data-testid="shop">
      <h2>Shop</h2>
      {disabled ? <p className="muted">Purchases are disabled for this account.</p> : null}
      <ul className="list" data-testid="shop-list">
        {CATALOG.filter((c) => !paused.has(c.sku)).map((c) => {
          const price = sale.on ? c.price * (1 - sale.discount / 100) : c.price;
          return (
            <li key={c.sku} data-testid={`sku-${c.sku}`}>
              <b>{c.title}</b> — {c.amount} gems —{' '}
              <span data-testid={`price-${c.sku}`}>${price.toFixed(2)}</span>
              {sale.on ? <s className="muted"> ${c.price.toFixed(2)}</s> : null}{' '}
              <button
                data-testid={`buy-${c.sku}`}
                disabled={busy || disabled}
                onClick={() => void buy(c.sku)}
              >
                Buy
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted" data-testid="purchase-outcome">
        {outcome}
      </p>
      <p className="muted">
        Entitlement <b data-testid="entitlement">{entitlement ?? '—'}</b> · purchases{' '}
        <b data-testid="purchase-count">{purchases.length}</b>
      </p>
      <ul className="list" data-testid="purchases">
        {purchases.map((p) => (
          <li key={p.id} data-testid="purchase" data-sku={p.sku} data-class={p.classification}>
            {p.sku} {p.classification} granted={p.granted}
          </li>
        ))}
      </ul>
    </section>
  );
}
