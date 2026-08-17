// liveops feature (§4.3, ADR-012): config (typed flag registry with rollout %/sticky hash/
// activate-at-session-boundary/shadow), schedules, segments (JSON predicates, preview count),
// content_versions (publish-lab/prod, diff, revert), kill switches per SKU/command,
// minBuildVersion, serverNow.
import type { FastifyInstance } from 'fastify';
import {
  FlagPublishBody,
  ContentPublishBody,
  ContentRevertBody,
  SchedulePublishBody,
  SegmentPublishBody,
  KillSwitchBody,
  MinBuildBody,
  AchievementsDocument,
  DailyRewardsDocument,
  type PublishReceipt,
  type ConfigResponse,
  type FlagState,
  type ScheduleWindow,
  type ContentVersionInfo,
  type FlagValue,
  type SegmentPredicate,
  type ContentDocumentResponse,
  type SchedulesResponse,
  type SegmentPreviewResponse,
} from '@foundation/contracts';
import { CONTRACT_VERSION, type ContentKind } from '@foundation/contracts/enums';
import { Value } from '@sinclair/typebox/value';
import { defineCommand } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';
import { route } from '../../http/route.ts';
import type { AppContext, LiveopsCache } from '../../http/context.ts';
import type { Q } from '../../db/index.ts';
import { sha256Hex, canonicalJson } from '../../db/canonical.ts';
import { actorLabel } from '../../cqrs/bus.ts';
import { evaluateSegment, resolveFlag } from './contract.ts';
import { allPlayerKeys, playerFacts } from '../../game/facts.ts';

type Receipt = Omit<PublishReceipt, 'serverNow' | 'requestId'>;
const dup = { fromStored: (r: Receipt) => ({ ...r, duplicate: true }) };
const admin = (type: string, schema: never) => ({
  type,
  schema,
  actorPolicy: { admin: 'publish' as const },
  scope: 'game' as const,
  lock: 'game' as const,
  idempotency: { owner: 'client' as const, retention: '1y' as const },
  tx: 'required' as const,
  limit: 'admin',
  replay: dup,
});

export const PublishFlag = defineCommand<typeof FlagPublishBody, Receipt>(
  admin('liveops.publishFlag', FlagPublishBody as never),
);
export const PublishContent = defineCommand<typeof ContentPublishBody, Receipt>(
  admin('liveops.publishContent', ContentPublishBody as never),
);
export const RevertContent = defineCommand<typeof ContentRevertBody, Receipt>(
  admin('liveops.revertContent', ContentRevertBody as never),
);
export const PublishSchedule = defineCommand<typeof SchedulePublishBody, Receipt>(
  admin('liveops.publishSchedule', SchedulePublishBody as never),
);
export const PublishSegment = defineCommand<typeof SegmentPublishBody, Receipt>(
  admin('liveops.publishSegment', SegmentPublishBody as never),
);
export const SetKillSwitch = defineCommand<typeof KillSwitchBody, Receipt>(
  admin('liveops.killSwitch', KillSwitchBody as never),
);
export const SetMinBuild = defineCommand<typeof MinBuildBody, Receipt>(
  admin('liveops.minBuild', MinBuildBody as never),
);

const CONTENT_SCHEMAS: Partial<Record<ContentKind, import('@sinclair/typebox').TSchema>> = {
  achievements: AchievementsDocument,
  daily_rewards: DailyRewardsDocument,
};

interface FlagRow {
  key: string;
  enabled: boolean;
  value: FlagValue;
  fallback: FlagValue;
  rollout_percent: number;
  shadow: boolean;
  activate_at_session_boundary: boolean;
  activate_at: Date | null;
  segment_id: string | null;
  version: number;
}
const toFlag = (r: FlagRow): FlagState => ({
  key: r.key,
  enabled: r.enabled,
  value: r.value,
  rolloutPercent: r.rollout_percent,
  fallback: r.fallback,
  shadow: r.shadow,
  activateAtSessionBoundary: r.activate_at_session_boundary,
  ...(r.activate_at ? { activateAt: r.activate_at.getTime() } : {}),
  ...(r.segment_id ? { segmentId: r.segment_id } : {}),
  version: r.version,
});

