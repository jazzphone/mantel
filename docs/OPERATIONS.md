# Operating Mantel

How to run Mantel Server and look after it: first start, people and tablets, commands and their safeguards, the audit log, backups, updates, installing HK builds into Home Assistant, and what to do when something looks wrong. For the design behind it see [PLAN.md](PLAN.md); for moving the house over see [phase6/CUTOVER.md](phase6/CUTOVER.md).

**Status as of 2026-10-18.** Mantel Server is built and tested offline and against a scratch Home Assistant. It has not been deployed on the house, and the container images have never been built (Docker is not installed on the development Mac). Everything below that depends on Docker or Proxmox is written from the files and their static checks and is marked **(unverified)** where a first real run may change it. "Known gaps" at the end lists what is missing today. Pages that are **in progress** and not written yet: `HA-APP.md` (the App's Ingress mode), `ADMIN-PAGE.md` (managing people and tablets in the page) and `BACKUP-FILES.md` (backups and "your files").

Contents: [1](#1-the-parts-and-the-two-doors) parts and doors · [2](#2-running-the-server) running · [3](#3-the-first-owner) first Owner · [4](#4-linking-home-assistant-users) linking HA users · [5](#5-wall-tablets-accounts-enrolment-pins) tablets and PINs · [6](#6-service-accounts-for-linked-mode) service accounts · [7](#7-importing-hks-settings-from-home-assistant) settings import · [8](#8-enabling-commands) enabling commands · [9](#9-reading-the-audit-log) audit · [10](#10-backups-and-restore) backups · [11](#11-updating-mantel) updating · [12](#12-installing-hk-builds-into-home-assistant) HK builds · [13](#13-the-scratch-home-assistant) scratch HA · [14](#14-troubleshooting) troubleshooting · [15](#15-known-gaps) gaps.

## 1. The parts and the two doors

| Part | What it is |
|---|---|
| **Mantel Server** (`hosts/server/mantel_server`) | One Python service. The only thing that holds the Home Assistant and Music Assistant credentials. Owns people, roles, devices, settings and the audit log in one SQLite file. Serves the HK web app. |
| **Caddy** | TLS in the container stacks (or your own reverse proxy instead: section 2, "HTTPS"). It stamps `X-Mantel-Door: lan` or `tunnel` on every request. Mantel Server sets its own CSP, HSTS and the other security headers. |
| **go2rtc / transcode** | Live TV and cameras (compose stack only). Its viewing paths reach pages only through Mantel's `/go2rtc/` (sign-in, RBAC). |
| **`hk_frontend`** (in HA) | Today's HK Frontend, unchanged, or in *linked mode* the thin piece that forwards `hk_frontend.*` actions to Mantel. |
| **Mantel Connect** | A small HA App that puts a Mantel running outside HA (Docker, an LXC) in HA's sidebar and the Companion app. Paired once with a one-time code (section 4a); not needed when Mantel runs as the Mantel App. |

Every request arrives by a **door**. `lan` is the house network, served straight by Caddy. `tunnel` is anything coming through Cloudflare. A wall tablet's device credential, a Service account and a plain password sign-in all behave differently on the two doors (device credentials are refused on `tunnel`; a password alone is not enough on `tunnel`; sessions last 30 days on `lan`, 12 hours on `tunnel`). The door is believed only from a trusted proxy (section 2).

## 2. Running the server

### By hand (development, loopback only)

```bash
~/.venvs/mantel/bin/mantel-server                       # http://127.0.0.1:8765/login
~/.venvs/mantel/bin/mantel-server --ha-url http://192.0.2.53:8123 --commands-enabled   # do not, see section 8
```

It reads Home Assistant's token from `~/.config/mantel/ha_token` and stops with a message if the file is missing. The startup line says what mode it is in: `read-only; commands disabled`, or `COMMANDS ENABLED (...)`. Open `/login` (passkey, user name + password with the authenticator code when one is set up, or "Sign in with Home Assistant"; see [phase3/LOGIN-PAGE.md](phase3/LOGIN-PAGE.md)); it then goes on to `/home` (the default screen), or back to the page that sent you there.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--ha-url` | `http://192.0.2.53:8123` | Home Assistant's address. |
| `--token-file` | `~/.config/mantel/ha_token` | Mantel's HA token, read at startup and never printed. The HA user must be an administrator (HK Settings' read needs one, and the command path uses it). |
| `--port` | `8765` | Listening port. |
| `--listen ADDRESS` | loopback only | Container mode. Needs `--public-url`. Without `--listen` the server binds `127.0.0.1` and nothing else is possible. |
| `--public-url URL` | none | The `https://` address browsers use (through Caddy). It becomes HA's OAuth `client_id`, so "Sign in with Home Assistant" works behind Caddy. |
| `--allow-host NAME` | none | Further Host names to accept (repeatable). `*` is for the HA App only. |
| `--trusted-proxy ADDRESS` | none | A reverse proxy whose `X-Mantel-Door` and `X-Forwarded-For`/`-Proto`/`-Host` are believed (repeatable, exact IP address). With none, every request through a proxy counts as `tunnel` (fail closed: wall tablets are refused). A trusted proxy that sends no door header is `tunnel` too. HA identity headers are never believed from it. |
| `--ma-web-url URL` | the host of `--ma-url` | Music Assistant's web app, served to pages under `/ma/` (section 2, "Music Assistant and go2rtc through Mantel"). |
| `--go2rtc-url URL` | none | go2rtc's API; its viewing paths are served under `/go2rtc/`. |
| `--frame-ancestors`, `--csp-connect-src`, `--csp-frame-src` | none | Extra CSP origins (repeatable). By default only Mantel's own pages may frame it. |
| `--proxy-kind caddy\|own` | none | Which proxy owns TLS; tunes `/proxy-check`'s advice. |
| `--connect` | off | Mantel Connect: a second TLS listener for the Connect App (client certificates only) and pairing. Implies Ingress identity from a **paired** App, trusting no socket address. Section 4a. |
| `--connect-port`, `--connect-listen`, `--connect-address` | `8766`, `0.0.0.0`, none | The listener's port and address; the address `/admin` shows the Owner to type into the App. |
| `--data-dir` | `~/.local/share/mantel` | Where `mantel.db` lives. |
| `--secrets-dir` | `~/.config/mantel/secrets` | Folder of secret files (the at-rest key). |
| `--commands-enabled` | off | Turns the command gateway on. See section 8. |
| `--house-tz` | `UTC` | Time zone for grant schedules when HA does not say. HA's own zone is used once read. |
| `--audit-retention-days` | `365` | Audit rows older than this are purged hourly. Must be at least 30. |
| `--lan-session-days`, `--session-hours` | `30`, `12` | Session lifetimes on the `lan` and `tunnel` doors. |
| `--rp-id` | `localhost` | Passkey relying-party id: a **hostname**, never an IP. Set it to the real name before anyone registers a passkey. |
| `--screen` | `dashboard-kitchen` | The screen `/home` opens. |
| `--default-interval`, `--override GLOB=SECONDS` | 0 | Coalescing of fast sensors (for example `'sensor.*_distance=1'`). |

### In the container stacks (Docker, LXC)

The entrypoint turns `MANTEL_*` variables from `packaging/compose/.env` into those flags. None of them is secret.

| Variable | Becomes | Notes |
|---|---|---|
| `MANTEL_HA_URL`, `MANTEL_PUBLIC_URL` | `--ha-url`, `--public-url` | Required. |
| `MANTEL_ALLOW_HOSTS` | `--allow-host` | Comma list, for example the LAN IP. |
| `MANTEL_TRUSTED_PROXY` | `--trusted-proxy` | Compose sets Caddy's fixed backend address `172.31.251.2`. Must be IP addresses. |
| `MANTEL_DEFAULT_SCREEN`, `MANTEL_SESSION_HOURS` | `--screen`, `--session-hours` | Optional. |
| `MANTEL_DATA_DIR`, `MANTEL_PORT`, `MANTEL_LISTEN`, `MANTEL_HA_TOKEN_FILE` | | Defaults `/data`, `8765`, `0.0.0.0`, `/run/secrets/ha_token`. |
| `MANTEL_CONNECT`, `MANTEL_CONNECT_ADDRESS`, `MANTEL_HA_DOOR_RULES` | `--connect`, `--connect-address`, `--ha-door-rules` | Mantel Connect (section 4a). `compose.connect.yaml` sets the first; the rules default to `trusted`. |
| `MANTEL_MA_WEB_URL`, `MANTEL_GO2RTC_URL` | `--ma-web-url`, `--go2rtc-url` | Compose points go2rtc at the stack's own (`http://go2rtc:1984`). |
| `MANTEL_FRAME_ANCESTORS`, `MANTEL_CONNECT_SRC`, `MANTEL_FRAME_SRC` | the CSP flags | Space or comma separated origins. They moved from Caddy to Mantel Server. |
| `MANTEL_PROXY_KIND` | `--proxy-kind` | Set by `compose.yaml` (`caddy`) and `compose.byo-proxy.yaml` (`own`). |
| `MANTEL_HTTP_BIND`, `MANTEL_HTTP_PORT` | | Bring your own proxy only: the address and port Mantel publishes for it (default all addresses, `8765`). |

There is deliberately **no** environment variable for `--commands-enabled`. See section 8.

### HTTPS: four ways

Mantel needs HTTPS for its sign-in cookies, passkeys and talk-back, and so that Music Assistant's frame and go2rtc's sockets work (they go through Mantel, below). Pick one; the HA App needs none of this (Home Assistant's own address and Ingress serve it).

| | You have | Do this | The door header |
|---|---|---|---|
| **1. Mantel's Caddy, your domain** | a domain on Cloudflare DNS | the default: `MANTEL_TLS_SNIPPET=./caddy/tls-dns01.caddy`, `mantel-secret cloudflare_dns_token` (a token limited to Zone, DNS, Edit for that one zone), `MANTEL_HOSTNAME=mantel.<your domain>`, a LAN DNS record pointing that name at the host | Caddy stamps it |
| **2. Mantel's Caddy, its own CA** | no domain | `MANTEL_TLS_SNIPPET=./caddy/tls-internal.caddy`; trust Caddy's root (`caddy-data` volume, `pki/authorities/local/root.crt`) on every device, or accept the warning once per device | Caddy stamps it |
| **3. Your own reverse proxy** | Nginx Proxy Manager, Traefik, ... already owning TLS | add `compose.byo-proxy.yaml` to `COMPOSE_FILE`, set `MANTEL_TRUSTED_PROXY` to the proxy's address **as Mantel sees it**, point the proxy at `http://<this host>:8765` with WebSockets on, and make it send the door header (below) | your proxy must |
| **4. Cloudflare tunnel** | remote access, beside 1, 2 or 3 | `mantel-secret cloudflared_token`, `docker compose --profile tunnel up -d`; Cloudflare Access in front is mandatory. The service URL is Caddy's tunnel door `http://172.31.250.2:8080` (1, 2) or Mantel itself `http://172.31.250.2:8765` (3) | always `tunnel` |

The LXC installer (`packaging/lxc/mantel.sh`) asks which of the four you want and writes `.env` to match.

**Bring your own proxy: the rules Mantel enforces itself.** The door header `X-Mantel-Door: lan|tunnel` is believed only from `MANTEL_TRUSTED_PROXY`; from there, **no header means `tunnel`** (fail closed), so a proxy host that forgets it gives wall tablets nothing rather than giving the internet the LAN door. `X-Forwarded-For`/`-Proto`/`-Host` count only from the trusted proxy; HA identity headers (`X-Remote-User-*`, `X-Ingress-Path`) are removed from everyone except HA's Ingress, the trusted proxy included. Mantel sets its own CSP, HSTS (when the proxy says https), `nosniff`, `Referrer-Policy` and `frame-ancestors`, so don't add a CSP in the proxy (browsers enforce both). Keep Mantel's published port off the internet and reachable only by the proxy if you can (`MANTEL_HTTP_BIND`, a firewall rule): a browser that goes around the proxy is the tunnel door over plain HTTP.

**Nginx Proxy Manager.** Add a Proxy Host: domain `mantel.<your domain>`, scheme `http`, forward hostname/IP = this host, port `8765`, **Websockets Support on**, Block Common Exploits on. SSL tab: your certificate, Force SSL, HTTP/2 (leave NPM's HSTS off: Mantel sends it). Advanced tab, paste this (NPM leaves out its own `location /` when the box contains one, which is what keeps these headers from being lost to nginx's inheritance rule):

```nginx
location / {
    proxy_pass http://MANTEL_ADDRESS:8765;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Mantel-Door lan;
    proxy_set_header X-Remote-User-Id "";
    proxy_set_header X-Remote-User-Name "";
    proxy_set_header X-Remote-User-Display-Name "";
    proxy_set_header X-Ingress-Path "";
    proxy_read_timeout 1h;
    proxy_buffering off;
    client_max_body_size 12m;
}
```

(`$http_host`, not NPM's usual `$host`: it keeps a non-standard port, which the browser's `Origin` carries and Mantel compares.) Use `lan` only on a proxy host that listens on your LAN alone; a host the internet can reach sends `tunnel`. `MANTEL_TRUSTED_PROXY` is NPM's address as Mantel sees it: NPM on another machine, that machine's LAN address; NPM in Docker on the same host, the address its connections arrive from (often the Docker bridge's gateway; `/proxy-check` tells you). The compose end-to-end run (`tools/e2e/compose_e2e.py`) uses exactly this block in a plain nginx as "your proxy".

**Traefik** (dynamic configuration; Traefik passes `Host`, sets `X-Forwarded-*` and upgrades WebSockets on its own):

```yaml
http:
  middlewares:
    mantel-lan:
      headers:
        customRequestHeaders:
          X-Mantel-Door: "lan"
          X-Remote-User-Id: ""            # an empty value removes the header
          X-Remote-User-Name: ""
          X-Remote-User-Display-Name: ""
          X-Ingress-Path: ""
  routers:
    mantel:
      rule: "Host(`mantel.example.com`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [mantel-lan]
      service: mantel
  services:
    mantel:
      loadBalancer:
        servers:
          - url: "http://MANTEL_ADDRESS:8765"
```

**Test my proxy.** As the Owner, open `https://<your name>/proxy-check` from a LAN browser (and again remotely). It checks that HTTPS is in use, the request came through the trusted proxy, the door header is present, plausible and overwritten (the page sends its own value, which must not arrive), the client address is forwarded, HSTS and the CSP arrived once, and the WebSocket upgrade passes by the same door. Each finding says what to change, with the NPM block above to copy. Signed out on that door (the usual symptom of a missing door header), it still says which door Mantel sees.

### Music Assistant and go2rtc through Mantel

An https page cannot frame Music Assistant's `http://…:8095` or open `ws://` to go2rtc, so Mantel serves both under its own address: Music Assistant's web app at `/ma/` (`MANTEL_MA_WEB_URL`, default the host of `MANTEL_MA_URL`) and go2rtc's viewing paths at `/go2rtc/` (`MANTEL_GO2RTC_URL`). Both need a Mantel sign-in: Music Assistant needs `control` on the `music` feature (a wall tablet needs that grant added, like the rest of music), a go2rtc camera stream that camera's live view, a Live TV stream a signed-in person or tablet. Only the paths HK needs are passed (never MA's JSON-RPC API, never go2rtc's stream management, config, restart or web pages); MA's and go2rtc's addresses, cookies and headers never reach the page. HK's "Browse Music" frame (`hk-browse-card`) uses `/ma/` on Mantel automatically; in Home Assistant it keeps MA's own port. Music Assistant's own sign-in, if yours has one, appears inside the frame: Mantel adds no MA credential for the page.

### Secrets

Secrets are **files**, never environment variables, the image or the repository. In the compose stack they live on the host in `/etc/hk/secrets/` (`root:10001`, mode `0440`, folder `0750`) and are mounted read-only at `/run/secrets/<name>`:

| File | What | Needed |
|---|---|---|
| `ha_token` | Long-lived token of a dedicated HA administrator user for Mantel. Create it fresh; never reuse a personal token. | yes |
| `at_rest.key` | 32 random bytes, base64. Seals TOTP seeds and device keys in SQLite; read from `/run/secrets` (`--secrets-dir`). **Keep a copy off the box.** | create it now |
| `backup.key` | 32 random bytes, base64. Encrypts the nightly backup. **Keep a copy off the box.** | create it now |
| `ma_token` | Music Assistant token. | when the connector is wired |
| `cloudflare_dns_token` | Cloudflare token (Zone:DNS:Edit on one zone) for Caddy's DNS-01 certificates. | only with DNS-01 TLS |
| `cloudflared_token` | The tunnel token. | only with `--profile tunnel` |

In the LXC, `mantel-secret <name>` reads a secret from the keyboard (no echo, no history) into the right place with the right owner. Rotate by replacing the file and `docker compose restart <service>`. Full details: [../packaging/compose/secrets/README.md](../packaging/compose/secrets/README.md).

Secrets at rest in SQLite (TOTP seeds) are encrypted with AES-256-GCM using `<secrets-dir>/at_rest.key`, created 0600 on first use. **Losing this file makes every enrolled TOTP unreadable**, so back it up with the database (section 10). Tokens, passwords and PINs are stored only as hashes.

### The data folder

`mantel.db` (SQLite in WAL mode, so also `mantel.db-wal` and `mantel.db-shm` while running), mode 0600 in a 0700 folder. It holds people, roles and grants, devices, sessions, settings with history, the audit log and service accounts. Migrations in `hosts/server/mantel_server/migrations/` run automatically at start, in number order; a migration that fails rolls back completely and stops the server. Migrations only move forward.

### Health

`GET /healthz` answers `{"status": "ok"|"degraded", ...}`: `degraded` means the link to Home Assistant is down (it still answers 200, because restarting cannot repair HA; add `?strict=1` for a monitor that wants 503). `GET /api/version` returns the build id. Neither exposes a secret, a person or an entity. Caddy does not forward `/healthz` from outside; the container's own healthcheck uses `python -m mantel_server.health`. The log line `sign-in refused: HA user ... is not linked` and the startup line are the first things to read.

### Running the REST examples below

The administrative actions without a screen yet are REST calls. This helper signs in once and adds the headers every state-changing call needs (an `Origin` that matches the server, the `X-CSRF-Token`, JSON):

```bash
B=https://mantel.example.com            # or http://127.0.0.1:8765 by hand
J=$(mktemp); umask 077
read -rs -p 'Password: ' PW; echo
curl -s -c "$J" -X POST "$B/api/auth/password" -H "Origin: $B" -H 'Content-Type: application/json' \
  -d "$(printf '{"username":"%s","password":"%s"}' avery "$PW")"; unset PW
# if the answer is {"next":"totp","pending":...}: finish with
#   curl -s -c "$J" -b "$J" -X POST "$B/api/auth/totp/verify" -H "Origin: $B" -H 'Content-Type: application/json' -d '{"pending":"...","code":"123456"}'
CSRF=$(awk '$6=="mantel_csrf"{print $7}' "$J")
api() { curl -s -b "$J" -c "$J" -H "Origin: $B" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' "$@"; }
api "$B/api/session"                    # who am I
rm -f "$J"                              # when finished
```

Never put a password or token on a command line that is kept in shell history. A password sign-in is a fresh factor for five minutes, which several actions below require.

## 3. The first Owner

There is no Owner on a new database, and nothing creates one for you. Two ways; either is an explicit administrator step.

**A. Link an HA account as Owner** (what Proof 1 used). Find the HA user id (the "Not linked yet" page after "Sign in with Home Assistant" prints it, `mantel-server links` lists linked ones, and a `person.*` entity's `user_id` attribute has it), then:

```bash
mantel-server link --ha-user-id <id> --role owner --name "Avery"
```

**B. A Mantel account with a password.** Only while no enabled Owner exists:

```bash
mantel-server bootstrap            # prints a one-time token, valid one hour; a new run replaces it
curl -X POST "$B/api/bootstrap" -H "Origin: $B" -H 'Content-Type: application/json' \
  -d '{"token":"<token>","username":"avery","name":"Avery","password":"<12+ characters>"}'
```

It spends the token, creates the Owner in one step and signs them in. Afterwards `/api/bootstrap` answers `410 bootstrap_closed`. Then enrol a TOTP authenticator and a passkey for the Owner (`/api/auth/totp/enroll` and `/enroll/confirm`; `/api/auth/passkey/register/*`). Passkeys need `--rp-id` set to the real hostname first. On the tunnel door a password alone is never accepted, so TOTP or a passkey is mandatory for remote use.

**In the container stacks** run admin commands inside the running server with `mantel`, which goes through the entrypoint so the container's data folder, HA address, token and secrets are filled in:

```bash
docker compose exec mantel-server mantel bootstrap
```

The others work the same way: `links`, `link`, `import-settings`, `service-account create --name linked --scope linked`, `backup --target /backups`, `import-files <folder>`, `files import-assets <folder>` (SF Pro and the glyph set). A restore runs with the server stopped: `docker compose stop mantel-server`, then `docker compose run --rm --no-deps mantel-server restore <file>`. (Don't use `run` while the server is up: it would start a second server on the same fixed backend address.)

## 4. Linking Home Assistant users

HA proves who someone is; Mantel's role decides what they can do. An HA user with no link gets nothing: they see a "Not linked yet" page that shows their HA user id.

```bash
mantel-server links                                          # list: HA id, role, name
mantel-server link --ha-user-id <id> --role adult --name "Jordan"
mantel-server link --ha-user-id <id> --role child
mantel-server unlink --ha-user-id <id>
```

Roles: `owner`, `admin`, `adult`, `child`, `guest`, `wall_tablet` (and `service`, which is only for Service accounts). The starting grants for each are in [phase3/RBAC.md](phase3/RBAC.md) ("Starting roles"). A Child or Guest sees only the rooms they are given: an Owner sets them with `PUT /api/rbac/scopes/user/<id>` (`{"areas": [area names or ids]}`, where `<id>` is Mantel's user id from `GET /api/users`, not the HA id; see RBAC.md "Storage and REST"). Owners can also edit grants and role defaults over `/api/rbac/*`; every such change is audited before it applies. Sign-in with HA works from `/login` and, inside Home Assistant, through Mantel Connect (the guided pairing is not built yet).

Changing a role takes effect at the next command, and open sockets are re-checked every 60 seconds. Disabling a user or unlinking an HA account ends their sessions at once. Admins cannot create or change Owners, and the last enabled Owner cannot be demoted.

### 4a. Mantel in HA's sidebar when Mantel runs outside HA (Mantel Connect)

Only for Docker and the LXC; the Mantel App needs none of this. Design and security rules:
[phase3/CONNECT.md](phase3/CONNECT.md); the App: `packaging/connect-app/`, [packaging/mantel-connect/README.md](../packaging/mantel-connect/README.md).

```bash
# turn Connect on (compose: COMPOSE_FILE=compose.yaml:compose.connect.yaml in .env; the LXC script: var_connect=yes)
docker compose up -d --wait
# on the Mac: stage the App into HA's local apps share, then install "Mantel Connect" in HA
~/.venvs/mantel/bin/python tools/stage_connect_app.py <local apps share>/mantel_connect
# pair (an Owner; or /admin, Connect, Start pairing)
docker compose exec mantel-server mantel connect pair --address <this host>:8766
# HA: Settings, Apps, Mantel Connect, Configuration: the address and the code, Save, Restart
docker compose exec mantel-server mantel connect list      # paired Apps: id, state, last seen
docker compose exec mantel-server mantel connect revoke --id <id>
```

* The code is single use and expires in 10 minutes; five wrong proofs burn it; failed attempts are rate limited;
  a new `pair` withdraws the earlier code (`mantel connect cancel` withdraws it too).
* Revoking cuts the App off at once and closes its open connections; pair again to reconnect. Certificates
  renew by themselves (clients 90 days, renewed at 30 left; so does the listener's). The CA, its key and the
  listener key live in `<data-dir>/connect/` (back them up with the data volume).
* Pairing, failures, renewals and revocations are in the audit log (section 9; actions `connect.*`).
* The sidebar counts as the `ha` door (`MANTEL_HA_DOOR_RULES`, default `trusted`). The first Owner is made the
  same way as in the Mantel App (an HA administrator confirms); link the household at `.../ingress/people`.
* The connection test is the App's page `/__mantel_connect/status` (inside the sidebar). A plain page in place of
  Mantel says what is wrong. `mantel connect status` shows the server's side.

## 5. Wall tablets: accounts, enrolment, PINs

A wall tablet is a **device** with its own role (`wall_tablet`, scoped to its room), not a person. The design (PLAN §7) replaces `trusted_networks` and `allow_bypass_login`:

1. **Create a Wall Tablet account** for the tablet (an Owner or Admin): `POST /api/users` with `{"username":"loft","name":"Loft tablet","role":"wall_tablet","password":"..."}`.
2. **Sign in on the tablet itself** with that account, then **make it a wall tablet**: `POST /api/devices/enroll` with `{"name":"Loft","room":"Loft"}`. The server swaps that browser's password session for a **device credential**: an `HttpOnly` cookie bound to that browser, rotated every 24 hours, revocable in one call, refused on the tunnel door, and unused for 90 days it expires. The password is not kept on the tablet. A reboot or a Kiosk Satellite restart does not ask again.
3. **Enrolment must be done from the tablet's own browser**, because the credential is a cookie in that browser. That is the part with no screen yet: the login page and the "Make this a wall tablet" button are the work in progress (`ADMIN-PAGE.md`). Until they exist a tablet cannot be enrolled without driving the two REST calls from inside its WebView, which is why the cutover runbook lists the page as a prerequisite.
4. **The room.** A tablet with no stored area scope is scoped to its enrolled room by name. An Owner can change it: `PUT /api/rbac/scopes/device/<device id>`.
5. **Revoke** at any time: `DELETE /api/devices/<id>` (Owner or Admin, or the tablet itself); `GET /api/devices` lists them (never any secret). A retired secret presented again more than 60 seconds later revokes the device (`credential_reuse`), which is how a copied credential is caught.

### A person's PIN at a tablet

At a wall tablet nobody is signed in, so a sensitive action (unlock, disarm, garage) asks for **a person's PIN**. The server finds which person it belongs to, decides that one command as *person ∩ tablet*, and writes the audit row with the person's name and the tablet.

- **Set** from the person's own session, with a fresh factor and CSRF: `api -X PUT "$B/api/account/pin" -d '{"pin":"2580"}'`. Remove: `DELETE /api/account/pin`. An Owner or Admin can clear someone's: `DELETE /api/users/<id>/pin`.
- **Rules:** 4 to 8 digits, not a repeated digit, not a straight run; stored only as an Argon2id hash; a PIN names exactly one person, so a PIN already in use is refused (`pin_unavailable`).
- **Lockouts:** 5 wrong PINs in a row lock **that tablet's pad** for 15 minutes (even the right PIN is refused; the lock survives a restart); each source IP may fail 20 times per 15 minutes. A child's correct PIN is refused by the child's own role and does not count against the tablet. A child can lock a pad for 15 minutes with five wrong PINs; adults can still use their phones.
- The PIN pad appears only once at least one person has a PIN. Nothing in the page sets a PIN yet: it is REST only.

Details: [phase3/PINS-AUDIT.md](phase3/PINS-AUDIT.md), [phase3/ACCOUNTS.md](phase3/ACCOUNTS.md).

## 6. Service accounts for linked mode

Linked mode lets the HA integration `hk_frontend` forward its actions and mirror entities to Mantel while keeping the same domain, unique ids and entity ids (see [phase5/LINKED-MODE.md](phase5/LINKED-MODE.md)). It authenticates with a **Service account**: a machine account with no password or role, only a bearer credential and a scope. Owner only.

```bash
mantel-server service-account create --name home-assistant --scope linked   # prints the credential ONCE
mantel-server service-account list
mantel-server service-account revoke --id <id>
```

(Or `GET`/`POST /api/service-accounts`, `DELETE /api/service-accounts/<id>`, from an Owner's own session on the LAN door.) The credential looks like `msvc_<id>_<secret>`; only its hash is stored. Paste it into **Settings, Devices & services, HK Frontend, Configure, Linked to Mantel Server** along with Mantel's `https://` address. Home Assistant stores it in plain text in `.storage/core.config_entries`, as it does every integration's token; it is never logged and is revoked on Mantel's side in one step. Linked mode works only on the LAN door, never from a browser (a request with an `Origin` is refused), and Mantel can change only the entities it mirrors: it cannot call a service in HA. Turn the option off and today's integration comes straight back.

**Which tablets are Mantel's** (the cutover, one tablet at a time): every tablet, and the rest of the entry (`house`), is Home Assistant's until an Owner moves it: `PUT /api/linked/owners {"unit": "<tablet id>" or "house", "owner": "mantel" or "ha"}` from an Owner's own session on the LAN door (audited first; `house` only after every tablet). `GET /api/linked/owners` (Owner/Admin) lists who owns what. HA is told over the link and keeps it; Configure, Linked to Mantel Server shows it. See [phase5/LINKED-MODE.md](phase5/LINKED-MODE.md) "Per-tablet ownership" and [phase6/CUTOVER.md](phase6/CUTOVER.md).

The linked endpoint, the Service accounts and the frames are built and tested. The handlers that do the real work (black screen, pop-ups, Alarm PIN) and the publishing of the 31 entities are **not wired yet**; enabling it before then would answer with the in-memory stand-in. See the cutover runbook.

## 7. Importing HK's settings from Home Assistant

One time, to move the house's HK Settings (looks, rooms, screens, tablets, pop-ups, custom pages, chips, accessories) into Mantel's database. It reads `hk_frontend/panel/get` from HA once and writes nothing to HA. It needs Mantel's HA token to belong to an administrator.

```bash
mantel-server import-settings --ha-url http://192.0.2.53:8123 --token-file ~/.config/mantel/ha_token
```

Or, as the Owner, `POST /api/settings/import` (`GET` shows whether it ran and whether the settings are still empty). It is idempotent: a second run reports when the first ran and changes nothing; a document you already edited in Mantel is left alone and listed as skipped. Every imported document is version 1 in an append-only history; any version can be read back or restored (`mantel/settings/history`, `mantel/settings/restore`). In the container stacks use the `mantel` helper from section 3 with `--token-file /run/secrets/ha_token`.

What does not import yet (it keeps running in Home Assistant): accessories and hidden accessories, and every feature's own settings (music, notifications, energy, Live TV, Clean Areas, Alarm PIN). HK Settings saves from the page already go to Mantel's store, never to HA, and are allowed while commands are off. See [phase3/SETTINGS.md](phase3/SETTINGS.md) for the list of what is refused and why.

## 8. Enabling commands

By default Mantel Server **cannot** send a command to the house. This is the most important switch in the system, and it is deliberate and per server:

- It is the flag `--commands-enabled` (or `Config.commands_enabled` built by code), set by whoever starts the server. There is no environment variable, setting, REST call or client message that turns it on, and the packaging does not pass it. In the compose stack it means editing the service's `command:` by hand, which is intended friction.
- While off, the command path cannot even be constructed: no `Gateway`, the HA command connection raises `CommandsDisabled`, the page's client has no actions, and every command-shaped message gets `commands_disabled` and nothing is audited or sent.
- The state connection to HA (the one that reads everything) can never send a service call, in either mode. The startup line says `read-only; commands disabled` or `COMMANDS ENABLED`, and a warning is logged when on.
- **For the house, switching it on is Avery's decision at cutover**, at the step marked in the runbook, and not before. Re-run `tools/e2e/gateway_e2e.py` on the exact commit being deployed first.

When on, every command goes through the gateway (GATEWAY.md):

1. **Who:** the session's person and/or the tablet's device. Effective permission is the **intersection** of the two.
2. **RBAC:** deny by default, explicit deny wins, grants may carry time windows. Services that can reach many things (area, device or floor targets, `entity_id: all`) are refused; entity-less services other than notifications and scripts need `configure` on settings (Owner/Admin).
3. **Step-up** for sensitive actions (locks, alarm disarm, garage, water valves, camera live view on the tunnel, and so on): a fresh factor within 5 minutes. Authenticator code or passkey for a person; a **person's PIN** at a wall tablet. A sign-in counts as fresh for five minutes. On the tunnel, Owner/Admin/Adult may do it, with an Owner notification on every remote lock or alarm action; Child and Guest are LAN-only by default.
4. **Audit before send:** the row is written first; if it cannot be written, the command is refused (`audit_unavailable`). Service data (which can carry an alarm code) is never stored.
5. **Forward** with Mantel's own HA credential, one ticket per audit row, spent once.

Decisions you may want to revisit are listed at the end of GATEWAY.md (camera live view needs no step-up on the LAN door; every wall tablet may view every camera, so the doorbell pop-up shows everywhere).

## 9. Reading the audit log

`GET /api/audit` (Owner and Admin; every other role gets 403, nobody signed in 401), newest first:

```bash
api "$B/api/audit?limit=50"
api "$B/api/audit?decision=denied&since=1760000000"           # epoch seconds
api "$B/api/audit?device=<device id>&kind=service"
api "$B/api/audit?limit=100&before=<next from the last page>"   # paging
```

Filters: `actor` (user id), `device`, `decision` (`allowed|denied|step_up`), `kind` (`service|ws|http|ma|config|system`), `since`, `until`, `before`, `limit` (1 to 500). Each row has the person (id, name, role at the time), the device, the action and target, the decision and reason, whether it was sensitive, the door, the source IP, the factor used and its age, and the `result` (`ok`, `error:<code>`, or `not_sent` for denials and step-up rows). Rows for `kind=config` are RBAC changes. `actor=mantel`, `kind=system` rows are the server's own (Owner notifications, the retention purge).

What to look for: a `denied` row with an unexpected person; `step_up` followed by no `allowed` (someone hit Cancel, or cannot answer); `pin_invalid` / `pin_locked` at a tablet; `tunnel` door rows for locks; `error:` results (HA refused). Rows are append-only: nothing can edit or delete one, except that the hourly retention step deletes rows older than the window (365 days by default, at least 30), and it records every purge in two places. The SQLite triggers do not protect against someone who can replace the whole file, so keep the file's permissions and backups tight.

## 10. Backups and restore

`BACKUP-FILES.md` (the full design, nightly encrypted backups, "your files") is in progress. Until it lands, this is the minimum, and **a restore has not been rehearsed yet**; the cutover runbook makes that a prerequisite.

**What to back up**

| Item | Why |
|---|---|
| `mantel.db` (a consistent copy, not the live file) | Everything Mantel owns. |
| `at_rest.key` | Without it every TOTP seed in the copy is unreadable. |
| `/etc/hk/secrets/` (`ha_token`, `ma_token`, tunnel and DNS tokens) | Or recreate them: tokens can be reissued, `at_rest.key` cannot. |
| `packaging/compose/.env` | The settings. |
| "Your files" (SF Pro and the SF Symbols glyphs, Apple's, never in the repo) | Kept in `/data/user-files` and inside the encrypted backup (`backup`, unless `--no-files`). To supply them once: /admin, Your files, "HK fonts and glyphs", or `docker compose exec mantel-server mantel files import-assets <folder>` on a copy of HA's `/config/www/hk` (needs `fonts/SF-Pro.woff2` and `iconset/hk-glyphs.js`; see [BACKUP-FILES.md](phase3/BACKUP-FILES.md)). |

A consistent online copy of the database (do not copy `mantel.db` alone while the server runs; WAL mode keeps recent writes in `mantel.db-wal`):

```bash
docker compose exec mantel-server python - <<'PY'
import sqlite3, time
src = sqlite3.connect("/data/mantel.db")
dst = sqlite3.connect(f"/data/backup-{time.strftime('%Y%m%d-%H%M%S')}.db")
src.backup(dst); dst.close(); src.close()
PY
```

Then move that file, `at_rest.key` and the secrets to the NAS; the Proxmox backup of the container is a second copy. Keep backups encrypted or on storage only you can read: they contain password hashes and the audit log.

**Restore.** Stop the server; put the backup in place as `mantel.db` and **delete any stale `mantel.db-wal` and `mantel.db-shm`**; restore `at_rest.key`; start the server. Migrations bring an older copy forward. Check `/healthz`, sign in as the Owner, and `GET /api/audit?limit=5` to see the last rows. Take a backup **before every update** (section 11), because migrations only go forward and restoring the pre-update copy is the safe rollback if an update goes wrong.

## 11. Updating Mantel

Back up first (section 10).

**Docker or LXC, registry images.** From `packaging/compose/`:

```bash
./update.sh
```

It tags the running images `mantel-rollback/<service>:previous`, pulls, runs `docker compose up -d --wait`, and **rolls back by itself** to the remembered images if a service does not become healthy. Production image references should be digests (`.env.example` says so). After a rollback fix the image reference in `.env` before the next update. To roll back by hand:

```bash
MANTEL_SERVER_IMAGE=mantel-rollback/mantel-server:previous docker compose up -d --wait --pull never
```

**Proxmox LXC.** Inside the container, `mantel-update` (the same as `bash /opt/mantel/packaging/lxc/mantel.sh update`) runs `update.sh` when `.env` points at registry images. In **build mode** (images built in the container from pushed source), send a newer checkout from the Proxmox host and let it update inside:

```bash
bash packaging/lxc/mantel.sh push <ctid>      # on the Proxmox host, from a checkout you have read
```

It rebuilds, restarts and rolls back to the tagged previous images if the new ones are not healthy. `.env` is never overwritten by a push. Read the scripts before running them as root on the host.

**Home Assistant App.** Updated by Home Assistant (Settings, Apps). Back up first with HA's own backup. (The App is a scaffold today; `HA-APP.md` will say more.)

**HK Frontend in Home Assistant** is a separate thing with its own steps: section 12.

Open screens can notice a new build: `GET /api/version` returns the build id, and assets are served with `no-cache` and an ETag, so a reload always revalidates. This ends the old Clear cache + Reload dance for Mantel's own pages; it does **not** apply to the HACS build inside HA (section 14).

## 12. Installing HK builds into Home Assistant

This is the process that has put three builds on the house (the first on 2026-10-18 at about 02:45, then 03:19, then 07:19). It changes only `custom_components/hk_frontend/` on the house and **needs Avery's approval for each install**. The long version with the click-through checklist is [phase1/LIVE-INSTALL.md](phase1/LIVE-INSTALL.md).

**Before**

1. Validate the commit you will install: the Node suites and HA Python suites in a fresh build, the Mantel suite, the offline smoke, and `tools/testha/run.sh` on the scratch HA (section 13) including the open-screen upgrade check. Install exactly the commit you built.
2. Make an HA backup (Settings, System, Backups, Create backup).
3. Note the rollback point: `git -C /Volumes/config log --oneline -1 -- custom_components/hk_frontend` (it was `38d841bf`). `/Volumes/config` has uncommitted changes of its own; leave them alone.

**Install**

```bash
cd /Volumes/data/mantel && git pull
build=$(mktemp -d) && ~/.venvs/mantel/bin/python tools/build_ha.py "$build/ha"
rsync -a --inplace --exclude __pycache__ "$build/ha/custom_components/hk_frontend/" /Volumes/config/custom_components/hk_frontend/
diff -rq -x __pycache__ "$build/ha/custom_components/hk_frontend" /Volumes/config/custom_components/hk_frontend | grep -v "^Only in /Volumes/config"   # must print nothing
```

- **`--inplace` is required.** Without it rsync writes each file to a temporary `.<name>.XXXX` first; for `__init__.py` that name starts with `._`, which the HA Samba add-on refuses. The first install half-failed exactly that way: every `__init__.py` and all of `hk_core/` were missing, and the old bootstrap ran against new card files. Always run the `diff` check before restarting.
- **No `--delete`.** The live folder holds git-ignored files the build does not ship, mainly `frontend/sky/scenes/` (5.7 MB of seasonal sky scenes), `tools/sky/src/` and `tools/sf_symbols/.sfcache/`.
- **Restart Home Assistant** (it is part of the install: the new frontend only works once the new `__init__.py` has loaded). Then check HA's log shows the integration loaded with nothing beyond the custom-integration warning, and that the page loads only `/hk/modules/hk-boot.js` (200, `no-cache`).
- **Reload every open screen** with the cache cleared, starting with one tablet (the Loft). An open page survives the swap (scratch-tested), but a browser that stayed open can hold an old cached module next to a new one (section 14). The Master Bedroom tablet is the one nobody wants to touch; the upgrade-with-an-open-screen check exists for it.
- The version number in `manifest.json` stays `1.8.3` unless bumped; bump it first if HACS or the tablets should notice.

**Roll back**

```bash
git -C /Volumes/config checkout 38d841bf -- custom_components/hk_frontend
git -C /Volumes/config clean -fd -- custom_components/hk_frontend    # removes files the build added; without -x it keeps ignored ones
```

Then restart HA and reload the tablets. Or restore the backup from step 2.

## 13. The scratch Home Assistant

`tools/testha/` runs a throwaway Home Assistant on this Mac at `127.0.0.1:8124` with Home Assistant's `demo` integration (invented devices only), loaded with the built `hk_frontend` exactly as HACS would install it. It checks what the Node suites cannot: that the HA build works in a real HA frontend. It never touches `/Volumes/config` or the house, and reads nothing from `~/.config/mantel`.

```bash
~/.venvs/mantel/bin/python tools/testha/testha.py up --fresh    # build, write config, start, onboard, add HK, make 3 dashboards
~/.venvs/mantel/bin/python tools/testha/check.py                # click through it in headless Chrome: PASS/FAIL per item
~/.venvs/mantel/bin/python tools/testha/testha.py down          # always stop it when done
```

`tools/testha/run.sh` does the three in one go (about 8 minutes). `restart_check.py --new <tree>` swaps HK under an open `/hk-wall` page and restarts HA, which is the test for a tablet nobody may reload. `tools/e2e/gateway_e2e.py` uses the same scratch HA for Mantel's command gateway. Two traps are already handled by `up`: HA 2026.9 reverts a `server_port` trial to port 8123 on all interfaces after five minutes unless it is confirmed, and onboarding would add network integrations. Details: [../tools/testha/README.md](../tools/testha/README.md) and [phase1/TESTHA.md](phase1/TESTHA.md).

## 14. Troubleshooting

**The dashboard is blank, or HK lost its menu, tab bar or screensaver (HA build).** HA imports every extra module in parallel and in no fixed order, so HK's bootstrap files raced each other (`hk-host-shell.js has not loaded`, `HKClient has not loaded`, `reading 'onNavigate'`). The fix is the **ordered boot** (`boot.py`, commit `9e70e87`): HA is given one module, `/hk/modules/hk-boot.js`, which joins the dependency-free core in order and then imports the rest. If the symptom returns, check that the page requests `hk-boot.js` (not 15 separate modules) and that it answers 200 with `no-cache`; check the HA log for `Failed to load extra module`. The scratch HA's load-order probe (check items 9, 9b, 9c) is the test.

**After an install or restart, one screen shows `hkCards.onHass is not a function` or half-new behaviour.** A browser tab that stayed open ran an old cached module (`hk-menu.js`) next to the new one. **Reload every open screen with the cache cleared**, including wall tablets. HK modules in the HACS build are served without hashed names, so this is expected until a screen is reloaded. Mantel's own pages do not have this problem (they revalidate on every load).

**The Samba `._` temp files.** The HA Samba add-on refuses names starting with `._`, which rsync's default temp files do. Symptom: a half-copied install (missing `__init__.py`, missing `hk_core/`). Always `rsync --inplace`, then run the `diff`. See section 12.

**A harmless `not_found` ("Subscription not found") after a restart.** An unsubscribe answered by a server that restarted and never had that subscription. It shows up intermittently in open-screen restart tests, on old and new builds alike, and the page keeps drawing and following state. It comes from outside HK's subscription port (the client now resolves on exactly that refusal). Ignore it unless the page also stops updating.

**"Not linked yet" after Sign in with Home Assistant.** The page prints the HA user id; an Owner links it (section 4). "Account disabled" means the linked person is disabled.

**Every wall tablet is refused, or every request counts as the tunnel.** The LAN door is believed only from a proxy listed with `--trusted-proxy`, and only when that proxy sends `X-Mantel-Door: lan`. Behind Caddy that is `MANTEL_TRUSTED_PROXY` (Caddy's fixed backend address); with it unset the entrypoint warns and fails closed. Behind your own proxy, `MANTEL_TRUSTED_PROXY` must be the proxy's address as Mantel sees it and the proxy must send the header: open `/proxy-check` as the Owner. Tablet device credentials, Service accounts and device enrolment are all refused on `tunnel` (`403 lan_only`).

**A wall tablet's PIN pad says "try again in N min".** It is locked after 5 wrong PINs for 15 minutes; even the right PIN is refused until then. It survives a restart. Wait, or clear the lockout row in `pin_lockouts` with the server stopped.

**`commands_disabled` in the browser console.** Working as designed: the server is running without `--commands-enabled`, so the page's client sends nothing. Settings saves are the exception and still work. This is also what the scratch checks look for as proof that nothing leaks.

**A command answers `forbidden`, or the step-up prompt keeps appearing.** The reason is in the answer (`no_grant`, `explicit_deny`, `tunnel_lan_only`, `person_pin_required`, ...) and in the audit row. A step-up is good for 5 minutes from the factor. A tablet alone needs a person's PIN, and nobody has a PIN until one is set.

**`/healthz` says `degraded`.** The link to Home Assistant is down: check `--ha-url`, the token file (a missing file stops the server at start with a message), that the HA user still exists and is an administrator, and the DMZ firewall rules from the Mantel container to HA's `:8123`.

**The server refuses to start with `--listen`.** A non-loopback listen address needs `--public-url https://name/`; without it parsing fails on purpose. `--public-url` and `--allow-host` without `--listen` are refused too. A request whose `Host` is not loopback and not in `--allow-host` is refused (DNS-rebinding protection), so add the LAN IP to `MANTEL_ALLOW_HOSTS` if tablets use it.

**Passkey registration fails.** WebAuthn forbids an IP as the relying party. Open Mantel by its hostname and set `--rp-id` to that hostname's registrable domain.

**The browser warns about the certificate.** With `tls-internal.caddy` the certificate comes from Caddy's own CA; trust its root on each device, or use DNS-01 with a real domain.

**The Music Assistant frame is blank, or says Music Assistant is on your local network.** On Mantel the frame is `/ma/`: set `MANTEL_MA_URL` (or `MANTEL_MA_WEB_URL`) and check the person may `control` the `music` feature (`GET /api/services` says `music_assistant: null` otherwise). A `502 upstream_unavailable` from `/ma/` means Mantel cannot reach Music Assistant. In Home Assistant the frame still points at MA's own `http://…:8095`, which an https page cannot frame.

**Two Content-Security-Policy headers, or Music Assistant's frame refused by its policy.** Your proxy adds its own CSP; remove it (Mantel sets its own). `/proxy-check` finds this.

**`client_smoke.py` fails to start Chrome.** It uses the fixed DevTools port 9337 and collides with another job's run. Run it alone.

**The scratch HA is still running.** `testha.py status`, then `testha.py down`. A crashed run can leave `hk-phone`'s menu on the tab bar; `check.py` resets it first.

## 15. Known gaps

Collected from the phase documents; check [PLAN.md](PLAN.md) section 0 for the current state.

| Gap | Effect | Where |
|---|---|---|
| **Images built and run on Docker Desktop (2026-10-18)**; the LXC and the App on the house are not yet run | The server image runs healthy under the production restrictions; base images are pinned. The full compose stack against the scratch HA and the LXC on proxmox1 are the next checks. | [phase3/PACKAGING.md](phase3/PACKAGING.md) |
| **Login page: built, not yet used on the house** | `/login` offers passkey, password + authenticator code, and Sign in with HA, and returns to the page that sent you. Not built: passkeys offered in the user-name autofill; no headless check of `/login` yet. | [phase3/LOGIN-PAGE.md](phase3/LOGIN-PAGE.md) |
| **HA App: Ingress identity and prefix-relative URLs** | The App starts and is healthy, but sign-in through Ingress does not work yet. The entrypoint passes no `--trusted-proxy` there, so every request counts as `tunnel`. | `HA-APP.md` (in progress), PACKAGING.md |
| **Mantel Connect: built and verified here, not yet installed on the house (2026-10-18)** | Guided pairing, the mutual-TLS listener, revocation, renewal, `/admin` Connect, the staged App and the compose/LXC switch are built and tested, including real Docker images. Not done: installing the App in the real HA (the real Supervisor Ingress path through Connect, the Companion app over cellular); a QR code for the pairing string. | [phase3/CONNECT.md](phase3/CONNECT.md) "Not done" |
| **Linked mode's remaining gaps** | Per-tablet ownership, the real handlers and the 31 entities are built and wired (off by default). Not truthful yet: Live TV's channel cameras (published unavailable: no stream on Mantel), notification snapshots; the Alarm PIN takes each person's Mantel PIN, not HA's one Alarm PIN. No `/admin` control for ownership (REST only). | LINKED-MODE.md "What's left" |
| **Read side for tablets** | With the default roles a wall tablet has no `music`, `notifications` or `media` feature grant; add them when the tablets move. Camera stills, camera live view and calendar events now go through Mantel's connectors with RBAC: stills use `/api/camera/<entity>/still`, and pages never get an HA camera token. Media-player artwork goes through `/api/media/<entity>/art` the same way; no HA token reaches a page, in states or history answers. Live TV's transcode is not moved. | GATEWAY.md, CONNECTORS.md "What the page needs" |
| **Music page: interim bridge to HA (2026-10-18)** | `hk_music/subscribe`, `hk_music/queue` and `hk_music/settings/library` are forwarded to HA's `hk_frontend` (which still runs the music engine), RBAC-filtered; every music write stays refused. HA answers as Mantel's own HA user, so the per-user **home room is not the person's** until Phase 4 (MantelHouse runs the engine): Mantel sends `home: null` and the page draws with no room preselected. The host adapter still refuses `hk_music/queue` (its write-word backstop matches `queue`), so the screensaver's Up Next waits on a `web/shim` change. | [phase3/CONNECTORS.md](phase3/CONNECTORS.md) "What the page needs" |
| **Entity registry and Hidden Accessories reads: answered by Mantel (2026-10-18)** | `config/entity_registry/get` (a light's favourite colours only) and `hk_frontend/hidden/get` are answered from Mantel's own copies with RBAC; neither reaches HA. HK Settings' Hidden Accessories page still reads an empty `hidden` from `hk_frontend/panel/get`, and hiding saves are still `not_yet`. | CONNECTORS.md, [phase3/SETTINGS.md](phase3/SETTINGS.md) "Hidden Accessories" |
| **Backups and a rehearsed restore** | Interim steps only (section 10). | `BACKUP-FILES.md` (in progress) |
| **Cloudflare Access JWT, new-device notifications, shared rate limits** | The tunnel door is stamped by Caddy but the JWT is not verified yet; do not publish a tunnel hostname before it is. | ACCOUNTS.md "Not yet", PACKAGING.md |
| **CI** | No image publishing, scanning, signing or digest pinning yet. | PACKAGING.md |
