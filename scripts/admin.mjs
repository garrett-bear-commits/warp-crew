// Admin CLI: support work from a terminal over the game's admin API, without the inspector page.
// Keys come from the environment's key file (scripts/admin-env.mjs: ~/.config/foundation-admin/
// <env>-admin.env unless ADMIN_CONFIG_DIR names another folder; issued by scripts/admin-keys.mjs)
// and never print.
//   player   <playerKey>                                  profile, generation, quarantine, flags
//   timeline <playerKey> [--limit N] [--generation G]     save history, newest first
//   events   <playerKey> [--limit N]                      saves, purchases, grants, integrity events
//   save     <playerKey> <seq> [--full]                   one save's summary; --full: the save JSON
//   audit    [--player P] [--limit N]                     admin actions, newest first
//   restore  <playerKey> --seq N --expected-generation G --reason R             (--write)
//   letter   <playerKey> --title T --body B --reason R [--grant-key K] [--ticket T]   (--write)
//   grant    <playerKey> --grant-key K <reward flags>… --reason R [--ticket T] [--title T]
//            [--body B] [--expires-at MS|ISO]                                    (--write)
//            the reward flags are the game's grant vocabulary (listed below) and combine;
//            --rewards JSON instead of them (advanced); lands on the player's next start
//   adjust   <playerKey> --kind make_good|refund|correction --delta N --reason R
//            [--transaction-id T] [--ticket T]                                   (--write)
//            fixes a purchase in the premium currency: + credits paid currency, - removes it
//            (--delta=-300); a refund adds a strike (the 3rd disables checkout); T: the
//            purchase's ref in events
// Common: --env NAME (default staging; prod means production), --url URL, --json, --write (the
// write key; writes need it), --yes (run a write after its plan; without it nothing changes),
// --command-id UUID (retry a write idempotently), --allow-production (production writes). Exit 0
// ok, 1 the request failed, 2 usage or refused.
// The admin origin is --url, else $ADMIN_URL, else the key file's ADMIN_URL= line. An origin
// behind Cloudflare Access also needs the CLI's Access service token in the key file
// (CF_ACCESS_CLIENT_ID= and CF_ACCESS_CLIENT_SECRET=), sent on every request.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { adminOrigin as checkOrigin, envFilePath, environmentName, unquote } from './admin-env.mjs';
import {
  grantContentsText,
  pluralOf,
  readGrant,
  rewardOf,
} from '../apps/server/games/grant-vocabulary.ts';
// The game's grant vocabulary: `grant`'s reward flags and the premium currency's name in
// `adjust`. A game points this one import at its own apps/server/games/<id>/grants.ts.
// Erasable TypeScript, loaded by Node 24's type stripping.
import { templateGrants as GAME_GRANTS } from '../apps/server/games/template/grants.ts';

/** Usage or a refusal: exit 2, nothing was sent that changes state. */
export class UsageError extends Error {}
/** The admin API (or the network) failed: exit 1. */
export class RequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    Object.assign(this, details);
  }
}

const KEY_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;

/** Commands, their positionals, options, and the scope a write needs. */
const COMMANDS = {
  player: { args: ['playerKey'], options: [] },
  timeline: { args: ['playerKey'], options: ['limit', 'generation'] },
  events: { args: ['playerKey'], options: ['limit'] },
  save: { args: ['playerKey', 'seq'], options: ['full'] },
  audit: { args: [], options: ['player', 'limit'] },
  restore: {
    args: ['playerKey'],
    options: ['seq', 'expected-generation', 'reason'],
    scope: 'restore',
  },
  letter: {
    args: ['playerKey'],
    options: ['title', 'body', 'reason', 'grant-key', 'ticket'],
    scope: 'support',
  },
  // Plus one flag per grant vocabulary field (grantFlags).
  grant: {
    args: ['playerKey'],
    options: ['grant-key', 'rewards', 'reason', 'ticket', 'title', 'body', 'expires-at'],
    scope: 'grant',
  },
  adjust: {
    args: ['playerKey'],
    options: ['kind', 'delta', 'reason', 'transaction-id', 'ticket'],
    scope: 'grant',
  },
};
const COMMON_OPTIONS = ['env', 'url', 'json', 'write', 'yes', 'allow-production', 'command-id'];
const WRITE_ONLY_OPTIONS = ['yes', 'allow-production', 'command-id'];

const OPTION_SPEC = {
  env: { type: 'string', default: 'staging' },
  url: { type: 'string' },
  json: { type: 'boolean', default: false },
  write: { type: 'boolean', default: false },
  yes: { type: 'boolean', default: false },
  'allow-production': { type: 'boolean', default: false },
  'command-id': { type: 'string' },
  limit: { type: 'string' },
  generation: { type: 'string' },
  full: { type: 'boolean', default: false },
  player: { type: 'string' },
  seq: { type: 'string' },
  'expected-generation': { type: 'string' },
  reason: { type: 'string' },
  title: { type: 'string' },
  body: { type: 'string' },
  'grant-key': { type: 'string' },
  ticket: { type: 'string' },
  rewards: { type: 'string' },
  'expires-at': { type: 'string' },
  kind: { type: 'string' },
  delta: { type: 'string' },
  'transaction-id': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
};

