// Warp Crew as a core engine (packages/client/src/engine/contract.ts). The state is the Warp Crew
// player; the engine is how every change reaches the core client, which owns the save slot, the
// cloud sync, generations and the multi-tab leader.
//
// Scheduling: Warp Crew keeps its own real-time scheduling. The stage loop (src/ui/stageLoop.js)
// animates, and the guided beat scheduler (src/ui/guidedBeatScheduler.js) advances fights by
// dispatching ordinary `session` actions on its own timer. Timed systems (fuel regen, drydock
// builds, injuries, expeditions) are computed from timestamps when they are read (prepare), not
// stepped. So the engine has no `step` and no `onGap`: the core loop never ticks, it only applies
// dispatched actions, and offline time is credited by the game's own timestamp maths exactly as
// before (which never touches the four progress counters).
//
// Actions:
//   { type: 'session', act, data, ui }  sessionAction (src/systems/sessionLoop.js), the game's
//                                       action reducer; the transition is returned as an effect
//   { type: 'prepare' }                 tickCrewStatus + prepareSession at ctx.now
//   { type: 'grant', rewards, ref, oneTimeSku? }  applyGrantRewards (src/core/grants.js)
//   { type: 'set', reason, player }     a player computed by the UI's remaining direct handlers
//                                       (hiring, hangar, fuel, subscriptions, daily login...);
//                                       refused when malformed or shallower than the current one
import { createNewPlayer, tickCrewStatus } from '../systems/player.js';
import { sessionAction, prepareSession } from '../systems/sessionLoop.js';
import { applyGrantRewards } from './grants.js';
import { progressOf, summaryOf, isWarpcrewPlayer } from './progress.js';

/** @param {import('@foundation/client').Ctx} ctx */
const rngOf = (ctx) => () => ctx.rng.next();

/** @type {import('@foundation/client').Engine<any, any, any>} */
export const warpcrewEngine = {
  newState(init) {
    return createNewPlayer({ captainName: 'Captain', now: init.now, rng: () => init.rng.next() });
  },
  apply(state, action, ctx) {
    switch (action?.type) {
      case 'session': {
        const result = sessionAction(state, action.ui || {}, action.act, action.data || {}, { now: ctx.now, rng: rngOf(ctx) });
        const next = result?.ok && isWarpcrewPlayer(result.player) ? result.player : state;
        return { state: next, effects: [{ kind: 'session', tick: ctx.tick, payload: result ?? null }] };
      }
      case 'prepare':
        return { state: prepareSession(tickCrewStatus(state, ctx.now), ctx.now), effects: [] };
      case 'grant': {
        const r = applyGrantRewards(state, action.rewards, { oneTimeSku: action.oneTimeSku ?? null });
        return { state: r.player, effects: [{ kind: 'granted', tick: ctx.tick, payload: { ref: action.ref, applied: r.applied, unknown: r.unknown } }] };
      }
      case 'set': {
        const next = action.player;
        const ok = isWarpcrewPlayer(next) && progressOf(next) >= progressOf(state);
        return ok
          ? { state: next, effects: [] }
          : { state, effects: [{ kind: 'refused', tick: ctx.tick, payload: { reason: action.reason || 'set' } }] };
      }
      default:
        return { state, effects: [] };
    }
  },
  progressOf,
  summary: summaryOf,
};

/** Journal names only (no free text, no player data). */
export function describeAction(action) {
  if (action?.type === 'session') return { name: `session:${String(action.act).slice(0, 40)}` };
  if (action?.type === 'set') return { name: `set:${String(action.reason || 'ui').slice(0, 40)}` };
  return { name: String(action?.type || 'action') };
}
