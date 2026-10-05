import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { grantFlags, parseEnvFile, pickKey, run, usage } from './admin.mjs';
import { templateGrants } from '../apps/server/games/template/grants.ts';

const READ_SECRET = 'read-secret-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WRITE_SECRET = 'write-secret-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const STAGING_URL = 'https://admin-staging.example.test';
const ENV_FILE = [
  '# staging admin keys (scripts/admin-keys.mjs). Raw secrets: keep private, never commit.',
  '',
  '# staging-read-20260930 scopes=read issued=2026-09-30T10:00:00.000Z',
  'staging-read-20260930=old-read-secret',
  '',
  '# staging-read-20261001 scopes=read issued=2026-10-01T10:00:00.000Z',
  `staging-read-20261001=${READ_SECRET}`,
  '',
  '# staging-write-20261001 scopes=read,support,grant,publish,restore issued=2026-10-01T10:00:00.000Z',
  `staging-write-20261001=${WRITE_SECRET}`,
  '',
].join('\n');
const STAGING_FILE = `${ENV_FILE}ADMIN_URL=${STAGING_URL}\n`;

const PLAYER = {
  playerKey: 'p-1',
  firstSeenAt: 1_759_000_000_000,
  lastSeenAt: 1_759_300_000_000,
  registered: true,
  lastBuildVersion: '1.7.1',
  generation: 2,
  generationKind: 'initial',
  anchor: meta(12),
  entitlement: 0,
  paidCount: 0,
  flags: [],
  strikes: 0,
  grantsPending: 1,
  erased: false,
  serverNow: 1_759_300_000_100,
  requestId: 'req-player',
};

function meta(seq, extra = {}) {
  return {
    seq,
    generation: 2,
    progress: seq * 10,
    clientSeq: seq,
    baseSeq: seq - 1,
    sessionId: '00000000-0000-4000-8000-000000000001',
    commandId: '00000000-0000-4000-8000-000000000002',
    savedAt: 1_759_200_000_000 + seq,
    receivedAt: 1_759_200_000_500 + seq,
    bytes: 900,
    encBytes: 900,
    blobSha256: 'ab'.repeat(32),
    schemaVersion: 3,
    buildVersion: '1.7.1',
    reason: 'interval',
    disposition: 'anchored',
    flags: [],
    summary: { counter: 7, gold: 120 },
    hasBlob: true,
    ...extra,
  };
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A fake admin API: routes by "METHOD path" (query included); records every request. */
function harness({
  routes = {},
  files = { 'staging-admin.env': STAGING_FILE },
  env = {},
  grants,
} = {}) {
  const requests = [];
  const reads = [];
  const out = [];
  const err = [];
  const io = {
    ...(grants ? { grants } : {}),
    env,
    homedir: () => '/home/op',
    readFile(path) {
      reads.push(path);
      const name = path.split('/').pop();
      if (!(name in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[name];
    },
    async fetch(url, init) {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname}${u.search}`;
      requests.push({
        url,
        key,
        headers: init.headers,
        body: init.body === undefined ? undefined : JSON.parse(init.body),
      });
      const handler = routes[key];
      if (!handler)
        return json(404, { error: 'not_found', message: 'not found', correlationId: 'c-404' });
      return typeof handler === 'function' ? handler(init) : json(200, handler);
    },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  };
  return {
    io,
    requests,
    reads,
    get out() {
      return out.join('\n');
    },
    get err() {
      return err.join('\n');
    },
    noSecrets() {
      for (const s of [READ_SECRET, WRITE_SECRET, 'old-read-secret']) {
        assert.ok(!out.join('\n').includes(s), 'secret on stdout');
        assert.ok(!err.join('\n').includes(s), 'secret on stderr');
      }
    },
  };
}

const RESTORE_ROUTES = {
  'GET /admin/v1/players/p-1': PLAYER,
  'GET /admin/v1/players/p-1/saves?beforeSeq=9&limit=1': {
    generation: 2,
    items: [meta(8)],
    serverNow: 1,
    requestId: 'r',
  },
};

test('the key file gives the newest read key by default and the write key for --write', () => {
  const { url, keys } = parseEnvFile(`${ENV_FILE}ADMIN_URL=https://admin.example.test\n`);
  assert.equal(url, 'https://admin.example.test');
  assert.deepEqual(
    keys.map((k) => [k.id, k.scopes?.join(',')]),
    [
      ['staging-read-20260930', 'read'],
      ['staging-read-20261001', 'read'],
      ['staging-write-20261001', 'read,support,grant,publish,restore'],
    ],
  );
  assert.equal(pickKey(keys).id, 'staging-read-20261001');
  assert.equal(pickKey(keys, { write: true, scope: 'restore' }).id, 'staging-write-20261001');
  assert.equal(pickKey(keys, { write: true, scope: 'read' }).id, 'staging-write-20261001');
  assert.equal(pickKey(keys, { write: true, scope: 'erase' }), null);
  // Without the scopes comment the id decides.
  const bare = parseEnvFile('staging-read-x=a\nstaging-write-x=b\n').keys;
  assert.equal(pickKey(bare).id, 'staging-read-x');
  assert.equal(pickKey(bare, { write: true, scope: 'grant' }).id, 'staging-write-x');
});

test("a read sends the read key to the key file's admin origin and prints no secret", async () => {
  const h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER } });
  assert.equal(await run(['player', 'p-1'], h.io), 0);
  assert.deepEqual(h.reads, ['/home/op/.config/foundation-admin/staging-admin.env']);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, `${STAGING_URL}/admin/v1/players/p-1`);
  assert.equal(h.requests[0].headers['x-admin-key-id'], 'staging-read-20261001');
  assert.equal(h.requests[0].headers['x-admin-secret'], READ_SECRET);
  assert.match(h.out, /generation\s+2 \(initial\)/);
  assert.match(h.out, /pending quarantine\s+none/);
  assert.match(h.err, /key staging-read-20261001/);
  h.noSecrets();
});

