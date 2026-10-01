// What a signed-in key may see. Each capability needs every scope listed (the scope each admin
// route requires, packages/contracts/src/routes.ts). Player-scoped writes also need `read`: they
// live in the player view, which loads the player first.
import { ADMIN_SCOPES, type AdminScope } from '@foundation/contracts/enums';

export const CAPABILITY_SCOPES = {
  /** Player lookup, overview, timeline, saves (GET /admin/v1/players/…). */
  players: ['read'],
  /** Save viewer (GET …/saves/:seq/blob). */
  saveViewer: ['read'],
  /** Play incognito (reads the blob, then hands it to the game). */
  incognito: ['read'],
  /** Admin actions and dead letters (GET /admin/v1/actions, …/outbox/dead-letters). */
  audit: ['read'],
  /** POST /admin/v1/letters. */
  letter: ['read', 'support'],
  /** POST /admin/v1/players/flags. */
  playerFlag: ['read', 'support'],
  /** POST /admin/v1/grants. */
  grant: ['read', 'grant'],
  /** POST /admin/v1/purchases/adjustments (Fix purchase). */
  adjustPurchase: ['read', 'grant'],
  /** POST /admin/v1/players/restore. */
  restore: ['read', 'restore'],
  /** POST /admin/v1/saves/reviews. */
  saveReview: ['read', 'restore'],
  /** POST /admin/v1/outbox/replay (from the dead-letter list). */
  deadLetterReplay: ['read', 'support'],
  /** POST /admin/v1/liveops/flags. */
  publishFlag: ['publish'],
  /** POST /admin/v1/liveops/content. */
  publishContent: ['publish'],
  /** POST /admin/v1/grants/cohort. */
  cohortGrant: ['grant'],
} as const satisfies Record<string, readonly AdminScope[]>;

export type Capability = keyof typeof CAPABILITY_SCOPES;
export type Workspace = 'players' | 'liveops' | 'audit';

export const WORKSPACE_CAPABILITIES: Record<Workspace, readonly Capability[]> = {
  players: ['players'],
  liveops: ['publishFlag', 'publishContent', 'cohortGrant'],
  audit: ['audit'],
};

const WORKSPACE_ORDER: readonly Workspace[] = ['players', 'liveops', 'audit'];

export interface KeyAccess {
  /** Known scopes of the key, in ADMIN_SCOPES order (unknown strings dropped). */
  readonly scopes: readonly AdminScope[];
  readonly capabilities: ReadonlySet<Capability>;
  /** Workspaces with at least one usable capability, in navigation order. */
  readonly workspaces: readonly Workspace[];
  can(capability: Capability): boolean;
}

export function accessFor(scopes: readonly string[]): KeyAccess {
  const held = new Set(scopes);
  const known = ADMIN_SCOPES.filter((s) => held.has(s));
  const capabilities = new Set<Capability>();
  for (const [cap, needs] of Object.entries(CAPABILITY_SCOPES) as Array<
    [Capability, readonly AdminScope[]]
  >) {
    if (needs.every((s) => held.has(s))) capabilities.add(cap);
  }
  const workspaces = WORKSPACE_ORDER.filter((w) =>
    WORKSPACE_CAPABILITIES[w].some((c) => capabilities.has(c)),
  );
  return {
    scopes: known,
    capabilities,
    workspaces,
    can: (c) => capabilities.has(c),
  };
}
