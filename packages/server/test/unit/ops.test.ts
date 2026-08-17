import { describe, expect, it } from 'vitest';
import { assessOps, DEFAULT_OPS_THRESHOLDS } from '../../src/health/index.ts';
import { compareBuildVersions } from '../../src/http/versions.ts';
import { requestHash } from '../../src/cqrs/hash.ts';
import { canonicalJson } from '../../src/db/canonical.ts';
import { createMemoryLimiter } from '../../src/limits/index.ts';
import { fixedClock } from '../../src/clock/index.ts';
import { deterministicCommandId } from '../../src/outbox/index.ts';
import {
  authenticateAdmin,
  authenticateOps,
  authenticatePlayerFromParts,
} from '../../src/auth/index.ts';
import { createMockIdentityVerifier, mintMockToken } from '@foundation/jest-verify';
import { createHash } from 'node:crypto';

const base = {
  serverNow: 0,
  windowMinutes: 15,
  commands: { total: 100, errors: 0, refusals: 0, p95Ms: 50, byType: [] },
  outbox: { pending: 0, lagSeconds: 0, deadLetters: 0 },
  jobs: [],
  saves: { anchored: 0, quarantined: 0, refused: 0, pendingReviews: 0 },
  purchases: { paid: 0, sandbox: 0, unclassified: 0 },
};

describe('ops thresholds (two-tier assert)', () => {
  it('quiet system → no issues', () => expect(assessOps(base)).toEqual([]));
  it('dead letters page; outbox lag warns then pages; error rate warns then pages; p95 warns then pages', () => {
    expect(
      assessOps({ ...base, outbox: { ...base.outbox, deadLetters: 1 } }).map((i) => i.tier),
    ).toEqual(['page']);
    expect(assessOps({ ...base, outbox: { ...base.outbox, lagSeconds: 90 } })[0]).toMatchObject({
      tier: 'warn',
      code: 'outbox_lag',
    });
    expect(assessOps({ ...base, outbox: { ...base.outbox, lagSeconds: 900 } })[0]).toMatchObject({
      tier: 'page',
      code: 'outbox_lag',
    });
    expect(assessOps({ ...base, commands: { ...base.commands, errors: 6 } })[0]).toMatchObject({
      tier: 'warn',
      code: 'command_error_rate',
    });
    expect(assessOps({ ...base, commands: { ...base.commands, errors: 30 } })[0]).toMatchObject({
      tier: 'page',
      code: 'command_error_rate',
    });
    expect(assessOps({ ...base, commands: { ...base.commands, p95Ms: 400 } })[0]).toMatchObject({
      tier: 'warn',
    });
    expect(assessOps({ ...base, commands: { ...base.commands, p95Ms: 2000 } })[0]).toMatchObject({
      tier: 'page',
    });
  });
  it('overdue job pages; failed job warns; stale restore verify warns', () => {
    expect(assessOps({ ...base, jobs: [{ name: 'x', overdue: true }] })[0]).toMatchObject({
      tier: 'page',
      code: 'job_overdue',
    });
    expect(
      assessOps({ ...base, jobs: [{ name: 'x', overdue: false, lastOk: false }] })[0],
    ).toMatchObject({ tier: 'warn', code: 'job_failed' });
    expect(
      assessOps({ ...base, serverNow: 20 * 86_400_000, restoreVerifiedAt: 0 })[0],
    ).toMatchObject({ code: 'restore_verify_stale' });
    expect(DEFAULT_OPS_THRESHOLDS.deadLettersPage).toBe(1);
  });
});

describe('build versions', () => {
  it('compares numerically, ignoring +meta and -pre', () => {
    expect(compareBuildVersions('1.2.3', '1.2.10')).toBe(-1);
    expect(compareBuildVersions('2.0.0+abc', '2.0.0')).toBe(0);
    expect(compareBuildVersions('2.0.1-rc', '2.0.0')).toBe(1);
    expect(compareBuildVersions('dev', '0.0.0')).toBe(0);
  });
});

describe('request hash + canonical json', () => {
  it('is order-independent, drops undefined, and includes the command type', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: undefined }] } })).toBe(
      '{"a":{"c":[3,{"z":1}],"d":2},"b":1}',
    );
    expect(requestHash('t', { a: 1, b: 2 })).toBe(requestHash('t', { b: 2, a: 1 }));
    expect(requestHash('t', { a: 1 })).not.toBe(requestHash('u', { a: 1 }));
    expect(requestHash('t', { a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
  it('deterministic outbox command ids are uuid-shaped and stable', () => {
    const a = deterministicCommandId(42, 'c');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).toBe(deterministicCommandId(42, 'c'));
    expect(a).not.toBe(deterministicCommandId(43, 'c'));
  });
});

describe('memory rate limiter', () => {
  it('fixed windows per bucket with retryAfter', async () => {
    const clock = fixedClock(0);
    const l = createMemoryLimiter(clock, { b: { limit: 2, windowMs: 1000 } });
    expect((await l.hit('k', 'b')).allowed).toBe(true);
    expect((await l.hit('k', 'b')).allowed).toBe(true);
    const third = await l.hit('k', 'b');
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBe(1000);
    clock.advance(1000);
    expect((await l.hit('k', 'b')).allowed).toBe(true);
    expect((await l.hit('other', 'b')).allowed).toBe(true);
  });
});

describe('auth primitives', () => {
  const keys = [
    {
      keyId: 'k1',
      secretSha256: createHash('sha256').update('secret-1').digest('hex'),
      scopes: ['read' as const],
    },
  ];
  const bag = (h: Record<string, string>) => ({ get: (n: string) => h[n] });
  it('admin: timing-safe key check, unknown key and wrong secret both 401', () => {
    expect(
      authenticateAdmin(keys, bag({ 'x-admin-key-id': 'k1', 'x-admin-secret': 'secret-1' })),
    ).toMatchObject({ kind: 'admin', keyId: 'k1' });
    expect(() =>
      authenticateAdmin(keys, bag({ 'x-admin-key-id': 'k1', 'x-admin-secret': 'nope' })),
    ).toThrow(/rejected/);
    expect(() =>
      authenticateAdmin(keys, bag({ 'x-admin-key-id': 'zz', 'x-admin-secret': 'secret-1' })),
    ).toThrow(/rejected/);
    expect(() => authenticateAdmin(keys, bag({}))).toThrow(/required/);
  });
  it('ops: secret required and compared timing-safe; unconfigured → not_configured', () => {
    expect(
      authenticateOps('ops-secret-xxxxxxxx', bag({ 'x-ops-secret': 'ops-secret-xxxxxxxx' })),
    ).toEqual({ kind: 'ops' });
    expect(() => authenticateOps('ops-secret-xxxxxxxx', bag({ 'x-ops-secret': 'wrong' }))).toThrow(
      /rejected/,
    );
    expect(() => authenticateOps('', bag({ 'x-ops-secret': 'x' }))).toThrow(/not configured/);
  });
  it('player: no_secret → not_configured (503), bad token → unauthorized, good token → actor with iat', () => {
    const v = createMockIdentityVerifier();
    expect(() =>
      authenticatePlayerFromParts(createMockIdentityVerifier({ disabled: true }), 'g', 0, 'p', 'x'),
    ).toThrow(/no secret/);
    expect(() => authenticatePlayerFromParts(v, 'g', 0, 'p', 'garbage')).toThrow(/malformed/);
    const a = authenticatePlayerFromParts(v, 'g', 5000, 'p', mintMockToken('p', 4000, true));
    expect(a.actor).toEqual({ kind: 'player', playerKey: 'p', registered: true, tokenIatMs: 4000 });
  });
});
