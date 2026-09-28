// @ts-nocheck
/**
 * Captain's Commission subscription: entitlement and daily perks.
 *
 * Jest owns billing, the trial and the retention discount. The game only reads
 * the wallet's entitlement (verified by our server from Jest's signed list) and
 * pays the daily perks while it is active.
 */
import { SUBSCRIPTION_DEFS } from '../data/products.js';
import { dayKey } from './daily.js';
import { fuelMaxFor } from './hangar.js';
import { clampFuel } from './economy.js';

export const COMMISSION_SKU = 'wc_sub_commission';
export const COMMISSION = SUBSCRIPTION_DEFS[COMMISSION_SKU];
/** Offline, a verified entitlement keeps paying perks for this long. */
export const ENTITLEMENT_GRACE_MS = 72 * 60 * 60 * 1000;

export function commissionActive(player, now = Date.now()) {
  const c = player?.commission;
  return Boolean(c?.active && Number.isFinite(c.verifiedAt) && now - c.verifiedAt < ENTITLEMENT_GRACE_MS);
}

/** The SDK's plain objects, used only by the local mock (no money involved). */
export function fromPlain(list = []) {
  return list.filter(s => SUBSCRIPTION_DEFS[s?.sku]).map(s => ({
    sku: s.sku,
    active: s.status === 'active',
    sandbox: s.sandbox === true,
    trialEligible: s.trialEligible === true,
    retentionOffer: s.retentionOffer || null,
  }));
}

/** Apply a verified entitlement list. Fuel cap follows the entitlement. */
export function applyEntitlements(player, subscriptions, now = Date.now()) {
  const entry = subscriptions.find(s => s.sku === COMMISSION_SKU);
  if (!entry) return player;
  const prev = player.commission || {};
  const commission = {
    ...prev,
    sku: COMMISSION_SKU,
    active: entry.active,
    trialEligible: entry.trialEligible,
    retentionOffer: entry.retentionOffer || null,
    verifiedAt: now,
    since: entry.active ? (prev.active ? prev.since : now) : null,
    // A fresh subscription is not a cancelled one.
    cancelRequested: entry.active && prev.active ? Boolean(prev.cancelRequested) : false,
  };
  const next = { ...player, commission };
  const fuelMax = fuelMaxFor(next);
  return { ...next, fuelMax, wallet: clampFuel(next.wallet || {}, fuelMax) };
}

/** Once per UTC day while active: gems and a drydock finish. */
export function claimCommissionDaily(player, now = Date.now()) {
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
async function entitlementsFrom(plainList, signed, { real, verify }) {
  if (!real) return { ok: true, subscriptions: fromPlain(plainList) };
  if (!verify) return { ok: false, reason: 'store_unavailable' };
  const res = await verify(signed);
  return res.ok ? { ok: true, subscriptions: res.data.subscriptions } : { ok: false, reason: res.reason || 'unverified' };
}

/** Boot / return-to-app: re-read the wallet's entitlement (catches renewals and lapses). */
export async function refreshCommission(player, { sdk, real, verify, now }) {
  const list = await sdk.getSubscriptions();
  const ent = await entitlementsFrom(list?.subscriptions || [], list?.signed, { real, verify });
  if (!ent.ok) return { ok: false, reason: ent.reason, player };
  return { ok: true, player: applyEntitlements(player, ent.subscriptions, now()) };
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
  const ent = await entitlementsFrom(res?.subscription ? [res.subscription] : [], res?.subscriptionSigned, { real, verify });
  // Charged but not yet verified: the next boot's refresh picks it up.
  if (!ent.ok) return { ok: false, reason: 'pending_verification', player };
  return { ok: true, player: applyEntitlements(player, ent.subscriptions, now()) };
}

export async function acceptRetention(player, { sdk, real, verify, now }) {
  const res = await sdk.claimRetentionOffer(COMMISSION_SKU);
  if (res?.result !== 'success') return { ok: false, reason: res?.error || 'error', player };
  const ent = await entitlementsFrom([res.subscription], res.subscriptionSigned, { real, verify });
  if (!ent.ok) return { ok: true, player: { ...player, commission: { ...player.commission, retentionOffer: null } } };
  return { ok: true, player: applyEntitlements(player, ent.subscriptions, now()) };
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
