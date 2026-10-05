import { Type, type Static, type TSchema, type TLiteral, type TUnion } from '@sinclair/typebox';
import { ERROR_CODES, SAVE_REASONS } from './enums.ts';

/** Build a closed TypeBox union from a readonly string tuple (keeps enums as the single source). */
export function StringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string } = {},
): TUnion<TLiteral<T[number]>[]> {
  return Type.Union(
    values.map((v) => Type.Literal(v)) as unknown as TLiteral<T[number]>[],
    options,
  );
}

export const Uuid = Type.String({
  format: 'uuid',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  description: 'RFC 4122 UUID (client-minted for commandId).',
});

/** JavaScript safe integer 0 ≤ p ≤ 2^53−1 (§1 progress ordinal). BIGINT in Postgres. */
export const SafeInt = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const NonNegInt = Type.Integer({ minimum: 0 });
export const PosInt = Type.Integer({ minimum: 1 });
/** Epoch milliseconds. */
export const EpochMs = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

export const PlayerKey = Type.String({ minLength: 1, maxLength: 128 });
export const BuildVersion = Type.String({ minLength: 1, maxLength: 64 });
export const RequestId = Type.String({ minLength: 1, maxLength: 128 });
export const ShortText = Type.String({ maxLength: 256 });
export const Reason = Type.String({ minLength: 1, maxLength: 512 });

/**
 * Every mutating body carries a client-minted commandId (§6). Every command body schema
 * is composed from this base and a test iterates every route to enforce it.
 */
export const MutationBody = Type.Object(
  {
    commandId: Uuid,
  },
  { $id: 'MutationBody' },
);
export type MutationBody = Static<typeof MutationBody>;

/** Compose a mutation body: MutationBody + payload fields, closed. */
export function Mutation<T extends Record<string, TSchema>>(
  props: T,
  options: { $id?: string; description?: string } = {},
) {
  return Type.Object({ commandId: Uuid, ...props }, { additionalProperties: false, ...options });
}

export const ServerNow = EpochMs;

/** Every response carries serverNow (§1 server clock). */
export const WithServerNow = Type.Object({ serverNow: ServerNow, requestId: RequestId });

export function Response<T extends Record<string, TSchema>>(
  props: T,
  options: { $id?: string } = {},
) {
  return Type.Object({ ...props, serverNow: ServerNow, requestId: RequestId }, options);
}

export const ErrorCodeSchema = StringEnum(ERROR_CODES, { description: 'Closed ErrorCode union.' });

/** One error envelope (§4.2). */
export const ErrorEnvelope = Type.Object(
  {
    error: ErrorCodeSchema,
    message: Type.Optional(Type.String()),
    correlationId: Type.String(),
    details: Type.Optional(Type.Unknown()),
    serverNow: Type.Optional(ServerNow),
  },
  { $id: 'ErrorEnvelope', additionalProperties: false },
);
export type ErrorEnvelope = Static<typeof ErrorEnvelope>;

export const SaveReasonSchema = StringEnum(SAVE_REASONS);

export const Ok = Response({ ok: Type.Literal(true) });
export type Ok = Static<typeof Ok>;
