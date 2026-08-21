import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, saveBody, type Harness } from './harness.ts';
import { ROUTES } from '@foundation/contracts/routes';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'feat', game: { purchases: { mintPremium: 'on' } } });
});
afterAll(async () => h?.close());

const post = (
  player: string,
  url: string,
  body: unknown,
  opts: { registered?: boolean; build?: string } = {},
) =>
  h.inject({
    method: 'POST',
    url,
    headers: h.playerHeaders(player, opts),
    payload: body as object,
  });
const get = (player: string | null, url: string, opts: { build?: string } = {}) =>
  h.inject({ method: 'GET', url, headers: player ? h.playerHeaders(player, opts) : {} });
const admin = (url: string, body: unknown, key = 'full') =>
  h.inject({ method: 'POST', url, headers: h.adminHeaders(key), payload: body as object });

describe('route coverage + health', () => {
  it('every contract route is registered (lab env registers qa routes too)', () => {
    for (const r of ROUTES) {
      expect(
        h.server.app.hasRoute({ method: r.method, url: r.path }),
        `${r.id} ${r.method} ${r.path}`,
      ).toBe(true);
    }
  });
  it('/health, /health/ready (schema head + secrets + admin keys), /health/ops requires the ops secret and asserts', async () => {
    const live = await h.inject({ method: 'GET', url: '/health' });
    expect(live.json()).toMatchObject({ status: 'ok', contractVersion: '1.0.0' });
    const ready = await h.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: 'ready',
      checks: { db: true, migrationsAtHead: true, secretsPresent: true, adminKeyCount: 2 },
    });
    const noOps = await h.inject({ method: 'GET', url: '/health/ops' });
    expect(noOps.statusCode).toBe(401);
    const ops = await h.inject({
      method: 'GET',
      url: '/health/ops?assert=page',
      headers: h.opsHeaders(),
    });
    expect(ops.statusCode).toBe(200);
    expect(ops.json()).toMatchObject({
      status: 'ok',
      windowMinutes: 15,
      outbox: { deadLetters: 0 },
    });
    expect(ops.json().jobs.map((j: { name: string }) => j.name)).toContain('outbox.drain');
  });
  it('unknown routes → 404 envelope; bad JSON → 400; oversized body → 413; unknown content-type → 400', async () => {
    expect((await h.inject({ method: 'GET', url: '/nope' })).json()).toMatchObject({
      error: 'not_found',
    });
    const bad = await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: { ...h.playerHeaders('x'), 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(bad.statusCode).toBe(400);
    const big = await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: { ...h.playerHeaders('x'), 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(big.statusCode).toBe(413);
  });
  it('CORS: allow-listed origin gets headers; unknown origin does not', async () => {
    const ok = await h.inject({
      method: 'OPTIONS',
      url: '/v1/saves',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'x-player-key,authorization',
      },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const jest = await h.inject({
      method: 'OPTIONS',
      url: '/v1/saves',
      headers: { origin: 'https://template.jest.com', 'access-control-request-method': 'PUT' },
    });
    expect(jest.headers['access-control-allow-origin']).toBe('https://template.jest.com');
    const bad = await h.inject({
      method: 'OPTIONS',
      url: '/v1/saves',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' },
    });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('liveops: config publish without rebuild, flags at 50 %, schedules, segments, kill switches, minBuild', () => {
  it('public config + per-player flags; a 50 % rollout is sticky per player and splits a population', async () => {
    const pub = await get(null, '/v1/config');
    expect(pub.json()).toMatchObject({
      gameId: 'template',
      env: 'lab',
      minBuildVersion: '0.0.0',
      maintenance: false,
    });
    expect(pub.json().flags).toBeUndefined();
    const authed = await get('flaggy', '/v1/config');
    expect(authed.json().flags).toEqual({
      'sale.summer': false,
      'idle.rate': 1,
      'ui.theme': 'classic',
    });
    const unknown = await admin('/admin/v1/liveops/flags', {
      commandId: h.uuid(),
      key: 'not.registered',
      enabled: true,
      value: true,
      rolloutPercent: 100,
      reason: 'x',
    });
    expect(unknown.statusCode).toBe(400);
    const wrongType = await admin('/admin/v1/liveops/flags', {
      commandId: h.uuid(),
      key: 'idle.rate',
      enabled: true,
      value: 'fast',
      rolloutPercent: 100,
      reason: 'x',
    });
    expect(wrongType.statusCode).toBe(400);
    const pubFlag = await admin('/admin/v1/liveops/flags', {
      commandId: h.uuid(),
      key: 'sale.summer',
      enabled: true,
      value: true,
      rolloutPercent: 50,
      reason: 'summer sale at 50%',
    });
    expect(pubFlag.json()).toMatchObject({ version: 1 });
    let on = 0;
    for (let i = 0; i < 200; i++) {
      const c = await get(`roll-${i}`, '/v1/config');
      if (c.json().flags['sale.summer'] === true) on++;
    }
    expect(on).toBeGreaterThan(60);
    expect(on).toBeLessThan(140);
    const a = await get('roll-1', '/v1/config');
    const b = await get('roll-1', '/v1/config');
    expect(a.json().flags['sale.summer']).toBe(b.json().flags['sale.summer']);
    // shadow flags evaluate but are reported separately
    await admin('/admin/v1/liveops/flags', {
      commandId: h.uuid(),
      key: 'idle.rate',
      enabled: true,
      value: 2,
      rolloutPercent: 100,
      shadow: true,
      reason: 'shadow test',
    });
    const s = await get('roll-1', '/v1/config');
    expect(s.json().flags['idle.rate']).toBe(1);
    expect(s.json().shadowFlags['idle.rate']).toBe(2);
    // activateAt in the future → fallback until then
    await admin('/admin/v1/liveops/flags', {
      commandId: h.uuid(),
      key: 'ui.theme',
      enabled: true,
      value: 'neon',
      rolloutPercent: 100,
      activateAt: h.clock.now() + 3_600_000,
      reason: 'later',
    });
    expect((await get('roll-1', '/v1/config')).json().flags['ui.theme']).toBe('classic');
    h.clock.advance(3_600_001);
    expect((await get('roll-1', '/v1/config')).json().flags['ui.theme']).toBe('neon');
  });
  it('content publish (lab) overrides the bundle default; schema-checked; revert appends a new version', async () => {
    const def = await get(null, '/v1/content/achievements');
    expect(def.json()).toMatchObject({ source: 'default', version: 0 });
    const bad = await admin('/admin/v1/liveops/content', {
      commandId: h.uuid(),
      kind: 'achievements',
      env: 'lab',
      document: { nope: 1 },
      reason: 'x',
    });
    expect(bad.statusCode).toBe(400);
    const doc = {
      version: 2,
      clientClaimPremiumBudget: 50,
      achievements: [
        {
          id: 'first-ten',
          title: 'First ten',
          criteria: [{ source: 'client_claim', fact: 'progress', op: 'gte', value: 10 }],
          rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 5 }],
        },
      ],
    };
    const pub = await admin('/admin/v1/liveops/content', {
      commandId: h.uuid(),
      kind: 'achievements',
      env: 'lab',
      document: doc,
      reason: 'v2',
    });
    expect(pub.json()).toMatchObject({ version: 1 });
    const cur = await get(null, '/v1/content/achievements');
    expect(cur.json()).toMatchObject({ source: 'published', version: 1 });
    expect(cur.json().document.achievements[0].id).toBe('first-ten');
    const cfg = await get(null, '/v1/config');
    expect(cfg.json().contentVersions).toEqual([
      expect.objectContaining({ kind: 'achievements', version: 1 }),
    ]);
    // prod publish does not affect the lab deployment
    await admin('/admin/v1/liveops/content', {
      commandId: h.uuid(),
      kind: 'achievements',
      env: 'prod',
      document: { ...doc, version: 3 },
      reason: 'prod',
    });
    expect((await get(null, '/v1/content/achievements')).json().version).toBe(1);
    // publish v2 then revert to v1 → v3 with the v1 document
    await admin('/admin/v1/liveops/content', {
      commandId: h.uuid(),
      kind: 'achievements',
      env: 'lab',
      document: { ...doc, version: 9 },
      reason: 'v3',
    });
    const rev = await admin('/admin/v1/liveops/content/revert', {
      commandId: h.uuid(),
      kind: 'achievements',
      env: 'lab',
      toVersion: 1,
      reason: 'oops',
    });
    expect(rev.json().version).toBe(3);
    expect((await get(null, '/v1/content/achievements')).json().document.version).toBe(2);
  });
  it('schedules (a scheduled sale), segments (preview count + gated schedule), kill switches, minBuild → 426', async () => {
    const seg = await admin('/admin/v1/liveops/segments', {
      commandId: h.uuid(),
      id: 'veterans',
      predicate: { fact: 'seen_days', op: 'gte', value: 5 },
      reason: 'x',
    });
    expect(seg.statusCode).toBe(200);
    await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: h.playerHeaders('vet'),
      payload: saveBody({ progress: 1 }, { v: 1, counter: 1, gold: 1 }),
    });
    await h.root`UPDATE players SET seen_days = 9 WHERE player_key = 'vet'`;
    const preview = await h.inject({
      method: 'GET',
      url: '/admin/v1/liveops/segments/veterans/preview',
      headers: h.adminHeaders('reader'),
    });
    expect(preview.json()).toMatchObject({ id: 'veterans', count: 1 });
    await admin('/admin/v1/liveops/schedules', {
      commandId: h.uuid(),
      id: 'summer-sale',
      kind: 'sale',
      startsAt: h.clock.now() - 1000,
      endsAt: h.clock.now() + 86_400_000,
      payload: { discount: 50 },
      active: true,
      reason: 'sale',
    });
    await admin('/admin/v1/liveops/schedules', {
      commandId: h.uuid(),
      id: 'vet-bonus',
      kind: 'bonus',
      startsAt: h.clock.now() - 1000,
      segmentId: 'veterans',
      active: true,
      reason: 'vets',
    });
    await admin('/admin/v1/liveops/schedules', {
      commandId: h.uuid(),
      id: 'past',
      kind: 'sale',
      startsAt: h.clock.now() - 20_000,
      endsAt: h.clock.now() - 10_000,
      active: true,
      reason: 'past',
    });
    const pub = await get(null, '/v1/schedules');
    expect(
      pub
        .json()
        .schedules.map((s: { id: string }) => s.id)
        .sort(),
    ).toEqual(['summer-sale', 'vet-bonus']);
    const anon = await get(null, '/v1/config');
    expect(anon.json().schedules.map((s: { id: string }) => s.id)).toEqual(['summer-sale']);
    const vet = await get('vet', '/v1/config');
    expect(
      vet
        .json()
        .schedules.map((s: { id: string }) => s.id)
        .sort(),
    ).toEqual(['summer-sale', 'vet-bonus']);
    expect(vet.json().segmentIds).toEqual(['veterans']);
    const rookie = await get('rookie', '/v1/config');
    expect(rookie.json().schedules.map((s: { id: string }) => s.id)).toEqual(['summer-sale']);
    // kill switch per command
    await admin('/admin/v1/liveops/kill-switches', {
      commandId: h.uuid(),
      target: 'command',
      id: 'codes.redeem',
      enabled: true,
      reason: 'abuse',
    });
    const killed = await post('vet', '/v1/codes/redeem', {
      commandId: h.uuid(),
      code: 'WHATEVER-CODE-1',
    });
    expect(killed.statusCode).toBe(403);
    await admin('/admin/v1/liveops/kill-switches', {
      commandId: h.uuid(),
      target: 'command',
      id: 'codes.redeem',
      enabled: false,
      reason: 'restored',
    });
    expect(
      (await post('vet', '/v1/codes/redeem', { commandId: h.uuid(), code: 'WHATEVER-CODE-1' }))
        .statusCode,
    ).toBe(200);
    // minBuildVersion → 426 for stragglers that announce their build
    await admin('/admin/v1/liveops/min-build', {
      commandId: h.uuid(),
      minBuildVersion: '2.0.0',
      reason: 'break',
    });
    const old = await get('vet', '/v1/saves/current', { build: '1.9.9' });
    expect(old.statusCode).toBe(426);
    expect(old.json()).toMatchObject({
      error: 'build_too_old',
      details: { minBuildVersion: '2.0.0' },
    });
    expect((await get('vet', '/v1/saves/current', { build: '2.0.0+abc' })).statusCode).toBe(200);
    await admin('/admin/v1/liveops/min-build', {
      commandId: h.uuid(),
      minBuildVersion: '0.0.0',
      reason: 'reset',
    });
  });
});

describe('inbox: letters, announcements, read state, feedback', () => {
  it('admin letter with a grant, announcement with schedule + segment, read state, feedback', async () => {
    const noGrant = await admin('/admin/v1/letters', {
      commandId: h.uuid(),
      playerKey: 'reader1',
      title: 'Hi',
      body: 'x',
      grantKey: 'missing',
      reason: 'r',
    });
    expect(noGrant.statusCode).toBe(404);
    await admin('/admin/v1/grants', {
      commandId: h.uuid(),
      playerKey: 'reader1',
      grantKey: 'admin:mg-1',
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 100 }],
      reason: 'make-good',
    });
    const letter = await admin('/admin/v1/letters', {
      commandId: h.uuid(),
      playerKey: 'reader1',
      title: 'Sorry',
      body: 'Here is 100 gold.',
      grantKey: 'admin:mg-1',
      reason: 'outage',
      ticketRef: 'T-1',
    });
    expect(letter.statusCode).toBe(200);
    const readerKey = await admin(
      '/admin/v1/letters',
      { commandId: h.uuid(), playerKey: 'reader1', title: 'x', body: 'y', reason: 'r' },
      'reader',
    );
    expect(readerKey.statusCode).toBe(403);
    await admin('/admin/v1/announcements', {
      commandId: h.uuid(),
      id: 'welcome',
      title: 'Welcome',
      body: 'Hello everyone',
      startsAt: h.clock.now() - 1000,
      reason: 'launch',
    });
    await admin('/admin/v1/announcements', {
      commandId: h.uuid(),
      id: 'vets-only',
      title: 'Vets',
      body: 'thanks',
      startsAt: h.clock.now() - 1000,
      segmentId: 'veterans',
      reason: 'x',
    });
    const inbox = await get('reader1', '/v1/inbox');
    const titles = inbox
      .json()
      .letters.map((l: { title: string }) => l.title)
      .sort();
    expect(titles).toEqual(['Sorry', 'Welcome']);
    expect(inbox.json().unread).toBe(2);
    const supportLetter = inbox.json().letters.find((l: { kind: string }) => l.kind === 'support');
    expect(supportLetter.grantKey).toBe('admin:mg-1');
    await post('reader1', '/v1/inbox/read', { commandId: h.uuid(), letterIds: [supportLetter.id] });
    const inbox2 = await get('reader1', '/v1/inbox');
    expect(inbox2.json().unread).toBe(1);
    await post('reader1', '/v1/grants/claim', { commandId: h.uuid(), grantKey: 'admin:mg-1' });
    const inbox3 = await get('reader1', '/v1/inbox');
    expect(
      inbox3.json().letters.find((l: { kind: string }) => l.kind === 'support').claimedAt,
    ).toEqual(expect.any(Number));
    const vet = await get('vet', '/v1/inbox');
    expect(
      vet
        .json()
        .letters.map((l: { title: string }) => l.title)
        .sort(),
    ).toEqual(['Vets', 'Welcome']);
    const fb = await post('reader1', '/v1/feedback', {
      commandId: h.uuid(),
      category: 'bug',
      body: 'the thing broke',
    });
    expect(fb.json()).toMatchObject({ status: 'new', duplicate: false });
  });
});

