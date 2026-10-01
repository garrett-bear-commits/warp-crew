// A game's grant reward vocabulary: the rewards a support or cohort grant may carry so the game
// can apply them. Each game declares one in games/<id>/grants.ts; its policy refuses anything
// else at mint time (GamePolicy.grantRewardProblem), and the admin inspector and admin CLI build
// their reward fields from it, so an operator never confirms a grant the server would refuse.
// Plain erasable TypeScript with type-only imports, so the CLI can import it under Node 24 and
// the inspector can bundle it.
import type { GrantReward } from '@foundation/contracts';

/** The reward a field produces, without its amount. */
export type GrantRewardTemplate =
  | { kind: 'premium_currency' }
  | { kind: 'soft_currency'; currency: string }
  | { kind: 'item'; itemId: string };

/** A number of one reward: `+100 Gems`. */
export interface GrantAmountField {
  kind: 'amount';
  /** Form field and CLI flag name (`--gems`). */
  name: string;
  /** Singular display label (`Gem`); `plural` defaults to label + 's'. */
  label: string;
  plural?: string;
  /** Shown after the amount in plans, e.g. `free` for earned premium currency. */
  note?: string;
  /** Total one grant may carry over every reward of this field. */
  max: number;
  reward: GrantRewardTemplate;
}

/** One of a fixed set of rewards, one per pick: `1 Premium contract`. */
export interface GrantChoiceField {
  kind: 'choice';
  name: string;
  label: string;
  plural?: string;
  /** Picks one grant may carry over every option. */
  max: number;
  options: readonly { value: string; label: string; reward: GrantRewardTemplate }[];
}

export type GrantField = GrantAmountField | GrantChoiceField;

export interface GrantVocabulary {
  /** In display and reward order. */
  fields: readonly GrantField[];
  /** What the game calls its premium currency (purchase adjustments credit it): `gems`. */
  premiumName: string;
}

/** Per field name: an amount total, or one option value per pick. */
export type GrantContents = Record<string, number | string[]>;

export type GrantRead = { ok: true; contents: GrantContents } | { ok: false; problem: string };

const MAX_REWARDS = 20;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

/** The reward for `amount` of a template. */
export function rewardOf(template: GrantRewardTemplate, amount: number): GrantReward {
  switch (template.kind) {
    case 'premium_currency':
      return { kind: 'premium_currency', amount };
    case 'soft_currency':
      return { kind: 'soft_currency', currency: template.currency, amount };
    case 'item':
      return { kind: 'item', itemId: template.itemId, qty: amount };
  }
}

/** The amount a reward carries when it is exactly `template` plus an amount; null otherwise. */
function amountFor(template: GrantRewardTemplate, reward: Record<string, unknown>): unknown {
  if (reward.kind !== template.kind) return null;
  const keys = Object.keys(reward).length;
  switch (template.kind) {
    case 'premium_currency':
      return keys === 2 && 'amount' in reward ? reward.amount : null;
    case 'soft_currency':
      return keys === 3 && reward.currency === template.currency && 'amount' in reward
        ? reward.amount
        : null;
    case 'item':
      return keys === 3 && reward.itemId === template.itemId && 'qty' in reward ? reward.qty : null;
  }
}

export const pluralOf = (field: { label: string; plural?: string }): string =>
  field.plural ?? `${field.label}s`;

/**
 * The game's reading of a grant's rewards, or why it cannot apply them. A grant applies whole or
 * not at all: one reward outside the vocabulary refuses every reward in it.
 */
export function readGrant(vocabulary: GrantVocabulary, rewards: unknown): GrantRead {
  if (!Array.isArray(rewards) || rewards.length === 0) return { ok: false, problem: 'no rewards' };
  if (rewards.length > MAX_REWARDS)
    return { ok: false, problem: `more than ${MAX_REWARDS} rewards` };
  const contents: GrantContents = {};
  for (const [index, reward] of rewards.entries()) {
    const at = `reward ${index + 1}`;
    if (!record(reward)) return { ok: false, problem: `${at} is not an object` };
    let matched = false;
    for (const field of vocabulary.fields) {
      if (field.kind === 'amount') {
        const amount = amountFor(field.reward, reward);
        if (amount === null) continue;
        if (!positive(amount))
          return {
            ok: false,
            problem: `${at}: ${pluralOf(field).toLowerCase()} must be at least 1`,
          };
        contents[field.name] = ((contents[field.name] as number | undefined) ?? 0) + amount;
        matched = true;
        break;
      }
      const option = field.options.find((o) => amountFor(o.reward, reward) !== null);
      if (!option) continue;
      const qty = amountFor(option.reward, reward);
      if (!positive(qty)) return { ok: false, problem: `${at}: qty must be at least 1` };
      if (qty > field.max)
        return { ok: false, problem: `more than ${field.max} ${pluralOf(field).toLowerCase()}` };
      const picks = (contents[field.name] as string[] | undefined) ?? [];
      for (let n = 0; n < qty; n++) picks.push(option.value);
      contents[field.name] = picks;
      matched = true;
      break;
    }
    if (!matched) {
      const what =
        reward.kind === 'soft_currency'
          ? `currency "${String(reward.currency)}"`
          : reward.kind === 'item'
            ? `item "${String(reward.itemId)}"`
            : `kind "${String(reward.kind)}"`;
      return { ok: false, problem: `${at}: unsupported ${what}` };
    }
  }
  for (const field of vocabulary.fields) {
    const got = contents[field.name];
    const total = Array.isArray(got) ? got.length : (got ?? 0);
    if (total > field.max)
      return { ok: false, problem: `more than ${field.max} ${pluralOf(field).toLowerCase()}` };
  }
  return { ok: true, contents };
}

/** Why the game cannot apply these rewards, or null (GamePolicy.grantRewardProblem). */
export function grantProblem(vocabulary: GrantVocabulary, rewards: unknown): string | null {
  const read = readGrant(vocabulary, rewards);
  return read.ok ? null : read.problem;
}

const fmt = (value: number) => value.toLocaleString('en-US');

/** One line for plans and confirmations: `+100 Gems (free) · +5,000 Gold · 1 Premium contract`. */
export function grantContentsText(vocabulary: GrantVocabulary, contents: GrantContents): string {
  const parts: string[] = [];
  for (const field of vocabulary.fields) {
    const got = contents[field.name];
    if (field.kind === 'amount') {
      if (typeof got !== 'number' || !got) continue;
      const label = got === 1 ? field.label : pluralOf(field);
      parts.push(`+${fmt(got)} ${label}${field.note ? ` (${field.note})` : ''}`);
      continue;
    }
    if (!Array.isArray(got) || !got.length) continue;
    const counts = new Map<string, number>();
    for (const value of got) counts.set(value, (counts.get(value) ?? 0) + 1);
    for (const [value, count] of counts) {
      const option = field.options.find((o) => o.value === value)?.label ?? value;
      parts.push(`${count} ${option} ${count === 1 ? field.label : pluralOf(field)}`);
    }
  }
  return parts.join(' · ');
}
