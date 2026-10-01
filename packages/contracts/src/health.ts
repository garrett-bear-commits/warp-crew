import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, NonNegInt, StringEnum } from './common.ts';

export const HealthResponse = Type.Object(
  { status: Type.Literal('ok'), serverNow: EpochMs, contractVersion: Type.String() },
  { $id: 'HealthResponse' },
);
export type HealthResponse = Static<typeof HealthResponse>;

export const ReadyResponse = Type.Object(
  {
    status: StringEnum(['ready', 'not_ready'] as const),
    serverNow: EpochMs,
    contractVersion: Type.String(),
    checks: Type.Object({
      db: Type.Boolean(),
      migrationsAtHead: Type.Boolean(),
      schemaHead: Type.Optional(Type.String()),
      secretsPresent: Type.Boolean(),
      secretByteLengths: Type.Array(NonNegInt),
      adminKeyCount: NonNegInt,
    }),
    gameId: Type.String(),
    env: Type.String(),
    buildVersion: Type.Optional(Type.String()),
    /** Git commit this build was made from (the deploy records it in BUILD_INFO_FILE). */
    commit: Type.Optional(Type.String()),
  },
  { $id: 'ReadyResponse' },
);
export type ReadyResponse = Static<typeof ReadyResponse>;

export const OpsIssue = Type.Object({
  tier: StringEnum(['page', 'warn'] as const),
  code: Type.String(),
  message: Type.String(),
  value: Type.Optional(Type.Number()),
  threshold: Type.Optional(Type.Number()),
});

export const OpsSnapshotResponse = Type.Object(
  {
    status: StringEnum(['ok', 'warn', 'page'] as const),
    serverNow: EpochMs,
    windowMinutes: NonNegInt,
    commands: Type.Object({
      total: NonNegInt,
      errors: NonNegInt,
      refusals: NonNegInt,
      p95Ms: Type.Number(),
      byType: Type.Array(
        Type.Object({
          type: Type.String(),
          count: NonNegInt,
          p95Ms: Type.Number(),
          errors: NonNegInt,
        }),
      ),
    }),
    outbox: Type.Object({ pending: NonNegInt, lagSeconds: Type.Number(), deadLetters: NonNegInt }),
    jobs: Type.Array(
      Type.Object({
        name: Type.String(),
        lastRunAt: Type.Optional(EpochMs),
        lastOk: Type.Optional(Type.Boolean()),
        overdue: Type.Boolean(),
      }),
    ),
    saves: Type.Object({
      anchored: NonNegInt,
      quarantined: NonNegInt,
      refused: NonNegInt,
      pendingReviews: NonNegInt,
    }),
    purchases: Type.Object({ paid: NonNegInt, sandbox: NonNegInt, unclassified: NonNegInt }),
    /** This instance's responses in the window (not the fleet): failures that never reach a
     *  command row, such as raw 500s and the 401 and 429 refusals. Health checks excluded. */
    http: Type.Optional(
      Type.Object({
        total: NonNegInt,
        serverErrors: NonNegInt,
        unauthorized: NonNegInt,
        rateLimited: NonNegInt,
      }),
    ),
    /** Written only by an isolated-restore verification (dr). */
    restoreVerifiedAt: Type.Optional(EpochMs),
    /** Weekly self-check of the live database's newest anchored blobs. */
    liveIntegrityVerifiedAt: Type.Optional(EpochMs),
    issues: Type.Array(OpsIssue),
  },
  { $id: 'OpsSnapshotResponse' },
);
export type OpsSnapshotResponse = Static<typeof OpsSnapshotResponse>;

export const OpsQuery = Type.Object({
  assert: Type.Optional(StringEnum(['page', 'warn', '1'] as const)),
});
