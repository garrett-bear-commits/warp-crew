# Phase B — Jest SDK, IAP, Notifications

## Integration
- Script: `https://cdn.jest.com/sdk/latest/jestsdk.js` in `index.html`
- Adapter: `src/shared/platform.js` (real SDK + local mock)
- Docs used: [HTML5](https://docs.jest.com/sdk/html5), [Notifications](https://docs.jest.com/sdk/notifications), [Payments](https://docs.jest.com/sdk/payments), [Platform login](https://docs.jest.com/sdk/platform-login)

## Lifecycle
1. `JestSDK.init({ autoLoginReminders: false })`
2. `setLoadingProgress` / `markGameLoaded`
3. `getPlayer`, `getEntryPayload` (deep-link from notifs)
4. Session analytics via `captureEvent`

## Notifications (identifiers)
| ID | When |
|----|------|
| `wc_fuel_full` | Exact time when tank will be full |
| `wc_expedition_done` | Expedition `endAt` |
| `wc_daily_pull` | Fuzzy D+1 after free pull used |
| `wc_comeback_d1` / `d3` | Soft return series |

Rescheduled on claim / expedition launch / gacha / boot.

## IAP SKUs (register in Dev Console)
| SKU | Grant |
|-----|--------|
| `wc_fuel_5` | +5 fuel |
| `wc_gems_100` | +100 gems |
| `wc_gems_500` | +500 gems |
| `wc_starter` | fuel 10 + gems 150 + medals 30 + credits 500 |

Flow: `beginPurchase` → **grant** → `completePurchase`. Incomplete purchases drained on boot.

## Local dev
Without Jest shell: mock purchase succeeds, notifications log to console / mock map. UI shows `SDK: local mock`.