test('--write reads with the write key; ADMIN_URL in the file, then the environment, then --url win', async () => {
  const files = { 'staging-admin.env': `${ENV_FILE}ADMIN_URL=https://admin-file.example.test/\n` };
  const routes = { 'GET /admin/v1/actions': { items: [], serverNow: 1, requestId: 'r' } };
  let h = harness({ routes, files });
  assert.equal(await run(['audit', '--write'], h.io), 0);
  assert.equal(h.requests[0].url, 'https://admin-file.example.test/admin/v1/actions');
  assert.equal(h.requests[0].headers['x-admin-key-id'], 'staging-write-20261001');
  h = harness({ routes, files, env: { ADMIN_URL: 'https://admin-env.example.test' } });
  assert.equal(await run(['audit'], h.io), 0);
  assert.equal(h.requests[0].url, 'https://admin-env.example.test/admin/v1/actions');
  h = harness({ routes, files });
  assert.equal(await run(['audit', '--url', 'http://localhost:8081'], h.io), 0);
  assert.equal(h.requests[0].url, 'http://localhost:8081/admin/v1/actions');
  // Secrets never go over plain http to another machine.
  h = harness({ routes, files });
  assert.equal(await run(['audit', '--url', 'http://admin.example.test'], h.io), 2);
  assert.equal(h.requests.length, 0);
  // No origin anywhere: refused, nothing sent (there is no built-in default).
  h = harness({ routes, files: { 'staging-admin.env': ENV_FILE } });
  assert.equal(await run(['audit'], h.io), 2);
  assert.match(
    h.err,
    /no admin URL for staging: add an ADMIN_URL= line to .*, set ADMIN_URL, or pass --url/,
  );
  assert.equal(h.requests.length, 0);
});

test('ADMIN_CONFIG_DIR moves the key file; --env picks the file by name', async () => {
  const routes = { 'GET /admin/v1/players/p-1': PLAYER };
  let h = harness({ routes, env: { ADMIN_CONFIG_DIR: '/srv/keys/my-game' } });
  assert.equal(await run(['player', 'p-1'], h.io), 0, h.err);
  assert.deepEqual(h.reads, ['/srv/keys/my-game/staging-admin.env']);
  h = harness({ routes, files: { 'lab-admin.env': STAGING_FILE.replaceAll('staging-', 'lab-') } });
  assert.equal(await run(['player', 'p-1', '--env', 'lab'], h.io), 0, h.err);
  assert.deepEqual(h.reads, ['/home/op/.config/foundation-admin/lab-admin.env']);
  assert.equal(h.requests[0].headers['x-admin-key-id'], 'lab-read-20261001');
});

test('--json prints the API body for machines', async () => {
  const h = harness({
    routes: {
      'GET /admin/v1/players/p-1/saves?limit=5': {
        generation: 2,
        items: [meta(12), meta(11, { disposition: 'quarantined', flags: ['progress_jump'] })],
        serverNow: 1,
        requestId: 'r',
      },
    },
  });
  assert.equal(await run(['timeline', 'p-1', '--limit', '5', '--json'], h.io), 0);
  const body = JSON.parse(h.out);
  assert.deepEqual(
    body.items.map((s) => [s.seq, s.disposition, s.flags]),
    [
      [12, 'anchored', []],
      [11, 'quarantined', ['progress_jump']],
    ],
  );
  assert.equal(h.err, '');
});

test('save prints the summary; --full decodes the stored save', async () => {
  const save = { v: 3, heroes: [{ name: 'Ada' }] };
  const routes = {
    'GET /admin/v1/players/p-1/saves?beforeSeq=8&limit=1': {
      generation: 2,
      items: [meta(7)],
      serverNow: 1,
      requestId: 'r',
    },
    'GET /admin/v1/players/p-1/saves/7/blob': {
      seq: 7,
      generation: 2,
      enc: 'gzip+b64',
      blob: gzipSync(JSON.stringify(save)).toString('base64'),
      blobSha256: 'ab'.repeat(32),
      serverNow: 1,
      requestId: 'r',
    },
  };
  let h = harness({ routes });
  assert.equal(await run(['save', 'p-1', '7'], h.io), 0);
  assert.match(h.out, /counter\s+7/);
  assert.match(h.out, /disposition\s+anchored/);
  h = harness({ routes });
  assert.equal(await run(['save', 'p-1', '7', '--full', '--json'], h.io), 0);
  assert.deepEqual(JSON.parse(h.out), save);
  // A seq the history does not hold is a failed lookup, not a usage error.
  h = harness({ routes });
  assert.equal(await run(['save', 'p-1', '6'], h.io), 1);
});

test('audit filters by player', async () => {
  const items = [
    {
      id: 3,
      adminKeyId: 'k',
      scope: 'restore',
      commandType: 'lineage.adminRestore',
      commandId: 'c3',
      target: 'p-1',
      reason: 'T-1',
      at: 3,
      outcome: 'ok',
    },
    {
      id: 2,
      adminKeyId: 'k',
      scope: 'grant',
      commandType: 'grants.adminMint',
      commandId: 'c2',
      target: 'p-2',
      reason: 'T-2',
      at: 2,
      outcome: 'ok',
    },
  ];
  const h = harness({
    routes: { 'GET /admin/v1/actions': { items, serverNow: 1, requestId: 'r' } },
  });
  assert.equal(await run(['audit', '--player', 'p-1', '--json'], h.io), 0);
  assert.deepEqual(
    JSON.parse(h.out).items.map((a) => a.id),
    [3],
  );
});

test('a write without --write or --yes changes nothing', async () => {
  let h = harness({ routes: RESTORE_ROUTES });
  const args = [
    'restore',
    'p-1',
    '--seq',
    '8',
    '--expected-generation',
    '2',
    '--reason',
    'T-9 lost run',
  ];
  assert.equal(await run(args, h.io), 2);
  assert.match(h.err, /add --write/);
  assert.equal(h.requests.length, 0);

  h = harness({ routes: RESTORE_ROUTES });
  assert.equal(await run([...args, '--write'], h.io), 0);
  assert.ok(h.requests.every((r) => r.key.startsWith('GET ')));
  assert.equal(h.requests[0].headers['x-admin-key-id'], 'staging-write-20261001');
  assert.match(h.out, /now\s+generation 2 \(initial\)/);
  assert.match(h.out, /opens generation 3 \(admin_restore\) seeded from seq 8/);
  assert.match(h.out, /Dry run: nothing changed/);
  h.noSecrets();

  h = harness({ routes: RESTORE_ROUTES });
  assert.equal(await run([...args, '--write', '--json'], h.io), 0);
  const plan = JSON.parse(h.out);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.plan.currentGeneration, 2);
  assert.equal(plan.plan.target.seq, 8);
});

