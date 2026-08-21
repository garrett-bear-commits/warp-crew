// identity feature (§4.3): IdentityVerifier plug (Jest HS256 | mock) is created in the composition
// root; this feature owns the players projection (first/last seen, registered, build, seen_days,
// entry payload allow-listed) and the player_flags guard consulted by middleware.
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../http/context.ts';
import type { ExecCtx } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';

const SEEN_THROTTLE_MS = 60_000;
const PURCHASE_VERIFICATION_COMMANDS = ['purchases.verify', 'purchases.verifyBatch'] as const;
export const ENTRY_PAYLOAD_ALLOWLIST = ['ref', 'campaign', 'source', 'entry'] as const;

export function allowlistEntryPayload(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, string> = {};
  for (const k of ENTRY_PAYLOAD_ALLOWLIST) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.length <= 128) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export interface PlayerFlagsView {
  purchasesDisabled: boolean;
  boardsHidden: boolean;
  grantsFrozen: boolean;
}

export async function playerFlags(
  ctx: AppContext,
  playerKey: string,
  now: number,
): Promise<PlayerFlagsView> {
  const rows = await ctx.db.sql<
    { flag: string; until: Date | null }[]
  >`SELECT flag, until FROM player_flags WHERE player_key = ${playerKey} AND enabled`;
  const active = (f: string) =>
    rows.some((r) => r.flag === f && (r.until === null || r.until.getTime() > now));
  return {
    purchasesDisabled: active('purchases_disabled'),
    boardsHidden: active('boards_hidden'),
    grantsFrozen: active('grants_frozen'),
  };
}

export function registerIdentity(_app: FastifyInstance, ctx: AppContext): void {
  const seen = new Map<string, number>();
  ctx.onPlayerSeen = async (exec: ExecCtx) => {
    if (exec.actor.kind !== 'player' || !exec.playerKey) return;
    const last = seen.get(exec.playerKey) ?? 0;
    if (exec.now - last < SEEN_THROTTLE_MS) return;
    seen.set(exec.playerKey, exec.now);
    if (seen.size > 50_000) seen.clear();
    try {
      const now = new Date(exec.now);
      await ctx.db.sql`
        INSERT INTO players (player_key, first_seen_at, last_seen_at, registered, last_build, seen_days, last_seen_day)
        VALUES (${exec.playerKey}, ${now}, ${now}, ${exec.actor.registered}, ${exec.buildVersion ?? null}, 1, (${now} AT TIME ZONE 'UTC')::date)
        ON CONFLICT (player_key) DO UPDATE SET
          last_seen_at = EXCLUDED.last_seen_at,
          registered = players.registered OR EXCLUDED.registered,
          last_build = COALESCE(EXCLUDED.last_build, players.last_build),
          seen_days = players.seen_days + CASE WHEN players.last_seen_day < EXCLUDED.last_seen_day THEN 1 ELSE 0 END,
          last_seen_day = GREATEST(players.last_seen_day, EXCLUDED.last_seen_day)`;
    } catch (e) {
      ctx.log.warn({ err: String(e) }, 'players projection touch failed');
    }
  };

  // Middleware guard: player_flags + kill switches per command (§7 middleware consults player_flags).
  const guard = async (def: { type: string }, exec: ExecCtx) => {
    const isPurchaseVerification =
      def.type === 'purchases.verify' || def.type === 'purchases.verifyBatch';
    const killSwitch = isPurchaseVerification
      ? (PURCHASE_VERIFICATION_COMMANDS.find((id) => ctx.liveops.killSwitch('command', id)) ?? null)
      : ctx.liveops.killSwitch('command', def.type)
        ? def.type
        : null;
    if (killSwitch)
      throw new AppError('forbidden', `command ${def.type} is switched off`, {
        killSwitch,
      });
    if (exec.actor.kind !== 'player' || !exec.playerKey) return;
    if (
      def.type.startsWith('purchases.') ||
      def.type.startsWith('grants.') ||
      def.type.startsWith('codes.') ||
      def.type.startsWith('boards.')
    ) {
      const f = await playerFlags(ctx, exec.playerKey, exec.now);
      if (def.type.startsWith('purchases.') && f.purchasesDisabled)
        throw new AppError('purchases_disabled', 'purchases are disabled for this player');
      if (
        (def.type.startsWith('grants.') || def.type.startsWith('codes.')) &&
        f.grantsFrozen &&
        def.type !== 'grants.pending'
      )
        throw new AppError('forbidden', 'grants are frozen for this player', {
          grantsFrozen: true,
        });
    }
  };
  ctx.busGuards.push(guard);
}
