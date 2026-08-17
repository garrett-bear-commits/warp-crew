// Runtime configuration (§11 "Wire createGameClient(gameConfig) + PlatformProvider (Jest in prod,
// standalone on our QA host, mock in tests)"). Build-time inputs are VITE_API_URL,
// VITE_BUILD_VERSION and VITE_PLATFORM; everything else comes from the URL so one build serves
// dev, e2e and prod:
//   ?platform=mock|jest|standalone   ?player=<id>   ?guest=1   ?token=<qa token>   ?pushMs=<ms>
import type { StorageTier } from '@foundation/client';

export type PlatformKind = 'mock' | 'jest' | 'standalone';

export interface GameConfig {
  apiUrl: string;
  gameId: string;
  buildVersion: string;
  platform: PlatformKind;
  /** Player id for the mock/standalone platforms (ignored by jest: the SDK is the identity). */
  playerId: string;
  registered: boolean;
  /** QA-minted token for the standalone platform (`?token=`). */
  token: string | null;
  /** Server push interval (ms); the default is the adapter's 60 s state-driven timer. */
  pushMs: number;
  /** Config re-fetch interval (ms). */
  configRefreshMs: number;
}

const env = import.meta.env as Record<string, string | undefined>;

export const CATALOG = [
  { sku: 'gems_100', packKey: 'handful', title: 'Handful of gems', amount: 100, price: 0.99 },
  { sku: 'gems_550', packKey: 'pouch', title: 'Pouch of gems', amount: 550, price: 4.99 },
  { sku: 'gems_1200', packKey: 'bowl', title: 'Bowl of gems', amount: 1200, price: 9.99 },
] as const;
export type CatalogEntry = (typeof CATALOG)[number];

export const BOARD_KEY = 'clicks';
export const PLAYER_ID_KEY = 'template:playerId';

function readSearch(): URLSearchParams {
  const g = globalThis as { location?: { search?: string } };
  return new URLSearchParams(g.location?.search ?? '');
}

/** Stable per-origin player id: `?player=` wins, else localStorage 'template:playerId', else a fresh UUID. */
export function resolvePlayerId(storage: StorageTier, params: URLSearchParams): string {
  const fromUrl = params.get('player');
  // mock tokens are dot-separated: the player id must not contain dots
  if (fromUrl && /^[A-Za-z0-9_-]{1,120}$/.test(fromUrl)) return fromUrl;
  const stored = storage.get(PLAYER_ID_KEY);
  if (stored && /^[A-Za-z0-9_-]{1,120}$/.test(stored)) return stored;
  const fresh = crypto.randomUUID();
  storage.set(PLAYER_ID_KEY, fresh);
  return fresh;
}

export function readConfig(storage: StorageTier): GameConfig {
  const params = readSearch();
  const p = params.get('platform') ?? env.VITE_PLATFORM;
  // mock is the dev/e2e default; a Jest deployment builds with VITE_PLATFORM=jest
  const platform: PlatformKind = p === 'jest' || p === 'standalone' ? p : 'mock';
  const pushMs = Number(params.get('pushMs'));
  return {
    apiUrl: env.VITE_API_URL ?? 'http://localhost:8080',
    gameId: 'template',
    buildVersion: env.VITE_BUILD_VERSION ?? '1.0.0-dev',
    platform,
    playerId: resolvePlayerId(storage, params),
    registered: params.get('guest') !== '1',
    token: params.get('token'),
    pushMs: Number.isFinite(pushMs) && pushMs >= 1000 ? pushMs : 60_000,
    configRefreshMs: 30_000,
  };
}