test('--yes posts once with a fresh commandId and reports the audit id', async () => {
  const posted = [];
  const routes = {
    ...RESTORE_ROUTES,
    'POST /admin/v1/players/restore': (init) => {
      posted.push(JSON.parse(init.body));
      return json(200, {
        generation: 3,
        kind: 'reattach',
        duplicate: false,
        serverNow: 1,
        requestId: 'r',
      });
    },
    'GET /admin/v1/actions': () =>
      json(200, {
        items: [
          {
            id: 41,
            commandId: 'other',
            adminKeyId: 'k',
            scope: 'restore',
            commandType: 'x',
            at: 1,
            outcome: 'ok',
          },
          {
            id: 42,
            commandId: posted[0]?.commandId,
            adminKeyId: 'staging-write-20261001',
            scope: 'restore',
            commandType: 'lineage.adminRestore',
            target: 'p-1',
            at: 2,
            outcome: 'ok',
          },
        ],
        serverNow: 1,
        requestId: 'r',
      }),
  };
  const args = [
    'restore',
    'p-1',
    '--seq',
    '8',
    '--expected-generation',
    '2',
    '--reason',
    'T-9',
    '--write',
    '--yes',
  ];
  let h = harness({ routes });
  assert.equal(await run(args, h.io), 0);
  assert.equal(posted.length, 1);
  assert.match(posted[0].commandId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...posted[0], commandId: undefined },
    { commandId: undefined, playerKey: 'p-1', seq: 8, expectedGeneration: 2, reason: 'T-9' },
  );
  assert.match(h.out, /Done: generation 3 opened from seq 8/);
  assert.match(h.out, new RegExp(`commandId ${posted[0].commandId} · audit #42`));
  h.noSecrets();

  h = harness({ routes });
  assert.equal(await run([...args, '--json'], h.io), 0);
  assert.equal(posted.length, 2);
  assert.notEqual(posted[1].commandId, posted[0].commandId);
  const out = JSON.parse(h.out);
  assert.equal(out.commandId, posted[1].commandId);
  assert.equal(out.result.generation, 3);
  assert.equal(out.dryRun, false);
});

test('a stale expected generation is refused before anything is sent', async () => {
  const h = harness({ routes: RESTORE_ROUTES });
  const code = await run(
    [
      'restore',
      'p-1',
      '--seq',
      '8',
      '--expected-generation',
      '1',
      '--reason',
      'T',
      '--write',
      '--yes',
    ],
    h.io,
  );
  assert.equal(code, 2);
  assert.match(h.err, /generation 2 now/);
  assert.ok(h.requests.every((r) => r.key.startsWith('GET ')));
});

const CF_ID = 'f00d.access';
const CF_SECRET = 'cf-secret-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
// The production file: the old pre-scoped lines (kept, never used as keys), the scoped keys
// admin-keys.mjs issued, and the CLI's Cloudflare Access service token.
const PRODUCTION_URL = 'https://admin.example.test';
const PRODUCTION_FILE = [
  `ADMIN_URL=${PRODUCTION_URL}`,
  'OPS_SECRET=ops-secret',
  `CF_ACCESS_CLIENT_ID=${CF_ID}`,
  `CF_ACCESS_CLIENT_SECRET="${CF_SECRET}"`,
  '# production-write-20261001 scopes=read,support,grant,publish,restore issued=x',
  `production-write-20261001=${WRITE_SECRET}`,
  '# production-read-20261001 scopes=read issued=x',
  `production-read-20261001=${READ_SECRET}`,
  '',
].join('\n');

/** No secret of the production file on stdout or stderr. */
function noProductionSecrets(h) {
  h.noSecrets();
  for (const s of [CF_SECRET, 'ops-secret']) {
    assert.ok(!h.out.includes(s), 'secret on stdout');
    assert.ok(!h.err.includes(s), 'secret on stderr');
  }
}

test('production writes need --allow-production; reads do not', async () => {
  const files = { 'production-admin.env': PRODUCTION_FILE };
  const letter = [
    'letter',
    'p-1',
    '--title',
    'Hi',
    '--body',
    'Sorry',
    '--reason',
    'T-1',
    '--write',
  ];
  for (const env of ['production', 'prod']) {
    const h = harness({ files });
    assert.equal(await run([...letter, '--env', env, '--yes'], h.io), 2);
    assert.match(h.err, /--allow-production/);
    assert.equal(h.requests.length, 0);
  }
  let h = harness({ files, routes: { 'GET /admin/v1/players/p-1': PLAYER } });
  assert.equal(await run([...letter, '--env', 'prod', '--allow-production'], h.io), 0);
  assert.equal(h.requests[0].url, `${PRODUCTION_URL}/admin/v1/players/p-1`);
  assert.match(h.out, /Dry run/);
  assert.ok(h.requests.every((r) => r.key.startsWith('GET ')));
  h = harness({ files, routes: { 'GET /admin/v1/players/p-1': PLAYER } });
  assert.equal(await run(['player', 'p-1', '--env', 'production'], h.io), 0);
  assert.equal(h.requests[0].headers['x-admin-key-id'], 'production-read-20261001');
  assert.match(h.err, /production · https:\/\/admin\.example\.test · key production-read/);
  noProductionSecrets(h);
});

