// API load test (k6, https://k6.io). Each VU is one synthetic player playing sessions the way a
// hosted client does on the core routes, without analytics or error-reporting traffic:
//   boot     GET /v1/config, /v1/saves/current, /v1/purchases/mine, /v1/grants/pending
//   play     PUT /v1/saves every 10-15 s, a head check (GET /v1/saves/current?meta=1) every ~5 min
//   leave    POST /v1/saves/beacon, then 30-120 s away before the next session
//   k6 run -e BASE_URL=http://127.0.0.1:8080 -e SESSION_S=20 scripts/load/sessions.js
// Environment as common.js (BASE_URL, GAME_ID, JEST_JWS_SECRET_B64, SAVE_FILE, BUILD_VERSION,
// RUN_ID), plus:
//   VUS, DURATION   Concurrent players and hold time (default 1 and 30s); RAMP ramp-up (1m)
//   SESSION_S       Mean session length in seconds (default 600)
//   SPREAD_IPS=1    Send a distinct X-Forwarded-For per VU. Only for a BASE_URL that reaches the
//                   API directly on a private network (the API trusts one proxy hop); a web
//                   origin's proxy overwrites it, so one source address meets its per-IP limits.
// Through a public origin, one source address is capped by the per-address rate limits; for big
// runs, run k6 inside the deployment's private network (scripts/load/Dockerfile).
// Never point it at production.
/* global __ENV, __VU */
/* eslint-disable no-restricted-syntax -- a k6 script runs on the wall clock (ADR-009 is for game code) */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, BUILD, RUN, saveBody, token, uuid } from './common.js';

const SESSION_S = Number(__ENV.SESSION_S || 600);
const SPREAD_IPS = __ENV.SPREAD_IPS === '1';
const VUS = Number(__ENV.VUS || 1);

export const options = {
  scenarios: {
    players: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || (VUS > 1 ? '1m' : '1s'), target: VUS },
        { duration: __ENV.DURATION || '30s', target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
  },
  thresholds: {
    // docs/slo.md: p95 < 300 ms per command. Edge 429s count as failures here.
    'http_req_duration{kind:save}': ['p(95)<300'],
    'http_req_duration{kind:boot}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    save_not_anchored: ['count<1'],
  },
};

const notAnchored = new Counter('save_not_anchored');
const rateLimited = new Counter('rate_limited');

/** Each VU keeps one player across its sessions (a returning player after the first). */
const player = { id: '', token: '', tokenAt: 0, generation: 0, seq: 0, clientSeq: 0 };

/** One address per VU, so players don't share the API's per-IP buckets (private network only). */
function spread() {
  return SPREAD_IPS
    ? { 'x-forwarded-for': `10.${(__VU >> 16) & 255}.${(__VU >> 8) & 255}.${__VU & 255}` }
    : {};
}

function headers(kind, extra = {}) {
  return {
    headers: {
      'x-player-key': player.id,
      authorization: `Bearer ${player.token}`,
      'x-build-version': BUILD,
      'x-request-id': uuid(),
      ...spread(),
      ...extra,
    },
    tags: { kind },
  };
}

function counted(res) {
  if (res.status === 429) rateLimited.add(1);
  return res;
}

/** GET; the body is kept only when read (`keep`), which saves memory at thousands of VUs. */
function get(path, kind, keep = false) {
  return counted(
    http.get(`${BASE}${path}`, {
      ...headers(kind),
      tags: { kind, name: path },
      ...(keep ? {} : { responseType: 'none' }),
    }),
  );
}

function nextSave(sessionId, reason) {
  return saveBody({
    commandId: uuid(),
    generation: player.generation,
    clientSeq: ++player.clientSeq,
    baseSeq: player.seq,
    sessionId,
    reason,
  });
}

function recordWrite(res) {
  const body = res.status === 200 ? res.json() : null;
  const anchored = !!body && (body.disposition === 'anchored' || body.disposition === 'duplicate');
  if (!anchored) notAnchored.add(1);
  if (body && typeof body.seq === 'number') player.seq = body.seq;
  return anchored;
}

function boot() {
  if (!player.id) player.id = `loadtest-${RUN}-${__VU}`;
  if (!player.token || Date.now() - player.tokenAt > 6 * 3600_000) {
    player.token = token(player.id);
    player.tokenAt = Date.now();
  }
  const config = get('/v1/config', 'boot');
  const head = get('/v1/saves/current', 'boot', true);
  get('/v1/purchases/mine', 'boot');
  get('/v1/grants/pending', 'boot');
  check(config, { 'config 200': (r) => r.status === 200 });
  if (check(head, { 'saves/current 200': (r) => r.status === 200 })) {
    const current = head.json();
    player.generation = current.generation ?? 0;
    player.seq = current.snapshot?.seq ?? 0;
  }
}

export default function session() {
  boot();
  const sessionId = uuid();
  const length = SESSION_S * (0.5 + Math.random());
  const started = Date.now();
  let lastHead = started;
  while ((Date.now() - started) / 1000 < length) {
    sleep(10 + Math.random() * 5);
    const res = counted(
      http.put(`${BASE}/v1/saves`, JSON.stringify(nextSave(sessionId, 'important')), {
        ...headers('save', { 'content-type': 'application/json' }),
        tags: { kind: 'save', name: 'PUT /v1/saves' },
      }),
    );
    check(res, { 'save anchored': () => recordWrite(res) });
    if (Date.now() - lastHead > 300_000) {
      get('/v1/saves/current?meta=1', 'head');
      lastHead = Date.now();
    }
  }
  // Teardown beacon: text/plain with the credentials in the body, as navigator.sendBeacon sends.
  const beacon = counted(
    http.post(
      `${BASE}/v1/saves/beacon`,
      JSON.stringify({
        ...nextSave(sessionId, 'teardown'),
        playerKey: player.id,
        token: player.token,
      }),
      {
        headers: { 'content-type': 'text/plain', ...spread() },
        tags: { kind: 'save', name: 'POST /v1/saves/beacon' },
      },
    ),
  );
  check(beacon, { 'beacon anchored': () => recordWrite(beacon) });
  sleep(30 + Math.random() * 90);
}
