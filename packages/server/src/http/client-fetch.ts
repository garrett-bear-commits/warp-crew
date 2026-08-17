// Browser-safe fetch helper shared by feature client entry points. No node builtins, no TypeBox
// runtime: types only. Every mutation carries a client-minted commandId (§6).
import type { ErrorEnvelope } from '@foundation/contracts';

export interface ClientAuth {
  playerKey: string;
  token: string;
  buildVersion?: string;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  auth?: () => ClientAuth | null;
  requestId?: () => string;
}

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error: ErrorEnvelope | null; networkError?: string };

export function createApi(o: ApiClientOptions) {
  const f = o.fetch ?? fetch;
  async function call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    opts: { auth?: boolean; text?: boolean } = { auth: true },
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = opts.text ? 'text/plain' : 'application/json';
    if (opts.auth !== false) {
      const a = o.auth?.();
      if (a) {
        headers['x-player-key'] = a.playerKey;
        headers['authorization'] = `Bearer ${a.token}`;
        if (a.buildVersion) headers['x-build-version'] = a.buildVersion;
      }
    }
    if (o.requestId) headers['x-request-id'] = o.requestId();
    try {
      const res = await f(`${o.baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      if (res.ok) return { ok: true, status: res.status, body: json as T };
      return { ok: false, status: res.status, error: (json as ErrorEnvelope | null) ?? null };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        error: null,
        networkError: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return { call };
}

export type Api = ReturnType<typeof createApi>;
