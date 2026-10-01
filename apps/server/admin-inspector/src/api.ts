// Admin API client for the inspector (ADR-021). Mirrors packages/server/src/features/admin/client.ts
// but is a standalone copy: the inspector must not import @foundation/server. Credentials live in a
// closure in memory only (never storage); they travel as x-admin-key-id / x-admin-secret headers.
import type { ErrorEnvelope } from '@foundation/contracts';

export interface AdminCreds {
  keyId: string;
  secret: string;
}

export interface Connection extends AdminCreds {
  origin: string;
  /** Absolute browser URL for the game client; held in memory with the credentials. */
  clientUrl?: string;
}

export type AdminResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error: ErrorEnvelope | null };

/** status 0 = network failure (no HTTP response). Retrying with the same commandId is safe. */
export function isNetworkFailure(r: AdminResult<unknown>): boolean {
  return !r.ok && r.status === 0;
}

/** Trailing slashes are dropped so `${origin}${path}` never doubles a slash. */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export function adminClient(conn: () => Connection | null, f: typeof fetch = fetch) {
  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<AdminResult<T>> {
    const c = conn();
    if (!c) return { ok: false, status: 0, error: null };
    const headers: Record<string, string> = {
      'x-admin-key-id': c.keyId,
      'x-admin-secret': c.secret,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      const res = await f(`${normalizeOrigin(c.origin)}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        // Cookies only to this page's own origin: behind Cloudflare Access its CF_Authorization
        // cookie must reach the edge, or the API call is sent to the login page.
        // An API on another origin (local development) still gets none.
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as unknown;
      if (res.ok) return { ok: true, status: res.status, body: json as T };
      return { ok: false, status: res.status, error: (json as ErrorEnvelope | null) ?? null };
    } catch {
      return { ok: false, status: 0, error: null };
    }
  }
  return {
    call,
    get: <T>(path: string) => call<T>('GET', path),
    post: <T>(path: string, body: unknown) => call<T>('POST', path, body),
  };
}

export type AdminApi = ReturnType<typeof adminClient>;

/** Human-readable one-liner for a failed result. */
export function describeFailure(r: { status: number; error: ErrorEnvelope | null }): string {
  if (r.status === 0) return 'network error (no response) — check origin, CORS and connectivity';
  const code = r.error?.error ?? 'error';
  const msg = r.error?.message ? `: ${r.error.message}` : '';
  const corr = r.error?.correlationId ? ` [${r.error.correlationId}]` : '';
  return `HTTP ${r.status} ${code}${msg}${corr}`;
}
