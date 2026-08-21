import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { TSchema } from '@sinclair/typebox';
import { ROUTES, isMutation, ROUTE_BY_ID } from '../src/routes.ts';
import { ROUTE_FIXTURES, CONTENT_FIXTURES, saveWriteBody } from '../src/fixtures/index.ts';
import { AchievementsDocument, DailyRewardsDocument, MutationBody } from '../src/index.ts';
import { check, errors } from '../src/validate.ts';
import { buildOpenApi } from '../src/openapi.ts';

const here = dirname(fileURLToPath(import.meta.url));

function hasCommandId(schema: TSchema): boolean {
  const s = schema as unknown as Record<string, unknown>;
  const props = s.properties as Record<string, unknown> | undefined;
  const required = (s.required as string[] | undefined) ?? [];
  if (props && 'commandId' in props && required.includes('commandId')) return true;
  const all = s.allOf as TSchema[] | undefined;
  if (all) return all.some(hasCommandId);
  return false;
}

describe('route registry invariants', () => {
  it('every mutation body carries a required commandId (§6)', () => {
    const mutations = ROUTES.filter(isMutation);
    expect(mutations.length).toBeGreaterThan(20);
    for (const r of mutations) {
      expect(r.body, `${r.id} must declare a body`).toBeDefined();
      expect(hasCommandId(r.body as TSchema), `${r.id} body must require commandId`).toBe(true);
    }
  });

  it('GET routes never carry a body', () => {
    for (const r of ROUTES.filter((x) => x.method === 'GET')) expect(r.body).toBeUndefined();
  });

  it('route ids and method+path are unique', () => {
    const ids = new Set<string>();
    const mp = new Set<string>();
    for (const r of ROUTES) {
      expect(ids.has(r.id), `dup id ${r.id}`).toBe(false);
      ids.add(r.id);
      const k = `${r.method} ${r.path}`;
      expect(mp.has(k), `dup route ${k}`).toBe(false);
      mp.add(k);
    }
  });

  it('every response schema carries serverNow (§1 server clock) except health liveness/ready/ops', () => {
    for (const r of ROUTES) {
      const props =
        (r.response as unknown as { properties?: Record<string, unknown> }).properties ?? {};
      expect('serverNow' in props, `${r.id} response must carry serverNow`).toBe(true);
    }
  });

  it('admin routes declare a scope; step-up only on value commands', () => {
    for (const r of ROUTES) {
      if (r.auth === 'admin') expect(r.adminScope, `${r.id}`).toBeDefined();
      if (r.stepUp) expect(['lineage', 'grants', 'purchases'].includes(r.feature)).toBe(true);
    }
  });

  it('MutationBody base requires commandId as a uuid', () => {
    expect(check(MutationBody, { commandId: 'not-a-uuid' })).toBe(false);
    expect(check(MutationBody, { commandId: saveWriteBody.commandId })).toBe(true);
  });

  it('declares a step-up batch purchase verification route', () => {
    const route = ROUTE_BY_ID.get('purchases.verifyBatch');
    expect(route).toMatchObject({
      method: 'POST',
      path: '/v1/purchases/verify-batch',
      auth: 'player',
      feature: 'purchases',
      stepUp: true,
    });
  });

  it('requires the server completion decision on direct purchase verification', () => {
    const schema = ROUTE_BY_ID.get('purchases.verify')!.response as unknown as {
      required?: string[];
    };
    expect(schema.required).toContain('completion');
  });

  it('requires nullable signed sandbox provenance on purchase records', () => {
    const purchase = (
      ROUTE_BY_ID.get('purchases.verify')!.response as unknown as {
        properties: { purchase: { required?: string[] } };
      }
    ).properties.purchase;
    expect(purchase.required).toContain('sandbox');
  });

  it('requires server-authored checkout readiness on the purchases read model', () => {
    const schema = ROUTE_BY_ID.get('purchases.mine')!.response as unknown as {
      required?: string[];
    };
    expect(schema.required).toContain('checkoutEnabled');
  });

  it('keeps new grant keys bounded while legacy purchase keys remain response/claim compatible', () => {
    const legacyPurchaseKey = `purchase:${'t'.repeat(256)}`;
    const oversizedAdminKey = `admin:${'t'.repeat(256)}`;
    const purchase = {
      id: 1,
      sku: 'gems_100',
      classification: 'paid',
      granted: 100,
      grantKey: legacyPurchaseKey,
      sandbox: null,
      createdAt: 1,
      completedAt: 2,
      recordedAt: 3,
    };

    expect(
      check(ROUTE_BY_ID.get('purchases.verify')!.response, {
        purchaseToken: 'legacy-token',
        outcome: 'duplicate',
        purchase,
        completion: 'ready',
        serverNow: 4,
        requestId: 'request-1',
      }),
    ).toBe(true);
    expect(
      check(ROUTE_BY_ID.get('grants.claim')!.body!, {
        commandId: saveWriteBody.commandId,
        grantKey: legacyPurchaseKey,
      }),
    ).toBe(true);
    expect(
      check(ROUTE_BY_ID.get('grants.claim')!.body!, {
        commandId: saveWriteBody.commandId,
        grantKey: oversizedAdminKey,
      }),
    ).toBe(false);
    expect(
      check(ROUTE_BY_ID.get('admin.grant')!.body!, {
        commandId: saveWriteBody.commandId,
        playerKey: 'player-1',
        grantKey: oversizedAdminKey,
        rewards: [],
        reason: 'must stay bounded',
      }),
    ).toBe(false);
  });
});

