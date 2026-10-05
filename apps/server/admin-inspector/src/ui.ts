// UI building blocks (textContent only, like render.ts): states, stat cards, pills, keyboard
// tabs, the confirmation dialog and toasts. No application state lives here.
import { absTime, relTime } from './format.ts';
import { el, replace, text } from './render.ts';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export function qs<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

export function tonePill(label: string, tone: Tone = 'neutral'): HTMLSpanElement {
  return text('span', label, `pill pill-${tone}`);
}

/** A relative time with the absolute UTC time on hover. */
export function timeEl(at: unknown, now: unknown): HTMLElement {
  if (typeof at !== 'number') return text('span', '—', 'muted');
  const t = el('time', { datetime: new Date(at).toISOString(), title: absTime(at) });
  t.textContent = relTime(at, now);
  return t;
}

// ─── States ────────────────────────────────────────────────────────

export function emptyState(message: string, hint?: string): HTMLElement {
  return el('div', { class: 'state state-empty' }, [
    text('p', message, 'state-title'),
    hint ? text('p', hint, 'state-hint') : null,
  ]);
}

export function loadingState(label = 'Loading…'): HTMLElement {
  const node = el('div', { class: 'state state-loading', 'aria-busy': 'true' }, [
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    text('span', label),
  ]);
  return node;
}

