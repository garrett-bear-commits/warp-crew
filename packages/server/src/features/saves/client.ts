// saves client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type {
  SaveWriteBody,
  SaveWriteResult,
  SaveCurrentResponse,
  SaveHistoryResponse,
  SaveBlobResponse,
} from '@foundation/contracts';
export function savesClient(api: Api) {
  return {
    write: (body: SaveWriteBody) => api.call<SaveWriteResult>('PUT', '/v1/saves', body),
    current: (meta = false) =>
      api.call<SaveCurrentResponse>('GET', `/v1/saves/current${meta ? '?meta=1' : ''}`),
    history: (limit = 50) =>
      api.call<SaveHistoryResponse>('GET', `/v1/saves/history?limit=${limit}`),
    blob: (seq: number) => api.call<SaveBlobResponse>('GET', `/v1/saves/history/${seq}/blob`),
  };
}
