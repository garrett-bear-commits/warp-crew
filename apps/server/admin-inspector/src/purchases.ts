// Fix purchase: a purchase adjustment (POST /admin/v1/purchases/adjustments). Credit and refund
// take a positive amount of the game's premium currency (a refund is sent negative); a correction
// takes a signed delta. The currency is named after the game's grant vocabulary (game-grants.ts).
// The confirm step's plan is in plans.ts (writeSummary 'adjustPurchase').
import { fmtInt } from './format.ts';
import { grantVocabulary } from './game-grants.ts';
import { qs } from './ui.ts';
import { FormError, type FieldSpec } from './writes.ts';

/** AdminAdjustmentBody.delta bounds. */
export const ADJUSTMENT_LIMIT = 1_000_000;

/** The premium currency's name as a field label: `gems` → `Gems`. */
export const PREMIUM_LABEL =
  grantVocabulary.premiumName.charAt(0).toUpperCase() + grantVocabulary.premiumName.slice(1);

export const ADJUSTMENT_SPEC: FieldSpec[] = [
  { name: 'kind', label: 'Fix', kind: 'string' },
  { name: 'amount', label: PREMIUM_LABEL, kind: 'string' },
  { name: 'transactionId', label: 'Transaction ID', kind: 'optional-int' },
  { name: 'ticketRef', label: 'Ticket', kind: 'optional-string' },
  { name: 'reason', label: 'Reason', kind: 'string' },
];

type AdjustmentKind = 'make_good' | 'refund' | 'correction';
const KINDS: readonly string[] = ['make_good', 'refund', 'correction'];

/** The read form → `{kind, delta, reason, transactionId?, ticketRef?}`. Throws FormError. */
export function adjustmentFromFields(v: Record<string, unknown>): Record<string, unknown> {
  if (typeof v.kind !== 'string' || !KINDS.includes(v.kind))
    throw new FormError('Choose credit, refund or correction.');
  const kind = v.kind as AdjustmentKind;
  const n = Number(String(v.amount ?? '').trim());
  let delta: number;
  if (kind === 'correction') {
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > ADJUSTMENT_LIMIT)
      throw new FormError(
        `${PREMIUM_LABEL} must be a non-zero whole number within ±${fmtInt(ADJUSTMENT_LIMIT)}.`,
      );
    delta = n;
  } else {
    if (!Number.isInteger(n) || n < 1 || n > ADJUSTMENT_LIMIT)
      throw new FormError(
        `${PREMIUM_LABEL} must be a whole number from 1 to ${fmtInt(ADJUSTMENT_LIMIT)}.`,
      );
    delta = kind === 'refund' ? -n : n;
  }
  return {
    kind,
    delta,
    reason: v.reason,
    ...(v.transactionId !== undefined ? { transactionId: v.transactionId } : {}),
    ...(v.ticketRef !== undefined ? { ticketRef: v.ticketRef } : {}),
  };
}

const HINT: Record<AdjustmentKind, string> = {
  make_good: 'to add',
  refund: 'to remove',
  correction: '+ adds, − removes',
};
const SUBMIT: Record<AdjustmentKind, string> = {
  make_good: 'Review credit',
  refund: 'Review refund',
  correction: 'Review correction',
};

/** Hint, transaction field and submit button follow the chosen fix. */
export function bindAdjustmentForm(form: HTMLFormElement): void {
  qs(form, '[data-adjust-unit]').textContent = PREMIUM_LABEL;
  const hint = qs(form, '[data-adjust-hint]');
  const transaction = qs(form, '[data-adjust-transaction]');
  const transactionInput = qs<HTMLInputElement>(transaction, 'input');
  const amount = qs<HTMLInputElement>(form, 'input[name="amount"]');
  const submit = qs<HTMLButtonElement>(form, 'button[type="submit"]');
  const sync = (): void => {
    const value = (form.elements.namedItem('kind') as RadioNodeList).value;
    const kind: AdjustmentKind = KINDS.includes(value) ? (value as AdjustmentKind) : 'make_good';
    hint.textContent = HINT[kind];
    // A correction is a signed delta, not tied to one transaction.
    transaction.hidden = kind === 'correction';
    transactionInput.disabled = kind === 'correction';
    if (kind === 'correction') amount.removeAttribute('min');
    else amount.min = '1';
    submit.textContent = SUBMIT[kind];
    submit.className = `btn ${kind === 'refund' ? 'btn-danger' : 'btn-primary'}`;
  };
  form.addEventListener('change', sync);
  form.addEventListener('reset', () => globalThis.setTimeout(sync, 0));
  sync();
}
