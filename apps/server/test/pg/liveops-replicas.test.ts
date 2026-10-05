import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createServer, type Server } from '@foundation/server';
import { setupHarness, type Harness } from './harness.ts';
import { templateGame } from '../../games/template/game.config.ts';
import { templatePolicy } from '../../games/template/policy.ts';

// Two API replicas on one database: the harness server handles the admin publish, the second
// replica runs no jobs and must still pick the change up on its own refresh timer.
let h: Harness;
let replica: Server;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'liveops-replicas' });
  replica = await createServer({
    config: { ...h.config, jobsEnabled: false },
    game: templateGame,
    policy: templatePolicy,
    clock: h.clock,
    log: pino({ level: 'silent' }),
    db: h.db,
    liveopsRefreshMs: 25,
  });
  await replica.start();
});
afterAll(async () => {
  await replica?.stop();
  await h?.close();
});

describe('live-ops cache across replicas', () => {
  it('a replica that did not handle the publish refreshes its own cache on a timer', async () => {
    expect(replica.ctx.liveops.minBuildVersion()).toBe(h.server.ctx.liveops.minBuildVersion());
    const r = await h.inject({
      method: 'POST',
      url: '/admin/v1/liveops/min-build',
      headers: h.adminHeaders(),
      payload: { commandId: h.uuid(), minBuildVersion: '0.21.0', reason: 'replica test' },
    });
    expect(r.statusCode).toBe(200);
    expect(h.server.ctx.liveops.minBuildVersion()).toBe('0.21.0');
    for (let i = 0; i < 100 && replica.ctx.liveops.minBuildVersion() !== '0.21.0'; i++)
      await new Promise((res) => setTimeout(res, 20));
    expect(replica.ctx.liveops.minBuildVersion()).toBe('0.21.0');
    // the refresh is no longer a single-instance job
    expect(replica.jobs.names()).not.toContain('liveops.refresh');
  });
});
