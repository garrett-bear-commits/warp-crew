import {
  createApi,
  mintId,
  type Api,
  type ApiResult,
  type CallOptions,
  type ClientAuth,
  type Clock,
} from '@foundation/client';
import { liveopsClient } from '@foundation/server/features/liveops/client';
import { savesClient } from '@foundation/server/features/saves/client';
import { telemetryClient } from '@foundation/server/features/telemetry/client';

export interface GameApi {
  api: Api;
  saves: ReturnType<typeof savesClient>;
  liveops: ReturnType<typeof liveopsClient>;
  telemetry: ReturnType<typeof telemetryClient>;
  lastStatus(): number;
  onStatus(cb: (status: number) => void): () => void;
}

export function createGameApi(o: {
  baseUrl: string;
  clock: Clock;
  auth: () => ClientAuth | null;
  refreshAuth: () => Promise<boolean>;
}): GameApi {
  const base = createApi({
    baseUrl: o.baseUrl,
    auth: o.auth,
    refreshAuth: o.refreshAuth,
    requestId: mintId,
  });
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
    liveops: liveopsClient(api),
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