interface SchedRow {
  schedule_id: string;
  kind: string;
  starts_at: Date;
  ends_at: Date | null;
  payload: Record<string, unknown> | null;
  segment_id: string | null;
  active: boolean;
}
const toSchedule = (r: SchedRow): ScheduleWindow => ({
  id: r.schedule_id,
  kind: r.kind,
  startsAt: r.starts_at.getTime(),
  ...(r.ends_at ? { endsAt: r.ends_at.getTime() } : {}),
  ...(r.payload ? { payload: r.payload } : {}),
  ...(r.segment_id ? { segmentId: r.segment_id } : {}),
  active: r.active,
});

export async function loadFlags(q: Q): Promise<FlagState[]> {
  const rows = await q<
    FlagRow[]
  >`SELECT key, enabled, value, fallback, rollout_percent, shadow, activate_at_session_boundary, activate_at, segment_id, version FROM config_flags ORDER BY key`;
  return rows.map(toFlag);
}
export async function loadSchedules(
  q: Q,
  now: number,
  activeOnly: boolean,
): Promise<ScheduleWindow[]> {
  const rows = await q<
    SchedRow[]
  >`SELECT schedule_id, kind, starts_at, ends_at, payload, segment_id, active FROM schedules WHERE (${!activeOnly} OR (active AND starts_at <= ${new Date(now)} AND (ends_at IS NULL OR ends_at > ${new Date(now)}))) ORDER BY starts_at`;
  return rows.map(toSchedule);
}
export async function loadSegments(q: Q): Promise<Map<string, SegmentPredicate>> {
  const rows = await q<
    { segment_id: string; predicate: SegmentPredicate }[]
  >`SELECT segment_id, predicate FROM segments`;
  return new Map(rows.map((r) => [r.segment_id, r.predicate]));
}
export async function contentVersions(q: Q, env: 'lab' | 'prod'): Promise<ContentVersionInfo[]> {
  const rows = await q<
    {
      kind: ContentKind;
      version: number;
      published_at: Date;
      min_build_version: string | null;
      sha256: string;
    }[]
  >`
    SELECT v.kind, v.version, v.published_at, v.min_build_version, v.sha256 FROM content_current c JOIN content_versions v ON v.kind = c.kind AND v.env = c.env AND v.version = c.version WHERE c.env = ${env} ORDER BY v.kind`;
  return rows.map((r) => ({
    kind: r.kind,
    version: r.version,
    publishedAt: r.published_at.getTime(),
    ...(r.min_build_version ? { minBuildVersion: r.min_build_version } : {}),
    sha256: r.sha256,
  }));
}
export async function currentContent(
  q: Q,
  env: 'lab' | 'prod',
  kind: ContentKind,
): Promise<{ version: number; document: unknown; sha256: string } | null> {
  const rows = await q<
    { version: number; document: unknown; sha256: string }[]
  >`SELECT v.version, v.document, v.sha256 FROM content_current c JOIN content_versions v ON v.kind = c.kind AND v.env = c.env AND v.version = c.version WHERE c.env = ${env} AND c.kind = ${kind}`;
  return rows[0] ?? null;
}

/** Content env for this deployment: prod reads prod, lab/dev read lab (ADR-012 publish-lab/prod). */
export const contentEnvFor = (env: 'prod' | 'lab' | 'dev'): 'lab' | 'prod' =>
  env === 'prod' ? 'prod' : 'lab';