test('a key file with an Access service token sends it on every request, never printed', async () => {
  const files = { 'production-admin.env': PRODUCTION_FILE };
  const posted = [];
  const routes = {
    'GET /admin/v1/players/p-1': PLAYER,
    'POST /admin/v1/letters': (init) => {
      posted.push(JSON.parse(init.body));
      return json(200, { ok: true, serverNow: 1, requestId: 'r' });
    },
    'GET /admin/v1/actions': () => json(200, { items: [], serverNow: 1, requestId: 'r' }),
  };
  const h = harness({ files, routes });
  const letter = ['letter', 'p-1', '--title', 'Hi', '--body', 'Sorry', '--reason', 'T-1'];
  const code = await run(
    [...letter, '--env', 'production', '--write', '--allow-production', '--yes'],
    h.io,
  );
  assert.equal(code, 0, h.err);
  assert.equal(posted.length, 1);
  assert.deepEqual(
    h.requests.map((r) => r.key),
    ['GET /admin/v1/players/p-1', 'POST /admin/v1/letters', 'GET /admin/v1/actions'],
  );
  for (const r of h.requests) {
    assert.equal(r.headers['cf-access-client-id'], CF_ID);
    assert.equal(r.headers['cf-access-client-secret'], CF_SECRET);
    assert.equal(r.headers['x-admin-key-id'], 'production-write-20261001');
  }
  assert.match(h.err, /Cloudflare Access service token/);
  noProductionSecrets(h);

  // Without the lines (any environment, production too) no Access headers go out.
  const bare = PRODUCTION_FILE.split('\n')
    .filter((l) => !l.startsWith('CF_ACCESS_'))
    .join('\n');
  for (const [env, extra] of [
    ['staging', {}],
    ['production', { files: { 'production-admin.env': bare } }],
  ]) {
    const s = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER }, ...extra });
    assert.equal(await run(['player', 'p-1', '--env', env], s.io), 0, s.err);
    assert.equal(s.requests[0].headers['cf-access-client-id'], undefined);
    assert.equal(s.requests[0].headers['cf-access-client-secret'], undefined);
    assert.doesNotMatch(s.err, /Access/);
  }
});

test('a half Access service token or a file without scoped keys is refused before a request', async () => {
  const without = (drop) =>
    PRODUCTION_FILE.split('\n')
      .filter((l) => !drop.some((d) => l.startsWith(d)))
      .join('\n');
  const cases = [
    [without(['CF_ACCESS_CLIENT_SECRET']), /needs both CF_ACCESS_CLIENT_ID= and/],
    [without(['CF_ACCESS_CLIENT_ID']), /needs both CF_ACCESS_CLIENT_ID= and/],
    // Only the settings lines: no scoped key to use.
    [
      without(['production-', '# production-']),
      /no read key in .*production-admin\.env; issue keys with: .* --env production --allow-production/,
    ],
  ];
  for (const [file, message] of cases) {
    const h = harness({ files: { 'production-admin.env': file } });
    assert.equal(await run(['player', 'p-1', '--env', 'production'], h.io), 2);
    assert.match(h.err, message);
    assert.equal(h.requests.length, 0);
    noProductionSecrets(h);
  }
});

test('an Access refusal (login redirect or edge 403) names the service token, not the network', async () => {
  const files = { 'production-admin.env': PRODUCTION_FILE };
  let h = harness({
    files,
    routes: {
      'GET /admin/v1/players/p-1': () =>
        new Response(null, {
          status: 302,
          headers: {
            location:
              'https://team.cloudflareaccess.com/cdn-cgi/access/login/admin.example.test?redirect_url=%2F',
          },
        }),
    },
  });
  assert.equal(await run(['player', 'p-1', '--env', 'production'], h.io), 1);
  assert.match(
    h.err,
    /HTTP 302 redirect to https:\/\/team\.cloudflareaccess\.com\. An access gateway \(Cloudflare Access\) did not let the request through/,
  );
  noProductionSecrets(h);

  h = harness({
    files,
    routes: {
      'GET /admin/v1/players/p-1': () => new Response('<html>Forbidden</html>', { status: 403 }),
    },
  });
  assert.equal(await run(['player', 'p-1', '--env', 'production'], h.io), 1);
  assert.match(h.err, /HTTP 403 error\. An access gateway \(Cloudflare Access\) did not let/);
  // The API's own 403 envelope (Access passed, the API refused its token) is shown as is.
  h = harness({
    files,
    routes: {
      'GET /admin/v1/players/p-1': () =>
        json(403, {
          error: 'forbidden',
          message: 'Cloudflare Access token rejected (wrong_audience)',
          correlationId: 'c-1',
          details: { reason: 'cf_access_wrong_audience' },
        }),
    },
  });
  assert.equal(await run(['player', 'p-1', '--env', 'production'], h.io), 1);
  assert.match(h.err, /HTTP 403 forbidden: Cloudflare Access token rejected \(wrong_audience\)/);
});

test('error envelopes and network failures exit 1 with the code, id and a retry hint', async () => {
  const routes = {
    'GET /admin/v1/players/p-1': PLAYER,
    'POST /admin/v1/letters': () =>
      json(403, {
        error: 'forbidden',
        message: 'scope support required',
        correlationId: 'req-77',
        details: { required: 'support' },
      }),
  };
  const letter = [
    'letter',
    'p-1',
    '--title',
    'Hi',
    '--body',
    'Sorry',
    '--reason',
    'T-1',
    '--write',
    '--yes',
  ];
  let h = harness({ routes });
  assert.equal(await run(letter, h.io), 1);
  assert.match(h.err, /HTTP 403 forbidden: scope support required \[req-77\]/);
  assert.match(h.err, /details \{"required":"support"\}/);
  assert.match(h.err, /commandId [0-9a-f-]{36}/);
  h.noSecrets();

  h = harness({ routes });
  assert.equal(await run([...letter, '--json'], h.io), 1);
  const e = JSON.parse(h.err);
  assert.equal(e.ok, false);
  assert.equal(e.exitCode, 1);
  assert.equal(e.status, 403);
  assert.equal(e.error.error, 'forbidden');
  assert.equal(h.out, '');

  const commandId = '2b0c5b7e-8f1a-4c56-9d3e-0a1b2c3d4e5f';
  const actions = [];
  h = harness({
    routes: {
      'GET /admin/v1/players/p-1': PLAYER,
      'GET /admin/v1/actions': () => json(200, { items: actions, serverNow: 1, requestId: 'r' }),
      'POST /admin/v1/letters': () => {
        throw new TypeError('fetch failed');
      },
    },
  });
  assert.equal(await run([...letter, '--command-id', commandId], h.io), 1);
  assert.equal(h.requests.at(-1).body.commandId, commandId);
  assert.match(h.err, new RegExp(`retry with --command-id ${commandId}`));
  // The lost attempt had landed: the retry finds its audit row and sends nothing.
  actions.push({
    id: 9,
    commandId,
    adminKeyId: 'k',
    scope: 'support',
    commandType: 'inbox.sendLetter',
    at: 1,
    outcome: 'ok',
  });
  const before = h.requests.length;
  assert.equal(await run([...letter, '--command-id', commandId], h.io), 0);
  assert.deepEqual(
    h.requests.slice(before).map((r) => r.key),
    ['GET /admin/v1/actions'],
  );
  assert.match(h.out, /Already applied: commandId .* · audit #9/);

  // A non-JSON answer (an HTML error page) is still a clean failure.
  h = harness({
    routes: {
      'GET /admin/v1/players/p-1': () => new Response('<html>bad gateway</html>', { status: 502 }),
    },
  });
  assert.equal(await run(['player', 'p-1'], h.io), 1);
  assert.match(h.err, /HTTP 502 error/);
});

test('grant validates rewards locally and warns when grants are frozen', async () => {
  let h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER } });
  const base = ['grant', 'p-1', '--grant-key', 'support:T-5', '--reason', 'T-5', '--write'];
  assert.equal(await run([...base, '--rewards', '{"kind":"premium_currency"}'], h.io), 2);
  assert.equal(h.requests.length, 0);
  const frozen = { ...PLAYER, flags: [{ flag: 'grants_frozen', reason: 'abuse' }] };
  h = harness({ routes: { 'GET /admin/v1/players/p-1': frozen } });
  const rewards = '[{"kind":"premium_currency","amount":50}]';
  assert.equal(
    await run([...base, '--rewards', rewards, '--expires-at', '2026-11-01T00:00:00Z'], h.io),
    0,
  );
  assert.match(h.out, /grants_frozen is set/);
  assert.match(h.out, /expires\s+2026-11-01T00:00:00Z/);
  assert.match(h.out, /rewards {4}\+50 Gems \(free\)\n/);
});

