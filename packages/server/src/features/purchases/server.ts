// purchases feature (§4.3, ADR-007, ADR-024): receipt verify (provider), purchase_transactions,
// purchase_adjustments (±), classification, per-pack promotions, /purchases/mine, player_flags.
import type { FastifyInstance } from 'fastify';
import {
  PurchaseVerifyBody,
  PurchaseBatchVerifyBody,
  AdjustmentsAckBody,
  AdminAdjustmentBody,
  type PurchaseVerifyResult,
  type PurchaseBatchVerifyResult,
  type PurchaseVerification,
  type PurchasesMineResponse,
  type AdjustmentsAckResult,
  type AdminAdjustmentResult,
  type PurchaseRecord,
  type PurchaseAdjustment,
} from '@foundation/contracts';
import type { PurchaseClassification } from '@foundation/contracts/enums';
import type { VerifiedReceipt } from '@foundation/jest-verify';
import { defineCommand } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import type { Q, Tx } from '../../db/index.ts';
import type { CatalogPack } from '../../game/config.ts';
import { mintGrant } from '../../rewards/mint.ts';
import { actorLabel } from '../../cqrs/bus.ts';
import { entitlementFor } from '../../game/facts.ts';

type VerifyResult = Omit<PurchaseVerifyResult, 'serverNow' | 'requestId'>;
type BatchVerifyResult = Omit<PurchaseBatchVerifyResult, 'serverNow' | 'requestId'>;
type AckResult = Omit<AdjustmentsAckResult, 'serverNow' | 'requestId'>;
type AdjResult = Omit<AdminAdjustmentResult, 'serverNow' | 'requestId'>;

export type Classified =
  | { kind: 'unsupported'; pack: null }
  | { kind: Exclude<PurchaseClassification, 'unsupported'>; pack: CatalogPack };

const VALID_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

/** Only signed facts classify money. Unknown products stay unsupported; sandbox provenance beats price. */
export function classifyReceipt(r: VerifiedReceipt, catalog: readonly CatalogPack[]): Classified {
  const pack = catalog.find((p) => p.sku === r.productSku);
  if (!pack) return { kind: 'unsupported', pack: null };
  if (r.sandbox) return { kind: 'sandbox', pack };
  if (
    typeof r.price === 'number' &&
    Number.isFinite(r.price) &&
    r.price > 0 &&
    typeof r.currency === 'string' &&
    VALID_CURRENCIES.has(r.currency)
  )
    return { kind: 'paid', pack };
  return { kind: 'unclassified', pack };
}

export function grantedAmount(
  c: Classified,
  packPreviouslyPurchased: boolean,
  mintPremium: 'on' | 'off',
): number {
  if (c.kind !== 'paid' || mintPremium !== 'on') return 0;
  return c.pack.baseAmount * (packPreviouslyPurchased ? 1 : (c.pack.firstPurchaseMultiplier ?? 1));
}

export const PurchasesVerify = defineCommand<typeof PurchaseVerifyBody, VerifyResult>({
  type: 'purchases.verify',
  schema: PurchaseVerifyBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'purchases',
  stepUp: true,
  replay: {
    fromStored: (r) => ({ ...r, outcome: r.outcome === 'recorded' ? 'duplicate' : r.outcome }),
  },
});
export const PurchasesVerifyBatch = defineCommand<
  typeof PurchaseBatchVerifyBody,
  BatchVerifyResult
>({
  type: 'purchases.verifyBatch',
  schema: PurchaseBatchVerifyBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'purchases',
  stepUp: true,
});
export const PurchasesAck = defineCommand<typeof AdjustmentsAckBody, AckResult>({
  type: 'purchases.ackAdjustments',
  schema: AdjustmentsAckBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'purchases',
});
export const AdminAdjust = defineCommand<typeof AdminAdjustmentBody, AdjResult>({
  type: 'purchases.adjust',
  schema: AdminAdjustmentBody,
  actorPolicy: { admin: 'grant' },
  scope: 'game',
  lock: 'none',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});

interface TxRow {
  id: string;
  sku: string;
  pack_key: string | null;
  classification: PurchaseClassification;
  granted: number;
  grant_key: string | null;
  price: string | null;
  currency: string | null;
  sandbox: boolean | null;
  created_at: Date;
  completed_at: Date | null;
  recorded_at: Date;
}
const toRecord = (r: TxRow): PurchaseRecord => ({
  id: Number(r.id),
  sku: r.sku,
  ...(r.pack_key ? { packKey: r.pack_key } : {}),
  classification: r.classification,
  granted: r.granted,
  ...(r.grant_key ? { grantKey: r.grant_key } : {}),
  ...(r.price !== null ? { price: Number(r.price) } : {}),
  ...(r.currency ? { currency: r.currency } : {}),
  sandbox: r.sandbox,
  createdAt: r.created_at.getTime(),
  completedAt: r.completed_at ? r.completed_at.getTime() : null,
  recordedAt: r.recorded_at.getTime(),
});

