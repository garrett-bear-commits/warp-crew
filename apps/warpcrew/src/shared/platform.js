// @ts-nocheck
/**
 * Jest SDK adapter for Warp Crew.
 * Docs: https://docs.jest.com/sdk/html5
 * Degrades to a local mock when window.JestSDK is missing (pnpm dev).
 * Safe to call helpers before init — they no-op until ready.
 */

const globalJest = () =>
  typeof window !== 'undefined' ? window.JestSDK || null : null;

let ready = false;
let mockPlayer = {
  playerId: 'local-dev',
  registered: false,
  username: 'Local Captain',
  avatarUrl: null,
};

const mockLog = [];
const mockScheduled = new Map();

function log(...args) {
  if (typeof console !== 'undefined') console.info('[platform]', ...args);
}

export function isReal() {
  const sdk = globalJest();
  if (!sdk) return false;
  if (inJestShell()) return true;
  try {
    const id = sdk.getPlayer?.()?.playerId;
    if (id && !String(id).startsWith('mock-')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** True when the page is wrapped by the Jest app / simulator. */
export function inJestShell() {
  if (!globalJest()) return false;
  try {
    const host = (typeof location !== 'undefined' && location.hostname) || '';
    if (/(^|\.)jest\.com$/.test(host) || /(^|\.)jest\.app$/.test(host)) return true;
    if (typeof document !== 'undefined' && /jest\.com/.test(document.referrer || '')) {
      return true;
    }
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      try {
        const ph = window.parent.location.hostname || '';
        if (/(^|\.)jest\.com$/.test(ph)) return true;
      } catch {
        // Cross-origin parent — Jest wrapping our GitHub Pages URL.
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

function hideMockDebugChrome() {
  if (typeof document === 'undefined' || inJestShell()) return;
  for (const el of [...document.body.children]) {
    if (el.id === 'app' || (el.classList && el.classList.contains('warp-crew-root'))) continue;
    const z = parseInt((el.style && el.style.zIndex) || getComputedStyle(el).zIndex, 10);
    if (z >= 10000) el.style.setProperty('display', 'none', 'important');
  }
}

export function isReady() {
  return ready;
}

export function getMockLog() {
  return [...mockLog];
}

let initPromise = null;

/** Initialise the Jest SDK once; every later call (the core's Jest provider included) shares it. */
export function init(options = {}) {
  if (!initPromise) initPromise = initSdk(options);
  return initPromise;
}

async function initSdk(options = {}) {
  // Wait briefly for async CDN inject from index.html
  if (typeof window !== 'undefined' && window.__jestSdkReady) {
    try {
      await Promise.race([
        window.__jestSdkReady,
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch {
      /* ignore */
    }
  }
  const sdk = globalJest();
  if (!sdk) {
    ready = true;
    log('Local mock active (no JestSDK).');
    return { mode: 'mock' };
  }
  try {
    const initP = sdk.init({
      autoLoginReminders: false,
      ...options,
    });
    await Promise.race([
      initP,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('JestSDK.init timeout')), 4000)
      ),
    ]);
    ready = true;
    log('JestSDK initialized.');
    if (!inJestShell()) hideMockDebugChrome();
    return { mode: inJestShell() ? 'jest' : 'cdn-mock' };
  } catch (e) {
    console.warn('[platform] init failed, continuing in degraded mode', e);
    ready = true;
    hideMockDebugChrome();
    return { mode: 'degraded', error: String(e) };
  }
}

export function setLoadingProgress(pct) {
  if (!ready) return; // never call SDK before init
  const sdk = globalJest();
  try {
    if (sdk?.setLoadingProgress) sdk.setLoadingProgress(pct);
  } catch (e) {
    console.warn('[platform] setLoadingProgress', e);
  }
}

export function markGameLoaded() {
  if (!ready) return;
  const sdk = globalJest();
  try {
    if (sdk?.markGameLoaded) sdk.markGameLoaded();
  } catch (e) {
    console.warn('[platform] markGameLoaded', e);
  }
}

export function getPlayer() {
  const sdk = globalJest();
  if (ready && sdk?.getPlayer) {
    try {
      return sdk.getPlayer();
    } catch (e) {
      console.warn('[platform] getPlayer', e);
    }
  }
  return mockPlayer;
}

export function getEntryPayload() {
  const sdk = globalJest();
  if (ready && sdk?.getEntryPayload) {
    try {
      return sdk.getEntryPayload() || {};
    } catch {
      return {};
    }
  }
  try {
    const q = new URLSearchParams(window.location.search).get('entryPayload');
    return q ? JSON.parse(q) : {};
  } catch {
    return {};
  }
}

export async function login(options = {}) {
  const sdk = globalJest();
  if (ready && sdk?.login) {
    await sdk.login(options);
    return getPlayer();
  }
  mockPlayer = { ...mockPlayer, registered: true, username: 'Local Captain' };
  mockLog.push({ type: 'login', options });
  return mockPlayer;
}

export function showRegistrationOverlay(options = {}) {
  const sdk = globalJest();
  if (ready && sdk?.showRegistrationOverlay) {
    return sdk.showRegistrationOverlay({
      theme: 'dark',
      message:
        options.message ||
        'Save Warp Crew progress! {{registrationCode}} is my code.',
      ...options,
    });
  }
  return {
    loginButtonAction: () => {
      mockPlayer = { ...mockPlayer, registered: true };
      mockLog.push({ type: 'registration_overlay_login' });
      options.onClose?.();
    },
    closeButtonAction: () => {
      mockLog.push({ type: 'registration_overlay_close' });
      options.onClose?.();
    },
  };
}

export function captureEvent(name, props = {}) {
  const sdk = globalJest();
  if (ready && sdk?.captureEvent) {
    try {
      sdk.captureEvent(name, props);
      return;
    } catch (e) {
      console.warn('[platform] captureEvent', e);
    }
  }
  mockLog.push({ type: 'event', name, props });
}

export async function scheduleNotification(options) {
  const sdk = globalJest();
  if (ready && sdk?.notifications?.scheduleNotification) {
    return sdk.notifications.scheduleNotification(options);
  }
  mockScheduled.set(options.identifier || 'anon', {
    ...options,
    at:
      options.scheduledAt ||
      Date.now() + (options.scheduledInDays || 1) * 86400000,
  });
  mockLog.push({ type: 'scheduleNotification', options });
  log('mock schedule', options.identifier, options.body);
}

export async function unscheduleNotification(identifier) {
  const sdk = globalJest();
  if (ready && sdk?.notifications?.unscheduleNotification) {
    return sdk.notifications.unscheduleNotification({ identifier });
  }
  mockScheduled.delete(identifier);
  mockLog.push({ type: 'unscheduleNotification', identifier });
}

export function getMockScheduled() {
  return [...mockScheduled.entries()].map(([id, v]) => ({ id, ...v }));
}

/** The local mock's catalog (Jest reports prices in minor units, cents; the mock matches). */
export const MOCK_PRODUCTS = Object.freeze([
  { sku: 'wc_gems_s', name: 'Gem Pouch', price: 199, currency: 'USD' },
  { sku: 'wc_gems_m', name: 'Gem Pack', price: 499, currency: 'USD' },
  { sku: 'wc_gems_l', name: 'Gem Crate', price: 999, currency: 'USD' },
  { sku: 'wc_gems_xl', name: 'Gem Vault', price: 1999, currency: 'USD' },
  { sku: 'wc_gems_xxl', name: 'Gem Hoard', price: 4999, currency: 'USD' },
  { sku: 'wc_starter_kit', name: "New Captain's Kit", price: 499, currency: 'USD' },
  { sku: 'wc_wall_spur', name: 'Corsair Breaker Pack', price: 499, currency: 'USD' },
  { sku: 'wc_wall_veil', name: 'Frigate Breaker Pack', price: 799, currency: 'USD' },
  { sku: 'wc_wall_ember', name: 'Raider Breaker Pack', price: 999, currency: 'USD' },
  { sku: 'wc_wall_hollow', name: 'Shade Breaker Pack', price: 1299, currency: 'USD' },
  { sku: 'wc_wall_crown', name: 'Throne Breaker Pack', price: 1499, currency: 'USD' },
]);

export async function getProducts() {
  const sdk = globalJest();
  if (ready && sdk?.payments?.getProducts) {
    return sdk.payments.getProducts();
  }
  return MOCK_PRODUCTS.map((p) => ({ ...p }));
}

// --- Subscriptions (https://docs.jest.com/sdk/subscriptions) -------------
// The mock mirrors the documented rules: a trial only for a wallet that never
// subscribed, a cancel keeps the entitlement until the period ends, and the
// retention discount can be claimed once, not during a trial.
const mockSubs = new Map();
function mockSubData(sku) {
  const s = mockSubs.get(sku) || {};
  return {
    sku,
    displayName: "Captain's Commission",
    displayDescription: null,
    price: 999,
    currency: 'USD',
    billingPeriod: 'monthly',
    status: s.active ? 'active' : 'inactive',
    trialEligible: !s.everSubscribed,
    introOffer: null,
    retentionOffer: s.active && !s.retentionClaimed && !s.inTrial ? { price: 599, durationPeriods: 2 } : null,
    sandbox: true,
    estimatedRevenue: 0,
  };
}
const MOCK_SUB_SKUS = ['wc_sub_commission'];
// The local SDK mock bridge has no subscription controls (a checkout never
// resolves), so outside real Jest the subscription calls use this mock.

export async function getSubscriptions() {
  const sdk = globalJest();
  if (ready && isReal() && sdk?.payments?.getSubscriptions) return sdk.payments.getSubscriptions();
  return { subscriptions: MOCK_SUB_SKUS.map(mockSubData), signed: '', mock: true };
}

export async function beginSubscription(subscriptionSku) {
  const sdk = globalJest();
  if (ready && isReal() && sdk?.payments?.beginSubscription) return sdk.payments.beginSubscription({ subscriptionSku });
  mockLog.push({ type: 'beginSubscription', subscriptionSku });
  const s = mockSubs.get(subscriptionSku) || {};
  if (s.active) return { result: 'error', error: 'already_subscribed' };
  // Local QA skips the 7-day trial state so the retention flow can be tried.
  mockSubs.set(subscriptionSku, { ...s, active: true, everSubscribed: true, inTrial: false });
  return { result: 'success', subscription: mockSubData(subscriptionSku), subscriptionSigned: '', mock: true };
}

export async function cancelSubscription(subscriptionSku) {
  const sdk = globalJest();
  if (ready && isReal() && sdk?.payments?.cancelSubscription) return sdk.payments.cancelSubscription({ subscriptionSku });
  mockLog.push({ type: 'cancelSubscription', subscriptionSku });
  const s = mockSubs.get(subscriptionSku);
  if (!s?.active) return { result: 'error', error: 'not_active' };
  // A real cancel lapses at period end; the mock lapses now so QA sees the change.
  mockSubs.set(subscriptionSku, { ...s, active: false });
  return { result: 'success' };
}

export async function claimRetentionOffer(subscriptionSku) {
  const sdk = globalJest();
  if (ready && isReal() && sdk?.payments?.claimRetentionOffer) return sdk.payments.claimRetentionOffer({ subscriptionSku });
  mockLog.push({ type: 'claimRetentionOffer', subscriptionSku });
  const s = mockSubs.get(subscriptionSku);
  if (!s?.active || s.inTrial) return { result: 'error', error: 'not_eligible' };
  mockSubs.set(subscriptionSku, { ...s, retentionClaimed: true });
  return { result: 'success', subscription: mockSubData(subscriptionSku), subscriptionSigned: '', mock: true };
}
