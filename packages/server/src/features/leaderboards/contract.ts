// leaderboards contract entry (isomorphic): schemas/types + pure rules (assessRun, name moderation).
export type {
  RunStartBody,
  RunSubmitBody,
  RunStartResult,
  RunSubmitResult,
  BoardTopResponse,
  BoardMeResponse,
  PlacementClaimBody,
  PlacementClaimResult,
  RunProof,
} from '@foundation/contracts';

export interface SeasonRules {
  status: 'draft' | 'active' | 'closed';
  rulesVersion: string;
  startsAt: number | null;
  endsAt: number | null;
  scoreMin: number;
  scoreMax: number;
  maxElapsedMs: number;
}

export type RunFailure =
  | 'season_inactive'
  | 'rules_mismatch'
  | 'score_out_of_range'
  | 'elapsed_out_of_range'
  | 'summary_bound';

/** Level 1 sanity + level 2 duration/summary bounds (lifted from Barrowdeep leaderboards.domain.ts). */
export function assessRun(
  season: SeasonRules,
  run: { score: number; elapsedMs: number; rulesVersion: string; summaryBound: number | null },
  now: number,
): { ok: true } | { ok: false; reason: RunFailure } {
  if (
    season.status !== 'active' ||
    (season.startsAt !== null && now < season.startsAt) ||
    (season.endsAt !== null && now >= season.endsAt)
  )
    return { ok: false, reason: 'season_inactive' };
  if (run.rulesVersion !== season.rulesVersion) return { ok: false, reason: 'rules_mismatch' };
  if (
    !Number.isSafeInteger(run.score) ||
    run.score < season.scoreMin ||
    run.score > season.scoreMax
  )
    return { ok: false, reason: 'score_out_of_range' };
  if (!Number.isFinite(run.elapsedMs) || run.elapsedMs < 1 || run.elapsedMs > season.maxElapsedMs)
    return { ok: false, reason: 'elapsed_out_of_range' };
  if (run.summaryBound !== null && run.score > run.summaryBound)
    return { ok: false, reason: 'summary_bound' };
  return { ok: true };
}

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
};
const BLOCKED_SUBSTRINGS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'cunt',
  'dick',
  'piss',
  'whore',
  'slut',
  'cock',
  'pussy',
  'twat',
  'faggot',
  'nigger',
  'nigga',
  'chink',
  'kike',
  'tranny',
  'rape',
  'hitler',
  'porn',
  'penis',
  'vagina',
  'orgasm',
  'douche',
];
const BLOCKED_WORDS = new Set([
  'ass',
  'sex',
  'cum',
  'tit',
  'crap',
  'damn',
  'hell',
  'fag',
  'gook',
  'spic',
  'retard',
  'nazi',
  'anal',
  'boob',
]);

function foldWord(word: string): string {
  let out = '';
  for (const ch of word.toLowerCase()) out += LEET[ch] ?? ch;
  return out.replace(/[^a-z]/g, '');
}
function blocked(name: string): boolean {
  return name.split(/\s+/).some((w) => {
    const f = foldWord(w);
    return BLOCKED_WORDS.has(f) || BLOCKED_SUBSTRINGS.some((r) => f.includes(r));
  });
}
/** Deterministic, non-cryptographic fallback suffix (browser-safe). */
function fallbackName(playerKey: string): string {
  let h = 2166136261;
  for (let i = 0; i < playerKey.length; i++)
    h = Math.imul(h ^ playerKey.charCodeAt(i), 16777619) >>> 0;
  return `Player ${h.toString(16).padStart(8, '0').slice(0, 4).toUpperCase()}`;
}
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
/** Every submitted display name is untrusted: NFKC, control chars stripped, ≤ 24 chars, profanity → fallback. */
export function normalizeDisplayName(raw: string | undefined, playerKey: string): string {
  const clean =
    typeof raw === 'string'
      ? raw
          .normalize('NFKC')
          .replace(CONTROL_CHARS, '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 24)
          .trim()
      : '';
  return clean && !blocked(clean) ? clean : fallbackName(playerKey);
}