export function errorState(message: string, raw?: unknown, retry?: () => void): HTMLElement {
  const node = el('div', { class: 'state state-error', role: 'alert' }, [
    text('p', message, 'state-title'),
  ]);
  if (retry) {
    const b = el('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, ['Try again']);
    b.addEventListener('click', retry);
    node.appendChild(b);
  }
  if (raw !== undefined) node.appendChild(rawDetails(raw));
  return node;
}

/** The raw response behind a readable message, for debugging. */
export function rawDetails(raw: unknown, label = 'Details'): HTMLDetailsElement {
  return el('details', { class: 'raw-details' }, [
    text('summary', label),
    text('pre', JSON.stringify(raw, null, 2) ?? String(raw), 'raw'),
  ]);
}

/** Skeleton stat cards while a player loads. */
export function skeletonStats(n: number): HTMLElement[] {
  return Array.from({ length: n }, () =>
    el('div', { class: 'stat stat-skeleton', 'aria-hidden': 'true' }, [
      el('span', { class: 'sk sk-label' }),
      el('span', { class: 'sk sk-value' }),
    ]),
  );
}

// ─── Stat cards ────────────────────────────────────────────────────

export interface StatSpec {
  label: string;
  value: Node | string;
  sub?: Node | string | undefined;
  tone?: Tone;
  wide?: boolean;
}

export function statCard(s: StatSpec): HTMLElement {
  const cls = ['stat', s.tone && s.tone !== 'neutral' ? `stat-${s.tone}` : '', s.wide ? 'wide' : '']
    .filter(Boolean)
    .join(' ');
  return el('div', { class: cls }, [
    text('span', s.label, 'stat-label'),
    el('span', { class: 'stat-value' }, [s.value]),
    s.sub !== undefined && s.sub !== '' ? el('span', { class: 'stat-sub' }, [s.sub]) : null,
  ]);
}

// ─── Tabs (WAI-ARIA, roving tabindex, arrow keys) ──────────────────

export interface Tabs {
  select(id: string, focus?: boolean): void;
}

export function bindTabs(tablist: HTMLElement, onSelect?: (tab: HTMLElement) => void): Tabs {
  const tabs = (): HTMLButtonElement[] =>
    Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panelOf = (tab: HTMLElement): HTMLElement | null => {
    const id = tab.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  };
  const select = (tab: HTMLButtonElement, focus = false): void => {
    for (const t of tabs()) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = panelOf(t);
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
    onSelect?.(tab);
  };
  tablist.addEventListener('click', (ev) => {
    const tab = (ev.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (tab && tablist.contains(tab)) select(tab);
  });
  tablist.addEventListener('keydown', (ev) => {
    const list = tabs();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let next = -1;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp')
      next = (i - 1 + list.length) % list.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = list.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    select(list[next]!, true);
  });
  const first = tabs().find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs()[0];
  if (first) select(first);
  return {
    select(id, focus = false) {
      const tab = tabs().find((t) => t.id === id);
      if (tab) select(tab, focus);
    },
  };
}

// ─── Toasts ────────────────────────────────────────────────────────

export function toast(region: HTMLElement, message: string, tone: Tone = 'info'): void {
  const close = el('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss' }, [
    '×',
  ]);
  const node = el('div', { class: `toast toast-${tone}` }, [text('span', message), close]);
  const remove = (): void => node.remove();
  close.addEventListener('click', remove);
  region.appendChild(node);
  while (region.children.length > 3) region.firstElementChild?.remove();
  if (tone !== 'danger') globalThis.setTimeout(remove, 6000);
}

// ─── Confirmation dialog ───────────────────────────────────────────

export interface DialogReport {
  pending(label: string): void;
  ok(message: string, raw: unknown): void;
  fail(message: string, raw: unknown, retry?: () => void): void;
}

export interface DialogOptions {
  title: string;
  danger: boolean;
  confirm: string;
  lead?: string;
  rows?: ReadonlyArray<readonly [string, string]>;
  /** A short line under the rows. */
  note?: string;
  /** The write cannot run; shown instead of a confirm button. */
  refusal?: string | null;
  /** Extra inputs inside the dialog (reason, decision). */
  fields?: HTMLElement[];
  /** Validate inputs; returns an error message or null. */
  validate?: () => string | null;
  /** Called on confirm with a reporter bound to this dialog. */
  run: (report: DialogReport) => void;
  /** Called when a dialog input changes (a different command: forget a pending commandId). */
  onInput?: () => void;
  /** Called when the dialog closes, after any result. */
  onClose?: () => void;
}

export function openDialog(dialog: HTMLDialogElement, o: DialogOptions): void {
  dialog.className = `dialog${o.danger ? ' dialog-danger' : ''}`;
  const title = text('h2', o.title, 'dialog-title');
  title.id = 'dialog-title';
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  const closeX = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close' }, ['×']);
  const result = el('div', { class: 'dialog-result', 'aria-live': 'polite' });
  const cancel = el('button', { type: 'button', class: 'btn btn-secondary' }, ['Cancel']);
  const confirm = el(
    'button',
    { type: 'submit', class: `btn ${o.danger ? 'btn-danger' : 'btn-primary'}` },
    [o.confirm],
  );
  const foot = el('div', { class: 'dialog-foot' }, [cancel, o.refusal ? null : confirm]);
  const rows = o.rows?.length
    ? el(
        'dl',
        { class: 'plan' },
        o.rows.flatMap(([k, v]) => [text('dt', k), text('dd', v)]),
      )
    : null;
  const form = el('form', { class: 'dialog-form', autocomplete: 'off', novalidate: '' }, [
    el('div', { class: 'dialog-head' }, [title, closeX]),
    el('div', { class: 'dialog-body' }, [
      o.lead ? text('p', o.lead, 'dialog-lead') : null,
      rows,
      o.note ? text('p', o.note, 'dialog-note') : null,
      o.refusal ? text('p', o.refusal, 'notice notice-danger') : null,
      ...(o.fields ?? []),
      result,
    ]),
    foot,
  ]);
  replace(dialog, [form]);

  let done = false;
  const close = (): void => {
    if (dialog.open) dialog.close();
  };
  const finish = (): void => {
    done = true;
    cancel.textContent = 'Close';
    confirm.remove();
  };
  const report: DialogReport = {
    pending(label) {
      confirm.disabled = true;
      confirm.textContent = 'Sending…';
      replace(result, [text('p', label, 'result result-pending')]);
    },
    ok(message, raw) {
      finish();
      replace(result, [text('p', message, 'result result-ok'), rawDetails(raw)]);
      cancel.focus();
    },
    fail(message, raw, retry) {
      replace(result, [text('p', message, 'result result-err'), rawDetails(raw)]);
      if (retry) {
        confirm.disabled = false;
        confirm.textContent = 'Retry (same commandId)';
        confirm.onclick = (ev) => {
          ev.preventDefault();
          retry();
        };
      } else finish();
    },
  };
  cancel.addEventListener('click', close);
  closeX.addEventListener('click', close);
  form.addEventListener('input', () => {
    // Edited after a retryable failure: the next confirm is a new command, not a retry.
    if (confirm.onclick) {
      confirm.onclick = null;
      confirm.textContent = o.confirm;
    }
    o.onInput?.();
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (done || confirm.disabled || confirm.onclick) return;
    const problem = o.validate?.() ?? null;
    if (problem) {
      replace(result, [text('p', problem, 'result result-err')]);
      return;
    }
    o.run(report);
  });
  dialog.onclose = () => {
    dialog.onclose = null;
    o.onClose?.();
  };
  if (!dialog.open) dialog.showModal();
  const first = o.fields?.[0]?.querySelector<HTMLElement>('input, textarea, select');
  (first ?? (o.refusal ? cancel : confirm)).focus();
}

/** A labelled field for dialogs and forms. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, [label, hint ? text('i', hint) : null]),
    control,
  ]);
}
