// Grant rewards from simple fields, or raw JSON behind "Advanced (JSON)". The fields are rendered
// from the game's grant vocabulary (game-grants.ts): an amount field is a number input, a choice
// field a select of its options. Both paths are read with that vocabulary, so the confirm step
// never shows a grant the server refuses at mint. Used by Mint grant and the cohort grant.
import type { GrantReward } from '@foundation/contracts';
import {
  pluralOf,
  readGrant,
  rewardOf,
  type GrantField,
  type GrantVocabulary,
} from '../../games/grant-vocabulary.ts';
import { fmtInt } from './format.ts';
import { grantVocabulary } from './game-grants.ts';
import { el, replace } from './render.ts';
import { field as labelled, qs } from './ui.ts';
import { FormError, readForm, type FieldSpec } from './writes.ts';

/** What a field is called on the form: amounts by their plural (`Gems`), choices by their label. */
const fieldLabel = (f: GrantField): string => (f.kind === 'amount' ? pluralOf(f) : f.label);

/** The reward inputs of a vocabulary, read by field name (`gems`, `gold`). */
export function rewardFieldSpec(vocabulary: GrantVocabulary = grantVocabulary): FieldSpec[] {
  return vocabulary.fields.map((f) => ({
    name: f.name,
    label: fieldLabel(f),
    kind: f.kind === 'amount' ? 'optional-int' : 'optional-string',
  }));
}

// The reward inputs and the Advanced (JSON) switch. The hidden group is disabled, so only the
// visible one is read.
export const REWARD_SPEC: FieldSpec[] = [
  ...rewardFieldSpec(),
  { name: 'rewardsAdvanced', label: 'Advanced', kind: 'optional-bool' },
  { name: 'rewards', label: 'Rewards', kind: 'optional-string' },
];

/** Per vocabulary field name: the read input (a number, an option value, or empty). */
export type RewardFields = Record<string, unknown>;

function amount(v: unknown, label: string, max: number): number {
  if (v === undefined || v === '') return 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
    throw new FormError(`${label} must be a whole number ≥ 0.`);
  if (v > max) throw new FormError(`${label} must be at most ${fmtInt(max)}.`);
  return v;
}

/** Fields → rewards in vocabulary order (empty or 0 = none). Throws FormError. */
export function rewardsFromFields(
  f: RewardFields,
  vocabulary: GrantVocabulary = grantVocabulary,
): GrantReward[] {
  const rewards: GrantReward[] = [];
  for (const field of vocabulary.fields) {
    const v = f[field.name];
    if (field.kind === 'amount') {
      const n = amount(v, pluralOf(field), Math.min(field.max, Number.MAX_SAFE_INTEGER));
      if (n) rewards.push(rewardOf(field.reward, n));
      continue;
    }
    if (v === undefined || v === '') continue;
    const option = field.options.find((o) => o.value === v);
    if (!option) throw new FormError(`Unknown ${field.label.toLowerCase()} "${String(v)}".`);
    rewards.push(rewardOf(option.reward, 1));
  }
  if (!rewards.length) throw new FormError('Add at least one reward.');
  return rewards;
}

/**
 * The read reward inputs → `rewards` (fields, or the JSON when Advanced is on), checked the way
 * the game reads them. Other values pass through. Throws FormError.
 */
export function withRewards(
  values: Record<string, unknown>,
  vocabulary: GrantVocabulary = grantVocabulary,
): Record<string, unknown> {
  const { rewardsAdvanced, rewards: raw, ...rest } = values;
  const fields: RewardFields = {};
  for (const f of vocabulary.fields) {
    fields[f.name] = rest[f.name];
    delete rest[f.name];
  }
  let rewards: unknown;
  if (rewardsAdvanced) {
    if (typeof raw !== 'string' || !raw.trim()) throw new FormError('Rewards is required.');
    try {
      rewards = JSON.parse(raw);
    } catch {
      throw new FormError('Rewards must be valid JSON.');
    }
  } else rewards = rewardsFromFields(fields, vocabulary);
  const read = readGrant(vocabulary, rewards);
  if (!read.ok) throw new FormError(`Rewards: ${read.problem}.`);
  return { ...rest, rewards };
}

/** One input per vocabulary field: a number for an amount, a select (None + options) for a choice. */
function rewardInput(f: GrantField): HTMLLabelElement {
  const control =
    f.kind === 'amount'
      ? el('input', { name: f.name, type: 'number', min: '0', step: '1', placeholder: '0' })
      : el('select', { name: f.name }, [
          el('option', { value: '' }, ['None']),
          ...f.options.map((o) => el('option', { value: o.value }, [o.label])),
        ]);
  return labelled(fieldLabel(f), control, f.kind === 'amount' ? f.note : undefined);
}

/** Render a form's reward fields from the vocabulary and wire its Advanced (JSON) switch. */
export function bindRewardFields(
  form: HTMLFormElement,
  vocabulary: GrantVocabulary = grantVocabulary,
): void {
  const fields = qs(form, '[data-reward-fields]');
  const json = qs(form, '[data-reward-json]');
  const textarea = qs<HTMLTextAreaElement>(json, 'textarea');
  const advanced = qs<HTMLInputElement>(form, 'input[name="rewardsAdvanced"]');
  replace(fields, []);
  // A vocabulary field must not shadow one of the form's own inputs (reason, title, …).
  for (const f of vocabulary.fields)
    if (form.elements.namedItem(f.name))
      throw new Error(`grant field "${f.name}" collides with a ${form.id || 'form'} input`);
  replace(fields, vocabulary.fields.map(rewardInput));
  const spec = rewardFieldSpec(vocabulary);
  const sync = (): void => {
    const on = advanced.checked;
    fields.hidden = on;
    json.hidden = !on;
    for (const c of Array.from(
      fields.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'),
    ))
      c.disabled = on;
    textarea.disabled = !on;
  };
  advanced.addEventListener('change', () => {
    // Switching to JSON starts from what the fields hold (still enabled at this point).
    if (advanced.checked && !textarea.value.trim()) {
      try {
        textarea.value = JSON.stringify(rewardsFromFields(readForm(form, spec), vocabulary));
      } catch {
        // Nothing usable in the fields yet: start empty.
      }
    }
    sync();
  });
  form.addEventListener('reset', () => globalThis.setTimeout(sync, 0));
  sync();
}
