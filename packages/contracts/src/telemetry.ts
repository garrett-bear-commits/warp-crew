import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, Response, StringEnum } from './common.ts';
import { INTEGRITY_EVENT_KINDS, JOURNAL_ENTRY_KINDS, LIMITS } from './enums.ts';

export const IntegrityEventKindSchema = StringEnum(INTEGRITY_EVENT_KINDS);
export const JournalEntryKindSchema = StringEnum(JOURNAL_ENTRY_KINDS);

export const IntegrityEvent = Type.Object(
  {
    kind: IntegrityEventKindSchema,
    at: EpochMs,
    /** Bounded, allow-listed detail (no free text beyond `message`, which is truncated server-side). */
    detail: Type.Optional(
      Type.Record(
        Type.String({ maxLength: 32 }),
        Type.Union([Type.String({ maxLength: 256 }), Type.Number(), Type.Boolean()]),
      ),
    ),
    message: Type.Optional(Type.String({ maxLength: 512 })),
    /** game_error breadcrumbs = last 20 name+tick. */
    breadcrumbs: Type.Optional(
      Type.Array(Type.Object({ name: Type.String({ maxLength: 64 }), tick: NonNegInt }), {
        maxItems: 20,
      }),
    ),
    buildVersion: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { $id: 'IntegrityEvent' },
);
export type IntegrityEvent = Static<typeof IntegrityEvent>;

/** POST /v1/telemetry/integrity {commandId, events[]} (≤20/call, daily budget) */
export const IntegrityBatchBody = Mutation(
  { events: Type.Array(IntegrityEvent, { minItems: 1, maxItems: LIMITS.integrityEventsPerCall }) },
  { $id: 'IntegrityBatchBody' },
);
export type IntegrityBatchBody = Static<typeof IntegrityBatchBody>;

export const IntegrityBatchResult = Response(
  { accepted: NonNegInt, dropped: NonNegInt, budgetRemaining: NonNegInt },
  { $id: 'IntegrityBatchResult' },
);
export type IntegrityBatchResult = Static<typeof IntegrityBatchResult>;

/** Journal records inputs {tick, now, kind, name, args?} (§5.2). */
export const JournalEntry = Type.Object(
  {
    tick: NonNegInt,
    now: EpochMs,
    kind: JournalEntryKindSchema,
    name: Type.String({ minLength: 1, maxLength: 64 }),
    /** Only for actions with a bounded schema; never free text. */
    args: Type.Optional(
      Type.Record(
        Type.String({ maxLength: 32 }),
        Type.Union([Type.Number(), Type.Boolean(), Type.String({ maxLength: 64 })]),
      ),
    ),
  },
  { $id: 'JournalEntry' },
);
export type JournalEntry = Static<typeof JournalEntry>;

/** POST /v1/journal {commandId, fromSeq, generation, entries[]} (≤16 KiB per call, timer path only) */
export const JournalShipBody = Mutation(
  {
    generation: NonNegInt,
    /** Monotonic within (player, generation): the server rejects non-increasing fromSeq. */
    fromSeq: NonNegInt,
    entries: Type.Array(JournalEntry, { minItems: 1, maxItems: 500 }),
    buildVersion: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { $id: 'JournalShipBody' },
);
export type JournalShipBody = Static<typeof JournalShipBody>;

export const JournalShipResult = Response(
  {
    accepted: NonNegInt,
    dropped: NonNegInt,
    nextSeq: NonNegInt,
    outcome: StringEnum([
      'stored',
      'duplicate',
      'refused_non_monotonic',
      'refused_budget',
      'disabled',
    ] as const),
  },
  { $id: 'JournalShipResult' },
);
export type JournalShipResult = Static<typeof JournalShipResult>;
