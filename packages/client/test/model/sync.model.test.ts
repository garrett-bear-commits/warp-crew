// Model-based tests (§9, never deferrable): fast-check commands drive the REAL sync client +
// ratchet + generations (through createGameClient) against the "server truth" model
// (test/helpers/server-model.ts: deepest-anchored-wins per generation, refusals stored, duplicate
// by commandId, stale generation, newer generation wins on the client).
//
// Invariants checked after every command:
//   I1 local progress never goes below the ratchet floor within a generation (restore excepted)
//   I2 acknowledged (synced) progress is never lost: the server anchor of that generation is at
//      least every synced progress (the client copy may legitimately sit below it after an
//      offline boot from an empty cache or a "keep local" answer — reconcile brings it back)
//   I3 a newer generation always wins on the client (after any successful round trip)
//   I4 commandId reuse never double-writes (one server row per commandId, zero 422s)
//   I5 verdict `synced` implies the server anchored that exact snapshot (commandId, progress, blob)
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { SaveWriteBody } from '@foundation/contracts';
import { makeWorld, type Client, type World } from '../helpers/world.ts';
import { counterCodec } from '../helpers/fixtures.ts';

interface Model {
  synced: { generation: number; progress: number }[];
  down: boolean;
}

interface Real {
  w: World;
  client: Client;
  /** Drop the response of the next PUT (the request still lands). */
  dropNextPut: { on: boolean };
  mismatches: number;
}

const blob = (progress: number) =>
  JSON.stringify({ schemaVersion: 2, state: { count: progress, ticks: 0, progress } });

async function bootClient(real: Real, promptChoice: 'keep_local' | 'adopt_remote'): Promise<void> {
  const { client } = real.w.newClient({
    fetch: async (input, init) => {
      const res = await real.w.ff.fetch(input, init);
      if (init?.method === 'PUT' && real.dropNextPut.on) {
        real.dropNextPut.on = false;
        throw new TypeError('response lost');
      }
      if (res.status === 422) real.mismatches++;
      return res;
    },
  });
  client.bootMachine.onChange((s) => {
    if (s.phase === 'prompt') client.bootMachine.resolvePrompt(promptChoice);
    if (s.phase === 'cloudUnreachable') client.bootMachine.startNew();
  });
  real.client = client;
  await client.boot();
}

function checkInvariants(m: Model, r: Real): void {
  const env = r.client.sync.envelope();
  const server = r.w.server;
  // I1
  if (env.ratchetFloor && env.ratchetFloor.generation === env.generation) {
    expect(env.progress, 'I1 slot below floor').toBeGreaterThanOrEqual(env.ratchetFloor.progress);
    expect(r.client.state().progress, 'I1 live below floor').toBeGreaterThanOrEqual(
      env.ratchetFloor.progress,
    );
  }
  // I2
  for (const s of m.synced) {
    const anchor = server.anchor(s.generation);
    expect(anchor, `I2 anchor missing for generation ${s.generation}`).not.toBeNull();
    expect(anchor!.progress, 'I2 server anchor below a synced progress').toBeGreaterThanOrEqual(
      s.progress,
    );
  }
  // I4
  const ids = new Map<string, number>();
  for (const row of server.rows) ids.set(row.commandId, (ids.get(row.commandId) ?? 0) + 1);
  for (const [id, n] of ids) expect(n, `I4 commandId ${id} wrote ${n} rows`).toBe(1);
  expect(r.mismatches, 'I4 idempotency mismatch (payload drift under one commandId)').toBe(0);
  // generations never move backwards on the client
  expect(env.generation).toBeLessThanOrEqual(server.generation);
}

class DispatchProgress implements fc.AsyncCommand<Model, Real> {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  check = () => true;
  async run(_m: Model, r: Real) {
    r.client.dispatch({ type: 'inc', n: this.n });
  }
  toString = () => `dispatchProgress(+${this.n})`;
}

class Autosave implements fc.AsyncCommand<Model, Real> {
  check = () => true;
  async run(_m: Model, r: Real) {
    await r.client.sync.autosave();
  }
  toString = () => 'autosave';
}

