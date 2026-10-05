// Warp Crew on @foundation/client: the composition root for saves, identity, purchases and
// subscriptions. The plain-JS UI (src/main.js) calls this; nothing here touches the DOM, so tests
// and the end-to-end check (apps/server/test/pg/warpcrew-client.test.ts) run it in node against a
// real core server.
//
// What the core owns: the device slot and its envelope, boot reconciliation (deepest save wins,
// generations, the keep-local/use-cloud prompt), the cloud sync and its retry/backoff/beacon, the
// restore gate, the multi-tab leader (only the leader writes; others offer "Play here"), the
// identity token on every call, and the server-anchored clock.
//
// Saves: ordinary changes ask for `requestSave('routine')` (the device slot at most every
// LOCAL_SAVE_MS, the cloud at most every 12 s, leading and trailing); purchases, grants, restores,
// milestones and wall breaks ask for 'immediate' (saved and pushed now).
import { ACKED_VERDICTS, createClock, createGameClient, createSlot, createStorage, readLastKnownPlayerId, slotKey } from '@foundation/client';
import { warpcrewEngine, describeAction } from './engine.js';
import { warpcrewCodec } from './codec.js';
import { createWarpcrewPlatform } from './platform.js';
import { createWarpcrewApi } from './api.js';
import { createPurchases } from './purchases.js';
import { markOwned } from './grants.js';
import { progressOf } from './progress.js';
import { readLegacySave, retireLegacySave, shouldImportLegacy, clearLocalSaves } from './legacy.js';

/**
 * The last player this device saved, read only, for the first paint before boot (the core's
 * lastKnownPlayerId slot). Null when there is none or it cannot be read.
 */
export function readPreview(localStorage, gameId) {
  try {
    const tier = createStorage({ localStorage });
    const playerId = readLastKnownPlayerId(tier, gameId);
    if (!playerId) return null;
    const read = createSlot(tier, slotKey(gameId, playerId), warpcrewCodec, { gameId, playerId }).read();
    return read.ok ? read.envelope.state : null;
  } catch {
    return null;
  }
}

/** Device slot cadence for routine saves. The legacy game wrote every action; 1 s keeps that close. */
export const LOCAL_SAVE_MS = 1_000;

const wallsBroken = (p) => Object.keys(p?.flags || {}).filter((k) => k.startsWith('wall_') && p.flags[k] === true).length;

/**
 * 'immediate' for a change a player must never lose: a milestone (a contract claimed, a story
 * chapter, a wall broken, the intro finished), a purchase or a grant; 'routine' otherwise.
 */
export function savePriorityFor(before, after) {
  if (!before || !after || before === after) return 'routine';
  const s0 = before.stats || {};
  const s1 = after.stats || {};
  if ((s1.contractsCompleted || 0) > (s0.contractsCompleted || 0)) return 'immediate';
  if ((after.story?.chapter || 0) > (before.story?.chapter || 0)) return 'immediate';
  if (wallsBroken(after) > wallsBroken(before)) return 'immediate';
  if (after.tutorial?.completed && !before.tutorial?.completed) return 'immediate';
  if ((after.oneTimePurchases || []).length > (before.oneTimePurchases || []).length) return 'immediate';
  if ((after.wallet?.gems || 0) > (before.wallet?.gems || 0) + 200) return 'immediate';
  return 'routine';
}

/**
 * @param {{
 *   config: ReturnType<typeof import('./config.js').readConfig>,
 *   platformKind?: 'jest' | 'mock',
 *   jestShell?: boolean,
 *   sdk?: object | null, sdkInit?: () => Promise<unknown>,
 *   clock?: import('@foundation/client').Clock,
 *   localStorage?: Storage | null, fetch?: typeof fetch, timers?: any, locks?: any, channel?: any,
 *   spool?: any, lifecycle?: any, sendBeacon?: any, reload?: () => void, scheduler?: any,
 *   requestPersist?: boolean, onError?: (e: unknown, detail?: object) => void,
 *   sync?: Record<string, number>,
 * }} o
 */
