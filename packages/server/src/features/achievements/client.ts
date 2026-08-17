// achievements client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
import type {
  AchievementsMeResponse,
  AchievementsEvaluateBody,
  AchievementsEvaluateResult,
  DailyClaimBody,
  DailyClaimResult,
} from '@foundation/contracts';
export function achievementsClient(api: Api) {
  return {
    me: () => api.call<AchievementsMeResponse>('GET', '/v1/achievements/me'),
    evaluate: (body: AchievementsEvaluateBody) =>
      api.call<AchievementsEvaluateResult>('POST', '/v1/achievements/evaluate', body),
    claimDaily: (body: DailyClaimBody) =>
      api.call<DailyClaimResult>('POST', '/v1/daily/claim', body),
  };
}