const FLAG_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The vocabulary's fields as `grant` flags: an amount field is a total given once (`--gems N`),
 * a choice field one pick per flag (`--contract premium`, repeatable). A field named like one of
 * the CLI's own options is a mistake in the vocabulary, not the operator's.
 */
export function grantFlags(grants) {
  const spec = {};
  for (const field of grants.fields) {
    if (!FLAG_NAME.test(field.name) || Object.hasOwn(OPTION_SPEC, field.name))
      throw new Error(
        `grant vocabulary field ${JSON.stringify(field.name)} cannot be a flag: use lowercase letters, digits and dashes, and no name the CLI already takes (${Object.keys(OPTION_SPEC).join(', ')})`,
      );
    if (Object.hasOwn(spec, field.name))
      throw new Error(`grant vocabulary field ${field.name} is declared twice`);
    // Multiple even for totals, only so that a repeat is refused instead of silently replaced.
    spec[field.name] = { type: 'string', multiple: true };
  }
  return spec;
}

const num = (v) => v.toLocaleString('en-US');
const lower = (field) => pluralOf(field).toLowerCase();
const flagUsage = (field) =>
  field.kind === 'amount' ? `--${field.name} N` : `--${field.name} ${choices(field)}`;
const choices = (field) => field.options.map((o) => o.value).join('|');

/** The header comment, then the reward flags of this game's grant vocabulary. */
export function usage(grants = GAME_GRANTS) {
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const header = lines
    .slice(
      0,
      lines.findIndex((line) => !line.startsWith('//')),
    )
    .map((line) => line.replace(/^\/\/ ?/, ''));
  const flags = grants.fields.map((field) => [
    flagUsage(field),
    field.kind === 'amount'
      ? `${pluralOf(field)}${field.note ? ` (${field.note})` : ''}: a total from 1 to ${num(field.max)}`
      : `one ${field.label} per flag, up to ${field.max}`,
  ]);
  const width = Math.max(0, ...flags.map(([f]) => f.length));
  return [
    ...header,
    `grant reward flags (the game's grant vocabulary; premium currency: ${grants.premiumName}):`,
    ...flags.map(([f, what]) => `  ${f.padEnd(width)}  ${what}`),
  ].join('\n');
}

/** A usage problem from the shared helpers (plain Errors) as a UsageError. */
function usageFrom(fn) {
  try {
    return fn();
  } catch (error) {
    throw new UsageError(error.message);
  }
}

/**
 * The local key file: `<keyId>=<secret>` lines, each after a `# <keyId> scopes=a,b issued=…`
 * comment (scripts/admin-keys.mjs), plus optional `ADMIN_URL=` and Cloudflare Access service
 * token (`CF_ACCESS_CLIENT_ID=`, `CF_ACCESS_CLIENT_SECRET=`) lines. Other upper-case lines
 * (`OPS_SECRET=`, `RAILWAY_ENVIRONMENT_ID=`, …) are not keys.
 */
export function parseEnvFile(content) {
  const scopes = new Map();
  const keys = [];
  const access = {};
  let url;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = /^#\s*([a-z0-9][a-z0-9._-]*)\s+scopes=([a-z,]+)/.exec(line);
      if (m) scopes.set(m[1], m[2].split(',').filter(Boolean));
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (name === 'ADMIN_URL') url = unquote(value);
    else if (name === 'CF_ACCESS_CLIENT_ID') access.clientId = unquote(value);
    else if (name === 'CF_ACCESS_CLIENT_SECRET') access.clientSecret = unquote(value);
    else if (KEY_ID.test(name) && value) keys.push({ id: name, secret: value });
  }
  return {
    url,
    access: access.clientId || access.clientSecret ? access : null,
    keys: keys.map((k) => ({ ...k, scopes: scopes.get(k.id) ?? null })),
  };
}

/**
 * The read key (scopes exactly `read`), or with `write` a key holding `scope`. Without a scopes
 * comment the id decides (`-read-` / `-write-`). The last match in the file is the newest issue.
 */
export function pickKey(keys, { write = false, scope = 'read' } = {}) {
  const fits = write
    ? (k) => (k.scopes ? k.scopes.includes(scope) && k.scopes.length > 1 : /-write-/.test(k.id))
    : (k) => (k.scopes ? k.scopes.length === 1 && k.scopes[0] === 'read' : /-read-/.test(k.id));
  return keys.filter(fits).at(-1) ?? null;
}

/** https only, except plain http to this machine (a local admin origin such as :8081). */
export function adminOrigin(raw) {
  return usageFrom(() => checkOrigin(raw));
}

/**
 * Key, URL, Access service token and environment for one invocation; production writes need
 * --allow-production.
 */
