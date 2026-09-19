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
  registered: true,
  username: 'Local Captain',
  avatarUrl: null,
};

const mockLog = [];
const mockScheduled = new Map();

function log(...args) {
  if (typeof console !== 'undefined') console.info('[platform]', ...args);
}

export function isReal() {
  return Boolean(globalJest());
}

export function isReady() {
  return ready;
}

export function getMockLog() {
  return [...mockLog];
}

export async function init(options = {}) {
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
    return { mode: 'jest' };
  } catch (e) {
    console.warn('[platform] init failed, continuing in degraded mode', e);
    ready = true;
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

export const cloudData = {
  get(key) {
    const sdk = globalJest();
    if (ready && sdk?.data?.get) return sdk.data.get(key);
    try {
      const raw = localStorage.getItem('warpcrew.cloud.' + key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  },
  set(keyOrObj, value) {
    const sdk = globalJest();
    if (ready && sdk?.data?.set) {
      if (typeof keyOrObj === 'object') return sdk.data.set(keyOrObj);
      return sdk.data.set({ [keyOrObj]: value });
    }
    if (typeof keyOrObj === 'object') {
      for (const [k, v] of Object.entries(keyOrObj)) {
        localStorage.setItem('warpcrew.cloud.' + k, JSON.stringify(v));
      }
      return;
    }
    localStorage.setItem('warpcrew.cloud.' + keyOrObj, JSON.stringify(value));
  },
  async flush() {
    const sdk = globalJest();
    if (ready && sdk?.data?.flush) return sdk.data.flush();
  },
};

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

export async function getProducts() {
  const sdk = globalJest();
  if (ready && sdk?.payments?.getProducts) {
    return sdk.payments.getProducts();
  }
  return [
    { sku: 'wc_fuel_5', name: 'Fuel Cell ×5', price: 0.99, currency: 'USD' },
    { sku: 'wc_gems_100', name: 'Gem Pack 100', price: 1.99, currency: 'USD' },
    { sku: 'wc_starter', name: 'Starter Pack', price: 4.99, currency: 'USD' },
    { sku: 'wc_gems_500', name: 'Gem Crate 500', price: 7.99, currency: 'USD' },
  ];
}

export async function purchaseProduct(productSku) {
  const sdk = globalJest();
  if (ready && sdk?.payments?.beginPurchase) {
    const begin = await sdk.payments.beginPurchase({ productSku });
    if (begin.result === 'cancel') return { ok: false, cancelled: true };
    if (begin.result === 'error')
      return { ok: false, error: begin.error || 'error' };
    return {
      ok: true,
      purchase: begin.purchase,
      purchaseSigned: begin.purchaseSigned,
      productSku: begin.purchase?.productSku || productSku,
    };
  }
  mockLog.push({ type: 'purchase', productSku });
  return {
    ok: true,
    purchase: {
      purchaseToken: 'local_' + productSku + '_' + Date.now(),
      productSku,
      createdAt: Date.now(),
      completedAt: null,
      price: 0,
      currency: 'USD',
      sandbox: true,
    },
    productSku,
    mock: true,
  };
}

export async function completePurchase(purchaseToken) {
  const sdk = globalJest();
  if (ready && sdk?.payments?.completePurchase) {
    return sdk.payments.completePurchase({ purchaseToken });
  }
  mockLog.push({ type: 'completePurchase', purchaseToken });
  return { result: 'success' };
}

export async function getIncompletePurchases() {
  const sdk = globalJest();
  if (ready && sdk?.payments?.getIncompletePurchases) {
    return sdk.payments.getIncompletePurchases();
  }
  return { hasMore: false, purchases: [], purchasesSigned: '' };
}
