# Jest Developer Console: Warp Crew products

Prepared 2026-10-05 for the **staging / sandbox** Jest game only. Do not create these on the production game
until the staging session passes and real-money sales are approved.

Sources: SKUs, names and grants from `src/data/products.js` (the server's catalog is tested to match it);
prices from `docs/superpowers/specs/2026-09-27-monetization-plan.md`. Jest prices are in **cents**. Nothing
sells below $1.99. Each product and each discount is its own SKU.

The SKU must be typed exactly as below: the server grants by SKU and refuses unknown ones.

## One-time purchases (12 total with the subscription)

| # | SKU | Name | Price (cents) | Price | What the player gets | Buy limit |
|---|---|---|---:|---:|---|---|
| 1 | `wc_gems_s` | Gem Pouch | 199 | $1.99 | 100 gems | Repeatable |
| 2 | `wc_gems_m` | Gem Pack | 499 | $4.99 | 280 gems | Repeatable |
| 3 | `wc_gems_l` | Gem Crate | 999 | $9.99 | 600 gems | Repeatable |
| 4 | `wc_gems_xl` | Gem Vault | 1999 | $19.99 | 1,300 gems | Repeatable |
| 5 | `wc_gems_xxl` | Gem Hoard | 4999 | $49.99 | 3,500 gems | Repeatable |
| 6 | `wc_starter_kit` | New Captain's Kit | 499 | $4.99 | 250 gems, 10 fuel, 50 medals, 800 credits | Once per player |
| 7 | `wc_wall_spur` | Corsair Breaker Pack | 499 | $4.99 | 300 gems, 80 medals, 1,500 credits, 10 fuel, 1 drydock finish | Once per player |
| 8 | `wc_wall_veil` | Frigate Breaker Pack | 799 | $7.99 | 450 gems, 120 medals, 3,000 credits, 10 fuel, 1 drydock finish | Once per player |
| 9 | `wc_wall_ember` | Raider Breaker Pack | 999 | $9.99 | 600 gems, 160 medals, 5,000 credits, 10 fuel, 2 drydock finishes | Once per player |
| 10 | `wc_wall_hollow` | Shade Breaker Pack | 1299 | $12.99 | 800 gems, 220 medals, 8,000 credits, 10 fuel, 2 drydock finishes | Once per player |
| 11 | `wc_wall_crown` | Throne Breaker Pack | 1499 | $14.99 | 950 gems, 280 medals, 12,000 credits, 10 fuel, 3 drydock finishes | Once per player |

"Once per player" is enforced by the game server (a second payment is recorded for refund and never granted).
If the console has a consumable / non-consumable setting, set all eleven as **consumable**: the server, not
Jest, decides ownership, and Jest must be able to complete a refunded duplicate.

Suggested store descriptions (the in-game shop shows its own text):

- Gem packs: "+N gems for drydock skips, fuel and Rally."
- `wc_starter_kit`: "One time only: gems, fuel, medals and credits to get your crew flying."
- Wall packs: "One time only. Helps break this sector's flagship."

## Subscription

| SKU | Name | Billing | Price (cents) | Free trial | Cancel-save (retention) offer |
|---|---|---|---:|---|---|
| `wc_sub_commission` | Captain's Commission | Monthly | 999 | 7 days | 599 cents/month for 2 months |

- Set the trial and the retention discount **on this one SKU**. Do not make a second "win-back" SKU: Jest
  warns it would bill a subscriber twice.
- Perks (applied by the game, not Jest): 30 gems a day, 1 free drydock finish a day, +2 fuel tank.
- Description: "Captain's Commission: 30 gems and a free drydock finish every day, plus a bigger fuel tank."

## Not in this list (planned, not built)

`wc_drydock_2` (second drydock slot, $9.99), welcome-back bundle and sale SKUs. Add them only once the game
sells them; an unknown SKU is refused by the server.

## After creating them

1. Send me a screenshot of the product list (or confirm), and I check every SKU and price against this table.
2. On staging, the game reads prices from Jest (`getProducts`); the shop must show exactly these prices.
3. Sandbox purchases only grant when the staging server has sandbox delivery switched on; production never does.