const GRANT_BASE = ['grant', 'p-1', '--grant-key', 'support:T-5', '--reason', 'T-5', '--write'];

/**
 * A richer vocabulary than the template game's: an item amount and a choice field, and another
 * name for the premium currency.
 */
const RICH_GRANTS = {
  premiumName: 'crystals',
  fields: [
    {
      kind: 'amount',
      name: 'crystals',
      label: 'Crystal',
      note: 'free',
      max: 100_000,
      reward: { kind: 'premium_currency' },
    },
    {
      kind: 'amount',
      name: 'gold',
      label: 'Gold',
      plural: 'Gold',
      max: 1_000_000,
      reward: { kind: 'soft_currency', currency: 'gold' },
    },
    {
      kind: 'amount',
      name: 'chests',
      label: 'Chest',
      max: 10_000,
      reward: { kind: 'item', itemId: 'chest' },
    },
    {
      kind: 'choice',
      name: 'contract',
      label: 'contract',
      max: 10,
      options: ['standard', 'premium', 'elite'].map((value) => ({
        value,
        label: value[0].toUpperCase() + value.slice(1),
        reward: { kind: 'item', itemId: `contract:${value}` },
      })),
    },
  ],
};

test("grant's reward flags are the template vocabulary's by default", async () => {
  const flags = ['--gems', '100', '--gold', '5000'];
  let h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER } });
  assert.equal(await run([...GRANT_BASE, ...flags], h.io), 0, h.err);
  assert.ok(h.requests.every((r) => r.key.startsWith('GET ')));
  assert.ok(
    h.out.includes(
      [
        'Grant to p-1 (last seen 2025-10-01T06:26:40Z, 1 unclaimed grant(s))',
        '  grant key  support:T-5 (once per key: a reused key is a duplicate, not a second grant)',
        '  rewards    +100 Gems (free) · +5,000 Gold',
        "  lands      in the game on the player's next start",
        '  reason     T-5',
      ].join('\n'),
    ),
    h.out,
  );
  assert.match(h.out, /Dry run: nothing changed/);

  // The --json plan keeps the exact rewards JSON the server gets.
  h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER } });
  assert.equal(await run([...GRANT_BASE, ...flags, '--json'], h.io), 0);
  assert.deepEqual(JSON.parse(h.out).plan.rewards, [
    { kind: 'premium_currency', amount: 100 },
    { kind: 'soft_currency', currency: 'gold', amount: 5000 },
  ]);

  // Another game's flag is not this game's.
  h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER } });
  assert.equal(await run([...GRANT_BASE, '--chests', '1'], h.io), 2);
  assert.match(h.err, /Unknown option '--chests'/);
  assert.equal(h.requests.length, 0);
  // Reward flags belong to grant only.
  h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER } });
  assert.equal(await run(['player', 'p-1', '--gems', '5'], h.io), 2);
  assert.match(h.err, /player does not take --gems/);
});

test('grant builds amounts, items and choices from the game vocabulary', async () => {
  const flags = ['--crystals', '100', '--gold', '5000', '--chests', '10', '--contract', 'premium'];
  const routes = { 'GET /admin/v1/players/p-1': PLAYER };
  let h = harness({ routes, grants: RICH_GRANTS });
  assert.equal(await run([...GRANT_BASE, ...flags], h.io), 0, h.err);
  assert.match(
    h.out,
    /\n {2}rewards {4}\+100 Crystals \(free\) · \+5,000 Gold · \+10 Chests · 1 Premium contract\n/,
  );
  h = harness({ routes, grants: RICH_GRANTS });
  assert.equal(await run([...GRANT_BASE, ...flags, '--json'], h.io), 0);
  assert.deepEqual(JSON.parse(h.out).plan.rewards, [
    { kind: 'premium_currency', amount: 100 },
    { kind: 'soft_currency', currency: 'gold', amount: 5000 },
    { kind: 'item', itemId: 'chest', qty: 10 },
    { kind: 'item', itemId: 'contract:premium', qty: 1 },
  ]);

  // Each choice flag adds one pick; picks of one option combine, in first-seen order.
  const contracts = ['--contract', 'elite', '--contract', 'standard', '--contract', 'elite'];
  h = harness({ routes, grants: RICH_GRANTS });
  assert.equal(await run([...GRANT_BASE, ...contracts, '--json'], h.io), 0);
  assert.deepEqual(JSON.parse(h.out).plan.rewards, [
    { kind: 'item', itemId: 'contract:elite', qty: 2 },
    { kind: 'item', itemId: 'contract:standard', qty: 1 },
  ]);
  h = harness({ routes, grants: RICH_GRANTS });
  assert.equal(await run([...GRANT_BASE, ...contracts], h.io), 0);
  assert.match(h.out, /rewards {4}2 Elite contracts · 1 Standard contract\n/);
});

