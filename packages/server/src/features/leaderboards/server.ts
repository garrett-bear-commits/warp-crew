// leaderboards feature (§4.3, §7): seasons on the schedule primitive, rules_version pin, run_id
// idempotency, leaderboards.start stamps started_at + seed, visibility enum + quarantine for
// top-N until review, verification levels (1 sanity, 2 duration+summary bounds, 3 replay =
// interface only), placements minted provisional, moderated names, close ignores quarantined and
// boards_hidden.
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import {
  RunStartBody,
  RunSubmitBody,
  PlacementClaimBody,
  DisplayNameBody,
  SeasonUpsertBody,
  SubmissionReviewBody,
  type RunStartResult,
  type RunSubmitResult,
  type PlacementClaimResult,
  type DisplayNameResult,
  type BoardTopResponse,
  type BoardMeResponse,
  type PublishReceipt,
  type GrantReward,
} from '@foundation/contracts';
import { Type } from '@sinclair/typebox';
import { defineCommand } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import type { Q, Tx } from '../../db/index.ts';
import { mintGrant } from '../../rewards/mint.ts';
import { actorLabel } from '../../cqrs/bus.ts';
import { assessRun, normalizeDisplayName, type SeasonRules } from './contract.ts';

type StartRes = Omit<RunStartResult, 'serverNow' | 'requestId'>;
type SubmitRes = Omit<RunSubmitResult, 'serverNow' | 'requestId'>;
type ClaimRes = Omit<PlacementClaimResult, 'serverNow' | 'requestId'>;
type NameRes = Omit<DisplayNameResult, 'serverNow' | 'requestId'>;
type Receipt = Omit<PublishReceipt, 'serverNow' | 'requestId'>;

