// inbox feature (§4.3): support letters (append-only, may reference a grant), announcements
// (schedule + segment), server-side read/claimed state, feedback with status.
import type { FastifyInstance } from 'fastify';
import {
  InboxReadBody,
  FeedbackBody,
  AdminLetterBody,
  AdminAnnouncementBody,
  type InboxResponse,
  type InboxLetter,
  type FeedbackResult,
  type PublishReceipt,
} from '@foundation/contracts';
import { defineCommand } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import { actorLabel } from '../../cqrs/bus.ts';
import { evaluateSegment } from '../liveops/contract.ts';
import { playerFacts } from '../../game/facts.ts';
import type { SegmentPredicate } from '@foundation/contracts';

type Ok = { ok: true };
type Fb = Omit<FeedbackResult, 'serverNow' | 'requestId'>;
type Receipt = Omit<PublishReceipt, 'serverNow' | 'requestId'>;

export const InboxRead = defineCommand<typeof InboxReadBody, Ok>({
  type: 'inbox.read',
  schema: InboxReadBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '7d' },
  tx: 'required',
  limit: 'inbox',
});
export const InboxFeedback = defineCommand<typeof FeedbackBody, Fb>({
  type: 'inbox.feedback',
  schema: FeedbackBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'inbox',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const AdminLetter = defineCommand<typeof AdminLetterBody, Ok>({
  type: 'inbox.sendLetter',
  schema: AdminLetterBody,
  actorPolicy: { admin: 'support' },
  scope: 'game',
  lock: 'none',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
});
export const AdminAnnouncement = defineCommand<typeof AdminAnnouncementBody, Receipt>({
  type: 'inbox.publishAnnouncement',
  schema: AdminAnnouncementBody,
  actorPolicy: { admin: 'publish' },
  scope: 'game',
  lock: 'game',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});

export function registerInbox(app: FastifyInstance, ctx: AppContext): void {
  const { bus } = ctx;
  ctx.declaredCommands.push(InboxRead, InboxFeedback, AdminLetter, AdminAnnouncement);

  bus.register(InboxRead, async (input, exec, tx) => {
    const t = tx!;
    const playerKey = exec.playerKey!;
    for (const id of input.letterIds) {
      await t`INSERT INTO support_message_reads (player_key, message_id) SELECT ${playerKey}, id FROM support_messages WHERE id = ${id} AND player_key = ${playerKey} ON CONFLICT DO NOTHING`;
    }
    return { ok: true as const };
  });

  bus.register(InboxFeedback, async (input, exec, tx) => {
    const rows = await tx!<
      { id: string; status: 'new' }[]
    >`INSERT INTO feedback (player_key, category, body, build_version, command_id) VALUES (${exec.playerKey!}, ${input.category}, ${input.body}, ${input.buildVersion ?? exec.buildVersion ?? null}, ${input.commandId}) RETURNING id, status`;
    return { id: Number(rows[0]!.id), status: rows[0]!.status, duplicate: false };
  });

  bus.register(AdminLetter, async (input, exec, tx) => {
    const t = tx!;
    if (input.grantKey) {
      const g = await t<
        { id: string }[]
      >`SELECT id FROM grants WHERE player_key = ${input.playerKey} AND grant_key = ${input.grantKey}`;
      if (!g[0])
        throw new AppError(
          'not_found',
          `grant ${input.grantKey} does not exist for player; mint it first`,
        );
    }
    await t`INSERT INTO support_messages (player_key, title, body, grant_key, reason, ticket_ref, actor, command_id) VALUES (${input.playerKey}, ${input.title}, ${input.body}, ${input.grantKey ?? null}, ${input.reason}, ${input.ticketRef ?? null}, ${actorLabel(exec)}, ${input.commandId})`;
    await ctx.outbox.emit(t, {
      kind: 'inbox.letterSent',
      playerKey: input.playerKey,
      payload: { title: input.title, grantKey: input.grantKey ?? null },
      commandId: input.commandId,
    });
    return { ok: true as const };
  });

  bus.register(AdminAnnouncement, async (input, exec, tx) => {
    const t = tx!;
    const rows = await t<{ version: number }[]>`
      INSERT INTO announcements (announcement_id, title, body, starts_at, ends_at, segment_id, grant_key, actor, reason)
      VALUES (${input.id}, ${input.title}, ${input.body}, ${new Date(input.startsAt)}, ${input.endsAt ? new Date(input.endsAt) : null}, ${input.segmentId ?? null}, ${input.grantKey ?? null}, ${actorLabel(exec)}, ${input.reason})
      ON CONFLICT (announcement_id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, segment_id = EXCLUDED.segment_id, grant_key = EXCLUDED.grant_key, actor = EXCLUDED.actor, reason = EXCLUDED.reason, version = announcements.version + 1, updated_at = now()
      RETURNING version`;
    return { version: rows[0]!.version, duplicate: false };
  });

  route<undefined, typeof import('@foundation/contracts').InboxResponse>(
    app,
    ctx,
    'inbox.list',
    async ({ exec, now }) => {
      const playerKey = exec!.playerKey!;
      const sql = ctx.db.sql;
      const letters: InboxLetter[] = [];
      const sm = await sql<
        {
          id: string;
          title: string;
          body: string;
          grant_key: string | null;
          created_at: Date;
          expires_at: Date | null;
          read_at: Date | null;
          claimed_at: Date | null;
        }[]
      >`
      SELECT m.id, m.title, m.body, m.grant_key, m.created_at, m.expires_at, r.read_at,
        (SELECT c.claimed_at FROM grants g JOIN grant_claims c ON c.grant_id = g.id WHERE g.player_key = m.player_key AND g.grant_key = m.grant_key) AS claimed_at
      FROM support_messages m LEFT JOIN support_message_reads r ON r.message_id = m.id AND r.player_key = m.player_key
      WHERE m.player_key = ${playerKey} AND (m.expires_at IS NULL OR m.expires_at > ${new Date(now)}) ORDER BY m.created_at DESC LIMIT 100`;
      for (const m of sm)
        letters.push({
          id: Number(m.id),
          kind: 'support',
          title: m.title,
          body: m.body,
          ...(m.grant_key ? { grantKey: m.grant_key } : {}),
          createdAt: m.created_at.getTime(),
          ...(m.read_at ? { readAt: m.read_at.getTime() } : {}),
          ...(m.claimed_at ? { claimedAt: m.claimed_at.getTime() } : {}),
          ...(m.expires_at ? { expiresAt: m.expires_at.getTime() } : {}),
        });
      const ann = await sql<
        {
          announcement_id: string;
          title: string;
          body: string;
          starts_at: Date;
          ends_at: Date | null;
          segment_id: string | null;
          grant_key: string | null;
          read_at: Date | null;
          predicate: SegmentPredicate | null;
        }[]
      >`
      SELECT a.announcement_id, a.title, a.body, a.starts_at, a.ends_at, a.segment_id, a.grant_key, r.read_at, s.predicate
      FROM announcements a LEFT JOIN announcement_reads r ON r.announcement_id = a.announcement_id AND r.player_key = ${playerKey}
      LEFT JOIN segments s ON s.segment_id = a.segment_id
      WHERE a.starts_at <= ${new Date(now)} AND (a.ends_at IS NULL OR a.ends_at > ${new Date(now)}) ORDER BY a.starts_at DESC LIMIT 50`;
      const facts = ann.some((a) => a.segment_id) ? await playerFacts(sql, playerKey, now) : null;
      let idx = 1_000_000_000; // announcement ids are strings; expose a stable numeric id derived from position + hash
      for (const a of ann) {
        if (a.segment_id && !(a.predicate && facts && evaluateSegment(a.predicate, facts)))
          continue;
        letters.push({
          id: idx++,
          kind: 'announcement',
          title: a.title,
          body: a.body,
          ...(a.grant_key ? { grantKey: a.grant_key } : {}),
          createdAt: a.starts_at.getTime(),
          ...(a.read_at ? { readAt: a.read_at.getTime() } : {}),
          ...(a.ends_at ? { expiresAt: a.ends_at.getTime() } : {}),
        });
      }
      letters.sort((x, y) => y.createdAt - x.createdAt);
      const out: Omit<InboxResponse, 'serverNow' | 'requestId'> = {
        letters,
        unread: letters.filter((l) => !l.readAt).length,
      };
      return out;
    },
  );
  route<typeof InboxReadBody, typeof import('@foundation/contracts').Ok>(
    app,
    ctx,
    'inbox.read',
    async ({ body, exec }) =>
      bus.execute(InboxRead, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof FeedbackBody, typeof import('@foundation/contracts').FeedbackResult>(
    app,
    ctx,
    'inbox.feedback',
    async ({ body, exec }) =>
      bus.execute(InboxFeedback, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof AdminLetterBody, typeof import('@foundation/contracts').Ok>(
    app,
    ctx,
    'admin.letter',
    async ({ body, exec }) =>
      bus.execute(AdminLetter, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof AdminAnnouncementBody, typeof import('@foundation/contracts').PublishReceipt>(
    app,
    ctx,
    'admin.announcement',
    async ({ body, exec }) =>
      bus.execute(AdminAnnouncement, { commandId: body.commandId, payload: body }, exec!),
  );
}
