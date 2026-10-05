// qa client entry (browser-safe): thin fetch wrapper, types only.
import type { QaMintBody, QaMintResult } from '@foundation/contracts';
/** Lab-only helper used by the acceptance suite; requires the ops secret. */
export async function qaMint(
  baseUrl: string,
  opsSecret: string,
  body: QaMintBody,
  f: typeof fetch = fetch,
): Promise<QaMintResult> {
  const res = await f(`${baseUrl}/qa/v1/identity/mint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ops-secret': opsSecret },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`qa mint failed: ${res.status}`);
  return (await res.json()) as QaMintResult;
}
