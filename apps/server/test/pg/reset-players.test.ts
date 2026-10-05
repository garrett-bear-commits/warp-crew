import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetAllPlayers } from '../../src/ops/reset-players.ts';
import { setupHarness, saveBody, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'resetall' });
});
afterAll(async () => h?.close());

const put = (player: string, body: unknown) =>
  h.inject({
    method: 'PUT',
    url: '/v1/saves',
    headers: h.playerHeaders(player),
    payload: body as object,
  });
const current = (player: string) =>
  h.inject({ method: 'GET', url: '/v1/saves/current?meta=1', headers: h.playerHeaders(player) });

describe('reset all players', () => {
  it('opens a restart generation per live player: clients start fresh, old-generation writes are refused, a rerun is a no-op, admin restore undoes one player', async () => {
    await put('ra', saveBody({ progress: 100 }, { v: 1, counter: 100, gold: 1 }));
    await put('ra', saveBody({ progress: 120 }, { v: 1, counter: 120, gold: 1 }));
    await put('rb', saveBody({ progress: 50 }, { v: 1, counter: 50, gold: 1 }));
    await put('rgone', saveBody({ progress: 10 }, { v: 1, counter: 10, gold: 1 }));
    await h.inject({
      method: 'POST',
      url: '/admin/v1/players/erase',
      headers: h.adminHeaders(),
      payload: { commandId: h.uuid(), playerKey: 'rgone', reason: 'gdpr' },
    });
    // Seen but never saved: no lineage yet, and its local save sits at generation 0.
    await h.root`INSERT INTO players (player_key) VALUES ('rnew')`;

    const batchId = h.uuid();
    const opts = { batchId, reason: 'prod reset', actor: 'ops:test' };
    const dry = await resetAllPlayers(h.root, { ...opts, apply: false });
    expect(dry).toMatchObject({ players: 3, reset: 0, alreadyReset: 0 });
    expect((await current('ra')).json()).toMatchObject({ generation: 0, empty: false });

    const run = await resetAllPlayers(h.root, { ...opts, apply: true });
    expect(run).toMatchObject({ players: 3, reset: 3, alreadyReset: 0 });

    // The head a booting client checks: a newer, empty restart generation, which it starts fresh in.
    expect((await current('ra')).json()).toMatchObject({
      empty: true,
      generation: 1,
      lineage: { generation: 1, kind: 'restart' },
    });
    expect((await current('rnew')).json()).toMatchObject({ empty: true, generation: 1 });
    // An in-session client still pushing its old save is refused and adopts the new generation.
    const stale = await put(
      'ra',
      saveBody({ generation: 0, progress: 130 }, { v: 1, counter: 130, gold: 1 }),
    );
    expect(stale.json()).toMatchObject({
      disposition: 'stored_refused',
      reason: 'stale_generation',
      generation: 1,
    });
    const fresh = await put(
      'rb',
      saveBody({ generation: 1, progress: 1 }, { v: 1, counter: 1, gold: 1 }),
    );
    expect(fresh.json()).toMatchObject({ disposition: 'anchored', generation: 1 });
    // Erased players stay erased.
    expect((await current('rgone')).json()).toMatchObject({ erased: true, generation: 1 });
    const gone = await h.root<{ n: number }[]>`
      SELECT count(*)::int AS n FROM generations WHERE player_key = 'rgone'`;
    expect(gone[0]!.n).toBe(2);

    const again = await resetAllPlayers(h.root, { ...opts, apply: true });
    expect(again).toMatchObject({ players: 3, reset: 0, alreadyReset: 3 });
    expect((await current('ra')).json()).toMatchObject({ generation: 1 });
    const audit = await h.root`
      SELECT target, reason FROM admin_actions WHERE command_type = 'lineage.resetAll' ORDER BY id`;
    expect(audit).toEqual([
      { target: `batch ${batchId}: 3 reset, 0 already`, reason: 'prod reset' },
      { target: `batch ${batchId}: 0 reset, 3 already`, reason: 'prod reset' },
    ]);

    // The old generation's snapshots survive: restoring seq 2 brings the player's save back.
    const restore = await h.inject({
      method: 'POST',
      url: '/admin/v1/players/restore',
      headers: h.adminHeaders(),
      payload: {
        commandId: h.uuid(),
        playerKey: 'ra',
        seq: 2,
        expectedGeneration: 1,
        reason: 'undo reset',
      },
    });
    expect(restore.json()).toMatchObject({ generation: 2, kind: 'admin_restore', seedSeq: 2 });
    expect((await current('ra')).json()).toMatchObject({
      empty: false,
      generation: 2,
      snapshot: { progress: 120 },
    });
  });
});
