// achievements / quests feature (§4.3, ADR-008, ADR-012): one server evaluator over ledgers +
// summary + journal events; definitions as published content documents; criteria tagged
// server_fact vs client_claim; achievement_progress projection (rebuildable); daily rewards
// (registerDaily: server-stamped claims, UTC-day or rolling 24 h cadence, plus a status read).
import type { FastifyInstance } from 'fastify';
import {
  AchievementsEvaluateBody,
  DailyClaimBody,
  type AchievementsMeResponse,
  type AchievementsEvaluateResult,
  type DailyClaimResult,
  type DailyStatusResponse,
  type AchievementProgress,
  type AchievementsDocument,
  type DailyRewardsDocument,
  type GrantReward,
} from '@foundation/contracts';
import { defineCommand } from '../../cqrs/define.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import type { Q, Tx } from '../../db/index.ts';
import { mintGrant } from '../../rewards/mint.ts';
import { actorLabel } from '../../cqrs/bus.ts';
import { playerFacts } from '../../game/facts.ts';
import {
  decideDailyClaim,
  evaluateAchievement,
  isClaimSourced,
  type DailyClaimRow,
  type DailyDecision,
  type EvalFacts,
} from './contract.ts';
import { compareBuildVersions } from '../../http/versions.ts';

type EvalResult = Omit<AchievementsEvaluateResult, 'serverNow' | 'requestId'>;
type DailyResult = Omit<DailyClaimResult, 'serverNow' | 'requestId'>;
type DailyStatus = Omit<DailyStatusResponse, 'serverNow' | 'requestId'>;