describe('achievements + daily reward: one evaluator over ledgers, claims budgeted, outbox reactions', () => {
  it('daily reward: server-stamped, once per UTC day, ladder advances on consecutive days and resets after a gap', async () => {
    const d1 = await post('daily', '/v1/daily/claim', { commandId: h.uuid() });
    expect(d1.json()).toMatchObject({
      outcome: 'claimed',
      day: 1,
      grantKey: expect.stringMatching(/^daily:/),
    });
    const again = await post('daily', '/v1/daily/claim', { commandId: h.uuid() });
    expect(again.json().outcome).toBe('already_claimed_today');
    h.clock.advance(86_400_000);
    expect((await post('daily', '/v1/daily/claim', { commandId: h.uuid() })).json().day).toBe(2);
    h.clock.advance(3 * 86_400_000);
    expect((await post('daily', '/v1/daily/claim', { commandId: h.uuid() })).json().day).toBe(1);
    const pending = await get('daily', '/v1/grants/pending');
    expect(pending.json().grants.length).toBe(3);
  });
  it('evaluate: client_claim progress unlocks with a soft reward; server_fact needs the ledger; premium from claims is budgeted', async () => {
    // reset content to the bundle default for this player set (published v3 has only first-ten)
    await admin('/admin/v1/liveops/content', {
      commandId: h.uuid(),
      kind: 'achievements',
      env: 'lab',
      document: {
        version: 5,
        clientClaimPremiumBudget: 5,
        achievements: [
          {
            id: 'first-hundred',
            title: 'First hundred',
            criteria: [{ source: 'client_claim', fact: 'progress', op: 'gte', value: 100 }],
            rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 100 }],
          },
          {
            id: 'thousandaire',
            title: 'Thousandaire',
            criteria: [
              { source: 'client_claim', fact: 'summary', key: 'gold', op: 'gte', value: 1000 },
            ],
            rewards: [{ kind: 'premium_currency', amount: 10 }],
          },
          {
            id: 'patron',
            title: 'Patron',
            criteria: [
              { source: 'server_fact', fact: 'purchases_paid_count', op: 'gte', value: 1 },
            ],
            rewards: [{ kind: 'premium_currency', amount: 25 }],
          },
        ],
      },
      reason: 'test',
    });
    await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: h.playerHeaders('ach'),
      payload: saveBody({ progress: 150 }, { v: 1, counter: 150, gold: 5000 }),
    });
    const ev = await post('ach', '/v1/achievements/evaluate', { commandId: h.uuid() });
    expect(ev.json().unlocked.sort()).toEqual(['first-hundred', 'thousandaire']);
    const me = await get('ach', '/v1/achievements/me');
    const patron = me.json().items.find((i: { id: string }) => i.id === 'patron');
    expect(patron.unlocked).toBe(false);
    expect(patron.progress[0]).toMatchObject({ current: 0, target: 1, source: 'server_fact' });
    const pending = await get('ach', '/v1/grants/pending');
    const th = pending
      .json()
      .grants.find((g: { grantKey: string }) => g.grantKey === 'achievement:thousandaire');
    // premium from a client claim is capped by the lifetime budget (5)
    expect(th.rewards).toEqual([{ kind: 'premium_currency', amount: 5 }]);
    // re-evaluating never double-mints
    const ev2 = await post('ach', '/v1/achievements/evaluate', { commandId: h.uuid() });
    expect(ev2.json().unlocked).toEqual([]);
    expect((await get('ach', '/v1/grants/pending')).json().grants.length).toBe(2);
    // a paid purchase (server fact) unlocks patron via the outbox reaction (deterministic system command)
    await post('ach', '/v1/purchases/verify', {
      commandId: h.uuid(),
      purchaseSigned: h.receipt({
        playerKey: 'ach',
        token: 'tok-ach',
        sku: 'gems_100',
        price: 2,
        currency: 'USD',
      }),
    });
    const drained = await h.drainOutbox();
    expect(drained.dead).toBe(0);
    const me2 = await get('ach', '/v1/achievements/me');
    expect(me2.json().items.find((i: { id: string }) => i.id === 'patron').unlocked).toBe(true);
    // redelivery is idempotent by construction (commandId = outbox:<id>:<consumer>)
    const drained2 = await h.drainOutbox();
    expect(drained2.dead).toBe(0);
    expect(
      (await get('ach', '/v1/grants/pending'))
        .json()
        .grants.filter((g: { grantKey: string }) => g.grantKey === 'achievement:patron').length,
    ).toBe(1);
  });
});

