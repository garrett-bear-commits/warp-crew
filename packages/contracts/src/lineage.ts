import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, Response, Uuid } from './common.ts';
import { GenerationKindSchema, SaveEncodingSchema } from './saves.ts';

/** POST /v1/lineage/restart {commandId, restartId, expectedGeneration} → receipt | 409 stale_generation */
export const LineageRestartBody = Mutation(
  {
    /** Business key: the same restartId can never open two generations. */
    restartId: Uuid,
    expectedGeneration: NonNegInt,
  },
  { $id: 'LineageRestartBody' },
);
export type LineageRestartBody = Static<typeof LineageRestartBody>;

/** POST /v1/lineage/restoreToSeq {commandId, seq, expectedGeneration} (player restore-to-point) */
export const LineageRestoreToSeqBody = Mutation(
  {
    seq: NonNegInt,
    expectedGeneration: NonNegInt,
  },
  { $id: 'LineageRestoreToSeqBody' },
);
export type LineageRestoreToSeqBody = Static<typeof LineageRestoreToSeqBody>;

/** POST /v1/lineage/reattach {commandId, clientGeneration, expectedServerGeneration, snapshot} */
export const LineageReattachBody = Mutation(
  {
    clientGeneration: NonNegInt,
    expectedServerGeneration: NonNegInt,
    snapshot: Type.Object({
      progress: NonNegInt,
      schemaVersion: Type.Integer({ minimum: 1 }),
      buildVersion: Type.String({ minLength: 1, maxLength: 64 }),
      enc: SaveEncodingSchema,
      blob: Type.String({ minLength: 2 }),
      savedAt: EpochMs,
    }),
  },
  { $id: 'LineageReattachBody' },
);
export type LineageReattachBody = Static<typeof LineageReattachBody>;

export const GenerationReceipt = Response(
  {
    generation: NonNegInt,
    kind: GenerationKindSchema,
    seedSeq: Type.Optional(NonNegInt),
    /** Entitlement (Σpaid − Σrefunded) carried into the new generation; only for kind=restart. */
    entitlement: Type.Optional(NonNegInt),
    duplicate: Type.Boolean(),
  },
  { $id: 'GenerationReceipt' },
);
export type GenerationReceipt = Static<typeof GenerationReceipt>;