class Push implements fc.AsyncCommand<Model, Real> {
  check = () => true;
  async run(m: Model, r: Real) {
    const before = r.client.sync.envelope();
    const report = await r.client.sync.push('timer');
    await r.client.idle();
    if (report.skipped) return;
    if (report.verdict === 'synced' || report.verdict === 'synced_divergent') {
      // I5: the server anchored exactly this snapshot
      const row = r.w.server.rows.find((x) => x.commandId === report.commandId);
      expect(row, 'I5 no server row for a synced commandId').toBeDefined();
      expect(row!.disposition).toBe('anchored');
      expect(row!.generation).toBe(before.generation);
      const env = r.client.sync.envelope();
      expect(row!.progress).toBeLessThanOrEqual(env.progress);
      const decoded = counterCodec.trialDeserialize(row!.blob);
      expect(decoded.ok && decoded.state.progress).toBe(row!.progress);
      m.synced.push({ generation: row!.generation, progress: row!.progress });
    }
    if (
      report.verdict === 'refused_stale_generation' ||
      report.verdict === 'synced' ||
      report.verdict === 'synced_divergent' ||
      report.verdict === 'duplicate' ||
      report.verdict === 'refused_regression'
    ) {
      // I3: after a round trip the client is on the server's generation
      if (!m.down)
        expect(r.client.sync.envelope().generation, 'I3 newer generation not adopted').toBe(
          r.w.server.generation,
        );
    }
  }
  toString = () => 'push';
}

class PushDuplicateRetry implements fc.AsyncCommand<Model, Real> {
  check = (m: Model) => !m.down;
  async run(m: Model, r: Real) {
    r.dropNextPut.on = true;
    const first = await r.client.sync.push('timer');
    r.dropNextPut.on = false;
    await r.client.idle();
    if (first.skipped) return;
    const second = await r.client.sync.push('timer');
    await r.client.idle();
    if (second.skipped) return;
    // the request landed the first time: the retry is a duplicate under the SAME commandId
    if (first.verdict === 'unreachable') {
      expect(second.commandId).toBe(first.commandId);
      expect(second.verdict).toBe('duplicate');
      const row = r.w.server.rows.find((x) => x.commandId === first.commandId)!;
      if (row.disposition === 'anchored')
        m.synced.push({ generation: row.generation, progress: row.progress });
    }
  }
  toString = () => 'pushDuplicateRetry';
}

class NetworkDown implements fc.AsyncCommand<Model, Real> {
  check = (m: Model) => !m.down;
  async run(m: Model, r: Real) {
    m.down = true;
    r.w.server.down = true;
  }
  toString = () => 'networkDown';
}

class NetworkUp implements fc.AsyncCommand<Model, Real> {
  check = (m: Model) => m.down;
  async run(m: Model, r: Real) {
    m.down = false;
    r.w.server.down = false;
  }
  toString = () => 'networkUp';
}

class ServerRestartGeneration implements fc.AsyncCommand<Model, Real> {
  readonly seedProgress: number | null;
  constructor(seedProgress: number | null) {
    this.seedProgress = seedProgress;
  }
  check = () => true;
  async run(_m: Model, r: Real) {
    r.w.server.restart(
      this.seedProgress === null
        ? undefined
        : { progress: this.seedProgress, blob: blob(this.seedProgress) },
    );
  }
  toString = () => `serverRestartGeneration(${this.seedProgress ?? 'empty'})`;
}

class OtherDeviceWrites implements fc.AsyncCommand<Model, Real> {
  readonly progress: number;
  constructor(progress: number) {
    this.progress = progress;
  }
  check = () => true;
  async run(_m: Model, r: Real) {
    r.w.server.otherDeviceWrite(this.progress, blob(this.progress));
  }
  toString = () => `otherDeviceWrites(${this.progress})`;
}

