// Shared helpers for the acceptance suite: the lab API (admin key + ops secret from e2e/server.ts),
// mock player tokens (the same shape the game's mock platform mints), fresh player ids per spec,
// page helpers for the game UI. Time comes from the API's serverNow, never from Date.now.
import { expect, type Page } from '@playwright/test';
import { E2E_ADMIN_SECRET, E2E_OPS_SECRET } from './const.ts';

export const API = 'http://127.0.0.1:8090';
export const GAME = 'http://localhost:4173';
export const HOST = 'http://127.0.0.1:4174';

export const adminHeaders = {
  'x-admin-key-id': 'e2e',
  'x-admin-secret': E2E_ADMIN_SECRET,
  'content-type': 'application/json',
};
export const opsHeaders = { 'x-ops-secret': E2E_OPS_SECRET, 'content-type': 'application/json' };

export const uuid = (): string => crypto.randomUUID();
export const freshPlayer = (): string => `p-${uuid()}`;

export async function serverNow(): Promise<number> {
  const r = await fetch(`${API}/health`);
  const b = (await r.json()) as { serverNow: number };
  return b.serverNow;
}

/** Same shape as the game's mock platform / jest-verify mintMockToken. iat = serverNow. */
export async function playerHeaders(
  playerId: string,
  opts: { registered?: boolean; build?: string } = {},
): Promise<Record<string, string>> {
  const now = await serverNow();
  const h: Record<string, string> = {
    'x-player-key': playerId,
    authorization: `Bearer mock.${playerId}.${now}${opts.registered === false ? '' : '.registered'}`,
    'content-type': 'application/json',
  };
  if (opts.build) h['x-build-version'] = opts.build;
  return h;
}

export async function admin<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: T }> {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ commandId: uuid(), ...body }),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}

export async function adminGet<T = Record<string, unknown>>(
  path: string,
): Promise<{ status: number; body: T }> {
  const r = await fetch(`${API}${path}`, { headers: adminHeaders });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}

export async function playerGet<T = Record<string, unknown>>(
  playerId: string,
  path: string,
  opts: { build?: string } = {},
): Promise<{ status: number; body: T }> {
  const r = await fetch(`${API}${path}`, { headers: await playerHeaders(playerId, opts) });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}

export async function playerCall<T = Record<string, unknown>>(
  playerId: string,
  method: 'POST' | 'PUT',
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: T }> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: await playerHeaders(playerId),
    body: JSON.stringify({ commandId: uuid(), ...body }),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}

export interface HistoryItem {
  seq: number;
  progress: number;
  disposition: string;
  reason: string;
  flags: string[];
  generation: number;
}

export async function history(playerId: string): Promise<HistoryItem[]> {
  const r = await playerGet<{ items: HistoryItem[] }>(playerId, '/v1/saves/history?limit=100');
  return r.body.items;
}

export function gameUrl(playerId: string, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ player: playerId, ...extra });
  return `${GAME}/?${p.toString()}`;
}

/** Open the game for a player and wait until the boot machine is live. */
export async function openGame(
  page: Page,
  playerId: string,
  extra: Record<string, string> = {},
): Promise<void> {
  await page.goto(gameUrl(playerId, extra));
  await waitBooted(page);
}

export async function waitBooted(page: Page): Promise<void> {
  await expect(page.getByTestId('app')).toHaveAttribute('data-booted', '1', { timeout: 20_000 });
}

export async function clickTimes(page: Page, n: number): Promise<void> {
  const btn = page.getByTestId('click');
  for (let i = 0; i < n; i++) await btn.click();
}

/** Save now and wait until the server acknowledged a NEW seq (the pill alone can be stale). */
export async function saveNow(page: Page): Promise<number> {
  const before = Number(await page.getByTestId('diag-seq').textContent());
  await page.getByTestId('save-now').click();
  await expect
    .poll(async () => Number(await page.getByTestId('diag-seq').textContent()), {
      timeout: 15_000,
    })
    .toBeGreaterThan(before);
  await expect(page.getByTestId('sync-pill')).toContainText('Saved to cloud', { timeout: 15_000 });
  return Number(await page.getByTestId('diag-seq').textContent());
}

export const counterOf = async (page: Page): Promise<number> =>
  Number(await page.getByTestId('counter').textContent());
export const goldOf = async (page: Page): Promise<number> =>
  Number(await page.getByTestId('gold').textContent());

/** Run `action` and wait until the page has reloaded (a fresh window without our marker) and booted. */
export async function withReload(page: Page, action: () => Promise<void>): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __e2eMark?: number }).__e2eMark = 1;
  });
  await action();
  await expect
    .poll(
      () =>
        page
          .evaluate(() => (window as unknown as { __e2eMark?: number }).__e2eMark ?? null)
          .catch(() => null),
      { timeout: 20_000 },
    )
    .toBeNull();
  await waitBooted(page);
}
