// Admin keys for the admin inspector and scripts/admin.mjs. Raw secrets go only to the private
// local key file (scripts/admin-env.mjs: ~/.config/foundation-admin/<env>-admin.env unless
// ADMIN_CONFIG_DIR names another folder); the API's `ADMIN_KEYS` variable holds only their sha256
// hashes and scopes. Prints key ids, scopes and paths; never a secret or a hash.
//   issue  --env NAME [--dry-run] [--deploy] [--suffix TAG]   a read key and a write key
//   list   --env NAME                                          key ids and scopes on the service
//   revoke --env NAME --key-id ID [--dry-run] [--deploy]       remove one key
// Railway is the supported backend: the script drives a logged-in `railway` CLI, reading and
// setting `ADMIN_KEYS` on the API service. Another host needs its own railwayRead/railwayWrite.
// Where: --railway-environment ID (the environment's id, not its name: an id matches only that
// project's environment, so a CLI linked to another project fails instead of writing there) and
// --service NAME (default api), or RAILWAY_ENVIRONMENT_ID= / RAILWAY_SERVICE= lines in the key
// file. --admin-url URL is the admin origin, for the next steps and scripts/admin.mjs (ADMIN_URL=).
// Flags given for a file without those lines are written into it on issue; a flag that differs
// from the file's line is refused. --env production (or prod) also needs --allow-production.
// Without --deploy Railway does not redeploy the service.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ADMIN_SCOPES } from '../packages/contracts/src/enums.ts';
import { adminOrigin, envFilePath, environmentName, readSetting } from './admin-env.mjs';

/** Read-only key: look up players, timelines, save history, full saves, the audit log. */
export const READ_SCOPES = ['read'];
/** Support's write key: everything support does, never `erase` (issued separately, per request). */
export const WRITE_SCOPES = ['read', 'support', 'grant', 'publish', 'restore'];

/** The service that runs the API, unless --service or RAILWAY_SERVICE= says otherwise. */
export const DEFAULT_SERVICE = 'api';

const KEY_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The environment's name; production (or prod) needs --allow-production. */
export function adminEnvironment(env, allowProduction = false) {
  const environment = environmentName(env);
  if (environment === 'production' && !allowProduction)
    throw new Error('refusing production admin keys without --allow-production');
  return environment;
}

/** `<env>-read-YYYYMMDD[-suffix]` and `<env>-write-…`, dated in UTC. */
export function keyIds(environment, now, suffix = '') {
  if (suffix && !/^[a-z0-9]{1,16}$/.test(suffix))
    throw new Error('--suffix must be 1-16 lowercase letters or digits');
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  const tail = suffix ? `-${suffix}` : '';
  return { read: `${environment}-read-${day}${tail}`, write: `${environment}-write-${day}${tail}` };
}

/** A fresh 32-byte secret (base64url) and the hash the API compares against. */
export function newKey(scopes, random = randomBytes) {
  const secret = random(32).toString('base64url');
  return { secret, entry: { secretSha256: sha256Hex(secret), scopes: [...scopes] } };
}

export function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

/** The value of `ADMIN_KEYS` from `railway variables --json` output, as an object. */
export function adminKeysFromVariables(stdout) {
  let vars;
  try {
    vars = JSON.parse(stdout);
  } catch {
    // Never echo the output: it holds every secret of the service.
    throw new Error('railway variables --json did not print JSON');
  }
  if (!vars || typeof vars !== 'object' || Array.isArray(vars))
    throw new Error('railway variables --json did not print an object');
  return parseAdminKeys(typeof vars.ADMIN_KEYS === 'string' ? vars.ADMIN_KEYS : '{}');
}