class Reload implements fc.AsyncCommand<Model, Real> {
  readonly promptChoice: 'keep_local' | 'adopt_remote';
  constructor(promptChoice: 'keep_local' | 'adopt_remote') {
    this.promptChoice = promptChoice;
  }
  check = () => true;
  async run(m: Model, r: Real) {
    r.client.destroy();
    await bootClient(r, this.promptChoice);
    if (!m.down)
      expect(
        r.client.sync.envelope().generation,
        'I3 boot did not adopt the newer generation',
      ).toBe(r.w.server.generation);
  }
  toString = () => `reload(${this.promptChoice})`;
}

class ClearLocalStorage implements fc.AsyncCommand<Model, Real> {
  check = () => true;
  async run(m: Model, r: Real) {
    r.client.destroy();
    const ls = r.w.ls!;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k) ls.removeItem(k);
    }
    await bootClient(r, 'adopt_remote');
    if (!m.down) {
      expect(r.client.sync.envelope().generation).toBe(r.w.server.generation);
      const anchor = r.w.server.anchor();
      if (anchor)
        expect(r.client.state().progress, 'empty cache must adopt the server anchor').toBe(
          anchor.progress,
        );
    }
  }
  toString = () => 'clearLocalStorage(boot from empty)';
}

const commands = [
  fc.integer({ min: 1, max: 20 }).map((n) => new DispatchProgress(n)),
  fc.constant(new Autosave()),
  fc.constant(new Push()),
  fc.constant(new Push()),
  fc.constant(new PushDuplicateRetry()),
  fc.constant(new NetworkDown()),
  fc.constant(new NetworkUp()),
  fc
    .option(fc.integer({ min: 0, max: 60 }), { nil: null })
    .map((p) => new ServerRestartGeneration(p)),
  fc.integer({ min: 0, max: 80 }).map((p) => new OtherDeviceWrites(p)),
  fc.constantFrom('keep_local' as const, 'adopt_remote' as const).map((c) => new Reload(c)),
  fc.constant(new ClearLocalStorage()),
];

describe('model-based: sync client + ratchet + generations vs server truth (§9)', () => {
  it('holds I1–I5 over ≥ 300 random command sequences', async () => {
    let runs = 0;
    await fc.assert(
      fc.asyncProperty(fc.commands(commands, { size: 'medium', maxCommands: 18 }), async (cmds) => {
        runs++;
        const setup = async () => {
          const w = makeWorld({ playerId: 'model-1' });
          const real: Real = {
            w,
            client: null as unknown as Client,
            dropNextPut: { on: false },
            mismatches: 0,
          };
          await bootClient(real, 'keep_local');
          const model: Model = { synced: [], down: false };
          return { model, real };
        };
        const { model, real } = await setup();
        await fc.asyncModelRun(() => ({ model, real }), cmds);
        // check invariants after every command by re-running them individually is expensive; the
        // commands assert their own post-conditions and we assert the global ones here
        checkInvariants(model, real);
        real.client.destroy();
      }),
      { numRuns: 400, verbose: 1 },
    );
    expect(runs).toBeGreaterThanOrEqual(300);
  }, 120_000);

  it('invariants hold after EVERY command (shorter sequences, invariant checked mid-run)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.commands(commands, { size: 'small', maxCommands: 8 }), async (cmds) => {
        const w = makeWorld({ playerId: 'model-2' });
        const real: Real = {
          w,
          client: null as unknown as Client,
          dropNextPut: { on: false },
          mismatches: 0,
        };
        await bootClient(real, 'keep_local');
        const model: Model = { synced: [], down: false };
        // wrap each command so invariants are checked right after it
        const wrapped = Array.from(cmds).map((c): fc.AsyncCommand<Model, Real> => ({
          check: (m) => c.check(m) as boolean,
          run: async (m, r) => {
            await c.run(m, r);
            checkInvariants(m, r);
          },
          toString: () => c.toString(),
        }));
        await fc.asyncModelRun(() => ({ model, real }), wrapped);
        real.client.destroy();
      }),
      { numRuns: 120 },
    );
  }, 120_000);
});

/** Type-level check that the model touches the wire body the way the contract defines it. */
export type _Body = SaveWriteBody;
