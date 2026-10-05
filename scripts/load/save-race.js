// Same-player save race (k6, https://k6.io): proves the save path stays consistent when several
// writes for one player land at once, on different API replicas when there are several. Each round
// takes a fresh synthetic player, sends DISTINCT writes (new commandIds) and DUPES copies of one
// more write in a single parallel batch, then reads the head. Fails on any 5xx or 429, a seq shared
// by two distinct writes, duplicates that resolve to more than one seq or anchor more than once,
// or a head that is not the highest seq. Run it with 2+ API replicas to prove the per-player lock
// holds across them.
//   k6 run -e BASE_URL=http://127.0.0.1:8080 scripts/load/save-race.js
// Environment as common.js (BASE_URL, GAME_ID, JEST_JWS_SECRET_B64, SAVE_FILE, BUILD_VERSION,
// RUN_ID), plus VUS and ROUNDS (rounds per VU, default 3 and 8), DISTINCT and DUPES (default 8
// and 4) and PAUSE_S between rounds (default 4). Never point it at production.
/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, BUILD, RUN, saveBody, token, uuid } from './common.js';

const DISTINCT = Number(__ENV.DISTINCT || 8);
const DUPES = Number(__ENV.DUPES || 4);

export const options = {
  scenarios: {
    race: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.VUS || 3),
      iterations: Number(__ENV.ROUNDS || 8),
      maxDuration: '10m',
    },
  },
  thresholds: {
    server_errors: ['count<1'],
    seq_collisions: ['count<1'],
    duplicate_splits: ['count<1'],
    head_mismatches: ['count<1'],
    rate_limited: ['count<1'],
  },
};

const serverErrors = new Counter('server_errors');
const seqCollisions = new Counter('seq_collisions');
const duplicateSplits = new Counter('duplicate_splits');
const headMismatches = new Counter('head_mismatches');
const rateLimited = new Counter('rate_limited');
const writes = new Counter('race_writes');
/** What the race produced: anchored, duplicate, or anything else (stored_*, refusals). */
const anchored = new Counter('race_anchored');
const duplicates = new Counter('race_duplicate');
const others = new Counter('race_other');

export default function round() {
  const id = `race-${RUN}-${__VU}-${__ITER}`;
  const params = (extra = {}) => ({
    headers: {
      'x-player-key': id,
      authorization: `Bearer ${token(id)}`,
      'x-build-version': BUILD,
      ...extra,
    },
  });
  const head0 = http.get(`${BASE}/v1/saves/current?meta=1`, params());
  if (head0.status === 429) rateLimited.add(1);
  const generation = head0.status === 200 ? (head0.json().generation ?? 0) : 0;
  const sessionId = uuid();
  const body = (commandId, clientSeq) =>
    JSON.stringify(
      saveBody({ commandId, generation, clientSeq, baseSeq: 0, sessionId, reason: 'important' }),
    );
  const json = params({ 'content-type': 'application/json' });
  const requests = [];
  for (let i = 0; i < DISTINCT; i++)
    requests.push(['PUT', `${BASE}/v1/saves`, body(uuid(), i + 1), json]);
  const dupBody = body(uuid(), DISTINCT + 1);
  for (let i = 0; i < DUPES; i++) requests.push(['PUT', `${BASE}/v1/saves`, dupBody, json]);
  const results = http.batch(requests);
  writes.add(results.length);

  const distinctSeqs = [];
  const dupSeqs = new Set();
  let dupAnchored = 0;
  results.forEach((res, i) => {
    if (res.status >= 500) serverErrors.add(1);
    if (res.status === 429) rateLimited.add(1);
    if (res.status !== 200) return;
    const r = res.json();
    if (r.disposition === 'anchored') anchored.add(1);
    else if (r.disposition === 'duplicate') duplicates.add(1);
    else others.add(1);
    if (i < DISTINCT) distinctSeqs.push(r.seq);
    else {
      dupSeqs.add(r.seq);
      if (r.disposition === 'anchored') dupAnchored += 1;
    }
  });
  const collisions = distinctSeqs.length - new Set(distinctSeqs).size;
  if (collisions > 0) seqCollisions.add(collisions);
  if (dupSeqs.size > 1 || dupAnchored > 1) duplicateSplits.add(1);
  const all = [...distinctSeqs, ...dupSeqs].filter((s) => typeof s === 'number');
  const head = http.get(`${BASE}/v1/saves/current?meta=1`, params());
  const headSeq = head.status === 200 ? head.json().snapshot?.seq : undefined;
  if (all.length && headSeq !== Math.max(...all)) headMismatches.add(1);
  check(results, { 'all writes answered 200': (rs) => rs.every((r) => r.status === 200) });
  sleep(Number(__ENV.PAUSE_S || 4));
}
