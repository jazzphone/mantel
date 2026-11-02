# Operating Mantel

How to run Mantel Server and look after it: first start, people and tablets, commands and their safeguards, the audit log, backups, updates, installing HK builds into Home Assistant, and what to do when something looks wrong. The design notes are in the `phase*/` folders beside this file.

**This is the operator reference written while Mantel was built**, kept with the [design notes](development/Design-Notes.md). For installing and running Mantel, the [user guide](guide/Home.md) is current; where the two differ, the guide is right. The flag tables below still hold for `mantel-server --help`.

Contents: [1](#1-the-parts-and-the-two-doors) parts and doors · [2](#2-running-the-server) running · [3](#3-the-first-owner) first Owner · [4](#4-linking-home-assistant-users) linking HA users · [5](#5-wall-tablets-accounts-enrollment-pins-optional) tablets · [6](#6-service-accounts-for-linked-mode) service accounts · [7](#7-importing-hks-settings-from-home-assistant) settings import · [8](#8-enabling-commands) enabling commands · [9](#9-reading-the-audit-log) audit · [10](#10-backups-and-restore) backups · [11](#11-updating-mantel) updating · [12](#12-installing-hk-builds-into-home-assistant) HK builds · [13](#13-the-scratch-home-assistant) scratch HA · [14](#14-troubleshooting) troubleshooting · [15](#15-known-gaps) gaps.

## 1. The parts and the two doors

| Part | What it is |
|---|---|
| **Mantel Server** (`hosts/server/mantel_server`) | One Python service. The only thing that holds the Home Assistant and Music Assistant credentials. Owns people, roles, devices, settings and the audit log in one SQLite file. Serves the HK web app. |
| **Caddy** | TLS in the container stacks (or your own reverse proxy instead: section 2, "HTTPS"). It stamps `X-Mantel-Door: lan` or `tunnel` on every request. Mantel Server sets its own CSP, HSTS and the other security headers. |
| **go2rtc / transcode** | Live TV served by Mantel (compose stack only: Mantel sets each channel up there on demand; section 7a). Cameras still use HA's own go2rtc. Its viewing paths reach pages only through Mantel's `/go2rtc/` (sign-in, RBAC). |
| **`hk_frontend`** (in HA) | Today's HK Frontend, unchanged, or in *linked mode* the thin piece that forwards `hk_frontend.*` actions to Mantel. |
| **Mantel Connect** | A small HA App that puts a Mantel running outside HA (Docker, an LXC) in HA's sidebar and the Companion app. Paired once with a one-time code (section 4a); not needed when Mantel runs as the Mantel App. |

Every request arrives by a **door**. `lan` is the house network, served straight by Caddy. `tunnel` is anything coming through Cloudflare. A wall tablet's device credential, a Service account and a plain password sign-in all behave differently on the two doors (device credentials are refused on `tunnel`; a password alone is not enough on `tunnel`; sessions last 30 days on `lan`, 12 hours on `tunnel`). The door is believed only from a trusted proxy (section 2).

## 2. Running the server

### By hand (development, loopback only)

```bash
.venv/bin/mantel-server                       # http://127.0.0.1:8765/login
mantel-server --ha-url http://homeassistant.local:8123 --commands-enabled   # a first-start value only; use Mantel Settings, see section 8
```

It reads Home Assistant's token from `~/.config/mantel/ha_token` if that file exists. Without it the server starts anyway, not connected, and says where to fix that: sign in as the Owner and open `/admin` → **Connections** (section 2a). A connection saved there wins over the file. The startup line says what mode it is in: `read-only; commands disabled`, or `COMMANDS ENABLED (...)`. Open `/login` (passkey, user name + password with the authenticator code when one is set up, or "Sign in with Home Assistant"; see [phase3/LOGIN-PAGE.md](phase3/LOGIN-PAGE.md)); it then goes on to `/home` (the default screen), or back to the page that sent you there.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--ha-url` | `http://homeassistant.local:8123` | Home Assistant's address. |
| `--token-file` | `~/.config/mantel/ha_token` | Optional: the installation's HA token, read at startup and never printed; shown on the Connections page as "set by the installation". The HA user should be an administrator (HK Settings' read needs one, and the command path uses it). Normally HA is set up on the page instead (section 2a). |
| `--port` | `8765` | Listening port. |
| `--listen ADDRESS` | loopback only | Container mode. Needs `--public-url`. Without `--listen` the server binds `127.0.0.1` and nothing else is possible. |
| `--public-url URL` | none | The `https://` address browsers use (through Caddy). It becomes HA's OAuth `client_id`, so "Sign in with Home Assistant" works behind Caddy. |
| `--allow-host NAME` | none | Further Host names to accept (repeatable). `*` is for the HA App only. |
| `--trusted-proxy ADDRESS` | none | A reverse proxy whose `X-Mantel-Door` and `X-Forwarded-For`/`-Proto`/`-Host` are believed (repeatable, exact IP address). With none, every request through a proxy counts as `tunnel` (fail closed: wall tablets are refused). A trusted proxy that sends no door header is `tunnel` too. HA identity headers are never believed from it. |
| `--ma-web-url URL` | the host of `--ma-url` | Music Assistant's web app, served to pages under `/ma/` (section 2, "Music Assistant and go2rtc through Mantel"). |
| `--go2rtc-url URL` | none | go2rtc's API; its viewing paths are served under `/go2rtc/`. |
| `--frame-ancestors`, `--csp-connect-src`, `--csp-frame-src` | none | Extra CSP origins (repeatable). By default only Mantel's own pages may frame it. Frame-ancestors also apply to `/login` and `/admin`, so a Home Assistant Webpage dashboard showing a screen can sign in inside the frame (phase3/HA-SIDEBAR-SCREENS.md). |
| `--proxy-kind caddy\|own` | none | Which proxy owns TLS; tunes `/proxy-check`'s advice. |
| `--connect` | off | Mantel Connect: a second TLS listener for the Connect App (client certificates only) and pairing. Implies Ingress identity from a **paired** App, trusting no socket address. Section 4a. |
| `--connect-port`, `--connect-listen`, `--connect-address` | `8766`, `0.0.0.0`, none | The listener's port and address; the address `/admin` shows the Owner to type into the App. |
| `--data-dir` | `~/.local/share/mantel` | Where `mantel.db` lives. |
| `--secrets-dir` | `~/.config/mantel/secrets` | Folder of secret files (the at-rest key). |
| `--ma-url`, `--ma-token-file` | none, `/run/secrets/ma_token` | Optional: Music Assistant from the installation. Normally set up on the Connections page. |
| `--ha-managed-by-app` | off | HA App mode only (the entrypoint sets it): HA is the App's own credential, read-only on the Connections page. |
| `--commands-enabled` | off | The first start's value for **Allow Control of the House** (Mantel Settings → General); after that the stored setting wins. See section 8. |
| `--read-only` | off | Kill switch: the house stays read-only whatever Mantel Settings says. Docker: `MANTEL_READ_ONLY=1`; App: the `read_only` option. See section 8. |
| `--house-tz` | `UTC` | Time zone for grant schedules when HA does not say. HA's own zone is used once read. |
| `--audit-retention-days` | `365` | Audit rows older than this are purged hourly. Must be at least 30. |
| `--lan-session-days`, `--session-hours` | `30`, `12` | Session lifetimes on the `lan` and `tunnel` doors. `--session-hours` is the first start's value for **Sign-Ins from Away Last** (Mantel Settings → General, 1 hour to 30 days); the stored setting wins after that. |
| `--rp-id` | `localhost` | Passkey relying-party id: a **hostname**, never an IP. Set it to the real name before anyone registers a passkey. |
| `--screen` | the first screen | The first start's value for **House Default Screen** (Mantel Settings → General): the screen `/home` opens (a board key, e.g. `dashboard-home`). The stored setting wins after that. |
| `--default-interval`, `--override GLOB=SECONDS` | 0 | Coalescing of fast sensors (for example `'sensor.*_distance=1'`). |
| `--go2rtc-url URL` | none | Live TV served by Mantel through its own go2rtc's API (`http://go2rtc:1984` in the stack). Without it, HA's Live TV stays the interim (section 7a). |
| `--live-tv-hardware` | `none` | `vaapi`: Live TV's transcode on QuickSync (go2rtc needs `/dev/dri`: `compose.gpu.yaml`). |

### In the container stacks (Docker, LXC)

The entrypoint turns `MANTEL_*` variables from `packaging/compose/.env` into those flags. None of them is secret.

