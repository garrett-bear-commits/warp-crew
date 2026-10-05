# Admin inspector

The support console for one player at a time ([ADR-021](../adr/ADR-021-admin-inspector-static-page.md)),
and [`scripts/admin.mjs`](#admin-cli), a CLI for the same admin API. Adopter guide:
[Admin inspector](../using-the-core/admin-inspector.md). Synced from a production game built on this
core (1 October 2026).

## The admin origin

The inspector page and the admin API share one origin, so a deployment exposes one admin domain:

- **In-process (local development, or a simple host).** With `apps/server/admin-inspector/dist`
  built (`pnpm -F @foundation/app-server build`), the API process serves the page on `ADMIN_PORT`
  (default 8081) and forwards `/admin/v1/*` into the API in-process (`apps/server/src/admin-static.ts`).
- **A separate admin service (recommended when hosted).** A small reverse proxy serves the built
  page and a health path, forwards only `/admin/v1/*` to the API's private address, and answers
  everything else (`/v1`, `/health`, `/ops`, `/qa`) with a JSON 404. The API then keeps no public
  admin route, and its `ADMIN_PORT` answers only on the private network.

Either way, only the headers the admin API reads go upstream: key id, secret, content type,
accept, request id, idempotency key, and Cloudflare Access's `Cf-Access-Jwt-Assertion`. Responses
carry the CSP `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` (plus
`PUBLIC_URL`'s origin in `connect-src` when set), `nosniff`, `no-referrer`, `DENY` and `no-store`.

The operator's address comes from the edge's `X-Real-IP` (never a client's `X-Forwarded-For`),
falling back to the socket peer. The edge in front of the admin origin must overwrite `X-Real-IP`;
then 60 bad keys a minute lock out only that address (`ip.authfail`, 429).

### Build settings

The inspector bakes two optional values at build time (`apps/server/Dockerfile` exposes both as
build `ARG`s):

| Variable | Effect |
| --- | --- |
| `VITE_GAME_CLIENT_URL` | The game URL **Play incognito** opens (default `http://localhost:5173`). HTTPS, or localhost HTTP; the inspector's own origin is refused. |
| `VITE_ADMIN_PRODUCTION_HOSTS` | Comma list of admin hosts badged **Production**. Without a match, a host naming `staging` is Staging, `localhost`/`127.0.0.1`/`::1`/`*.localhost` is Local, a host naming `prod` is Production, anything else Unknown. |

Grant reward fields come from the game's grant vocabulary: `admin-inspector/src/game-grants.ts`
is the only inspector file that names a game. It re-exports the template's
`apps/server/games/template/grants.ts`; a game points it at its own `games/<id>/grants.ts`, the
same vocabulary its policy enforces at mint (`GamePolicy.grantRewardProblem`). The image's build
stage copies `apps/server/games` for this.

## Sign in

1. Open the admin URL. Signed out, the page is only the **Game admin** sign-in card with the
   environment badge. Nothing else of the console exists in the page until a key is verified.
2. Enter the key id and secret, then **Sign in**. The page checks them with
   `GET /admin/v1/session` (any valid key, no scope), which answers the key id and its scopes. A
   wrong key, a network error or an expired Access session shows inline (behind Access: reload the
   page). The credentials stay in the tab's memory; **Sign out** or closing the tab drops them.
3. The console shows only what the key's scopes can use (`admin-inspector/src/scopes.ts`): a
   `read` key gets **Players** (lookup, timeline, saves, save viewer, **Play incognito**) and
   **Audit**, and no write forms; `support` adds letters, player flags and dead-letter replay;
   `grant` the single-player grant, **Fix purchase** and the cohort grant; `publish` the
   **Live ops** flag and content forms; `restore` **Restore to this save** and quarantine review.
   The top bar names the key and its scopes.
4. Find a player by their player key (the platform's player id, e.g. the Jest `playerId`).

## Play incognito

**Play incognito** on a retained save (Players → Saves; **Load older saves** reaches older ones)
opens the game at `VITE_GAME_CLIENT_URL` on that exact save in a popup, in memory only
([Disposable save sessions](../using-the-core/disposable-save-sessions.md)). Allow popups for the
admin origin. The save travels by `postMessage` after the handshake, never in the URL; nothing
reaches the API or durable browser storage, and closing the popup drops the branch. A pruned blob
cannot open.

## Keys

`ADMIN_KEYS` on the API holds `{"<keyId>": {"secretSha256": "<hex>", "scopes": [...]}}`, never a
secret. Issue at least two keys per environment:

| Key | Scopes | For |
| --- | --- | --- |
| `<env>-read-YYYYMMDD` | `read` | looking players up, saves, the audit log |
| `<env>-write-YYYYMMDD` | `read support grant publish restore` | support work that changes state |

Keep `erase` (irreversible, [erasure.md](erasure.md)) off routine keys: add a key with it only for
an erasure request and revoke it afterwards.

Operators keep their secrets in one private key file per environment,
`~/.config/foundation-admin/<env>-admin.env` (mode 600; `ADMIN_CONFIG_DIR` names another folder,
e.g. one per game): a `# <keyId> scopes=… issued=…` comment and a `<keyId>=<secret>` line per key,
`ADMIN_URL=` (the admin origin), and for an origin behind Cloudflare Access the CLI's service token
(`CF_ACCESS_CLIENT_ID=` and `CF_ACCESS_CLIENT_SECRET=`, both or neither). Never put a secret in
chat, tickets or the repository.

- **Issue with the script:** `pnpm admin:keys issue --env <env> --dry-run`, then without
  `--dry-run`. `scripts/admin-keys.mjs` issues a read key and a write key, writes their secrets
  into the key file (existing lines kept) and their sha256 and scopes into the API's `ADMIN_KEYS`
  (existing keys kept, a reused id refused). It prints key ids, scopes and paths only. Railway is
  its supported backend (a logged-in `railway` CLI): `--railway-environment <id>` (the
  environment's id, not its name), `--service` (default `api`) and `--admin-url`, or
  `RAILWAY_ENVIRONMENT_ID=` / `RAILWAY_SERVICE=` / `ADMIN_URL=` lines in the key file. Another host
  needs its own read/write functions. Without `--deploy` the API keeps running on the old keys
  until it restarts. `list` shows key ids and scopes; `revoke --key-id <id>` removes one; a second
  issue on one day needs `--suffix <tag>`. `--env production` also needs `--allow-production`.
- **Issue by hand:** generate a secret (`openssl rand -base64 32`), hash it
  (`printf %s "$SECRET" | shasum -a 256`), add `{secretSha256, scopes}` under a new key id,
  restart the API, and hand the secret over out of band. A reused id is a mistake: pick a new one.
- **Rotate:** issue new keys, restart, hand them out, then revoke the old ids.
- **Revoke:** remove the id from `ADMIN_KEYS` and restart the API; the running API accepts the
  key until it restarts. The API refuses to boot with no key at all.

## Actions

Every write is a command recorded in `admin_actions` (key id, scope, command, target player or
document, reason, outcome, request id, time) in the same transaction. Read it under **Audit →
Admin actions** (`GET /admin/v1/actions`, newest first). Reads are not recorded. A key without the
scope gets `403 forbidden` and an `admin scope violation` warning in the API log. Every inspector
write first shows what it will do and sends only on confirm; a network error or 5xx offers
**Retry (same commandId)**. Every write takes a reason: put the ticket in it.

| Inspector | API | Scope | What it does |
| --- | --- | --- | --- |
| Sign in | `GET /admin/v1/session` | any key | The key id and its scopes |
| Players → search | `GET /admin/v1/players/:key`, `…/timeline`, `…/saves` | read | Overview (generation, anchored save, pending quarantine, flags, paid purchases, unclaimed grants), timeline, saves |
| Players → Saves → View | `GET …/saves/:seq/blob` | read | The full save as JSON |
| Players → Actions → Send letter | `POST /admin/v1/letters` | support | A letter in the player's inbox, optionally carrying a grant key |
| Players → Actions → Set flag | `POST /admin/v1/players/flags` | support | Sets or clears a per-player flag, optionally until a time |
| Players → Actions → Mint grant | `POST /admin/v1/grants` | grant | Gives one player rewards, once per grant key. Fields come from the game's grant vocabulary; **Advanced (JSON)** takes raw rewards. Rewards outside the vocabulary are refused (`validation_failed`) |
| Players → Actions → Fix purchase | `POST /admin/v1/purchases/adjustments` | grant | Credit (`make_good`, paid premium currency, optional transaction id), refund (negative; adds a refund strike, the 3rd sets `purchases_disabled`) or correction (±, no strike). The game applies it when it next starts |
| Live ops → Cohort grant | `POST /admin/v1/grants/cohort` | grant | The same rewards for a segment; run the dry run first |
| Live ops → Flag / Content | `POST /admin/v1/liveops/flags`, `…/content` | publish | Publishes a flag or content document; every API replica picks it up within 30 s |
| Players → Saves → Restore to this save | `POST /admin/v1/players/restore` | restore | Opens a new generation seeded from that save; the old one is kept. Sends the loaded generation (a stale one is a 409). A running game adopts it on its next save push, any other on its next start |
| Players → Saves → Review | `POST /admin/v1/saves/reviews` | restore | Promotes or rejects a quarantined save; final ([quarantine-review.md](quarantine-review.md)) |
| Audit → Dead letters → Replay | `GET /admin/v1/outbox/dead-letters`, `POST …/outbox/replay` | read, support | [outbox-dead-letter-replay.md](outbox-dead-letter-replay.md) |

**Grants in the game.** The game applies a pending grant on its next start, once per grant key,
saves, then claims it. `grants_frozen` holds them all. A restore to a save from before an
already-claimed grant loses it: re-grant under a new key. A purchase that never arrived is a
**Fix purchase** credit, not a grant.

## Checks after a deploy

With `ADMIN=<admin origin>`:

- `curl -sI "$ADMIN/"` shows the CSP above.
- `curl -s -o /dev/null -w '%{http_code}\n' "$ADMIN/v1/config"` and `/health/ready` print 404;
  `/admin/v1/actions` without a key prints 401.
- With the read key: load a test player and view a save. With the write key: restore that test
  player to an earlier seq, then find the `lineage.adminRestore` row under **Admin actions**.
- The edge must overwrite a client's `X-Real-IP`. This locks your own address out of the admin API
  for up to a minute:
  `seq 70 | xargs -P 10 -I{} curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Real-IP: 203.0.113.{}' -H 'x-admin-key-id: probe' -H 'x-admin-secret: probe' "$ADMIN/admin/v1/actions" | sort | uniq -c`.
  Some 429s mean the header was overwritten. Only 401s mean a client can pick its address and
  dodge `ip.authfail`: fix the edge before production.

## Cloudflare Access in front of the admin origin

Optional, for a production admin origin. Cloudflare Access lets in only named logins and a service
token (for the CLI). Access is not the only gate: a host's own default domain for the admin
service usually skips it, so the API checks Access itself. With `CF_ACCESS_TEAM_DOMAIN` and
`CF_ACCESS_AUD` set on the API, every admin request needs a valid `Cf-Access-Jwt-Assertion`
(`packages/server/src/auth/cf-access.ts`):

- RS256 under the team's keys at `<team domain>/cdn-cgi/access/certs` (cached an hour, re-read for
  an unknown key id at most every 10 s), `iss` the team domain, `aud` containing the application's
  AUD tag, `exp`/`nbf` with 30 s of skew. A browser login carries `email`; a service token
  `common_name` (its client id).
- A request without a valid token gets `403 forbidden` with `details.reason`
  `cf_access_missing` (or `_malformed`, `_bad_alg`, `_unknown_key`, `_bad_signature`,
  `_wrong_issuer`, `_wrong_audience`, `_expired`, `_not_yet_valid`), logged as a `request refused`
  warning and counted toward `ip.authfail`, before any key check. If Cloudflare's keys were never
  readable the answer is 503 `retry_later`.
- The API's boot log says `cfAccess: true`. One variable without the other refuses to boot;
  neither set checks nothing (staging, local).
- The inspector sends its API calls with same-origin cookies, so Access's `CF_Authorization`
  cookie reaches the edge. When the Access session expires, API calls fail as a network error:
  reload the page and log in again.
- Behind Cloudflare's proxy, the edge's `X-Real-IP` may be a Cloudflare address, so `ip.authfail`
  counts per Cloudflare edge address; only Access-approved callers get that far.

Setup (owner, once):

1. **Zero Trust team.** Note the team domain, `https://<team>.cloudflareaccess.com`, and keep a
   login method (One-time PIN or an identity provider).
2. **Service token for the CLI** (Access → Service credentials). Store its client id and secret
   only in the operator's local credentials file; the secret is shown once.
3. **Access application** (self-hosted) on the admin hostname, with two policies in this order: an
   **Allow** policy including only the operators' login emails, and a **Service Auth** policy
   including the service token (Allow would send the CLI to a login page). Copy the application's
   AUD tag (64 hex characters).
4. **API variables:** `CF_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com` (no path) and
   `CF_ACCESS_AUD=<AUD tag>`; restart the API. From then on it refuses every admin request that did
   not come through Access.
5. **DNS and TLS:** a proxied record for the admin hostname pointing at the admin service, and SSL
   mode Full for it (never Flexible, which loops).
6. **Verify:** `curl -sI "$ADMIN/"` is answered by Access (a redirect to its login page); a
   browser login then shows the inspector; the admin service's direct host name answers
   `/admin/v1/actions` with a 403 envelope carrying `cf_access_missing`.

Rotating: refresh the service token in Zero Trust (or add a new one to the Service Auth policy
before deleting the old one) and replace the two `CF_ACCESS_` lines in the key file. A replaced
Access application has a new AUD tag: set `CF_ACCESS_AUD=<old>,<new>` while both exist, then only
the new one.

## Admin CLI

`scripts/admin.mjs` (`pnpm admin`, Node 24, no dependencies) calls the same admin API from a
terminal. It reads the environment's key file, uses a key whose scopes are exactly `read` unless
`--write` (then a key holding the write's scope), and never prints a secret. The admin origin is
`--url`, else `$ADMIN_URL`, else the key file's `ADMIN_URL=` line (no default; https only, except
localhost http). `--env NAME` picks the environment (default `staging`; `prod` means
`production`). `pnpm admin --help` lists everything, including the game's grant reward flags.

```sh
pnpm admin player <playerKey>              # generation, anchor, quarantine, flags
pnpm admin timeline <playerKey> --limit 50  # saves: seq, generation, disposition, progress
pnpm admin events <playerKey>               # saves, purchases, grants, integrity events
pnpm admin save <playerKey> 412 --full      # one save; --full: the decoded save JSON
pnpm admin audit --player <playerKey>       # admin actions on that player
```

Writes (`restore`, `letter`, `grant`, `adjust`) need `--write` and print a plan first; nothing
changes without `--yes`. The plan refuses an unknown or erased player, a missing or pruned seq
and a stale `--expected-generation` before anything is sent. Each run mints a fresh commandId;
after a network error or 5xx, re-run with the printed `--command-id` (an attempt that landed is
found in the audit log and not sent again). Production writes also need `--allow-production`.

```sh
pnpm admin restore <playerKey> --seq 412 --expected-generation 3 --reason "T-12 lost run" --write
pnpm admin restore <playerKey> --seq 412 --expected-generation 3 --reason "T-12 lost run" --write --yes
pnpm admin grant <playerKey> --grant-key ticket-12 --gems 100 --reason "T-12" --write --yes
pnpm admin adjust <playerKey> --kind make_good --delta 550 --transaction-id 42 --reason "T-14 pack never arrived" --write
pnpm admin adjust <playerKey> --kind refund --delta=-550 --transaction-id 42 --reason "T-15 provider refund" --write
```

`grant`'s reward flags come from the game's grant vocabulary (`scripts/admin.mjs` imports
`apps/server/games/template/grants.ts`; a game points that one import at its own
`games/<id>/grants.ts`): an amount field is `--<name> N`, a choice field a repeatable
`--<name> <option>`. `--rewards JSON` is the advanced form, checked against the same vocabulary
before sending. `adjust` fixes a purchase in the premium currency (named by the vocabulary):
`make_good` a positive `--delta`, `refund` a negative one written `--delta=-N` (adds a strike; the
3rd disables checkout), `correction` either sign; `--transaction-id` is the purchase's ref in
`events`.

Behind Cloudflare Access the CLI sends the key file's service token as `CF-Access-Client-Id` /
`CF-Access-Client-Secret` on every request. An Access refusal (a redirect to its login page, or
its own 401/403 page) points at the service token and the Service Auth policy; an API refusal of
the Access token shows its `cf_access_*` reason.

`--json` prints the API's answer (or the plan and result) as JSON on stdout; failures go to
stderr. Exit codes: 0 ok, 1 the request failed, 2 usage or refused. Tests: `pnpm test:scripts`.