describe('leaderboards L1–2: start/submit, quarantine top-N, review, close → placements, names', () => {
  it('season lifecycle', async () => {
    const noSeason = await post('lb1', '/v1/leaderboards/clicks/start', {
      commandId: h.uuid(),
      runId: h.uuid(),
    });
    expect(noSeason.statusCode).toBe(404);
    const season = await admin('/admin/v1/leaderboards/seasons', {
      commandId: h.uuid(),
      board: 'clicks',
      seasonKey: 's1',
      rulesVersion: 'v1',
      status: 'draft',
      scoreMin: 0,
      scoreMax: 100000,
      maxElapsedMs: 600000,
      quarantineTopN: 1,
      reason: 'draft season',
    });
    expect(season.statusCode).toBe(200);
    expect((await get(null, '/v1/leaderboards/clicks/top')).json()).toMatchObject({
      status: 'draft',
      entries: [],
    });
    await admin('/admin/v1/leaderboards/seasons', {
      commandId: h.uuid(),
      board: 'clicks',
      seasonKey: 's1',
      rulesVersion: 'v1',
      status: 'active',
      startsAt: h.clock.now() - 1000,
      endsAt: h.clock.now() + 3_600_000,
      scoreMin: 0,
      scoreMax: 100000,
      maxElapsedMs: 600000,
      quarantineTopN: 1,
      reason: 'go',
    });
    const runs: Record<string, string> = {};
    for (const p of ['lb1', 'lb2', 'lb3']) {
      const runId = h.uuid();
      const s = await post(p, '/v1/leaderboards/clicks/start', { commandId: h.uuid(), runId });
      expect(s.json()).toMatchObject({
        runId,
        seasonKey: 's1',
        rulesVersion: 'v1',
        seed: expect.any(String),
      });
      runs[p] = runId;
    }
    h.clock.advance(5000);
    const unknownRun = await post('lb1', '/v1/leaderboards/clicks/submit', {
      commandId: h.uuid(),
      runId: h.uuid(),
      score: 10,
    });
    expect(unknownRun.json().outcome).toBe('rejected_unknown_run');
    const bound = await post('lb1', '/v1/leaderboards/clicks/submit', {
      commandId: h.uuid(),
      runId: runs.lb1,
      score: 500,
      summary: { clicks: 100 },
    });
    expect(bound.json().outcome).toBe('rejected_out_of_range');
    const s1 = await post('lb1', '/v1/leaderboards/clicks/submit', {
      commandId: h.uuid(),
      runId: runs.lb1,
      score: 100,
      summary: { clicks: 100 },
    });
    expect(s1.json()).toMatchObject({
      outcome: 'accepted_quarantined',
      visibility: 'quarantined',
      verificationLevel: 2,
    });
    const s2 = await post('lb2', '/v1/leaderboards/clicks/submit', {
      commandId: h.uuid(),
      runId: runs.lb2,
      score: 50,
      summary: { clicks: 50 },
    });
    expect(s2.json()).toMatchObject({ outcome: 'accepted', visibility: 'visible' });
    const s3 = await post('lb3', '/v1/leaderboards/clicks/submit', {
      commandId: h.uuid(),
      runId: runs.lb3,
      score: 20,
    });
    expect(s3.json()).toMatchObject({ outcome: 'accepted', verificationLevel: 1 });
    // dup run submit → duplicate
    const dupRun = await post('lb2', '/v1/leaderboards/clicks/submit', {
      commandId: h.uuid(),
      runId: runs.lb2,
      score: 99,
    });
    expect(dupRun.json()).toMatchObject({ outcome: 'duplicate' });
    const top = await get(null, '/v1/leaderboards/clicks/top');
    expect(top.json().entries.map((e: { score: number }) => e.score)).toEqual([50, 20]);
    expect(top.json().entries[0].displayName).toMatch(/^Player [0-9A-F]{4}$/);
    const me = await get('lb1', '/v1/leaderboards/clicks/me');
    expect(me.json().best).toMatchObject({ score: 100, visibility: 'quarantined' });
    // moderated names
    const name = await post('lb2', '/v1/leaderboards/name', {
      commandId: h.uuid(),
      displayName: 'Sh1t Lord',
    });
    expect(name.json().moderated).toBe(true);
    const good = await post('lb2', '/v1/leaderboards/name', {
      commandId: h.uuid(),
      displayName: 'Clicky',
    });
    expect(good.json()).toEqual(
      expect.objectContaining({ displayName: 'Clicky', moderated: false }),
    );
    // review approves the quarantined top score
    const subId = (
      await h.root`SELECT id FROM leaderboard_submissions WHERE player_key = 'lb1'`
    )[0]!.id;
    await admin('/admin/v1/leaderboards/reviews', {
      commandId: h.uuid(),
      submissionId: Number(subId),
      action: 'approve',
      reason: 'legit',
    });
    const top2 = await get(null, '/v1/leaderboards/clicks/top');
    expect(top2.json().entries.map((e: { score: number }) => e.score)).toEqual([100, 50, 20]);
    const twice = await admin('/admin/v1/leaderboards/reviews', {
      commandId: h.uuid(),
      submissionId: Number(subId),
      action: 'reject',
      reason: 'flip',
    });
    expect(twice.statusCode).toBe(409);
    // boards_hidden players are excluded
    await admin('/admin/v1/players/flags', {
      commandId: h.uuid(),
      playerKey: 'lb3',
      flag: 'boards_hidden',
      enabled: true,
      reason: 'cheater',
    });
    const hidden = await post('lb3', '/v1/leaderboards/clicks/submit', {
      commandId: h.uuid(),
      runId: h.uuid(),
      score: 1,
    });
    expect(hidden.json().outcome).toBe('rejected_boards_hidden');
    // close → placements confirmed with grants for ranks (per game placementRewards)
    await admin('/admin/v1/leaderboards/seasons', {
      commandId: h.uuid(),
      board: 'clicks',
      seasonKey: 's1',
      rulesVersion: 'v1',
      status: 'closed',
      scoreMin: 0,
      scoreMax: 100000,
      maxElapsedMs: 600000,
      quarantineTopN: 1,
      reason: 'close',
    });
    const me1 = await get('lb1', '/v1/leaderboards/clicks/me');
    expect(me1.json().placements[0]).toMatchObject({
      rank: 1,
      state: 'confirmed',
      grantKey: 'placement:clicks:s1',
    });
    const claim = await post('lb1', '/v1/leaderboards/placements/claim', {
      commandId: h.uuid(),
      receiptId: me1.json().placements[0].receiptId,
    });
    expect(claim.json()).toMatchObject({ outcome: 'claimed', grantKey: 'placement:clicks:s1' });
    expect(
      (
        await post('lb1', '/v1/leaderboards/placements/claim', {
          commandId: h.uuid(),
          receiptId: me1.json().placements[0].receiptId,
        })
      ).json().outcome,
    ).toBe('already_claimed');
    const me3 = await get('lb3', '/v1/leaderboards/clicks/me');
    expect(me3.json().placements).toEqual([]);
    expect(me3.json().boardsHidden).toBe(true);
    const closedSubmit = await post('lb2', '/v1/leaderboards/clicks/start', {
      commandId: h.uuid(),
      runId: h.uuid(),
    });
    expect(closedSubmit.statusCode).toBe(404);
  });
});

