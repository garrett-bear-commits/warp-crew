// grants feature (§4.3, ADR-008): grants + grant_claims, typed reward payload union, caps, batch
// claim, reason/ticket_ref, mintForCohort (dry-run count), codes/campaigns.
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import {
  GrantClaimBody,
  GrantClaimBatchBody,
  CodeRedeemBody,
  AdminGrantBody,
  AdminCohortGrantBody,
  AdminCodeCampaignBody,
  type GrantClaimResult,
  type GrantClaimBatchResult,
  type CodeRedeemResult,
  type AdminGrantResult,
  type AdminCohortGrantResult,
  type AdminCodeCampaignResult,
  type GrantsPendingResponse,
  type Grant,
  type GrantReward,
} from '@foundation/contracts';
import { defineCommand } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import type { Q, Tx } from '../../db/index.ts';
import { mintGrant, toGrant, GRANT_COLS } from '../../rewards/mint.ts';
import { actorLabel } from '../../cqrs/bus.ts';
import { allPlayerKeys, playerFacts } from '../../game/facts.ts';
import { evaluateSegment } from '../liveops/contract.ts';

type ClaimResult = Omit<GrantClaimResult, 'serverNow' | 'requestId'>;
type BatchResult = Omit<GrantClaimBatchResult, 'serverNow' | 'requestId'>;
type RedeemResult = Omit<CodeRedeemResult, 'serverNow' | 'requestId'>;
type AdminGrantRes = Omit<AdminGrantResult, 'serverNow' | 'requestId'>;
type CohortRes = Omit<AdminCohortGrantResult, 'serverNow' | 'requestId'>;
type CampaignRes = Omit<AdminCodeCampaignResult, 'serverNow' | 'requestId'>;

