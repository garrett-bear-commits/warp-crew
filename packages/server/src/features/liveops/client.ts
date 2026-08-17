// liveops client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type {
  ConfigResponse,
  SchedulesResponse,
  ContentDocumentResponse,
} from '@foundation/contracts';
import type { ContentKind } from '@foundation/contracts/enums';
export function liveopsClient(api: Api) {
  return {
    config: (authed = true) =>
      api.call<ConfigResponse>('GET', '/v1/config', undefined, { auth: authed }),
    schedules: () =>
      api.call<SchedulesResponse>('GET', '/v1/schedules', undefined, { auth: false }),
    content: (kind: ContentKind) =>
      api.call<ContentDocumentResponse>('GET', `/v1/content/${kind}`, undefined, { auth: false }),
  };
}