/** Route params (board) are folded into the command payload so the schema stays closed. */
const RunStartCommand = Type.Object(
  { ...RunStartBody.properties, board: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);
const RunSubmitCommand = Type.Object(
  { ...RunSubmitBody.properties, board: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);

export const BoardStart = defineCommand<typeof RunStartCommand, StartRes>({
  type: 'boards.start',
  schema: RunStartCommand,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'boards',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const BoardSubmit = defineCommand<typeof RunSubmitCommand, SubmitRes>({
  type: 'boards.submit',
  schema: RunSubmitCommand,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'boards',
  replay: {
    fromStored: (r) => ({
      ...r,
      outcome: r.outcome.startsWith('accepted') ? 'duplicate' : r.outcome,
    }),
  },
});
export const PlacementClaim = defineCommand<typeof PlacementClaimBody, ClaimRes>({
  type: 'boards.claimPlacement',
  schema: PlacementClaimBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'boards',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const SetDisplayName = defineCommand<typeof DisplayNameBody, NameRes>({
  type: 'boards.setName',
  schema: DisplayNameBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '7d' },
  tx: 'required',
  limit: 'boards',
});
export const SeasonUpsert = defineCommand<typeof SeasonUpsertBody, Receipt>({
  type: 'boards.upsertSeason',
  schema: SeasonUpsertBody,
  actorPolicy: { admin: 'publish' },
  scope: 'game',
  lock: 'game',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const SubmissionReview = defineCommand<typeof SubmissionReviewBody, { ok: true }>({
  type: 'boards.reviewSubmission',
  schema: SubmissionReviewBody,
  actorPolicy: { admin: 'support' },
  scope: 'game',
  lock: 'game',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
});

interface SeasonRow {
  board_key: string;
  season_key: string;
  rules_version: string;
  status: 'draft' | 'active' | 'closed';
  starts_at: Date | null;
  ends_at: Date | null;
  score_min: string;
  score_max: string;
  max_elapsed_ms: string;
  quarantine_top_n: number;
  rewards: Array<{ upTo: number; rewards: GrantReward[] }> | null;
}
const rules = (s: SeasonRow): SeasonRules => ({
  status: s.status,
  rulesVersion: s.rules_version,
  startsAt: s.starts_at?.getTime() ?? null,
  endsAt: s.ends_at?.getTime() ?? null,
  scoreMin: Number(s.score_min),
  scoreMax: Number(s.score_max),
  maxElapsedMs: Number(s.max_elapsed_ms),
});

async function activeSeason(q: Q, board: string, now: number): Promise<SeasonRow | null> {
  const rows = await q<
    SeasonRow[]
  >`SELECT * FROM leaderboard_seasons WHERE board_key = ${board} AND status = 'active' AND (starts_at IS NULL OR starts_at <= ${new Date(now)}) AND (ends_at IS NULL OR ends_at > ${new Date(now)}) ORDER BY starts_at DESC NULLS LAST LIMIT 1`;
  return rows[0] ?? null;
}
async function latestSeason(q: Q, board: string): Promise<SeasonRow | null> {
  const rows = await q<
    SeasonRow[]
  >`SELECT * FROM leaderboard_seasons WHERE board_key = ${board} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, starts_at DESC NULLS LAST LIMIT 1`;
  return rows[0] ?? null;
}

/** Visible best per player (submissions visible or approved via review, not rejected/hidden). */
async function rebuildEntries(tx: Tx, board: string, season: string): Promise<number> {
  await tx`DELETE FROM leaderboard_entries WHERE board_key = ${board} AND season_key = ${season}`;
  const r = await tx`
    INSERT INTO leaderboard_entries (board_key, season_key, player_key, best_submission_id, score, elapsed_ms)
    SELECT DISTINCT ON (s.player_key) s.board_key, s.season_key, s.player_key, s.id, s.score, s.elapsed_ms
    FROM leaderboard_submissions s LEFT JOIN leaderboard_reviews r ON r.submission_id = s.id
    WHERE s.board_key = ${board} AND s.season_key = ${season}
      AND ((s.visibility = 'visible' AND r.action IS DISTINCT FROM 'reject') OR (s.visibility = 'quarantined' AND r.action = 'approve'))
      AND NOT EXISTS (SELECT 1 FROM player_flags f WHERE f.player_key = s.player_key AND f.flag = 'boards_hidden' AND f.enabled AND (f.until IS NULL OR f.until > now()))
    ORDER BY s.player_key, s.score DESC, s.elapsed_ms ASC, s.id ASC`;
  return r.count;
}

async function rankOf(
  q: Q,
  board: string,
  season: string,
  playerKey: string,
): Promise<number | null> {
  const rows = await q<
    { rank: string }[]
  >`SELECT rank FROM (SELECT player_key, row_number() OVER (ORDER BY score DESC, elapsed_ms ASC, updated_at ASC) AS rank FROM leaderboard_entries WHERE board_key = ${board} AND season_key = ${season}) x WHERE player_key = ${playerKey}`;
  return rows[0] ? Number(rows[0].rank) : null;
}

export function registerLeaderboards(app: FastifyInstance, ctx: AppContext): void {
  const { bus, game } = ctx;
  ctx.declaredCommands.push(
    BoardStart,
    BoardSubmit,
    PlacementClaim,
    SetDisplayName,
    SeasonUpsert,
    SubmissionReview,
  );
  const boardCfg = (key: string) => game.boards.find((b) => b.boardKey === key);

  bus.register(BoardStart, async (input, exec, tx) => {
    const t = tx!;
    const board = input.board;
    if (!boardCfg(board)) throw new AppError('not_found', 'unknown board');
    const season = await activeSeason(t, board, exec.now);
    if (!season) throw new AppError('not_found', 'no active season', { board });
    const existing = await t<
      {
        run_id: string;
        season_key: string;
        rules_version: string;
        seed: string;
        started_at: Date;
      }[]
    >`SELECT run_id, season_key, rules_version, seed, started_at FROM leaderboard_runs WHERE run_id = ${input.runId}`;
    if (existing[0])
      return {
        runId: input.runId,
        seasonKey: existing[0].season_key,
        rulesVersion: existing[0].rules_version,
        startedAt: existing[0].started_at.getTime(),
        seed: existing[0].seed,
        duplicate: true,
      };
    const seed = createHash('sha256')
      .update(`${input.runId}:${randomBytes(8).toString('hex')}`)
      .digest('hex')
      .slice(0, 32);
    await t`INSERT INTO leaderboard_runs (run_id, board_key, season_key, player_key, seed, rules_version, started_at, command_id) VALUES (${input.runId}, ${board}, ${season.season_key}, ${exec.playerKey!}, ${seed}, ${season.rules_version}, ${new Date(exec.now)}, ${input.commandId})`;
    return {
      runId: input.runId,
      seasonKey: season.season_key,
      rulesVersion: season.rules_version,
      startedAt: exec.now,
      seed,
      duplicate: false,
    };
  });

  bus.register(BoardSubmit, async (input, exec, tx): Promise<SubmitRes> => {
    const t = tx!;
    const board = input.board;
    const cfg = boardCfg(board);
    if (!cfg) throw new AppError('not_found', 'unknown board');
    const hidden = await t<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM player_flags WHERE player_key = ${exec.playerKey!} AND flag = 'boards_hidden' AND enabled AND (until IS NULL OR until > ${new Date(exec.now)})`;
    if ((hidden[0]?.n ?? 0) > 0) return { outcome: 'rejected_boards_hidden' };
    const run = await t<
      {
        run_id: string;
        board_key: string;
        season_key: string;
        player_key: string;
        started_at: Date;
        rules_version: string;
      }[]
    >`SELECT run_id, board_key, season_key, player_key, started_at, rules_version FROM leaderboard_runs WHERE run_id = ${input.runId}`;
    if (!run[0] || run[0].player_key !== exec.playerKey || run[0].board_key !== board)
      return { outcome: 'rejected_unknown_run' };
    const already = await t<
      { id: string }[]
    >`SELECT id FROM leaderboard_submissions WHERE run_id = ${input.runId}`;
    if (already[0]) return { outcome: 'duplicate' };
    const season = await t<
      SeasonRow[]
    >`SELECT * FROM leaderboard_seasons WHERE board_key = ${board} AND season_key = ${run[0].season_key}`;
    if (!season[0]) return { outcome: 'rejected_season_inactive' };
    const elapsedMs = exec.now - run[0].started_at.getTime(); // server-observed duration
    const summaryBound =
      cfg.summaryBound && input.summary
        ? (input.summary[cfg.summaryBound.key] ?? 0) * cfg.summaryBound.factor
        : null;
    const a = assessRun(
      rules(season[0]),
      { score: input.score, elapsedMs, rulesVersion: run[0].rules_version, summaryBound },
      exec.now,
    );
    if (!a.ok) {
      const map = {
        season_inactive: 'rejected_season_inactive',
        rules_mismatch: 'rejected_rules_mismatch',
        score_out_of_range: 'rejected_out_of_range',
        elapsed_out_of_range: 'rejected_duration',
        summary_bound: 'rejected_out_of_range',
      } as const;
      return { outcome: map[a.reason] };
    }
    const level = input.summary ? 2 : 1;
    // quarantine top-N until review: would this score land in the top N among all accepted (not rejected) submissions?
    const better = await t<
      { n: number }[]
    >`SELECT count(DISTINCT s.player_key)::int AS n FROM leaderboard_submissions s LEFT JOIN leaderboard_reviews r ON r.submission_id = s.id
      WHERE s.board_key = ${board} AND s.season_key = ${season[0].season_key} AND s.player_key <> ${exec.playerKey!}
        AND r.action IS DISTINCT FROM 'reject' AND s.visibility IN ('visible', 'quarantined')
        AND (s.score > ${input.score} OR (s.score = ${input.score} AND s.elapsed_ms < ${elapsedMs}))`;
    const provisionalRank = (better[0]?.n ?? 0) + 1;
    const visibility = provisionalRank <= season[0].quarantine_top_n ? 'quarantined' : 'visible';
    await t`INSERT INTO leaderboard_submissions (run_id, board_key, season_key, player_key, score, elapsed_ms, summary, proof, verification_level, visibility, command_id)
      VALUES (${input.runId}, ${board}, ${season[0].season_key}, ${exec.playerKey!}, ${input.score}, ${elapsedMs}, ${input.summary ? t.json(input.summary as never) : null}, ${input.proof ? t.json(input.proof as never) : null}, ${level}, ${visibility}, ${input.commandId})`;
    await rebuildEntries(t, board, season[0].season_key);
    const rank =
      visibility === 'visible'
        ? await rankOf(t, board, season[0].season_key, exec.playerKey!)
        : null;
    return {
      outcome: visibility === 'quarantined' ? 'accepted_quarantined' : 'accepted',
      visibility,
      ...(rank !== null ? { rank } : { rank: provisionalRank }),
      verificationLevel: level,
    };
  });

  bus.register(PlacementClaim, async (input, exec, tx): Promise<ClaimRes> => {
    const t = tx!;
    const p = await t<
      {
        receipt_id: string;
        state: 'provisional' | 'confirmed' | 'voided';
        grant_key: string | null;
        player_key: string;
      }[]
    >`SELECT receipt_id, state, grant_key, player_key FROM leaderboard_placements WHERE receipt_id = ${input.receiptId}`;
    if (!p[0] || p[0].player_key !== exec.playerKey)
      return { outcome: 'not_found', duplicate: false };
    if (p[0].state === 'provisional') return { outcome: 'provisional', duplicate: false };
    if (p[0].state === 'voided') return { outcome: 'voided', duplicate: false };
    if (!p[0].grant_key) return { outcome: 'not_found', duplicate: false };
    const claimed = await t<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM grants g JOIN grant_claims c ON c.grant_id = g.id WHERE g.player_key = ${exec.playerKey!} AND g.grant_key = ${p[0].grant_key}`;
    if ((claimed[0]?.n ?? 0) > 0)
      return { outcome: 'already_claimed', grantKey: p[0].grant_key, duplicate: false };
    const g = await t<
      { id: string }[]
    >`SELECT id FROM grants WHERE player_key = ${exec.playerKey!} AND grant_key = ${p[0].grant_key}`;
    if (!g[0]) return { outcome: 'not_found', duplicate: false };
    await t`INSERT INTO grant_claims (grant_id, player_key, command_id, claimed_at) VALUES (${g[0].id}, ${exec.playerKey!}, ${input.commandId}, ${new Date(exec.now)})`;
    return { outcome: 'claimed', grantKey: p[0].grant_key, duplicate: false };
  });

  bus.register(SetDisplayName, async (input, exec, tx) => {
    const t = tx!;
    const name = normalizeDisplayName(input.displayName, exec.playerKey!);
    const moderated = name !== input.displayName.trim();
    await t`INSERT INTO display_names (player_key, display_name, raw_name, moderated) VALUES (${exec.playerKey!}, ${name}, ${input.displayName}, ${moderated}) ON CONFLICT (player_key) DO UPDATE SET display_name = EXCLUDED.display_name, raw_name = EXCLUDED.raw_name, moderated = EXCLUDED.moderated, updated_at = now()`;
    return { displayName: name, moderated };
  });

  bus.register(SeasonUpsert, async (input, _exec, tx) => {
    const t = tx!;
    if (!boardCfg(input.board)) throw new AppError('not_found', 'unknown board');
    const rows = await t<{ version: number }[]>`
      INSERT INTO leaderboard_seasons (board_key, season_key, rules_version, status, starts_at, ends_at, score_min, score_max, max_elapsed_ms, quarantine_top_n, rewards)
      VALUES (${input.board}, ${input.seasonKey}, ${input.rulesVersion}, ${input.status}, ${input.startsAt ? new Date(input.startsAt) : null}, ${input.endsAt ? new Date(input.endsAt) : null}, ${input.scoreMin}, ${input.scoreMax}, ${input.maxElapsedMs}, ${input.quarantineTopN}, ${input.rewards ? t.json(input.rewards as never) : null})
      ON CONFLICT (board_key, season_key) DO UPDATE SET rules_version = EXCLUDED.rules_version, status = EXCLUDED.status, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, score_min = EXCLUDED.score_min, score_max = EXCLUDED.score_max, max_elapsed_ms = EXCLUDED.max_elapsed_ms, quarantine_top_n = EXCLUDED.quarantine_top_n, rewards = EXCLUDED.rewards, version = leaderboard_seasons.version + 1
      RETURNING version`;
    if (input.status === 'closed')
      await closeSeason(t, input.board, input.seasonKey, ctx.clock.now(), 'admin');
    return { version: rows[0]!.version, duplicate: false };
  });

  bus.register(SubmissionReview, async (input, exec, tx) => {
    const t = tx!;
    const s = await t<
      { id: string; board_key: string; season_key: string }[]
    >`SELECT id, board_key, season_key FROM leaderboard_submissions WHERE id = ${input.submissionId}`;
    if (!s[0]) throw new AppError('not_found', 'submission not found');
    const existing = await t<
      { action: string }[]
    >`SELECT action FROM leaderboard_reviews WHERE submission_id = ${input.submissionId}`;
    if (existing[0]) throw new AppError('review_final', 'submission already reviewed');
    await t`INSERT INTO leaderboard_reviews (submission_id, action, actor, reason, command_id) VALUES (${input.submissionId}, ${input.action}, ${actorLabel(exec)}, ${input.reason}, ${input.commandId})`;
    await rebuildEntries(t, s[0].board_key, s[0].season_key);
    return { ok: true as const };
  });

  /** Close: rank visible entries (quarantined + boards_hidden ignored), mint provisional placements → confirmed with placement grants. */
  async function closeSeason(
    t: Tx,
    board: string,
    seasonKey: string,
    now: number,
    by: string,
  ): Promise<number> {
    const season = await t<
      SeasonRow[]
    >`SELECT * FROM leaderboard_seasons WHERE board_key = ${board} AND season_key = ${seasonKey}`;
    if (!season[0]) return 0;
    await rebuildEntries(t, board, seasonKey);
    const ranked = await t<
      { player_key: string; score: string; rank: string }[]
    >`SELECT player_key, score, row_number() OVER (ORDER BY score DESC, elapsed_ms ASC, updated_at ASC) AS rank FROM leaderboard_entries WHERE board_key = ${board} AND season_key = ${seasonKey}`;
    const tiers = season[0].rewards ?? game.placementRewards ?? [];
    let n = 0;
    for (const r of ranked) {
      const rank = Number(r.rank);
      const receiptId = `${board}:${seasonKey}:${r.player_key}`;
      const tier = tiers.find((x) => rank <= x.upTo);
      let grantKey: string | null = null;
      if (tier) {
        grantKey = `placement:${board}:${seasonKey}`;
        await mintGrant(t, {
          playerKey: r.player_key,
          grantKey,
          source: 'placement',
          rewards: tier.rewards,
          reason: `placement #${rank} in ${board}/${seasonKey}`,
          actor: by,
          commandId: null,
          title: `Season ${seasonKey}: #${rank}`,
        });
      }
      // placements are minted provisional, confirmed at close (review window elapsed by then)
      await t`INSERT INTO leaderboard_placements (receipt_id, board_key, season_key, player_key, rank, score, state, grant_key, confirmed_at) VALUES (${receiptId}, ${board}, ${seasonKey}, ${r.player_key}, ${rank}, ${Number(r.score)}, 'confirmed', ${grantKey}, ${new Date(now)})
        ON CONFLICT (receipt_id) DO UPDATE SET rank = EXCLUDED.rank, score = EXCLUDED.score, state = 'confirmed', grant_key = COALESCE(leaderboard_placements.grant_key, EXCLUDED.grant_key), confirmed_at = EXCLUDED.confirmed_at`;
      n++;
    }
    await t`UPDATE leaderboard_seasons SET status = 'closed', closed_at = ${new Date(now)} WHERE board_key = ${board} AND season_key = ${seasonKey}`;
    return n;
  }

  route<
    typeof RunStartBody,
    typeof import('@foundation/contracts').RunStartResult,
    typeof import('@foundation/contracts').BoardParams
  >(app, ctx, 'boards.start', async ({ body, params, exec }) =>
    bus.execute(
      BoardStart,
      { commandId: body.commandId, payload: { ...body, board: params.board } as never },
      exec!,
    ),
  );
  route<
    typeof RunSubmitBody,
    typeof import('@foundation/contracts').RunSubmitResult,
    typeof import('@foundation/contracts').BoardParams
  >(app, ctx, 'boards.submit', async ({ body, params, exec }) =>
    bus.execute(
      BoardSubmit,
      { commandId: body.commandId, payload: { ...body, board: params.board } as never },
      exec!,
    ),
  );
  route<typeof PlacementClaimBody, typeof import('@foundation/contracts').PlacementClaimResult>(
    app,
    ctx,
    'boards.claimPlacement',
    async ({ body, exec }) =>
      bus.execute(PlacementClaim, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof DisplayNameBody, typeof import('@foundation/contracts').DisplayNameResult>(
    app,
    ctx,
    'boards.name',
    async ({ body, exec }) =>
      bus.execute(SetDisplayName, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof SeasonUpsertBody, typeof import('@foundation/contracts').PublishReceipt>(
    app,
    ctx,
    'admin.season',
    async ({ body, exec }) =>
      bus.execute(SeasonUpsert, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof SubmissionReviewBody, typeof import('@foundation/contracts').Ok>(
    app,
    ctx,
    'admin.reviewSubmission',
    async ({ body, exec }) =>
      bus.execute(SubmissionReview, { commandId: body.commandId, payload: body }, exec!),
  );

  route<
    undefined,
    typeof import('@foundation/contracts').BoardTopResponse,
    typeof import('@foundation/contracts').BoardParams
  >(app, ctx, 'boards.top', async ({ params }) => {
    if (!boardCfg(params.board)) throw new AppError('not_found', 'unknown board');
    const season = await latestSeason(ctx.db.sql, params.board);
    const out: Omit<BoardTopResponse, 'serverNow' | 'requestId'> = {
      board: params.board,
      status: season?.status ?? 'draft',
      entries: [],
    };
    if (!season) return out;
    out.seasonKey = season.season_key;
    if (season.ends_at) out.endsAt = season.ends_at.getTime();
    const rows = await ctx.db.sql<
      { display_name: string | null; score: string; updated_at: Date; player_key: string }[]
    >`
      SELECT d.display_name, e.score, e.updated_at, e.player_key FROM leaderboard_entries e LEFT JOIN display_names d ON d.player_key = e.player_key
      WHERE e.board_key = ${params.board} AND e.season_key = ${season.season_key} ORDER BY e.score DESC, e.elapsed_ms ASC, e.updated_at ASC LIMIT 100`;
    out.entries = rows.map((r, i) => ({
      rank: i + 1,
      displayName: r.display_name ?? normalizeDisplayName(undefined, r.player_key),
      score: Number(r.score),
      submittedAt: r.updated_at.getTime(),
    }));
    return out;
  });

  route<
    undefined,
    typeof import('@foundation/contracts').BoardMeResponse,
    typeof import('@foundation/contracts').BoardParams
  >(app, ctx, 'boards.me', async ({ params, exec, now }) => {
    if (!boardCfg(params.board)) throw new AppError('not_found', 'unknown board');
    const playerKey = exec!.playerKey!;
    const sql = ctx.db.sql;
    const season = await latestSeason(sql, params.board);
    const nameRow = await sql<
      { display_name: string }[]
    >`SELECT display_name FROM display_names WHERE player_key = ${playerKey}`;
    const hidden = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM player_flags WHERE player_key = ${playerKey} AND flag = 'boards_hidden' AND enabled AND (until IS NULL OR until > ${new Date(now)})`;
    const placements = await sql<
      {
        receipt_id: string;
        season_key: string;
        rank: number;
        state: 'provisional' | 'confirmed' | 'voided';
        grant_key: string | null;
      }[]
    >`SELECT receipt_id, season_key, rank, state, grant_key FROM leaderboard_placements WHERE board_key = ${params.board} AND player_key = ${playerKey} ORDER BY confirmed_at DESC NULLS LAST`;
    const out: Omit<BoardMeResponse, 'serverNow' | 'requestId'> = {
      board: params.board,
      ...(season ? { seasonKey: season.season_key } : {}),
      placements: placements.map((p) => ({
        receiptId: p.receipt_id,
        seasonKey: p.season_key,
        rank: p.rank,
        state: p.state,
        ...(p.grant_key ? { grantKey: p.grant_key } : {}),
      })),
      displayName: nameRow[0]?.display_name ?? normalizeDisplayName(undefined, playerKey),
      boardsHidden: (hidden[0]?.n ?? 0) > 0,
    };
    if (season) {
      const best = await sql<
        {
          score: string;
          visibility: 'visible' | 'quarantined' | 'hidden' | 'rejected';
          action: string | null;
        }[]
      >`
        SELECT s.score, s.visibility, r.action FROM leaderboard_submissions s LEFT JOIN leaderboard_reviews r ON r.submission_id = s.id
        WHERE s.board_key = ${params.board} AND s.season_key = ${season.season_key} AND s.player_key = ${playerKey} ORDER BY s.score DESC, s.elapsed_ms ASC LIMIT 1`;
      if (best[0]) {
        const vis =
          best[0].action === 'reject'
            ? 'rejected'
            : best[0].action === 'approve'
              ? 'visible'
              : best[0].visibility;
        const rank = await rankOf(sql, params.board, season.season_key, playerKey);
        out.best = {
          score: Number(best[0].score),
          visibility: vis,
          ...(rank !== null ? { rank } : {}),
        };
      }
    }
    return out;
  });

  ctx.jobs.push({
    name: 'boards.autoclose',
    intervalMs: 5 * 60_000,
    async run() {
      const due = await ctx.db.sql<
        SeasonRow[]
      >`SELECT * FROM leaderboard_seasons WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ${new Date(ctx.clock.now())}`;
      let closed = 0;
      for (const s of due) {
        await ctx.db.tx(async (t) => {
          await t`SELECT pg_advisory_xact_lock(2, hashtext('game'))`;
          await closeSeason(t, s.board_key, s.season_key, ctx.clock.now(), 'job:boards.autoclose');
        });
        closed++;
      }
      return { closed };
    },
  });
}
