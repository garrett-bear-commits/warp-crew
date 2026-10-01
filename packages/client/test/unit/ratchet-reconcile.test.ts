import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ratchet, ratchetForce } from '../../src/sync/ratchet.ts';
import { reconcile, type RemoteHead } from '../../src/sync/reconcile.ts';
import type { CacheEnvelope } from '../../src/storage/envelope.ts';

describe('ratchet (§1 deeper-only, §5.2 keyed playerId+generation)', () => {
  it('first candidate is accepted and becomes the floor', () => {
    const d = ratchet(null, { playerId: 'p', generation: 0, progress: 3 });
    expect(d).toEqual({
      accept: true,
      floor: { playerId: 'p', generation: 0, progress: 3 },
      reason: 'first',
    });
  });
  it('same generation: deeper or equal accepted, shallower refused (floor unchanged)', () => {
    const f = { playerId: 'p', generation: 0, progress: 5 };
    expect(ratchet(f, { playerId: 'p', generation: 0, progress: 5 }).accept).toBe(true);
    expect(ratchet(f, { playerId: 'p', generation: 0, progress: 9 }).floor.progress).toBe(9);
    const r = ratchet(f, { playerId: 'p', generation: 0, progress: 4 });
    expect(r.accept).toBe(false);
    expect(r.floor).toBe(f);
    expect(r.reason).toBe('shallower');
  });
  it('a newer generation resets the floor regardless of depth', () => {
    const f = { playerId: 'p', generation: 3, progress: 500 };
    const r = ratchet(f, { playerId: 'p', generation: 4, progress: 0 });
    expect(r.accept).toBe(true);
    expect(r.floor).toEqual({ playerId: 'p', generation: 4, progress: 0 });
  });
  it('an older generation is refused even when deeper', () => {
    const f = { playerId: 'p', generation: 3, progress: 5 };
    expect(ratchet(f, { playerId: 'p', generation: 2, progress: 999 }).accept).toBe(false);
  });
  it('another player never shares a floor', () => {
    const f = { playerId: 'p', generation: 3, progress: 5 };
    expect(ratchet(f, { playerId: 'q', generation: 0, progress: 0 }).accept).toBe(true);
  });
  it('ratchetForce (restore gate) sets the floor to the candidate', () => {
    expect(ratchetForce({ playerId: 'p', generation: 1, progress: 2 })).toEqual({
      playerId: 'p',
      generation: 1,
      progress: 2,
    });
  });
  it('property: within a generation the floor is monotone non-decreasing under any sequence', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(1000), { maxLength: 100 }), (seq) => {
        let floor: ReturnType<typeof ratchet>['floor'] | null = null;
        let last = -1;
        for (const p of seq) {
          const d = ratchet(floor, { playerId: 'p', generation: 1, progress: p });
          floor = d.floor;
          expect(floor.progress).toBeGreaterThanOrEqual(last);
          expect(d.accept).toBe(p >= last);
          last = floor.progress;
        }
      }),
    );
  });
});

const env = (o: Partial<CacheEnvelope<unknown>>): CacheEnvelope<unknown> => ({
  format: 1,
  gameId: 'g',
  playerId: 'p',
  schemaVersion: 1,
  generation: 0,
  state: {},
  progress: 0,
  savedAt: 0,
  dirty: false,
  lastAckedSeq: 0,
  sessionId: 's',
  clientSeq: 0,
  ratchetFloor: null,
  lastVerdict: null,
  lastSyncedAt: null,
  ...o,
});
const snap = (
  progress: number,
  generation = 0,
  extra: Partial<Extract<RemoteHead, { kind: 'snapshot' }>> = {},
): RemoteHead => ({
  kind: 'snapshot',
  generation,
  snapshot: { seq: 7, progress, generation, schemaVersion: 1 },
  ...extra,
});