/** Validates like the API's config (packages/server/src/config.ts parseAdminKeys). */
export function parseAdminKeys(json) {
  let raw;
  try {
    raw = JSON.parse(json || '{}');
  } catch {
    throw new Error('ADMIN_KEYS on the service is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('ADMIN_KEYS on the service must be an object keyed by key id');
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v?.secretSha256 !== 'string' || !SHA256_HEX.test(v.secretSha256.toLowerCase()))
      throw new Error(`ADMIN_KEYS.${id} has no sha256 secret hash`);
    if (
      !Array.isArray(v.scopes) ||
      !v.scopes.length ||
      !v.scopes.every((s) => ADMIN_SCOPES.includes(s))
    )
      throw new Error(
        `ADMIN_KEYS.${id} scopes must be a non-empty list of ${ADMIN_SCOPES.join('|')}`,
      );
  }
  return raw;
}

/** Existing keys plus new ones; an id already present is refused, never overwritten. */
export function mergeAdminKeys(existing, additions) {
  const merged = { ...existing };
  for (const [id, entry] of Object.entries(additions)) {
    if (!KEY_ID.test(id)) throw new Error(`invalid key id ${JSON.stringify(id)}`);
    if (Object.hasOwn(existing, id)) throw new Error(`key ${id} already exists on the service`);
    merged[id] = entry;
  }
  return merged;
}

/** Keys without `keyId`. The API refuses to boot without a key, so the last one stays. */
export function removeAdminKey(existing, keyId) {
  if (!Object.hasOwn(existing, keyId)) throw new Error(`key ${keyId} is not on the service`);
  const { [keyId]: _gone, ...rest } = existing;
  if (!Object.keys(rest).length)
    throw new Error(`key ${keyId} is the last admin key; issue a new one first`);
  return rest;
}

const FILE_HEADER = (environment) =>
  `# ${environment} admin keys (scripts/admin-keys.mjs). Raw secrets: keep private, never commit.\n` +
  `# Inspector: "Admin key ID" is the name before =, "Admin secret" the value after it.\n`;

/** Key ids that have a secret line in the local file. */
export function envFileKeyIds(content) {
  return content
    .split('\n')
    .map((line) => /^([a-z0-9][a-z0-9._-]*)=/.exec(line)?.[1])
    .filter(Boolean);
}

/** Appends `# id scopes=… issued=…` + `id=secret` per key; existing lines stay as they are. */
export function addToEnvFile(content, environment, keys, issuedAt) {
  const present = new Set(envFileKeyIds(content));
  for (const k of keys)
    if (present.has(k.id)) throw new Error(`key ${k.id} already has a secret in the local file`);
  let out = content || FILE_HEADER(environment);
  if (!out.endsWith('\n')) out += '\n';
  for (const k of keys)
    out += `\n# ${k.id} scopes=${k.scopes.join(',')} issued=${issuedAt}\n${k.id}=${k.secret}\n`;
  return out;
}

/** Drops a key's secret line and the comment line right above it; other lines stay. */
export function removeFromEnvFile(content, keyId) {
  const lines = content.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`${keyId}=`));
  if (at < 0) return content;
  const from = at > 0 && lines[at - 1].startsWith(`# ${keyId} `) ? at - 1 : at;
  lines.splice(from, at - from + 1);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Settings flags against the file's lines (flag wins only where the file is silent). */
const SETTINGS = [
  ['railway-environment', 'RAILWAY_ENVIRONMENT_ID'],
  ['service', 'RAILWAY_SERVICE'],
  ['admin-url', 'ADMIN_URL'],
];

function checkSetting(flag, value) {
  if (flag === 'railway-environment' && !UUID.test(value))
    throw new Error(
      `--railway-environment must be the Railway environment's id (a UUID), not its name`,
    );
  if (flag === 'service' && !SERVICE_NAME.test(value))
    throw new Error(`--service ${JSON.stringify(value)} is not a service name`);
  if (flag === 'admin-url') adminOrigin(value);
}

/**
 * Where this environment's keys live: the flags, else the key file's lines (a flag that differs
 * from a line is refused), and the lines a flag adds to a file that lacks them.
 */
