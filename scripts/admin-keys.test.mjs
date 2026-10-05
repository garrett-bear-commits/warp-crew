import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SERVICE,
  READ_SCOPES,
  WRITE_SCOPES,
  addToEnvFile,
  adminEnvironment,
  adminKeysFromVariables,
  envFileKeyIds,
  keyIds,
  mergeAdminKeys,
  newKey,
  readVariablesArgs,
  removeAdminKey,
  removeFromEnvFile,
  resolveTarget,
  sha256Hex,
  withSettings,
  writeKeysArgs,
} from './admin-keys.mjs';
import { envFilePath, environmentName } from './admin-env.mjs';
import { ADMIN_SCOPES } from '../packages/contracts/src/enums.ts';
import { parseAdminKeys as serverParseAdminKeys } from '../packages/server/src/config.ts';

const script = fileURLToPath(new URL('admin-keys.mjs', import.meta.url));
const hash = (c) => c.repeat(64);

test('read key only reads; write key carries what support needs and never erase', () => {
  assert.deepEqual(READ_SCOPES, ['read']);
  assert.deepEqual(WRITE_SCOPES, ['read', 'support', 'grant', 'publish', 'restore']);
  for (const s of [...READ_SCOPES, ...WRITE_SCOPES]) assert.ok(ADMIN_SCOPES.includes(s), s);
  assert.deepEqual(
    ADMIN_SCOPES.filter((s) => !WRITE_SCOPES.includes(s)),
    ['erase'],
  );
});