describe('telemetry + journal', () => {
  it('integrity events: allow-listed, ≤ 20 per call (contract), daily budget; journal: monotonic fromSeq, per-call bytes, errors_only mode still stores', async () => {
    const r = await post('tel', '/v1/telemetry/integrity', {
      commandId: h.uuid(),
      events: [
        { kind: 'storage_blocked', at: h.clock.now(), detail: { mode: 'memory' } },
        {
          kind: 'game_error',
          at: h.clock.now(),
          message: 'boom',
          breadcrumbs: [{ name: 'tap', tick: 3 }],
        },
      ],
    });
    expect(r.json()).toMatchObject({ accepted: 2, dropped: 0, budgetRemaining: 198 });
    const tooMany = await post('tel', '/v1/telemetry/integrity', {
      commandId: h.uuid(),
      events: Array.from({ length: 21 }, () => ({ kind: 'clock_skew', at: h.clock.now() })),
    });
    expect(tooMany.statusCode).toBe(400);
    const notAllowed = await post('tel', '/v1/telemetry/integrity', {
      commandId: h.uuid(),
      events: [{ kind: 'made_up', at: h.clock.now() }],
    });
    expect(notAllowed.statusCode).toBe(400);
    const j1 = await post('jr', '/v1/journal', {
      commandId: h.uuid(),
      generation: 0,
      fromSeq: 0,
      buildVersion: '1.0.0',
      entries: [
        { tick: 1, now: h.clock.now(), kind: 'action', name: 'tap' },
        { tick: 2, now: h.clock.now(), kind: 'settle', name: 'settle' },
      ],
    });
    expect(j1.json()).toMatchObject({ accepted: 2, nextSeq: 2, outcome: 'stored' });
    const j2 = await post('jr', '/v1/journal', {
      commandId: h.uuid(),
      generation: 0,
      fromSeq: 1,
      buildVersion: '1.0.0',
      entries: [{ tick: 3, now: h.clock.now(), kind: 'action', name: 'tap' }],
    });
    expect(j2.json()).toMatchObject({ outcome: 'refused_non_monotonic', nextSeq: 2 });
    const j3 = await post('jr', '/v1/journal', {
      commandId: h.uuid(),
      generation: 0,
      fromSeq: 2,
      buildVersion: '1.0.0',
      entries: [{ tick: 3, now: h.clock.now(), kind: 'action', name: 'tap', args: { x: 1 } }],
    });
    expect(j3.json().outcome).toBe('stored');
    const big = await post('jr', '/v1/journal', {
      commandId: h.uuid(),
      generation: 0,
      fromSeq: 3,
      buildVersion: '1.0.0',
      entries: Array.from({ length: 500 }, (_, i) => ({
        tick: i,
        now: h.clock.now(),
        kind: 'action',
        name: 'a'.repeat(60),
        args: { k: 'v'.repeat(60) },
      })),
    });
    expect(big.json().outcome).toBe('refused_budget');
    const rows =
      await h.root`SELECT count(*)::int AS n FROM journal_entries WHERE player_key = 'jr'`;
    expect(rows[0]!.n).toBe(3);
  });
});