| Variable | Becomes | Notes |
|---|---|---|
| `MANTEL_PUBLIC_URL` | `--public-url` | Required. |
| `MANTEL_HA_URL`, `MANTEL_MA_URL` | `--ha-url`, `--ma-url` | Optional: normally Home Assistant and Music Assistant are set up on the admin page (section 2a). With an address here and a non-empty `ha_token` / `ma_token` file the page shows them as "set by the installation". |
| `MANTEL_ALLOW_HOSTS` | `--allow-host` | Comma list, for example the LAN IP. |
| `MANTEL_TRUSTED_PROXY` | `--trusted-proxy` | Compose sets Caddy's fixed backend address `172.31.251.2`. Must be IP addresses. |
| `MANTEL_DEFAULT_SCREEN`, `MANTEL_SESSION_HOURS` | `--screen`, `--session-hours` | Optional. **First start only**: seeds for Mantel Settings → General, which holds them after that (**House Default Screen**, **Sign-Ins from Away Last**). |
| `MANTEL_READ_ONLY` | `--read-only` | Set `1` for the kill switch (section 8). |
| `MANTEL_DATA_DIR`, `MANTEL_PORT`, `MANTEL_LISTEN`, `MANTEL_HA_TOKEN_FILE` | | Defaults `/data`, `8765`, `0.0.0.0`, `/run/secrets/ha_token`. |
| `MANTEL_CONNECT`, `MANTEL_CONNECT_ADDRESS`, `MANTEL_HA_DOOR_RULES` | `--connect`, `--connect-address`, `--ha-door-rules` | Mantel Connect (section 4a). `compose.connect.yaml` sets the first; the rules default to `trusted`. The rules are held in Mantel Settings → Connections → Home Assistant → **Coming Through Home Assistant** (**Trusted**, **Home Network Rules**, **Away Rules**); the variable is a first-start value. |
| `MANTEL_GO2RTC_URL`, `MANTEL_LIVE_TV_HARDWARE` | `--go2rtc-url`, `--live-tv-hardware` | Live TV (section 7a). `compose.yaml` sets the first to `http://go2rtc:1984`; `compose.gpu.yaml` sets the second to `vaapi`. Never in the HA App. The same go2rtc's viewing paths are served to pages under `/go2rtc/`. |
| `MANTEL_MA_WEB_URL` | `--ma-web-url` | Music Assistant's web app under `/ma/` (default: the host of the MA address). |
| `MANTEL_FRAME_ANCESTORS`, `MANTEL_CONNECT_SRC`, `MANTEL_FRAME_SRC` | the CSP flags | Space or comma separated origins. They moved from Caddy to Mantel Server. |
| `MANTEL_PROXY_KIND` | `--proxy-kind` | Set by `compose.yaml` (`caddy`) and `compose.byo-proxy.yaml` (`own`). |
| `MANTEL_HTTP_BIND`, `MANTEL_HTTP_PORT` | | Bring your own proxy only: the address and port Mantel publishes for it (default all addresses, `8765`). |

There is deliberately **no** environment variable that turns commands on: `MANTEL_READ_ONLY` only holds them off. An Owner turns them on in Mantel Settings. See section 8.

### HTTPS: four ways

Mantel needs HTTPS for its sign-in cookies, passkeys and talk-back, and so that Music Assistant's frame and go2rtc's sockets work (they go through Mantel, below). Pick one; the HA App needs none of this for its sidebar (Home Assistant's own address and Ingress serve it), and has its own two options for a direct address (below, "The HA App's direct access").

| | You have | Do this | The door header |
|---|---|---|---|
| **1. Mantel's Caddy, its own CA** | no domain | the default: `MANTEL_TLS_SNIPPET=./caddy/tls-internal.caddy`; trust Caddy's root on every device (below), or accept the warning once per device | Caddy stamps it |
| **2. Mantel's Caddy, your domain** | a domain whose DNS host has an API: Cloudflare, Duck DNS, Porkbun, Route 53, DigitalOcean or deSEC | a real certificate through DNS-01 (no port opened to the internet). Cloudflare: `MANTEL_TLS_SNIPPET=./caddy/tls-dns01-cloudflare.caddy` and the secret `cloudflare_dns_token` (a token limited to Zone, DNS, Edit for that one zone); the others: `COMPOSE_FILE=compose.yaml:compose.dns-<host>.yaml` and that host's secret file(s) (table below). Then `MANTEL_HOSTNAME=mantel.<your domain>` and a LAN DNS record pointing that name at the host | Caddy stamps it |
| **3. Your own reverse proxy** | Nginx Proxy Manager, Traefik, ... already owning TLS | add `compose.byo-proxy.yaml` to `COMPOSE_FILE`, set `MANTEL_TRUSTED_PROXY` to the proxy's address **as Mantel sees it**, point the proxy at `http://<this host>:8765` with WebSockets on, and make it send the door header (below) | your proxy must |
| **4. Cloudflare tunnel** | remote access, beside 1, 2 or 3 | `mantel-secret cloudflared_token`, `docker compose --profile tunnel up -d`; Cloudflare Access in front is recommended; set `MANTEL_CF_ACCESS_TEAM` and `MANTEL_CF_ACCESS_AUD` and Mantel verifies Access's JWT on every tunnel request (guide/Install-Docker.md "Cloudflare Access (optional)"). The service URL is Caddy's tunnel door `http://172.31.250.2:8080` (1, 2) or Mantel itself `http://172.31.250.2:8765` (3) | always `tunnel` |

The LXC installer (`packaging/lxc/mantel.sh`) asks at a terminal: Caddy's own CA (Enter), your own domain (then which DNS host serves it), or your own proxy, and whether to add the tunnel; it writes `.env` to match. Without a terminal and with nothing preset (`var_tls=`, `var_dns=`), it takes Caddy's own CA. Existing installations with `MANTEL_TLS_SNIPPET=./caddy/tls-dns01.caddy` keep working: that file is the Cloudflare snippet under its older name.

**Your domain's DNS host** (way 2). Mantel's Caddy image (`packaging/docker/caddy.Dockerfile`, and the published `mantel-caddy`) has these built in, each pinned; the token is a secret file (in the LXC, `mantel-secret <file>`; with Docker, `packaging/compose/secrets/README.md`), and the snippet reads it from there:

| DNS host | `.env` | Secret file(s) | What the credential needs |
|---|---|---|---|
| Cloudflare | `MANTEL_TLS_SNIPPET=./caddy/tls-dns01-cloudflare.caddy` | `cloudflare_dns_token` | an API token, Zone / DNS / Edit for that one zone |
| Duck DNS | `COMPOSE_FILE=compose.yaml:compose.dns-duckdns.yaml` | `duckdns_token` | the account token; `MANTEL_HOSTNAME` is your `<name>.duckdns.org` |
| Porkbun | `COMPOSE_FILE=compose.yaml:compose.dns-porkbun.yaml` | `porkbun_api_key`, `porkbun_secret_api_key` | an API key pair, with API access turned on for the domain |
| Amazon Route 53 | `COMPOSE_FILE=compose.yaml:compose.dns-route53.yaml` | `route53_access_key_id`, `route53_secret_access_key` | an IAM user's key limited to the hosted zone (the policy is in libdns/route53's README) |
| DigitalOcean | `COMPOSE_FILE=compose.yaml:compose.dns-digitalocean.yaml` | `digitalocean_token` | an API token with the domain read and write scopes |
| deSEC | `COMPOSE_FILE=compose.yaml:compose.dns-desec.yaml` | `desec_token` | a token, best limited to the domain by a token policy |

Add other compose files to `COMPOSE_FILE` with `:` as usual. Another DNS host means building Caddy with its `caddy-dns` module (the Dockerfile says how) and a snippet beside the others.

**Trusting Caddy's own CA** (way 1). Copy its root out once: `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt mantel-root.crt` (it lives in the `caddy-data` volume and stays the same across restarts and updates), then install it as a trusted root on each device: iOS and iPadOS, open the file, install the profile in Settings, then turn it on under General → About → Certificate Trust Settings; Android, Settings → Security → Encryption & credentials → Install a certificate → CA certificate; macOS, Keychain Access, System keychain, set it to Always Trust; Windows, `certutil -addstore Root mantel-root.crt` as administrator. Home Assistant reaching Mantel (Mantel Link) needs it trusted where Home Assistant runs too.

