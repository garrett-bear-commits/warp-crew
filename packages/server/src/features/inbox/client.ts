// inbox client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type {
  InboxResponse,
  InboxReadBody,
  FeedbackBody,
  FeedbackResult,
  Ok,
} from '@foundation/contracts';
export function inboxClient(api: Api) {
  return {
    list: () => api.call<InboxResponse>('GET', '/v1/inbox'),
    read: (body: InboxReadBody) => api.call<Ok>('POST', '/v1/inbox/read', body),
    feedback: (body: FeedbackBody) => api.call<FeedbackResult>('POST', '/v1/feedback', body),
  };
}
