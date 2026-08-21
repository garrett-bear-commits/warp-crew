// Provider conformance (§4.3 "a conformance suite drives the mock through every path a real
// provider must pass", ADR-013). Framework-agnostic: returns named cases with an async boolean
// check; the vitest wrapper turns each into `it(...)`. Runs against ANY PlatformAdapter with an
// expectation profile (what THIS platform/pathology combination must do) so the same cases cover
// the mock under every pathology, the standalone platform, and a real SDK in a browser.
import type { PlatformAdapter, Player, PurchaseOutcome } from './types.ts';

export interface ConformanceCase {
  name: string;
  run(): Promise<boolean>;
}

export interface ConformanceExpectations {
  /** ready() resolves within the wait budget, or never (SDK hang pathology). */
  identityReady: 'resolves' | 'never';
  hasToken: boolean;
  /** When set, the harness triggers a switch and the adapter must report it. */
  identitySwitch?: { to: string; trigger: () => void } | undefined;
  purchase: 'success' | 'cancel' | 'error' | 'unsigned' | 'unsupported';
  incompletePurchases: number;
  kvWriteFails: boolean;
  /** 'echo' = readBreakGlass returns what was set+flushed; otherwise the fixed value. */
  kvBreakGlass: 'echo' | string | null;
  notificationsEligible: boolean;
}

export interface ConformanceHarness {
  /** Deterministic wait (drives injected timers in tests). */
  wait(ms: number): Promise<void>;
  /** Budget for ready() before we call it "never". */
  readyBudgetMs?: number;
  /** Optional controls let the shared suite verify lifecycle delivery, isolation, and teardown. */
  lifecycle?: { hide(): void; show(): void; exit(): void };
}

const settle = <T>(
  p: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );

export function platformConformance(
  platform: PlatformAdapter,
  expect: ConformanceExpectations,
  harness: ConformanceHarness,
): ConformanceCase[] {
  const { identity, payments, kv, notifications } = platform;
  const budget = harness.readyBudgetMs ?? 200;
  const readyRace = async (): Promise<'resolved' | 'pending'> => {
    let resolved = false;
    void identity.ready().then(() => {
      resolved = true;
    });
    await harness.wait(budget);
    return resolved ? 'resolved' : 'pending';
  };
  const whenReady = async (): Promise<Player | null> => {
    if ((await readyRace()) !== 'resolved') return null;
    return identity.getPlayer();
  };

  const cases: ConformanceCase[] = [
    {
      name: `identity.ready() ${expect.identityReady === 'resolves' ? 'resolves' : 'stays pending (SDK hang)'}`,
      run: async () =>
        (await readyRace()) === (expect.identityReady === 'resolves' ? 'resolved' : 'pending'),
    },
    {
      name: 'identity.isReady() agrees with ready()',
      run: async () => {
        const r = await readyRace();
        return identity.isReady() === (r === 'resolved');
      },
    },
    {
      name: 'getPlayer() is a player once ready (null before)',
      run: async () => {
        const p = await whenReady();
        if (expect.identityReady === 'never') return p === null;
        return (
          !!p &&
          typeof p.playerId === 'string' &&
          p.playerId.length > 0 &&
          typeof p.registered === 'boolean'
        );
      },
    },
    {
      name: `tokenFor(player) is ${expect.hasToken ? 'a token' : 'null'}; tokenFor(other) is null`,
      run: async () => {
        const p = await whenReady();
        if (!p) return expect.identityReady === 'never';
        const t = identity.tokenFor(p.playerId);
        const other = identity.tokenFor(`${p.playerId}-other`);
        return (
          (expect.hasToken ? typeof t === 'string' && t.length > 0 : t === null) && other === null
        );
      },
    },
    {
      name: 'previousToken() is null before any identity switch',
      run: async () => identity.previousToken() === null || expect.identitySwitch !== undefined,
    },
    {
      name: 'identity switch fires (prev, next) and previousToken() is usable exactly once',
      run: async () => {
        if (!expect.identitySwitch) return true;
        const p = await whenReady();
        if (!p) return false;
        let seen: { prev: Player | null; next: Player } | null = null;
        const off = identity.onIdentityChanged((prev, next) => {
          seen = { prev, next };
        });
        expect.identitySwitch.trigger();
        await harness.wait(0);
        off();
        const s = seen as { prev: Player | null; next: Player } | null;
        if (!s || s.next.playerId !== expect.identitySwitch.to || s.prev?.playerId !== p.playerId)
          return false;
        const first = identity.previousToken();
        const second = identity.previousToken();
        return (
          !!first &&
          first.playerId === p.playerId &&
          (expect.hasToken ? first.token.length > 0 : true) &&
          second === null
        );
      },
    },
    {
      name: 'payments.products() resolves an array of {sku,title}',
      run: async () => {
        const r = await settle(payments.products());
        return (
          r.ok &&
          Array.isArray(r.value) &&
          r.value.every((x) => typeof x.sku === 'string' && typeof x.title === 'string')
        );
      },
    },
    {
      name: `payments.begin() → ${expect.purchase}`,
      run: async () => {
        const r = await settle(payments.begin('pack_small'));
        if (expect.purchase === 'error') return !r.ok || r.value.kind === 'error';
        if (expect.purchase === 'unsupported') return r.ok && r.value.kind === 'error';
        if (!r.ok) return false;
        const o: PurchaseOutcome = r.value;
        if (expect.purchase === 'cancel') return o.kind === 'cancel';
        if (o.kind !== 'success' || !o.purchaseToken) return false;
        return expect.purchase === 'unsigned'
          ? o.purchaseSigned === undefined
          : typeof o.purchaseSigned === 'string';
      },
    },
    {
      name: 'payments.complete(token) preserves a completion verdict',
      run: async () => {
        const r = await settle(payments.complete('any-token'));
        return (
          r.ok &&
          (r.value.kind === 'success' ||
            r.value.kind === 'retryable_error' ||
            r.value.kind === 'invalid_token')
        );
      },
    },
    {
      name: `payments.recoverIncomplete() yields ${expect.incompletePurchases} grant call(s) with signed batch evidence`,
      run: async () => {
        const seen: string[] = [];
        let signed = 0;
        const r = await settle(
          payments.recoverIncomplete(
            async (p) => {
              seen.push(p.purchaseToken);
              return true;
            },
            () => {
              signed++;
            },
          ),
        );
        return (
          r.ok &&
          seen.length === expect.incompletePurchases &&
          signed === (expect.incompletePurchases > 0 ? 1 : 0)
        );
      },
    },
    {
      name: 'payments.recoverIncompleteBatch() returns an observable completion report',
      run: async () => {
        const r = await settle(
          payments.recoverIncompleteBatch(async (batch) =>
            batch.purchases.map((purchase) => purchase.purchaseToken),
          ),
        );
        return (
          r.ok &&
          r.value.outcome === 'drained' &&
          r.value.completed.length === expect.incompletePurchases &&
          r.value.retryable.length === 0 &&
          r.value.invalid.length === 0
        );
      },
    },
    {
      name: 'kv.set/delete never throw synchronously',
      run: async () => {
        try {
          kv.set('conformance:k', 'v');
          kv.delete('conformance:gone');
          return true;
        } catch {
          return false;
        }
      },
    },
    {
      name: `kv.flush() ${expect.kvWriteFails ? 'rejects (write failure surfaces at flush)' : 'resolves'}`,
      run: async () => {
        kv.set('conformance:k2', 'v2');
        const r = await settle(kv.flush());
        return expect.kvWriteFails ? !r.ok : r.ok;
      },
    },
    {
      name: 'kv.readBreakGlass() returns string|null (break-glass only)',
      run: async () => {
        kv.set('conformance:bg', 'mirror');
        await settle(kv.flush());
        const r = await settle(kv.readBreakGlass('conformance:bg'));
        if (!r.ok) return false;
        if (expect.kvBreakGlass === 'echo')
          return expect.kvWriteFails ? r.value === null : r.value === 'mirror';
        return r.value === expect.kvBreakGlass;
      },
    },
    {
      name: `notifications.eligible() === ${expect.notificationsEligible}`,
      run: async () => notifications.eligible() === expect.notificationsEligible,
    },
    {
      name: 'notifications.scheduleLadder(): every id is scheduled or failed exactly once',
      run: async () => {
        const items = [
          {
            id: 'cb1',
            title: 'Come back',
            body: 'Your base misses you',
            delaySec: 3600,
            slot: 'comeback',
          },
          {
            id: 'cb2',
            title: 'Come back',
            body: 'Rewards waiting',
            delaySec: 86_400,
            slot: 'comeback',
          },
          { id: 'cb3', title: 'Come back', body: 'Last call', delaySec: 259_200, slot: 'comeback' },
        ];
        const r = await settle(notifications.scheduleLadder(items));
        if (!r.ok) return false;
        const all = [...r.value.scheduled, ...r.value.failed.map((f) => f.id)].sort();
        const ids = items.map((i) => i.id).sort();
        if (JSON.stringify(all) !== JSON.stringify(ids)) return false;
        return expect.notificationsEligible
          ? r.value.scheduled.length === 3
          : r.value.failed.length === 3;
      },
    },
    {
      name: 'notifications.unschedule() resolves',
      run: async () => (await settle(notifications.unschedule('cb1'))).ok,
    },
    {
      name: 'share.available() is boolean and share() resolves boolean',
      run: async () => {
        if (typeof platform.share.available() !== 'boolean') return false;
        const r = await settle(platform.share.share({ title: 't', text: 'x' }));
        return r.ok && typeof r.value === 'boolean';
      },
    },
    {
      name: 'analytics.track() never throws',
      run: async () => {
        try {
          platform.analytics.track('conformance', { n: 1, ok: true, s: 'x' });
          return true;
        } catch {
          return false;
        }
      },
    },
    {
      name: 'loading.markLoaded() twice is safe; progress() never throws',
      run: async () => {
        try {
          platform.loading.markLoaded();
          platform.loading.markLoaded();
          platform.loading.progress(0.5);
          return true;
        } catch {
          return false;
        }
      },
    },
    {
      name: 'lifecycle.visible() is boolean; subscriptions return unsubscribe functions',
      run: async () => {
        if (typeof platform.lifecycle.visible() !== 'boolean') return false;
        const a = platform.lifecycle.onVisibilityChange(() => {});
        const b = platform.lifecycle.onPageHide(() => {});
        a();
        b();
        return true;
      },
    },
    {
      name: 'lifecycle hide/show/exit delivery is isolated and unsubscribable',
      run: async () => {
        if (!harness.lifecycle) return true;
        const events: string[] = [];
        const hideOff = platform.lifecycle.onHide(() => {
          events.push('hide');
        });
        const showOff = platform.lifecycle.onShow(() => {
          events.push('show');
        });
        const exitOff = platform.lifecycle.onExitRequested(() => {
          events.push('exit');
        });

        harness.lifecycle.hide();
        if (events.join(',') !== 'hide' || platform.lifecycle.visible()) return false;
        harness.lifecycle.show();
        if (events.join(',') !== 'hide,show' || !platform.lifecycle.visible()) return false;
        harness.lifecycle.exit();
        if (events.join(',') !== 'hide,show,exit') return false;

        hideOff();
        showOff();
        exitOff();
        harness.lifecycle.hide();
        harness.lifecycle.show();
        harness.lifecycle.exit();
        return events.join(',') === 'hide,show,exit';
      },
    },
    {
      name: 'errors.report() never throws',
      run: async () => {
        try {
          platform.errors.report({ kind: 'game_error', at: 0, message: 'conformance' });
          return true;
        } catch {
          return false;
        }
      },
    },
  ];
  return cases;
}