**Bring your own proxy: the rules Mantel enforces itself.** The door header `X-Mantel-Door: lan|tunnel` is believed only from `MANTEL_TRUSTED_PROXY`, and only together with **this installation's door key** in `X-Mantel-Door-Key`; from there, **no header (or no right key) means `tunnel`** (fail closed), so a proxy host that forgets it gives wall tablets nothing rather than giving the internet the LAN door. `X-Forwarded-For`/`-Proto`/`-Host` count only from the trusted proxy; HA identity headers (`X-Remote-User-*`, `X-Ingress-Path`) are removed from everyone except HA's Ingress, the trusted proxy included. Mantel sets its own CSP, HSTS (when the proxy says https), `nosniff`, `Referrer-Policy` and `frame-ancestors`, so don't add a CSP in the proxy (browsers enforce both). Keep Mantel's published port off the internet and reachable only by the proxy if you can (`MANTEL_HTTP_BIND`, a firewall rule): a browser that goes around the proxy is the tunnel door over plain HTTP.

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
    set $mantel_door lan;
    if ($http_cf_connecting_ip) { set $mantel_door tunnel; }
    proxy_set_header X-Mantel-Door $mantel_door;
    proxy_set_header X-Mantel-Door-Key MANTEL_DOOR_KEY;
    proxy_set_header X-Remote-User-Id "";
    proxy_set_header X-Remote-User-Name "";
    proxy_set_header X-Remote-User-Display-Name "";
    proxy_set_header X-Ingress-Path "";
    proxy_read_timeout 1h;
    proxy_buffering off;
    client_max_body_size 12m;
}
```

(`$http_host`, not NPM's usual `$host`: it keeps a non-standard port, which the browser's `Origin` carries and Mantel compares.) **The door key.** Mantel makes a random key on first start and keeps it sealed in its data (and its encrypted backups). Replace `MANTEL_DOOR_KEY` above with it: `/proxy-check` shows it to the Owner with the block filled in (Connections, "HTTPS and your proxy", shows the HTTPS mode, the trusted proxies and whether the key is set, to an Owner or Admin, never the key; an Owner can rotate it there and sees the new key once), or run `docker compose exec mantel-server mantel door-key`. "Make a new key" there (or `mantel door-key --rotate`) replaces it at once; paste the new one into the proxy, because until then the proxy's requests are the tunnel door. Without the key, a proxy host that passes a browser's own `X-Mantel-Door` through cannot hand anyone the LAN door. Mantel's Caddy and the HA App need no key.

Use `lan` only on a proxy host that listens on your LAN alone; a host the internet can reach sends `tunnel`. `MANTEL_TRUSTED_PROXY` is NPM's address as Mantel sees it: NPM on another machine, that machine's LAN address; NPM in Docker on the same host, the address its connections arrive from (often the Docker bridge's gateway; `/proxy-check` tells you). The compose end-to-end run (`tools/e2e/compose_e2e.py`) uses exactly this block in a plain nginx as "your proxy".

**Traefik** (dynamic configuration; Traefik passes `Host`, sets `X-Forwarded-*` and upgrades WebSockets on its own):

```yaml
http:
  middlewares:
    mantel-lan:
      headers:
        customRequestHeaders:
          X-Mantel-Door: "lan"
          X-Mantel-Door-Key: "MANTEL_DOOR_KEY"   # this installation's door key
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

### The HA App's direct access (decision 26)

The HA App's sidebar always works. To also reach the App at Mantel's own address (`https://mantel.<your domain>/home`, direct links to every screen, wall tablets without HA's frame), set the App option `access` (packaging/ha-app/DOCS.md "Direct access" has the steps; design in [phase3/HA-APP.md](phase3/HA-APP.md) "Direct access"):

* **`proxy`** — the same "bring your own proxy" rules as above, on the App's port **8100** (plain HTTP; map it to a host port in the App's Network section). `public_url` is the name, `trusted_proxies` the proxy's address as the App sees it (`/proxy-check` shows it; Docker's port mapping may show NPM on another machine as `172.30.32.1`, the hassio bridge), and the NPM block above with `proxy_pass http://<HA machine>:<host port>;` and the door key. On this port the listed proxy's headers (forwarding and door) count **only with the door key**, since the address alone can stand for every client relayed through Docker; the entrypoint and `/proxy-check` warn when `trusted_proxies` holds a hassio (`172.30.32.0/23`) or Docker bridge address. **An NPM Access List allowing only the home's networks is required** on that proxy host (or an NPM the internet cannot reach): the name is public in certificate transparency logs, and the block says `lan`. Mantel also turns a keyed `lan` for an internet client address into `tunnel`. The key crosses the hop NPM → HA's port in plain HTTP: keep it on the LAN. The key: Mantel Settings → Connections → HTTPS and your proxy → Rotate door key (in the sidebar, as the Owner; shown once), or *Test my proxy*'s block. A proxy that is itself an HA App can use `http://local-mantel:8100` without mapping the port, with its own hassio address in `trusted_proxies`.
* **`https`** — Mantel serves HTTPS on 8100 itself with a Let's Encrypt certificate, DNS-01 through Cloudflare or Duck DNS (`dns_provider`; for Cloudflare `cloudflare_token`: Zone / Zone / Read and Zone / DNS / Edit on that one zone; a masked option moved into a 0600 file), renewed by itself; `acme_staging` for trials. An address in the option `lan_networks` (default the private ranges) is the LAN door, any other the tunnel door; HA's hassio network and Docker's bridge never count, so a client relayed by Docker or hairpin NAT is the tunnel door, and tablets need a direct LAN path. Until the certificate is in, the port answers only "certificate pending" (no sign-in over the placeholder). Never forward this port from the internet.

Either way, "Sign in with Home Assistant" works there by itself: Mantel uses **Sign-In Address** (Mantel Settings → Connections → Home Assistant), and when that is empty Home Assistant's own URL (HA → Settings → System → Network: external, else internal); Mantel's password, passkeys and enrolled wall tablets (§5) work as in the containers; HA's identity headers are never believed on 8100; the sidebar, HA's automatic connection and Music Assistant by App hostname are unchanged.

### Music Assistant and go2rtc through Mantel

An https page cannot frame Music Assistant's `http://…:8095` or open `ws://` to go2rtc, so Mantel serves both under its own address: Music Assistant's web app at `/ma/` (`MANTEL_MA_WEB_URL`, default the host of `MANTEL_MA_URL`) and go2rtc's viewing paths at `/go2rtc/` (`MANTEL_GO2RTC_URL`). Both need a Mantel sign-in: Music Assistant needs `control` on the `music` feature (wall tablets have it through the house music grant), a go2rtc camera stream that camera's live view, a Live TV stream the `live_tv` feature and its channel camera's live view (Live TV registers each stream while it is set up and removes it when dropped). Where Mantel serves Live TV (Docker/LXC) its streams are reachable only this way: go2rtc publishes no HTTP port, and a channel camera asked for by name is refused. Only the paths HK needs are passed (never MA's JSON-RPC API, never go2rtc's stream management, config, restart or web pages); MA's and go2rtc's addresses, cookies and headers never reach the page. HK's "Browse Music" frame (`hk-browse-card`) uses `/ma/` on Mantel automatically; in Home Assistant it keeps MA's own port. Music Assistant's own sign-in appears inside the frame, unless you give Mantel a **token for the Music Assistant page** (below).

