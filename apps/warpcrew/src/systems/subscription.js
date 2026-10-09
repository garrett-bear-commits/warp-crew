// @ts-nocheck
/**
 * Captain's Commission subscription: entitlement and daily perks.
 *
 * Jest owns billing, the trial and the retention discount. The game only reads
 * the wallet's entitlement (verified by our server from Jest's signed list) and
 * pays the daily perks while it is active.
 */
import { trustedNow } from '../shared/time.js';
import { SUBSCRIPTION_DEFS } from '../data/products.js';
import { dayKey } from './daily.js';
import { fuelMaxFor } from './hangar.js';

export const COMMISSION_SKU = 'wc_sub_commission';
export const COMMISSION = SUBSCRIPTION_DEFS[COMMISSION_SKU];
/** Offline, a verified entitlement keeps paying perks for this long. */
export const ENTITLEMENT_GRACE_MS = 72 * 60 * 60 * 1000;

export function commissionActive(player, now = trustedNow()) {
  const c = player?.commission;
  return Boolean(c?.active && Number.isFinite(c.verifiedAt) && now - c.verifiedAt < ENTITLEMENT_GRACE_MS);
}

/** The SDK's plain objects, used only by the local mock (no money involved). */
export function fromPlain(list = [], now = trustedNow()) {
  return list.filter(s => SUBSCRIPTION_DEFS[s?.sku]).map(s => ({
    sku: s.sku,
    active: s.status === 'active',
    sandbox: s.sandbox === true,
    trialEligible: s.trialEligible === true,
    retentionOffer: s.retentionOffer || null,
    price: Number.isFinite(s.price) ? s.price : null,
    currency: s.currency || null,
    billingPeriod: s.billingPeriod || null,
    issuedAt: now,
  }));
}

/**
 * Jest's price as cents. Products arrive in cents; an integer is read the same
 * way, a fractional amount (e.g. 9.99) as whole currency units.
 * (Staging check: confirm the unit Jest uses for subscriptions.)
 */
export function priceCents(price) {
  if (!Number.isFinite(price) || price <= 0) return null;
  return Number.isInteger(price) ? price : Math.round(price * 100);
}

/**
 * Keep the fuel cap in step with the entitlement. When the Commission lapses
 * (or its offline grace runs out) the extra tank space is not deleted: fuel
 * already above the normal cap stays, and the cap shrinks as it is spent, so
 * regeneration never refills past the normal cap.
 */
export function syncCommission(player, now = trustedNow()) {
  let c = player?.commission;
  if (!c) return player;
  const bonus = COMMISSION.perks.fuelMaxBonus;
  if (c.active && !commissionActive(player, now)) c = { ...c, active: false, heldFuelBonus: bonus };
  if (c.active) c = c.heldFuelBonus ? { ...c, heldFuelBonus: 0 } : c;
  else {
    const baseMax = fuelMaxFor({ ...player, commission: { ...c, heldFuelBonus: 0 } });
    const held = Math.min(c.heldFuelBonus || 0, Math.max(0, (player.wallet?.fuel || 0) - baseMax));
    if (held !== (c.heldFuelBonus || 0)) c = { ...c, heldFuelBonus: held };
  }
  const next = { ...player, commission: c };
  const fuelMax = fuelMaxFor(next);
  if (c === player.commission && fuelMax === player.fuelMax) return player;
  return { ...next, fuelMax };
}

/** Apply a verified entitlement list. Fuel cap follows the entitlement. */
/** Saved terms are used only if still a complete tuple (older saves may hold partial ones). */
export function usableTerms(terms) {
  return terms && Number.isInteger(terms.priceCents) && terms.priceCents > 0 && /^[A-Z]{3}$/.test(terms.currency || '')
    && ['weekly', 'monthly', 'yearly'].includes(terms.billingPeriod) ? terms : null;
}

/** A complete verified price tuple, or null: the shop never invents or keeps old terms. */
function verifiedTerms(entry) {
  const cents = priceCents(entry.price);
  const period = ['weekly', 'monthly', 'yearly'].includes(entry.billingPeriod) ? entry.billingPeriod : null;
  const currency = typeof entry.currency === 'string' && /^[A-Z]{3}$/.test(entry.currency) ? entry.currency : null;
  return cents && period && currency ? { priceCents: cents, currency, billingPeriod: period } : null;
}

export function applyEntitlements(player, subscriptions, now = trustedNow(), { issuedAt: listIssuedAt = null } = {}) {
  if (!Array.isArray(subscriptions)) return player;
  // Missing from a verified list means not entitled (unless never subscribed),
  // as of when that list was signed.
  const entry = subscriptions.find(s => s?.sku === COMMISSION_SKU)
    || (player.commission ? { sku: COMMISSION_SKU, active: false, trialEligible: false, retentionOffer: null, issuedAt: listIssuedAt } : null);
  if (!entry || typeof entry !== 'object') return player;
  const prev = player.commission || {};
  // When the proof was signed: the verified list's issuedAt (the core server returns it once, for
  // the whole list), else the entry's own (the local mock's plain objects). The offline grace runs
  // from it, and a proof older than one already applied never overrides it (a replay of a
  // pre-cancel list). `now` is trusted time.
  const signedAt = Number.isFinite(listIssuedAt) ? listIssuedAt : entry.issuedAt;
  const issuedAt = Number.isFinite(signedAt) ? Math.min(signedAt, now) : now;
  if (Number.isFinite(prev.verifiedAt) && issuedAt < prev.verifiedAt) return player;
  const commission = {
    ...prev,
    sku: COMMISSION_SKU,
    active: entry.active,
    trialEligible: entry.trialEligible,
    retentionOffer: entry.retentionOffer || null,
    verifiedAt: issuedAt,
    terms: verifiedTerms(entry),
    since: entry.active ? (prev.active ? prev.since : now) : null,
    // A fresh subscription is not a cancelled one.
    cancelRequested: entry.active && prev.active ? Boolean(prev.cancelRequested) : false,
  };
  // A lapse starts holding the extra tank space; syncCommission shrinks it as fuel is spent.
  if (prev.active && !entry.active) commission.heldFuelBonus = COMMISSION.perks.fuelMaxBonus;
  return syncCommission({ ...player, commission }, now);
}

