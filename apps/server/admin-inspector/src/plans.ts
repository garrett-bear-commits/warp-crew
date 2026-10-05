// Pure text for the inspector: the restore plan (modelled on the admin CLI's dry run), the
// confirmation summary shown before every write, readable results and failure messages.
import type { ErrorEnvelope, PlayerOverview, SnapshotMeta } from '@foundation/contracts';
import {
  grantContentsText,
  readGrant,
  type GrantVocabulary,
} from '../../games/grant-vocabulary.ts';
import { describeFailure } from './api.ts';
import type { EnvKind } from './env.ts';
import { absTime, fmtInt, humanize } from './format.ts';
import { grantVocabulary } from './game-grants.ts';

type Payload = Record<string, unknown>;
type Failure = { status: number; error: ErrorEnvelope | null };

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : String(v));

function clip(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ─── Restore plan ──────────────────────────────────────────────────

export interface RestorePlan {
  /** "generation G, anchor seq S · progress P" */
  readonly now: string;
  /** "seq T · generation g · progress p · anchored · saved …" */
  readonly target: string;
  /** "opens generation G+1 seeded from seq T; generation G is kept" */
  readonly effect: string;
  readonly note: string;
  /** Why the restore cannot run; null when it can. */
  readonly refusal: string | null;
  readonly expectedGeneration: number;
}

export function dispositionLabel(d: string): string {
  if (d === 'stored_quarantined') return 'quarantined';
  if (d === 'stored_refused') return 'refused';
  return humanize(d);
}

export function restorePlan(
  overview: Pick<PlayerOverview, 'generation' | 'anchor' | 'erased'>,
  target: Pick<
    SnapshotMeta,
    'seq' | 'generation' | 'progress' | 'disposition' | 'savedAt' | 'hasBlob'
  >,
): RestorePlan {
  const g = overview.generation;
  const anchor = overview.anchor;
  const now = anchor
    ? `generation ${g}, anchor seq ${anchor.seq} · progress ${anchor.progress}`
    : `generation ${g}, no anchored save`;
  const saved = absTime(target.savedAt);
  const targetText = [
    `seq ${target.seq}`,
    `generation ${target.generation}`,
    `progress ${target.progress}`,
    dispositionLabel(target.disposition),
    ...(saved ? [`saved ${saved}`] : []),
  ].join(' · ');
  let refusal: string | null = null;
  if (overview.erased) refusal = 'The player is erased.';
  else if (!target.hasBlob) refusal = `Save seq ${target.seq} is pruned; it cannot seed a restore.`;
  return {
    now,
    target: targetText,
    effect: `opens generation ${g + 1} seeded from seq ${target.seq}; generation ${g} is kept`,
    note: 'A running game adopts it on its next save push, any other on its next start.',
    refusal,
    expectedGeneration: g,
  };
}

/** The plan as the CLI prints it (also the dialog's copyable text). */
export function restorePlanText(p: RestorePlan): string {
  return [`now: ${p.now}`, `target: ${p.target}`, `effect: ${p.effect}`].join('\n');
}

// ─── Write summaries (shown before every POST) ─────────────────────

export type WriteKind =
  | 'letter'
  | 'grant'
  | 'adjustPurchase'
  | 'playerFlag'
  | 'publishFlag'
  | 'publishContent'
  | 'cohortGrant'
  | 'restore'
  | 'saveReview'
  | 'replay';

export interface WriteSummary {
  readonly title: string;
  readonly rows: ReadonlyArray<readonly [string, string]>;
  readonly danger: boolean;
  readonly confirm: string;
}

/** What the confirm step states but the write does not send. */
export interface PlanFacts {
  /** Refund strikes the loaded player already has; undefined when the overview did not load. */
  readonly strikes?: number | undefined;
}

/** "+100 Gems (free) · +5,000 Gold" for rewards the game applies; a raw listing for anything else. */
export function rewardsText(
  rewards: unknown,
  vocabulary: GrantVocabulary = grantVocabulary,
): string {
  const read = readGrant(vocabulary, rewards);
  if (read.ok) return grantContentsText(vocabulary, read.contents);
  if (!Array.isArray(rewards)) return clip(JSON.stringify(rewards) ?? '');
  return rewards
    .map((r: Record<string, unknown>) => {
      switch (r?.kind) {
        case 'soft_currency':
          return `${fmtInt(r.amount)} ${str(r.currency)}`;
        case 'premium_currency':
          return `${fmtInt(r.amount)} premium`;
        case 'item':
          return `${fmtInt(r.qty)} × ${str(r.itemId)}`;
        case 'cosmetic':
          return `cosmetic ${str(r.cosmeticId)}`;
        default:
          return clip(JSON.stringify(r) ?? '', 80);
      }
    })
    .join(', ');
}

function optional(label: string, v: unknown): Array<readonly [string, string]> {
  const s = str(v).trim();
  return s ? [[label, clip(s)]] : [];
}

function when(label: string, v: unknown, none: string): Array<readonly [string, string]> {
  return [[label, typeof v === 'number' ? absTime(v) : none]];
}

/** What the game calls the premium currency an adjustment moves (`gems`). */
const PREMIUM = grantVocabulary.premiumName;

const ADJUSTMENT_TITLE: Record<string, string> = {
  make_good: 'Credit a purchase',
  refund: 'Refund a purchase',
  correction: `Correct ${PREMIUM}`,
};
const ADJUSTMENT_CONFIRM: Record<string, string> = {
  make_good: `Credit ${PREMIUM}`,
  refund: 'Refund',
  correction: 'Apply correction',
};

/**
 * The adjustment's effect: a signed amount of premium currency, delivered to the game as a
 * pending adjustment it applies (and acks) when it next starts. Only a refund adds a strike.
 */
function adjustmentEffect(kind: string, delta: number): string {
  const n = fmtInt(Math.abs(delta));
  const sign = delta >= 0 ? '+' : '−';
  const strike = kind === 'correction' && delta < 0 ? '; no strike' : '';
  return `${sign}${n} ${PREMIUM} (${humanize(kind)}), applied when the game next starts${strike}`;
}

/** The server adds a strike per refund and turns purchases off at the 3rd. */
function strikeText(strikes: number | undefined): string {
  const off = 'the 3rd strike turns purchases off (purchases_disabled)';
  if (strikes === undefined) return `Adds a refund strike; ${off}`;
  const n = strikes + 1;
  return n >= 3 ? `Adds a refund strike (${n}/3); ${off}` : `Adds a refund strike (${n}/3)`;
}

export function writeSummary(kind: WriteKind, p: Payload, facts: PlanFacts = {}): WriteSummary {
  const pk = str(p.playerKey);
  const reason: readonly [string, string] = ['Reason', clip(str(p.reason))];
  switch (kind) {
    case 'letter':
      return {
        title: `Send a letter to ${pk}`,
        rows: [
          ['Title', clip(str(p.title))],
          ['Body', clip(str(p.body))],
          ...optional('Grant key', p.grantKey),
          ...optional('Ticket', p.ticketRef),
          reason,
        ],
        danger: false,
        confirm: 'Send letter',
      };
    case 'grant':
      return {
        title: `Mint a grant for ${pk}`,
        rows: [
          ['Grant key', str(p.grantKey)],
          ['Rewards', rewardsText(p.rewards)],
          ...optional('Title', p.title),
          ...optional('Body', p.body),
          ...(typeof p.expiresAt === 'number' ? when('Expires', p.expiresAt, '') : []),
          ...optional('Ticket', p.ticketRef),
          reason,
        ],
        danger: false,
        confirm: 'Mint grant',
      };
    case 'adjustPurchase': {
      const k = str(p.kind);
      const delta = typeof p.delta === 'number' ? p.delta : 0;
      return {
        title: ADJUSTMENT_TITLE[k] ?? 'Fix a purchase',
        rows: [
          ['Player', pk],
          ['Effect', adjustmentEffect(k, delta)],
          ...(k === 'refund' ? [['Strike', strikeText(facts.strikes)] as const] : []),
          ...optional('Transaction', p.transactionId),
          ...optional('Ticket', p.ticketRef),
          reason,
        ],
        danger: delta < 0,
        confirm: ADJUSTMENT_CONFIRM[k] ?? 'Apply',
      };
    }
    case 'playerFlag':
      return {
        title: `${p.enabled ? 'Set' : 'Clear'} ${str(p.flag)} for ${pk}`,
        rows: [
          ['Flag', str(p.flag)],
          ['State', p.enabled ? 'On' : 'Off'],
          ...(p.enabled ? when('Until', p.until, 'No end') : []),
          reason,
        ],
        danger: false,
        confirm: p.enabled ? 'Set flag' : 'Clear flag',
      };
    case 'publishFlag':
      return {
        title: `Publish flag ${str(p.key)}`,
        rows: [
          ['Value', JSON.stringify(p.value) ?? ''],
          ['Enabled', p.enabled ? 'Yes' : 'No'],
          ['Rollout', `${str(p.rolloutPercent)}%`],
          ['Segment', str(p.segmentId) || 'Everyone'],
          ...(p.shadow ? [['Shadow', 'Yes'] as const] : []),
          reason,
        ],
        danger: false,
        confirm: 'Publish flag',
      };
    case 'publishContent': {
      const doc = JSON.stringify(p.document) ?? '';
      return {
        title: `Publish ${str(p.kind)} to ${str(p.env)}`,
        rows: [
          ['Kind', str(p.kind)],
          ['Environment', str(p.env)],
          ['Document', `${fmtInt(doc.length)} chars · ${clip(doc, 80)}`],
          ...optional('Min build', p.minBuildVersion),
          reason,
        ],
        danger: p.env === 'prod',
        confirm: 'Publish content',
      };
    }
    case 'cohortGrant':
      return {
        title: p.dryRun ? 'Dry-run a cohort grant' : 'Mint a cohort grant',
        rows: [
          [
            'Mode',
            p.dryRun ? 'Dry run: counts matches, mints nothing' : 'Live: mints for every match',
          ],
          ['Key prefix', str(p.grantKeyPrefix)],
          ['Segment', clip(JSON.stringify(p.predicate) ?? '', 120)],
          ['Rewards', rewardsText(p.rewards)],
          ...optional('Title', p.title),
          ...optional('Ticket', p.ticketRef),
          reason,
        ],
        danger: !p.dryRun,
        confirm: p.dryRun ? 'Run dry run' : 'Mint for cohort',
      };
    case 'restore':
      return {
        title: `Restore ${pk} to seq ${str(p.seq)}`,
        rows: [['Expected generation', str(p.expectedGeneration)], reason],
        danger: true,
        confirm: 'Restore',
      };
    case 'saveReview':
      return {
        title: `${p.action === 'reject' ? 'Reject' : 'Promote'} quarantined seq ${str(p.seq)}`,
        rows: [['Player', pk], ['Decision', str(p.action)], reason],
        danger: true,
        confirm: 'Submit final review',
      };
    case 'replay':
      return {
        title: `Replay outbox #${str(p.outboxId)}`,
        rows: [['Consumer', str(p.consumer)], reason],
        danger: false,
        confirm: 'Replay',
      };
  }
}

// ─── Results ───────────────────────────────────────────────────────

export function resultMessage(kind: WriteKind, body: unknown, p: Payload): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const dup = b.duplicate ? ' (already applied)' : '';
  switch (kind) {
    case 'letter':
      return `Letter sent to ${str(p.playerKey)}.`;
    case 'grant':
      return b.duplicate
        ? `Grant ${str(b.grantKey ?? p.grantKey)} already existed; nothing new minted.`
        : `Grant ${str(b.grantKey ?? p.grantKey)} minted for ${str(p.playerKey)}.`;
    case 'adjustPurchase':
      return b.duplicate
        ? `Adjustment #${str(b.adjustmentId)} was already recorded; nothing changed.`
        : `Adjustment #${str(b.adjustmentId)} recorded for ${str(p.playerKey)}.`;
    case 'playerFlag':
      return `${str(p.flag)} ${p.enabled ? 'set' : 'cleared'} for ${str(p.playerKey)}.`;
    case 'publishFlag':
      return `Flag ${str(p.key)} published as version ${str(b.version)}${dup}.`;
    case 'publishContent':
      return `${str(p.kind)} (${str(p.env)}) published as version ${str(b.version)}${dup}.`;
    case 'cohortGrant':
      return b.dryRun
        ? `Dry run: ${fmtInt(b.matched)} players match. Nothing minted.`
        : `Minted ${fmtInt(b.minted)} grants for ${fmtInt(b.matched)} matching players${dup}.`;
    case 'restore':
      return `Generation ${str(b.generation)} opened from seq ${str(b.seedSeq ?? p.seq)}${dup}.`;
    case 'saveReview':
      switch (b.outcome) {
        case 'promoted':
          return `Seq ${str(p.seq)} promoted${typeof b.anchorSeq === 'number' ? `; anchor is seq ${b.anchorSeq}` : ''}${dup}.`;
        case 'rejected':
          return `Seq ${str(p.seq)} rejected${dup}.`;
        case 'review_final':
          return `Seq ${str(p.seq)} was already reviewed; reviews are final.`;
        case 'not_eligible':
          return `Seq ${str(p.seq)} is not eligible for review.`;
        case 'not_found':
          return `Seq ${str(p.seq)} was not found.`;
        default:
          return 'Review recorded.';
      }
    case 'replay':
      return `Outbox #${str(p.outboxId)} re-queued for ${str(p.consumer)}${dup}.`;
  }
}

