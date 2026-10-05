import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'names', typesafeApiKey: 'test-typesafe-key' });
});
afterAll(async () => h?.close());
afterEach(() => vi.unstubAllGlobals());

/** Jev refuses any state that mentions a name in `refused`. */
function stubJev(refused: string[]) {
  const jev = vi.fn<typeof fetch>(async (_url, init) => {
    const { state } = JSON.parse(String(init!.body)) as { state: string };
    const choice = refused.some((name) => state.includes(name)) ? 'fail' : 'pass';
    return Response.json({
      model: 'jev-1.13.0',
      answers: { classification: { type: 'choice', choice, probabilities: { fail: 0 } } },
    });
  });
  vi.stubGlobal('fetch', jev);
  return jev;
}

const check = (player: string | null, name: string) =>
  h.inject({
    method: 'POST',
    url: '/v1/names/check',
    headers: player ? h.playerHeaders(player) : {},
    payload: { commandId: h.uuid(), name },
  });

describe('POST /v1/names/check', () => {
  it("answers with Jev's verdict for a signed-in player", async () => {
    const jev = stubJev(['Kush']);
    const refused = await check('names-a', 'Kush');
    expect(refused.statusCode).toBe(200);
    expect(refused.json()).toMatchObject({ verdict: 'fail', requestId: expect.any(String) });
    const passed = await check('names-a', 'Arden');
    expect(passed.json()).toMatchObject({ verdict: 'pass' });
    expect(jev).toHaveBeenCalledTimes(4);
    expect(String(jev.mock.calls[0]![0])).toBe('https://api.typesafe.ai/v1/systemone');
  });

  it('answers unchecked when Jev is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('down', { status: 503 })),
    );
    expect((await check('names-b', 'Brenwyn')).json()).toMatchObject({ verdict: 'unchecked' });
  });

  it('refuses players without a token and names outside the contract', async () => {
    const jev = stubJev([]);
    expect((await check(null, 'Arden')).statusCode).toBe(401);
    expect((await check('names-c', 'x'.repeat(33))).statusCode).toBe(400);
    expect(jev).not.toHaveBeenCalled();
  });

  it('rate-limits a player at 20 checks a minute', async () => {
    stubJev([]);
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await check('names-d', `Hero${i}`)).statusCode);
    expect(codes.slice(0, 20).every((code) => code === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});