describe('reconcile (§5.2 boot decision)', () => {
  it('no local + remote snapshot → adopt_remote', () =>
    expect(
      reconcile({ local: null, remote: snap(5), remoteUnreachable: false, returningIdentity: true })
        .action,
    ).toBe('adopt_remote'));
  it('remote deeper + local clean → adopt_remote', () =>
    expect(
      reconcile({
        local: env({ progress: 3 }),
        remote: snap(5),
        remoteUnreachable: false,
        returningIdentity: true,
      }).action,
    ).toBe('adopt_remote'));
  it('remote deeper + local dirty → prompt', () =>
    expect(
      reconcile({
        local: env({ progress: 3, dirty: true }),
        remote: snap(5),
        remoteUnreachable: false,
        returningIdentity: true,
      }).action,
    ).toBe('prompt'));
  it('remote deeper + local has an unacked pending push → prompt', () => {
    const local = env({
      progress: 3,
      pending: {
        commandId: 'c',
        encodedBlob: '{}',
        enc: 'json',
        progress: 3,
        savedAt: 0,
        reason: 'autosave',
        clientSeq: 1,
        generation: 0,
        schemaVersion: 1,
      },
    });
    expect(
      reconcile({ local, remote: snap(5), remoteUnreachable: false, returningIdentity: true })
        .action,
    ).toBe('prompt');
  });
  it('a newer equal-progress anchor for the exact pending command is kept for boot replay', () => {
    const local = env({
      progress: 3,
      dirty: true,
      clientSeq: 4,
      pending: {
        commandId: 'same-command',
        encodedBlob: '{}',
        enc: 'json',
        progress: 3,
        savedAt: 0,
        reason: 'teardown',
        clientSeq: 4,
        generation: 0,
        schemaVersion: 1,
      },
    });
    const decision = reconcile({
      local,
      remote: {
        kind: 'snapshot',
        generation: 0,
        snapshot: {
          seq: 7,
          progress: 3,
          generation: 0,
          schemaVersion: 1,
          commandId: 'same-command',
          sessionId: 's',
          clientSeq: 4,
          savedAt: 0,
        },
      },
      remoteUnreachable: false,
      returningIdentity: true,
      reconcileEqualProgress: true,
    });
    expect(decision).toMatchObject({ action: 'keep_local', reason: 'local_deeper_or_equal' });
  });
  it('a newer equal-progress anchor with a different command still prompts', () => {
    const local = env({
      progress: 3,
      dirty: true,
      clientSeq: 4,
      pending: {
        commandId: 'local-command',
        encodedBlob: '{}',
        enc: 'json',
        progress: 3,
        savedAt: 0,
        reason: 'teardown',
        clientSeq: 4,
        generation: 0,
        schemaVersion: 1,
        ancestors: [
          {
            commandId: 'common-ancestor',
            progress: 3,
            savedAt: 0,
            clientSeq: 2,
            generation: 0,
            schemaVersion: 1,
          },
        ],
      },
    });
    const decision = reconcile({
      local,
      remote: {
        kind: 'snapshot',
        generation: 0,
        snapshot: {
          seq: 7,
          progress: 3,
          generation: 0,
          schemaVersion: 1,
          commandId: 'remote-command',
          sessionId: 's',
          clientSeq: 4,
          savedAt: 0,
        },
      },
      remoteUnreachable: false,
      returningIdentity: true,
      reconcileEqualProgress: true,
    });
    expect(decision).toMatchObject({
      action: 'prompt',
      reason: 'remote_equal_newer_local_dirty',
    });
  });
  it('local deeper or equal → keep_local (even when dirty)', () => {
    expect(
      reconcile({
        local: env({ progress: 5 }),
        remote: snap(5),
        remoteUnreachable: false,
        returningIdentity: true,
      }).action,
    ).toBe('keep_local');
    expect(
      reconcile({
        local: env({ progress: 9, dirty: true }),
        remote: snap(5),
        remoteUnreachable: false,
        returningIdentity: true,
      }).action,
    ).toBe('keep_local');
  });
  it('a newer remote generation ALWAYS wins, regardless of depth or dirtiness', () => {
    const d = reconcile({
      local: env({ progress: 999, dirty: true, generation: 1 }),
      remote: snap(1, 2),
      remoteUnreachable: false,
      returningIdentity: true,
    });
    expect(d.action).toBe('adopt_remote');
    expect(d.reason).toBe('remote_newer_generation');
    expect(d.pushLocalFirst).toBe(true);
    expect(d.generation).toBe(2);
  });
  it('a newer remote generation with no snapshot yet → start_new in that generation', () => {
    const d = reconcile({
      local: env({ progress: 50, generation: 0 }),
      remote: { kind: 'empty', generation: 1 },
      remoteUnreachable: false,
      returningIdentity: true,
    });
    expect(d.action).toBe('start_new');
    expect(d.generation).toBe(1);
  });
  it('an OLDER remote generation → keep_local (server behind; the push path alarms)', () =>
    expect(
      reconcile({
        local: env({ generation: 3 }),
        remote: snap(999, 2),
        remoteUnreachable: false,
        returningIdentity: true,
      }).reason,
    ).toBe('local_newer_generation'));
  it('remote empty + local present → keep_local', () =>
    expect(
      reconcile({
        local: env({ progress: 1 }),
        remote: { kind: 'empty', generation: 0 },
        remoteUnreachable: false,
        returningIdentity: true,
      }).action,
    ).toBe('keep_local'));
  it('both empty → start_new', () =>
    expect(
      reconcile({
        local: null,
        remote: { kind: 'empty', generation: 0 },
        remoteUnreachable: false,
        returningIdentity: false,
      }).action,
    ).toBe('start_new'));
  it('erased → start_new with reason erased', () =>
    expect(
      reconcile({
        local: env({}),
        remote: { kind: 'empty', generation: 4, erased: true },
        remoteUnreachable: false,
        returningIdentity: true,
      }).reason,
    ).toBe('erased'));
  it('unreachable + local present → keep_local', () =>
    expect(
      reconcile({ local: env({}), remote: null, remoteUnreachable: true, returningIdentity: true })
        .action,
    ).toBe('keep_local'));
  it('unreachable + empty cache + returning identity → cloud_unreachable', () =>
    expect(
      reconcile({ local: null, remote: null, remoteUnreachable: true, returningIdentity: true })
        .action,
    ).toBe('cloud_unreachable'));
  it('unreachable + empty cache + new identity → start_new', () =>
    expect(
      reconcile({ local: null, remote: null, remoteUnreachable: true, returningIdentity: false })
        .action,
    ).toBe('start_new'));
  it('pendingQuarantine is surfaced with the decision', () => {
    const d = reconcile({
      local: null,
      remote: snap(5, 0, {
        pendingQuarantine: { seq: 9, progress: 8, flags: ['schema_unknown'], receivedAt: 1 },
      }),
      remoteUnreachable: false,
      returningIdentity: true,
    });
    expect(d.pendingQuarantine?.seq).toBe(9);
  });

  const arbLocal = fc.option(
    fc
      .record({
        progress: fc.nat(100),
        generation: fc.nat(3),
        dirty: fc.boolean(),
        pending: fc.boolean(),
      })
      .map((o) =>
        env({
          progress: o.progress,
          generation: o.generation,
          dirty: o.dirty,
          ...(o.pending
            ? {
                pending: {
                  commandId: 'c',
                  encodedBlob: '{}',
                  enc: 'json' as const,
                  progress: o.progress,
                  savedAt: 0,
                  reason: 'autosave' as const,
                  clientSeq: 1,
                  generation: o.generation,
                  schemaVersion: 1,
                },
              }
            : {}),
        }),
      ),
    { nil: null },
  );
  const arbRemote = fc.oneof(
    fc.constant(null),
    fc.record({ generation: fc.nat(3), erased: fc.boolean() }).map((o): RemoteHead => ({
      kind: 'empty',
      generation: o.generation,
      ...(o.erased ? { erased: true } : {}),
    })),
    fc
      .record({ generation: fc.nat(3), progress: fc.nat(100) })
      .map((o) => snap(o.progress, o.generation)),
  );

  it('property: a newer remote generation is never kept local; never adopt a same-generation shallower remote; prompt only when dirty/unacked', () => {
    fc.assert(
      fc.property(
        arbLocal,
        arbRemote,
        fc.boolean(),
        fc.boolean(),
        (local, remote, unreachable, returning) => {
          const d = reconcile({
            local,
            remote,
            remoteUnreachable: unreachable || remote === null,
            returningIdentity: returning,
          });
          if (!unreachable && remote) {
            if (local && remote.generation > local.generation) {
              expect(d.action === 'adopt_remote' || d.action === 'start_new').toBe(true);
              expect(d.generation).toBe(remote.generation);
            }
            if (
              local &&
              remote.kind === 'snapshot' &&
              remote.generation === local.generation &&
              remote.snapshot.progress <= local.progress
            )
              expect(d.action).toBe('keep_local');
            if (d.action === 'prompt')
              expect(local!.dirty || local!.pending !== undefined).toBe(true);
            if (remote.kind === 'empty' && remote.erased) expect(d.reason).toBe('erased');
          } else {
            if (local) expect(d.action).toBe('keep_local');
            else expect(d.action).toBe(returning ? 'cloud_unreachable' : 'start_new');
          }
          // the decision never moves the client to an older generation
          if (local && d.action !== 'cloud_unreachable')
            expect(d.generation).toBeGreaterThanOrEqual(local.generation);
        },
      ),
      { numRuns: 500 },
    );
  });
});
