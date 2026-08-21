// Purchase orchestration shared by live checkout and startup recovery. The server verifies signed
// provider data and authors `completion`; the browser never infers safe completion from price,
// classification, or an unsigned purchase object.
import type {
  ApiResult,
  PaymentsProvider,
  PurchaseCompletionOutcome,
  PurchaseRecoveryReport,
} from '@foundation/client';
import type {
  ConfigResponse,
  PurchaseBatchVerifyBody,
  PurchaseBatchVerifyResult,
  PurchaseRecord,
  PurchaseVerifyBody,
  PurchaseVerifyResult,
  PurchasesMineResponse,
} from '@foundation/contracts';
import { compareBuildVersions } from './versions.ts';

type CheckoutReadiness = Pick<PurchasesMineResponse, 'checkoutEnabled' | 'purchasesDisabled'>;

export function canBeginCheckout(
  mine: CheckoutReadiness | null,
  liveConfigLoaded: boolean,
  purchaseCommandPaused: boolean,
): boolean {
  return (
    mine?.checkoutEnabled === true &&
    !mine.purchasesDisabled &&
    liveConfigLoaded &&
    !purchaseCommandPaused
  );
}

export interface CheckoutReadinessApi {
  purchases: {
    mine(): Promise<ApiResult<PurchasesMineResponse>>;
  };
  liveops: {
    config(authed?: boolean): Promise<ApiResult<ConfigResponse>>;
  };
}

/** Re-read every server-authored checkout control immediately before opening the provider sheet. */
export async function isCheckoutReadyNow(
  api: CheckoutReadinessApi,
  sku: string,
  buildVersion: string,
): Promise<boolean> {
  try {
    const [mine, live] = await Promise.all([api.purchases.mine(), api.liveops.config(true)]);
    if (!mine.ok || !live.ok) return false;
    const purchaseCommandPaused =
      live.body.killSwitches.commands.includes('purchases.verify') ||
      live.body.killSwitches.commands.includes('purchases.verifyBatch');
    return (
      canBeginCheckout(mine.body, true, purchaseCommandPaused) &&
      !live.body.maintenance &&
      !live.body.killSwitches.skus.includes(sku) &&
      compareBuildVersions(buildVersion, live.body.minBuildVersion) >= 0
    );
  } catch {
    return false;
  }
}

export interface DirectPurchaseApi {
  verify(body: PurchaseVerifyBody): Promise<ApiResult<PurchaseVerifyResult>>;
}

export interface RecoveryPurchaseApi {
  verifyBatch(body: PurchaseBatchVerifyBody): Promise<ApiResult<PurchaseBatchVerifyResult>>;
}

export type CheckoutResult =
  | { kind: 'completed'; purchase: PurchaseRecord }
  | { kind: 'withheld'; purchase?: PurchaseRecord; reason?: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'server_error'; reason: string }
  | { kind: 'pending_completion'; purchase: PurchaseRecord; reason: string }
  | { kind: 'terminal_completion_error'; purchase: PurchaseRecord; reason: string };

export async function verifyAndCompletePurchase(
  api: DirectPurchaseApi,
  payments: PaymentsProvider,
  input: { commandId: string; purchaseToken: string; purchaseSigned: string },
): Promise<CheckoutResult> {
  const verified = await api.verify({
    commandId: input.commandId,
    purchaseSigned: input.purchaseSigned,
  });
  if (!verified.ok) return { kind: 'server_error', reason: apiFailure(verified) };
  if (verified.body.outcome === 'rejected')
    return { kind: 'rejected', reason: verified.body.reason ?? 'receipt rejected' };
  if (verified.body.completion !== 'ready') {
    return {
      kind: 'withheld',
      ...(verified.body.purchase ? { purchase: verified.body.purchase } : {}),
      ...(verified.body.reason ? { reason: verified.body.reason } : {}),
    };
  }
  if (!verified.body.purchase)
    return { kind: 'rejected', reason: 'server marked a missing purchase ready' };
  if (!verified.body.purchaseToken || verified.body.purchaseToken !== input.purchaseToken)
    return { kind: 'rejected', reason: 'verified provider token did not match checkout' };

  const completion = await payments.complete(verified.body.purchaseToken);
  return completionResult(completion, verified.body.purchase);
}

function completionResult(
  completion: PurchaseCompletionOutcome,
  purchase: PurchaseRecord,
): CheckoutResult {
  if (completion.kind === 'success') return { kind: 'completed', purchase };
  if (completion.kind === 'retryable_error')
    return { kind: 'pending_completion', purchase, reason: completion.message };
  return { kind: 'terminal_completion_error', purchase, reason: completion.message };
}

export interface PurchaseRecoverySummary {
  pagesVerified: number;
  ready: number;
  withheld: number;
  rejected: number;
  recoveryOutcome: PurchaseRecoveryReport['outcome'] | 'failed';
  completed: number;
  completionRetryable: number;
  completionInvalid: number;
  grantKeys: string[];
  errors: string[];
}

/** Drain official signed recovery pages. The provider completes only tokens returned by this callback. */
export async function recoverPurchasesOnStartup(
  api: RecoveryPurchaseApi,
  payments: PaymentsProvider,
  commandId: () => string,
): Promise<PurchaseRecoverySummary> {
  const summary: PurchaseRecoverySummary = {
    pagesVerified: 0,
    ready: 0,
    withheld: 0,
    rejected: 0,
    recoveryOutcome: 'failed',
    completed: 0,
    completionRetryable: 0,
    completionInvalid: 0,
    grantKeys: [],
    errors: [],
  };
  const grantKeys = new Set<string>();

  try {
    const recovery = await payments.recoverIncompleteBatch(async (page) => {
      const verified = await api.verifyBatch({
        commandId: commandId(),
        purchasesSigned: page.purchasesSigned,
      });
      if (!verified.ok) {
        summary.errors.push(`verify-batch: ${apiFailure(verified)}`);
        return [];
      }
      if (verified.body.outcome === 'rejected') {
        summary.errors.push(`verify-batch: ${verified.body.reason ?? 'rejected'}`);
        return [];
      }

      summary.pagesVerified++;
      const pageTokens = new Set(page.purchases.map((purchase) => purchase.purchaseToken));
      const ready: string[] = [];
      for (const result of verified.body.results) {
        if (!pageTokens.has(result.purchaseToken)) {
          summary.errors.push(`verify-batch: unexpected token ${result.purchaseToken}`);
          continue;
        }
        if (result.outcome === 'rejected') {
          summary.rejected++;
          continue;
        }
        if (result.completion !== 'ready') {
          summary.withheld++;
          continue;
        }
        summary.ready++;
        ready.push(result.purchaseToken);
        if (result.purchase?.grantKey) grantKeys.add(result.purchase.grantKey);
      }
      return ready;
    });
    summary.recoveryOutcome = recovery.outcome;
    summary.completed = recovery.completed.length;
    summary.completionRetryable = recovery.retryable.length;
    summary.completionInvalid = recovery.invalid.length;
    if (recovery.outcome !== 'drained') summary.errors.push(`recovery: ${recovery.outcome}`);
    if (recovery.retryable.length)
      summary.errors.push(`completion: ${recovery.retryable.length} retryable`);
    if (recovery.invalid.length)
      summary.errors.push(`completion: ${recovery.invalid.length} invalid`);
  } catch (error) {
    summary.errors.push(`recovery: ${error instanceof Error ? error.message : String(error)}`);
  }

  summary.grantKeys = [...grantKeys];
  return summary;
}

function apiFailure(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  return result.error?.error ?? result.networkError ?? `http ${result.status}`;
}
