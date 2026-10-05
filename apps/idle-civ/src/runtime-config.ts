import type { StorageTier } from '@foundation/client';

export type PlatformKind = 'mock' | 'jest' | 'standalone';

export interface RuntimeConfig {
  apiUrl: string;
  gameId: string;
  buildVersion: string;
  platform: PlatformKind;
  playerId: string;
  registered: boolean;
  token: string | null;
  pushMs: number;
  configRefreshMs: number;
}

const buildEnv = import.meta.env as Record<string, string | boolean | undefined>;
const PLAYER_ID_KEY = 'idle-civ:playerId';

function readSearch(search?: string): URLSearchParams {
  if (search !== undefined) return new URLSearchParams(search);
  const g = globalThis as { location?: { search?: string } };
  return new URLSearchParams(g.location?.search ?? '');
}

export function resolvePlayerId(storage: StorageTier, params: URLSearchParams): string {
  const fromUrl = params.get('player');
  if (fromUrl && /^[A-Za-z0-9_-]{1,120}$/.test(fromUrl)) return fromUrl;
  const stored = storage.get(PLAYER_ID_KEY);
  if (stored && /^[A-Za-z0-9_-]{1,120}$/.test(stored)) return stored;
  const fresh = crypto.randomUUID();
  storage.set(PLAYER_ID_KEY, fresh);
  return fresh;
}

export function readConfig(
  storage: StorageTier,
  options: {
    env?: Record<string, string | boolean | undefined>;
    search?: string;
    production?: boolean;
  } = {},
): RuntimeConfig {
  const runtimeEnv = options.env ?? buildEnv;
  const production = options.production ?? runtimeEnv.PROD === true;
  const allowQaQuery = !production || runtimeEnv.VITE_ALLOW_QA_QUERY === 'true';
  const params = allowQaQuery ? readSearch(options.search) : new URLSearchParams();
  const built = runtimeEnv.VITE_PLATFORM;
  const selected = production ? built : (params.get('platform') ?? built);
  let platform: PlatformKind = selected === 'jest' || selected === 'standalone' ? selected : 'mock';
  if (production && !allowQaQuery && platform === 'mock') platform = 'jest';
  const pushMs = Number(params.get('pushMs'));
  return {
    apiUrl:
      typeof runtimeEnv.VITE_API_URL === 'string'
        ? runtimeEnv.VITE_API_URL
        : 'http://localhost:8080',
    gameId: 'idle-civ',
    buildVersion:
      typeof runtimeEnv.VITE_BUILD_VERSION === 'string'
        ? runtimeEnv.VITE_BUILD_VERSION
        : '1.0.0-dev',
    platform,
    playerId: resolvePlayerId(storage, params),
    registered: params.get('guest') !== '1',
    token: params.get('token'),
    pushMs: Number.isFinite(pushMs) && pushMs >= 1000 ? pushMs : 60_000,
    configRefreshMs: 30_000,
  };
}
