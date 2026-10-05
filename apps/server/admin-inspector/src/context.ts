// What every workspace gets from the signed-in shell (types only).
import type { ErrorEnvelope } from '@foundation/contracts';
import type { AdminApi } from './api.ts';
import type { EnvBadge } from './env.ts';
import type { KeyAccess } from './scopes.ts';
import type { Tone } from './ui.ts';
import type { WriteDeps } from './writes.ts';

export interface AppCtx {
  /** The mounted console (removed on sign-out). */
  readonly root: HTMLElement;
  readonly api: AdminApi;
  readonly env: EnvBadge;
  readonly access: KeyAccess;
  readonly writes: WriteDeps;
  /** Aborted on sign-out: listeners on window/document pass it. */
  readonly signal: AbortSignal;
  notify(message: string, tone?: Tone): void;
  failure(r: { status: number; error: ErrorEnvelope | null }): string;
  /** Opens the incognito popup synchronously (call straight from a click). */
  launchIncognito(playerKey: string, seq: number): void;
}
