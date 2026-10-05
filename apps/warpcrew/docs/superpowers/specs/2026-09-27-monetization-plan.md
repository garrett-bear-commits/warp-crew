# Warp Crew monetization plan

Status: approved by Garrett 2026-09-27 (see Decisions). Grant amounts remain tunable after live data.
Framework: the five layers from [Game Money Mechanics #1](https://www.linkedin.com/pulse/game-money-mechanics-1-5-layer-iap-framework-puzzle-games-ghosh-maecf) (Offer, Moment, Sink, Loop, Player), with retention as the guardrail.
Constraints from Garrett (2026-09-27): Jest prices are in cents; **every product and every discount is its own SKU**; **nothing sells below $1.99**; subscriptions come later at **$9.99/month**, with a free trial or intro rate and a cancel-save offer of **2 months at $5.99**.
Principles kept from the [product direction](../../design/20-product-direction-draft.md): all combat power is earnable; offers are contextual and truthful; no fake scarcity or false discounts.

## Layer 1 — Offer: every SKU has a job

| SKU | Price | Contents (proposed) | Job | Who / when |
| --- | --- | --- | --- | --- |
| `wc_gems_s` | $1.99 | 100 gems | Entry ladder rung, lowest price allowed | Anyone, Shop |
| `wc_gems_m` | $4.99 | 280 gems (+12%) | Main repeat purchase | Payers, Shop |
| `wc_gems_l` | $9.99 | 600 gems (+20%) | Value tier | Payers, Shop |
| `wc_gems_xl` | $19.99 | 1,300 gems (+30%) | High spenders | Shop |
| `wc_gems_xxl` | $49.99 | 3,500 gems (+40%) | Price anchor; makes lower tiers feel reasonable | Shop |
| `wc_starter_kit` (one time) | $4.99 | 250 gems, 10 fuel, 50 medals, 800 credits | First purchase, deliberately generous (shipped as `wc_starter`) | One time, after first loss or 3rd post-tutorial contract, 48 h |
| `wc_wall_<sector>` (×5, one time each) | $4.99 / $7.99 / $9.99 / $12.99 / $14.99 | Gems, medals for levels, credits for the next upgrade, 1 free drydock finish | Wall breaker: solves the wall the player is facing | Once per wall, after a near-miss wall attempt or 2 days stuck |
| `wc_drydock_2` | $9.99 | Permanent second drydock slot | Convenience that compounds (loop) | After first timed upgrade finishes |
| `wc_sub_commission` (subscription) | $9.99/mo | 30 gems/day, +2 fuel tank, 1 free drydock finish/day | Predictable recurring value | Shop, after the intro |
| (trial on `wc_sub_commission`) | free 7 days, then $9.99/mo | Same | Starter trial | Wallets that never subscribed (Jest decides) |
| (retention offer on `wc_sub_commission`) | $5.99/mo × 2 | Same | Cancel-save offer | Shown when a subscriber taps Cancel, once |

The trial and the cancel-save discount are both set on the one `wc_sub_commission` SKU in the Jest console. Jest's docs warn that a second SKU for the same perks bills the player twice, and an intro offer cannot win back a subscriber. So there is no `wc_sub_commission_winback` SKU.

Retire `wc_fuel_5` ($0.99, below the floor). Fuel refills move to gems in-game (a sink, see layer 3). Every future discount (e.g. a sale on `wc_gems_l`) ships as its own SKU such as `wc_gems_l_sale40`; the regular SKU never changes price.

## Layer 2 — Moment: offer help when the need is obvious

| Moment | What we show | Why it works |
| --- | --- | --- |
| **Near miss** — a lost contract or wall attempt where the enemy had ≤ 20% hull left | **Rally**: restore 12 hull and fight on for 60 gems, once per fight. The **first Rally is free** to teach it. | The loss feels recoverable; the fix is exactly what they lacked. |
| Wall stuck 2+ days, or a near-miss wall attempt | The sector's `wc_wall_<sector>` pack, once | Solves the problem they can see on the siege meter. |
| First loss / settled in | `wc_starter_kit` (shipped) | First purchase is the hardest; make it generous. |
| Drydock build started with > 1 h left | Gem skip price on the button (shipped) | Timer is visible and the player chose it. |
| Returning after 3+ days away | A session-start welcome-back bundle (own SKU) | Real reason: they missed walls and daily plans. |

Rule: never show a paid offer on a failure the player cannot explain. Fight tells, threat labels and the siege meter are the fairness layer that make these moments feel like help.

## Layer 3 — Sink: create need through play, not difficulty alone

Gems are earned (daily login, wall takedowns +20, story beats) and spent on:
drydock finishes (~10/h), away-team recall (15), Rally (60), fuel refills (50 gems → 5 fuel), luck, hires, hull purchases.
Watch the gem buffer at each wall: if players arrive with hundreds of spare gems, raising wall difficulty will not create need — reduce earned gems before the wall instead.

## Layer 4 — Loop: purchases should move players forward

- Wall packs and drydock finishes produce progress (a new sector, a stronger system), and the next wall creates the next need.
- Timed upgrades lengthen with level, so progress naturally increases skip value without raising prices.
- The daily rhythm (morning fight + away team, midday upgrades, evening wall) gives spending a reason on every visit, not just after failure.
- Avoid pure refills; fuel exists but walls and upgrades carry the loop.

## Layer 5 — Player: segment by behaviour

| Segment | Default treatment |
| --- | --- |
| New (before first purchase) | Free first Rally; starter kit after first loss or settling in |
| Engaged non-payer | Rewarded ads for Rally or fuel **if** Jest supports ads (next framework issue); otherwise daily gem drip |
| First-time payer | Gem ladder mid tier; wall packs at walls |
| Repeat payer | Bundles over single items (wall packs, drydock slot, subscription at phase 4) |
| Lapsed / returning | Welcome-back bundle, free Rally refresh |

## Guardrails and metrics

| Layer | Metric |
| --- | --- |
| Offer | Conversion per SKU; SKUs that never sell |
| Moment | Conversion by trigger; offers shown without a clear need |
| Sink | Attempts per wall; fail rate and churn at each wall; gem buffer at wall arrival |
| Loop | What players buy in the 24 h after a purchase |
| Player | Conversion and retention by segment |
| **Guardrail** | D1/D7/D30 retention and churn at each wall; any revenue gain that raises churn at a wall is investigated before it counts |

## Build order

1. **Shipped:** starter kit, timed upgrades with gem skip, Siege walls, cents pricing.
2. **Next:** Rally continue (free first), gem fuel refill, gem ladder SKUs in code, retire `wc_fuel_5`, wall packs.
3. **Before any live sale:** verified purchase authority (idempotent server-side grants) and cloud save. Then add every SKU above to the Jest Developer Console.
4. **Later:** `wc_drydock_2`, subscription trio, welcome-back bundle, sale SKUs.

## Decisions (2026-09-27)

1. SKU ladder and prices approved. Nothing below $1.99; every product and every discount is its own SKU; Jest prices in cents.
2. Rally raised to 60 gems (first free) and fuel refill to 50 gems for 5 fuel — the proposed 30/20 were too cheap.
3. Wall packs approved; starter kit and every wall pack are one-time purchases.
4. Subscription: free 7-day trial, then $9.99/month; cancel-save/win-back at $5.99/month for 2 months. Built as Jest's trial and retention discount on `wc_sub_commission` (see Layer 1).

## Status

Built on branch `claude/hud-overhaul`: gem ladder SKUs, one-time starter kit and wall packs (near-miss / stuck triggers), Rally, gem fuel refill, drydock finish tokens, timed upgrades with gem skip, Siege walls. Remaining before any live sale: verified purchase authority and cloud save; then create every SKU in the Jest Developer Console. Subscription built (2026-09-28): `wc_sub_commission` with server-verified entitlement (`POST /v1/subscriptions/verify`), daily perks, and a cancel-save sheet. `wc_drydock_2`, welcome-back and sale SKUs follow.
