// HTTP surface. Order for every request: authenticate the Jest player token,
// validate the body, then touch the database. Nothing here trusts a player id,
// SKU, price or reward named by the client.

import Fastify from 'fastify';
import { authenticate } from './auth.js';
import { verifyPurchaseReceipts } from './receipts.js';
import { PRODUCT_DEFS } from '../src/data/products.js';

export const MAX_SAVE_BYTES = 1_000_000;

/** Why a save blob is refused. It is still stored for recovery. */
export function saveRejectReason(blob) {
  let parsed;
  try { parsed = JSON.parse(blob); } catch { return 'invalid_json'; }
  const player = parsed?.player;
  if (!player || typeof player !== 'object' || Array.isArray(player)) return 'no_player';
  if (!Number.isInteger(player.version) || !player.wallet || typeof player.wallet !== 'object') return 'bad_shape';
  return null;
}

export function buildApp({ store, secret, gameId, devAuth = false, now = () => Date.now(), allowOrigins = [], logger = false }) {
  const app = Fastify({ logger, bodyLimit: MAX_SAVE_BYTES + 64_000 });

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    const allowed = allowOrigins.includes('*') ? '*' : allowOrigins.includes(origin) ? origin : null;
    if (allowed) {
      reply.header('access-control-allow-origin', allowed);
      reply.header('access-control-allow-headers', 'authorization, content-type, x-player-id');
      reply.header('access-control-allow-methods', 'GET, PUT, POST, OPTIONS');
      reply.header('vary', 'origin');
    }
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  const auth = (req, reply) => {
    const result = authenticate(req.headers, { secret, gameId, devAuth, now: now() });
    if (!result.ok) {
      reply.code(401).send({ error: result.reason });
      return null;
    }
    return result.player;
  };

  app.get('/health', async () => ({ ok: true }));

  app.get('/v1/saves/current', async (req, reply) => {
    const player = auth(req, reply);
    if (!player) return reply;
    const [save, purchases] = await Promise.all([store.currentSave(player.playerId), store.purchasesFor(player.playerId)]);
    return { save, purchases, serverNow: now() };
  });

  app.put('/v1/saves', async (req, reply) => {
    const player = auth(req, reply);
    if (!player) return reply;
    const { blob, clientSeq = null, baseSeq = null, savedAt, archive = false } = req.body || {};
    if (typeof blob !== 'string' || !Number.isFinite(savedAt)) return reply.code(400).send({ error: 'bad_request' });
    const bytes = Buffer.byteLength(blob, 'utf8');
    // `archive` keeps the losing side of a two-device conflict recoverable without making it current.
    const rejectReason = bytes > MAX_SAVE_BYTES ? 'too_large' : saveRejectReason(blob) || (archive === true ? 'archived_conflict' : null);
    let delivered = [];
    if (!rejectReason) {
      try { delivered = (JSON.parse(blob).player.iapFulfilled || []).filter(token => typeof token === 'string').slice(0, 5000); } catch { delivered = []; }
    }
    const written = await store.appendSave(player.playerId, {
      blob: bytes > MAX_SAVE_BYTES ? null : blob,
      bytes,
      clientSeq: Number.isSafeInteger(clientSeq) ? clientSeq : null,
      baseSeq: Number.isSafeInteger(baseSeq) ? baseSeq : null,
      savedAt: Math.trunc(savedAt),
      accepted: !rejectReason,
      rejectReason,
      deliveredTokens: delivered,
    });
    // A stale device never overwrites: it gets the current save back to reconcile.
    const current = written.stale ? await store.currentSave(player.playerId) : null;
    return { seq: written.seq, accepted: written.accepted, rejectReason: written.rejectReason, conflict: written.stale,
      ...(current ? { current, purchases: await store.purchasesFor(player.playerId) } : {}), serverNow: now() };
  });

  app.post('/v1/purchases/verify', async (req, reply) => {
    const player = auth(req, reply);
    if (!player) return reply;
    const receipt = req.body?.receipt;
    if (typeof receipt !== 'string' || !receipt) return reply.code(400).send({ error: 'bad_request' });
    const verified = verifyPurchaseReceipts(receipt, secret, gameId);
    if (!verified.ok) return reply.code(400).send({ error: verified.reason });
    // A receipt proves a purchase only for the player who is asking.
    if (verified.purchases.some(purchase => purchase.playerId !== player.playerId)) return reply.code(403).send({ error: 'receipt_player_mismatch' });
    const results = [];
    for (const purchase of verified.purchases) {
      const product = PRODUCT_DEFS[purchase.productSku] || null;
      const recorded = await store.recordPurchase(player.playerId, purchase, product);
      results.push({ purchaseToken: purchase.purchaseToken, sku: purchase.productSku, status: recorded.status, grant: recorded.grant });
    }
    return { purchases: results };
  });

  return app;
}