export function resolveTarget(content, flags, file) {
  const values = {};
  const missing = [];
  for (const [flag, name] of SETTINGS) {
    const line = readSetting(content, name);
    const given = flags[flag];
    if (given !== undefined) checkSetting(flag, given);
    if (given !== undefined && line !== undefined && given !== line)
      throw new Error(`--${flag} ${given} differs from ${name}=${line} in ${file}`);
    values[name] = given ?? line;
    if (given !== undefined && line === undefined) missing.push(`${name}=${given}`);
  }
  if (values.RAILWAY_ENVIRONMENT_ID === undefined)
    throw new Error(
      `no Railway environment: pass --railway-environment <id> or add RAILWAY_ENVIRONMENT_ID= to ${file}`,
    );
  if (!UUID.test(values.RAILWAY_ENVIRONMENT_ID))
    throw new Error(`RAILWAY_ENVIRONMENT_ID in ${file} must be the environment's id (a UUID)`);
  if (values.RAILWAY_SERVICE !== undefined && !SERVICE_NAME.test(values.RAILWAY_SERVICE))
    throw new Error(`RAILWAY_SERVICE in ${file} is not a service name`);
  return {
    environmentId: values.RAILWAY_ENVIRONMENT_ID,
    service: values.RAILWAY_SERVICE ?? DEFAULT_SERVICE,
    adminUrl: values.ADMIN_URL,
    newLines: missing,
  };
}

/** The file with the settings lines it lacked, after its header comment. */
export function withSettings(content, environment, lines) {
  if (!lines.length) return content;
  const base = content || FILE_HEADER(environment);
  return `${base}${base.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`;
}

function readFileOr(path, fallback) {
  return existsSync(path) ? readFileSync(path, 'utf8') : fallback;
}