export function resolveConfig(o, command, io) {
  const environment = usageFrom(() => environmentName(o.env));
  const spec = COMMANDS[command];
  if (spec.scope && environment === 'production' && !o['allow-production'])
    throw new UsageError('refusing a production write without --allow-production');
  const file = envFilePath(environment, { env: io.env, home: io.homedir });
  const issue = `issue keys with: node scripts/admin-keys.mjs issue --env ${environment}${environment === 'production' ? ' --allow-production' : ''}`;
  let content;
  try {
    content = io.readFile(file);
  } catch {
    throw new UsageError(`no key file ${file}; ${issue}`);
  }
  const parsed = parseEnvFile(content);
  const key = pickKey(parsed.keys, { write: o.write, scope: spec.scope ?? 'read' });
  if (!key)
    throw new UsageError(
      o.write
        ? `no write key with scope ${spec.scope ?? 'read'} in ${file}; ${issue}`
        : `no read key in ${file}; ${issue}`,
    );
  const url = o.url ?? (io.env.ADMIN_URL || parsed.url);
  if (!url)
    throw new UsageError(
      `no admin URL for ${environment}: add an ADMIN_URL= line to ${file}, set ADMIN_URL, or pass --url`,
    );
  const access = parsed.access;
  if (access && (!access.clientId || !access.clientSecret))
    throw new UsageError(
      `${file} needs both CF_ACCESS_CLIENT_ID= and CF_ACCESS_CLIENT_SECRET= (a Cloudflare Access service token), or neither`,
    );
  return { environment, origin: adminOrigin(url), key, access };
}

/**
 * The admin API never redirects and answers in its JSON envelope; a redirect (to a login page) or
 * a bare 401/403 comes from an access gateway in front of the origin, such as Cloudflare Access.
 */
const ACCESS_HINT =
  'An access gateway (Cloudflare Access) did not let the request through: add or check CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET in the key file, and that the Access policy allows that service token';