describe('fixtures validate against schemas (both sides share them)', () => {
  for (const [routeId, examples] of Object.entries(ROUTE_FIXTURES)) {
    const route = ROUTE_BY_ID.get(routeId);
    it(`${routeId}`, () => {
      expect(route, `unknown route ${routeId}`).toBeDefined();
      for (const ex of examples) {
        if (route!.body) {
          expect(ex.body, `${routeId} fixture needs a body`).toBeDefined();
          expect(errors(route!.body, ex.body), `${routeId} body`).toEqual([]);
        }
        expect(errors(route!.response, ex.response), `${routeId} response`).toEqual([]);
      }
    });
  }
  it('content documents', () => {
    expect(errors(AchievementsDocument, CONTENT_FIXTURES.achievementsDocument)).toEqual([]);
    expect(errors(DailyRewardsDocument, CONTENT_FIXTURES.dailyRewardsDocument)).toEqual([]);
  });
  it('closed bodies reject unknown fields (additionalProperties: false)', () => {
    const r = ROUTE_BY_ID.get('saves.write')!;
    expect(check(r.body!, { ...saveWriteBody, actor: 'admin' })).toBe(false);
    expect(check(r.body!, { ...saveWriteBody, gameId: 'x' })).toBe(false);
    expect(check(r.body!, { ...saveWriteBody, playerKey: 'x' })).toBe(false);
  });
  it('progress must be a safe integer', () => {
    const r = ROUTE_BY_ID.get('saves.write')!;
    expect(check(r.body!, { ...saveWriteBody, progress: 2 ** 53 })).toBe(false);
    expect(check(r.body!, { ...saveWriteBody, progress: -1 })).toBe(false);
    expect(check(r.body!, { ...saveWriteBody, progress: 1.5 })).toBe(false);
    expect(check(r.body!, { ...saveWriteBody, progress: Number.MAX_SAFE_INTEGER })).toBe(true);
  });
});

describe('openapi.json is generated from the registry and committed', () => {
  it('matches the committed file (run `pnpm openapi` after contract changes)', () => {
    const committed = JSON.parse(readFileSync(resolve(here, '..', 'openapi.json'), 'utf8'));
    expect(committed).toEqual(buildOpenApi());
  });
  it('covers every route', () => {
    const doc = buildOpenApi() as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    const ops = new Set(
      Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId)),
    );
    for (const r of ROUTES) expect(ops.has(r.id)).toBe(true);
  });
});

describe('enums module is browser-safe', () => {
  it('imports no TypeBox runtime and no node builtins', () => {
    const src = readFileSync(resolve(here, '..', 'src', 'enums.ts'), 'utf8');
    expect(src).not.toMatch(/@sinclair\/typebox/);
    expect(src).not.toMatch(/from 'node:/);
    expect(src).not.toMatch(/^import\b/m);
  });
});
