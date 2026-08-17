import { Type, type Static } from '@sinclair/typebox';
import {
  BuildVersion,
  EpochMs,
  Mutation,
  NonNegInt,
  PosInt,
  Response,
  SafeInt,
  SaveReasonSchema,
  StringEnum,
  Uuid,
} from './common.ts';
import {
  GENERATION_KINDS,
  SAVE_DISPOSITIONS,
  SAVE_ENCODINGS,
  SAVE_FLAGS,
  SAVE_REFUSAL_REASONS,
} from './enums.ts';

export const SaveDispositionSchema = StringEnum(SAVE_DISPOSITIONS);
export const SaveRefusalReasonSchema = StringEnum(SAVE_REFUSAL_REASONS);
export const SaveFlagSchema = StringEnum(SAVE_FLAGS);
export const SaveEncodingSchema = StringEnum(SAVE_ENCODINGS);
export const GenerationKindSchema = StringEnum(GENERATION_KINDS);

/** Only the fields the server may read out of a blob (§5.1 summary). Declared scalars only. */
export const Summary = Type.Record(Type.String({ maxLength: 64 }), Type.Number(), {
  description:
    'Declared summary scalars (client claim). The server reads nothing else from a blob.',
});
export type Summary = Static<typeof Summary>;

/** PUT /v1/saves + POST /v1/saves/beacon body (Appendix). */
export const SaveWriteBody = Mutation(
  {
    generation: NonNegInt,
    clientSeq: NonNegInt,
    baseSeq: NonNegInt,
    sessionId: Uuid,
    progress: SafeInt,
    savedAt: EpochMs,
    schemaVersion: PosInt,
    buildVersion: BuildVersion,
    enc: SaveEncodingSchema,
    reason: SaveReasonSchema,
    /** Canonical UTF-8 JSON when enc=json, base64(gzip(json)) when enc=gzip+b64. */
    blob: Type.String({ minLength: 2 }),
    /** Optional client-declared summary; the server re-derives from the blob when policy says so. */
    summary: Type.Optional(Summary),
  },
  { $id: 'SaveWriteBody' },
);
export type SaveWriteBody = Static<typeof SaveWriteBody>;

/** Beacon route: same body plus auth fields inside the text/plain body (§4.2 CORS). */
export const SaveBeaconBody = Type.Object(
  {
    ...SaveWriteBody.properties,
    playerKey: Type.String({ minLength: 1, maxLength: 128 }),
    token: Type.String({ minLength: 1 }),
    requestId: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { $id: 'SaveBeaconBody', additionalProperties: false },
);
export type SaveBeaconBody = Static<typeof SaveBeaconBody>;

export const Divergence = Type.Object(
  {
    headSeq: NonNegInt,
    headSummary: Type.Optional(Summary),
    headWriterAt: EpochMs,
    headSessionId: Type.Optional(Uuid),
  },
  { $id: 'Divergence' },
);
export type Divergence = Static<typeof Divergence>;

export const SaveWriteResult = Response(
  {
    disposition: SaveDispositionSchema,
    reason: Type.Optional(SaveRefusalReasonSchema),
    flags: Type.Optional(Type.Array(SaveFlagSchema)),
    seq: NonNegInt,
    /** Deepest anchored progress in the active generation after this write. */
    currentProgress: SafeInt,
    generation: NonNegInt,
    blobSha256: Type.String({ minLength: 64, maxLength: 64 }),
    divergent: Type.Optional(Divergence),
  },
  { $id: 'SaveWriteResult' },
);
export type SaveWriteResult = Static<typeof SaveWriteResult>;

export const SnapshotMeta = Type.Object(
  {
    seq: NonNegInt,
    generation: NonNegInt,
    progress: SafeInt,
    clientSeq: NonNegInt,
    baseSeq: NonNegInt,
    sessionId: Uuid,
    commandId: Uuid,
    savedAt: EpochMs,
    receivedAt: EpochMs,
    bytes: NonNegInt,
    encBytes: NonNegInt,
    blobSha256: Type.String(),
    schemaVersion: PosInt,
    buildVersion: BuildVersion,
    reason: SaveReasonSchema,
    disposition: SaveDispositionSchema,
    rejectReason: Type.Optional(SaveRefusalReasonSchema),
    flags: Type.Array(SaveFlagSchema),
    summary: Type.Optional(Summary),
    hasBlob: Type.Boolean(),
    review: Type.Optional(
      Type.Object({ action: StringEnum(['promote', 'reject'] as const), at: EpochMs }),
    ),
  },
  { $id: 'SnapshotMeta' },
);
export type SnapshotMeta = Static<typeof SnapshotMeta>;

export const PendingQuarantine = Type.Object(
  {
    seq: NonNegInt,
    progress: SafeInt,
    flags: Type.Array(SaveFlagSchema),
    receivedAt: EpochMs,
  },
  { $id: 'PendingQuarantine' },
);
export type PendingQuarantine = Static<typeof PendingQuarantine>;

export const LineageInfo = Type.Object({
  generation: NonNegInt,
  kind: GenerationKindSchema,
  openedAt: EpochMs,
  seedSeq: Type.Optional(NonNegInt),
});
export type LineageInfo = Static<typeof LineageInfo>;

/** GET /v1/saves/current[?meta=1] */
export const SaveCurrentResponse = Response(
  {
    empty: Type.Boolean(),
    generation: NonNegInt,
    lineage: Type.Optional(LineageInfo),
    snapshot: Type.Optional(SnapshotMeta),
    /** Present only without ?meta=1 and when a blob exists. */
    blob: Type.Optional(Type.String()),
    enc: Type.Optional(SaveEncodingSchema),
    pendingQuarantine: Type.Optional(PendingQuarantine),
    erased: Type.Optional(Type.Boolean()),
  },
  { $id: 'SaveCurrentResponse' },
);
export type SaveCurrentResponse = Static<typeof SaveCurrentResponse>;

export const SaveHistoryQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  beforeSeq: Type.Optional(NonNegInt),
  generation: Type.Optional(NonNegInt),
});

export const SaveHistoryResponse = Response(
  {
    generation: NonNegInt,
    items: Type.Array(SnapshotMeta),
  },
  { $id: 'SaveHistoryResponse' },
);
export type SaveHistoryResponse = Static<typeof SaveHistoryResponse>;

export const SaveBlobResponse = Response(
  {
    seq: NonNegInt,
    generation: NonNegInt,
    enc: SaveEncodingSchema,
    blob: Type.String(),
    blobSha256: Type.String(),
  },
  { $id: 'SaveBlobResponse' },
);
export type SaveBlobResponse = Static<typeof SaveBlobResponse>;

export const SeqParams = Type.Object({ seq: Type.String({ pattern: '^[0-9]{1,15}$' }) });
export const CurrentQuery = Type.Object({
  meta: Type.Optional(Type.Union([Type.Literal('1'), Type.Literal('0')])),
});
