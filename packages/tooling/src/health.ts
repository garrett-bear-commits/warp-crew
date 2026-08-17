// check-health (§9 smoke, §10 "< 1 h to check-health --assert green"): GET /health/ready, then
// /health/ops?assert=page|warn with the ops secret. Non-zero on 503 / not ready. Fetch is
// injected so the command is unit-testable without a server.

export interface HealthOptions {
  url: string;
  assert?: 'page' | 'warn' | undefined;
  opsSecret?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface HealthOutcome {
  ok: boolean;
  lines: string[];
  ready?: unknown;
  ops?: unknown;
}

interface ReadyLike {
  status?: string;
  gameId?: string;
  env?: string;
  buildVersion?: string;
  contractVersion?: string;
  checks?: Record<string, unknown>;
}

interface OpsLike {
  status?: string;
  windowMinutes?: number;
  outbox?: { pending?: number; lagSeconds?: number; deadLetters?: number };
  saves?: Record<string, number>;
  issues?: Array<{ tier?: string; code?: string; message?: string }>;
  restoreVerifiedAt?: number;
}

async function getJson(
  f: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; body: unknown; error?: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await f(url, { headers, signal: ctl.signal });
    const body = (await res.json().catch(() => null)) as unknown;
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(opts: HealthOptions): Promise<HealthOutcome> {
  const f = opts.fetch ?? fetch;
  const base = opts.url.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const lines: string[] = [];
  let ok = true;

  const ready = await getJson(f, `${base}/health/ready`, { accept: 'application/json' }, timeoutMs);
  if (ready.status === 0) {
    lines.push(`ready: unreachable (${ready.error})`);
    return { ok: false, lines };
  }
  const r = (ready.body ?? {}) as ReadyLike;
  const readyOk = ready.status === 200 && r.status === 'ready';
  lines.push(
    `ready: HTTP ${ready.status} status=${r.status ?? '?'} game=${r.gameId ?? '?'} env=${r.env ?? '?'} build=${r.buildVersion ?? '?'} contract=${r.contractVersion ?? '?'}`,
  );
  if (r.checks) {
    for (const [k, v] of Object.entries(r.checks)) {
      if (typeof v === 'boolean') lines.push(`  ${v ? '[ok]  ' : '[FAIL]'} ${k}`);
      else lines.push(`  ${k}=${JSON.stringify(v)}`);
    }
  }
  if (!readyOk) ok = false;

  if (opts.assert) {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.opsSecret) headers['x-ops-secret'] = opts.opsSecret;
    const ops = await getJson(f, `${base}/health/ops?assert=${opts.assert}`, headers, timeoutMs);
    if (ops.status === 0) {
      lines.push(`ops: unreachable (${ops.error})`);
      return { ok: false, lines, ready: ready.body };
    }
    const o = (ops.body ?? {}) as OpsLike;
    lines.push(
      `ops(assert=${opts.assert}): HTTP ${ops.status} status=${o.status ?? '?'} window=${o.windowMinutes ?? '?'}m outbox.pending=${o.outbox?.pending ?? '?'} outbox.deadLetters=${o.outbox?.deadLetters ?? '?'} saves.pendingReviews=${o.saves?.pendingReviews ?? '?'}`,
    );
    for (const i of o.issues ?? [])
      lines.push(`  [${i.tier ?? '?'}] ${i.code ?? ''} ${i.message ?? ''}`.trimEnd());
    if (typeof o.restoreVerifiedAt === 'number')
      lines.push(`  restoreVerifiedAt=${new Date(o.restoreVerifiedAt).toISOString()}`);
    if (ops.status !== 200) ok = false;
    return { ok, lines, ready: ready.body, ops: ops.body };
  }
  return { ok, lines, ready: ready.body };
}
