// Mint provider-shaped tokens in tests (HS256 over a base64 secret, iat in seconds, aud = gameId).
import { createHmac, randomBytes } from 'node:crypto';

const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomSecretB64(bytes = 32): string {
  return randomBytes(bytes).toString('base64');
}

export function signHs256(
  payload: Record<string, unknown>,
  secretB64: string,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}

export interface MintPlayerTokenOpts {
  playerId: string;
  gameId: string;
  secretB64: string;
  nowMs: number;
  registered?: boolean;
  /** Override iat (seconds). Defaults to nowMs/1000. */
  iatSec?: number;
  alg?: string;
  aud?: string | null;
  sub?: string | null;
}

/** Jest-shaped player token: {player:{playerId,registered}, iat, aud, sub}. No exp (freshness via iat). */
export function mintPlayerToken(o: MintPlayerTokenOpts): string {
  const payload: Record<string, unknown> = {
    player: { playerId: o.playerId, registered: o.registered ?? false },
    iat: o.iatSec ?? Math.floor(o.nowMs / 1000),
  };
  if (o.aud !== null) payload.aud = o.aud ?? o.gameId;
  if (o.sub !== null) payload.sub = o.sub ?? o.playerId;
  return signHs256(payload, o.secretB64, { alg: o.alg ?? 'HS256', typ: 'JWT' });
}

export interface MintReceiptOpts {
  playerId: string;
  gameId: string;
  secretB64: string;
  purchaseToken: string;
  productSku: string;
  createdAt: number;
  completedAt?: number | null;
  price?: number;
  currency?: string;
  aud?: string | null;
  batch?: boolean;
}

/** Jest-shaped signed receipt: {aud, sub, purchase:{...}} or {purchases:[...]} for batch. */
export function mintReceipt(o: MintReceiptOpts): string {
  const purchase: Record<string, unknown> = {
    purchaseToken: o.purchaseToken,
    productSku: o.productSku,
    createdAt: o.createdAt,
    completedAt: o.completedAt === undefined ? o.createdAt + 1000 : o.completedAt,
  };
  if (o.price !== undefined) purchase.price = o.price;
  if (o.currency !== undefined) purchase.currency = o.currency;
  const payload: Record<string, unknown> = { sub: o.playerId };
  if (o.aud !== null) payload.aud = o.aud ?? o.gameId;
  if (o.batch) payload.purchases = [purchase];
  else payload.purchase = purchase;
  return signHs256(payload, o.secretB64);
}