// ─── Failures ──────────────────────────────────────────────────────

const ACCESS_EXPIRED = 'Access session expired. Reload the page to sign in again.';

function reasonOf(error: ErrorEnvelope | null): string {
  const d = error?.details as { reason?: unknown } | undefined;
  return typeof d?.reason === 'string' ? d.reason : '';
}

/** Cloudflare Access refused (its own 401/403 page, or the API's cf_access_* refusal). */
export function isAccessRefusal(r: Failure): boolean {
  if (r.status === 403 && reasonOf(r.error).startsWith('cf_access')) return true;
  return (r.status === 401 || r.status === 403) && r.error === null;
}

function networkMessage(env: EnvKind): string {
  // Behind Access an expired session turns every call into a blocked cross-origin redirect.
  return env === 'production' || env === 'unknown'
    ? 'No response. If your Access session expired, reload the page to sign in again.'
    : 'No response from the admin API.';
}

export function signInError(r: Failure, env: EnvKind): string {
  if (r.status === 0) return networkMessage(env);
  if (isAccessRefusal(r)) return ACCESS_EXPIRED;
  if (r.status === 401) return 'Key ID or secret not accepted.';
  if (r.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (r.status === 404) return 'This API has no sign-in endpoint yet. Deploy the API first.';
  if (r.status >= 500) return 'The admin API is unavailable. Try again shortly.';
  return describeFailure(r);
}

export function failureMessage(r: Failure, env: EnvKind): string {
  if (r.status === 0) return networkMessage(env);
  if (isAccessRefusal(r)) return ACCESS_EXPIRED;
  const code = r.error?.error;
  if (r.status === 401) return 'This key is no longer accepted. Sign out and sign in again.';
  if (r.status === 403 && code === 'forbidden') {
    const required = (r.error?.details as { required?: unknown } | undefined)?.required;
    return typeof required === 'string'
      ? `Not allowed: needs the ${required} scope.`
      : 'Not allowed for this key.';
  }
  if (r.status === 409 && code === 'stale_generation')
    return 'The generation changed since this player loaded. Reload and try again.';
  if (r.status === 404) return r.error?.message ? `Not found: ${r.error.message}.` : 'Not found.';
  if (r.status === 429) return 'Rate limited. Wait a moment and try again.';
  return describeFailure(r);
}