/** Mode 600 in a mode-700 folder, replaced atomically. */
function writePrivate(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

function railway(label, args, input) {
  const r = spawnSync('railway', args, {
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error) throw new Error(`railway CLI not runnable: ${r.error.code ?? 'error'}`);
  // Never echo stdout or the error object: variables output holds every secret of the service.
  if (r.status !== 0) throw new Error(`railway ${label} failed (exit ${r.status})`);
  return r.stdout;
}

/** `variables --json` for the service of that environment, by id. */
export function readVariablesArgs({ environmentId, service }) {
  return ['variables', '--service', service, '--environment', environmentId, '--json'];
}

/** `variable set ADMIN_KEYS --stdin` on the service of that environment, by id. */
export function writeKeysArgs({ environmentId, service }, deploy) {
  return [
    'variable',
    'set',
    'ADMIN_KEYS',
    '--stdin',
    '--service',
    service,
    '--environment',
    environmentId,
    ...(deploy ? [] : ['--skip-deploys']),
  ];
}

function railwayRead(target) {
  return adminKeysFromVariables(railway('variables', readVariablesArgs(target)));
}

function railwayWrite(target, keys, deploy) {
  railway('variable set ADMIN_KEYS', writeKeysArgs(target, deploy), JSON.stringify(keys));
}

function deployStep(environment, { service }, deploy) {
  return deploy
    ? `Railway redeploys ${service} (${environment}) with the new keys; wait for it to finish.`
    : `Redeploy ${service} (${environment}) so it loads them: Railway → ${environment} → ${service} → Deploy, or re-run with --deploy next time.`;
}

function usage() {
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  return lines
    .slice(
      0,
      lines.findIndex((line) => !line.startsWith('//')),
    )
    .map((line) => line.replace(/^\/\/ ?/, ''))
    .join('\n');
}

async function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      env: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      deploy: { type: 'boolean', default: false },
      suffix: { type: 'string', default: '' },
      'key-id': { type: 'string' },
      'allow-production': { type: 'boolean', default: false },
      'railway-environment': { type: 'string' },
      service: { type: 'string' },
      'admin-url': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const command = positionals[0];
  if (o.help) {
    console.log(usage());
    return;
  }
  if (!['issue', 'list', 'revoke'].includes(command ?? '')) throw new Error(`usage:\n${usage()}`);
  if (!o.env) throw new Error('--env is required (staging, production, …)');
  const environment = adminEnvironment(o.env, o['allow-production']);
  const file = envFilePath(environment);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const target = resolveTarget(before ?? '', o, file);
  const { service } = target;
  console.log(
    `Railway ${environment} (${target.environmentId}), service ${service}; local file ${file}`,
  );
  const current = railwayRead(target);

  if (command === 'list') {
    const local = new Set(envFileKeyIds(before ?? ''));
    console.log(`ADMIN_KEYS on ${service} (${environment}):`);
    for (const [id, v] of Object.entries(current))
      console.log(
        `  ${id.padEnd(32)} ${v.scopes.join(', ')}${local.has(id) ? '   (secret in local file)' : ''}`,
      );
    console.log(`Local secrets: ${file}`);
    return;
  }

  if (command === 'revoke') {
    const keyId = o['key-id'];
    if (!keyId) throw new Error('revoke needs --key-id');
    const next = removeAdminKey(current, keyId);
    if (o['dry-run']) {
      console.log(
        `Dry run: would remove ${keyId} from ADMIN_KEYS on ${service} (${environment}) and from ${file}.`,
      );
      return;
    }
    railwayWrite(target, next, o.deploy);
    if (Object.hasOwn(railwayRead(target), keyId))
      throw new Error(`Railway still lists ${keyId}; check the service's variables`);
    const content = readFileOr(file, '');
    if (envFileKeyIds(content).includes(keyId))
      writePrivate(file, removeFromEnvFile(content, keyId));
    console.log(
      `Revoked ${keyId} on ${service} (${environment}); its secret line is gone from ${file}.`,
    );
    console.log(
      `Next: ${deployStep(environment, target, o.deploy)}${o.deploy ? '' : ' Until then the running API still accepts it.'}`,
    );
    return;
  }

  // issue
  // The operator's wall clock only dates key ids and the file's comments (no game state).
  // eslint-disable-next-line no-restricted-syntax
  const now = new Date();
  const ids = keyIds(environment, now, o.suffix);
  const read = { id: ids.read, scopes: READ_SCOPES, ...newKey(READ_SCOPES) };
  const write = { id: ids.write, scopes: WRITE_SCOPES, ...newKey(WRITE_SCOPES) };
  const next = mergeAdminKeys(current, { [read.id]: read.entry, [write.id]: write.entry });
  const content = addToEnvFile(
    withSettings(before ?? '', environment, target.newLines),
    environment,
    [read, write],
    now.toISOString(),
  );
  const summary = () => {
    for (const k of [read, write]) console.log(`  ${k.id.padEnd(32)} ${k.scopes.join(', ')}`);
  };
  if (o['dry-run']) {
    console.log(
      `Dry run: would add to ADMIN_KEYS on ${service} (${environment}), keeping ${Object.keys(current).length} existing key(s):`,
    );
    summary();
    console.log(`and write their secrets to ${file} (mode 600). Nothing changed.`);
    return;
  }
  // Secrets land on disk before the service learns their hashes; a failed set restores the file.
  writePrivate(file, content);
  try {
    railwayWrite(target, next, o.deploy);
  } catch (error) {
    if (before === null) rmSync(file, { force: true });
    else writePrivate(file, before);
    throw error;
  }
  const after = railwayRead(target);
  for (const k of [read, write])
    if (after[k.id]?.secretSha256 !== k.entry.secretSha256)
      throw new Error(
        `Railway does not list ${k.id} after the update; check the service's variables`,
      );
  console.log(
    `Issued ${environment} admin keys (ADMIN_KEYS on ${service} now holds ${Object.keys(after).length}):`,
  );
  summary();
  console.log(`Secrets: ${file} (mode 600). Never paste them into chat, tickets or commits.`);
  if (target.newLines.length)
    console.log(`Recorded in it: ${target.newLines.map((l) => l.split('=')[0]).join(', ')}.`);
  console.log('Next:');
  console.log(`  1. ${deployStep(environment, target, o.deploy)}`);
  console.log(
    `  2. Open ${target.adminUrl ?? `the ${environment} admin origin (add ADMIN_URL= to the file, or --admin-url, for scripts/admin.mjs)`}, enter a key id and its secret from the file.`,
  );
  console.log(
    `  3. Give the read key to whoever looks players up; the write key only to people who restore, grant or publish.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`admin-keys: ${error.message}`);
    process.exit(1);
  }
}
