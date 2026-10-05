import type { ActorPolicy, ExecCtx } from './define.ts';
import { AppError } from '../errors.ts';
import { authorizeActor } from './authorize.ts';

export interface QueryDef<P, R> {
  name: string;
  actorPolicy: ActorPolicy | 'public';
  readonly __p?: P;
  readonly __r?: R;
}

export function defineQuery<P, R>(def: {
  name: string;
  actorPolicy: ActorPolicy | 'public';
}): QueryDef<P, R> {
  return Object.freeze(def) as QueryDef<P, R>;
}

export type QueryHandler<P, R> = (params: P, ctx: ExecCtx | null) => Promise<R>;

/** Typed, explicit query bus: reads projections only (§4.1). */
export class QueryBus {
  #handlers = new Map<QueryDef<unknown, unknown>, QueryHandler<unknown, unknown>>();

  register<P, R>(def: QueryDef<P, R>, handler: QueryHandler<P, R>): void {
    if (this.#handlers.has(def as QueryDef<unknown, unknown>))
      throw new Error(`query ${def.name} registered twice`);
    this.#handlers.set(
      def as QueryDef<unknown, unknown>,
      handler as QueryHandler<unknown, unknown>,
    );
  }

  async execute<P, R>(def: QueryDef<P, R>, params: P, ctx: ExecCtx | null): Promise<R> {
    const h = this.#handlers.get(def as QueryDef<unknown, unknown>);
    if (!h) throw new Error(`no handler for query ${def.name}`);
    if (def.actorPolicy !== 'public') {
      if (!ctx) throw new AppError('unauthorized', `query ${def.name} requires an actor`);
      authorizeActor(def.actorPolicy, ctx.actor);
    }
    return (await h(params, ctx)) as R;
  }

  assertComplete(declared: QueryDef<unknown, unknown>[]): void {
    const missing = declared.filter((d) => !this.#handlers.has(d)).map((d) => d.name);
    if (missing.length) throw new Error(`queries without handlers: ${missing.join(', ')}`);
  }
}
