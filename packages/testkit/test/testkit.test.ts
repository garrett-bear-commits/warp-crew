import { describe, expect, it } from 'vitest';
import { FakeClock, fakeFetch, json, mintPlayerToken, mintReceipt, randomSecretB64, signHs256 } from '../src/index.ts';

describe('testkit primitives', () => {
  it('FakeClock is deterministic and only moves when told', () => {
    const c = new FakeClock(1000);
    expect(c.now()).toBe(1000);
    c.advance(5);
    c.advanceSeconds(1);
    c.advanceDays(1);
    expect(c.now()).toBe(1000 + 5 + 1000 + 86_400_000);
    c.set(7);
    expect(c.now()).toBe(7);
  });
  it('fakeFetch routes by method+prefix, records calls, and simulates offline', async () => {
    const f = fakeFetch(() => 42);
    f.on('PUT', '/v1/saves', () => json(200, { disposition: 'anchored' }));
    const r = await f.fetch('http://x/v1/saves', { method: 'PUT', headers: { 'x-player-key': 'p' }, body: JSON.stringify({ a: 1 }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ disposition: 'anchored' });
    expect(f.calls[0]).toMatchObject({ method: 'PUT', url: 'http://x/v1/saves', headers: { 'x-player-key': 'p' }, body: { a: 1 }, at: 42 });
    expect((await f.fetch('http://x/nope')).status).toBe(404);
    f.offline = true;
    await expect(f.fetch('http://x/v1/saves', { method: 'PUT' })).rejects.toThrow(/offline/);
    f.reset();
    expect(f.calls).toEqual([]);
  });
  it('mints HS256 tokens and receipts with the Jest shape (three base64url parts)', () => {
    const secret = randomSecretB64();
    const t = mintPlayerToken({ playerId: 'p1', gameId: 'g', secretB64: secret, nowMs: 5_000_000, registered: true });
    const parts = t.split('.');
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    expect(payload).toMatchObject({ player: { playerId: 'p1', registered: true }, aud: 'g', sub: 'p1', iat: 5000 });
    const r = mintReceipt({ playerId: 'p1', gameId: 'g', secretB64: secret, purchaseToken: 'tok', productSku: 'sku', createdAt: 1, price: 0 });
    const rp = JSON.parse(Buffer.from(r.split('.')[1]!, 'base64url').toString('utf8'));
    expect(rp).toMatchObject({ aud: 'g', sub: 'p1', purchase: { purchaseToken: 'tok', productSku: 'sku', price: 0 } });
    expect(signHs256({ a: 1 }, secret)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