test('grant --yes posts the rewards the flags built', async () => {
  const posted = [];
  const routes = {
    'GET /admin/v1/players/p-1': PLAYER,
    'POST /admin/v1/grants': (init) => {
      posted.push(JSON.parse(init.body));
      return json(200, { grantKey: 'support:T-5', duplicate: false, serverNow: 1, requestId: 'r' });
    },
    'GET /admin/v1/actions': () =>
      json(200, {
        items: [{ id: 7, commandId: posted[0]?.commandId, adminKeyId: 'k', at: 1, outcome: 'ok' }],
        serverNow: 1,
        requestId: 'r',
      }),
  };
  const h = harness({ routes });
  const args = [...GRANT_BASE, '--gems', '250', '--gold', '1', '--ticket', 'T-5', '--yes'];
  assert.equal(await run(args, h.io), 0, h.err);
  assert.equal(posted.length, 1);
  assert.deepEqual(
    { ...posted[0], commandId: undefined },
    {
      commandId: undefined,
      playerKey: 'p-1',
      grantKey: 'support:T-5',
      rewards: [
        { kind: 'premium_currency', amount: 250 },
        { kind: 'soft_currency', currency: 'gold', amount: 1 },
      ],
      reason: 'T-5',
      ticketRef: 'T-5',
    },
  );
  assert.match(h.out, /rewards {4}\+250 Gems \(free\) · \+1 Gold\n/);
  assert.match(h.out, /Done: grant support:T-5 minted\ncommandId [0-9a-f-]{36} · audit #7/);
  h.noSecrets();
});

test('grant refuses rewards the game cannot apply in the dry run, before any request', async () => {
  const cases = [
    [
      ['--gems', '5', '--rewards', '[{"kind":"premium_currency","amount":5}]'],
      /--rewards replaces/,
    ],
    [[], /grant needs rewards: --gems N, --gold N \(or --rewards JSON\)/],
    [['--gems', '0'], /--gems must be an integer from 1 to 100000/],
    [['--gems=-5'], /--gems must be an integer from 1 to 100000/],
    [['--gems', '-5'], /write --gems=-5/],
    [['--gems', '100001'], /--gems must be an integer from 1 to 100000/],
    [['--gold', '1.5'], /--gold must be an integer from 1 to 1000000000/],
    [['--gems', '5', '--gems', '6'], /--gems is a total: give it once/],
    [
      ['--rewards', '[{"kind":"cosmetic","itemId":"hat"}]'],
      /--rewards refused: reward 1: unsupported kind "cosmetic" \(the game takes gems and gold\)/,
    ],
    [
      ['--rewards', '[{"kind":"soft_currency","currency":"gems","amount":5}]'],
      /--rewards refused: reward 1: unsupported currency "gems"/,
    ],
    [
      ['--rewards', '[{"kind":"premium_currency","amount":100001}]'],
      /--rewards refused: more than 100000 gems/,
    ],
    [['--rewards', '[{"kind":"item","itemId":"chest","qty":1}]'], /unsupported item "chest"/],
    [['--rewards', '[]'], /--rewards refused: no rewards/],
    [
      ['--rewards', 'gems'],
      /--rewards must be JSON, e\.g\. '\[\{"kind":"premium_currency","amount":50\}\]'/,
    ],
    // A choice field (RICH_GRANTS): unknown options and too many picks.
    [['--contract', 'gold'], /--contract "gold": one of standard, premium, elite/, RICH_GRANTS],
    [
      Array(11).fill(['--contract', 'standard']).flat(),
      /rewards refused: more than 10 contracts \(the game takes crystals, gold, chests and contracts\)/,
      RICH_GRANTS,
    ],
    [['--chests', '0'], /--chests must be an integer from 1 to 10000/, RICH_GRANTS],
    [
      ['--rewards', '[{"kind":"item","itemId":"chest","qty":0}]'],
      /chests must be at least 1/,
      RICH_GRANTS,
    ],
    [[], /grant needs rewards: .*--contract standard\|premium\|elite/, RICH_GRANTS],
  ];
  for (const [extra, message, grants] of cases) {
    const h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER }, grants });
    assert.equal(await run([...GRANT_BASE, ...extra], h.io), 2, extra.join(' '));
    assert.match(h.err, message, extra.join(' '));
    assert.equal(h.requests.length, 0, extra.join(' '));
  }
});

test('--help lists the reward flags of the game vocabulary', async () => {
  const text = usage(templateGrants);
  assert.match(text, /^Admin CLI: /);
  assert.match(text, /\n {2}--gems N {2}Gems \(free\): a total from 1 to 100,000\n/);
  assert.match(text, /\n {2}--gold N {2}Gold: a total from 1 to 1,000,000,000$/);
  const h = harness({ grants: RICH_GRANTS });
  assert.equal(await run(['--help'], h.io), 0);
  assert.match(h.out, /premium currency: crystals/);
  assert.match(h.out, /--contract standard\|premium\|elite {2}one contract per flag, up to 10/);
  assert.equal(h.requests.length, 0);
});

test('a vocabulary field that cannot be a flag is a vocabulary mistake', () => {
  const field = (name) => ({
    kind: 'amount',
    name,
    label: 'X',
    max: 1,
    reward: { kind: 'premium_currency' },
  });
  assert.deepEqual(Object.keys(grantFlags(RICH_GRANTS)), [
    'crystals',
    'gold',
    'chests',
    'contract',
  ]);
  for (const name of ['reason', 'env', 'json', 'Gems', 'two words', ''])
    assert.throws(
      () => grantFlags({ premiumName: 'x', fields: [field(name)] }),
      /cannot be a flag/,
    );
  assert.throws(
    () => grantFlags({ premiumName: 'x', fields: [field('a'), field('a')] }),
    /declared twice/,
  );
});

const PURCHASE = {
  at: 1_759_250_000_000,
  kind: 'purchase',
  ref: '12',
  summary: 'paid gems_500 granted=550',
  detail: { price: 4.99, currency: 'USD', source: 'checkout', grantKey: 'purchase:x' },
};
const TIMELINE = (items) => ({ playerKey: 'p-1', items, serverNow: 1, requestId: 'r' });
const ADJUST_BASE = ['adjust', 'p-1', '--reason', 'T-7 double charge', '--write'];