export function createWarpcrew(o) {
  const cfg = o.config;
  const online = Boolean(cfg.serverUrl);
  const clock = o.clock ?? createClock();
  const storage = o.localStorage === undefined ? globalThis.localStorage ?? null : o.localStorage;
  const platform = createWarpcrewPlatform({
    kind: online && o.platformKind === 'jest' ? 'jest' : 'mock',
    gameId: cfg.gameId,
    playerId: cfg.mockPlayerId,
    now: () => clock.now(),
    sdk: o.sdk ?? null,
    ...(o.sdkInit ? { sdkInit: o.sdkInit } : {}),
    ...(o.lifecycle ? { lifecycle: o.lifecycle } : {}),
  });
  const inject = (key) => (o[key] === undefined ? {} : { [key]: o[key] });
  const client = createGameClient({
    engine: warpcrewEngine,
    codec: warpcrewCodec,
    platform,
    serverUrl: cfg.serverUrl ?? '',
    gameId: cfg.gameId,
    buildVersion: cfg.buildVersion,
    journal: 'errors_only',
    clock,
    // No step: the core loop only applies dispatched actions (see engine.js on scheduling).
    loop: { tps: 1, ...(o.scheduler ? { scheduler: o.scheduler } : {}) },
    sync: { enabled: online, localSaveMs: LOCAL_SAVE_MS, ...(o.sync || {}) },
    describeAction,
    ...(o.localStorage !== undefined ? { localStorage: o.localStorage } : {}),
    ...inject('fetch'),
    ...inject('timers'),
    ...inject('locks'),
    ...inject('channel'),
    ...inject('spool'),
    ...inject('sendBeacon'),
    ...inject('reload'),
    ...inject('requestPersist'),
    ...(o.onError ? { onError: o.onError } : {}),
  });

  const api = online
    ? createWarpcrewApi({
        baseUrl: cfg.serverUrl,
        clock,
        ...inject('fetch'),
        auth: () => {
          const p = client.player;
          const token = p ? platform.identity.tokenFor(p.playerId) : null;
          return p && token ? { playerKey: p.playerId, token, buildVersion: cfg.buildVersion } : null;
        },
        refreshAuth: async () => (await platform.identity.refreshCredential()) !== null,
      })
    : null;

  const reportError = (message, detail) => client.reportError(new Error(message), detail);

  /** Ask for a save; never throws (a follower or a halted sync simply does not write). */
  function save(priority = 'routine') {
    if (!client.booted) return Promise.resolve();
    return client.sync.requestSave(priority).catch((e) => reportError('save failed', { message: String(e?.message || e).slice(0, 200) }));
  }

  /** Dispatch one engine action; false when this tab may not write (follower, prompt, blocked). */
  function dispatch(action) {
    const rev = client.rev();
    client.dispatch(action);
    return client.rev() !== rev;
  }

  /**
   * Run one session action through the engine (sessionAction). Returns the transition (null when
   * the act is not a session action) and whether the engine committed it.
   */
  function session(act, data, ui) {
    const before = client.state();
    client.effects.drain(['session']);
    if (!dispatch({ type: 'session', act, data, ui })) return { result: { ok: false, reason: 'not_leader', player: before }, committed: false };
    const fx = client.effects.drain(['session']);
    const result = fx.length ? fx[fx.length - 1].payload : null;
    const committed = Boolean(result?.ok) && client.state() === result.player;
    if (committed) void save(savePriorityFor(before, result.player));
    return { result, committed };
  }

  /** Adopt a player computed by a direct UI handler. False when refused (shape, depth, follower). */
  function commit(next, reason = 'ui', priority) {
    const before = client.state();
    if (next === before) return true;
    client.effects.drain(['refused']);
    if (!dispatch({ type: 'set', reason, player: next })) return false;
    if (client.effects.drain(['refused']).length) {
      reportError('player change refused', { reason: String(reason).slice(0, 40) });
      return false;
    }
    void save(priority ?? savePriorityFor(before, next));
    return true;
  }

  /** tickCrewStatus + prepareSession at the trusted now; saved routinely when anything changed. */
  function prepare() {
    const before = client.state();
    if (!dispatch({ type: 'prepare' })) return false;
    if (client.state() !== before) void save('routine');
    return true;
  }

  /** This tab may change the player now: booted, the leader, live (no prompt), no restore running. */
  function canApply() {
    return client.booted && client.leader.isLeader() && client.bootMachine.state().phase === 'live' && !client.gate.isRestoring();
  }

  /**
   * An immediate save that resolves true only once the current player is durable. Durable means
   * the device slot holds a snapshot taken after this call (with its pending push, whose
   * commandId the core replays verbatim at the next boot), and nothing replaced the state meanwhile
   * (no adopt, reload or new generation). When the device tier is memory only (storage blocked),
   * the slot does not survive the page, so the server must also have acknowledged the push.
   */
  async function saveDurably() {
    if (!client.booted) return false;
    const s = client.sync;
    let wrote = null;
    let swapped = false;
    let acked = false;
    const off = s.onEvent((e) => {
      if (e.type === 'autosaved') wrote = e.ok; // the last snapshot of the run is this one
      else if (e.type === 'generation_changed' || e.type === 'reloaded') swapped = true;
      else if (e.type === 'verdict' && !e.report.skipped && ACKED_VERDICTS.has(e.report.verdict)) acked = true;
    });
    try {
      await s.requestSave('immediate');
    } catch (e) {
      reportError('save failed', { message: String(e?.message || e).slice(0, 200) });
      return false;
    } finally {
      off();
    }
    if (swapped || wrote !== true) return false;
    return client.storage.mode === 'memory' ? acked : true;
  }

  /**
   * The single grant-application path: engine `grant`, then a durable save. Resolves true only
   * when the grant is in the player and saved (see saveDurably); purchases.js completes a Jest
   * purchase only then.
   */
  async function applyGrant(grant, oneTimeSku = null) {
    if (!canApply()) {
      reportError('grant not applied (this tab may not write)');
      return false;
    }
    client.effects.drain(['granted']);
    if (!dispatch({ type: 'grant', rewards: grant.rewards || [], ref: grant.grantKey, oneTimeSku })) {
      reportError('grant not applied (not the leader tab)');
      return false;
    }
    const fx = client.effects.drain(['granted']);
    const unknown = fx.flatMap((e) => e.payload?.unknown || []);
    if (unknown.length) reportError('grant reward outside the vocabulary', { kinds: unknown.join(',').slice(0, 200) });
    return saveDurably();
  }

  const purchases = createPurchases({
    api,
    payments: platform.payments,
    player: () => client.state(),
    canApply,
    applyGrant,
    // Inside the real Jest shell with no server nothing can verify a receipt: no purchases, and
    // never a local mock grant. The mock checkout is for QA outside Jest only.
    enabled: online || !o.jestShell,
    markOwned: (skus) => {
      const next = markOwned(client.state(), skus);
      if (next !== client.state()) commit(next, 'owned', 'immediate');
    },
    onError: reportError,
  });

  /**
   * Online boot work: recover incomplete purchases, claim waiting grants (any device), refresh
   * one-time ownership. Only the leader tab does it; a follower defers and runs it as soon as it
   * leads ("Play here", or the other tab closing). `whenServerSynced()` resolves after a run.
   */
  let serverWork = null;
  let serverWorkWanted = false;
  let serverSynced = Promise.resolve(null);
  async function runServerWork() {
    const recovered = await purchases.recover();
    const pending = await purchases.claimPending();
    const owned = await purchases.refreshOwned();
    if (recovered.deferred || pending.deferred) return { deferred: true, recovered, pending, owned };
    serverWorkWanted = false;
    return { deferred: false, recovered, pending, owned };
  }
  function serverSync() {
    if (!online) return Promise.resolve({ deferred: false, offline: true });
    serverWorkWanted = true;
    if (!canApply()) return Promise.resolve({ deferred: true });
    if (!serverWork) {
      serverWork = runServerWork().finally(() => { serverWork = null; });
      serverSynced = serverWork;
    }
    return serverWork;
  }
  client.leader.onChange((role) => {
    if (role === 'leader' && serverWorkWanted && client.booted) void serverSync();
  });

  /** subscription.js `verify` dependency: Jest's signed list → the core's verified entitlements. */
  async function verifySubscriptions(signed) {
    if (!api) return { ok: false, reason: 'no_server' };
    if (typeof signed !== 'string' || !signed) return { ok: false, reason: 'unsigned' };
    const r = await api.subscriptions.verify(signed);
    if (!r.ok) return { ok: false, reason: r.status === 0 ? 'network' : `http_${r.status}` };
    if (r.body.outcome !== 'verified') return { ok: false, reason: r.body.reason || 'rejected' };
    return { ok: true, data: { subscriptions: r.body.subscriptions, issuedAt: r.body.issuedAt ?? null } };
  }

  /**
   * Boot: identity, the device slot and the server head, reconciled by the core. `fresh` (QA
   * `?fresh=1`) clears this device first and, online, opens a new generation so the server copy is
   * not adopted straight back. The legacy `warpcrew.save.v2` save is imported once.
   * @param {{ fresh?: boolean, onBootState?: (s: any) => void }} [opts]
   */
  async function boot(opts = {}) {
    if (opts.fresh && storage) clearLocalSaves(storage, cfg.gameId);
    const off = client.bootMachine.onChange((st) => {
      // No server: there is no cloud to wait for; play on this device.
      if (st.phase === 'cloudUnreachable' && !online) client.bootMachine.startNew();
      opts.onBootState?.(st);
    });
    let result;
    try {
      result = await client.boot();
    } finally {
      off();
    }
    let restarted = false;
    if (opts.fresh && online) {
      const r = await client.restartJourney();
      restarted = r.ok;
      if (!r.ok) reportError('fresh start: restart refused', { reason: r.reason });
    }
    let importedLegacy = false;
    const legacy = storage ? readLegacySave(storage) : null;
    // The core had no save for this player when the boot found nothing anywhere (both empty, or no
    // cloud and no device slot); otherwise only a strictly deeper legacy player is imported.
    const noCoreSave = result.decision?.action === 'start_new' && ['both_empty', 'unreachable_new_identity'].includes(result.decision.reason);
    if (legacy && !opts.fresh && shouldImportLegacy(client.state(), legacy, { noCoreSave })) {
      importedLegacy = dispatch({ type: 'set', reason: 'legacy_import', player: legacy }) && client.state() === legacy;
      if (importedLegacy) await save('immediate');
    }
    if (storage && (legacy || opts.fresh)) retireLegacySave(storage);
    return { decision: result.decision, importedLegacy, restarted };
  }

  /** Start over. Online: a new server generation. Offline: clear this device. Then reload. */
  async function restart() {
    if (online) {
      const r = await client.restartJourney();
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
    // Stop every writer first so nothing re-saves the old player before the reload.
    client.destroy();
    if (storage) clearLocalSaves(storage, cfg.gameId);
    return { ok: true, reload: true };
  }

  return {
    client,
    platform,
    api,
    clock,
    online,
    purchases,
    boot,
    restart,
    session,
    commit,
    prepare,
    applyGrant,
    canApply,
    serverSync,
    whenServerSynced: () => serverSynced,
    save,
    verifySubscriptions,
    state: () => client.state(),
    progress: () => progressOf(client.state()),
    slotKey: (playerId) => slotKey(cfg.gameId, playerId),
  };
}