/** GET/POST against the admin API; the error envelope's code, message and id on failure. */
export function adminApi({ origin, key, access = null }, io) {
  return async function call(method, path, body) {
    const headers = {
      accept: 'application/json',
      'x-admin-key-id': key.id,
      'x-admin-secret': key.secret,
    };
    // Access checks these at the edge and hands the API its own signed token instead.
    if (access) {
      headers['cf-access-client-id'] = access.clientId;
      headers['cf-access-client-secret'] = access.clientSecret;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await io.fetch(`${origin}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new RequestError(`${method} ${path}: network error (${error?.message ?? error})`, {
        status: 0,
      });
    }
    // Never followed: the admin API does not redirect, a gateway's login page does.
    if (res.status >= 300 && res.status < 400) {
      let to = 'elsewhere';
      try {
        to = new URL(res.headers.get('location') ?? '', origin).origin;
      } catch {
        // an unreadable Location says nothing more
      }
      throw new RequestError(
        `${method} ${path}: HTTP ${res.status} redirect to ${to}. ${ACCESS_HINT}`,
        { status: res.status },
      );
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) {
      if (json === null) throw new RequestError(`${method} ${path}: HTTP ${res.status}, not JSON`);
      return json;
    }
    const code = json?.error ?? 'error';
    // A 401/403 that is not the API's envelope came from the gateway at the edge.
    if (json === null && (res.status === 401 || res.status === 403))
      throw new RequestError(`${method} ${path}: HTTP ${res.status} ${code}. ${ACCESS_HINT}`, {
        status: res.status,
      });
    const message = json?.message ? `: ${json.message}` : '';
    const id = json?.correlationId ? ` [${json.correlationId}]` : '';
    // Which field failed validation, the generation a 409 saw: worth a line, bounded.
    const details =
      json?.details !== undefined ? `\ndetails ${JSON.stringify(json.details).slice(0, 600)}` : '';
    throw new RequestError(
      `${method} ${path}: HTTP ${res.status} ${code}${message}${id}${details}`,
      {
        status: res.status,
        error: json && typeof json === 'object' ? json : null,
      },
    );
  };
}

// ─── Formatting ───────────────────────────────────────────────────

export function fmtTime(ms) {
  return typeof ms === 'number' ? new Date(ms).toISOString().replace('.000Z', 'Z') : '-';
}

function table(rows, columns) {
  const cells = rows.map((r) => columns.map(([, cell]) => String(cell(r) ?? '')));
  const widths = columns.map(([h], i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) =>
    c
      .map((v, i) => (i === c.length - 1 ? v : v.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [line(columns.map(([h]) => h)), ...cells.map(line)].join('\n');
}

function pairs(list) {
  const width = Math.max(...list.map(([k]) => k.length));
  return list.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join('\n');
}

const stripMeta = ({ serverNow: _n, requestId: _r, ...rest }) => rest;

function snapshotLine(s) {
  return `seq ${s.seq} · gen ${s.generation} · progress ${s.progress} · ${s.disposition}`;
}

function playerPairs(p) {
  const flags = p.flags.length
    ? p.flags
        .map((f) => `${f.flag}${f.until ? ` until ${fmtTime(f.until)}` : ''} (${f.reason})`)
        .join('; ')
    : 'none';
  return [
    ['player', p.playerKey],
    ['registered', p.registered ? 'yes' : 'no'],
    ['erased', p.erased ? 'yes' : 'no'],
    ['first seen', fmtTime(p.firstSeenAt)],
    ['last seen', fmtTime(p.lastSeenAt)],
    ['last build', p.lastBuildVersion ?? '-'],
    ['generation', `${p.generation} (${p.generationKind})`],
    [
      'anchor',
      p.anchor ? `${snapshotLine(p.anchor)} · saved ${fmtTime(p.anchor.savedAt)}` : 'none',
    ],
    [
      'pending quarantine',
      p.pendingQuarantine
        ? `${snapshotLine(p.pendingQuarantine)} · flags ${p.pendingQuarantine.flags.join(',') || '-'}`
        : 'none',
    ],
    ['flags', flags],
    ['entitlement', p.entitlement],
    ['paid purchases', p.paidCount],
    ['strikes', p.strikes],
    ['unclaimed grants', p.grantsPending],
  ];
}

// ─── Argument checks ──────────────────────────────────────────────

function int(o, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = o[name];
  const n = Number(raw);
  if (raw === undefined || !/^\d+$/.test(raw) || n < min || n > max)
    throw new UsageError(`--${name} must be an integer from ${min} to ${max}`);
  return n;
}

function text(o, name, max, required = true) {
  const v = o[name];
  if (v === undefined || !v.trim()) {
    if (required) throw new UsageError(`--${name} is required`);
    return undefined;
  }
  if (v.length > max) throw new UsageError(`--${name} is longer than ${max} characters`);
  return v;
}

function playerKeyArg(v) {
  if (!v || v.length > 128) throw new UsageError('a player key (1-128 characters) is required');
  return v;
}

/** One amount field's total: a whole number from 1 to the field's max, given once. */
function rewardAmount(o, field) {
  const values = o[field.name];
  if (values === undefined) return undefined;
  if (values.length > 1) throw new UsageError(`--${field.name} is a total: give it once`);
  return int({ [field.name]: values[0] }, field.name, { min: 1, max: field.max });
}

/** The rewards JSON for the reward flags, in vocabulary order; picks of one option combine. */
function rewardsFromFlags(o, grants) {
  const rewards = [];
  for (const field of grants.fields) {
    if (field.kind === 'amount') {
      const amount = rewardAmount(o, field);
      if (amount !== undefined) rewards.push(rewardOf(field.reward, amount));
      continue;
    }
    const picks = new Map();
    for (const value of o[field.name] ?? []) {
      const option = field.options.find((x) => x.value === value);
      if (!option)
        throw new UsageError(
          `--${field.name} ${JSON.stringify(value)}: one of ${field.options.map((x) => x.value).join(', ')}`,
        );
      picks.set(option, (picks.get(option) ?? 0) + 1);
    }
    for (const [option, qty] of picks) rewards.push(rewardOf(option.reward, qty));
  }
  return rewards;
}

/** `a, b and c`. */
const listed = (items) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? '');

/** A one-reward `--rewards` example in the game's own vocabulary. */
function rewardsExample(grants) {
  const field = grants.fields[0];
  if (!field) return '[]';
  const reward =
    field.kind === 'amount' ? rewardOf(field.reward, 50) : rewardOf(field.options[0].reward, 1);
  return JSON.stringify([reward]);
}

/** The reward flags or --rewards JSON, read as the game reads them (the server refuses the rest). */
function grantRewards(o, grants) {
  const flags = grants.fields
    .filter((field) => o[field.name] !== undefined)
    .map((field) => `--${field.name}`);
  let rewards;
  if (o.rewards !== undefined) {
    if (flags.length)
      throw new UsageError(`--rewards replaces the reward flags: drop ${flags.join(', ')} or it`);
    try {
      rewards = JSON.parse(o.rewards);
    } catch {
      throw new UsageError(`--rewards must be JSON, e.g. '${rewardsExample(grants)}'`);
    }
  } else if (flags.length) rewards = rewardsFromFlags(o, grants);
  else
    throw new UsageError(
      `grant needs rewards: ${grants.fields.map(flagUsage).join(', ')} (or --rewards JSON)`,
    );
  const read = readGrant(grants, rewards);
  if (!read.ok)
    throw new UsageError(
      `${o.rewards !== undefined ? '--rewards' : 'rewards'} refused: ${read.problem} (the game takes ${listed(grants.fields.map(lower))})`,
    );
  return { rewards, contents: read.contents };
}

function parseExpiresAt(raw) {
  if (raw === undefined) return undefined;
  const ms = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isSafeInteger(ms) || ms < 0)
    throw new UsageError('--expires-at must be epoch milliseconds or an ISO date');
  return ms;
}

// ─── Commands ─────────────────────────────────────────────────────

const enc = encodeURIComponent;

async function player(call, [pk]) {
  const p = await call('GET', `/admin/v1/players/${enc(pk)}`);
  return { json: stripMeta(p), text: pairs(playerPairs(p)) };
}

async function timeline(call, [pk], o) {
  const limit = o.limit === undefined ? 20 : int(o, 'limit', { min: 1, max: 200 });
  const q = new URLSearchParams({ limit: String(limit) });
  if (o.generation !== undefined) q.set('generation', String(int(o, 'generation')));
  const r = await call('GET', `/admin/v1/players/${enc(pk)}/saves?${q}`);
  const rows = r.items;
  return {
    json: stripMeta(r),
    text: rows.length
      ? table(rows, [
          ['seq', (s) => s.seq],
          ['gen', (s) => s.generation],
          ['disposition', (s) => s.disposition],
          ['progress', (s) => s.progress],
          ['savedAt', (s) => fmtTime(s.savedAt)],
          ['blob', (s) => (s.hasBlob ? 'yes' : 'pruned')],
          ['flags', (s) => s.flags.join(',')],
        ])
      : 'No saves.',
  };
}

async function events(call, [pk], o) {
  const limit = o.limit === undefined ? 50 : int(o, 'limit', { min: 1, max: 500 });
  const r = await call('GET', `/admin/v1/players/${enc(pk)}/timeline`);
  const items = r.items.slice(0, limit);
  return {
    json: { playerKey: r.playerKey, items },
    text: items.length
      ? table(items, [
          ['at', (i) => fmtTime(i.at)],
          ['kind', (i) => i.kind],
          ['ref', (i) => i.ref],
          ['summary', (i) => i.summary],
        ])
      : 'No timeline items.',
  };
}

function decodeSave(r) {
  try {
    if (r.enc === 'json') return JSON.parse(r.blob);
    if (r.enc === 'gzip+b64')
      return JSON.parse(gunzipSync(Buffer.from(r.blob, 'base64')).toString());
  } catch (error) {
    throw new RequestError(`save seq ${r.seq} is not decodable JSON (${error.message})`);
  }
  throw new RequestError(`save seq ${r.seq} has unknown encoding ${r.enc}`);
}

/** The save's metadata: history is newest first, so the first row below seq + 1 is seq. */
async function snapshotMeta(call, pk, seq) {
  const r = await call('GET', `/admin/v1/players/${enc(pk)}/saves?beforeSeq=${seq + 1}&limit=1`);
  const meta = r.items[0];
  return meta?.seq === seq ? meta : null;
}

async function save(call, [pk, rawSeq], o) {
  if (!/^\d+$/.test(rawSeq ?? '')) throw new UsageError('save needs <playerKey> <seq>');
  const seq = Number(rawSeq);
  if (o.full) {
    const blob = await call('GET', `/admin/v1/players/${enc(pk)}/saves/${seq}/blob`);
    const decoded = decodeSave(blob);
    return { json: decoded, text: JSON.stringify(decoded, null, 2) };
  }
  const meta = await snapshotMeta(call, pk, seq);
  if (!meta) throw new RequestError(`player ${pk} has no save seq ${seq}`, { status: 404 });
  const summary = Object.entries(meta.summary ?? {});
  return {
    json: meta,
    text: [
      pairs([
        ['seq', meta.seq],
        ['generation', meta.generation],
        ['disposition', `${meta.disposition}${meta.rejectReason ? ` (${meta.rejectReason})` : ''}`],
        ['progress', meta.progress],
        ['reason', meta.reason],
        ['savedAt', fmtTime(meta.savedAt)],
        ['receivedAt', fmtTime(meta.receivedAt)],
        ['build', `${meta.buildVersion} · schema ${meta.schemaVersion}`],
        ['flags', meta.flags.join(',') || 'none'],
        ['bytes', `${meta.bytes} (${meta.encBytes} encoded)`],
        ['blob', meta.hasBlob ? `sha256 ${meta.blobSha256}` : 'pruned'],
        ['review', meta.review ? `${meta.review.action} ${fmtTime(meta.review.at)}` : 'none'],
      ]),
      summary.length
        ? `summary\n${pairs(summary.map(([k, v]) => [`  ${k}`, v]))}`
        : 'summary  none',
    ].join('\n'),
  };
}

async function audit(call, _args, o) {
  const limit = o.limit === undefined ? 20 : int(o, 'limit', { min: 1, max: 500 });
  const r = await call('GET', '/admin/v1/actions');
  const items = r.items.filter((a) => o.player === undefined || a.target === o.player);
  const shown = items.slice(0, limit);
  return {
    json: { items: shown },
    text: shown.length
      ? table(shown, [
          ['id', (a) => a.id],
          ['at', (a) => fmtTime(a.at)],
          ['key', (a) => a.adminKeyId],
          ['command', (a) => a.commandType],
          ['target', (a) => a.target ?? ''],
          ['outcome', (a) => a.outcome],
          ['reason', (a) => a.reason ?? ''],
        ])
      : 'No admin actions.',
  };
}

/** The player must exist; a write to a mistyped key would reach nobody. */
async function knownPlayer(call, pk) {
  const p = await call('GET', `/admin/v1/players/${enc(pk)}`);
  if (p.firstSeenAt === undefined) throw new UsageError(`player ${pk} is unknown (never seen)`);
  if (p.erased) throw new UsageError(`player ${pk} is erased`);
  return p;
}

async function planRestore(call, [pk], o) {
  const seq = int(o, 'seq');
  const expectedGeneration = int(o, 'expected-generation');
  const reason = text(o, 'reason', 512);
  const p = await knownPlayer(call, pk);
  const target = await snapshotMeta(call, pk, seq);
  if (!target) throw new UsageError(`player ${pk} has no save seq ${seq}`);
  if (p.generation !== expectedGeneration)
    throw new UsageError(
      `stale --expected-generation ${expectedGeneration}: ${pk} is on generation ${p.generation} now`,
    );
  if (!target.hasBlob) throw new UsageError(`save seq ${seq} is pruned; it cannot seed a restore`);
  return {
    path: '/admin/v1/players/restore',
    body: { playerKey: pk, seq, expectedGeneration, reason },
    plan: {
      action: 'restore',
      playerKey: pk,
      currentGeneration: p.generation,
      currentKind: p.generationKind,
      anchorSeq: p.anchor?.seq ?? null,
      target: {
        seq: target.seq,
        generation: target.generation,
        progress: target.progress,
        disposition: target.disposition,
        savedAt: target.savedAt,
      },
      reason,
    },
    text: [
      `Restore ${pk}`,
      `  now        generation ${p.generation} (${p.generationKind}), anchor ${p.anchor ? snapshotLine(p.anchor) : 'none'}`,
      `  target     ${snapshotLine(target)} · saved ${fmtTime(target.savedAt)}`,
      `  effect     opens generation ${p.generation + 1} (admin_restore) seeded from seq ${seq}; generation ${p.generation} is kept.`,
      '             A running game adopts it on its next save push, any other on its next start.',
      `  reason     ${reason}`,
    ].join('\n'),
  };
}

async function planLetter(call, [pk], o) {
  const body = {
    playerKey: pk,
    title: text(o, 'title', 200),
    body: text(o, 'body', 4000),
    reason: text(o, 'reason', 512),
  };
  const grantKey = text(o, 'grant-key', 200, false);
  const ticketRef = text(o, 'ticket', 128, false);
  if (grantKey) body.grantKey = grantKey;
  if (ticketRef) body.ticketRef = ticketRef;
  const p = await knownPlayer(call, pk);
  return {
    path: '/admin/v1/letters',
    body,
    plan: { action: 'letter', ...body, lastSeenAt: p.lastSeenAt },
    text: [
      `Send a letter to ${pk} (last seen ${fmtTime(p.lastSeenAt)})`,
      `  title      ${body.title}`,
      `  body       ${body.body.replace(/\n/g, '\n             ')}`,
      ...(grantKey ? [`  grant key  ${grantKey}`] : []),
      ...(ticketRef ? [`  ticket     ${ticketRef}`] : []),
      `  reason     ${body.reason}`,
    ].join('\n'),
  };
}

async function planGrant(call, [pk], o, grants) {
  const grantKey = text(o, 'grant-key', 200);
  const { rewards, contents } = grantRewards(o, grants);
  const body = { playerKey: pk, grantKey, rewards, reason: text(o, 'reason', 512) };
  const optional = {
    ticketRef: text(o, 'ticket', 128, false),
    title: text(o, 'title', 200, false),
    body: text(o, 'body', 2000, false),
    expiresAt: parseExpiresAt(o['expires-at']),
  };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) body[k] = v;
  const p = await knownPlayer(call, pk);
  const frozen = p.flags.some((f) => f.flag === 'grants_frozen');
  return {
    path: '/admin/v1/grants',
    body,
    plan: { action: 'grant', ...body, grantsPending: p.grantsPending, grantsFrozen: frozen },
    text: [
      `Grant to ${pk} (last seen ${fmtTime(p.lastSeenAt)}, ${p.grantsPending} unclaimed grant(s))`,
      `  grant key  ${body.grantKey} (once per key: a reused key is a duplicate, not a second grant)`,
      `  rewards    ${grantContentsText(grants, contents)}`,
      "  lands      in the game on the player's next start",
      ...(body.title ? [`  title      ${body.title}`] : []),
      ...(body.expiresAt !== undefined ? [`  expires    ${fmtTime(body.expiresAt)}`] : []),
      ...(body.ticketRef ? [`  ticket     ${body.ticketRef}`] : []),
      `  reason     ${body.reason}`,
      ...(frozen
        ? ['  warning    grants_frozen is set: the player cannot claim it until cleared']
        : []),
    ].join('\n'),
  };
}

const ADJUST_KINDS = { make_good: 'make good', refund: 'refund', correction: 'correction' };
const DELTA_MAX = 1_000_000;
/** The server's refund strikes that set purchases_disabled (checkout off). */
const STRIKES_TO_DISABLE = 3;
/** The admin timeline returns at most this many newest rows. */
const TIMELINE_ROWS = 500;

/** A non-zero integer whose sign fits the kind: make_good credits, refund removes. */
function adjustDelta(o, kind, premium) {
  const raw = o.delta;
  const n = Number(raw);
  if (raw === undefined || !/^[+-]?\d+$/.test(raw) || n === 0 || Math.abs(n) > DELTA_MAX)
    throw new UsageError(
      `--delta must be a non-zero integer from -${DELTA_MAX} to ${DELTA_MAX} (negative: --delta=-300)`,
    );
  if (kind === 'make_good' && n < 0)
    throw new UsageError(`a make_good credits ${premium}: --delta must be positive`);
  if (kind === 'refund' && n > 0)
    throw new UsageError(
      `a refund removes ${premium}: --delta must be negative, e.g. --delta=-300`,
    );
  return n;
}

/** The purchase's server transaction id (a purchase row's ref in `events`), not its token. */
function transactionIdArg(raw) {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new UsageError(
      "--transaction-id must be the purchase's server transaction id (its ref in events), not the provider token",
    );
  return Number(raw);
}

/** The player's purchase row in the admin timeline (`<classification> <sku> granted=<n>`). */
async function purchaseRow(call, pk, id) {
  const r = await call('GET', `/admin/v1/players/${enc(pk)}/timeline`);
  const item = r.items.find((i) => i.kind === 'purchase' && i.ref === String(id));
  if (!item) return { found: false, complete: r.items.length < TIMELINE_ROWS };
  const m = /^(\S+) (.+) granted=(-?\d+)$/.exec(item.summary);
  return {
    found: true,
    purchase: {
      id,
      at: item.at,
      summary: item.summary,
      classification: m?.[1] ?? null,
      sku: m?.[2] ?? null,
      granted: m ? Number(m[3]) : null,
      ...(item.detail !== undefined ? { detail: item.detail } : {}),
    },
  };
}

async function planAdjust(call, [pk], o, grants) {
  const premium = grants.premiumName;
  const kind = o.kind;
  if (!Object.hasOwn(ADJUST_KINDS, kind ?? ''))
    throw new UsageError('--kind must be make_good, refund or correction');
  const delta = adjustDelta(o, kind, premium);
  const body = { playerKey: pk, kind, delta, reason: text(o, 'reason', 512) };
  const transactionId = transactionIdArg(o['transaction-id']);
  const ticketRef = text(o, 'ticket', 128, false);
  if (transactionId !== undefined) body.transactionId = transactionId;
  if (ticketRef) body.ticketRef = ticketRef;
  const p = await knownPlayer(call, pk);
  let transaction = null;
  let purchaseLine = null;
  if (transactionId !== undefined) {
    const row = await purchaseRow(call, pk, transactionId);
    if (row.found) {
      const t = row.purchase;
      transaction = { ...t, checked: true };
      purchaseLine =
        t.sku === null
          ? `#${t.id} · ${t.summary} · recorded ${fmtTime(t.at)}`
          : `#${t.id} · ${t.classification} · sku ${t.sku} · ${t.granted} ${premium} granted · recorded ${fmtTime(t.at)}`;
    } else if (row.complete)
      throw new UsageError(
        `player ${pk} has no purchase transaction #${transactionId} (purchase refs: events ${pk})`,
      );
    else {
      // Older than the timeline reaches: the server still refuses another player's transaction.
      transaction = { id: transactionId, checked: false };
      purchaseLine = `#${transactionId} not among the newest ${TIMELINE_ROWS} events; the server checks it is ${pk}'s`;
    }
  }
  const disabled = p.flags.some((f) => f.flag === 'purchases_disabled');
  const strike = kind === 'refund' ? p.strikes + 1 : null;
  const label = ADJUST_KINDS[kind];
  const effect =
    delta > 0
      ? `+${num(delta)} PAID ${premium} (${label}), credited when the game next starts`
      : `−${num(-delta)} ${premium} (${label}), wallet clamps at 0; ${strike === null ? 'no strike' : `adds a refund strike (${strike}/${STRIKES_TO_DISABLE})`}`;
  const warning = disabled
    ? 'purchases_disabled is already set (checkout off)'
    : strike !== null && strike >= STRIKES_TO_DISABLE
      ? `${strike === STRIKES_TO_DISABLE ? 'the 3rd strike' : `strike ${strike} (3 or more)`} sets purchases_disabled (checkout off)`
      : null;
  return {
    path: '/admin/v1/purchases/adjustments',
    body,
    plan: {
      action: 'adjust',
      ...body,
      lastSeenAt: p.lastSeenAt,
      strikes: p.strikes,
      strikesAfter: strike ?? p.strikes,
      purchasesDisabled: disabled,
      setsPurchasesDisabled: !disabled && (strike ?? 0) >= STRIKES_TO_DISABLE,
      transaction,
    },
    text: [
      `Adjust ${pk}'s ${premium} (last seen ${fmtTime(p.lastSeenAt)}, ${p.paidCount} paid purchase(s), ${p.strikes} strike(s))`,
      `  kind       ${kind}`,
      ...(purchaseLine ? [`  purchase   ${purchaseLine}`] : []),
      `  effect     ${effect}`,
      ...(warning ? [`  warning    ${warning}`] : []),
      ...(ticketRef ? [`  ticket     ${ticketRef}`] : []),
      `  reason     ${body.reason}`,
    ].join('\n'),
  };
}

const READS = { player, timeline, events, save, audit };
const WRITES = { restore: planRestore, letter: planLetter, grant: planGrant, adjust: planAdjust };

function resultText(command, r, plan) {
  if (command === 'restore')
    return `generation ${r.generation} opened from seq ${plan.target.seq}${r.duplicate ? ' · duplicate (already applied)' : ''}`;
  if (command === 'grant')
    return `grant ${r.grantKey}${r.duplicate ? ' · duplicate (already minted)' : ' minted'}`;
  if (command === 'adjust')
    return `adjustment #${r.adjustmentId}${r.duplicate ? ' · duplicate (already recorded)' : ' recorded'}`;
  return 'letter sent';
}

/** The audit row the write left (same commandId); null when it is not among the newest 500. */
async function auditIdFor(call, commandId) {
  const r = await call('GET', '/admin/v1/actions');
  return r.items.find((a) => a.commandId === commandId)?.id ?? null;
}

async function write(call, command, args, o, out, grants) {
  const commandId = o['command-id'] ?? randomUUID();
  if (!UUID.test(commandId)) throw new UsageError('--command-id must be a UUID');
  // A retry after a lost answer: if the first attempt landed, its audit row says so (and the
  // plan's checks, such as the expected generation, would now refuse it).
  if (o['command-id'] !== undefined) {
    const done = await auditIdFor(call, commandId);
    if (done !== null) {
      out.result(
        { dryRun: false, commandId, auditId: done, alreadyApplied: true },
        `Already applied: commandId ${commandId} · audit #${done}. Nothing sent.`,
      );
      return;
    }
  }
  const plan = await WRITES[command](call, args, o, grants);
  if (!o.yes) {
    out.result(
      { dryRun: true, commandId, plan: plan.plan },
      `${plan.text}\nDry run: nothing changed. Re-run with --yes to execute.`,
    );
    return;
  }
  out.info(plan.text);
  let result;
  try {
    result = await call('POST', plan.path, { commandId, ...plan.body });
  } catch (error) {
    if (error instanceof RequestError && (error.status === 0 || error.status >= 500))
      error.message += `\ncommandId ${commandId}: retry with --command-id ${commandId} (applies at most once)`;
    else if (error instanceof RequestError) error.message += `\ncommandId ${commandId}`;
    throw error;
  }
  let auditId = null;
  let auditNote = '';
  try {
    auditId = await auditIdFor(call, commandId);
    if (auditId === null) auditNote = ' (audit row not among the newest 500 actions)';
  } catch (error) {
    auditNote = ` (audit lookup failed: ${error.message})`;
  }
  out.result(
    { dryRun: false, commandId, auditId, plan: plan.plan, result: stripMeta(result) },
    `Done: ${resultText(command, result, plan.plan)}\ncommandId ${commandId} · audit ${auditId === null ? 'unknown' : `#${auditId}`}${auditNote}`,
  );
}

function parse(argv, grants) {
  const rewardFlags = grantFlags(grants);
  const options = { ...OPTION_SPEC, ...rewardFlags };
  // parseArgs reads `--delta -300` as a missing value: say how to write it.
  for (const [i, arg] of argv.entries()) {
    const name = arg.startsWith('--') ? arg.slice(2) : '';
    const next = argv[i + 1] ?? '';
    if (Object.hasOwn(options, name) && options[name].type === 'string' && /^-\d/.test(next))
      throw new UsageError(`--${name} ${next} reads as a missing value: write --${name}=${next}`);
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const { values: o, positionals } = parsed;
  const [command, ...args] = positionals;
  if (o.help || command === 'help') return { help: true };
  const spec = COMMANDS[command ?? ''];
  if (!spec) throw new UsageError(command ? `unknown command ${command}` : 'a command is required');
  const allowed = new Set([...COMMON_OPTIONS, ...spec.options, 'help']);
  if (command === 'grant') for (const name of Object.keys(rewardFlags)) allowed.add(name);
  if (!spec.scope) for (const name of WRITE_ONLY_OPTIONS) allowed.delete(name);
  for (const [name, value] of Object.entries(o))
    if (value !== undefined && value !== options[name].default && !allowed.has(name))
      throw new UsageError(`${command} does not take --${name}`);
  if (args.length !== spec.args.length)
    throw new UsageError(`usage: ${command} ${spec.args.map((a) => `<${a}>`).join(' ')}`);
  if (spec.args[0] === 'playerKey') playerKeyArg(args[0]);
  if (spec.scope && !o.write) throw new UsageError(`${command} changes state: add --write`);
  return { command, args, o, spec };
}

/** Runs one invocation; returns the exit code. `io` is injectable for tests. */
export async function run(argv, io = defaultIo()) {
  const json = argv.includes('--json');
  const grants = io.grants ?? GAME_GRANTS;
  const fail = (code, error) => {
    if (json)
      io.stderr(
        JSON.stringify({
          ok: false,
          exitCode: code,
          message: error.message,
          ...(error.status !== undefined ? { status: error.status } : {}),
          ...(error.error ? { error: error.error } : {}),
        }),
      );
    else io.stderr(`admin: ${error.message}`);
    return code;
  };
  try {
    const p = parse(argv, grants);
    if (p.help) {
      io.stdout(usage(grants));
      return 0;
    }
    const config = resolveConfig(p.o, p.command, io);
    if (!json)
      io.stderr(
        `${config.environment} · ${config.origin} · key ${config.key.id}${config.access ? ' · Cloudflare Access service token' : ''}`,
      );
    const call = adminApi(config, io);
    const out = {
      info: (t) => (json ? undefined : io.stdout(t)),
      result: (j, t) => io.stdout(json ? JSON.stringify(j, null, 2) : t),
    };
    if (p.spec.scope) await write(call, p.command, p.args, p.o, out, grants);
    else {
      const r = await READS[p.command](call, p.args, p.o);
      out.result(r.json, r.text);
    }
    return 0;
  } catch (error) {
    if (error instanceof UsageError) return fail(2, error);
    if (error instanceof RequestError) return fail(1, error);
    throw error;
  }
}

function defaultIo() {
  return {
    grants: GAME_GRANTS,
    fetch: globalThis.fetch,
    env: process.env,
    homedir,
    readFile: (path) => readFileSync(path, 'utf8'),
    stdout: (s) => process.stdout.write(`${s}\n`),
    stderr: (s) => process.stderr.write(`${s}\n`),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}