/** A dry-run adjust plan's text for the player (overview overrides) and the extra flags. */
async function adjustPlan(extra, player = {}, routes = {}) {
  const h = harness({
    routes: { 'GET /admin/v1/players/p-1': { ...PLAYER, ...player }, ...routes },
  });
  const code = await run([...ADJUST_BASE, ...extra], h.io);
  assert.equal(code, 0, h.err);
  assert.ok(h.requests.every((r) => r.key.startsWith('GET ')));
  if (extra.includes('--json')) assert.equal(JSON.parse(h.out).dryRun, true);
  else assert.match(h.out, /Dry run: nothing changed/);
  return h;
}

test('adjust plans each kind with its effect on the wallet and strikes', async () => {
  let h = await adjustPlan(['--kind', 'make_good', '--delta', '300']);
  assert.ok(
    h.out.includes(
      [
        "Adjust p-1's gems (last seen 2025-10-01T06:26:40Z, 0 paid purchase(s), 0 strike(s))",
        '  kind       make_good',
        '  effect     +300 PAID gems (make good), credited when the game next starts',
        '  reason     T-7 double charge',
      ].join('\n'),
    ),
    h.out,
  );
  assert.doesNotMatch(h.out, /warning/);
  // No --transaction-id: only the player is read.
  assert.deepEqual(
    h.requests.map((r) => r.key),
    ['GET /admin/v1/players/p-1'],
  );

  h = await adjustPlan(['--kind', 'refund', '--delta=-300', '--ticket', 'T-7']);
  assert.match(
    h.out,
    /effect {5}−300 gems \(refund\), wallet clamps at 0; adds a refund strike \(1\/3\)\n/,
  );
  assert.match(h.out, /ticket {5}T-7\n/);
  assert.doesNotMatch(h.out, /warning/);

  h = await adjustPlan(['--kind', 'refund', '--delta=-300', '--json'], { strikes: 2 });
  const plan = JSON.parse(h.out).plan;
  assert.equal(plan.strikes, 2);
  assert.equal(plan.strikesAfter, 3);
  assert.equal(plan.setsPurchasesDisabled, true);
  h = await adjustPlan(['--kind', 'refund', '--delta=-300'], { strikes: 2 });
  assert.match(h.out, /adds a refund strike \(3\/3\)\n/);
  assert.match(h.out, /warning {4}the 3rd strike sets purchases_disabled \(checkout off\)\n/);

  h = await adjustPlan(['--kind', 'refund', '--delta=-300'], {
    strikes: 3,
    flags: [{ flag: 'purchases_disabled', reason: 'auto: 3 refund strikes' }],
  });
  assert.match(h.out, /adds a refund strike \(4\/3\)\n/);
  assert.match(h.out, /warning {4}purchases_disabled is already set \(checkout off\)\n/);

  h = await adjustPlan(['--kind', 'correction', '--delta', '50']);
  assert.match(
    h.out,
    /effect {5}\+50 PAID gems \(correction\), credited when the game next starts\n/,
  );
  h = await adjustPlan(['--kind', 'correction', '--delta=-1500'], { strikes: 2 });
  assert.match(h.out, /effect {5}−1,500 gems \(correction\), wallet clamps at 0; no strike\n/);
  assert.doesNotMatch(h.out, /warning/);
});

test("adjust names the game's premium currency", async () => {
  const routes = {
    'GET /admin/v1/players/p-1': PLAYER,
    'GET /admin/v1/players/p-1/timeline': TIMELINE([
      { ...PURCHASE, summary: 'paid crystals_500 granted=550' },
    ]),
  };
  let h = harness({ routes, grants: RICH_GRANTS });
  assert.equal(
    await run(
      [...ADJUST_BASE, '--kind', 'make_good', '--delta', '300', '--transaction-id', '12'],
      h.io,
    ),
    0,
    h.err,
  );
  assert.match(h.out, /^Adjust p-1's crystals \(last seen/m);
  assert.match(h.out, /purchase {3}#12 · paid · sku crystals_500 · 550 crystals granted/);
  assert.match(
    h.out,
    /effect {5}\+300 PAID crystals \(make good\), credited when the game next starts\n/,
  );
  h = harness({ routes, grants: RICH_GRANTS });
  assert.equal(await run([...ADJUST_BASE, '--kind', 'refund', '--delta=-30'], h.io), 0, h.err);
  assert.match(h.out, /effect {5}−30 crystals \(refund\), wallet clamps at 0/);
  h = harness({ routes, grants: RICH_GRANTS });
  assert.equal(await run([...ADJUST_BASE, '--kind', 'refund', '--delta', '30'], h.io), 2);
  assert.match(h.err, /a refund removes crystals: --delta must be negative/);
});

test('adjust refuses a kind, delta or sign that does not fit, before any request', async () => {
  const cases = [
    [['--kind', 'make_good', '--delta=-300'], /make_good credits gems: --delta must be positive/],
    [['--kind', 'refund', '--delta', '300'], /--delta must be negative, e.g\. --delta=-300/],
    [
      ['--kind', 'refund', '--delta', '-300'],
      /--delta -300 reads as a missing value: write --delta=-300/,
    ],
    [['--kind', 'correction', '--delta', '0'], /--delta must be a non-zero integer/],
    [['--kind', 'correction', '--delta', '1000001'], /from -1000000 to 1000000/],
    [['--kind', 'correction', '--delta', '2.5'], /non-zero integer/],
    [['--kind', 'correction'], /non-zero integer/],
    [['--kind', 'grant', '--delta', '5'], /--kind must be make_good, refund or correction/],
    [['--delta', '5'], /--kind must be/],
    [
      ['--kind', 'make_good', '--delta', '5', '--transaction-id', 'tok_abc'],
      /server transaction id/,
    ],
  ];
  for (const [extra, message] of cases) {
    const h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER } });
    assert.equal(await run([...ADJUST_BASE, ...extra], h.io), 2, extra.join(' '));
    assert.match(h.err, message, extra.join(' '));
    assert.equal(h.requests.length, 0, extra.join(' '));
  }
});

