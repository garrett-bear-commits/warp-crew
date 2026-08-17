import { Type, type Static } from '@sinclair/typebox';
import { EpochMs, Mutation, NonNegInt, Response, StringEnum } from './common.ts';
import { FEEDBACK_STATUSES } from './enums.ts';
import { GrantKey } from './grants.ts';

export const FeedbackStatusSchema = StringEnum(FEEDBACK_STATUSES);

export const InboxLetter = Type.Object(
  {
    id: NonNegInt,
    kind: StringEnum(['support', 'announcement'] as const),
    title: Type.String(),
    body: Type.String(),
    grantKey: Type.Optional(GrantKey),
    createdAt: EpochMs,
    readAt: Type.Optional(EpochMs),
    claimedAt: Type.Optional(EpochMs),
    expiresAt: Type.Optional(EpochMs),
  },
  { $id: 'InboxLetter' },
);
export type InboxLetter = Static<typeof InboxLetter>;

/** GET /v1/inbox */
export const InboxResponse = Response(
  { letters: Type.Array(InboxLetter), unread: NonNegInt },
  { $id: 'InboxResponse' },
);
export type InboxResponse = Static<typeof InboxResponse>;

/** POST /v1/inbox/read {commandId, letterIds[]} — server-side read state. */
export const InboxReadBody = Mutation(
  { letterIds: Type.Array(NonNegInt, { minItems: 1, maxItems: 100 }) },
  { $id: 'InboxReadBody' },
);
export type InboxReadBody = Static<typeof InboxReadBody>;

/** POST /v1/feedback {commandId, category, body} */
export const FeedbackBody = Mutation(
  {
    category: Type.String({ minLength: 1, maxLength: 32 }),
    body: Type.String({ minLength: 1, maxLength: 2000 }),
    buildVersion: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { $id: 'FeedbackBody' },
);
export type FeedbackBody = Static<typeof FeedbackBody>;

export const FeedbackResult = Response(
  { id: NonNegInt, status: FeedbackStatusSchema, duplicate: Type.Boolean() },
  { $id: 'FeedbackResult' },
);
export type FeedbackResult = Static<typeof FeedbackResult>;

// ─── Admin ────────────────────────────────────────────────────────

/** Admin: send a support letter (scope support), optionally referencing a grant. */
export const AdminLetterBody = Mutation(
  {
    playerKey: Type.String({ minLength: 1, maxLength: 128 }),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    body: Type.String({ minLength: 1, maxLength: 4000 }),
    grantKey: Type.Optional(GrantKey),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
    ticketRef: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { $id: 'AdminLetterBody' },
);
export type AdminLetterBody = Static<typeof AdminLetterBody>;

export const AdminAnnouncementBody = Mutation(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    body: Type.String({ minLength: 1, maxLength: 4000 }),
    startsAt: EpochMs,
    endsAt: Type.Optional(EpochMs),
    segmentId: Type.Optional(Type.String()),
    grantKey: Type.Optional(GrantKey),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { $id: 'AdminAnnouncementBody' },
);
export type AdminAnnouncementBody = Static<typeof AdminAnnouncementBody>;
