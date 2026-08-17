// telemetry client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type { IntegrityBatchBody, IntegrityBatchResult } from '@foundation/contracts';
export function telemetryClient(api: Api) {
  return {
    integrity: (body: IntegrityBatchBody) =>
      api.call<IntegrityBatchResult>('POST', '/v1/telemetry/integrity', body),
  };
}
