// Audit workspace: the admin action log and outbox dead letters (with replay).
import type {
  AdminActionRecord,
  AdminActionsResponse,
  OutboxDeadLetter,
  OutboxDeadLettersResponse,
} from '@foundation/contracts';
import type { AppCtx } from './context.ts';
import { fmtInt } from './format.ts';
import { writeSummary } from './plans.ts';
import { el, replace, table, text } from './render.ts';
import { emptyState, errorState, loadingState, openDialog, qs, timeEl, tonePill } from './ui.ts';
import { runWrite, type WriteSlot } from './writes.ts';

export interface AuditView {
  /** Load both lists the first time the workspace is shown. */
  show(): void;
}

function scroller(node: HTMLElement): HTMLElement {
  return el('div', { class: 'table-wrap' }, [node]);
}

export function mountAudit(ctx: AppCtx): AuditView {
  const view = qs(ctx.root, '[data-view-panel="audit"]');
  const actionsEl = qs(view, '[data-actions]');
  const deadEl = qs(view, '[data-dead-letters]');
  const filter = qs<HTMLInputElement>(view, '[data-actions-filter]');
  const reasonInput = view.querySelector<HTMLInputElement>('#replay-reason');
  let actions: AdminActionRecord[] = [];
  let actionsNow = 0;
  let loaded = false;

  qs(view, '[data-load-actions]').addEventListener('click', () => void loadActions());
  qs(view, '[data-load-dead]').addEventListener('click', () => void loadDeadLetters());
  filter.addEventListener('input', () => drawActions());

  async function loadActions(): Promise<void> {
    replace(actionsEl, [loadingState()]);
    const res = await ctx.api.get<AdminActionsResponse>('/admin/v1/actions');
    if (!res.ok) {
      replace(actionsEl, [
        errorState(ctx.failure(res), res.error ?? undefined, () => void loadActions()),
      ]);
      return;
    }
    actions = res.body.items;
    actionsNow = res.body.serverNow;
    drawActions();
  }

  function drawActions(): void {
    if (!actions.length) {
      replace(actionsEl, [emptyState('No admin actions yet')]);
      return;
    }
    const q = filter.value.trim().toLowerCase();
    const rows = q
      ? actions.filter((a) =>
          [a.adminKeyId, a.commandType, a.target, a.reason, a.commandId, a.outcome, String(a.id)]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
      : actions;
    if (!rows.length) {
      replace(actionsEl, [emptyState('No matches')]);
      return;
    }
    replace(actionsEl, [
      scroller(
        table<AdminActionRecord>(
          [
            {
              header: 'When',
              cell: (a) =>
                el('div', { class: 'event' }, [
                  timeEl(a.at, actionsNow),
                  text('span', a.adminKeyId, 'event-detail mono'),
                ]),
            },
            {
              header: 'Command',
              cell: (a) => [text('span', a.commandType, 'mono small'), ' ', tonePill(a.scope)],
            },
            {
              header: 'Target',
              cell: (a) => text('span', a.target ?? '', 'mono small'),
              wrap: true,
            },
            {
              header: 'Outcome',
              cell: (a) => tonePill(a.outcome, a.outcome === 'ok' ? 'ok' : 'danger'),
            },
            { header: 'Reason', cell: (a) => a.reason ?? '', wrap: true },
            {
              header: 'ID',
              cell: (a) => {
                const s = text('span', `#${a.id}`, 'mono small muted');
                s.title = `commandId ${a.commandId}`;
                return s;
              },
            },
          ],
          rows,
        ),
      ),
      rows.length < actions.length
        ? text('p', `${fmtInt(rows.length)} of ${fmtInt(actions.length)}`, 'table-foot')
        : null,
    ]);
  }

  // ─── Dead letters + replay ──────────────────────────────────────
  // One slot per dead letter: a retry after a network error reuses that letter's commandId.
  const replaySlots = new Map<number, WriteSlot>();

  async function loadDeadLetters(): Promise<void> {
    replace(deadEl, [loadingState()]);
    const res = await ctx.api.get<OutboxDeadLettersResponse>('/admin/v1/outbox/dead-letters');
    if (!res.ok) {
      replace(deadEl, [
        errorState(ctx.failure(res), res.error ?? undefined, () => void loadDeadLetters()),
      ]);
      return;
    }
    const now = res.body.serverNow;
    if (!res.body.items.length) {
      replace(deadEl, [emptyState('No dead letters')]);
      return;
    }
    const canReplay = ctx.access.can('deadLetterReplay') && reasonInput !== null;
    replace(deadEl, [
      scroller(
        table<OutboxDeadLetter>(
          [
            { header: 'Dead', cell: (d) => timeEl(d.deadAt, now) },
            {
              header: 'Outbox',
              cell: (d) => text('span', `#${d.outboxId}`, 'mono small'),
            },
            { header: 'Consumer', cell: (d) => text('span', d.consumer, 'mono small') },
            { header: 'Kind', cell: (d) => tonePill(d.kind) },
            { header: 'Attempts', cell: (d) => fmtInt(d.attempts) },
            { header: 'Last error', cell: (d) => text('span', d.lastError, 'small'), wrap: true },
            {
              header: 'Replayed',
              cell: (d) => (d.replayedAt ? timeEl(d.replayedAt, now) : text('span', '—', 'muted')),
            },
            ...(canReplay
              ? [
                  {
                    header: '',
                    cell: (d: OutboxDeadLetter) => {
                      const b = el(
                        'button',
                        { type: 'button', class: 'btn btn-secondary btn-xs' },
                        ['Replay'],
                      );
                      b.addEventListener('click', () => openReplay(d));
                      return b;
                    },
                  },
                ]
              : []),
          ],
          res.body.items,
        ),
      ),
    ]);
  }

  function openReplay(d: OutboxDeadLetter): void {
    if (!reasonInput) return;
    const reason = reasonInput.value.trim();
    if (!reason) {
      ctx.notify('Enter a replay reason first.', 'warn');
      reasonInput.focus();
      return;
    }
    const slot = replaySlots.get(d.id) ?? {};
    replaySlots.set(d.id, slot);
    const payload = { outboxId: d.outboxId, consumer: d.consumer, reason };
    const summary = writeSummary('replay', payload);
    openDialog(ctx.writes.dialog, {
      ...summary,
      rows: [
        ...summary.rows.slice(0, 1),
        ['Kind', d.kind],
        ['Attempts', fmtInt(d.attempts)],
        ['Last error', d.lastError.length > 160 ? `${d.lastError.slice(0, 159)}…` : d.lastError],
        ...summary.rows.slice(1),
      ],
      run: (report) =>
        void runWrite(ctx.writes, slot, report, 'replay', '/admin/v1/outbox/replay', payload),
    });
  }

  return {
    show() {
      if (loaded) return;
      loaded = true;
      void loadActions();
      void loadDeadLetters();
    },
  };
}
