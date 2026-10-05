// lineage client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type {
  LineageRestartBody,
  LineageRestoreToSeqBody,
  LineageReattachBody,
  GenerationReceipt,
} from '@foundation/contracts';
export function lineageClient(api: Api) {
  return {
    restart: (body: LineageRestartBody) =>
      api.call<GenerationReceipt>('POST', '/v1/lineage/restart', body),
    restoreToSeq: (body: LineageRestoreToSeqBody) =>
      api.call<GenerationReceipt>('POST', '/v1/lineage/restoreToSeq', body),
    reattach: (body: LineageReattachBody) =>
      api.call<GenerationReceipt>('POST', '/v1/lineage/reattach', body),
  };
}