test('adjust --transaction-id shows the purchase, or refuses one the player does not have', async () => {
  const save = { at: 1, kind: 'save', ref: '13', summary: 'anchored progress=9' };
  const routes = { 'GET /admin/v1/players/p-1/timeline': TIMELINE([save, PURCHASE]) };
  let h = await adjustPlan(
    ['--kind', 'refund', '--delta=-550', '--transaction-id', '12'],
    {},
    routes,
  );
  assert.match(
    h.out,
    /\n {2}purchase {3}#12 · paid · sku gems_500 · 550 gems granted · recorded 2025-09-30T16:33:20Z\n {2}effect/,
  );
  h = await adjustPlan(
    ['--kind', 'refund', '--delta=-550', '--transaction-id', '12', '--json'],
    {},
    routes,
  );
  const t = JSON.parse(h.out).plan.transaction;
  assert.deepEqual(
    [t.id, t.classification, t.sku, t.granted, t.checked],
    [12, 'paid', 'gems_500', 550, true],
  );
  assert.equal(JSON.parse(h.out).plan.transactionId, 12);

  // Another row's ref is not a purchase: refused in the plan.
  h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER, ...routes } });
  assert.equal(
    await run(
      [...ADJUST_BASE, '--kind', 'make_good', '--delta', '5', '--transaction-id', '13', '--yes'],
      h.io,
    ),
    2,
  );
  assert.match(h.err, /player p-1 has no purchase transaction #13 \(purchase refs: events p-1\)/);
  assert.ok(h.requests.every((r) => r.key.startsWith('GET ')));

  // A timeline cut at 500 rows cannot rule an older purchase out: the server checks it.
  const full = Array.from({ length: 500 }, (_, i) => ({ ...save, ref: String(1000 + i) }));
  h = await adjustPlan(
    ['--kind', 'make_good', '--delta', '5', '--transaction-id', '13'],
    {},
    { 'GET /admin/v1/players/p-1/timeline': TIMELINE(full) },
  );
  assert.match(
    h.out,
    /purchase {3}#13 not among the newest 500 events; the server checks it is p-1's\n/,
  );
});

test('adjust --yes posts the adjustment and reports its id; production needs --allow-production', async () => {
  const posted = [];
  let duplicate = false;
  const routes = {
    'GET /admin/v1/players/p-1': PLAYER,
    'GET /admin/v1/players/p-1/timeline': TIMELINE([PURCHASE]),
    'POST /admin/v1/purchases/adjustments': (init) => {
      posted.push(JSON.parse(init.body));
      return json(200, { adjustmentId: 77, duplicate, serverNow: 1, requestId: 'r' });
    },
    'GET /admin/v1/actions': () =>
      json(200, {
        items: [
          {
            id: 5,
            commandId: posted.at(-1)?.commandId,
            adminKeyId: 'staging-write-20261001',
            scope: 'grant',
            commandType: 'purchases.adjust',
            target: 'p-1',
            at: 1,
            outcome: 'ok',
          },
        ],
        serverNow: 1,
        requestId: 'r',
      }),
  };
  const args = [
    ...ADJUST_BASE,
    '--kind',
    'refund',
    '--delta=-300',
    '--transaction-id',
    '12',
    '--ticket',
    'T-7',
    '--yes',
  ];
  let h = harness({ routes });
  assert.equal(await run(args, h.io), 0, h.err);
  assert.equal(posted.length, 1);
  assert.match(posted[0].commandId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...posted[0], commandId: undefined },
    {
      commandId: undefined,
      playerKey: 'p-1',
      kind: 'refund',
      delta: -300,
      reason: 'T-7 double charge',
      transactionId: 12,
      ticketRef: 'T-7',
    },
  );
  assert.equal(h.requests[0].headers['x-admin-key-id'], 'staging-write-20261001');
  assert.match(h.out, /effect {5}−300 gems \(refund\)/);
  assert.match(
    h.out,
    new RegExp(`Done: adjustment #77 recorded\\ncommandId ${posted[0].commandId} · audit #5`),
  );
  h.noSecrets();

  duplicate = true;
  h = harness({ routes });
  assert.equal(await run([...args, '--json'], h.io), 0, h.err);
  const out = JSON.parse(h.out);
  assert.equal(out.dryRun, false);
  assert.deepEqual(out.result, { adjustmentId: 77, duplicate: true });
  h = harness({ routes });
  assert.equal(await run(args, h.io), 0, h.err);
  assert.match(h.out, /Done: adjustment #77 · duplicate \(already recorded\)/);

  // Production: refused without --allow-production, before any request.
  const files = { 'production-admin.env': PRODUCTION_FILE };
  h = harness({ files, routes });
  assert.equal(await run([...args, '--env', 'production'], h.io), 2);
  assert.match(h.err, /refusing a production write without --allow-production/);
  assert.equal(h.requests.length, 0);
  h = harness({ files, routes });
  const dry = args.filter((a) => a !== '--yes');
  assert.equal(await run([...dry, '--env', 'production', '--allow-production'], h.io), 0, h.err);
  assert.equal(h.requests[0].url, `${PRODUCTION_URL}/admin/v1/players/p-1`);
  assert.match(h.out, /Dry run/);
  assert.ok(h.requests.every((r) => r.key.startsWith('GET ')));
  noProductionSecrets(h);
});

test('usage mistakes exit 2 without a request', async () => {
  for (const args of [
    [],
    ['nope'],
    ['player'],
    ['player', 'p-1', '--seq', '3'],
    ['player', 'p-1', '--yes'],
    ['timeline', 'p-1', '--limit', '0'],
    ['save', 'p-1', 'x'],
    ['restore', 'p-1', '--write', '--seq', '1', '--reason', 'r'],
    [
      'letter',
      'p-1',
      '--write',
      '--title',
      'T',
      '--body',
      'B',
      '--reason',
      'R',
      '--command-id',
      'nope',
    ],
    ['player', 'p-1', '--env', 'lab'],
    ['player', 'p-1', '--bogus'],
  ]) {
    const h = harness({ routes: { 'GET /admin/v1/players/p-1': PLAYER } });
    assert.equal(await run(args, h.io), 2, args.join(' '));
    assert.ok(
      h.requests.every((r) => r.key === 'GET /admin/v1/players/p-1'),
      args.join(' '),
    );
  }
  const h = harness({ files: {} });
  assert.equal(await run(['player', 'p-1'], h.io), 2);
  assert.match(h.err, /admin-keys\.mjs issue --env staging/);
});
