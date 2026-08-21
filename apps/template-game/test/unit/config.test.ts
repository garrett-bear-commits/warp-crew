import { describe, expect, it } from 'vitest';
import { createStorage, memoryStorage } from '@foundation/client';
import { readConfig } from '../../src/config.ts';

const storage = () => createStorage({ localStorage: memoryStorage() });

describe('template runtime configuration', () => {
  it('locks a production Jest build against URL platform and QA overrides', () => {
    const cfg = readConfig(storage(), {
      production: true,
      env: {
        VITE_PLATFORM: 'jest',
        VITE_API_URL: '/v1',
        VITE_BUILD_VERSION: 'prod-7',
      },
      search: '?platform=mock&player=attacker&guest=1&token=from-url&pushMs=1000',
    });

    expect(cfg).toMatchObject({
      platform: 'jest',
      apiUrl: '/v1',
      buildVersion: 'prod-7',
      token: null,
      pushMs: 60_000,
    });
    expect(cfg.playerId).not.toBe('attacker');
  });

  it('retains explicit query controls for local development and tests', () => {
    const cfg = readConfig(storage(), {
      production: false,
      env: { VITE_PLATFORM: 'jest' },
      search: '?platform=standalone&player=qa_7&guest=1&token=qa-token&pushMs=1200',
    });

    expect(cfg).toMatchObject({
      platform: 'standalone',
      playerId: 'qa_7',
      registered: false,
      token: 'qa-token',
      pushMs: 1200,
    });
  });

  it('allows QA identity controls only in an explicitly flagged production test build', () => {
    const cfg = readConfig(storage(), {
      production: true,
      env: { VITE_PLATFORM: 'mock', VITE_ALLOW_QA_QUERY: 'true' },
      search: '?platform=jest&player=e2e_9&guest=1&pushMs=1500',
    });

    expect(cfg).toMatchObject({
      platform: 'mock',
      playerId: 'e2e_9',
      registered: false,
      pushMs: 1500,
    });
  });

  it('exposes the build-time auto-login reminder choice', () => {
    expect(
      readConfig(storage(), {
        production: true,
        env: { VITE_PLATFORM: 'jest', VITE_AUTO_LOGIN_REMINDERS: 'false' },
      }).autoLoginReminders,
    ).toBe(false);
    expect(
      readConfig(storage(), {
        production: true,
        env: { VITE_PLATFORM: 'jest' },
      }).autoLoginReminders,
    ).toBe(true);
  });

  it('fails a normal production build toward Jest rather than silently shipping mock mode', () => {
    expect(
      readConfig(storage(), {
        production: true,
        env: {},
        search: '?platform=mock',
      }).platform,
    ).toBe('jest');
  });
});
