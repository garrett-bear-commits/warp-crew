// Players workspace: search, overview cards, timeline / saves / save viewer tabs, save safety
// (restore, quarantine review, incognito) on the saves rows, and the player actions panel.
import type {
  PlayerOverview,
  SaveBlobResponse,
  SaveHistoryResponse,
  SnapshotMeta,
  TimelineItem,
  TimelineResponse,
} from '@foundation/contracts';
import type { AppCtx } from './context.ts';
import { absTime, fmtBytes, fmtInt, humanize, relTime } from './format.ts';
import { dispositionLabel, restorePlan, rewardsText } from './plans.ts';
import { ADJUSTMENT_SPEC, adjustmentFromFields, bindAdjustmentForm } from './purchases.ts';
import { clear, el, fmtValue, jsonTree, replace, table, text } from './render.ts';
import { bindRewardFields, REWARD_SPEC, withRewards } from './rewards.ts';
import {
  bindTabs,
  emptyState,
  errorState,
  field,
  loadingState,
  openDialog,
  qs,
  skeletonStats,
  statCard,
  timeEl,
  tonePill,
  type Tone,
} from './ui.ts';
import {
  bindWriteForm,
  runWrite,
  type BoundWrite,
  type FieldSpec,
  type WriteSlot,
} from './writes.ts';

const SAVES_PAGE = 100;

interface Loaded {
  playerKey: string;
  overview: PlayerOverview | null;
  saves: SnapshotMeta[];
  /** serverNow of the overview (relative times). */
  now: number | undefined;
}

const S = (name: string, label: string, kind: FieldSpec['kind'] = 'string'): FieldSpec => ({
  name,
  label,
  kind,
});

function dispositionTone(d: string): Tone {
  if (d === 'anchored') return 'ok';
  if (d === 'stored_quarantined') return 'warn';
  if (d === 'stored_refused') return 'danger';
  return 'neutral';
}

function timelineTone(kind: string): Tone {
  switch (kind) {
    case 'save':
      return 'info';
    case 'purchase':
    case 'grant':
      return 'ok';
    case 'generation':
      return 'warn';
    case 'integrity':
    case 'erasure':
      return 'danger';
    default:
      return 'neutral';
  }
}

function valueText(key: string, v: unknown): string {
  if (key === 'rewards') return rewardsText(v);
  if (key === 'bytes' && typeof v === 'number') return fmtBytes(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object'))
    return v.map(fmtValue).join(', ');
  return fmtValue(v);
}

/** Readable one-liner for a timeline detail ("generation 2 · reason autosave · bytes 19 KB"). */
export function detailText(detail: unknown): string {
  if (detail === undefined || detail === null) return '';
  if (typeof detail !== 'object' || Array.isArray(detail)) return fmtValue(detail);
  const parts: string[] = [];
  const walk = (obj: Record<string, unknown>, depth: number): void => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      // One nested object (integrity's {detail: {...}}) is flattened into the line.
      if (typeof v === 'object' && !Array.isArray(v) && depth === 0) {
        walk(v as Record<string, unknown>, 1);
        continue;
      }
      const value = valueText(k, v);
      parts.push(`${k} ${value.length > 60 ? `${value.slice(0, 59)}…` : value}`);
    }
  };
  walk(detail as Record<string, unknown>, 0);
  return parts.join(' · ');
}

function scroller(node: HTMLElement): HTMLElement {
  return el('div', { class: 'table-wrap' }, [node]);
}