export const AchievementsEvaluate = defineCommand<typeof AchievementsEvaluateBody, EvalResult>({
  type: 'achievements.evaluate',
  schema: AchievementsEvaluateBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '7d' },
  tx: 'required',
  limit: 'achievements',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const DailyClaim = defineCommand<typeof DailyClaimBody, DailyResult>({
  type: 'daily.claim',
  schema: DailyClaimBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'achievements',
  replay: { fromStored: (r) => ({ ...r, outcome: 'duplicate' }) },
});

async function currentDoc<T>(
  q: Q,
  env: 'lab' | 'prod',
  kind: 'achievements' | 'daily_rewards',
  fallback: T,
): Promise<{ doc: T; version: number }> {
  const rows = await q<
    { version: number; document: T }[]
  >`SELECT v.version, v.document FROM content_current c JOIN content_versions v ON v.kind = c.kind AND v.env = c.env AND v.version = c.version WHERE c.env = ${env} AND c.kind = ${kind}`;
  return rows[0]
    ? { doc: rows[0].document, version: rows[0].version }
    : { doc: fallback, version: 0 };
}

interface DailyClaimDbRow {
  day: string;
  at: Date;
  ladder_day: number;
  grant_key: string;
}
const toClaimRow = (r: DailyClaimDbRow | undefined): DailyClaimRow | null =>
  r ? { day: r.day, at: r.at.getTime(), ladderDay: r.ladder_day, grantKey: r.grant_key } : null;

async function currentGeneration(q: Q, playerKey: string): Promise<number> {
  const rows = await q<
    { generation: number | null }[]
  >`SELECT max(generation)::int AS generation FROM generations WHERE player_key = ${playerKey}`;
  return rows[0]?.generation ?? 0;
}

/** Latest anchored (or promoted) progress of the current generation, as playerFacts().progress. */
async function anchoredProgress(q: Q, playerKey: string): Promise<number> {
  const rows = await q<{ progress: string | null }[]>`
    SELECT s.progress::text AS progress FROM save_snapshots s WHERE s.player_key = ${playerKey} AND s.generation = (SELECT max(generation) FROM generations WHERE player_key = ${playerKey})
      AND (s.disposition = 'anchored' OR EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = s.id AND r.action = 'promote')) ORDER BY s.progress DESC, s.seq DESC LIMIT 1`;
  return Number(rows[0]?.progress ?? 0);
}

/** Read everything decideDailyClaim needs, on the server clock `now`. */
async function dailyDecision(
  q: Q,
  playerKey: string,
  now: number,
  doc: DailyRewardsDocument,
): Promise<{ decision: DailyDecision; cadence: 'utc_day' | 'rolling_24h'; generation: number }> {
  const cadence = doc.cadence ?? 'utc_day';
  const minProgress = doc.minProgress ?? 0;
  const lastRows = await q<
    DailyClaimDbRow[]
  >`SELECT day::text AS day, at, ladder_day, grant_key FROM daily_claims WHERE player_key = ${playerKey} ORDER BY day DESC LIMIT 1`;
  const todayRows =
    cadence === 'utc_day'
      ? await q<
          DailyClaimDbRow[]
        >`SELECT day::text AS day, at, ladder_day, grant_key FROM daily_claims WHERE player_key = ${playerKey} AND day = ${new Date(now).toISOString().slice(0, 10)}`
      : [];
  const generation = await currentGeneration(q, playerKey);
  const progress = minProgress > 0 ? await anchoredProgress(q, playerKey) : 0;
  return {
    cadence,
    generation,
    decision: decideDailyClaim({
      cadence,
      now,
      today: toClaimRow(todayRows[0]),
      last: toClaimRow(lastRows[0]),
      progress,
      minProgress,
      ladderLen: doc.ladder.length,
      generation,
    }),
  };
}

async function grantRewards(q: Q, playerKey: string, grantKey: string): Promise<GrantReward[]> {
  const rows = await q<
    { rewards: GrantReward[] }[]
  >`SELECT rewards FROM grants WHERE player_key = ${playerKey} AND grant_key = ${grantKey}`;
  return rows[0]?.rewards ?? [];
}

async function evalFacts(q: Q, playerKey: string, now: number): Promise<EvalFacts> {
  const f = await playerFacts(q, playerKey, now);
  const summaryRow = await q<{ summary: Record<string, number> | null }[]>`
    SELECT s.summary FROM save_snapshots s WHERE s.player_key = ${playerKey} AND s.generation = (SELECT max(generation) FROM generations WHERE player_key = ${playerKey})
      AND (s.disposition = 'anchored' OR EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = s.id AND r.action = 'promote')) ORDER BY s.progress DESC, s.seq DESC LIMIT 1`;
  const jc = await q<
    { name: string; n: number }[]
  >`SELECT name, count(*)::int AS n FROM journal_entries WHERE player_key = ${playerKey} AND kind = 'action' GROUP BY name`;
  return {
    serverFacts: {
      purchases_paid_count: Number(f.paid_count),
      placements_confirmed: Number(f.placements_confirmed),
      seen_days: Number(f.seen_days),
      grants_claimed: Number(f.grants_claimed),
      codes_redeemed: Number(f.codes_redeemed),
    },
    progress: Number(f.progress),
    summary: summaryRow[0]?.summary ?? {},
    journalEventCounts: Object.fromEntries(jc.map((r) => [r.name, r.n])),
  };
}

export async function evaluatePlayer(
  tx: Tx,
  ctx: AppContext,
  playerKey: string,
  now: number,
  actor: string,
  commandId: string | null,
  buildVersion: string | undefined,
): Promise<{ unlocked: string[]; items: AchievementProgress[]; version: number }> {
  const env = ctx.config.env === 'prod' ? 'prod' : 'lab';
  const { doc, version } = await currentDoc<AchievementsDocument>(
    tx,
    env,
    'achievements',
    ctx.game.content.achievements,
  );
  const facts = await evalFacts(tx, playerKey, now);
  const unlockedRows = await tx<
    { achievement_id: string; grant_key: string; at: Date }[]
  >`SELECT achievement_id, grant_key, at FROM achievement_unlocks WHERE player_key = ${playerKey}`;
  const already = new Map(unlockedRows.map((r) => [r.achievement_id, r]));
  const unlocked: string[] = [];
  const items: AchievementProgress[] = [];
  for (const def of doc.achievements) {
    if (
      def.minBuildVersion &&
      buildVersion &&
      compareBuildVersions(buildVersion, def.minBuildVersion) < 0
    )
      continue;
    const prev = already.get(def.id);
    const ev = evaluateAchievement(def, facts, now);
    let item: AchievementProgress = { id: def.id, unlocked: !!prev, progress: ev.progress };
    if (prev) item = { ...item, unlockedAt: prev.at.getTime(), grantKey: prev.grant_key };
    else if (ev.unlocked) {
      const grantKey = `achievement:${def.id}`;
      const claimSourced = isClaimSourced(def);
      const m = await mintGrant(tx, {
        playerKey,
        grantKey,
        source: 'achievement',
        rewards: def.rewards,
        reason: `achievement ${def.id}`,
        actor,
        commandId,
        title: def.title,
        claimSourced,
        claimBudget: doc.clientClaimPremiumBudget,
      });
      await tx`INSERT INTO achievement_unlocks (player_key, achievement_id, content_version, grant_key, command_id, at) VALUES (${playerKey}, ${def.id}, ${version}, ${grantKey}, ${commandId ?? '00000000-0000-4000-8000-000000000000'}, ${new Date(now)})`;
      unlocked.push(def.id);
      item = { ...item, unlocked: true, unlockedAt: now, grantKey };
      void m;
    }
    await tx`INSERT INTO achievement_progress (player_key, achievement_id, content_version, unlocked, unlocked_at, grant_key, progress) VALUES (${playerKey}, ${def.id}, ${version}, ${item.unlocked}, ${item.unlockedAt ? new Date(item.unlockedAt) : null}, ${item.grantKey ?? null}, ${tx.json(item.progress as never)})
      ON CONFLICT (player_key, achievement_id) DO UPDATE SET content_version = EXCLUDED.content_version, unlocked = EXCLUDED.unlocked, unlocked_at = EXCLUDED.unlocked_at, grant_key = EXCLUDED.grant_key, progress = EXCLUDED.progress, updated_at = now()`;
    items.push(item);
  }
  return { unlocked, items, version };
}

export function registerAchievements(app: FastifyInstance, ctx: AppContext): void {
  const { bus } = ctx;
  ctx.declaredCommands.push(AchievementsEvaluate);

  bus.register(AchievementsEvaluate, async (input, exec, tx) => {
    const r = await evaluatePlayer(
      tx!,
      ctx,
      exec.playerKey!,
      exec.now,
      actorLabel(exec),
      input.commandId,
      exec.buildVersion,
    );
    for (const id of r.unlocked)
      await ctx.outbox.emit(tx!, {
        kind: 'achievement.unlocked',
        playerKey: exec.playerKey!,
        payload: { id },
        commandId: input.commandId,
      });
    return { unlocked: r.unlocked, items: r.items, duplicate: false };
  });

  route<undefined, typeof import('@foundation/contracts').AchievementsMeResponse>(
    app,
    ctx,
    'achievements.me',
    async ({ exec }) => {
      const rows = await ctx.db.sql<
        {
          achievement_id: string;
          content_version: number;
          unlocked: boolean;
          unlocked_at: Date | null;
          grant_key: string | null;
          progress: AchievementProgress['progress'];
        }[]
      >`SELECT achievement_id, content_version, unlocked, unlocked_at, grant_key, progress FROM achievement_progress WHERE player_key = ${exec!.playerKey!} ORDER BY achievement_id`;
      const out: Omit<AchievementsMeResponse, 'serverNow' | 'requestId'> = {
        version: rows[0]?.content_version ?? 0,
        items: rows.map((r) => ({
          id: r.achievement_id,
          unlocked: r.unlocked,
          ...(r.unlocked_at ? { unlockedAt: r.unlocked_at.getTime() } : {}),
          ...(r.grant_key ? { grantKey: r.grant_key } : {}),
          progress: r.progress,
        })),
      };
      return out;
    },
  );
  route<
    typeof AchievementsEvaluateBody,
    typeof import('@foundation/contracts').AchievementsEvaluateResult
  >(app, ctx, 'achievements.evaluate', async ({ body, exec }) =>
    bus.execute(AchievementsEvaluate, { commandId: body.commandId, payload: body }, exec!),
  );

  // Reaction: evaluate on save.written / purchase.recorded via a deterministic system command (ADR-004).
  const SystemEvaluate = defineCommand<typeof AchievementsEvaluateBody, EvalResult>({
    type: 'achievements.systemEvaluate',
    schema: AchievementsEvaluateBody,
    actorPolicy: 'system',
    scope: 'player',
    lock: 'player',
    idempotency: { owner: 'system', retention: '7d' },
    tx: 'required',
  });
  ctx.declaredCommands.push(SystemEvaluate);
  bus.register(SystemEvaluate, async (input, exec, tx) => {
    const r = await evaluatePlayer(
      tx!,
      ctx,
      exec.playerKey!,
      exec.now,
      actorLabel(exec),
      input.commandId,
      undefined,
    );
    return { unlocked: r.unlocked, items: r.items, duplicate: false };
  });
  ctx.outbox.register({
    name: 'achievements.evaluator',
    kinds: ['save.written', 'purchase.recorded', 'grant.claimed', 'code.redeemed'],
    async handle(msg, { deterministicCommandId }) {
      if (!msg.playerKey) return;
      if (
        msg.kind === 'save.written' &&
        (msg.payload as { disposition?: string }).disposition !== 'anchored'
      )
        return;
      await bus.execute(
        SystemEvaluate,
        { commandId: deterministicCommandId, payload: { commandId: deterministicCommandId } },
        {
          gameId: ctx.config.gameId,
          env: ctx.config.env,
          actor: { kind: 'system', name: 'achievements.evaluator' },
          playerKey: msg.playerKey,
          requestId: `outbox:${msg.id}`,
          now: ctx.clock.now(),
        },
      );
    },
  });
}

/**
 * Daily reward claim + status (registered when `features.achievements || features.daily`, so a
 * game can take daily claims without the achievements evaluator). The server clock decides
 * eligibility; every claim is stamped with `exec.now` and delivered as an idempotent grant
 * (`daily_reward` source) the client applies once and acknowledges through grants.claim.
 */
export function registerDaily(app: FastifyInstance, ctx: AppContext): void {
  const { bus } = ctx;
  ctx.declaredCommands.push(DailyClaim);
  const env = ctx.config.env === 'prod' ? 'prod' : 'lab';
  const dailyDoc = (q: Q) =>
    currentDoc<DailyRewardsDocument>(q, env, 'daily_rewards', ctx.game.content.dailyRewards);

  bus.register(DailyClaim, async (input, exec, tx): Promise<DailyResult> => {
    const t = tx!;
    const playerKey = exec.playerKey!;
    const { doc } = await dailyDoc(t);
    const { decision: d } = await dailyDecision(t, playerKey, exec.now, doc);
    if (d.kind === 'cooldown')
      return {
        outcome: 'already_claimed_today',
        day: d.ladderDay,
        grantKey: d.grantKey,
        rewards: await grantRewards(t, playerKey, d.grantKey),
        nextEligibleAt: d.nextEligibleAt,
      };
    if (d.kind === 'not_eligible')
      return { outcome: 'not_eligible', day: 1, nextEligibleAt: d.nextEligibleAt };
    const step = doc.ladder.find((l) => l.day === d.ladderDay) ?? doc.ladder[0]!;
    const minted = await mintGrant(t, {
      playerKey,
      grantKey: d.grantKey,
      source: 'daily_reward',
      rewards: step.rewards,
      reason: `daily reward day ${d.ladderDay}`,
      actor: actorLabel(exec),
      commandId: input.commandId,
      title: `Day ${d.ladderDay} reward`,
    });
    // Stamped with the server clock that decided the claim, not the database's now().
    await t`INSERT INTO daily_claims (player_key, day, ladder_day, grant_key, command_id, at) VALUES (${playerKey}, ${d.day}, ${d.ladderDay}, ${d.grantKey}, ${input.commandId}, ${new Date(exec.now)})`;
    return {
      outcome: 'claimed',
      day: d.ladderDay,
      grantKey: d.grantKey,
      rewards: minted.grant.rewards,
      nextEligibleAt: d.nextEligibleAt,
    };
  });

  route<typeof DailyClaimBody, typeof import('@foundation/contracts').DailyClaimResult>(
    app,
    ctx,
    'daily.claim',
    async ({ body, exec }) =>
      bus.execute(DailyClaim, { commandId: body.commandId, payload: body }, exec!),
  );

  route<undefined, typeof import('@foundation/contracts').DailyStatusResponse>(
    app,
    ctx,
    'daily.status',
    async ({ exec }) => {
      const q = ctx.db.sql;
      const playerKey = exec!.playerKey!;
      const { doc } = await dailyDoc(q);
      const {
        decision: d,
        cadence,
        generation,
      } = await dailyDecision(q, playerKey, exec!.now, doc);
      // Rolling keys carry the generation; a restarted journey never sees older claims.
      const prefix = cadence === 'rolling_24h' ? `daily:g${generation}:` : 'daily:';
      const rows = await q<
        { grant_key: string; at: Date; rewards: GrantReward[]; acknowledged: boolean }[]
      >`SELECT d.grant_key, d.at, g.rewards, EXISTS (SELECT 1 FROM grant_claims c WHERE c.grant_id = g.id) AS acknowledged
          FROM daily_claims d JOIN grants g ON g.player_key = d.player_key AND g.grant_key = d.grant_key
          WHERE d.player_key = ${playerKey} AND starts_with(d.grant_key, ${prefix})
          ORDER BY d.day DESC LIMIT 100`;
      const out: DailyStatus = {
        cadence,
        state: d.kind === 'claim' ? 'ready' : d.kind,
        nextEligibleAt: d.kind === 'claim' ? exec!.now : d.nextEligibleAt,
        generation,
        claims: rows.map((r) => ({
          grantKey: r.grant_key,
          at: r.at.getTime(),
          rewards: r.rewards,
          acknowledged: r.acknowledged,
        })),
      };
      return out;
    },
  );
}
