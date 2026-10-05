import {
  createGameClient,
  incognitoClientOptions,
  type Clock,
  type IncognitoSession,
  type PlatformAdapter,
} from '@foundation/client';
import type { RuntimeConfig } from './runtime-config.ts';
import { idleCivCodec, idleCivEngine, TPS, type IdleCivState } from './sim/index.ts';

/** One composition function for normal play and the isolated operator snapshot path. */
export function createIdleCivClient(o: {
  cfg: RuntimeConfig;
  clock: Clock;
  platform: PlatformAdapter;
  incognito?: IncognitoSession<IdleCivState>;
}) {
  return createGameClient({
    engine: idleCivEngine,
    codec: idleCivCodec,
    platform: o.platform,
    serverUrl: o.cfg.apiUrl,
    gameId: o.cfg.gameId,
    buildVersion: o.cfg.buildVersion,
    journal: 'errors_only',
    clock: o.clock,
    loop: { tps: TPS },
    sync: { pushMs: o.cfg.pushMs },
    journalArgs: {
      assign_worker: ['profession', 'delta'],
      fund_job: ['jobId'],
      craft_tool: ['kind'],
      equip_founder_card: ['cardId'],
    },
    describeAction: (a) => {
      switch (a.type) {
        case 'assign_worker':
          return { name: a.type, args: { profession: a.profession, delta: a.delta } };
        case 'fund_job':
          return { name: a.type, args: { jobId: a.jobId } };
        case 'craft_tool':
          return { name: a.type, args: { kind: a.kind } };
        case 'equip_founder_card':
          return { name: a.type, args: { cardId: a.cardId } };
        default:
          return { name: a.type };
      }
    },
    ...(o.incognito ? incognitoClientOptions(o.incognito) : {}),
  });
}

export type IdleCivGameClient = ReturnType<typeof createIdleCivClient>;
