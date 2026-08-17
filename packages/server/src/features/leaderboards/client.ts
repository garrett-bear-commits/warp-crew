// leaderboards client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type {
  RunStartBody,
  RunStartResult,
  RunSubmitBody,
  RunSubmitResult,
  BoardTopResponse,
  BoardMeResponse,
  PlacementClaimBody,
  PlacementClaimResult,
  DisplayNameBody,
  DisplayNameResult,
} from '@foundation/contracts';
export function leaderboardsClient(api: Api) {
  return {
    start: (board: string, body: RunStartBody) =>
      api.call<RunStartResult>('POST', `/v1/leaderboards/${board}/start`, body),
    submit: (board: string, body: RunSubmitBody) =>
      api.call<RunSubmitResult>('POST', `/v1/leaderboards/${board}/submit`, body),
    top: (board: string) =>
      api.call<BoardTopResponse>('GET', `/v1/leaderboards/${board}/top`, undefined, {
        auth: false,
      }),
    me: (board: string) => api.call<BoardMeResponse>('GET', `/v1/leaderboards/${board}/me`),
    claimPlacement: (body: PlacementClaimBody) =>
      api.call<PlacementClaimResult>('POST', '/v1/leaderboards/placements/claim', body),
    setName: (body: DisplayNameBody) =>
      api.call<DisplayNameResult>('POST', '/v1/leaderboards/name', body),
  };
}
