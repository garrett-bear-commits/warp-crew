import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, Response, StringEnum } from './common.ts';
import { CONTENT_ENVS, CONTENT_KINDS, FLAG_TYPES } from './enums.ts';

export const FlagTypeSchema = StringEnum(FLAG_TYPES);
export const ContentEnvSchema = StringEnum(CONTENT_ENVS);
export const ContentKindSchema = StringEnum(CONTENT_KINDS);

export const FlagValue = Type.Union([
  Type.Boolean(),
  Type.Number(),
  Type.String({ maxLength: 256 }),
]);
export type FlagValue = Static<typeof FlagValue>;

/** Typed flag registry entry (ADR-012). */
export const FlagDefinition = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_.-]*$' }),
    type: FlagTypeSchema,
    default: FlagValue,
    description: Type.Optional(Type.String()),
  },
  { $id: 'FlagDefinition' },
);
export type FlagDefinition = Static<typeof FlagDefinition>;

/** Published flag state: rollout % with sticky hash, activate at session boundary, shadow mode. */
export const FlagState = Type.Object(
  {
    key: Type.String(),
    enabled: Type.Boolean(),
    value: FlagValue,
    rolloutPercent: Type.Integer({ minimum: 0, maximum: 100 }),
    /** Value applied to players outside the rollout. */
    fallback: FlagValue,
    shadow: Type.Boolean(),
    activateAtSessionBoundary: Type.Boolean(),
    activateAt: Type.Optional(EpochMs),
    segmentId: Type.Optional(Type.String()),
    version: NonNegInt,
  },
  { $id: 'FlagState' },
);
export type FlagState = Static<typeof FlagState>;

export const ContentVersionInfo = Type.Object(
  {
    kind: ContentKindSchema,
    version: NonNegInt,
    publishedAt: EpochMs,
    minBuildVersion: Type.Optional(Type.String()),
    sha256: Type.String(),
  },
  { $id: 'ContentVersionInfo' },
);
export type ContentVersionInfo = Static<typeof ContentVersionInfo>;

export const ScheduleWindow = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    kind: Type.String({ minLength: 1, maxLength: 64 }),
    startsAt: EpochMs,
    endsAt: Type.Optional(EpochMs),
    payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    segmentId: Type.Optional(Type.String()),
    active: Type.Boolean(),
  },
  { $id: 'ScheduleWindow' },
);
export type ScheduleWindow = Static<typeof ScheduleWindow>;

export const KillSwitches = Type.Object({
  skus: Type.Array(Type.String()),
  commands: Type.Array(Type.String()),
});
export type KillSwitches = Static<typeof KillSwitches>;

/** GET /v1/config — public part + per-player flags after identity. */
export const ConfigResponse = Response(
  {
    gameId: Type.String(),
    env: StringEnum(['prod', 'lab', 'dev'] as const),
    contractVersion: Type.String(),
    buildVersion: Type.Optional(Type.String()),
    minBuildVersion: Type.String(),
    maintenance: Type.Boolean(),
    killSwitches: KillSwitches,
    contentVersions: Type.Array(ContentVersionInfo),
    /** Per-player resolved flags; only present on authenticated calls. */
    flags: Type.Optional(Type.Record(Type.String(), FlagValue)),
    /** Shadow flags evaluate but are reported separately and never applied. */
    shadowFlags: Type.Optional(Type.Record(Type.String(), FlagValue)),
    schedules: Type.Array(ScheduleWindow),
    segmentIds: Type.Optional(Type.Array(Type.String())),
  },
  { $id: 'ConfigResponse' },
);
export type ConfigResponse = Static<typeof ConfigResponse>;

export const SchedulesResponse = Response(
  { schedules: Type.Array(ScheduleWindow) },
  { $id: 'SchedulesResponse' },
);
export type SchedulesResponse = Static<typeof SchedulesResponse>;