**The token for the Music Assistant page** (optional; Connections, the Music Assistant panel). Mantel's own MA connection is usually an administrator; the page gets an *ordinary* MA user instead, so every screen opens MA signed in without anyone typing an MA password, and with only a user's rights. To make one: in Music Assistant, Settings, Users, add a user (for example `mantel-page`) with the **User** role (not Admin); then either type that user's name and password once in the panel ("Sign in and save": Mantel makes a long-lived token for it and keeps no password), or sign in to MA as that user, open its profile, Long-lived tokens, create one, and paste it ("Save token"). An administrator's token is refused. The token stays sealed in Mantel and never reaches a page: Mantel signs the frame's own connection in to MA, the way MA's app is signed in behind Home Assistant's Ingress (the frame then opens `/ma/hassio_ingress/mantel/`; signing out of MA there is refused). MA's long-lived tokens last a year. If MA refuses the token (revoked, expired), the frame shows MA's own sign-in again. This relies on how MA's web app recognizes an Ingress session (checked against MA's frontend source on 2026-10-18); a later MA may change it, and the frame then falls back to MA's own sign-in.

### Secrets

Secrets are **files**, never environment variables, the image or the repository. In the compose stack they live on the host in `/etc/hk/secrets/` (`root:10001`, mode `0440`, folder `0750`) and are mounted read-only at `/run/secrets/<name>`:

| File | What | Needed |
|---|---|---|
| `ha_token` | Optional (an empty placeholder is fine): a long-lived token of a dedicated HA administrator user. Normally Mantel's own sealed copy is made on the Connections page instead (section 2a). Never reuse a personal token. | no |
| `at_rest.key` | 32 random bytes, base64. Seals TOTP seeds and device keys in SQLite; read from `/run/secrets` (`--secrets-dir`). **Keep a copy off the box.** | create it now |
| `backup.key` | 32 random bytes, base64. Encrypts the nightly backup. **Keep a copy off the box.** | create it now |
| `ma_token` | Optional, like `ha_token`: Music Assistant's long-lived token, with `MANTEL_MA_URL`; normally set on the Connections page instead (section 2a). With Music Assistant connected, Mantel runs whole-home music itself (section 7a). | to move music off HA |
| `cloudflare_dns_token` | Cloudflare token (Zone:DNS:Edit on one zone) for Caddy's DNS-01 certificates. | only with DNS-01 TLS |
| `cloudflared_token` | The tunnel token. | only with `--profile tunnel` |

In the LXC, `mantel-secret <name>` reads a secret from the keyboard (no echo, no history) into the right place with the right owner. Rotate by replacing the file and `docker compose restart <service>`. Full details: [../packaging/compose/secrets/README.md](../packaging/compose/secrets/README.md).

Credentials set on the Connections page are **not** in this folder (it is read-only inside the container): Mantel keeps them in `<data-dir>/connections/` (`/data/connections`), folder 0700, files 0600, sealed with `at_rest.key`, and inside every encrypted backup. Mantel's saved copy wins over a file here.

Secrets at rest in SQLite (TOTP seeds) are encrypted with AES-256-GCM using `<secrets-dir>/at_rest.key`, created 0600 on first use. **Losing this file makes every enrolled TOTP unreadable**, so back it up with the database (section 10). Tokens, passwords and PINs are stored only as hashes.

### 2a. Connecting Home Assistant and Music Assistant (the Connections page)

Setup now: **start the container, create the first Owner (section 3), open Mantel Settings → Connections.** The page opens there by itself while Home Assistant is not set up.

1. **Home Assistant.** Type its address (for example `http://homeassistant.local:8123`, the address *Mantel's* network reaches it at), then **Connect to Home Assistant**: HA's sign-in page opens; sign in **as the HA user Mantel should act as**, a dedicated administrator (create one named `mantel-server` in HA first: Settings → People → Add person, "Can log in", administrator). Back on Mantel's page you see who Mantel would act as, HA's version and how many entities it has; **Save this connection**. Mantel makes a long-lived token for that user (`Mantel Server (<date>)` in that user's HA profile) and revokes the short sign-in. Or paste a long-lived token made in that user's profile (Security → Long-lived access tokens) and press Test, then Save. The browser must be able to reach the HA address for the sign-in; otherwise paste a token.
2. **Music Assistant** (optional). Its address (`http://<host>:8095`), then an MA user name and password (MA 2.7+; used once to make a long-lived token, not kept; MA's tokens last a year and the page shows the date) or a pasted token. Test, Save.
3. Nothing to restart: Mantel connects at once (open screens just receive the new states). `/healthz` turns `ok`.

**Where a connection comes from, in order (the one rule for HA and MA):** (1) in the Mantel App, Home Assistant is always the App's own credential (not editable); (2) **a connection saved on this page** (Mantel's sealed copy) wins over (3) the installation's: the files `ha_token` / `ma_token` with `MANTEL_HA_URL` / `MANTEL_MA_URL` (or `--token-file`/`--ha-url`, `--ma-token-file`/`--ma-url`), and in the Mantel App the old `ma_url` / `ma_token` options, which are copied once into Mantel's own Music Assistant connection when Mantel updates (the stored connection wins after that); (4) otherwise not set up. An empty file or option counts as none. Disconnecting Mantel's copy goes back to (3) at once.

Only an Owner changes connections; on the tunnel door that needs a fresh factor; Admins see the status. Each change is audited (`config`, `connection.ha.saved`, never the token). **Replace** saves a new one; **Disconnect** removes Mantel's saved copy (and falls back to the installation's file if there is one). Disconnecting does not revoke the token in HA: delete `Mantel Server (<date>)` from that user's profile too if you want it gone. **Suggested address in the Mantel App:** when Music Assistant is not set up and Mantel runs as the HA App, an Owner or Admin opening the Connections page has the address box prefilled (still editable) with Music Assistant's App, found by name: Mantel tries `http://d5369777-music-assistant:8095`, then `-beta`, then `-nightly` (d5369777 is the official Music Assistant App repository's id; Supervisor's DNS resolves App hostnames), resolving the name and reading Music Assistant's unauthenticated `/info` (2 seconds each, no credentials), and suggests the first that answers like Music Assistant. The answer is remembered for 5 minutes. The hint reads "Found Music Assistant’s App — press Test"; nothing is tested or saved until you press Test and Save. It is a name, never an IP address (App addresses can change). Outside the App nothing is probed and the box shows only the example. In the Mantel App (HA App mode) Home Assistant shows "Provided by Home Assistant (App)" and is not editable; Music Assistant is. Details: [phase3/ADMIN-PAGE.md](phase3/ADMIN-PAGE.md) "Connections".

### 2b. UniFi Protect (Docker and the LXC)

Mantel Settings → Connections → UniFi Protect connects Mantel to the console's public API with one API key (docs/guide/Music-and-Cameras.md "UniFi Protect"; docs/phase13/CAMERAS-DIRECT.md). Only where Mantel has its own go2rtc (`MANTEL_GO2RTC_URL`); the HA App shows that cameras come from Home Assistant.

- **The key, the pin and the optional local user** are one sealed file, `<data-dir>/connections/protect.connection` (folder 0700, file 0600, AES-GCM with `at_rest.key`, inside every encrypted backup). The certificate's SHA-256 fingerprint is pinned there on the first Connect and checked in every TLS handshake (requests and the events socket). A changed certificate stops the connection until an Owner trusts the new fingerprint on the page (audited `connection.protect.certificate_trusted`). Each picked camera's stream address (Protect's token) is sealed beside it in `camera-<slug>.connection`; Video From and Notify For are the settings document `house/protect`.
- **The events socket** (`wss://<console>/proxy/protect/integration/v1/subscribe/events`) redials by itself (1, 2, 5, 10, then every 30 s). Its state, its last message and its last error are on the page and in `GET /api/protect` (Owner/Admin). A refused key or a changed certificate stops it until fixed on the page. While it is down, a camera Home Assistant has too notifies from Home Assistant's own sensors.
- **The console's rate limit** is 10 requests a second per key. Mantel paces itself under it, shares a still between screens for 2 seconds, reads the camera list every 5 minutes and asks for a stream's token again at most once a minute when go2rtc can't play it. A second program using the same key can still push it over; give each its own key.
- **Revoking:** delete the key in UniFi OS (Settings → Control Plane → Integrations) and press Disconnect, which forgets the key and removes the picked cameras. Disconnect alone doesn't revoke the key.

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

There is no Owner on a new database. In the HA App the Home Assistant administrator who opens Mantel first becomes it ([phase3/HA-APP.md](phase3/HA-APP.md)). Elsewhere, two ways; either is an explicit administrator step.

**A. A Mantel account with a password** (the usual first start in Docker or the LXC, where nothing is linked to HA yet). While no enabled Owner exists, Mantel prints a **one-time setup code** in its log at every start, in a banner:

```text
========================================================================
  Mantel has no Owner yet. One-time setup code (valid 60 minutes):

    <the code>

  Open https://mantel.example.com/login, "First start", and create the Owner with it.
  When it expires a new one is logged here; `mantel bootstrap` makes one now.
========================================================================
```

Find it with `docker compose logs mantel-server` (Docker, in the compose folder), `pct exec <id> -- docker logs mantel-server` from the Proxmox host (the LXC), or in the output of a server run by hand. It is valid one hour; when it expires and there is still no Owner, a new one is logged. Each new code replaces the last. Only its hash is stored; it is not in the audit log and no page shows it. Never in the HA App's Ingress mode, and never again once an Owner exists.

Open `/login`: while no Owner exists it shows **First start** with fields for the setup code, user name, name and password; it creates the Owner, signs them in and opens Mantel Settings → Connections. A new code at once, replacing the logged one: `mantel-server bootstrap` (in the containers `docker compose exec mantel-server mantel bootstrap`). The same by REST:

```bash
mantel-server bootstrap            # prints a one-time code, valid one hour; it replaces the logged one
curl -X POST "$B/api/bootstrap" -H "Origin: $B" -H 'Content-Type: application/json' \
  -d '{"token":"<code>","username":"avery","name":"Avery","password":"<12+ characters>"}'
```

It spends the code, creates the Owner in one step and signs them in. Afterwards `/api/bootstrap` answers `410 bootstrap_closed` and no code is logged again. Then enrol a TOTP authenticator and a passkey for the Owner (`/api/auth/totp/enroll` and `/enroll/confirm`; `/api/auth/passkey/register/*`). Passkeys need `--rp-id` set to the real hostname first. On the tunnel door a password alone is never accepted, so TOTP or a passkey is mandatory for remote use.

**B. Link an HA account as Owner** (what Proof 1 used). Find the HA user id (the "Not linked yet" page after "Sign in with Home Assistant" prints it, `mantel-server links` lists linked ones, and a `person.*` entity's `user_id` attribute has it), then:

```bash
mantel-server link --ha-user-id <id> --role owner --name "Avery"
```

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

Roles: `owner`, `admin`, `adult`, `child`, `guest`, `wall_tablet` (and `service`, which is only for Service accounts). The starting grants for each are in [phase3/RBAC.md](phase3/RBAC.md) ("Starting roles"). A Child or Guest sees only the rooms they are given: an Owner sets them with `PUT /api/rbac/scopes/user/<id>` (`{"areas": [area names or ids]}`, where `<id>` is Mantel's user id from `GET /api/users`, not the HA id; see RBAC.md "Storage and REST"). Owners can also edit grants and role defaults over `/api/rbac/*`; every such change is audited before it applies. Sign-in with HA works from `/login` and, inside Home Assistant, through Mantel Connect ([Mantel Connect](guide/Mantel-Connect.md)).

Changing a role takes effect at the next command, and open sockets are re-checked every 60 seconds. Disabling a user or unlinking an HA account ends their sessions at once. Admins cannot create or change Owners, and the last enabled Owner cannot be demoted.

### 4a. Mantel in HA's sidebar when Mantel runs outside HA (Mantel Connect)

Only for Docker and the LXC; the Mantel App needs none of this. Design and security rules:
[phase3/CONNECT.md](phase3/CONNECT.md); the App: `packaging/connect-app/`, [packaging/mantel-connect/README.md](../packaging/mantel-connect/README.md).

```bash
# turn Connect on (compose: COMPOSE_FILE=compose.yaml:compose.connect.yaml in .env; the LXC script: var_connect=yes)
docker compose up -d --wait
# on the Mac: stage the App into HA's local apps share, then install "Mantel Connect" in HA
.venv/bin/python tools/stage_connect_app.py <local apps share>/mantel_connect
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

## 5. Wall tablets: accounts, enrollment, PINs (optional)

A wall tablet is a **device** with its own role (`wall_tablet`, scoped to its room), not a person. The design (PLAN §7) replaces `trusted_networks` and `allow_bypass_login`:

1. **Create a Wall Tablet account** for the tablet (an Owner or Admin): `POST /api/users` with `{"username":"loft","name":"Loft tablet","role":"wall_tablet","password":"..."}`.
2. **Sign in on the tablet itself** with that account, then **make it a wall tablet**: Mantel Settings → *Make This Browser a Wall Tablet…*, or `POST /api/devices/enroll` with `{"name":"Loft","tablet":"loft"}`. The server swaps that browser's password session for a **device credential**: an `HttpOnly` cookie bound to that browser, rotated every 24 hours, revocable in one call, refused on the tunnel door, and unused for 90 days it expires. The password is not kept on the tablet. A reboot or a Kiosk Satellite restart does not ask again.
3. **Enrolment must be done from the tablet's own browser**, because the credential is a cookie in that browser: sign in there and use Mantel Settings → *Make This Browser a Wall Tablet…* ([Wall Tablets](guide/Wall-Tablets.md)).
4. **The room is chosen, never typed.** The dialog lists HK's wall tablets (`GET /api/devices/rooms`: their name, room and screen, and the enrolled devices already in each one's room, marked *In Use*); picking one gives the device that tablet's room and, by default, its name. *Not One of These* offers Home Assistant's areas. The server refuses a room that is neither an HK tablet's room nor an HA area (`unknown_room`; `unknown_tablet` for a tablet id it does not have); only while Mantel knows no rooms at all (no HK settings, HA not read yet) does it take the room as given. It matters because a wall tablet device reports its touches and black screen only for the HK tablet in its own room, and `/home` opens that tablet's screen: a room typed as "Livingroom" for HK's `living_room` would silently cut the tablet off.
   **Moving a device** (Owner or Admin): Mantel Settings → All Screens → Wall Tablets → the tablet → its room, or `PATCH /api/devices/<id>` with `{"tablet":"living"}` or `{"room":"garage"}` (`{"room":null}` clears it). The same validation; an audit row (`device.room`, from and to) first; the device keeps its cookie, and its open screens take the new room at the next minute's check. Devices warns on any wall tablet device whose room has no HK tablet ("its touches and black screen won't reach Mantel"); `GET /api/devices` gives each device's `hk_tablets`.
   For permissions, a tablet with no stored area scope is scoped to its room. An Owner can widen or narrow that: `PUT /api/rbac/scopes/device/<device id>`.
5. **Revoke** at any time: `DELETE /api/devices/<id>` (Owner or Admin, or the tablet itself); `GET /api/devices` lists them (never any secret). A retired secret presented again more than 60 seconds later revokes the device (`credential_reuse`), which is how a copied credential is caught.

### Wall tablets in the HA App (decision 21)

When Mantel runs as the HA App and the tablet opens HA's panel, a tablet is **not enrolled**: it keeps its own HA user (signed in by `trusted_networks` in Kiosk Satellite) and the Owner links that HA user to a Mantel device. Design: [phase3/HA-APP.md](phase3/HA-APP.md) "Wall tablets through the App".

1. **Link** (Owner, in the sidebar): People → the tablet's HA user → **Link as a wall tablet**, *a new device* (or an existing wall-tablet device) and its room. REST: `POST /api/ingress/tablets {"ha_user_id": "...", "room": "loft"}` (`device_id` to reuse a device, `name` to name a new one); `GET /api/ingress/tablets`; `DELETE /api/ingress/tablets/<ha user id>`. Audited (`ingress.link_tablet` / `ingress.unlink_tablet`). A person link of the same HA user is replaced; the last Owner cannot be turned into a tablet.
2. **Start URL** in Kiosk Satellite: `http://<HA's address, as today>:8123/app/local_mantel` (HA's own App panel; the same for every tablet). The tablet opens on its own HK screen (its Tablet User in HK's settings), and Mantel asks HA's frontend to hide the sidebar and header.
3. **Rules:** with **Coming Through Home Assistant** (`ha_door_rules`) on **Trusted** (default) or **Home Network Rules** (`lan`) the tablet gets the LAN door's tablet rules: its room, every camera, and sensitive commands decided by the tablet's own grants. No PIN is asked for them (decision 25, docs/PLAN.md; "A person's PIN" below). With **Away Rules** (`tunnel`) linked tablets are refused ("Wall tablets are off for the sidebar"). A device *credential* (the LAN enrollment's cookie) is never accepted through the sidebar.
4. **Or at Mantel's own address** (the App's direct access, above): the tablet is **enrolled** like in the containers (on the LAN door: signed in once as the Owner at `https://<public_url>/`, Mantel Settings → *Make this browser a wall tablet*, its HK tablet), and Kiosk Satellite's start URL is `https://<public_url>/home`, which opens the HK screen of HK's tablet in that room. No HA user for the tablet is needed there.
5. **Unlink** ends it at once for new requests (open sockets at the next minute's check); a device made for the link is revoked. **Rollback** of a tablet is its start URL back to its HA dashboard (and its ownership back to HA in linked mode).

### A person's PIN (optional, unused)

**Decision 25 (2026-10-18, docs/PLAN.md): the only PIN in Mantel is the house Alarm PIN, and only for the alarm.** A wall tablet no longer asks for a person's PIN for an unlock or the garage: roles and grants decide, and every command is audited first. Disarming still needs the house Alarm PIN (set in Mantel Settings → Features → Alarm PIN); see the alarm notes in [phase3/GATEWAY.md](phase3/GATEWAY.md).

A person may still set a personal PIN, but nothing requires or checks it:

- **Set** from the person's own session, with a fresh factor and CSRF: `api -X PUT "$B/api/account/pin" -d '{"pin":"2580"}'` (also "Me → My PIN" on the admin page). Remove: `DELETE /api/account/pin`. An Owner or Admin can clear someone's: `DELETE /api/users/<id>/pin`.
- **Rules:** 4 to 8 digits, not a repeated digit, not a straight run; stored only as an Argon2id hash; a PIN already in use is refused (`pin_unavailable`).

Details: [phase3/PINS-AUDIT.md](phase3/PINS-AUDIT.md), [phase3/ACCOUNTS.md](phase3/ACCOUNTS.md).

## 6. Service accounts for linked mode

Linked mode lets the HA integration `hk_frontend` forward its actions and mirror entities to Mantel while keeping the same domain, unique ids and entity ids (see [phase5/LINKED-MODE.md](phase5/LINKED-MODE.md)). It authenticates with a **Service account**: a machine account with no password or role, only a bearer credential and a scope. Owner only.

```bash
mantel-server service-account create --name home-assistant --scope linked   # prints the credential ONCE
mantel-server service-account list
mantel-server service-account revoke --id <id>
```

(Or `GET`/`POST /api/service-accounts`, `DELETE /api/service-accounts/<id>`, from an Owner's own session on the LAN door, or in the HA App from the Owner's sidebar when **Coming Through Home Assistant** is **Trusted** or **Home Network Rules**.) **In the HA App** HK Frontend's address is `http://local-mantel:8099` (the App's hostname on HA's internal network): the App lets HA Core (`172.30.32.1`) reach `/linked/ws` and nothing else (HA-APP.md "Linked mode in the App"). [Mantel Link](guide/Mantel-Link.md), which replaces HK Frontend's linked mode, accepts that plain-http address because it resolves into HA's internal App network, and the App announces it by itself. The credential looks like `msvc_<id>_<secret>`; only its hash is stored. Paste it into **Settings, Devices & services, HK Frontend, Configure, Linked to Mantel Server** along with Mantel's `https://` address. Home Assistant stores it in plain text in `.storage/core.config_entries`, as it does every integration's token; it is never logged and is revoked on Mantel's side in one step. Linked mode works only on the LAN door, never from a browser (a request with an `Origin` is refused), and Mantel can change only the entities it mirrors: it cannot call a service in HA. Turn the option off and today's integration comes straight back.

**Which tablets are Mantel's** (the cutover, one tablet at a time): every tablet, and the rest of the entry (`house`), is Home Assistant's until an Owner moves it: `PUT /api/linked/owners {"unit": "<tablet id>" or "house", "owner": "mantel" or "ha"}` from an Owner's own session on the LAN door, or the Owner's sidebar in the HA App with `trusted`/`lan` rules (audited first; `house` only after every tablet). `GET /api/linked/owners` (Owner/Admin) lists who owns what. HA is told over the link and keeps it; Configure, Linked to Mantel Server shows it. See [phase5/LINKED-MODE.md](phase5/LINKED-MODE.md) "Per-tablet ownership".

The linked endpoint, the Service accounts, the frames, the handlers (black screen, pop-ups, Alarm PIN) and the tablets' entities are built and wired; Mantel Link is today's Home Assistant side ([Mantel Link](guide/Mantel-Link.md)).

## 7. Importing HK's settings from Home Assistant

One time, to move the house's HK Settings (looks, rooms, screens, tablets, pop-ups, custom pages, chips, accessories) into Mantel's database. It reads `hk_frontend/panel/get` from HA once and writes nothing to HA. It needs Mantel's HA token to belong to an administrator.

```bash
mantel-server import-settings --ha-url http://homeassistant.local:8123 --token-file ~/.config/mantel/ha_token
```

Or, as the Owner, `POST /api/settings/import` (`GET` shows whether it ran and whether the settings are still empty). It is idempotent: a second run reports when the first ran and changes nothing; a document you already edited in Mantel is left alone and listed as skipped. Every imported document is version 1 in an append-only history; any version can be read back or restored (`mantel/settings/history`, `mantel/settings/restore`). In the container stacks use the `mantel` helper from section 3 with `--token-file /run/secrets/ha_token`.

Accessories, Hidden Accessories and the Alarm PIN's settings are Mantel's too (the Alarm PIN itself never leaves Home Assistant: set it again in Mantel, [Moving from HK Frontend](guide/Moving-from-HK-Frontend.md)). The features' own settings (notifications, energy, Live TV, Clean Areas, and music's speakers, presets, playlists and home rooms) come with the feature import (`POST /api/features/import`, [phase4/FEATURE-PARITY.md](phase4/FEATURE-PARITY.md)). HK Settings saves from the page already go to Mantel's store, never to HA, and are allowed while commands are off. See [phase3/SETTINGS.md](phase3/SETTINGS.md) for the list of what is refused and why.

### 7a. Music Assistant (Mantel's music engine)

> **The normal way is the Connections page** (section 2a): Music Assistant's address and an MA sign-in or token, typed in once, sealed on the data volume, applied without a restart (the engine below follows at once; with Music Assistant disconnected the Music page goes back to the interim bridge). The file and App-option paths below are the *installation's* source: the page shows them as "set by the installation", and **a connection saved on the page wins over them** (the one precedence rule, section 2a).

Mantel can run HK's whole-home music itself, talking to Music Assistant's own WebSocket API instead of through HA's `hk_frontend` engine ([phase4/MANTEL-FEATURES.md](phase4/MANTEL-FEATURES.md) "Music"). It needs two things, and **until both are there nothing changes**: the Music page keeps reading HA's engine through the interim bridge and its buttons go to HA's engine (when commands are on), exactly as before.

1. **Music Assistant's address and a token for Mantel.** Make a long-lived token in Music Assistant for Mantel alone (its web UI, under your user profile; never reuse one HA or a person holds). The token is a **file**, never an environment variable, a command-line value or a log line; Mantel reads it at every connect (rotation = replace the file, restart) and never stores or logs its value.
   - *Compose / LXC:* `mantel-secret ma_token` (or write `/etc/hk/secrets/ma_token`, `root:10001`, `0440`), set `MANTEL_MA_URL=http://<music assistant>:8095` in `packaging/compose/.env`, and `docker compose up -d`. The token is mounted at `/run/secrets/ma_token`.
   - *By hand:* `--ma-url http://<music assistant>:8095 --ma-token-file <secrets-dir>/ma_token` (a 0600 file).
   - *HA App:* **Mantel Settings** → **Connections** → **Music Assistant**. The old `ma_url` / `ma_token` options are copied once into this connection when Mantel updates; they are "(moved)" and do nothing after that.
2. **The music settings in Mantel.** The feature import brings them (HA's `hk_music/settings/get`, read once; nothing is written to HA): as the Owner, `POST /api/features/import` or the Ingress people page's import button. A new install's one-time import brings them too.

Check with `GET /api/music/status` (Owner/Admin): `music_assistant`, `connected`, `settings` and `active` (Mantel answers the Music page) plus the last requests and failure notes. **While house commands are off**, every music action is refused before anything reaches Music Assistant (reads and the feed work). Once an Owner turns them on (General → Allow Control of the House), the Music page's actions run through the gateway (RBAC on the rooms, an audit row each) and Mantel's engine sends them to Music Assistant. To go back to HA's engine, disconnect Music Assistant on the Connections page (or remove the token file) and restart.

### 7b. Live TV

**HA App:** nothing to do. HK's Live TV page keeps playing HA's channel cameras (HA's own transcode) as before.
Mantel now counts the viewer heartbeat itself. With commands on, the heartbeat also reaches HA's
`sensor.tv_viewers`; with them off, HA doesn't hear about screens watching through Mantel.

**Docker / LXC:** Mantel serves Live TV through the stack's own go2rtc (`compose.yaml` already sets
`MANTEL_GO2RTC_URL`). To turn it on:

1. In `.env`, set `MANTEL_LAN_IP` (go2rtc's WebRTC address). On a host with Intel QuickSync, also set
   `COMPOSE_FILE=compose.yaml:compose.gpu.yaml` and `MANTEL_RENDER_GID` (`getent group render | cut -d: -f3`).
2. Firewall: the container must reach the tuner (`:80` lineup, `:5004` streams), and the tablets must reach
   `MANTEL_LAN_IP:8555` tcp+udp.
3. As the Owner, run the feature import again (`POST /api/features/import`). Where Mantel has go2rtc, it brings
   HA's tuner, guide, channels, names and quality over **with Live TV on**. Or set them yourself:
   `PUT /api/features/settings` with `live_tv: {enabled: true, tuner: "<HDHomeRun IP>", guide_url: "...",
   channels: ["4.1", ...], names: {...}, quality: "720"}`.
4. Turn HA's own Live TV off, or link HA (section 6), so that HA's transcode and Mantel's don't both take a
   tuner.
5. Check with `GET /api/live_tv/status` (Owner/Admin): `mode` should be `mantel`, with the channels listed.
   While someone watches it also shows the sessions, streams and viewers.

A channel is set up in go2rtc when a screen tunes in, and removed 5 s after the last one closes it (go2rtc
frees the tuner). Who may watch: anyone with the `live_tv` feature (Owner, Admin, Adult; wall tablets by a
house grant) who may view that channel's camera. Details: [phase4/FEATURE-PARITY.md](phase4/FEATURE-PARITY.md)
"Live TV served by Mantel".

## 8. Enabling commands

By default Mantel Server **cannot** send a command to the house. This is the most important switch in the system, and it is deliberate and per server:

- It is **Allow Control of the House** in Mantel Settings → General. Only an Owner turns it on, and turning it on always asks the Owner to confirm it is them (a fresh sign-in factor). It applies at once, with no restart, on the App, Docker and LXC alike, and every change is in the audit log. It is off on a new install. No REST call or client message without that fresh factor turns it on. `--commands-enabled` (the App's old `commands_enabled` option) is now only the first start's value, copied once; after that the stored setting wins.
- **`--read-only` is the operator's override** (the App's `read_only` option, "Read-only (kill switch)"; Docker `MANTEL_READ_ONLY=1`): the house stays read-only whatever Mantel Settings says.
- While off, the command path cannot even be constructed: no `Gateway`, the HA command connection raises `CommandsDisabled`, the page's client has no actions, and every command-shaped message gets `commands_disabled` and nothing is audited or sent.
- The state connection to HA (the one that reads everything) can never send a service call, in either mode. The startup line says `read-only; commands disabled` or `COMMANDS ENABLED`, and a warning is logged when on.
- **Switching it on is the Owner's decision**, made deliberately, per server, and not before the setup is checked. Re-run `tools/e2e/gateway_e2e.py` on the exact commit being deployed first.

When on, every command goes through the gateway (GATEWAY.md):

1. **Who:** the session's person and/or the tablet's device. Effective permission is the **intersection** of the two.
2. **RBAC:** deny by default, explicit deny wins, grants may carry time windows. Services that can reach many things (area, device or floor targets, `entity_id: all`) are refused; entity-less services other than notifications and scripts need `configure` on settings (Owner/Admin).
3. **No step-up** (decision 25, docs/PLAN.md). Sensitive actions (locks, garage, water valves, automations, scripts, camera live view, talk-back) ask for no PIN and no fresh factor, on any door; the roles and grants decide. On the tunnel the roles' tunnel switches still apply: Owner/Admin/Adult may do it, with an Owner notification on every remote lock or alarm action; Child and Guest are LAN-only by default. The alarm keeps its code: disarming (and arming, if "Require the PIN to arm" is on) needs the house Alarm PIN, the same on every door.
4. **Audit before send:** the row is written first; if it cannot be written, the command is refused (`audit_unavailable`). Service data (which can carry an alarm code) is never stored.
5. **Forward** with Mantel's own HA credential, one ticket per audit row, spent once.

Decisions you may want to revisit are listed at the end of GATEWAY.md (every wall tablet may view every camera, so the doorbell pop-up shows everywhere).

## 9. Reading the audit log

`GET /api/audit` (Owner and Admin; every other role gets 403, nobody signed in 401), newest first:

```bash
api "$B/api/audit?limit=50"
api "$B/api/audit?decision=denied&since=1760000000"           # epoch seconds
api "$B/api/audit?device=<device id>&kind=service"
api "$B/api/audit?limit=100&before=<next from the last page>"   # paging
```

Filters: `actor` (user id), `device`, `decision` (`allowed|denied`; rows from before decision 25 may say `step_up`), `kind` (`service|ws|http|ma|tablet|config|system`), `since`, `until`, `before`, `limit` (1 to 500). Each row has the person (id, name, role at the time), the device, the action and target, the decision and reason, whether it was sensitive, the door, the source IP, the factor used and its age, and the `result` (`ok`, `error:<code>`, or `not_sent` for denials). Rows for `kind=config` are changes to Mantel's own configuration: roles and grants, people and accounts, devices, connections, server settings. `actor=mantel`, `kind=system` rows are the server's own (Owner notifications, the retention purge).

What to look for: a `denied` row with an unexpected person; repeated wrong Alarm PINs at a keypad (the keypad locks that place for 15 minutes); `tunnel` door rows for locks; `error:` results (HA refused). Rows are append-only: nothing can edit or delete one, except that the hourly retention step deletes rows older than the window (365 days by default, at least 30), and it records every purge in two places. The SQLite triggers do not protect against someone who can replace the whole file, so keep the file's permissions and backups tight.

## 10. Backups and restore

Mantel makes its own **encrypted backups** (`backup.py`); the user guide's [Backups](guide/Backups.md) is the full
procedure. In short:

| What | How |
|---|---|
| Nightly backups | `--backup-target DIR` (Docker/LXC: `MANTEL_BACKUP_TARGET`, the mounted folder) turns them on; `--backup-time`, `--backup-keep-daily`, `--backup-keep-weekly`, `--backup-no-files`. The time is Home Assistant's time zone once known. The HA App uses Home Assistant's own backups instead (`backup: cold`). |
| One now | `docker compose exec mantel-server mantel backup --target /backups`. It deletes no older backup unless given `--keep-daily` / `--keep-weekly`. Take one before every update (section 11). |
| What is inside | A consistent snapshot of `mantel.db` (checked before it is packed), Your Files and Mantel Photos (unless `--no-files`), the saved connections, Mantel Connect's CA, and the keys Mantel makes (`keys/`: push, the apps' identity). Sealed with `backup.key`. |
| What is not | `at_rest.key` and `backup.key` (keep your own copies, away from the backups), the other secret files, `.env`. |
| Check one | `mantel restore FILE --verify-only`: decrypts and checks everything, changes nothing. |
| Restore | `mantel restore FILE --data-dir /data` into a fresh data folder, or `--replace` (the old files are moved aside as `*.before-restore-<time>`, never deleted). A backup from a newer Mantel is refused, and so is a database a newer Mantel migrated. |

Keep the backup folder on storage only you can read: a backup holds password hashes and the audit log, sealed
with `backup.key`.

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

**Home Assistant App.** Updated by Home Assistant (Settings, Apps). Back up first with HA's own backup ([Updating](guide/Updating.md)).

**HK Frontend in Home Assistant** is a separate thing with its own steps: section 12.

Open screens can notice a new build: `GET /api/version` returns the build id, and assets are served with `no-cache` and an ETag, so a reload always revalidates. This ends the old Clear cache + Reload dance for Mantel's own pages; it does **not** apply to the HACS build inside HA (section 14).

## 12. Installing HK builds into Home Assistant

This is for a Home Assistant that runs HK Frontend from a source build rather than from HACS (a development or testing install). It changes only `custom_components/hk_frontend/` in your Home Assistant's config folder. Most people install HK Frontend from HACS (see the user guide); use this only if you build it yourself. `<ha-config>` below is your Home Assistant's config folder (a mounted share, or a path on the HA machine); install into a production Home Assistant only with the owner's approval.

**Before**

1. Validate the commit you will install: the Node suites and HA Python suites in a fresh build, the Mantel suite, the offline smoke, and `tools/testha/run.sh` on the scratch HA (section 13) including the open-screen upgrade check. Install exactly the commit you built.
2. Make an HA backup (Settings, System, Backups, Create backup).
3. Note the rollback point. If `<ha-config>` is a git repository: `git -C <ha-config> log --oneline -1 -- custom_components/hk_frontend`. Otherwise the backup from step 2 is your rollback. Leave any other uncommitted changes there alone.

**Install**

```bash
cd <your mantel checkout> && git pull
build=$(mktemp -d) && python3 tools/build_ha.py "$build/ha"
rsync -a --inplace --exclude __pycache__ "$build/ha/custom_components/hk_frontend/" <ha-config>/custom_components/hk_frontend/
diff -rq -x __pycache__ "$build/ha/custom_components/hk_frontend" <ha-config>/custom_components/hk_frontend | grep -v "^Only in <ha-config>"   # must print nothing
```

- **Use `--inplace`.** Without it rsync writes each file to a temporary `.<name>.XXXX` first; for `__init__.py` that name starts with `._`, which some network shares (the Home Assistant Samba add-on, for one) refuse. The result is a half-copied folder: every `__init__.py` missing, and the old bootstrap running against new card files. Always run the `diff` check before restarting.
- **No `--delete`.** The live folder may hold git-ignored files the build does not ship, such as `frontend/sky/scenes/` (the seasonal sky scenes), `tools/sky/src/` and `tools/sf_symbols/.sfcache/`.
- **Restart Home Assistant.** The new frontend only works once the new `__init__.py` has loaded. Then check HA's log shows the integration loaded with nothing beyond the custom-integration warning, and that the page loads only `/hk/modules/hk-boot.js` (200, `no-cache`).
- **Reload every open screen** with the cache cleared, starting with one tablet. An open page survives the swap (scratch-tested), but a browser that stayed open can hold an old cached module next to a new one (section 14).
- The version number in `manifest.json` stays as it is unless bumped; bump it first if HACS or the tablets should notice.

**Roll back**

```bash
git -C <ha-config> checkout <rollback commit> -- custom_components/hk_frontend
git -C <ha-config> clean -fd -- custom_components/hk_frontend    # removes files the build added; without -x it keeps ignored ones
```

Then restart HA and reload the tablets. Or restore the backup from step 2.

## 13. The scratch Home Assistant

`tools/testha/` runs a throwaway Home Assistant on this Mac at `127.0.0.1:8124` with Home Assistant's `demo` integration (invented devices only), loaded with the built `hk_frontend` exactly as HACS would install it. It checks what the Node suites cannot: that the HA build works in a real HA frontend. It never touches your real Home Assistant, and reads nothing from `~/.config/mantel`.

```bash
.venv/bin/python tools/testha/testha.py up --fresh    # build, write config, start, onboard, add HK, make 3 dashboards
.venv/bin/python tools/testha/check.py                # click through it in headless Chrome: PASS/FAIL per item
.venv/bin/python tools/testha/testha.py down          # always stop it when done
```

`tools/testha/run.sh` does the three in one go (about 8 minutes). `restart_check.py --new <tree>` swaps HK under an open `/hk-wall` page and restarts HA, which is the test for a tablet nobody may reload. `tools/e2e/gateway_e2e.py` uses the same scratch HA for Mantel's command gateway. Two traps are already handled by `up`: HA 2026.9 reverts a `server_port` trial to port 8123 on all interfaces after five minutes unless it is confirmed, and onboarding would add network integrations. Details: [../tools/testha/README.md](../tools/testha/README.md) and [phase1/TESTHA.md](phase1/TESTHA.md).

## 14. Troubleshooting

**The dashboard is blank, or HK lost its menu, tab bar or screensaver (HA build).** HA imports every extra module in parallel and in no fixed order, so HK's bootstrap files raced each other (`hk-host-shell.js has not loaded`, `HKClient has not loaded`, `reading 'onNavigate'`). The fix is the **ordered boot** (`boot.py`, commit `9e70e87`): HA is given one module, `/hk/modules/hk-boot.js`, which joins the dependency-free core in order and then imports the rest. If the symptom returns, check that the page requests `hk-boot.js` (not 15 separate modules) and that it answers 200 with `no-cache`; check the HA log for `Failed to load extra module`. The scratch HA's load-order probe (check items 9, 9b, 9c) is the test.

**After an install or restart, one screen shows `hkCards.onHass is not a function` or half-new behavior.** A browser tab that stayed open ran an old cached module (`hk-menu.js`) next to the new one. **Reload every open screen with the cache cleared**, including wall tablets. HK modules in the HACS build are served without hashed names, so this is expected until a screen is reloaded. Mantel's own pages do not have this problem (they revalidate on every load).

**The Samba `._` temp files.** The HA Samba add-on refuses names starting with `._`, which rsync's default temp files do. Symptom: a half-copied install (missing `__init__.py`, missing `hk_core/`). Always `rsync --inplace`, then run the `diff`. See section 12.

**A harmless `not_found` ("Subscription not found") after a restart.** An unsubscribe answered by a server that restarted and never had that subscription. It shows up intermittently in open-screen restart tests, on old and new builds alike, and the page keeps drawing and following state. It comes from outside HK's subscription port (the client now resolves on exactly that refusal). Ignore it unless the page also stops updating.

**"Not linked yet" after Sign in with Home Assistant.** The page prints the HA user id; an Owner links it (section 4). "Account disabled" means the linked person is disabled.

**Every wall tablet is refused, or every request counts as the tunnel.** The LAN door is believed only from a proxy listed with `--trusted-proxy`, and only when that proxy sends `X-Mantel-Door: lan`. Behind Caddy that is `MANTEL_TRUSTED_PROXY` (Caddy's fixed backend address); with it unset the entrypoint warns and fails closed. Behind your own proxy, `MANTEL_TRUSTED_PROXY` must be the proxy's address as Mantel sees it and the proxy must send the header: open `/proxy-check` as the Owner. Tablet device credentials, Service accounts and device enrollment are all refused on `tunnel` (`403 lan_only`).

**An alarm keypad says "try again in N min".** After 5 wrong Alarm PINs in a row that place (a tablet, a session, linked mode) is locked for 15 minutes, and a source IP may fail 20 times per 15 minutes; even the right PIN is refused until then. It survives a restart. Wait, or clear the lockout row in `pin_lockouts` with the server stopped.

**`commands_disabled` in the browser console.** Working as designed: **Allow Control of the House** is off (or `--read-only` is set), so the page's client sends nothing. Settings saves are the exception and still work. This is also what the scratch checks look for as proof that nothing leaks.

**A command answers `forbidden`.** The reason is in the answer (`no_grant`, `explicit_deny`, `tunnel_lan_only`, ...) and in the audit row. There is no step-up prompt for house commands (decision 25); a command that carries a `step_up` field is refused `invalid_command`. An alarm command that needs a code on an alarm with no Alarm PIN set answers `alarm_pin_not_set`: set it in Mantel Settings → Features → Alarm PIN.

**`/healthz` says `degraded`.** The link to Home Assistant is down: check `--ha-url`, the token file (a missing file stops the server at start with a message), that the HA user still exists and is an administrator, and the DMZ firewall rules from the Mantel container to HA's `:8123`.

**The server refuses to start with `--listen`.** A non-loopback listen address needs `--public-url https://name/`; without it parsing fails on purpose. `--public-url` and `--allow-host` without `--listen` are refused too. A request whose `Host` is not loopback and not in `--allow-host` is refused (DNS-rebinding protection), so add the LAN IP to `MANTEL_ALLOW_HOSTS` if tablets use it.

**Passkey registration fails.** WebAuthn forbids an IP as the relying party. Open Mantel by its hostname and set `--rp-id` to that hostname's registrable domain.

**The browser warns about the certificate.** With `tls-internal.caddy` the certificate comes from Caddy's own CA; trust its root on each device, or use DNS-01 with a real domain.

**The Music Assistant frame is blank, or says Music Assistant is on your local network.** On Mantel the frame is `/ma/`: set `MANTEL_MA_URL` (or `MANTEL_MA_WEB_URL`) and check the person may `control` the `music` feature (`GET /api/services` says `music_assistant: null` otherwise). A `502 upstream_unavailable` from `/ma/` means Mantel cannot reach Music Assistant. In Home Assistant the frame still points at MA's own `http://…:8095`, which an https page cannot frame.

**Two Content-Security-Policy headers, or Music Assistant's frame refused by its policy.** Your proxy adds its own CSP; remove it (Mantel sets its own). `/proxy-check` finds this.

**Live TV says "Tuning" and never plays (Docker/LXC).** Look at `GET /api/live_tv/status`. If `error` names go2rtc, the go2rtc service is down. If a session exists but no picture comes, check go2rtc's log (`docker compose logs go2rtc`): a `503` from the tuner means both tuners are busy (HA's own Live TV, Plex). If there's no error, check the tablets can reach `MANTEL_LAN_IP:8555` (tcp+udp). An empty channel list for one person means they lack the `live_tv` feature or may not view the channel's camera.

**`client_smoke.py` fails to start Chrome.** It uses the fixed DevTools port 9337 and collides with another job's run. Run it alone.

**The scratch HA is still running.** `testha.py status`, then `testha.py down`. A crashed run can leave `hk-phone`'s menu on the tab bar; `check.py` resets it first.

## 15. Known gaps

What is still not done, as of 0.1.75 (the second audit pass, [development/Audit-2026-10-second-pass.md](development/Audit-2026-10-second-pass.md), has the details and the reasons):

| Gap | Effect |
|---|---|
| **No public release yet** | No tags, no add-on repository branch, no published images: the install pages' repository and image steps work from the first release ([Releasing](development/Releasing.md)). |
| **An older Mantel Link pairs without the address** | Pairing protocol v2 (Mantel Link 0.1.6) puts the address Home Assistant used in both proofs, and Mantel refuses one that isn't its own (first pass, T2). Mantel still accepts v1 from an older Mantel Link, whose proof doesn't name the address: with one, check the address you pair with, or update Mantel Link first. |
| **Wall Tablet accounts are not bound to one room** | One tablet per account; which room it may enrol in is a product decision (first pass, T6). |
| **Two people editing one screen's Home Grid at once** | The later Save replaces the earlier one (second pass, SET-7). |
| **New-device sign-in notifications, shared rate limits** | Not built. |
| **Apple apps** | See [iPhone and Mac Apps](guide/iPhone-and-Mac-Apps.md) for what is not built yet. |
