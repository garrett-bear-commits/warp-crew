import { describe, expect, it, vi } from 'vitest';
import { createNameModerator, JEV_MODEL_ID } from '../../src/features/names/jev.ts';

type Answer = { choice: string; fail?: number } | 'error';

/** Jev answers per state: the bare name first, the name in notification copy second. */
function setup(answers: (state: string) => Answer, apiKey = 'test-key') {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const { state } = JSON.parse(String(init!.body)) as { state: string };
    const answer = answers(state);
    if (answer === 'error') return new Response('upstream down', { status: 503 });
    return Response.json({
      model: JEV_MODEL_ID,
      answers: {
        classification: {
          type: 'choice',
          choice: answer.choice,
          probabilities: { pass: 1 - (answer.fail ?? 0), fail: answer.fail ?? 0 },
        },
      },
    });
  });
  const log = { warn: vi.fn() };
  return { fetch, log, moderator: createNameModerator({ apiKey, log, fetch }) };
}

const inNotification = (state: string) => state.includes('misses you');

describe('Jev name moderation', () => {
  it("asks Jev Jest's notification question about the bare name and the name in copy", async () => {
    const { fetch, moderator } = setup(() => ({ choice: 'pass' }));
    expect(await moderator.check('  Sir   Reginald ')).toBe('pass');
    expect(fetch).toHaveBeenCalledTimes(2);
    const requests = fetch.mock.calls.map(([url, init]) => ({
      url,
      auth: (init!.headers as Record<string, string>).Authorization,
      body: JSON.parse(String(init!.body)),
    }));
    for (const r of requests) {
      expect(r.url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(r.auth).toBe('Bearer test-key');
      expect(r.body.model).toBe('jev-1.13.0');
      expect(r.body.questions.classification.type).toBe('choice');
      expect(r.body.questions.classification.instructions).toMatch(/^Classify the automated SMS/);
      expect(Object.keys(r.body.questions.classification.criteria)).toEqual(['pass', 'fail']);
    }
    expect(requests.map((r) => r.body.state)).toEqual([
      'Sir Reginald',
      'Sir Reginald misses you. Your party is waiting.',
    ]);
  });

  it('refuses a name that fails either the bare or the notification check', async () => {
    const bare = setup((state) => ({ choice: inNotification(state) ? 'pass' : 'fail' }));
    expect(await bare.moderator.check('Bong')).toBe('fail');
    const copy = setup((state) => ({ choice: inNotification(state) ? 'fail' : 'pass' }));
    expect(await copy.moderator.check('Vodka Shot')).toBe('fail');
  });

  it('refuses a name Jev passes only narrowly, and keeps ordinary low scores', async () => {
    const narrow = setup(() => ({ choice: 'pass', fail: 0.41 }));
    expect(await narrow.moderator.check('Fuk Face')).toBe('fail');
    const ordinary = setup(() => ({ choice: 'pass', fail: 0.23 }));
    expect(await ordinary.moderator.check('Satan')).toBe('pass');
  });

  it('answers unchecked without a key, without calling Jev', async () => {
    const { fetch, moderator } = setup(() => ({ choice: 'fail' }), '');
    expect(await moderator.check('Kush')).toBe('unchecked');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers unchecked when Jev is down or malformed, and asks again next time', async () => {
    let down = true;
    const { fetch, log, moderator } = setup(() => (down ? 'error' : { choice: 'fail' }));
    expect(await moderator.check('Kush')).toBe('unchecked');
    expect(log.warn).toHaveBeenCalledOnce();
    down = false;
    expect(await moderator.check('Kush')).toBe('fail');
    expect(fetch).toHaveBeenCalledTimes(4);

    const malformed = setup(() => ({ choice: 'maybe' }));
    expect(await malformed.moderator.check('Arden')).toBe('unchecked');
  });

  it('reuses a verdict for the same name without asking Jev again', async () => {
    const { fetch, moderator } = setup((state) => ({
      choice: state.startsWith('Kush') ? 'fail' : 'pass',
    }));
    expect(await moderator.check('Kush')).toBe('fail');
    expect(await moderator.check(' Kush ')).toBe('fail');
    expect(await moderator.check('Arden')).toBe('pass');
    expect(await moderator.check('Arden')).toBe('pass');
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