/** GET /v1/content/:kind → the published document for this env (or the in-bundle default). */
export const ContentDocumentResponse = Response(
  {
    kind: ContentKindSchema,
    version: NonNegInt,
    document: Type.Unknown(),
    sha256: Type.String(),
    source: StringEnum(['published', 'default'] as const),
  },
  { $id: 'ContentDocumentResponse' },
);
export type ContentDocumentResponse = Static<typeof ContentDocumentResponse>;

export const ContentKindParams = Type.Object({ kind: ContentKindSchema });

/** Segments: JSON predicates over declared facts (§4.3 liveops). */
export const SegmentPredicate = Type.Recursive(
  (This) =>
    Type.Union([
      Type.Object({ all: Type.Array(This) }, { additionalProperties: false }),
      Type.Object({ any: Type.Array(This) }, { additionalProperties: false }),
      Type.Object({ not: This }, { additionalProperties: false }),
      Type.Object(
        {
          fact: Type.String({ maxLength: 64 }),
          op: StringEnum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'] as const),
          value: Type.Union([
            Type.String(),
            Type.Number(),
            Type.Boolean(),
            Type.Array(Type.Union([Type.String(), Type.Number()])),
          ]),
        },
        { additionalProperties: false },
      ),
    ]),
  { $id: 'SegmentPredicate' },
);
export type SegmentPredicate = Static<typeof SegmentPredicate>;

// ─── Admin liveops commands ─────────────────────────────────────────

export const FlagPublishBody = Mutation(
  {
    key: Type.String({ minLength: 1, maxLength: 64 }),
    enabled: Type.Boolean(),
    value: FlagValue,
    rolloutPercent: Type.Integer({ minimum: 0, maximum: 100 }),
    fallback: Type.Optional(FlagValue),
    shadow: Type.Optional(Type.Boolean()),
    activateAtSessionBoundary: Type.Optional(Type.Boolean()),
    activateAt: Type.Optional(EpochMs),
    segmentId: Type.Optional(Type.String()),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'FlagPublishBody' },
);
export type FlagPublishBody = Static<typeof FlagPublishBody>;

export const ContentPublishBody = Mutation(
  {
    kind: ContentKindSchema,
    env: ContentEnvSchema,
    document: Type.Unknown(),
    minBuildVersion: Type.Optional(Type.String()),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'ContentPublishBody' },
);
export type ContentPublishBody = Static<typeof ContentPublishBody>;

export const ContentRevertBody = Mutation(
  {
    kind: ContentKindSchema,
    env: ContentEnvSchema,
    toVersion: NonNegInt,
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'ContentRevertBody' },
);
export type ContentRevertBody = Static<typeof ContentRevertBody>;

export const SchedulePublishBody = Mutation(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    kind: Type.String({ minLength: 1, maxLength: 64 }),
    startsAt: EpochMs,
    endsAt: Type.Optional(EpochMs),
    payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    segmentId: Type.Optional(Type.String()),
    active: Type.Boolean(),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'SchedulePublishBody' },
);
export type SchedulePublishBody = Static<typeof SchedulePublishBody>;

export const SegmentPublishBody = Mutation(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    predicate: SegmentPredicate,
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'SegmentPublishBody' },
);
export type SegmentPublishBody = Static<typeof SegmentPublishBody>;

export const KillSwitchBody = Mutation(
  {
    target: StringEnum(['sku', 'command'] as const),
    id: Type.String({ minLength: 1, maxLength: 128 }),
    enabled: Type.Boolean(),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'KillSwitchBody' },
);
export type KillSwitchBody = Static<typeof KillSwitchBody>;

export const MinBuildBody = Mutation(
  {
    minBuildVersion: Type.String({ minLength: 1, maxLength: 64 }),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'MinBuildBody' },
);
export type MinBuildBody = Static<typeof MinBuildBody>;

export const PublishReceipt = Response(
  { version: NonNegInt, duplicate: Type.Boolean() },
  { $id: 'PublishReceipt' },
);
export type PublishReceipt = Static<typeof PublishReceipt>;

export const SegmentPreviewResponse = Response(
  { id: Type.String(), count: NonNegInt },
  { $id: 'SegmentPreviewResponse' },
);
export type SegmentPreviewResponse = Static<typeof SegmentPreviewResponse>;