/** Once per game day (local midnight) while active: gems and a drydock finish. */
export function claimCommissionDaily(player, now = trustedNow()) {
  if (!commissionActive(player, now)) return { player, granted: null };
  const today = dayKey(now);
  if (player.commission.lastClaimDay === today) return { player, granted: null };
  const { dailyGems, dailyDrydockFinishes } = COMMISSION.perks;
  return {
    player: {
      ...player,
      wallet: { ...player.wallet, gems: (player.wallet?.gems || 0) + dailyGems },
      drydockFinishes: (player.drydockFinishes || 0) + dailyDrydockFinishes,
      commission: { ...player.commission, lastClaimDay: today },
    },
    granted: { gems: dailyGems, drydockFinishes: dailyDrydockFinishes },
  };
}

/**
 * Turn an SDK answer into entitlements. A real Jest answer is trusted only
 * after our server verifies its signature; the local mock is trusted as is.
 */
async function entitlementsFrom(plainList, signed, { real, verify, now }) {
  if (!real) return { ok: true, subscriptions: fromPlain(plainList, now()), issuedAt: now() };
  if (!verify) return { ok: false, reason: 'store_unavailable' };
  const res = await verify(signed);
  if (!res.ok) return { ok: false, reason: res.reason || 'unverified' };
  // A verified proof without its signing time cannot be ordered or aged: not trusted.
  if (!Number.isFinite(res.data?.issuedAt)) return { ok: false, reason: 'no_issued_at' };
  return { ok: true, subscriptions: res.data.subscriptions, issuedAt: res.data.issuedAt };
}

/** Boot / return-to-app: re-read the wallet's entitlement (catches renewals and lapses). */
export async function refreshCommission(player, { sdk, real, verify, now }) {
  const list = await sdk.getSubscriptions();
  const ent = await entitlementsFrom(list?.subscriptions || [], list?.signed, { real, verify, now });
  if (!ent.ok) return { ok: false, reason: ent.reason, player };
  return { ok: true, player: applyEntitlements(player, ent.subscriptions, now(), { issuedAt: ent.issuedAt }) };
}

export async function subscribeCommission(player, { sdk, real, verify, now }) {
  if (commissionActive(player, now())) return { ok: false, reason: 'already_active', player };
  // Real Jest with no verifier: never start a charge we cannot honour.
  if (real && !verify) return { ok: false, reason: 'store_unavailable', player };
  const res = await sdk.beginSubscription(COMMISSION_SKU);
  if (res?.result === 'cancel') return { ok: false, reason: 'cancelled', player };
  if (res?.result === 'error') {
    if (res.error === 'already_subscribed') return refreshCommission(player, { sdk, real, verify, now });
    return { ok: false, reason: res.error || 'error', player };
  }
  const ent = await entitlementsFrom(res?.subscription ? [res.subscription] : [], res?.subscriptionSigned, { real, verify, now });
  if (!ent.ok) {
    // The checkout proof could not be verified (e.g. it carries no iat): a fresh signed list can.
    const refreshed = await refreshCommission(player, { sdk, real, verify, now }).catch(() => null);
    if (refreshed?.ok && commissionActive(refreshed.player, now())) return refreshed;
    // Charged but not yet verified: the next boot's refresh picks it up.
    return { ok: false, reason: 'pending_verification', player };
  }
  return { ok: true, player: applyEntitlements(player, ent.subscriptions, now(), { issuedAt: ent.issuedAt }) };
}

export async function acceptRetention(player, { sdk, real, verify, now }) {
  const res = await sdk.claimRetentionOffer(COMMISSION_SKU);
  if (res?.result !== 'success') return { ok: false, reason: res?.error || 'error', player };
  const ent = await entitlementsFrom([res.subscription], res.subscriptionSigned, { real, verify, now });
  if (!ent.ok) {
    // Jest applied the discount; re-read a fresh signed list to reflect it.
    const refreshed = await refreshCommission(player, { sdk, real, verify, now }).catch(() => null);
    return { ok: true, player: refreshed?.ok ? refreshed.player : { ...player, commission: { ...player.commission, retentionOffer: null } } };
  }
  return { ok: true, player: applyEntitlements(player, ent.subscriptions, now(), { issuedAt: ent.issuedAt }) };
}

export async function cancelCommission(player, { sdk, real, verify, now }) {
  const res = await sdk.cancelSubscription(COMMISSION_SKU);
  if (res?.result === 'cancel') return { ok: false, reason: 'kept', player };
  if (res?.result !== 'success') return { ok: false, reason: res?.error || 'error', player };
  // Jest keeps the entitlement until the paid period ends; re-read rather than guess.
  const refreshed = await refreshCommission(player, { sdk, real, verify, now });
  const base = refreshed.player;
  return { ok: true, player: { ...base, commission: { ...base.commission, cancelRequested: true, retentionOffer: null } } };
}
