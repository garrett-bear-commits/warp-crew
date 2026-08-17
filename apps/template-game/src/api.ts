// Game-side API: one authenticated fetch helper (the adapter's browser-safe createApi) feeding the
// clock with every serverNow (ADR-009), plus the feature client entry points from
// @foundation/server/features/<f>/client (thin wrappers, types only — never the server root).
import {
  createApi,
  mintId,
  type Api,
  type ApiResult,
  type CallOptions,
  type ClientAuth,
  type Clock,
} from '@foundation/client';
import { achievementsClient } from '@foundation/server/features/achievements/client';
import { grantsClient } from '@foundation/server/features/grants/client';
import { inboxClient } from '@foundation/server/features/inbox/client';
import { leaderboardsClient } from '@foundation/server/features/leaderboards/client';
import { lineageClient } from '@foundation/server/features/lineage/client';
import { liveopsClient } from '@foundation/server/features/liveops/client';
import { purchasesClient } from '@foundation/server/features/purchases/client';
import { savesClient } from '@foundation/server/features/saves/client';
import { telemetryClient } from '@foundation/server/features/telemetry/client';

export interface GameApi {
  api: Api;
  saves: ReturnType<typeof savesClient>;
  lineage: ReturnType<typeof lineageClient>;
  purchases: ReturnType<typeof purchasesClient>;
  grants: ReturnType<typeof grantsClient>;
  achievements: ReturnType<typeof achievementsClient>;
  liveops: ReturnType<typeof liveopsClient>;
  inbox: ReturnType<typeof inboxClient>;
  boards: ReturnType<typeof leaderboardsClient>;
  telemetry: ReturnType<typeof telemetryClient>;
  /** Last HTTP status seen on any call (426 = update required surfaces in the UI). */
  lastStatus(): number;
  onStatus(cb: (status: number) => void): () => void;
}

export function createGameApi(o: {
  baseUrl: string;
  clock: Clock;
  auth: () => ClientAuth | null;
}): GameApi {
  const base = createApi({ baseUrl: o.baseUrl, auth: o.auth, requestId: mintId });
  let last = 0;
  const subs = new Set<(s: number) => void>();
  const api: Api = {
    baseUrl: base.baseUrl,
    async call<T>(
      method: 'GET' | 'POST' | 'PUT',
      path: string,
      body?: unknown,
      opts?: CallOptions,
    ): Promise<ApiResult<T>> {
      const sentAt = o.clock.deviceNow();
      const r = await base.call<T>(method, path, body, opts);
      last = r.status;
      if (r.ok) {
        const b = r.body as { serverNow?: unknown } | null;
        if (b && typeof b === 'object' && typeof b.serverNow === 'number')
          o.clock.observe(sentAt, o.clock.deviceNow(), b.serverNow);
      }
      for (const s of subs) s(r.status);
      return r;
    },
  };
  return {
    api,
    saves: savesClient(api),
    lineage: lineageClient(api),
    purchases: purchasesClient(api),
    grants: grantsClient(api),
    achievements: achievementsClient(api),
    liveops: liveopsClient(api),
    inbox: inboxClient(api),
    boards: leaderboardsClient(api),
    telemetry: telemetryClient(api),
    lastStatus: () => last,
    onStatus(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}