export function createLiveopsCache(
  ctx: Pick<AppContext, 'db' | 'game' | 'log'>,
): LiveopsCache & { flags(): FlagState[]; segments(): Map<string, SegmentPredicate> } {
  let minBuild = ctx.game.minBuildVersion;
  let maintenance = false;
  let reattach = false;
  let switches = new Set<string>();
  let flags: FlagState[] = [];
  let segments = new Map<string, SegmentPredicate>();
  return {
    minBuildVersion: () => minBuild,
    maintenance: () => maintenance,
    reattachEnabled: () => reattach,
    killSwitch: (target, id) => switches.has(`${target}:${id}`),
    flags: () => flags,
    segments: () => segments,
    async refresh() {
      const settings = await ctx.db.sql<
        { key: string; value: unknown }[]
      >`SELECT key, value FROM liveops_settings`;
      for (const s of settings) {
        if (s.key === 'min_build_version' && typeof s.value === 'string') minBuild = s.value;
        if (s.key === 'maintenance') maintenance = s.value === true;
        if (s.key === 'reattach_enabled') reattach = s.value === true;
      }
      const ks = await ctx.db.sql<
        { target: string; id: string }[]
      >`SELECT target, id FROM kill_switches WHERE enabled`;
      switches = new Set(ks.map((k) => `${k.target}:${k.id}`));
      flags = await loadFlags(ctx.db.sql);
      segments = await loadSegments(ctx.db.sql);
    },
  };
}

