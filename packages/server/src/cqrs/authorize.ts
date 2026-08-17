import type { Actor, ActorPolicy } from './define.ts';
import { AppError } from '../errors.ts';

/** actorPolicy check (authentication happened at the route; this is authorization). */
export function authorizeActor(policy: ActorPolicy, actor: Actor): void {
  if (policy === 'player') {
    if (actor.kind !== 'player') throw new AppError('forbidden', 'player command');
    return;
  }
  if (policy === 'ops') {
    if (actor.kind !== 'ops') throw new AppError('forbidden', 'ops command');
    return;
  }
  if (policy === 'job') {
    if (actor.kind !== 'job' && actor.kind !== 'system')
      throw new AppError('forbidden', 'job command');
    return;
  }
  if (policy === 'system') {
    if (actor.kind !== 'system') throw new AppError('forbidden', 'system command');
    return;
  }
  // admin with scope
  if (actor.kind !== 'admin') throw new AppError('forbidden', 'admin command');
  if (!actor.scopes.includes(policy.admin))
    throw new AppError('forbidden', `admin scope ${policy.admin} required`, {
      required: policy.admin,
    });
}