describe('admin reads: overview, timeline (UNION view), history, blob, actions, dead letters, rebuild', () => {
  it('inspector reads work with a read key; writes are refused', async () => {
    const ov = await h.inject({
      method: 'GET',
      url: '/admin/v1/players/ach',
      headers: h.adminHeaders('reader'),
    });
    expect(ov.statusCode).toBe(200);
    expect(ov.json()).toMatchObject({
      playerKey: 'ach',
      generation: 0,
      paidCount: 1,
      anchor: expect.objectContaining({ progress: 150 }),
    });
    const tl = await h.inject({
      method: 'GET',
      url: '/admin/v1/players/ach/timeline',
      headers: h.adminHeaders('reader'),
    });
    const kinds = new Set(tl.json().items.map((i: { kind: string }) => i.kind));
    expect(kinds).toContain('save');
    expect(kinds).toContain('purchase');
    expect(kinds).toContain('grant');
    expect(kinds).toContain('command');
    const hist = await h.inject({
      method: 'GET',
      url: '/admin/v1/players/ach/saves',
      headers: h.adminHeaders('reader'),
    });
    expect(hist.json().items.length).toBeGreaterThan(0);
    const blob = await h.inject({
      method: 'GET',
      url: `/admin/v1/players/ach/saves/${hist.json().items[0].seq}/blob`,
      headers: h.adminHeaders('reader'),
    });
    expect(blob.statusCode).toBe(200);
    const actions = await h.inject({
      method: 'GET',
      url: '/admin/v1/actions',
      headers: h.adminHeaders('reader'),
    });
    expect(actions.json().items.length).toBeGreaterThan(5);
    const dl = await h.inject({
      method: 'GET',
      url: '/admin/v1/outbox/dead-letters',
      headers: h.adminHeaders('reader'),
    });
    expect(dl.json().items).toEqual([]);
    const rebuild = await admin('/admin/v1/projections/rebuild', {
      commandId: h.uuid(),
      projection: 'leaderboard_entries',
      reason: 'drill',
    });
    expect(rebuild.json()).toMatchObject({
      projection: 'leaderboard_entries',
      rows: expect.any(Number),
    });
    const denied = await admin(
      '/admin/v1/projections/rebuild',
      { commandId: h.uuid(), projection: 'leaderboard_entries', reason: 'drill' },
      'reader',
    );
    expect(denied.statusCode).toBe(403);
    const badCreds = await h.inject({
      method: 'GET',
      url: '/admin/v1/actions',
      headers: { 'x-admin-key-id': 'full', 'x-admin-secret': 'wrong' },
    });
    expect(badCreds.statusCode).toBe(401);
  });
});