export function registerLiveops(app: FastifyInstance, ctx: AppContext): void {
  const { bus } = ctx;
  ctx.declaredCommands.push(
    PublishFlag,
    PublishContent,
    RevertContent,
    PublishSchedule,
    PublishSegment,
    SetKillSwitch,
    SetMinBuild,
  );
  const registry = new Map(ctx.game.flags.map((f) => [f.key, f]));
  const cache = ctx.liveops as ReturnType<typeof createLiveopsCache>;

  bus.register(PublishFlag, async (input, exec, tx) => {
    const t = tx!;
    const def = registry.get(input.key);
    if (!def)
      throw new AppError('validation_failed', `flag ${input.key} is not in the typed registry`, {
        known: [...registry.keys()],
      });
    if (
      typeof input.value !== def.type ||
      (input.fallback !== undefined && typeof input.fallback !== def.type)
    )
      throw new AppError('validation_failed', `flag ${input.key} is ${def.type}`);
    if (input.segmentId) {
      const seg = await t<
        { segment_id: string }[]
      >`SELECT segment_id FROM segments WHERE segment_id = ${input.segmentId}`;
      if (!seg[0]) throw new AppError('not_found', `segment ${input.segmentId} not published`);
    }
    const rows = await t<{ version: number }[]>`
      INSERT INTO config_flags (key, enabled, value, fallback, rollout_percent, shadow, activate_at_session_boundary, activate_at, segment_id, reason, actor)
      VALUES (${input.key}, ${input.enabled}, ${t.json(input.value as never)}, ${t.json((input.fallback ?? def.default) as never)}, ${input.rolloutPercent}, ${input.shadow ?? false}, ${input.activateAtSessionBoundary ?? false}, ${input.activateAt ? new Date(input.activateAt) : null}, ${input.segmentId ?? null}, ${input.reason}, ${actorLabel(exec)})
      ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, value = EXCLUDED.value, fallback = EXCLUDED.fallback, rollout_percent = EXCLUDED.rollout_percent, shadow = EXCLUDED.shadow, activate_at_session_boundary = EXCLUDED.activate_at_session_boundary, activate_at = EXCLUDED.activate_at, segment_id = EXCLUDED.segment_id, reason = EXCLUDED.reason, actor = EXCLUDED.actor, version = config_flags.version + 1, updated_at = now()
      RETURNING version`;
    const version = rows[0]!.version;
    await t`INSERT INTO config_flag_history (key, version, state, actor, reason) VALUES (${input.key}, ${version}, ${t.json(input as never)}, ${actorLabel(exec)}, ${input.reason})`;
    await ctx.outbox.emit(t, {
      kind: 'liveops.flagPublished',
      payload: { key: input.key, version },
      commandId: input.commandId,
    });
    return { version, duplicate: false };
  });

  bus.register(PublishContent, async (input, exec, tx) => {
    const t = tx!;
    const schema = CONTENT_SCHEMAS[input.kind];
    if (schema && !Value.Check(schema, input.document)) {
      const errs = [...Value.Errors(schema, input.document)]
        .slice(0, 5)
        .map((e) => `${e.path}: ${e.message}`);
      throw new AppError(
        'validation_failed',
        `content ${input.kind} does not match its schema`,
        errs,
      );
    }
    const sha = sha256Hex(canonicalJson(input.document));
    const last = await t<
      { v: number }[]
    >`SELECT coalesce(max(version), 0)::int AS v FROM content_versions WHERE kind = ${input.kind} AND env = ${input.env}`;
    const version = (last[0]?.v ?? 0) + 1;
    await t`INSERT INTO content_versions (kind, env, version, document, sha256, min_build_version, actor, reason, command_id) VALUES (${input.kind}, ${input.env}, ${version}, ${t.json(input.document as never)}, ${sha}, ${input.minBuildVersion ?? null}, ${actorLabel(exec)}, ${input.reason}, ${input.commandId})`;
    await t`INSERT INTO content_current (kind, env, version) VALUES (${input.kind}, ${input.env}, ${version}) ON CONFLICT (kind, env) DO UPDATE SET version = EXCLUDED.version, updated_at = now()`;
    await ctx.outbox.emit(t, {
      kind: 'liveops.contentPublished',
      payload: { kind: input.kind, env: input.env, version },
      commandId: input.commandId,
    });
    return { version, duplicate: false };
  });

  bus.register(RevertContent, async (input, exec, tx) => {
    const t = tx!;
    const target = await t<
      { document: unknown; sha256: string; min_build_version: string | null }[]
    >`SELECT document, sha256, min_build_version FROM content_versions WHERE kind = ${input.kind} AND env = ${input.env} AND version = ${input.toVersion}`;
    if (!target[0]) throw new AppError('not_found', 'no such content version');
    // revert = publish the old document as a NEW version (history stays append-only)
    const last = await t<
      { v: number }[]
    >`SELECT coalesce(max(version), 0)::int AS v FROM content_versions WHERE kind = ${input.kind} AND env = ${input.env}`;
    const version = (last[0]?.v ?? 0) + 1;
    await t`INSERT INTO content_versions (kind, env, version, document, sha256, min_build_version, actor, reason, command_id, reverted_from) VALUES (${input.kind}, ${input.env}, ${version}, ${t.json(target[0].document as never)}, ${target[0].sha256}, ${target[0].min_build_version}, ${actorLabel(exec)}, ${input.reason}, ${input.commandId}, ${input.toVersion})`;
    await t`UPDATE content_current SET version = ${version}, updated_at = now() WHERE kind = ${input.kind} AND env = ${input.env}`;
    return { version, duplicate: false };
  });

  bus.register(PublishSchedule, async (input, exec, tx) => {
    const t = tx!;
    if (input.endsAt !== undefined && input.endsAt <= input.startsAt)
      throw new AppError('validation_failed', 'endsAt must be after startsAt');
    const rows = await t<{ version: number }[]>`
      INSERT INTO schedules (schedule_id, kind, starts_at, ends_at, payload, segment_id, active, reason, actor)
      VALUES (${input.id}, ${input.kind}, ${new Date(input.startsAt)}, ${input.endsAt ? new Date(input.endsAt) : null}, ${input.payload ? t.json(input.payload as never) : null}, ${input.segmentId ?? null}, ${input.active}, ${input.reason}, ${actorLabel(exec)})
      ON CONFLICT (schedule_id) DO UPDATE SET kind = EXCLUDED.kind, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, payload = EXCLUDED.payload, segment_id = EXCLUDED.segment_id, active = EXCLUDED.active, reason = EXCLUDED.reason, actor = EXCLUDED.actor, version = schedules.version + 1, updated_at = now()
      RETURNING version`;
    return { version: rows[0]!.version, duplicate: false };
  });

  bus.register(PublishSegment, async (input, exec, tx) => {
    const t = tx!;
    const rows = await t<{ version: number }[]>`
      INSERT INTO segments (segment_id, predicate, reason, actor) VALUES (${input.id}, ${t.json(input.predicate as never)}, ${input.reason}, ${actorLabel(exec)})
      ON CONFLICT (segment_id) DO UPDATE SET predicate = EXCLUDED.predicate, reason = EXCLUDED.reason, actor = EXCLUDED.actor, version = segments.version + 1, updated_at = now() RETURNING version`;
    return { version: rows[0]!.version, duplicate: false };
  });

  bus.register(SetKillSwitch, async (input, exec, tx) => {
    const t = tx!;
    await t`INSERT INTO kill_switches (target, id, enabled, reason, actor) VALUES (${input.target}, ${input.id}, ${input.enabled}, ${input.reason}, ${actorLabel(exec)}) ON CONFLICT (target, id) DO UPDATE SET enabled = EXCLUDED.enabled, reason = EXCLUDED.reason, actor = EXCLUDED.actor, updated_at = now()`;
    return { version: 1, duplicate: false };
  });

  bus.register(SetMinBuild, async (input, exec, tx) => {
    const t = tx!;
    const rows = await t<
      { version: number }[]
    >`INSERT INTO liveops_settings (key, value, reason, actor) VALUES ('min_build_version', ${t.json(input.minBuildVersion as never)}, ${input.reason}, ${actorLabel(exec)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, reason = EXCLUDED.reason, actor = EXCLUDED.actor, version = liveops_settings.version + 1, updated_at = now() RETURNING version`;
    return { version: rows[0]!.version, duplicate: false };
  });

  const afterPublish = async () => cache.refresh();

  route<undefined, typeof import('@foundation/contracts').ConfigResponse>(
    app,
    ctx,
    'liveops.config',
    async ({ exec, now }) => {
      const env = contentEnvFor(ctx.config.env);
      const out: Omit<ConfigResponse, 'serverNow' | 'requestId'> = {
        gameId: ctx.config.gameId,
        env: ctx.config.env,
        contractVersion: CONTRACT_VERSION,
        buildVersion: ctx.config.buildVersion,
        minBuildVersion: cache.minBuildVersion(),
        maintenance: cache.maintenance(),
        killSwitches: {
          skus: [
            ...(await ctx.db.sql<
              { id: string }[]
            >`SELECT id FROM kill_switches WHERE enabled AND target = 'sku'`),
          ].map((r) => r.id),
          commands: [
            ...(await ctx.db.sql<
              { id: string }[]
            >`SELECT id FROM kill_switches WHERE enabled AND target = 'command'`),
          ].map((r) => r.id),
        },
        contentVersions: await contentVersions(ctx.db.sql, env),
        schedules: await loadSchedules(ctx.db.sql, now, true),
      };
      if (exec?.playerKey) {
        const flags = await loadFlags(ctx.db.sql);
        const segs = await loadSegments(ctx.db.sql);
        const facts = await playerFacts(ctx.db.sql, exec.playerKey, now);
        const inSeg = (id: string | undefined) =>
          id ? (segs.has(id) ? evaluateSegment(segs.get(id)!, facts) : false) : true;
        const resolved: Record<string, FlagValue> = {};
        const shadow: Record<string, FlagValue> = {};
        for (const def of ctx.game.flags) resolved[def.key] = def.default;
        for (const f of flags) {
          const r = resolveFlag(f, exec.playerKey, now, inSeg(f.segmentId));
          if (f.shadow) shadow[f.key] = r.value;
          else resolved[f.key] = r.value;
        }
        out.flags = resolved;
        out.shadowFlags = shadow;
        out.segmentIds = [...segs.entries()]
          .filter(([, p]) => evaluateSegment(p, facts))
          .map(([id]) => id);
        out.schedules = out.schedules.filter((s) => inSeg(s.segmentId));
      } else {
        out.schedules = out.schedules.filter((s) => !s.segmentId);
      }
      return out;
    },
  );

  route<undefined, typeof import('@foundation/contracts').SchedulesResponse>(
    app,
    ctx,
    'liveops.schedules',
    async ({ now }) => {
      const out: Omit<SchedulesResponse, 'serverNow' | 'requestId'> = {
        schedules: await loadSchedules(ctx.db.sql, now, true),
      };
      return out;
    },
  );

  route<
    undefined,
    typeof import('@foundation/contracts').ContentDocumentResponse,
    typeof import('@foundation/contracts').ContentKindParams
  >(app, ctx, 'liveops.content', async ({ params }) => {
    const env = contentEnvFor(ctx.config.env);
    const cur = await currentContent(ctx.db.sql, env, params.kind);
    if (cur)
      return {
        kind: params.kind,
        version: cur.version,
        document: cur.document,
        sha256: cur.sha256,
        source: 'published',
      } satisfies Omit<ContentDocumentResponse, 'serverNow' | 'requestId'>;
    const def =
      params.kind === 'achievements'
        ? ctx.game.content.achievements
        : params.kind === 'daily_rewards'
          ? ctx.game.content.dailyRewards
          : null;
    if (!def)
      throw new AppError('not_found', `no ${params.kind} content published and no bundle default`);
    return {
      kind: params.kind,
      version: 0,
      document: def,
      sha256: sha256Hex(canonicalJson(def)),
      source: 'default',
    };
  });

  const adminRoute = <B extends { commandId: string }>(id: string, def: typeof PublishFlag) =>
    route<never, typeof import('@foundation/contracts').PublishReceipt>(
      app,
      ctx,
      id,
      async ({ body, exec }) => {
        const r = await bus.execute(
          def,
          { commandId: (body as B).commandId, payload: body as never },
          exec!,
        );
        await afterPublish();
        return r;
      },
    );
  adminRoute('admin.publishFlag', PublishFlag);
  adminRoute('admin.publishContent', PublishContent as never);
  adminRoute('admin.revertContent', RevertContent as never);
  adminRoute('admin.publishSchedule', PublishSchedule as never);
  adminRoute('admin.publishSegment', PublishSegment as never);
  adminRoute('admin.killSwitch', SetKillSwitch as never);
  adminRoute('admin.minBuild', SetMinBuild as never);

  route<undefined, typeof import('@foundation/contracts').SegmentPreviewResponse>(
    app,
    ctx,
    'admin.segmentPreview',
    async ({ params, now }) => {
      const id = (params as { id: string }).id;
      const segs = await loadSegments(ctx.db.sql);
      const p = segs.get(id);
      if (!p) throw new AppError('not_found', 'segment not published');
      let count = 0;
      let after: string | null = null;
      for (;;) {
        const keys = await allPlayerKeys(ctx.db.sql, after, 500);
        if (!keys.length) break;
        for (const k of keys)
          if (evaluateSegment(p, await playerFacts(ctx.db.sql, k, now))) count++;
        after = keys[keys.length - 1]!;
      }
      const out: Omit<SegmentPreviewResponse, 'serverNow' | 'requestId'> = { id, count };
      return out;
    },
  );

  ctx.jobs.push({
    name: 'liveops.refresh',
    intervalMs: 30_000,
    runOnStart: false,
    run: async () => cache.refresh().then(() => ({ ok: true })),
  });
}
