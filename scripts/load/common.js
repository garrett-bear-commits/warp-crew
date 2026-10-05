// Shared by the k6 load tests (sessions.js, save-race.js): target, synthetic player tokens and the
// save body. Environment:
//   BASE_URL        API base (default http://127.0.0.1:8080, a local API). Through a web origin
//                   that proxies the API: https://<origin>/api.
//   GAME_ID         Token audience (the platform's game id); required with JEST_JWS_SECRET_B64
//   JEST_JWS_SECRET_B64  The environment's Jest signing secret (base64): tokens are minted like
//                   Jest's (HS256, aud = GAME_ID). Unset: mock tokens, for a server that runs the
//                   mock identity verifier (local only).
//   SAVE_FILE       JSON {blob, progress, schemaVersion?}: a save the game's policy accepts. Default:
//                   a fresh template-game save; another game passes one of its own (e.g. a QA
//                   save's `blob` and `snapshot.progress` from GET /v1/saves/current).
//   BUILD_VERSION   x-build-version and the saves' buildVersion (default 1.0.0)
//   RUN_ID          Player-key prefix (default: start time)
// Never point a load test at production: synthetic players and saves stay in its database. A
// BASE_URL naming prod/production is refused.
/* global __ENV, open */
/* eslint-disable no-restricted-syntax -- a k6 script runs on the wall clock (ADR-009 is for game code) */
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

export const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
export const GAME_ID = __ENV.GAME_ID || '';
export const BUILD = __ENV.BUILD_VERSION || '1.0.0';
export const RUN = __ENV.RUN_ID || String(Date.now());
const SECRET_B64 = __ENV.JEST_JWS_SECRET_B64 || '';
const SECRET = SECRET_B64 ? encoding.b64decode(SECRET_B64, 'std') : null;

if (/\bprod(uction)?\b/i.test(BASE)) throw new Error('never load-test production');
if (SECRET && !GAME_ID) throw new Error('GAME_ID (the token audience) is required with a secret');

/** The template game's fresh save (apps/server/games/template/policy.ts accepts it). */
const TEMPLATE_SAVE = {
  blob: JSON.stringify({ schemaVersion: 1, state: { v: 1, counter: 0, gold: 0 } }),
  progress: 0,
  schemaVersion: 1,
};
export const SEED = __ENV.SAVE_FILE ? JSON.parse(open(__ENV.SAVE_FILE)) : TEMPLATE_SAVE;

export function uuid() {
  const b = new Uint8Array(crypto.randomBytes(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A Jest-shaped HS256 player token (packages/jest-verify/src/identity.ts), or a mock token. */
export function token(playerId) {
  const now = Date.now();
  if (!SECRET) return `mock.${playerId}.${now}`;
  const part = (o) => encoding.b64encode(JSON.stringify(o), 'rawurl');
  const input = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({
    aud: GAME_ID,
    sub: playerId,
    iat: Math.floor(now / 1000),
    player: { playerId, registered: false },
  })}`;
  return `${input}.${crypto.hmac('sha256', SECRET, input, 'base64rawurl')}`;
}

/** A PUT /v1/saves body for the seed save. */
export function saveBody({ commandId, generation, clientSeq, baseSeq, sessionId, reason }) {
  return {
    commandId,
    generation,
    clientSeq,
    baseSeq,
    sessionId,
    progress: SEED.progress,
    savedAt: Date.now(),
    schemaVersion: SEED.schemaVersion ?? 1,
    buildVersion: BUILD,
    enc: 'json',
    reason,
    blob: SEED.blob,
  };
}
