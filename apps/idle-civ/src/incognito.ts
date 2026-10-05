import {
  createStandalonePlatform,
  seedIncognitoSnapshot,
  type Clock,
  type IncognitoSession,
  type IncognitoSnapshot,
  type PlatformAdapter,
} from '@foundation/client';
import { createIdleCivClient, type IdleCivGameClient } from './client.ts';
import { readConfig, type RuntimeConfig } from './runtime-config.ts';
import { idleCivCodec, idleCivEngine, type IdleCivState } from './sim/index.ts';

export interface IdleCivIncognitoRuntime {
  readonly cfg: RuntimeConfig;
  readonly platform: PlatformAdapter;
  readonly client: IdleCivGameClient;
  readonly session: IncognitoSession<IdleCivState>;
}

/**
 * Build the game from a retained snapshot without touching the normal platform, localStorage, or
 * game-side API. The returned client has a fail-closed fetch in addition to disabled sync paths.
 */
export async function createIdleCivIncognitoRuntime(o: {
  snapshot: IncognitoSnapshot;
  clock: Clock;
}): Promise<IdleCivIncognitoRuntime> {
  const session = await seedIncognitoSnapshot({
    gameId: 'idle-civ',
    codec: idleCivCodec,
    snapshot: o.snapshot,
    progressOf: idleCivEngine.progressOf,
    now: o.clock.now,
  });
  const cfg: RuntimeConfig = {
    ...readConfig(session.storage),
    platform: 'standalone',
    playerId: session.playerId,
    registered: false,
    token: null,
  };
  const platform = createStandalonePlatform({
    playerId: session.playerId,
    // No credential exists in this mode. The fail-closed fetch remains a second fence.
    token: '',
    registered: false,
    share: null,
  });
  const client = createIdleCivClient({ cfg, clock: o.clock, platform, incognito: session });
  return { cfg, platform, client, session };
}
