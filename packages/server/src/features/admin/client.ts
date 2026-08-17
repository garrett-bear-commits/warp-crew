// admin client entry (browser-safe): thin fetch wrapper, types only.
// Admin client is used by the static inspector (separate origin). Admin key id + secret travel as headers.
import type { ErrorEnvelope } from '@foundation/contracts';
export interface AdminCreds {
  keyId: string;
  secret: string;
}
export type AdminResult<T> =
  { ok: true; body: T } | { ok: false; status: number; error: ErrorEnvelope | null };
export function adminClient(
  baseUrl: string,
  creds: () => AdminCreds | null,
  f: typeof fetch = fetch,
) {
  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<AdminResult<T>> {
    const c = creds();
    const headers: Record<string, string> = {};
    if (c) {
      headers['x-admin-key-id'] = c.keyId;
      headers['x-admin-secret'] = c.secret;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      const res = await f(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      if (res.ok) return { ok: true, body: json as T };
      return { ok: false, status: res.status, error: (json as ErrorEnvelope | null) ?? null };
    } catch {
      return { ok: false, status: 0, error: null };
    }
  }
  return { call };
}