interface AdjRow {
  id: string;
  kind: 'refund' | 'make_good' | 'correction';
  delta: number;
  reason: string;
  admin_action_id: string | null;
  transaction_id: string | null;
  recorded_at: Date;
  acked_at: Date | null;
}
const toAdj = (r: AdjRow): PurchaseAdjustment => ({
  id: Number(r.id),
  kind: r.kind,
  delta: r.delta,
  reason: r.reason,
  ...(r.admin_action_id ? { adminActionId: Number(r.admin_action_id) } : {}),
  ...(r.transaction_id ? { transactionId: Number(r.transaction_id) } : {}),
  recordedAt: r.recorded_at.getTime(),
  acked: r.acked_at !== null,
});

export async function listPurchases(q: Q, playerKey: string): Promise<PurchaseRecord[]> {
  const rows = await q<
    TxRow[]
  >`SELECT id, sku, pack_key, classification, granted, grant_key, price, currency, sandbox, created_at, completed_at, recorded_at FROM purchase_transactions WHERE player_key = ${playerKey} ORDER BY created_at, id`;
  return rows.map(toRecord);
}

export async function listAdjustments(
  q: Q,
  playerKey: string,
  pendingOnly: boolean,
): Promise<PurchaseAdjustment[]> {
  const rows = await q<AdjRow[]>`
    SELECT a.id, a.kind, a.delta, a.reason, a.admin_action_id, a.transaction_id, a.recorded_at, k.acked_at
    FROM purchase_adjustments a LEFT JOIN purchase_adjustment_acks k ON k.adjustment_id = a.id
    WHERE a.player_key = ${playerKey} AND (${!pendingOnly} OR k.acked_at IS NULL) ORDER BY a.recorded_at, a.id`;
  return rows.map(toAdj);
}

