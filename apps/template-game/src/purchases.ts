// Purchase orchestration shared by live checkout and startup recovery. The server verifies signed
// provider data and authors `completion`; the browser never infers safe completion from price,
// classification, or an unsigned purchase object.
import type { ApiResult, PaymentsProvider, PurchaseCompletionOutcome } from '@foundation/client';
import type {
  PurchaseBatchVerifyBody,
  PurchaseBatchVerifyResult,
  PurchaseRecord,
  PurchaseVerifyBody,
  PurchaseVerifyResult,
} from '@foundation/contracts';

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
    grantKeys: [],
    errors: [],
  };
  const grantKeys = new Set<string>();

  try {
    await payments.recoverIncompleteBatch(async (page) => {
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
  } catch (error) {
    summary.errors.push(`recovery: ${error instanceof Error ? error.message : String(error)}`);
  }

  summary.grantKeys = [...grantKeys];
  return summary;
}

function apiFailure(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  return result.error?.error ?? result.networkError ?? `http ${result.status}`;
}
