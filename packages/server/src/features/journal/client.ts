// journal client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type { JournalShipBody, JournalShipResult } from '@foundation/contracts';
export function journalClient(api: Api) {
  return {
    ship: (body: JournalShipBody) => api.call<JournalShipResult>('POST', '/v1/journal', body),
  };
}
