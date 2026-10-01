// names client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type { NameCheckBody, NameCheckResult } from '@foundation/contracts';
export function namesClient(api: Api) {
  return {
    check: (body: NameCheckBody) => api.call<NameCheckResult>('POST', '/v1/names/check', body),
  };
}
