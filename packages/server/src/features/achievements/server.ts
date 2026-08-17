// achievements / quests feature (§4.3, ADR-008, ADR-012): one server evaluator over ledgers +
// summary + journal events; definitions as published content documents; criteria tagged
// server_fact vs client_claim; achievement_progress projection (rebuildable); daily rewards.
import type { FastifyInstance } from 'fastify';
import {
  AchievementsEvaluateBody,
  DailyClaimBody,
  type AchievementsMeResponse,
  type AchievementsEvaluateResult,
  type DailyClaimResult,
  type AchievementProgress,
  type AchievementsDocument,
  type DailyRewardsDocument,
} from '@foundation/contracts';
import { defineCommand } from '../../cqrs/define.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import type { Q, Tx } from '../../db/index.ts';
import { mintGrant } from '../../rewards/mint.ts';
import { actorLabel } from '../../cqrs/bus.ts';
import { playerFacts } from '../../game/facts.ts';
import { evaluateAchievement, isClaimSourced, type EvalFacts } from './contract.ts';
import { compareBuildVersions } from '../../http/versions.ts';

type EvalResult = Omit<AchievementsEvaluateResult, 'serverNow' | 'requestId'>;
type DailyResult = Omit<DailyClaimResult, 'serverNow' | 'requestId'>;

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
  ctx.declaredCommands.push(AchievementsEvaluate, DailyClaim);

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

  bus.register(DailyClaim, async (input, exec, tx): Promise<DailyResult> => {
    const t = tx!;
    const playerKey = exec.playerKey!;
    const env = ctx.config.env === 'prod' ? 'prod' : 'lab';
    const { doc } = await currentDoc<DailyRewardsDocument>(
      t,
      env,
      'daily_rewards',
      ctx.game.content.dailyRewards,
    );
    const day = new Date(exec.now).toISOString().slice(0, 10);
    const dayStart = Date.UTC(
      new Date(exec.now).getUTCFullYear(),
      new Date(exec.now).getUTCMonth(),
      new Date(exec.now).getUTCDate(),
    );
    const nextEligibleAt = dayStart + 86_400_000;
    const today = await t<
      { ladder_day: number; grant_key: string }[]
    >`SELECT ladder_day, grant_key FROM daily_claims WHERE player_key = ${playerKey} AND day = ${day}`;
    if (today[0])
      return {
        outcome: 'already_claimed_today',
        day: today[0].ladder_day,
        grantKey: today[0].grant_key,
        nextEligibleAt,
      };
    const last = await t<
      { day: string; ladder_day: number }[]
    >`SELECT day::text AS day, ladder_day FROM daily_claims WHERE player_key = ${playerKey} ORDER BY day DESC LIMIT 1`;
    const yesterday = new Date(dayStart - 86_400_000).toISOString().slice(0, 10);
    const ladderLen = doc.ladder.length;
    const ladderDay =
      last[0] && last[0].day === yesterday ? (last[0].ladder_day % ladderLen) + 1 : 1;
    const step = doc.ladder.find((l) => l.day === ladderDay) ?? doc.ladder[0]!;
    const grantKey = `daily:${day}`;
    await mintGrant(t, {
      playerKey,
      grantKey,
      source: 'daily_reward',
      rewards: step.rewards,
      reason: `daily reward day ${ladderDay}`,
      actor: actorLabel(exec),
      commandId: input.commandId,
      title: `Day ${ladderDay} reward`,
    });
    await t`INSERT INTO daily_claims (player_key, day, ladder_day, grant_key, command_id) VALUES (${playerKey}, ${day}, ${ladderDay}, ${grantKey}, ${input.commandId})`;
    return { outcome: 'claimed', day: ladderDay, grantKey, nextEligibleAt };
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
  route<typeof DailyClaimBody, typeof import('@foundation/contracts').DailyClaimResult>(
    app,
    ctx,
    'daily.claim',
    async ({ body, exec }) =>
      bus.execute(DailyClaim, { commandId: body.commandId, payload: body }, exec!),
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