test('production needs --allow-production; other environment names pass, malformed ones do not', () => {
  assert.equal(adminEnvironment('staging'), 'staging');
  assert.equal(adminEnvironment('lab'), 'lab');
  assert.throws(() => adminEnvironment('production'), /--allow-production/);
  assert.throws(() => adminEnvironment('prod'), /--allow-production/);
  assert.equal(adminEnvironment('prod', true), 'production');
  for (const bad of ['Lab', 'stag ing', '', '-x', undefined])
    assert.throws(() => environmentName(bad), /unknown --env/);
  const r = spawnSync(process.execPath, [script, 'issue', '--env', 'prod', '--dry-run'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--allow-production/);
});

test('the key file lives under ~/.config/foundation-admin unless ADMIN_CONFIG_DIR moves it', () => {
  const home = () => '/home/op';
  assert.equal(
    envFilePath('staging', { env: {}, home }),
    '/home/op/.config/foundation-admin/staging-admin.env',
  );
  assert.equal(
    envFilePath('production', { env: { ADMIN_CONFIG_DIR: '/srv/keys/my-game' }, home }),
    '/srv/keys/my-game/production-admin.env',
  );
});

test('key ids are dated in UTC with an optional suffix', () => {
  const now = new Date('2026-10-01T23:30:00Z');
  assert.deepEqual(keyIds('staging', now), {
    read: 'staging-read-20261001',
    write: 'staging-write-20261001',
  });
  assert.equal(keyIds('staging', now, '2').write, 'staging-write-20261001-2');
  assert.throws(() => keyIds('staging', now, 'Bad Tag'), /--suffix/);
});

test('a new key is 32 random bytes whose sha256 the API compares', () => {
  const k = newKey(WRITE_SCOPES, () => Buffer.alloc(32, 7));
  assert.equal(Buffer.from(k.secret, 'base64url').length, 32);
  assert.deepEqual(k.entry, { secretSha256: sha256Hex(k.secret), scopes: WRITE_SCOPES });
  assert.notEqual(newKey(READ_SCOPES).secret, newKey(READ_SCOPES).secret);
});

test('merging keeps existing keys, refuses a reused id, and the API accepts the result', () => {
  const existing = { 'staging-ops': { secretSha256: hash('a'), scopes: ['read', 'erase'] } };
  const read = newKey(READ_SCOPES);
  const write = newKey(WRITE_SCOPES);
  const merged = mergeAdminKeys(existing, {
    'staging-read-20261001': read.entry,
    'staging-write-20261001': write.entry,
  });
  assert.deepEqual(Object.keys(merged), [
    'staging-ops',
    'staging-read-20261001',
    'staging-write-20261001',
  ]);
  assert.deepEqual(merged['staging-ops'], existing['staging-ops']);
  const parsed = serverParseAdminKeys(JSON.stringify(merged));
  assert.deepEqual(
    parsed.map((k) => [k.keyId, k.scopes]),
    [
      ['staging-ops', ['read', 'erase']],
      ['staging-read-20261001', READ_SCOPES],
      ['staging-write-20261001', WRITE_SCOPES],
    ],
  );
  assert.throws(
    () => mergeAdminKeys(merged, { 'staging-read-20261001': newKey(READ_SCOPES).entry }),
    /already exists/,
  );
});

test('revoking removes one key but never the last', () => {
  const keys = {
    a: { secretSha256: hash('a'), scopes: ['read'] },
    b: { secretSha256: hash('b'), scopes: ['read'] },
  };
  assert.deepEqual(removeAdminKey(keys, 'a'), { b: keys.b });
  assert.throws(() => removeAdminKey(keys, 'c'), /not on the service/);
  assert.throws(() => removeAdminKey({ b: keys.b }, 'b'), /last admin key/);
});

test('Railway output is parsed without echoing it', () => {
  const vars = {
    JEST_JWS_SECRETS: 'c2VjcmV0LXZhbHVlLXRoYXQtbXVzdC1ub3QtbGVhaw==',
    ADMIN_KEYS: JSON.stringify({ k: { secretSha256: hash('d'), scopes: ['read'] } }),
  };
  assert.deepEqual(adminKeysFromVariables(JSON.stringify(vars)), {
    k: { secretSha256: hash('d'), scopes: ['read'] },
  });
  assert.deepEqual(adminKeysFromVariables(JSON.stringify({ OTHER: 'x' })), {});
  for (const bad of [
    'JEST_JWS_SECRETS=c2VjcmV0LXZhbHVlLXRoYXQtbXVzdC1ub3QtbGVhaw==',
    JSON.stringify({ ADMIN_KEYS: '{"k": c2VjcmV0LXZhbHVl' }),
    JSON.stringify({ ADMIN_KEYS: JSON.stringify({ k: { secretSha256: 'x', scopes: ['read'] } }) }),
    JSON.stringify({
      ADMIN_KEYS: JSON.stringify({ k: { secretSha256: hash('e'), scopes: ['root'] } }),
    }),
  ]) {
    assert.throws(
      () => adminKeysFromVariables(bad),
      (e) => !e.message.includes('c2VjcmV0') && !e.message.includes(hash('e')),
    );
  }
});

test('the local file keeps existing lines, refuses a reused id, and drops a revoked key', () => {
  const first = addToEnvFile(
    '',
    'staging',
    [
      { id: 'staging-read-20261001', scopes: READ_SCOPES, secret: 'R1' },
      { id: 'staging-write-20261001', scopes: WRITE_SCOPES, secret: 'W1' },
    ],
    '2026-10-01T10:00:00.000Z',
  );
  assert.match(first, /^# staging admin keys/);
  assert.match(
    first,
    /\n# staging-write-20261001 scopes=read,support,grant,publish,restore issued=2026-10-01T10:00:00.000Z\nstaging-write-20261001=W1\n/,
  );
  const handEdited = `${first}MY_NOTE=keep me\n`;
  const second = addToEnvFile(
    handEdited,
    'staging',
    [{ id: 'staging-read-20261101', scopes: READ_SCOPES, secret: 'R2' }],
    '2026-11-01T10:00:00.000Z',
  );
  assert.ok(second.startsWith(handEdited));
  assert.deepEqual(envFileKeyIds(second), [
    'staging-read-20261001',
    'staging-write-20261001',
    'staging-read-20261101',
  ]);
  assert.throws(
    () =>
      addToEnvFile(
        second,
        'staging',
        [{ id: 'staging-read-20261001', scopes: READ_SCOPES, secret: 'X' }],
        'now',
      ),
    /already has a secret/,
  );
  const revoked = removeFromEnvFile(second, 'staging-read-20261001');
  assert.deepEqual(envFileKeyIds(revoked), ['staging-write-20261001', 'staging-read-20261101']);
  assert.ok(!revoked.includes('R1'));
  assert.ok(!revoked.includes('# staging-read-20261001 '));
  assert.ok(revoked.includes('MY_NOTE=keep me'));
  assert.equal(removeFromEnvFile(revoked, 'staging-read-20261001'), revoked);
});

const STAGING_ID = '11111111-2222-4333-8444-555555555555';
const PRODUCTION_ID = '99999999-8888-4777-8666-555555555555';

test('the Railway target comes from flags or the key file, and a disagreement is refused', () => {
  const file = '/k/staging-admin.env';
  const fromFlags = resolveTarget(
    '',
    { 'railway-environment': STAGING_ID, 'admin-url': 'https://admin.example.test' },
    file,
  );
  assert.deepEqual(fromFlags, {
    environmentId: STAGING_ID,
    service: DEFAULT_SERVICE,
    adminUrl: 'https://admin.example.test',
    newLines: [`RAILWAY_ENVIRONMENT_ID=${STAGING_ID}`, 'ADMIN_URL=https://admin.example.test'],
  });
  const recorded = withSettings('', 'staging', fromFlags.newLines);
  assert.match(recorded, /^# staging admin keys/);
  const fromFile = resolveTarget(`${recorded}RAILWAY_SERVICE="game-api"\n`, {}, file);
  assert.deepEqual(
    [fromFile.environmentId, fromFile.service, fromFile.adminUrl, fromFile.newLines],
    [STAGING_ID, 'game-api', 'https://admin.example.test', []],
  );
  // The same value again is fine; another one is refused.
  assert.deepEqual(
    resolveTarget(recorded, { 'railway-environment': STAGING_ID }, file).newLines,
    [],
  );
  assert.throws(
    () => resolveTarget(recorded, { 'railway-environment': PRODUCTION_ID }, file),
    /--railway-environment 9999.* differs from RAILWAY_ENVIRONMENT_ID=1111.* in \/k\/staging-admin\.env/,
  );
  assert.throws(() => resolveTarget('', {}, file), /pass --railway-environment <id> or add/);
  assert.throws(
    () => resolveTarget('', { 'railway-environment': 'staging' }, file),
    /the Railway environment's id \(a UUID\), not its name/,
  );
  assert.throws(
    () =>
      resolveTarget('', { 'railway-environment': STAGING_ID, 'admin-url': 'http://a.test' }, file),
    /https/,
  );
  assert.deepEqual(readVariablesArgs(fromFile), [
    'variables',
    '--service',
    'game-api',
    '--environment',
    STAGING_ID,
    '--json',
  ]);
  assert.deepEqual(writeKeysArgs(fromFile, true), [
    'variable',
    'set',
    'ADMIN_KEYS',
    '--stdin',
    '--service',
    'game-api',
    '--environment',
    STAGING_ID,
  ]);
});

// The CLI end to end against a fake `railway` that keeps the API's variables in a JSON file.
const FAKE_RAILWAY = `#!/usr/bin/env node
const fs = require('node:fs');
const state = process.env.FAKE_RAILWAY_STATE;
const args = process.argv.slice(2);
fs.appendFileSync(state + '.calls', JSON.stringify(args) + '\\n');
const vars = JSON.parse(fs.readFileSync(state, 'utf8'));
if (args[0] === 'variables' && args.includes('--json')) {
  process.stdout.write(JSON.stringify(vars));
} else if (args[0] === 'variable' && args[1] === 'set' && args[2] === 'ADMIN_KEYS' && args.includes('--stdin')) {
  if (process.env.FAKE_RAILWAY_FAIL_SET) process.exit(3);
  vars.ADMIN_KEYS = fs.readFileSync(0, 'utf8');
  fs.writeFileSync(state, JSON.stringify(vars));
} else process.exit(2);
`;

function fakeWorld(adminKeys) {
  const dir = mkdtempSync(join(tmpdir(), 'admin-keys-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'railway'), FAKE_RAILWAY, { mode: 0o755 });
  const state = join(dir, 'vars.json');
  writeFileSync(
    state,
    JSON.stringify({
      JEST_JWS_SECRETS: 'bm90LWEtcmVhbC1zZWNyZXQ=',
      ADMIN_KEYS: JSON.stringify(adminKeys),
    }),
  );
  const home = join(dir, 'home');
  mkdirSync(home);
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ADMIN_CONFIG_DIR: '',
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_RAILWAY_STATE: state,
        ...env,
      },
    });
  const fileFor = (environment) =>
    join(home, '.config', 'foundation-admin', `${environment}-admin.env`);
  return {
    run,
    dir,
    file: fileFor('staging'),
    fileFor,
    keys: () => JSON.parse(JSON.parse(readFileSync(state, 'utf8')).ADMIN_KEYS),
    calls: () =>
      readFileSync(`${state}.calls`, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('issue writes secrets only to the private file and their hashes only to Railway', () => {
  const w = fakeWorld({ 'staging-ops': { secretSha256: hash('a'), scopes: ['read'] } });
  try {
    // Nowhere to write: refused before Railway is asked anything.
    const nowhere = w.run(['issue', '--env', 'staging']);
    assert.equal(nowhere.status, 1);
    assert.match(nowhere.stderr, /no Railway environment: pass --railway-environment/);
    assert.throws(() => w.calls(), /ENOENT/);

    const target = [
      '--railway-environment',
      STAGING_ID,
      '--admin-url',
      'https://admin.example.test',
    ];
    const dry = w.run(['issue', '--env', 'staging', ...target, '--dry-run']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(existsSync(w.file), false);
    assert.deepEqual(Object.keys(w.keys()), ['staging-ops']);

    const r = w.run(['issue', '--env', 'staging', ...target]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(w.file, 'utf8');
    assert.equal(statSync(w.file).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(w.file)).mode & 0o777, 0o700);
    // The target is recorded once, so later runs need no flags.
    assert.match(
      content,
      new RegExp(`\nRAILWAY_ENVIRONMENT_ID=${STAGING_ID}\nADMIN_URL=https://admin.example.test\n`),
    );
    const secrets = Object.fromEntries(
      content
        .split('\n')
        .filter((l) => /^staging-/.test(l))
        .map((l) => l.split('=')),
    );
    const ids = Object.keys(secrets);
    assert.equal(ids.length, 2);
    assert.match(ids[0], /^staging-read-\d{8}$/);
    assert.match(ids[1], /^staging-write-\d{8}$/);
    const keys = w.keys();
    assert.deepEqual(keys['staging-ops'], { secretSha256: hash('a'), scopes: ['read'] });
    assert.deepEqual(keys[ids[0]], {
      secretSha256: sha256Hex(secrets[ids[0]]),
      scopes: READ_SCOPES,
    });
    assert.deepEqual(keys[ids[1]], {
      secretSha256: sha256Hex(secrets[ids[1]]),
      scopes: WRITE_SCOPES,
    });
    for (const [id, secret] of Object.entries(secrets)) {
      assert.ok(r.stdout.includes(id));
      assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), 'secret printed');
      assert.ok(!r.stdout.includes(keys[id].secretSha256), 'hash printed');
    }
    assert.ok(r.stdout.includes(w.file));
    assert.ok(r.stdout.includes('Open https://admin.example.test'));
    const set = w.calls().find((c) => c[0] === 'variable');
    assert.deepEqual(set, [
      'variable',
      'set',
      'ADMIN_KEYS',
      '--stdin',
      '--service',
      'api',
      '--environment',
      STAGING_ID,
      '--skip-deploys',
    ]);

    // Same day again (target from the file): refused, nothing changes.
    const again = w.run(['issue', '--env', 'staging']);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
    assert.equal(readFileSync(w.file, 'utf8'), content);
    // Another environment id than the file's: refused before Railway.
    const before = w.calls().length;
    const other = w.run(['list', '--env', 'staging', '--railway-environment', PRODUCTION_ID]);
    assert.equal(other.status, 1);
    assert.match(other.stderr, /differs from RAILWAY_ENVIRONMENT_ID=/);
    assert.equal(w.calls().length, before);

    // Revoke the read key: gone from Railway and from the file; the settings stay.
    const revoke = w.run(['revoke', '--env', 'staging', '--key-id', ids[0]]);
    assert.equal(revoke.status, 0, revoke.stderr);
    assert.deepEqual(Object.keys(w.keys()), ['staging-ops', ids[1]]);
    const after = readFileSync(w.file, 'utf8');
    assert.deepEqual(envFileKeyIds(after), [ids[1]]);
    assert.ok(after.includes(`RAILWAY_ENVIRONMENT_ID=${STAGING_ID}`));
  } finally {
    w.cleanup();
  }
});

test('a failed Railway update leaves the local file as it was', () => {
  const w = fakeWorld({ 'staging-ops': { secretSha256: hash('a'), scopes: ['read'] } });
  try {
    const target = ['--railway-environment', STAGING_ID];
    const r = w.run(['issue', '--env', 'staging', ...target], { FAKE_RAILWAY_FAIL_SET: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /variable set ADMIN_KEYS failed/);
    assert.equal(existsSync(w.file), false);
    assert.deepEqual(Object.keys(w.keys()), ['staging-ops']);

    mkdirSync(dirname(w.file), { recursive: true });
    writeFileSync(w.file, 'old-key=kept\n', { mode: 0o600 });
    const again = w.run(['issue', '--env', 'staging', ...target, '--suffix', 'b'], {
      FAKE_RAILWAY_FAIL_SET: '1',
    });
    assert.equal(again.status, 1);
    assert.equal(readFileSync(w.file, 'utf8'), 'old-key=kept\n');
  } finally {
    w.cleanup();
  }
});

// A production file written by hand: the target, the admin origin, the CLI's Cloudflare Access
// service token and an ops secret, none of them keys.
const PRODUCTION_FILE = [
  '# production secrets',
  `RAILWAY_ENVIRONMENT_ID=${PRODUCTION_ID}`,
  'RAILWAY_SERVICE=game-api',
  'ADMIN_URL=https://admin.example.test',
  'OPS_SECRET=ops-secret',
  'CF_ACCESS_CLIENT_ID=abc.access',
  'CF_ACCESS_CLIENT_SECRET=cf-secret',
  '',
].join('\n');

test('production keys: refused without --allow-production, then issued, listed and revoked', () => {
  const w = fakeWorld({ 'production-old': { secretSha256: hash('c'), scopes: ['read'] } });
  try {
    const file = w.fileFor('production');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, PRODUCTION_FILE, { mode: 0o600 });

    const refused = w.run(['issue', '--env', 'production']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /--allow-production/);
    assert.equal(readFileSync(file, 'utf8'), PRODUCTION_FILE);
    // Refused before Railway is asked anything.
    assert.throws(() => w.calls(), /ENOENT/);

    const r = w.run(['issue', '--env', 'prod', '--allow-production']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      new RegExp(`Railway production \\(${PRODUCTION_ID}\\), service game-api`),
    );
    assert.ok(r.stdout.includes('Open https://admin.example.test'));
    for (const call of w.calls()) {
      assert.equal(call[call.indexOf('--environment') + 1], PRODUCTION_ID);
      assert.equal(call[call.indexOf('--service') + 1], 'game-api');
    }
    const content = readFileSync(file, 'utf8');
    assert.ok(content.startsWith(PRODUCTION_FILE), 'existing lines kept');
    const ids = envFileKeyIds(content);
    assert.equal(ids.length, 2);
    assert.match(ids[0], /^production-read-\d{8}$/);
    assert.match(ids[1], /^production-write-\d{8}$/);
    assert.deepEqual(Object.keys(w.keys()), ['production-old', ...ids]);
    for (const s of ['ops-secret', 'cf-secret'])
      assert.ok(!r.stdout.includes(s) && !r.stderr.includes(s), `${s} printed`);

    const list = w.run(['list', '--env', 'production', '--allow-production']);
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /\n {2}production-old +read\n/);
    assert.match(list.stdout, /\n {2}production-read-\d{8} +read {3}\(secret in local file\)/);

    const revoke = w.run([
      'revoke',
      '--env',
      'production',
      '--allow-production',
      '--key-id',
      'production-old',
    ]);
    assert.equal(revoke.status, 0, revoke.stderr);
    assert.deepEqual(Object.keys(w.keys()), ids);
    const after = readFileSync(file, 'utf8');
    assert.ok(after.includes('OPS_SECRET=ops-secret'));
    assert.ok(after.includes('CF_ACCESS_CLIENT_SECRET=cf-secret'));
    assert.deepEqual(envFileKeyIds(after), ids);
  } finally {
    w.cleanup();
  }
});

test('ADMIN_CONFIG_DIR moves the key file', () => {
  const w = fakeWorld({ 'staging-ops': { secretSha256: hash('a'), scopes: ['read'] } });
  try {
    const dir = join(w.dir, 'keys');
    const r = w.run(['issue', '--env', 'staging', '--railway-environment', STAGING_ID], {
      ADMIN_CONFIG_DIR: dir,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(envFileKeyIds(readFileSync(join(dir, 'staging-admin.env'), 'utf8')).length, 2);
    assert.equal(existsSync(w.file), false);
  } finally {
    w.cleanup();
  }
});
