// Browser-safe fetch helper (§6 headers, §4.2 error envelope). A deliberate copy of the tiny
// helper in packages/server/src/http/client-fetch.ts: the client package must not depend on
// @foundation/server (lint), and the helper is small enough that one copy per side is cheaper
// than a shared package. Types only from @foundation/contracts; no TypeBox runtime.
import type { ErrorEnvelope } from '@foundation/contracts';
import { HEADERS } from '@foundation/contracts/enums';

export interface ClientAuth {
  playerKey: string;
  token: string;
  buildVersion?: string;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  auth?: () => ClientAuth | null;
  /** Refresh the current provider credential for a server-requested step-up retry. */
  refreshAuth?: () => Promise<boolean>;
  requestId?: () => string;
}

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error: ErrorEnvelope | null; networkError?: string };

export interface CallOptions {
  /** Attach player headers (default true). */
  auth?: boolean;
  /** Send the body as text/plain (the beacon route; not preflighted). */
  text?: boolean;
  /** Abort signal (bounded head check, §5.2). */
  signal?: AbortSignal;
  /** Override auth for one call (identity switch pushes under the previous token, §5.2). */
  authOverride?: ClientAuth | null;
  /** fetch keepalive (teardown fallback when sendBeacon is unavailable). */
  keepalive?: boolean;
}

export interface Api {
  call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    opts?: CallOptions,
  ): Promise<ApiResult<T>>;
  readonly baseUrl: string;
}

function raceAbort(p: Promise<Response>, signal: AbortSignal): Promise<Response> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (r) => {
        signal.removeEventListener('abort', onAbort);
        resolve(r);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function requestsStepUp(result: ApiResult<unknown>): boolean {
  if (result.ok || result.status !== 401 || !result.error) return false;
  const details = result.error.details;
  return (
    !!details && typeof details === 'object' && (details as { stepUp?: unknown }).stepUp === true
  );
}

export function createApi(o: ApiClientOptions): Api {
  const f = o.fetch ?? fetch;
  async function call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<ApiResult<T>> {
    const send = async (): Promise<ApiResult<T>> => {
      const headers: Record<string, string> = {};
      if (body !== undefined)
        headers['content-type'] = opts.text ? 'text/plain' : 'application/json';
      if (opts.auth !== false) {
        const a = opts.authOverride !== undefined ? opts.authOverride : o.auth?.();
        if (a) {
          headers[HEADERS.playerKey] = a.playerKey;
          headers[HEADERS.authorization] = `Bearer ${a.token}`;
          if (a.buildVersion) headers[HEADERS.buildVersion] = a.buildVersion;
        }
      }
      if (o.requestId) headers[HEADERS.requestId] = o.requestId();
      try {
        const init: RequestInit = { method, headers };
        if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (opts.signal) init.signal = opts.signal;
        if (opts.keepalive) init.keepalive = true;
        const request = f(`${o.baseUrl}${path}`, init);
        // Race the signal explicitly: the bounded head check (§5.2) must resolve on time even
        // when a fetch implementation ignores `signal`.
        const res = opts.signal ? await raceAbort(request, opts.signal) : await request;
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
    };

    const first = await send();
    // Step-up is the only automatic retry. The mutation body — including its commandId — is
    // reused verbatim, while send() rebuilds Authorization from the freshly signed credential.
    if (
      opts.auth !== false &&
      opts.authOverride === undefined &&
      o.refreshAuth &&
      requestsStepUp(first)
    ) {
      try {
        if (await o.refreshAuth()) return send();
      } catch {
        // Preserve the original typed step-up response when refresh itself fails.
      }
    }
    return first;
  }
  return { call, baseUrl: o.baseUrl };
}
