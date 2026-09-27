// Postgres repository for saves and purchases. Every multi-step write for a
// player runs under a per-player advisory lock so sequence numbers and
// one-time grants cannot race.

import { readFileSync, readdirSync } from 'node:fs';
import { classifyReceipt } from './receipts.js';

const MIGRATIONS = new URL('./migrations/', import.meta.url);

export async function migrate(sql) {
  for (const file of readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort()) {
    await sql.unsafe(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
}

const lock = (tx, playerKey) => tx`SELECT pg_advisory_xact_lock(hashtextextended(${playerKey}, 0))`;

export function createStore(sql, { grantSandbox = false } = {}) {
  return {
    async currentSave(playerKey) {
      const [row] = await sql`
        SELECT seq, saved_at, blob FROM save_events
        WHERE player_key = ${playerKey} AND accepted AND blob IS NOT NULL
        ORDER BY seq DESC LIMIT 1`;
      return row ? { seq: Number(row.seq), savedAt: Number(row.saved_at), blob: row.blob } : null;
    },

    /**
     * Insert-only. Refused writes are stored too, so a wrong refusal is recoverable.
     * A write based on an older save than the current one is stored as
     * `stale_base` and never becomes current: the device must reconcile first.
     */
    async appendSave(playerKey, { blob, bytes, clientSeq, baseSeq, savedAt, accepted, rejectReason, deliveredTokens = [] }) {
      return sql.begin(async tx => {
        await lock(tx, playerKey);
        const [last] = await tx`SELECT COALESCE(MAX(seq), 0) AS seq FROM save_events WHERE player_key = ${playerKey}`;
        const [lastAccepted] = await tx`SELECT COALESCE(MAX(seq), 0) AS seq FROM save_events WHERE player_key = ${playerKey} AND accepted`;
        const currentSeq = Number(lastAccepted.seq);
        const stale = accepted && currentSeq > 0 && (baseSeq == null || baseSeq < currentSeq);
        const finalAccepted = accepted && !stale;
        const finalReason = stale ? 'stale_base' : rejectReason;
        const seq = Number(last.seq) + 1;
        await tx`
          INSERT INTO save_events (player_key, seq, client_seq, base_seq, saved_at, bytes, accepted, reject_reason, blob)
          VALUES (${playerKey}, ${seq}, ${clientSeq}, ${baseSeq}, ${savedAt}, ${bytes}, ${finalAccepted}, ${finalReason}, ${blob})`;
        if (finalAccepted && deliveredTokens.length) {
          await tx`
            UPDATE purchase_transactions SET delivered_seq = ${seq}
            WHERE player_key = ${playerKey} AND delivered_seq IS NULL AND provider_token IN ${tx(deliveredTokens)}`;
        }
        return { seq, accepted: finalAccepted, rejectReason: finalReason, stale, previousAcceptedSeq: currentSeq };
      });
    },

    /**
     * Record one verified receipt. Idempotent on the provider token; a second
     * copy of a one-time product is recorded but grants nothing.
     */
    async recordPurchase(playerKey, receipt, product) {
      return sql.begin(async tx => {
        await lock(tx, playerKey);
        const [existing] = await tx`SELECT sku, classification, granted FROM purchase_transactions WHERE provider_token = ${receipt.purchaseToken}`;
        if (existing) {
          return { status: 'already_recorded', sku: existing.sku, grant: existing.granted, classification: existing.classification };
        }
        let classification = product ? classifyReceipt(receipt) : 'unsupported';
        // Price-0 sandbox receipts grant only where sandbox granting is switched on (QA).
        let grant = product && (classification !== 'sandbox' || grantSandbox) ? product.grant : {};
        if (product?.oneTime) {
          const [owned] = await tx`
            SELECT 1 FROM purchase_transactions
            WHERE player_key = ${playerKey} AND sku = ${receipt.productSku} AND one_time
              AND classification IN ('paid', 'sandbox', 'unclassified')`;
          if (owned) {
            classification = 'duplicate_one_time';
            grant = {};
          }
        }
        await tx`
          INSERT INTO purchase_transactions
            (provider_token, player_key, sku, classification, granted, one_time, price, currency, created_at, completed_at)
          VALUES (${receipt.purchaseToken}, ${playerKey}, ${receipt.productSku}, ${classification}, ${tx.json(grant)},
            ${Boolean(product?.oneTime)}, ${Number.isInteger(receipt.price) ? receipt.price : null}, ${receipt.currency ?? null},
            ${new Date(receipt.createdAt)}, ${receipt.completedAt ? new Date(receipt.completedAt) : null})`;
        const status = classification === 'unsupported' ? 'unsupported' : classification === 'duplicate_one_time' ? 'duplicate_one_time'
          : classification === 'sandbox' && !grantSandbox ? 'sandbox_refused' : 'granted';
        return { status, sku: receipt.productSku, grant, classification };
      });
    },

    /** Granting purchases no accepted save has delivered yet, so a device can catch up. */
    async purchasesFor(playerKey) {
      const rows = await sql`
        SELECT provider_token, sku, granted FROM purchase_transactions
        WHERE player_key = ${playerKey} AND classification IN ('paid', 'sandbox', 'unclassified') AND delivered_seq IS NULL
          AND granted <> '{}'::jsonb
        ORDER BY created_at, id`;
      return rows.map(row => ({ purchaseToken: row.provider_token, sku: row.sku, grant: row.granted }));
    },
  };
}