export function mountPlayers(ctx: AppCtx): void {
  const view = qs(ctx.root, '[data-view-panel="players"]');
  const lookup = qs<HTMLFormElement>(view, '[data-lookup]');
  const searchInput = qs<HTMLInputElement>(lookup, 'input[name="playerKey"]');
  const emptyEl = qs(view, '[data-player-empty]');
  const playerEl = qs(view, '[data-player]');
  const keyEl = qs(view, '[data-player-key]');
  const pillsEl = qs(view, '[data-player-pills]');
  const statsEl = qs(view, '[data-stats]');
  const timelineEl = qs(view, '[data-timeline]');
  const savesEl = qs(view, '[data-saves]');
  const blobEl = qs(view, '[data-blob]');
  const countTimeline = qs(view, '[data-count="timeline"]');
  const countSaves = qs(view, '[data-count="saves"]');
  const tabs = bindTabs(qs(view, '[data-player-tabs]'));

  let current: Loaded | null = null;
  let loadToken = 0;

  replace(emptyEl, [emptyState('No player loaded', 'Search by player ID.')]);

  // ─── Player actions ─────────────────────────────────────────────
  const actionsAside = view.querySelector<HTMLElement>('[data-player-actions]');
  const forms: BoundWrite[] = [];
  if (actionsAside && !actionsAside.querySelector('[data-action-toggles] button'))
    actionsAside.remove();
  else if (actionsAside) {
    // Disclosure buttons: one action form open at a time; the open one closes again.
    const toggles = Array.from(
      actionsAside.querySelectorAll<HTMLButtonElement>('[data-action-toggles] button'),
    );
    for (const toggle of toggles)
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        for (const t of toggles) {
          const on = t === toggle && open;
          t.setAttribute('aria-expanded', String(on));
          const form = document.getElementById(t.getAttribute('aria-controls') ?? '');
          if (form) form.hidden = !on;
        }
        if (open)
          document
            .getElementById(toggle.getAttribute('aria-controls') ?? '')
            ?.querySelector<HTMLElement>('input, textarea, select')
            ?.focus();
      });
    const playerExtra = (): Record<string, unknown> => ({ playerKey: current?.playerKey ?? '' });
    const reload = (): void => {
      if (current) void loadPlayer(current.playerKey);
    };
    const letter = actionsAside.querySelector<HTMLFormElement>('#form-letter');
    if (letter)
      forms.push(
        bindWriteForm(ctx.writes, letter, {
          kind: 'letter',
          path: '/admin/v1/letters',
          spec: [
            S('title', 'Title'),
            S('body', 'Body'),
            S('grantKey', 'Grant key', 'optional-string'),
            S('ticketRef', 'Ticket', 'optional-string'),
            S('reason', 'Reason'),
          ],
          extra: playerExtra,
          onOk: reload,
        }),
      );
    const grant = actionsAside.querySelector<HTMLFormElement>('#form-grant');
    if (grant) {
      bindRewardFields(grant);
      forms.push(
        bindWriteForm(ctx.writes, grant, {
          kind: 'grant',
          path: '/admin/v1/grants',
          spec: [
            S('grantKey', 'Grant key'),
            ...REWARD_SPEC,
            S('reason', 'Reason'),
            S('ticketRef', 'Ticket', 'optional-string'),
            S('title', 'Title', 'optional-string'),
            S('body', 'Body', 'optional-string'),
            S('expiresAt', 'Expires', 'optional-datetime'),
          ],
          extra: playerExtra,
          build: withRewards,
          onOk: reload,
        }),
      );
    }
    const adjust = actionsAside.querySelector<HTMLFormElement>('#form-adjust');
    if (adjust) {
      bindAdjustmentForm(adjust);
      forms.push(
        bindWriteForm(ctx.writes, adjust, {
          kind: 'adjustPurchase',
          path: '/admin/v1/purchases/adjustments',
          spec: ADJUSTMENT_SPEC,
          extra: playerExtra,
          build: adjustmentFromFields,
          // The refund strike count comes from the loaded overview.
          facts: () => ({ strikes: current?.overview?.strikes }),
          onOk: reload,
        }),
      );
    }
    const flag = actionsAside.querySelector<HTMLFormElement>('#form-flag');
    if (flag) {
      const until = qs(flag, '[data-flag-until]');
      const untilInput = qs<HTMLInputElement>(until, 'input');
      const syncUntil = (): void => {
        const set = (flag.elements.namedItem('enabled') as RadioNodeList).value !== 'off';
        until.hidden = !set;
        untilInput.disabled = !set;
      };
      flag.addEventListener('change', syncUntil);
      flag.addEventListener('reset', () => globalThis.setTimeout(syncUntil, 0));
      forms.push(
        bindWriteForm(ctx.writes, flag, {
          kind: 'playerFlag',
          path: '/admin/v1/players/flags',
          spec: [
            S('flag', 'Flag'),
            S('enabled', 'State', 'on-off'),
            S('until', 'Until', 'optional-datetime'),
            S('reason', 'Reason'),
          ],
          extra: playerExtra,
          onOk: reload,
        }),
      );
    }
  }

  // ─── Lookup ─────────────────────────────────────────────────────
  lookup.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const playerKey = searchInput.value.trim();
    if (!playerKey) {
      searchInput.focus();
      return;
    }
    void loadPlayer(playerKey);
  });
  qs(view, '[data-player-reload]').addEventListener('click', () => {
    if (current) void loadPlayer(current.playerKey);
  });

  async function loadPlayer(playerKey: string): Promise<void> {
    const token = ++loadToken;
    if (current?.playerKey !== playerKey) {
      // A different player: never carry a half-typed action (or its commandId) across.
      for (const f of forms) f.reset();
      replace(blobEl, [emptyState('No save open', 'Use View on a save.')]);
      tabs.select('tab-timeline');
    }
    current = { playerKey, overview: null, saves: [], now: undefined };
    searchInput.value = playerKey;
    emptyEl.hidden = true;
    playerEl.hidden = false;
    keyEl.textContent = playerKey;
    clear(pillsEl);
    playerEl.setAttribute('aria-busy', 'true');
    replace(statsEl, skeletonStats(10));
    replace(timelineEl, [loadingState()]);
    replace(savesEl, [loadingState()]);
    countTimeline.textContent = '';
    countSaves.textContent = '';
    const enc = encodeURIComponent(playerKey);
    const [ov, tl, sv] = await Promise.all([
      ctx.api.get<PlayerOverview>(`/admin/v1/players/${enc}`),
      ctx.api.get<TimelineResponse>(`/admin/v1/players/${enc}/timeline`),
      ctx.api.get<SaveHistoryResponse>(`/admin/v1/players/${enc}/saves?limit=${SAVES_PAGE}`),
    ]);
    if (token !== loadToken) return;
    playerEl.removeAttribute('aria-busy');
    const retry = (): void => void loadPlayer(playerKey);
    if (ov.ok) {
      current.overview = ov.body;
      current.now = ov.body.serverNow;
      renderOverview(ov.body);
    } else {
      const message = ctx.failure(ov);
      replace(statsEl, [errorState(message, ov.error ?? undefined, retry)]);
      ctx.notify(message, 'danger');
    }
    if (tl.ok) renderTimeline(tl.body.items, tl.body.serverNow);
    else replace(timelineEl, [errorState(ctx.failure(tl), tl.error ?? undefined, retry)]);
    if (sv.ok) {
      current.saves = sv.body.items;
      renderSaves(sv.body.items, sv.body.serverNow, sv.body.items.length === SAVES_PAGE);
    } else replace(savesEl, [errorState(ctx.failure(sv), sv.error ?? undefined, retry)]);
  }

  // ─── Overview ───────────────────────────────────────────────────
  function renderOverview(o: PlayerOverview): void {
    const now = o.serverNow;
    const pills: HTMLElement[] = [];
    if (o.firstSeenAt === undefined) pills.push(tonePill('Never seen', 'warn'));
    pills.push(o.registered ? tonePill('Registered', 'ok') : tonePill('Guest'));
    if (o.erased) pills.push(tonePill('Erased', 'danger'));
    replace(pillsEl, pills);
    const flags = o.flags.length
      ? el(
          'span',
          { class: 'pills' },
          o.flags.map((f) => {
            const p = tonePill(
              f.until ? `${humanize(f.flag)} · ${relTime(f.until, now)}` : humanize(f.flag),
              'danger',
            );
            p.title = f.until ? `${f.reason} · until ${absTime(f.until)}` : f.reason;
            return p;
          }),
        )
      : 'None';
    const anchor = o.anchor;
    const pending = o.pendingQuarantine;
    replace(statsEl, [
      statCard({
        label: 'Registered',
        value: o.registered ? 'Yes' : 'No',
        sub:
          o.firstSeenAt === undefined
            ? 'never seen'
            : el('span', {}, ['first seen ', timeEl(o.firstSeenAt, now)]),
      }),
      statCard({ label: 'Last seen', value: timeEl(o.lastSeenAt, now) }),
      statCard({ label: 'Last build', value: o.lastBuildVersion ?? '—' }),
      statCard({
        label: 'Generation',
        value: String(o.generation),
        sub: humanize(o.generationKind),
      }),
      statCard({
        label: 'Anchor',
        value: anchor ? `seq ${anchor.seq}` : 'None',
        sub: anchor ? `progress ${fmtInt(anchor.progress)}` : undefined,
      }),
      statCard({
        label: 'Quarantine',
        value: pending ? `seq ${pending.seq}` : 'None',
        sub: pending ? `progress ${fmtInt(pending.progress)}` : undefined,
        tone: pending ? 'warn' : 'neutral',
      }),
      statCard({
        label: 'Purchases',
        value: `${fmtInt(o.paidCount)} paid`,
        sub: `entitlement ${fmtInt(o.entitlement)}`,
      }),
      statCard({
        label: 'Strikes',
        value: fmtInt(o.strikes),
        tone: o.strikes > 0 ? 'warn' : 'neutral',
      }),
      statCard({ label: 'Unclaimed grants', value: fmtInt(o.grantsPending) }),
      statCard({
        label: 'Flags',
        value: flags,
        tone: o.flags.length ? 'danger' : 'neutral',
        wide: true,
      }),
    ]);
  }

  // ─── Timeline ───────────────────────────────────────────────────
  function renderTimeline(items: TimelineItem[], now: number): void {
    countTimeline.textContent = items.length ? fmtInt(items.length) : '';
    if (!items.length) {
      replace(timelineEl, [emptyState('No timeline yet')]);
      return;
    }
    const kinds = Array.from(new Set(items.map((i) => i.kind))).sort();
    const body = el('div');
    const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by kind' });
    let active = '';
    const draw = (): void => {
      const rows = active ? items.filter((i) => i.kind === active) : items;
      replace(body, [
        scroller(
          table<TimelineItem>(
            [
              { header: 'When', cell: (i) => timeEl(i.at, now) },
              { header: 'Kind', cell: (i) => tonePill(i.kind, timelineTone(i.kind)) },
              {
                header: 'Event',
                cell: (i) => {
                  const detail = detailText(i.detail);
                  const node = el('div', { class: 'event' }, [text('span', i.summary)]);
                  if (detail) {
                    const d = text('span', detail, 'event-detail');
                    d.title = JSON.stringify(i.detail);
                    node.appendChild(d);
                  }
                  return node;
                },
                wrap: true,
              },
              {
                header: 'Ref',
                cell: (i) => {
                  const r = text('span', i.ref, 'mono small truncate');
                  r.title = i.ref;
                  return r;
                },
              },
            ],
            rows,
          ),
        ),
      ]);
    };
    for (const k of ['', ...kinds]) {
      const n = k ? items.filter((i) => i.kind === k).length : items.length;
      const b = el(
        'button',
        { type: 'button', class: 'chip', 'aria-pressed': String(k === active) },
        [k || 'All', text('span', fmtInt(n), 'chip-count')],
      );
      b.addEventListener('click', () => {
        active = k;
        for (const c of Array.from(chips.children)) c.setAttribute('aria-pressed', String(c === b));
        draw();
      });
      chips.appendChild(b);
    }
    draw();
    replace(timelineEl, kinds.length > 1 ? [chips, body] : [body]);
  }

  // ─── Saves ──────────────────────────────────────────────────────
  function renderSaves(items: SnapshotMeta[], now: number, more: boolean): void {
    countSaves.textContent = items.length ? `${fmtInt(items.length)}${more ? '+' : ''}` : '';
    if (!items.length) {
      replace(savesEl, [emptyState('No saves')]);
      return;
    }
    const anchorSeq = current?.overview?.anchor?.seq;
    const canRestore = ctx.access.can('restore') && current?.overview && !current.overview.erased;
    replace(savesEl, [
      scroller(
        table<SnapshotMeta>(
          [
            {
              header: 'Seq',
              cell: (s) => [
                text('span', String(s.seq), 'mono'),
                s.seq === anchorSeq ? tonePill('anchor', 'ok') : null,
              ],
            },
            {
              header: 'Saved',
              cell: (s) => {
                const build = text('span', s.buildVersion, 'event-detail mono');
                build.title = `build ${s.buildVersion} · ${fmtBytes(s.bytes)} · schema ${s.schemaVersion}`;
                return el('div', { class: 'event' }, [timeEl(s.savedAt, now), build]);
              },
            },
            { header: 'Gen', cell: (s) => String(s.generation) },
            { header: 'Progress', cell: (s) => fmtInt(s.progress) },
            {
              header: 'Status',
              cell: (s) => {
                // Stacked lines keep the column narrow: disposition, then flags/review, then why.
                const main: HTMLElement[] = [
                  tonePill(dispositionLabel(s.disposition), dispositionTone(s.disposition)),
                ];
                if (s.rejectReason) main.push(tonePill(humanize(s.rejectReason), 'danger'));
                const extra: HTMLElement[] = s.flags.map((f) => tonePill(humanize(f), 'warn'));
                if (s.review) {
                  const r = tonePill(
                    s.review.action === 'promote' ? 'promoted' : 'rejected',
                    'info',
                  );
                  r.title = absTime(s.review.at);
                  extra.push(r);
                }
                return el('div', { class: 'event' }, [
                  el('span', { class: 'pills' }, main),
                  extra.length ? el('span', { class: 'pills' }, extra) : null,
                  text('span', s.reason, 'event-detail'),
                ]);
              },
            },
            {
              header: 'Actions',
              cell: (s) => {
                if (!s.hasBlob) return text('span', 'pruned', 'muted small');
                const pk = current?.playerKey ?? '';
                const buttons: HTMLElement[] = [];
                if (ctx.access.can('saveViewer')) {
                  const view = el('button', { type: 'button', class: 'btn btn-ghost btn-xs' }, [
                    'View',
                  ]);
                  view.addEventListener('click', () => {
                    tabs.select('tab-blob');
                    void viewBlob(pk, s.seq);
                  });
                  buttons.push(view);
                }
                if (ctx.access.can('incognito')) {
                  const play = el('button', { type: 'button', class: 'btn btn-ghost btn-xs' }, [
                    'Play incognito',
                  ]);
                  play.addEventListener('click', () => ctx.launchIncognito(pk, s.seq));
                  buttons.push(play);
                }
                if (
                  ctx.access.can('saveReview') &&
                  s.disposition === 'stored_quarantined' &&
                  !s.review
                ) {
                  const review = el('button', { type: 'button', class: 'btn btn-warn btn-xs' }, [
                    'Review',
                  ]);
                  review.addEventListener('click', () => openReview(s));
                  buttons.push(review);
                }
                if (canRestore && s.seq !== anchorSeq) {
                  const restore = el(
                    'button',
                    { type: 'button', class: 'btn btn-danger-ghost btn-xs' },
                    ['Restore to this save'],
                  );
                  restore.addEventListener('click', () => openRestore(s));
                  buttons.push(restore);
                }
                return el('div', { class: 'row-actions' }, buttons);
              },
            },
          ],
          items,
        ),
      ),
      more ? olderButton(items, now) : null,
    ]);
  }

  /** The history comes a page at a time; older saves stay reachable for view/play/restore. */
  function olderButton(items: SnapshotMeta[], now: number): HTMLElement {
    const loaded = current;
    const button = el('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, [
      'Load older saves',
    ]);
    button.addEventListener('click', () => {
      const last = items[items.length - 1];
      if (!loaded || !last) return;
      button.disabled = true;
      button.textContent = 'Loading…';
      void (async () => {
        const res = await ctx.api.get<SaveHistoryResponse>(
          `/admin/v1/players/${encodeURIComponent(loaded.playerKey)}/saves?limit=${SAVES_PAGE}&beforeSeq=${last.seq}`,
        );
        if (current !== loaded) return;
        if (!res.ok) {
          button.disabled = false;
          button.textContent = 'Load older saves';
          ctx.notify(ctx.failure(res), 'danger');
          return;
        }
        loaded.saves = [...items, ...res.body.items];
        renderSaves(loaded.saves, now, res.body.items.length === SAVES_PAGE);
      })();
    });
    return el('div', { class: 'table-more' }, [button]);
  }

  // ─── Save viewer ────────────────────────────────────────────────
  async function viewBlob(playerKey: string, seq: number): Promise<void> {
    replace(blobEl, [loadingState(`Loading seq ${seq}…`)]);
    const res = await ctx.api.get<SaveBlobResponse>(
      `/admin/v1/players/${encodeURIComponent(playerKey)}/saves/${seq}/blob`,
    );
    if (current?.playerKey !== playerKey) return;
    if (!res.ok) {
      const message =
        res.status === 404 ? `Save seq ${seq} is unavailable (pruned).` : ctx.failure(res);
      replace(blobEl, [errorState(message, res.error ?? undefined)]);
      return;
    }
    const { enc, blob, blobSha256, generation } = res.body;
    const head = el('div', { class: 'blob-head' }, [
      text('h3', `Seq ${seq} · generation ${generation}`, 'blob-title'),
      el('span', { class: 'pills' }, [
        tonePill(enc),
        tonePill(fmtBytes(blob.length)),
        (() => {
          const p = tonePill(`sha256 ${blobSha256.slice(0, 12)}…`);
          p.title = blobSha256;
          return p;
        })(),
      ]),
    ]);
    const decoded = await decodeBlob(enc, blob);
    if (current?.playerKey !== playerKey) return;
    if (decoded.ok)
      replace(blobEl, [head, el('div', { class: 'tree-wrap' }, [jsonTree(decoded.value)])]);
    else
      replace(blobEl, [
        head,
        text('p', `Not JSON (${decoded.reason}); raw text below.`, 'notice notice-warn'),
        text('pre', blob, 'raw'),
      ]);
  }

  // ─── Restore and review (save safety) ───────────────────────────
  function openRestore(target: SnapshotMeta): void {
    const loaded = current;
    const overview = loaded?.overview;
    if (!loaded || !overview) return;
    const plan = restorePlan(overview, target);
    const reason = el('input', { name: 'reason', maxlength: '512', required: '' });
    const slot: WriteSlot = {};
    openDialog(ctx.writes.dialog, {
      title: `Restore to seq ${target.seq}`,
      danger: true,
      confirm: 'Restore',
      rows: [
        ['Player', loaded.playerKey],
        ['Now', plan.now],
        ['Target', plan.target],
        ['Effect', plan.effect],
        ['Expected generation', String(plan.expectedGeneration)],
      ],
      note: plan.note,
      refusal: plan.refusal,
      fields: plan.refusal ? [] : [field('Reason', reason)],
      validate: () => (reason.value.trim() ? null : 'Reason is required.'),
      onInput: () => {
        slot.commandId = undefined;
      },
      run: (report) =>
        void runWrite(
          ctx.writes,
          slot,
          report,
          'restore',
          '/admin/v1/players/restore',
          {
            playerKey: loaded.playerKey,
            seq: target.seq,
            expectedGeneration: plan.expectedGeneration,
            reason: reason.value,
          },
          () => void loadPlayer(loaded.playerKey),
        ),
    });
  }

  function openReview(target: SnapshotMeta): void {
    const loaded = current;
    if (!loaded) return;
    const promote = el('input', { type: 'radio', name: 'action', value: 'promote' });
    const reject = el('input', { type: 'radio', name: 'action', value: 'reject' });
    const decision = el('fieldset', { class: 'field' }, [
      text('legend', 'Decision', 'field-label'),
      el('div', { class: 'radio-row' }, [
        el('label', { class: 'radio' }, [promote, ' Promote']),
        el('label', { class: 'radio' }, [reject, ' Reject']),
      ]),
    ]);
    const reason = el('input', { name: 'reason', maxlength: '512', required: '' });
    const slot: WriteSlot = {};
    const action = (): string => (promote.checked ? 'promote' : reject.checked ? 'reject' : '');
    openDialog(ctx.writes.dialog, {
      title: `Review quarantined seq ${target.seq}`,
      danger: true,
      confirm: 'Submit final review',
      rows: [
        ['Player', loaded.playerKey],
        [
          'Save',
          `seq ${target.seq} · generation ${target.generation} · progress ${target.progress}`,
        ],
        ...(target.flags.length ? [['Flags', target.flags.map(humanize).join(', ')] as const] : []),
      ],
      note: 'Promote re-checks it (blob, generation, progress ≥ anchor) and anchors it. Final.',
      fields: [decision, field('Reason', reason)],
      validate: () =>
        !action()
          ? 'Choose promote or reject.'
          : reason.value.trim()
            ? null
            : 'Reason is required.',
      onInput: () => {
        slot.commandId = undefined;
      },
      run: (report) =>
        void runWrite(
          ctx.writes,
          slot,
          report,
          'saveReview',
          '/admin/v1/saves/reviews',
          { playerKey: loaded.playerKey, seq: target.seq, action: action(), reason: reason.value },
          () => void loadPlayer(loaded.playerKey),
        ),
    });
  }
}

async function decodeBlob(
  enc: string,
  blob: string,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  try {
    if (enc === 'json') return { ok: true, value: JSON.parse(blob) };
    if (enc === 'gzip+b64') {
      const bin = atob(blob);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const json = await new Response(stream).text();
      return { ok: true, value: JSON.parse(json) };
    }
    return { ok: false, reason: `unknown encoding ${enc}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
