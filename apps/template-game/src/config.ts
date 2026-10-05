// Runtime configuration (§11 "Wire createGameClient(gameConfig) + PlatformProvider (Jest in prod,
// standalone on our QA host, mock in tests)"). Build-time inputs are VITE_API_URL,
// VITE_BUILD_VERSION and VITE_PLATFORM. URL controls are development/test-only; real production
// builds are locked to their build-time platform and never accept QA identities or tokens:
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
  /** Whether Jest may show its escalating automatic registration reminders. */
  autoLoginReminders: boolean;
  /** Developer Console asset reference; it must be approved before real notification delivery. */
  notificationAssetReference: string;
}

const buildEnv = import.meta.env as Record<string, string | boolean | undefined>;

export interface ReadConfigOptions {
  /** Test seam; defaults to import.meta.env. */
  env?: Record<string, string | boolean | undefined>;
  /** Test seam; defaults to window.location.search. Ignored in production unless QA is flagged. */
  search?: string;
  /** Test seam; defaults to import.meta.env.PROD. */
  production?: boolean;
}

export const CATALOG = [
  { sku: 'gems_100', packKey: 'handful', title: 'Handful of gems', amount: 100 },
  { sku: 'gems_550', packKey: 'pouch', title: 'Pouch of gems', amount: 550 },
  { sku: 'gems_1200', packKey: 'bowl', title: 'Bowl of gems', amount: 1200 },
] as const;
export type CatalogEntry = (typeof CATALOG)[number];

export const BOARD_KEY = 'clicks';
export const PLAYER_ID_KEY = 'template:playerId';

function readSearch(search?: string): URLSearchParams {
  if (search !== undefined) return new URLSearchParams(search);
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

export function readConfig(storage: StorageTier, options: ReadConfigOptions = {}): GameConfig {
  const runtimeEnv = options.env ?? buildEnv;
  const production = options.production ?? runtimeEnv.PROD === true;
  const allowQaQuery = !production || runtimeEnv.VITE_ALLOW_QA_QUERY === 'true';
  // Arbitrary query parameters are not a reliable production entry channel on Jest. In production,
  // entry attribution comes from JestSDK.getEntryPayload() and the provider is build-time only.
  const params = allowQaQuery ? readSearch(options.search) : new URLSearchParams();
  const built = runtimeEnv.VITE_PLATFORM;
  const selected = production ? built : (params.get('platform') ?? built);
  // mock is the dev/e2e default; a Jest deployment builds with VITE_PLATFORM=jest.
  let platform: PlatformKind = selected === 'jest' || selected === 'standalone' ? selected : 'mock';
  // A normal production build fails toward the real platform. Mock production artifacts exist only
  // for the explicitly flagged local Playwright build and must never be published.
  if (production && !allowQaQuery && platform === 'mock') platform = 'jest';
  const pushMs = Number(params.get('pushMs'));
  return {
    apiUrl:
      typeof runtimeEnv.VITE_API_URL === 'string'
        ? runtimeEnv.VITE_API_URL
        : 'http://localhost:8080',
    gameId: 'template',
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
    autoLoginReminders: runtimeEnv.VITE_AUTO_LOGIN_REMINDERS !== 'false',
    notificationAssetReference:
      typeof runtimeEnv.VITE_NOTIFICATION_ASSET_REFERENCE === 'string'
        ? runtimeEnv.VITE_NOTIFICATION_ASSET_REFERENCE
        : 'template-return-v1',
  };
}
