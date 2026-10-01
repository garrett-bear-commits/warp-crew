// Writes: read a form, confirm what will happen, then POST with a commandId (§6). The commandId is
// minted on the first confirm and reused verbatim when the operator retries after a network error
// or a 5xx; a definitive answer (2xx / 4xx) or any edit forgets it.
import type { ErrorEnvelope } from '@foundation/contracts';
import type { AdminApi, AdminResult } from './api.ts';
import { epochFromLocalInput } from './format.ts';
import { resultMessage, writeSummary, type PlanFacts, type WriteKind } from './plans.ts';
import { clear, replace, text } from './render.ts';
import { openDialog, rawDetails, type DialogReport } from './ui.ts';

export interface WriteSlot {
  commandId?: string | undefined;
}

export interface WriteDeps {
  api: AdminApi;
  connected(): boolean;
  failure(r: { status: number; error: ErrorEnvelope | null }): string;
  dialog: HTMLDialogElement;
}

export function stripMeta(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { serverNow: _s, requestId: _r, ...rest } = body as Record<string, unknown>;
  return rest;
}

/**
 * POST a write. The slot keeps the commandId across retries: a network failure (status 0) or a
 * 5xx leaves the commandId in place and offers a retry; a definitive answer (2xx / 4xx) clears
 * it so the next confirm mints a fresh command.
 */
export async function runWrite(
  deps: WriteDeps,
  slot: WriteSlot,
  report: DialogReport,
  kind: WriteKind,
  path: string,
  payload: Record<string, unknown>,
  onOk?: (body: unknown) => void,
): Promise<void> {
  if (!deps.connected()) {
    report.fail('Signed out.', null);
    return;
  }
  const commandId = slot.commandId ?? crypto.randomUUID();
  slot.commandId = commandId;
  report.pending(`Sending… commandId ${commandId}`);
  const res: AdminResult<unknown> = await deps.api.post(path, { commandId, ...payload });
  if (res.ok) {
    slot.commandId = undefined;
    report.ok(resultMessage(kind, res.body, payload), {
      commandId,
      ...(stripMeta(res.body) as object),
    });
    onOk?.(res.body);
    return;
  }
  const retryable = res.status === 0 || res.status >= 500;
  if (!retryable) slot.commandId = undefined;
  report.fail(
    deps.failure(res),
    { commandId, status: res.status, error: res.error },
    retryable ? () => void runWrite(deps, slot, report, kind, path, payload, onOk) : undefined,
  );
}

// ─── Forms ─────────────────────────────────────────────────────────

export type FieldKind =
  | 'string'
  | 'optional-string'
  | 'int'
  | 'optional-int'
  | 'optional-datetime'
  | 'bool'
  | 'optional-bool'
  | 'on-off'
  | 'json'
  | 'flag-value';

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  label: string;
}

export class FormError extends Error {}

export function parseFlagValue(raw: string): boolean | number | string {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  return raw;
}

/** Read a form into a JSON body according to the field specs (throws FormError on bad input). */
export function readForm(form: HTMLFormElement, spec: FieldSpec[]): Record<string, unknown> {
  const fd = new FormData(form);
  const out: Record<string, unknown> = {};
  for (const f of spec) {
    const raw = fd.get(f.name);
    const str = typeof raw === 'string' ? raw : '';
    switch (f.kind) {
      case 'string':
        if (!str.trim()) throw new FormError(`${f.label} is required.`);
        out[f.name] = str;
        break;
      case 'optional-string':
        if (str.trim()) out[f.name] = str;
        break;
      case 'int': {
        const n = Number(str);
        if (!str.trim() || !Number.isInteger(n) || n < 0)
          throw new FormError(`${f.label} must be a whole number ≥ 0.`);
        out[f.name] = n;
        break;
      }
      case 'optional-int': {
        if (!str.trim()) break;
        const n = Number(str);
        if (!Number.isInteger(n) || n < 0)
          throw new FormError(`${f.label} must be a whole number ≥ 0.`);
        out[f.name] = n;
        break;
      }
      case 'optional-datetime': {
        if (!str.trim()) break;
        const ms = epochFromLocalInput(str);
        if (ms === null || ms < 0) throw new FormError(`${f.label} is not a valid time.`);
        out[f.name] = ms;
        break;
      }
      case 'bool':
        out[f.name] = raw !== null;
        break;
      case 'optional-bool':
        if (raw !== null) out[f.name] = true;
        break;
      case 'on-off':
        out[f.name] = str === 'on';
        break;
      case 'json':
        try {
          out[f.name] = JSON.parse(str);
        } catch {
          throw new FormError(`${f.label} must be valid JSON.`);
        }
        break;
      case 'flag-value':
        out[f.name] = parseFlagValue(str);
        break;
    }
  }
  return out;
}

export function showOutput(
  out: HTMLElement,
  tone: 'ok' | 'err' | 'pending',
  message: string,
  raw?: unknown,
): void {
  out.className = `result result-${tone}`;
  replace(out, [text('span', message), raw === undefined ? null : rawDetails(raw)]);
}

/** A report that also mirrors the outcome into the form's own output. */
function mirrored(report: DialogReport, out: HTMLElement): DialogReport {
  return {
    pending(label) {
      showOutput(out, 'pending', 'Sending…');
      report.pending(label);
    },
    ok(message, raw) {
      showOutput(out, 'ok', message, raw);
      report.ok(message, raw);
    },
    fail(message, raw, retry) {
      showOutput(out, 'err', message, raw);
      report.fail(message, raw, retry);
    },
  };
}

export interface BoundWrite {
  /** Forget the pending command, clear the result and reset the inputs. */
  reset(): void;
}

export function bindWriteForm(
  deps: WriteDeps,
  form: HTMLFormElement,
  o: {
    kind: WriteKind;
    path: string;
    spec: FieldSpec[];
    /** Values that do not come from inputs (the loaded player). */
    extra?: () => Record<string, unknown>;
    /** Turn the read values into the body (throws FormError), e.g. reward fields → rewards. */
    build?: (values: Record<string, unknown>) => Record<string, unknown>;
    /** What the confirm step states but does not send (the loaded player's strikes). */
    facts?: () => PlanFacts;
    onOk?: (body: unknown) => void;
  },
): BoundWrite {
  const out = form.querySelector<HTMLElement>('output.result');
  if (!out) throw new Error(`${o.kind} form lacks an output`);
  const slot: WriteSlot = {};
  // Editing the form means a different command: forget the pending commandId.
  form.addEventListener('input', () => {
    slot.commandId = undefined;
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    let payload: Record<string, unknown>;
    try {
      const values = readForm(form, o.spec);
      payload = { ...(o.extra?.() ?? {}), ...(o.build ? o.build(values) : values) };
    } catch (e) {
      showOutput(out, 'err', e instanceof Error ? e.message : String(e));
      return;
    }
    clear(out);
    out.className = 'result';
    const summary = writeSummary(o.kind, payload, o.facts?.());
    openDialog(deps.dialog, {
      ...summary,
      run: (report) =>
        void runWrite(deps, slot, mirrored(report, out), o.kind, o.path, payload, o.onOk),
    });
  });
  return {
    reset() {
      slot.commandId = undefined;
      form.reset();
      clear(out);
      out.className = 'result';
    },
  };
}