export const GrantsClaim = defineCommand<typeof GrantClaimBody, ClaimResult>({
  type: 'grants.claim',
  schema: GrantClaimBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'grants',
  stepUp: true,
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const GrantsClaimBatch = defineCommand<typeof GrantClaimBatchBody, BatchResult>({
  type: 'grants.claimBatch',
  schema: GrantClaimBatchBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'grants',
  stepUp: true,
});
export const CodesRedeem = defineCommand<typeof CodeRedeemBody, RedeemResult>({
  type: 'codes.redeem',
  schema: CodeRedeemBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'codes',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const AdminGrant = defineCommand<typeof AdminGrantBody, AdminGrantRes>({
  type: 'grants.adminMint',
  schema: AdminGrantBody,
  actorPolicy: { admin: 'grant' },
  scope: 'game',
  lock: 'none',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const AdminCohortGrant = defineCommand<typeof AdminCohortGrantBody, CohortRes>({
  type: 'grants.mintForCohort',
  schema: AdminCohortGrantBody,
  actorPolicy: { admin: 'grant' },
  scope: 'game',
  lock: 'game',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const AdminCodeCampaign = defineCommand<typeof AdminCodeCampaignBody, CampaignRes>({
  type: 'codes.createCampaign',
  schema: AdminCodeCampaignBody,
  actorPolicy: { admin: 'grant' },
  scope: 'game',
  lock: 'game',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});

/** Codes are normalised (uppercase alphanumerics) and must carry ≥ 40 bits after normalisation (§7): 8+ chars of [A-Z0-9]. */
export function normalizeCode(raw: string): string | null {
  const n = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n.length >= 8 && n.length <= 64 ? n : null;
}
export const codeHash = (normalized: string): string =>
  createHash('sha256').update(normalized).digest('hex');
export const BAD_GUESSES_PER_PLAYER_PER_HOUR = 10;
export const BAD_GUESSES_PER_CAMPAIGN_PER_DAY = 1000;

interface GrantRowLite {
  id: string;
  grant_key: string;
  source: Grant['source'];
  rewards: GrantReward[];
  reason: string;
  ticket_ref: string | null;
  title: string | null;
  body: string | null;
  created_at: Date;
  expires_at: Date | null;
  claimed_at: Date | null;
}

export async function pendingGrants(q: Q, playerKey: string, now: number): Promise<Grant[]> {
  const rows = await q.unsafe<GrantRowLite[]>(
    `SELECT ${GRANT_COLS} FROM grants g WHERE g.player_key = $1 AND NOT EXISTS (SELECT 1 FROM grant_claims c WHERE c.grant_id = g.id) AND (g.expires_at IS NULL OR g.expires_at > $2) ORDER BY g.created_at`,
    [playerKey, new Date(now)],
  );
  return rows.map(toGrant);
}

async function claimOne(
  tx: Tx,
  playerKey: string,
  grantKey: string,
  commandId: string,
  now: number,
  frozen: boolean,
): Promise<{ outcome: ClaimResult['outcome']; grant?: Grant }> {
  const rows = await tx.unsafe<GrantRowLite[]>(
    `SELECT ${GRANT_COLS} FROM grants g WHERE g.player_key = $1 AND g.grant_key = $2`,
    [playerKey, grantKey],
  );
  const g = rows[0];
  if (!g) return { outcome: 'not_found' };
  if (g.claimed_at) return { outcome: 'already_claimed', grant: toGrant(g) };
  if (g.expires_at && g.expires_at.getTime() <= now)
    return { outcome: 'expired', grant: toGrant(g) };
  if (frozen) return { outcome: 'frozen', grant: toGrant(g) };
  await tx`INSERT INTO grant_claims (grant_id, player_key, command_id, claimed_at) VALUES (${g.id}, ${playerKey}, ${commandId}, ${new Date(now)})`;
  return { outcome: 'claimed', grant: toGrant({ ...g, claimed_at: new Date(now) }) };
}

async function grantsFrozen(q: Q, playerKey: string, now: number): Promise<boolean> {
  const rows = await q<
    { until: Date | null }[]
  >`SELECT until FROM player_flags WHERE player_key = ${playerKey} AND flag = 'grants_frozen' AND enabled`;
  return rows.some((r) => r.until === null || r.until.getTime() > now);
}

export function registerGrants(app: FastifyInstance, ctx: AppContext): void {
  const { bus } = ctx;
  ctx.declaredCommands.push(
    GrantsClaim,
    GrantsClaimBatch,
    CodesRedeem,
    AdminGrant,
    AdminCohortGrant,
    AdminCodeCampaign,
  );

  bus.register(GrantsClaim, async (input, exec, tx) => {
    const t = tx!;
    const frozen = await grantsFrozen(t, exec.playerKey!, exec.now);
    const r = await claimOne(t, exec.playerKey!, input.grantKey, input.commandId, exec.now, frozen);
    if (r.outcome === 'claimed')
      await ctx.outbox.emit(t, {
        kind: 'grant.claimed',
        playerKey: exec.playerKey!,
        payload: { grantKey: input.grantKey },
        commandId: input.commandId,
      });
    return { outcome: r.outcome, duplicate: false, ...(r.grant ? { grant: r.grant } : {}) };
  });

  bus.register(GrantsClaimBatch, async (input, exec, tx) => {
    const t = tx!;
    const frozen = await grantsFrozen(t, exec.playerKey!, exec.now);
    const results: BatchResult['results'] = [];
    for (const k of input.grantKeys) {
      const r = await claimOne(t, exec.playerKey!, k, input.commandId, exec.now, frozen);
      results.push({ grantKey: k, outcome: r.outcome });
      if (r.outcome === 'claimed')
        await ctx.outbox.emit(t, {
          kind: 'grant.claimed',
          playerKey: exec.playerKey!,
          payload: { grantKey: k },
          commandId: input.commandId,
        });
    }
    return { results };
  });

  bus.register(CodesRedeem, async (input, exec, tx): Promise<RedeemResult> => {
    const t = tx!;
    const playerKey = exec.playerKey!;
    const normalized = normalizeCode(input.code);
    const bad = async (campaignId: string | null) => {
      await t`INSERT INTO code_bad_guesses (player_key, campaign_id) VALUES (${playerKey}, ${campaignId})`;
    };
    const playerBad = await t<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM code_bad_guesses WHERE player_key = ${playerKey} AND at > ${new Date(exec.now - 3_600_000)}`;
    if ((playerBad[0]?.n ?? 0) >= BAD_GUESSES_PER_PLAYER_PER_HOUR)
      return { outcome: 'locked', duplicate: false };
    if (!normalized) {
      await bad(null);
      return { outcome: 'invalid', duplicate: false };
    }
    const h = codeHash(normalized);
    const rows = await t<
      {
        code_hash: string;
        campaign_id: string;
        redemptions: number;
        rewards: GrantReward[];
        max: number;
        registered_only: boolean;
        expires_at: Date | null;
        locked_at: Date | null;
      }[]
    >`
      SELECT c.code_hash, c.campaign_id, c.redemptions, k.rewards, k.max_redemptions_per_code AS max, k.registered_only, k.expires_at, k.locked_at
      FROM codes c JOIN code_campaigns k ON k.campaign_id = c.campaign_id WHERE c.code_hash = ${h}`;
    const c = rows[0];
    if (!c) {
      await bad(null);
      return { outcome: 'invalid', duplicate: false };
    }
    if (c.locked_at) return { outcome: 'locked', duplicate: false };
    if (c.expires_at && c.expires_at.getTime() <= exec.now)
      return { outcome: 'expired', duplicate: false };
    if (c.registered_only && !(exec.actor.kind === 'player' && exec.actor.registered))
      return { outcome: 'registration_required', duplicate: false };
    const already = await t<
      { grant_id: string }[]
    >`SELECT grant_id FROM code_redemptions WHERE code_hash = ${h} AND player_key = ${playerKey}`;
    if (already[0]) {
      const g = await t.unsafe<GrantRowLite[]>(
        `SELECT ${GRANT_COLS} FROM grants g WHERE g.id = $1`,
        [already[0].grant_id],
      );
      return {
        outcome: 'already_redeemed',
        duplicate: false,
        ...(g[0] ? { grant: toGrant(g[0]) } : {}),
      };
    }
    // Reserve capacity atomically across players BEFORE minting: two players redeeming the last slot
    // concurrently hold different player locks, so the counter itself is the arbiter.
    const reserved = await t<
      { redemptions: number }[]
    >`UPDATE codes SET redemptions = redemptions + 1 WHERE code_hash = ${h} AND redemptions < ${c.max} RETURNING redemptions`;
    if (!reserved[0]) return { outcome: 'exhausted', duplicate: false };
    const grantKey = `code:${c.campaign_id}:${h.slice(0, 12)}`;
    const m = await mintGrant(t, {
      playerKey,
      grantKey,
      source: 'code',
      rewards: c.rewards,
      reason: `code campaign ${c.campaign_id}`,
      actor: actorLabel(exec),
      commandId: input.commandId,
    });
    // redeeming is the claim
    await t`INSERT INTO grant_claims (grant_id, player_key, command_id, claimed_at) VALUES (${m.id}, ${playerKey}, ${input.commandId}, ${new Date(exec.now)})`;
    await t`INSERT INTO code_redemptions (code_hash, player_key, grant_id) VALUES (${h}, ${playerKey}, ${m.id})`;
    await ctx.outbox.emit(t, {
      kind: 'code.redeemed',
      playerKey,
      payload: { campaignId: c.campaign_id, grantKey },
      commandId: input.commandId,
    });
    return { outcome: 'redeemed', duplicate: false, grant: { ...m.grant, claimedAt: exec.now } };
  });

  bus.register(AdminGrant, async (input, exec, tx) => {
    const t = tx!;
    const m = await mintGrant(t, {
      playerKey: input.playerKey,
      grantKey: input.grantKey,
      source: 'admin',
      rewards: input.rewards,
      reason: input.reason,
      ticketRef: input.ticketRef ?? null,
      title: input.title ?? null,
      body: input.body ?? null,
      expiresAt: input.expiresAt ?? null,
      actor: actorLabel(exec),
      commandId: input.commandId,
    });
    if (m.created)
      await ctx.outbox.emit(t, {
        kind: 'grant.minted',
        playerKey: input.playerKey,
        payload: { grantKey: input.grantKey, source: 'admin' },
        commandId: input.commandId,
      });
    return { grantKey: input.grantKey, duplicate: !m.created };
  });

  bus.register(AdminCohortGrant, async (input, exec, tx) => {
    const t = tx!;
    let matched = 0;
    let minted = 0;
    let after: string | null = null;
    for (;;) {
      const keys = await allPlayerKeys(t, after, 500);
      if (!keys.length) break;
      for (const k of keys) {
        const facts = await playerFacts(t, k, exec.now);
        if (!evaluateSegment(input.predicate, facts)) continue;
        matched++;
        if (input.dryRun) continue;
        const m = await mintGrant(t, {
          playerKey: k,
          grantKey: `${input.grantKeyPrefix}:${k}`,
          source: 'cohort',
          rewards: input.rewards,
          reason: input.reason,
          ticketRef: input.ticketRef ?? null,
          title: input.title ?? null,
          body: input.body ?? null,
          actor: actorLabel(exec),
          commandId: input.commandId,
        });
        if (m.created) minted++;
      }
      after = keys[keys.length - 1]!;
    }
    if (!input.dryRun)
      await ctx.outbox.emit(t, {
        kind: 'grant.cohortMinted',
        payload: { grantKeyPrefix: input.grantKeyPrefix, matched, minted },
        commandId: input.commandId,
      });
    return { matched, minted, dryRun: input.dryRun, duplicate: false };
  });

  bus.register(AdminCodeCampaign, async (input, exec, tx) => {
    const t = tx!;
    const existing = await t<
      { campaign_id: string }[]
    >`SELECT campaign_id FROM code_campaigns WHERE campaign_id = ${input.campaignId}`;
    if (existing[0]) throw new AppError('bad_request', 'campaign already exists');
    const hashes = new Set<string>();
    for (const raw of input.codes) {
      const n = normalizeCode(raw);
      if (!n)
        throw new AppError(
          'validation_failed',
          `code "${raw}" has fewer than 8 alphanumerics after normalisation (≥ 40 bits required)`,
        );
      hashes.add(codeHash(n));
    }
    await t`INSERT INTO code_campaigns (campaign_id, rewards, max_redemptions_per_code, registered_only, expires_at, reason, actor) VALUES (${input.campaignId}, ${t.json(input.rewards as never)}, ${input.maxRedemptionsPerCode}, ${input.registeredOnly}, ${input.expiresAt ? new Date(input.expiresAt) : null}, ${input.reason}, ${actorLabel(exec)})`;
    for (const h of hashes)
      await t`INSERT INTO codes (code_hash, campaign_id) VALUES (${h}, ${input.campaignId})`;
    return { campaignId: input.campaignId, codes: hashes.size, duplicate: false };
  });

  route<undefined, typeof import('@foundation/contracts').GrantsPendingResponse>(
    app,
    ctx,
    'grants.pending',
    async ({ exec }) => {
      const out: Omit<GrantsPendingResponse, 'serverNow' | 'requestId'> = {
        grants: await pendingGrants(ctx.db.sql, exec!.playerKey!, exec!.now),
        grantsFrozen: await grantsFrozen(ctx.db.sql, exec!.playerKey!, exec!.now),
      };
      return out;
    },
  );
  route<typeof GrantClaimBody, typeof import('@foundation/contracts').GrantClaimResult>(
    app,
    ctx,
    'grants.claim',
    async ({ body, exec }) =>
      bus.execute(GrantsClaim, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof GrantClaimBatchBody, typeof import('@foundation/contracts').GrantClaimBatchResult>(
    app,
    ctx,
    'grants.claimBatch',
    async ({ body, exec }) =>
      bus.execute(GrantsClaimBatch, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof CodeRedeemBody, typeof import('@foundation/contracts').CodeRedeemResult>(
    app,
    ctx,
    'codes.redeem',
    async ({ body, exec }) =>
      bus.execute(CodesRedeem, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof AdminGrantBody, typeof import('@foundation/contracts').AdminGrantResult>(
    app,
    ctx,
    'admin.grant',
    async ({ body, exec }) =>
      bus.execute(AdminGrant, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof AdminCohortGrantBody, typeof import('@foundation/contracts').AdminCohortGrantResult>(
    app,
    ctx,
    'admin.cohortGrant',
    async ({ body, exec }) =>
      bus.execute(AdminCohortGrant, { commandId: body.commandId, payload: body }, exec!),
  );
  route<
    typeof AdminCodeCampaignBody,
    typeof import('@foundation/contracts').AdminCodeCampaignResult
  >(app, ctx, 'admin.codeCampaign', async ({ body, exec }) =>
    bus.execute(AdminCodeCampaign, { commandId: body.commandId, payload: body }, exec!),
  );

  // campaign lock after K bad guesses per day (job)
  ctx.jobs.push({
    name: 'codes.lockAbusedCampaigns',
    intervalMs: 10 * 60_000,
    async run() {
      const r = await ctx.db
        .sql`UPDATE code_campaigns k SET locked_at = now() WHERE locked_at IS NULL AND (SELECT count(*) FROM code_bad_guesses b WHERE b.campaign_id = k.campaign_id AND b.at > now() - interval '1 day') >= ${BAD_GUESSES_PER_CAMPAIGN_PER_DAY}`;
      return { locked: r.count };
    },
  });
}