export function registerPurchases(app: FastifyInstance, ctx: AppContext): void {
  const { bus, game } = ctx;
  ctx.declaredCommands.push(PurchasesVerify, PurchasesVerifyBatch, PurchasesAck, AdminAdjust);

  const recordReceipt = async (
    t: Tx,
    playerKey: string,
    r: VerifiedReceipt,
    commandId: string,
    exec: Parameters<typeof actorLabel>[0],
    tokenLocked = false,
  ): Promise<PurchaseVerification> => {
    if (!tokenLocked) await t`SELECT pg_advisory_xact_lock(6, hashtext(${r.purchaseToken}))`;
    const existing = await t<
      (TxRow & { player_key: string })[]
    >`SELECT id, sku, pack_key, classification, granted, grant_key, price, currency, sandbox, created_at, completed_at, recorded_at, player_key FROM purchase_transactions WHERE provider_token = ${r.purchaseToken}`;
    if (existing[0] && existing[0].player_key !== playerKey)
      return {
        purchaseToken: r.purchaseToken,
        outcome: 'rejected',
        reason: 'sub_mismatch',
        completion: 'withhold',
      };
    if (existing[0])
      return {
        purchaseToken: r.purchaseToken,
        outcome: 'duplicate',
        purchase: toRecord(existing[0]),
        completion: existing[0].grant_key ? 'ready' : 'withhold',
      };

    const c = classifyReceipt(r, game.catalog);
    let granted = 0;
    let grantKey: string | null = null;
    if (c.kind !== 'unsupported') {
      const prev = await t<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM purchase_transactions WHERE player_key = ${playerKey} AND pack_key = ${c.pack.packKey} AND classification = 'paid'`;
      granted = grantedAmount(c, (prev[0]?.n ?? 0) > 0, game.purchases.mintPremium);
    }
    if (granted > 0) {
      grantKey = `purchase:${r.purchaseToken}`;
      await mintGrant(t, {
        playerKey,
        grantKey,
        source: 'purchase',
        rewards: [{ kind: 'premium_currency', amount: granted }],
        reason: `purchase ${r.productSku}`,
        actor: actorLabel(exec),
        commandId,
      });
    }
    const ins = await t<TxRow[]>`
      INSERT INTO purchase_transactions (provider_token, player_key, sku, pack_key, base_amount, granted, price, currency, sandbox, classification, created_at, completed_at, source, command_id, grant_key)
      VALUES (${r.purchaseToken}, ${playerKey}, ${r.productSku}, ${c.pack?.packKey ?? null}, ${c.pack?.baseAmount ?? 0}, ${granted}, ${r.price ?? null}, ${r.currency ?? null}, ${r.sandbox}, ${c.kind}, ${new Date(r.createdAt)}, ${r.completedAt === null ? null : new Date(r.completedAt)}, 'live_receipt', ${commandId}, ${grantKey})
      RETURNING id, sku, pack_key, classification, granted, grant_key, price, currency, sandbox, created_at, completed_at, recorded_at`;
    await ctx.outbox.emit(t, {
      kind: 'purchase.recorded',
      playerKey,
      payload: {
        id: Number(ins[0]!.id),
        sku: r.productSku,
        classification: c.kind,
        granted,
        grantKey,
      },
      commandId,
    });
    return {
      purchaseToken: r.purchaseToken,
      outcome: 'recorded',
      purchase: toRecord(ins[0]!),
      completion: grantKey ? 'ready' : 'withhold',
    };
  };

  bus.register(PurchasesVerify, async (input, exec, tx): Promise<VerifyResult> => {
    const t = tx!;
    const playerKey = exec.playerKey!;
    const v = ctx.payments.verifyReceipt(input.purchaseSigned, ctx.config.gameId);
    if (!v.ok) {
      if (v.reason === 'no_secret')
        throw new AppError(
          'not_configured',
          'payments verifier has no secret; refusing to verify',
          { reason: v.reason },
        );
      return { outcome: 'rejected', reason: v.reason, completion: 'withhold' };
    }
    if (v.purchases.length !== 1)
      return { outcome: 'rejected', reason: 'malformed_purchase', completion: 'withhold' };
    const r = v.purchases[0]!;
    if (r.playerId !== playerKey)
      return { outcome: 'rejected', reason: 'sub_mismatch', completion: 'withhold' };
    return recordReceipt(t, playerKey, r, input.commandId, exec);
  });

  bus.register(PurchasesVerifyBatch, async (input, exec, tx): Promise<BatchVerifyResult> => {
    const t = tx!;
    const playerKey = exec.playerKey!;
    const v = ctx.payments.verifyReceipt(input.purchasesSigned, ctx.config.gameId);
    if (!v.ok) {
      if (v.reason === 'no_secret')
        throw new AppError(
          'not_configured',
          'payments verifier has no secret; refusing to verify',
          { reason: v.reason },
        );
      return { outcome: 'rejected', reason: v.reason, results: [] };
    }
    if (v.purchases.length > 50)
      return { outcome: 'rejected', reason: 'malformed_purchase', results: [] };
    if (v.purchases.some((purchase) => purchase.playerId !== playerKey))
      return { outcome: 'rejected', reason: 'sub_mismatch', results: [] };

    const unique = new Map<string, VerifiedReceipt>();
    for (const purchase of v.purchases) {
      const prior = unique.get(purchase.purchaseToken);
      if (prior && JSON.stringify(prior) !== JSON.stringify(purchase))
        return { outcome: 'rejected', reason: 'malformed_purchase', results: [] };
      if (!prior) unique.set(purchase.purchaseToken, purchase);
    }
    for (const token of [...unique.keys()].sort())
      await t`SELECT pg_advisory_xact_lock(6, hashtext(${token}))`;

    const results: PurchaseVerification[] = [];
    for (const purchase of unique.values())
      results.push(await recordReceipt(t, playerKey, purchase, input.commandId, exec, true));
    return { outcome: 'processed', results };
  });

  bus.register(PurchasesAck, async (input, exec, tx) => {
    const t = tx!;
    const playerKey = exec.playerKey!;
    const acked: number[] = [];
    for (const id of input.adjustmentIds) {
      const own = await t<
        { id: string }[]
      >`SELECT a.id FROM purchase_adjustments a WHERE a.id = ${id} AND a.player_key = ${playerKey} AND NOT EXISTS (SELECT 1 FROM purchase_adjustment_acks k WHERE k.adjustment_id = a.id)`;
      if (!own[0]) continue;
      await t`INSERT INTO purchase_adjustment_acks (adjustment_id, player_key, command_id) VALUES (${id}, ${playerKey}, ${input.commandId})`;
      acked.push(id);
    }
    return { acked };
  });

  bus.register(AdminAdjust, async (input, exec, tx) => {
    const t = tx!;
    if (exec.actor.kind !== 'admin') throw new AppError('forbidden', 'admin only');
    // negative adjustments always reference an admin action: write the audit row first and link it
    const existingAudit = await t<
      { id: string }[]
    >`SELECT id FROM admin_actions WHERE command_id = ${input.commandId} AND command_type = 'purchases.adjust'`;
    const audit = existingAudit[0]
      ? existingAudit
      : await t<{ id: string }[]>`
      INSERT INTO admin_actions (admin_key_id, scope, command_type, command_id, target, reason, outcome, request_id)
      VALUES (${exec.actor.keyId}, 'grant', 'purchases.adjust', ${input.commandId}, ${input.playerKey}, ${input.reason}, 'ok', ${exec.requestId})
      RETURNING id`;
    const adminActionId = Number(audit[0]!.id);
    if (input.transactionId !== undefined) {
      const owns = await t<
        { id: string }[]
      >`SELECT id FROM purchase_transactions WHERE id = ${input.transactionId} AND player_key = ${input.playerKey}`;
      if (!owns[0]) throw new AppError('not_found', 'transaction not found for player');
    }
    const ins = await t<{ id: string }[]>`
      INSERT INTO purchase_adjustments (player_key, kind, delta, reason, admin_action_id, transaction_id, command_id)
      VALUES (${input.playerKey}, ${input.kind}, ${input.delta}, ${input.reason}, ${adminActionId}, ${input.transactionId ?? null}, ${input.commandId}) RETURNING id`;
    if (input.kind === 'refund') {
      // refunds → strike escalation (§7)
      await t`INSERT INTO player_strikes (player_key, reason, ref) VALUES (${input.playerKey}, 'refund', ${String(ins[0]!.id)})`;
      const strikes = await t<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM player_strikes WHERE player_key = ${input.playerKey}`;
      if ((strikes[0]?.n ?? 0) >= 3) {
        await t`INSERT INTO player_flags (player_key, flag, enabled, reason, admin_key_id) VALUES (${input.playerKey}, 'purchases_disabled', true, 'auto: 3 refund strikes', ${exec.actor.keyId})
          ON CONFLICT (player_key, flag) DO UPDATE SET enabled = true, reason = EXCLUDED.reason, admin_key_id = EXCLUDED.admin_key_id, updated_at = now()`;
      }
    }
    await ctx.outbox.emit(t, {
      kind: 'purchase.adjusted',
      playerKey: input.playerKey,
      payload: { adjustmentId: Number(ins[0]!.id), kind: input.kind, delta: input.delta },
      commandId: input.commandId,
    });
    return { adjustmentId: Number(ins[0]!.id), duplicate: false };
  });

  route<typeof PurchaseVerifyBody, typeof import('@foundation/contracts').PurchaseVerifyResult>(
    app,
    ctx,
    'purchases.verify',
    async ({ body, exec }) => {
      if (ctx.liveops.killSwitch('command', 'purchases.verify'))
        throw new AppError('forbidden', 'purchases are switched off');
      return bus.execute(PurchasesVerify, { commandId: body.commandId, payload: body }, exec!);
    },
  );
  route<
    typeof PurchaseBatchVerifyBody,
    typeof import('@foundation/contracts').PurchaseBatchVerifyResult
  >(app, ctx, 'purchases.verifyBatch', async ({ body, exec }) => {
    if (ctx.liveops.killSwitch('command', 'purchases.verifyBatch'))
      throw new AppError('forbidden', 'purchases are switched off');
    return bus.execute(PurchasesVerifyBatch, { commandId: body.commandId, payload: body }, exec!);
  });
  route<typeof AdjustmentsAckBody, typeof import('@foundation/contracts').AdjustmentsAckResult>(
    app,
    ctx,
    'purchases.ackAdjustments',
    async ({ body, exec }) =>
      bus.execute(PurchasesAck, { commandId: body.commandId, payload: body }, exec!),
  );
  route<undefined, typeof import('@foundation/contracts').PurchasesMineResponse>(
    app,
    ctx,
    'purchases.mine',
    async ({ exec }) => {
      const playerKey = exec!.playerKey!;
      const sql = ctx.db.sql;
      const flags = await sql<
        { flag: string; until: Date | null }[]
      >`SELECT flag, until FROM player_flags WHERE player_key = ${playerKey} AND enabled AND flag = 'purchases_disabled'`;
      const disabled = flags.some((f) => f.until === null || f.until.getTime() > exec!.now);
      const out: Omit<PurchasesMineResponse, 'serverNow' | 'requestId'> = {
        purchases: await listPurchases(sql, playerKey),
        pendingAdjustments: await listAdjustments(sql, playerKey, true),
        entitlement: await entitlementFor(sql, playerKey),
        purchasesDisabled: disabled,
      };
      return out;
    },
  );
  route<typeof AdminAdjustmentBody, typeof import('@foundation/contracts').AdminAdjustmentResult>(
    app,
    ctx,
    'admin.adjustment',
    async ({ body, exec }) =>
      bus.execute(AdminAdjust, { commandId: body.commandId, payload: body }, exec!),
  );
}
