// Shop (§7 money): reward amounts come from game config, but names/prices/currency come only from
// the platform catalog. Checkout is verified server-side, then completed only when the server says
// its durable grant is ready. Paused SKUs are hidden; fake client-side discounts are forbidden.
import type { PurchaseRecord, PurchasesMineResponse } from '@foundation/contracts';
import { mintId, type Product } from '@foundation/client';
import { useCallback, useState } from 'react';
import { CATALOG } from '../config.ts';
import { useGame } from '../game.tsx';
import { canBeginCheckout, verifyAndCompletePurchase } from '../purchases.ts';
import { useFetched } from './useFetched.ts';

export function formatProductPrice(product: Product): string | null {
  if (
    typeof product.price !== 'number' ||
    !Number.isFinite(product.price) ||
    product.price < 0 ||
    typeof product.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(product.currency)
  )
    return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: product.currency,
    }).format(product.price);
  } catch {
    return `${product.price.toFixed(2)} ${product.currency}`;
  }
}

export function Shop() {
  const g = useGame();
  const { api, client, live, serverRev } = g;
  const [outcome, setOutcome] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const fetchMine = useCallback(async (): Promise<PurchasesMineResponse | null> => {
    void serverRev;
    const r = await api.purchases.mine();
    return r.ok ? r.body : null;
  }, [api, serverRev]);
  const mine = useFetched(fetchMine).data;
  const fetchProducts = useCallback(() => client.platform.payments.products(), [client]);
  const products = useFetched(fetchProducts).data ?? [];
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const purchases: PurchaseRecord[] = mine?.purchases ?? [];
  const entitlement = mine?.entitlement ?? null;
  const purchaseCommandPaused =
    live?.killSwitches.commands.includes('purchases.verify') === true ||
    live?.killSwitches.commands.includes('purchases.verifyBatch') === true;
  const checkoutReady = canBeginCheckout(mine, live !== null, purchaseCommandPaused);

  const buy = async (sku: string): Promise<void> => {
    if (!checkoutReady) {
      setOutcome('checkout is not currently available');
      return;
    }
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
      const result = await verifyAndCompletePurchase(api.purchases, client.platform.payments, {
        commandId: mintId(),
        purchaseToken: begin.purchaseToken,
        purchaseSigned: begin.purchaseSigned,
      });
      const p = 'purchase' in result ? result.purchase : undefined;
      if (p?.grantKey && p.granted > 0) await g.claimGrant(p.grantKey);
      if (result.kind === 'completed') {
        setOutcome(
          `completed (${result.purchase.classification}) — granted ${result.purchase.granted}`,
        );
        client.platform.analytics.track('purchase_completed', { sku });
      } else if (result.kind === 'withheld') {
        setOutcome(
          `recorded but left incomplete (${result.purchase?.classification ?? 'unclassified'}; delivery gate pending)`,
        );
      } else if (result.kind === 'pending_completion') {
        setOutcome(`granted; provider completion will retry (${result.reason})`);
      } else if (result.kind === 'terminal_completion_error') {
        setOutcome(`granted; provider rejected completion (${result.reason})`);
        client.reportError(new Error('terminal purchase completion error'), { sku });
      } else if (result.kind === 'rejected') setOutcome(`rejected (${result.reason})`);
      else setOutcome(`verify failed (${result.reason})`);
      g.bumpServer();
    } finally {
      setBusy(false);
    }
  };

  const paused = new Set(live?.killSwitches.skus ?? []);
  return (
    <section className="panel" data-testid="shop">
      <h2>Shop</h2>
      {mine === null || live === null ? (
        <p className="muted">Checking purchase availability…</p>
      ) : mine.purchasesDisabled ? (
        <p className="muted">Purchases are disabled for this account.</p>
      ) : !mine.checkoutEnabled || purchaseCommandPaused ? (
        <p className="muted">Checkout is temporarily unavailable.</p>
      ) : null}
      <ul className="list" data-testid="shop-list">
        {CATALOG.filter((c) => !paused.has(c.sku)).flatMap((c) => {
          const product = bySku.get(c.sku);
          const price = product ? formatProductPrice(product) : null;
          if (!product || price === null) return [];
          return (
            <li key={c.sku} data-testid={`sku-${c.sku}`}>
              <b>{product.title}</b> — {c.amount} gems —{' '}
              <span data-testid={`price-${c.sku}`}>{price}</span>{' '}
              <button
                data-testid={`buy-${c.sku}`}
                disabled={busy || !checkoutReady}
                onClick={() => void buy(c.sku)}
              >
                Buy
              </button>
            </li>
          );
        })}
      </ul>
      {products.length === 0 ? <p className="muted">No platform products available.</p> : null}
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
