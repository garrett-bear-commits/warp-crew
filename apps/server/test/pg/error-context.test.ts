import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mintMockReceipt } from '@foundation/jest-verify';
import { saveBody, setupHarness, type Harness } from './harness.ts';
import { recordingSentry } from './sentry-recorder.ts';

// Failures the API used to answer without telling anyone: a save it could not read, a request
// the contract refused, a token our signer could not have issued. Each now reaches Sentry with
// the request's id, route and build, and why.
const sentry = recordingSentry();
let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'error-context', sentry });
});
afterAll(async () => {
  await h?.close();
});
beforeEach(() => {
  sentry.events.length = 0;
});

describe('API failures carry their cause and request', () => {
  it('reports an unreadable save with why it could not be read', async () => {
    const r = await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: h.playerHeaders('ctx-save', { build: '1.7.0' }),
      payload: saveBody({ blob: '{not json', buildVersion: '1.7.0' }),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().disposition).toBe('stored_refused');
    expect(sentry.events).toEqual([
      expect.objectContaining({
        kind: 'message',
        message: 'Save refused: malformed',
        level: 'warning',
        fingerprint: ['save-refused', 'malformed'],
        context: expect.objectContaining({
          command: 'saves.write',
          reason: 'malformed',
          buildVersion: '1.7.0',
          decode: expect.stringMatching(/^malformed: /),
          requestId: expect.any(String),
        }),
      }),
    ]);
  });

  it('names the receipt field that made a purchase malformed', async () => {
    const r = await h.inject({
      method: 'POST',
      url: '/v1/purchases/verify',
      headers: h.playerHeaders('ctx-buyer'),
      payload: {
        commandId: h.uuid(),
        purchaseSigned: mintMockReceipt({
          aud: 'template',
          sub: 'ctx-buyer',
          purchase: {
            purchaseToken: 'tok-bad-price',
            productSku: 'gems_100',
            createdAt: 1,
            completedAt: null,
            price: -1,
          },
        }),
      },
    });
    expect(r.json()).toMatchObject({ outcome: 'rejected', reason: 'malformed_purchase' });
    // The field stays server-side: the client sees the contract's reason only.
    expect(JSON.stringify(r.json())).not.toContain('receiptField');
    expect(sentry.events).toEqual([
      expect.objectContaining({
        message: 'purchase verify rejected: malformed_purchase',
        context: expect.objectContaining({
          reason: 'malformed_purchase',
          receiptField: 'purchase.price',
        }),
      }),
    ]);
  });

  it('reports a request the contract refuses, once per route', async () => {
    const r = await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: h.playerHeaders('ctx-validation'),
      payload: { progress: 'lots' },
    });
    expect(r.statusCode).toBe(400);
    expect(sentry.events).toEqual([
      expect.objectContaining({
        message: 'Request failed contract validation',
        fingerprint: ['validation-failed', '/v1/saves'],
        context: expect.objectContaining({
          route: '/v1/saves',
          method: 'PUT',
          status: 400,
          requestId: r.json().correlationId,
          validation: expect.anything(),
        }),
      }),
    ]);
  });

  it("counts this instance's 401s and 5xx for the ops check, never health checks", async () => {
    const before = (
      await h.inject({ method: 'GET', url: '/health/ops', headers: h.opsHeaders() })
    ).json().http as { total: number; unauthorized: number };
    await h.inject({ method: 'GET', url: '/health/ready' });
    await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: { 'x-player-key': 'ctx-count', authorization: 'Bearer not-a-token' },
    });
    const after = (
      await h.inject({ method: 'GET', url: '/health/ops', headers: h.opsHeaders() })
    ).json().http as { total: number; unauthorized: number };
    expect(after.total - before.total).toBe(1);
    expect(after.unauthorized - before.unauthorized).toBe(1);
  });

  it('reports a token our signer could not have issued, not an expired one', async () => {
    const bad = await h.inject({
      method: 'GET',
      url: '/v1/saves/current',
      headers: { 'x-player-key': 'ctx-auth', authorization: 'Bearer not-a-token' },
    });
    expect(bad.statusCode).toBe(401);
    const reason = bad.json().details?.reason as string;
    expect(sentry.events).toEqual([
      expect.objectContaining({
        message: `Player token rejected: ${reason}`,
        level: 'warning',
        fingerprint: ['auth-rejected', reason],
        context: expect.objectContaining({
          status: 401,
          reason,
          requestId: bad.json().correlationId,
        }),
      }),
    ]);
  });
});