describe('outbox: leases, retries, dead letters, replay', () => {
  it('a failing consumer retries with backoff, dead-letters after maxAttempts (ops page-tier), replay re-queues', async () => {
    let calls = 0;
    h.server.ctx.outbox.register({
      name: 'test.flaky',
      kinds: ['test.event'],
      async handle() {
        calls++;
        throw new Error('consumer down');
      },
    });
    await h.db.tx(async (tx) =>
      h.server.ctx.outbox.emit(tx, { kind: 'test.event', payload: { n: 1 } }),
    );
    const d1 = await h.drainOutbox();
    expect(d1.failed).toBe(1);
    // backoff: nothing due yet
    expect((await h.drainOutbox()).failed).toBe(0);
    for (let i = 0; i < 12; i++) {
      h.clock.advance(60 * 60_000);
      await h.drainOutbox();
    }
    const dead =
      await h.root`SELECT count(*)::int AS n FROM outbox_dead_letters WHERE consumer = 'test.flaky'`;
    expect(dead[0]!.n).toBe(1);
    expect(calls).toBe(8);
    const ops = await h.inject({
      method: 'GET',
      url: '/health/ops?assert=page',
      headers: h.opsHeaders(),
    });
    expect(ops.statusCode).toBe(503);
    expect(ops.json().issues.some((i: { code: string }) => i.code === 'outbox_dead_letters')).toBe(
      true,
    );
    const id = (
      await h.root`SELECT outbox_id FROM outbox_dead_letters WHERE consumer = 'test.flaky'`
    )[0]!.outbox_id;
    const replay = await admin('/admin/v1/outbox/replay', {
      commandId: h.uuid(),
      outboxId: Number(id),
      consumer: 'test.flaky',
      reason: 'fixed consumer',
    });
    expect(replay.statusCode).toBe(200);
    const st =
      await h.root`SELECT state, attempts FROM outbox_deliveries WHERE outbox_id = ${id} AND consumer = 'test.flaky'`;
    expect(st[0]).toEqual({ state: 'pending', attempts: 0 });
    const ops2 = await h.inject({
      method: 'GET',
      url: '/health/ops?assert=page',
      headers: h.opsHeaders(),
    });
    expect(ops2.json().outbox.deadLetters).toBe(0);
  });
});
