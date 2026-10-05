// Shared by the admin CLIs (scripts/admin.mjs, scripts/admin-keys.mjs): environment names, where
// each environment's private key file lives, and the non-secret settings lines in it.
//
// One file per environment, `<dir>/<env>-admin.env`, mode 600. <dir> is ADMIN_CONFIG_DIR when set
// (one folder per game when an operator runs several), else ~/.config/foundation-admin. It holds:
//   # <keyId> scopes=a,b issued=<ISO>       written by admin-keys.mjs, one pair per key
//   <keyId>=<secret>
//   ADMIN_URL=https://admin.example.com      the admin origin admin.mjs talks to
//   CF_ACCESS_CLIENT_ID=… / CF_ACCESS_CLIENT_SECRET=…   only for an origin behind Cloudflare Access
//   RAILWAY_ENVIRONMENT_ID=<uuid> / RAILWAY_SERVICE=api  where admin-keys.mjs keeps ADMIN_KEYS
// Other upper-case lines (OPS_SECRET=, notes) are left alone and never read as keys.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Overrides the key folder. */
export const CONFIG_DIR_VAR = 'ADMIN_CONFIG_DIR';
/** The default key folder, under the home directory. */
export const DEFAULT_CONFIG_DIR = join('.config', 'foundation-admin');

const ENV_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const SETTING = /^([A-Z][A-Z0-9_]*)=(.*)$/;

/** `production` for production/prod; any other lowercase name as is (staging, lab, …). */
export function environmentName(env) {
  if (env === 'production' || env === 'prod') return 'production';
  if (typeof env === 'string' && ENV_NAME.test(env)) return env;
  throw new Error(
    `unknown --env ${JSON.stringify(env)} (a lowercase name such as staging or production)`,
  );
}

/** The environment's key file; `env` and `home` are injectable for tests. */
export function envFilePath(environment, { env = process.env, home = homedir } = {}) {
  const dir = env[CONFIG_DIR_VAR] ? resolve(env[CONFIG_DIR_VAR]) : join(home(), DEFAULT_CONFIG_DIR);
  return join(dir, `${environment}-admin.env`);
}

/** `"v"` or `'v'` → v: hand-written lines may quote their value. */
export const unquote = (v) => v.replace(/^(['"])(.*)\1$/, '$2');

/** The last `NAME=value` line for an upper-case setting, unquoted; undefined when absent. */
export function readSetting(content, name) {
  let value;
  for (const raw of content.split('\n')) {
    const m = SETTING.exec(raw.trim());
    if (m && m[1] === name) value = unquote(m[2].trim());
  }
  return value || undefined;
}

/** https only, except plain http to this machine (a local admin origin such as :8081). */
export function adminOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`admin URL ${JSON.stringify(raw)} is not a URL`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('the admin URL must be https (http only for localhost)');
  return url.origin;
}
