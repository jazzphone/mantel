# Mantel as a Home Assistant App (Ingress identity, path prefix, Supervisor connection) — 2026-10-18

PLAN §8's third way to run the one image: Mantel Server **as an HA App**, its page in HA's sidebar
through Ingress, HA's built-in App credential to reach HA Core, HA's backups. Built, unit-tested, smoked
in a browser under a fake Ingress prefix, and run in App mode against the scratch HA. **Not yet
installed on the house** (that is the orchestrator's next step; install steps and checklist below).
Commands stay off (`commands_enabled: false`).

When Mantel Server runs **outside** HA (Docker, an LXC) the sidebar entry is the Mantel Connect App instead, paired
once with a one-time code and reusing this page's identity rules unchanged: [CONNECT.md](CONNECT.md).

## What changed

| Path | What |
|---|---|
| `hosts/server/mantel_server/ingress.py` (new) | Identity from Ingress, the first-Owner bootstrap, the people page, the settings-import form, the prefix (redirects, served files), the middleware. `register(app, hub, token)`; inert unless `cfg.ingress`. |
| `mantel_server/config.py` | `ingress`, `ingress_peers` (default `172.30.32.2`), `ingress_only`, `ha_door_rules` (`trusted`/`lan`/`tunnel`), `ha_ws_url`, `log_level`; flags `--ingress --ingress-peer --ingress-only --ha-door-rules --ha-ws-url --log-level`; `cfg.ws_url`. |
| `mantel_server/sessions.py` | `identity()` asks `app["ingress_identity"]` first; an `ingress`-method session is refused outside Ingress; cookie path/`Secure` and client IP can come from the Ingress middleware; `REQUEST_DOORS` adds `ha`; refresh of an `ha` session. |
| `mantel_server/authz.py` | `rules_door()`, `ha_trusted()`: the `ha` door gets the LAN's rules and HA's sign-in as the factor (`trusted`), the LAN's (`lan`) or the tunnel's (`tunnel`). |
| `mantel_server/gateway.py` | `REMOTE_DOORS = {tunnel, ha}`: a sensitive action through the sidebar notifies the Owners like a remote one. |
| `mantel_server/migrations/0008_ha_door.sql` (new) | Rebuilds `action_audit` so its `door` CHECK allows `ha` (rows, ids, AUTOINCREMENT position, indexes and both append-only triggers kept). |
| `mantel_server/server.py` | Middleware order `loopback_only → ingress → require_session`; Origin may match `X-Forwarded-Host` through Ingress; `/hk/`, `/web/` and the home page go through `ingress.file_response`; HA clients take `cfg.ha_ws_url`. |
| `ha_client.py`, `readproxy.py`, `connectors/camera.py` | An explicit WebSocket URL (`ws://supervisor/core/websocket`). |
| `__main__.py` | `--log-level`. |
| `web/shim/base.js` (new), `web/home.js`, `web/shim/hub.js`, `mantel-host.js` (and `mantel-stepup.js`, since deleted by decision 25) | Mantel's own page code: prefix from `<meta name="mantel-base">`, REST and WebSocket through it, history writes/links kept under it. **No file of `web/hk`, `web/client`, `web/cards`, `hk_core` or `hosts/ha` changed: the HA build is byte-identical.** |
| `packaging/ha-app/` | `config.yaml`, `Dockerfile`, `requirements.txt`, `DOCS.md`, `README.md`, `translations/en.yaml`, `icon.png`. |
| `packaging/docker/entrypoint.py` | App mode: `--ingress --ingress-only`, `--ha-ws-url ws://supervisor/core/websocket`, `--secrets-dir /data/secrets`, commands only if the option is exactly `true`, `log_level`, `ha_door_rules`; test-only env overrides for the scratch HA run. |
| `tools/stage_ha_app.py` (new) | Assembles the App folder; `--dry-run`; private-content scan. |
| `tools/package_check.py` | HA App rules updated (panel_admin stated, `homeassistant_api`, commands off by default, no `image:`). |
| `tools/headless/ingress_smoke.py` (new) | The page under a fake prefix behind a stand-in Ingress proxy, in headless Chrome. |
| `tools/testha/app_mode_check.py` (new) | App mode (entrypoint and all) against the scratch HA. |
| `tests/test_ingress.py`, `tests/test_ingress_paths.py`, `tests/test_stage_ha_app.py` (new) | 48 tests. |

## Identity: who is signed in

Through Ingress, HA's frontend opens `/api/hassio_ingress/<token>/` in an iframe; HA Core proxies it to the
Supervisor, which proxies it to the App's port 8099 and adds the signed-in HA user: `X-Remote-User-Id`,
`X-Remote-User-Name`, `X-Remote-User-Display-Name` (and HA Core adds `X-Ingress-Path`, `X-Forwarded-*`).

* **Believed only from the Ingress proxy.** `ingress.is_ingress(request)`: `cfg.ingress` AND the **socket
  peer** is in `cfg.ingress_peers` (App: `172.30.32.2`, the Supervisor on the hassio network). Never a
  forwarded-for header. From any other peer the headers are ignored and logged (once per peer per 5
  minutes), and with `--ingress-only` (the App) the request is refused outright, `/healthz` and
  `/api/version` excepted. Other Apps on the hassio network have their own addresses; HA Core (host
  network) appears as `172.30.32.1`: neither is believed. With `cfg.ingress` off (Docker, LXC) the
  headers are never read at all (and Caddy deletes them anyway).
* **Linked users only** (PLAN §5). The HA user id (exactly one header, `[A-Za-z0-9_-]{1,128}`) maps through
  P3.1's `ha_links` to the Mantel user and role; a disabled user is no one. An unlinked HA user gets a page
  ("Not linked yet: ask a Mantel Owner") and every API call answers `401 not_linked`.
* **Sessions.** The first *page load* (a GET with `Sec-Fetch-Dest: document|iframe`, or `Accept: text/html`)
  starts a Mantel session for the linked user: method `ingress`, stored as door `tunnel` (the stricter
  stored value: `sessions.door` keeps its lan/tunnel CHECK, because rebuilding `sessions` would
  cascade-delete its tokens), resolved as door `ha`. Its cookies are `HttpOnly; SameSite=Strict`,
  `Path=/api/hassio_ingress/<token>/` (never sent to the rest of HA's site), and `Secure` when HA says the
  browser came over https (`X-Forwarded-Proto`). Requests carry the cookie *and* the headers: a cookie is
  used only if its session is an `ingress` session of the same HA user the headers name; a cookie of
  another user is ignored (a different HA user in the same browser gets their own session); an Ingress
  session's cookie presented anywhere but through Ingress is no one. A non-page request with no cookie
  yet is the user without a session (reads only: no CSRF token, no step-up). CSRF on state-changing
  `/api/` calls is unchanged.
* **Not a fresh factor.** HA's sign-in may be days old; the session starts with `fresh_factor_at = NULL`.
  Since decision 25 (2026-10-18, docs/PLAN.md) house commands no longer ask for any step-up, so this only
  matters for account administration ("confirm it is you"); the alarm still needs the house Alarm PIN.
* **Sign-in routes are refused through Ingress** (`/login`, `/auth/callback`, `/api/auth/password`,
  `/api/auth/totp/verify`, `/api/auth/passkey/*`, `/api/bootstrap`): HA already signed the person in.
  The "confirm it is you" TOTP check works; passkeys do not (their RP ID is Mantel's own hostname, not HA's).
* **Client IP** for the audit: the second-to-last `X-Forwarded-For` hop (HA Core appends its peer, the
  Supervisor then appends HA Core's address).

### First Owner (bootstrap)

While **no enabled Owner exists** (an HK-account Owner counts), an HA user arriving through Ingress whom
**HA itself** lists as an administrator (`config/auth/list` over Mantel's App credential: group
`system-admin`, active, not system-generated) sees *Set up Mantel* with a **Make me Mantel's Owner** button.
Nothing happens until it is pressed (the explicit confirm). The POST must carry an `Origin` (checked by
`loopback_only`) and a nonce signed with the process's secret, bound to that HA user, valid 10 minutes;
the server re-checks "administrator" and "no Owner" and then, in one transaction with no await inside,
re-checks "no Owner" and creates the HA-linked Owner (`kind ha_linked`, the display name). An audit row
(`config`, `ingress.bootstrap_owner`) and a warning log line record it. Afterwards the page answers 410.
A non-administrator sees "an administrator must open Mantel first"; if HA cannot be asked, the page says
so (503) and nothing is created (fail closed). The panel is open to every HA user (`panel_admin: false`
since the wall-tablet slice, below): that never makes anyone an Owner, because the check is HA's own
administrator list, not who can open the panel.

### People (linking the household)

`<prefix>/ingress/people` (Owner or Admin): HA's people (from `config/auth/list`, system users and
deactivated accounts left out) with their Mantel role; *Link* with a role (owner/admin/adult/child/guest)
or *Unlink*; a by-id form if HA's list cannot be read. Plain forms with the session's CSRF token and an
Origin check; Admins never link, re-role or unlink Owners; the last Owner cannot be removed; each change is
audited (`ingress.link` / `ingress.unlink`). Unlinking ends that user's sessions at once (Store.unlink).
For the Owner it also offers **Import HK's settings from Home Assistant (once)**, the same one-time import
as `POST /api/settings/import` (P3.5), so a fresh App draws the house's dashboards. For each HA user the
Owner also has **Link as a wall tablet** (a new or existing device, its room): see "Wall tablets through the
App" below.

## The door decision: `ha`

Requests through the sidebar come by a third door, **`ha`**. **Decision (Avery, 2026-10-18): the sidebar is
fully trusted**, as HK in Home Assistant and the Companion app always were:

* **`ha_door_rules: trusted` (the App's default since 0.1.4).** The `ha` door gets the LAN's RBAC rules, and
  the HA sign-in counts as a person's sign-in (`authz.ha_trusted`), so nothing asks for a Mantel code: live
  cameras, locks and the garage work in the sidebar and the Companion app, at home or away (the alarm still
  needs the house Alarm PIN to disarm, as everywhere; decision 25). Each
  person's Mantel role still decides what they may do (a Child still cannot unlock a door or see cameras),
  every command is audited, and no "remote access" Owner notice is sent for the sidebar. Its security rests on
  HA's login (turn on HA's two-step verification for everyone).
* **Other choices:** `lan` (the LAN's rules, so locks and the alarm ask for a code; live cameras do not) and
  `tunnel` (Mantel's remote rules: each role's `tunnel_*` switches, a recent code for live cameras and
  sensitive actions; the default up to 0.1.3).
* Only the `ha` door: Mantel's own remote door (`tunnel`, a future Cloudflare hostname) keeps the remote rules.
* **Device credentials are never accepted on `ha`**, wall-tablet enrolment answers `403 lan_only`, linked
  mode and Service accounts (LAN door only) are refused.
* A sensitive action on `ha` **notifies the Owners** like a remote one (gateway `REMOTE_DOORS`), worded
  "through Home Assistant's sidebar".
* The audit records door `ha` (migration 0008); a session row shows door `tunnel`, method `ingress`.
* **Wall tablets come through `ha` too** (decision 21, below): an HA user an Owner linked to a device is that
  device, and with `trusted` or `lan` it gets the LAN door's tablet rules. A device *credential* is still
  never accepted on `ha`; the identity comes from the HA user Ingress vouches for.

## Wall tablets through the App (decision 21, 2026-10-18)

**Decision (Avery, 2026-10-18, PLAN decision 21 and §8 "HA App first"):** the HA App is this house's
deployment, so the wall tablets open Mantel through the App's panel (Ingress) on Home Assistant's own
address, keeping their HA users. This replaces the earlier rule "wall tablets never come through Ingress".

**What a tablet is today.** Each wall tablet (Kitchen, Loft, Living Room, Master Bath, Master Bedroom) runs
**Kiosk Satellite**, a kiosk browser with its own ESPHome link to HA for screen, brightness and the voice
satellite (unaffected by any of this). Its start URL is a page of HA's website (e.g.
`http://192.0.2.53:8123/dashboard-kitchen`), signed in as the tablet's own HA user by `trusted_networks`.
Nothing else is installed on the tablets.

### The tablet's HA user is a device

| Piece | What |
|---|---|
| `migrations/0012_ha_tablet_links.sql` | `ha_tablet_links(ha_user_id PK, device_id UNIQUE → devices, ha_name, own_device, created, created_by)`. |
| `ingress.py` | `tablet_link`, `link_tablet` / `unlink_tablet` (audited `ingress.link_tablet` / `ingress.unlink_tablet`), `_tablet_identity`, `tablets_allowed`, `tablet_start`, the People page's *Link as a wall tablet* form, `GET/POST /api/ingress/tablets`, `DELETE /api/ingress/tablets/{ha_user_id}`, the kiosk mark, HA Core's path to `/linked/ws`. |
| `sessions.py` | `Device.ha_user_id`, `Device.ha_name`; `/api/me` of such a tablet reads as its HA user. |
| `authz.py` | `ha_tablet(ident)` (the LAN tablet in every respect), `home_door(ident)`; `refresh` keeps the HA link and drops a socket whose link was removed; `resolve_door` treats HA Core's linked-mode request as `lan`. |
| `gateway.py` | No "remote access" Owner notice for such a tablet (`_not_remote`). |
| `features.py` | `may_speak_for`: the device is its tablet when HA's name for its HA user is that tablet's Tablet User (or, as before, by room); feed frames naming the tablet's HA user reach it. |
| `linked_owners.py`, `service_accounts.py` | An Owner on a home-rules sidebar may move tablet ownership and manage Service credentials (the App has no LAN door). |
| `config.py`, `entrypoint.py` | `--ha-core-peer` (`ha_core_peers`); the App passes `172.30.32.1`. |
| `web/shim/base.js` | The kiosk request to HA's frontend. |
| `packaging/ha-app/config.yaml`, `tools/package_check.py` | `panel_admin: false` (required by the check). |
| `tests/test_ingress_tablets.py` | 19 tests (linking, identity, unlinked refusal, person sessions unaffected, unlink/revoke, no Owner/Admin page for a tablet, the PIN at the tablet, `panel_admin` pinned); `tools/testha/app_mode_check.py` gained a tablet section. |

* **Linking (Owners only).** People page → *Link as a wall tablet*: pick *a new device* or an existing
  live wall-tablet device (one LAN-enrolled earlier, say) and the room (one of HA's areas), or REST
  `POST /api/ingress/tablets {"ha_user_id", "device_id"? , "name"?, "room"?}` from an Owner's own session on
  the LAN or a home-rules sidebar (CSRF as usual). A person link of that HA user is removed in the same
  transaction (its sessions end); the last Owner cannot become a tablet; a device is one HA user's at most.
  *Unlink* removes the link and revokes the device if it was made for the link. Both are audited.
* **Identity.** A request through Ingress whose `X-Remote-User-Id` is a linked tablet is
  `Identity(user=None, device=Device(…, ha_user_id, ha_name), door="ha", csrf=<the device's CSRF>)`. No
  Mantel session and no device secret exist for it: the HA user Ingress names on every request is the
  credential (the trust root is HA's own sign-in of the tablet, i.e. its `trusted_networks` entry). Its page
  load sets the readable CSRF cookie at the prefix for the page's own calls. Its `last_seen`/`source_ip` (the
  tablet's address as HA saw it) are kept on the device row.
* **Rules.** With `ha_door_rules: trusted` (the App's default) or `lan`, the device gets the LAN door's
  tablet rules: its room's entities, every camera (the doorbell pop-up), and sensitive
  commands decided by the tablet's own grants, exactly as on the LAN. Since decision 25 (2026-10-18) no
  person's PIN is typed at the tablet; PINS-AUDIT.md keeps the old design as history.
  The audit says door `ha`; no "remote access" notice is sent for a tablet.
* **`ha_door_rules: tunnel` refuses linked tablets** (decision made here): RBAC never gives a device the
  tunnel's rules (PLAN §7: tablets are LAN-only), so rather than a page that loads and can do nothing, the
  tablet gets "Wall tablets are off for the sidebar" (and `401 tablet_refused` on the API); the People page
  says so to the Owner. A person's HA user is unaffected by any of this.
* **Which tablet it is.** `/` and `/home` for such a tablet go to its own HK screen:
  `<prefix>/<screen>/home?hk_tablet=<tablet id>`, where the tablet is the one in Mantel's HK settings whose
  *Tablet User* is HA's name for this HA user (else the one in the device's room; else Mantel's default
  screen). HK remembers `hk_tablet` (`hk-settings.js tablet()`), and `/api/me` gives HK the HA user's id and
  name as HA's frontend did, so HK's screensaver, black screen and its `screen_report` frames name the same
  tablet as in HA, and features.py accepts them from this device (`may_speak_for`); feed frames naming the
  tablet's HA user (`users`) reach it.
* **HA's sidebar and header.** The page of a linked tablet carries `<meta name="mantel-kiosk">`; Mantel's
  `base.js` then posts HA's own iframe message `{"type": "home-assistant/subscribe-properties",
  "kioskMode": true}` to the App panel around it (`ha-panel-app`), which turns on HA's kiosk mode: the
  sidebar drawer is closed and the panel's 40 px header is not drawn. Read from the frontend HA 2026.9 ships
  (`home-assistant-frontend 20260826.7`, `ha-panel-app`: `_handleIframeMessage` → `hass-kiosk-mode`); the
  house runs 2026.10.2. An older HA ignores the message (the page still works, with HA's chrome). People are
  never marked, so the sidebar stays for them. No kiosk-mode plugin, no `?kiosk`, no Kiosk Satellite setting.

**Verified (2026-10-18).** `tests/test_ingress_tablets.py` (19) and the whole Mantel suite; against the scratch
HA, `tools/testha/app_mode_check.py` through the App's own startup path (`ha_door_rules: trusted`): the Owner
linked a fictional tablet HA user to a new device in *Living Room* over REST; that HA user's session was `user
None, device wall_tablet (living_room), door ha`; its page carried the kiosk mark; its socket saw 7 entities
(its room's and the cameras); its command was refused (`commands_disabled`, commands off); after the unlink it
got 401. Not yet seen: a real tablet through HA's Ingress and HA's kiosk mode around the frame.

### The kiosk start URL (what to put in Kiosk Satellite)

```
http://192.0.2.53:8123/app/local_mantel
```

* **`/app/<App slug>`** is HA's own route for an App's Ingress panel (`hassio` registers the built-in panel
  `app`; `ha-panel-app` takes the slug from the path). It is stable: it survives HA and App restarts and
  updates, does not depend on *Show in sidebar*, and is the same for every tablet (Mantel picks each one's
  screen). A local App's slug is `local_` + `mantel`; if the App is later installed from an App repository its
  slug becomes `<repository id>_mantel` (read it from the address bar on the App's page in Settings → Apps).
  `/local_mantel` (the sidebar entry's own path) also works, but only while *Show in sidebar* is on.
* **Same scheme and host as today's start URL** (the tablet's current `http://192.0.2.53:8123/...`), so
  `trusted_networks` signs it in exactly as it does now.
* **Not** `/api/hassio_ingress/<token>/…`: that address needs HA's `ingress_session` cookie, which only HA's
  frontend creates (`supervisor/api` → `/ingress/session` over its WebSocket), keeps alive (every 60 s,
  `/ingress/validate_session`) and re-creates when the Supervisor has dropped it; opened directly it answers
  401. The token is also per installation.
* **First load, nothing stored:** HA's frontend has no tokens yet → HA's login → `trusted_networks`
  (`allow_bypass_login`, the tablet's IP → its one HA user) signs it in with no prompt → back to
  `/app/local_mantel` → the frontend makes an ingress session (allowed for non-admin users: HA's
  `WS_NO_ADMIN_ENDPOINTS` lets them create and validate ingress sessions and read the App's info, which is why
  `panel_admin` must be `false`) → the frame loads Mantel → Mantel sees the tablet's HA user → its device →
  its screen → HA's chrome hidden. If `trusted_networks` maps the tablet's IP to more than one user, HA shows a
  user picker instead (as it would for the dashboard URL today).
* **HA restart:** the frontend reconnects by itself; Mantel's frame stays and its socket reconnects. **App
  restart/update:** the frame's requests get 502 for a moment; Mantel's page retries its socket; if HA's panel
  shows its "App not ready" dialog, a reload (Kiosk Satellite's, or HK's nightly tablet restart) clears it.
  **Ingress session expiry:** HA's panel re-validates every 60 s and makes a new session when validation
  fails, so a long-running tablet keeps working; a WebView that was suspended longer than the session's life
  may see 401s for up to a minute after it wakes, until the keep-alive has replaced it (the page's socket
  retries meanwhile). These three are read from HA's code and Mantel's tests; **check each on the Loft tablet
  at Step 3** (CUTOVER.md).

### Linked mode in the App

Per-tablet ownership needs HA's `hk_frontend` ("Linked to Mantel Server") to reach Mantel's `/linked/ws`.
In the App there is no published port and `ingress_only` refuses everything but the Supervisor, so the App
now also names **HA Core's own address on the hassio network, `172.30.32.1`** (`--ha-core-peer`): from it,
exactly one path is let through, `/linked/ws`, and treated as the LAN door; the endpoint still needs its
Service credential (scope `linked`) and refuses any request with an `Origin`. Every other path from that
address is still refused. HA's option: address `http://local-mantel:8099` (the App's hostname on the hassio
network, as HA Core reaches `core-mosquitto`; **verify on the house**), the Service credential created by the
Owner in `/admin` → Service accounts or `POST /api/service-accounts` inside the sidebar (allowed on a
home-rules sidebar now). Ownership (`PUT /api/linked/owners`) likewise works from the Owner's sidebar.
Caveat: any App with `host_network` also appears as `172.30.32.1`; it would still need the Service credential.

**Decided and built (Avery, 2026-10-18; PLAN decision 24): option (a), tightened.** HK Frontend's Configure
(`linked_mode.check_url`) and the link itself (`mantel_link.py`) accept plain `http://`/`ws://` only for:
loopback (127.0.0.1, `localhost`, `::1`); an IP literal inside the hassio network, `172.30.32.0/23`; or an App
hostname of the Supervisor's shape, `local-<slug>` or `<8 hex>-<slug>` (lowercase letters, digits, hyphen or
underscore). A hostname is accepted **only if every address it resolves to** is loopback or inside
`172.30.32.0/23`; a name is never accepted on its shape alone, and a plain name of any other shape stays
`mantel_url_insecure`. `https://`/`wss://` is allowed anywhere, as before. A shaped name that does not resolve,
or resolves outside the range (also one address of several), gives the new `mantel_url_not_internal`.
Resolution is asynchronous (the loop's `getaddrinfo`), never blocking HA.

The check runs **on save** (Configure form) and **again immediately before every connect and reconnect**: the
link resolves and checks, then connects to the checked address with the original `Host` header (so a name that
changes between check and connect cannot redirect it; no resolve/connect race remains). If the name no longer
resolves inside the range, the link refuses to connect, logs a warning (the address, never the credential),
shows `mantel_url_not_internal` as the link's last error, and retries at the normal backoff (1 s doubling to
30 s). The credential is never logged or shown.

**How to configure:** HK Frontend → Configure → Linked to Mantel Server: address `http://local-mantel:8099` and
the Service credential. (The hostname is still to be confirmed on the house; if Supervisor names the App
differently, use the `<8 hex>-mantel` form it shows in the App's page.) The build's private-address scan
(`tools/publish/publish.py`) allows this one range, `172.30.32.0/23`, because the code names it.

## The prefix

The page lives under `/api/hassio_ingress/<token>/`; the Supervisor strips that before Mantel sees the path.
HK's code (shared with the HA build, which must not change) uses absolute `/hk/...` paths and reads
`location.pathname` in ~80 places. One value, the prefix, known only to the server (validated
`X-Ingress-Path` from the Ingress peer), drives everything:

1. **Server, at serve time (Ingress requests only):** JS/CSS/HTML from `/hk/` and `/web/` and the page
   itself are rewritten by `ingress.rewrite`: absolute `'/hk/`, `"/web/`, `` `/static/mdi/ ``, `url(/hk/`
   → under the prefix; every read of `location.pathname` → `location.pathname.slice(<len>)` (HK sees the
   addresses it always saw; never applied to an assignment). The page gets `<meta name="mantel-base">`.
   Results are cached (48 MB LRU) with an ETag; outside Ingress files are served exactly as before.
   `/api/...` literals are deliberately *not* rewritten: in HK's code and mantel-client they are Home
   Assistant API paths for the action port, not URLs fetched from Mantel.
2. **Mantel's own page code, from the meta (`web/shim/base.js`, imported first):** its REST calls
   (`mantelUrl('/api/...')`), the WebSocket (`wsUrl('/ws')`), `hassUrl()`; `history.pushState/replaceState`,
   `window.open` and clicked links to an absolute address are moved under the prefix (HK navigates to
   `/<dashboard>/<view>`), so a reload opens Mantel again, not HA's own page.
3. **Redirects** (`Location: /...`) are moved under the prefix; `/` through Ingress goes to `<prefix>/home`.

Why not a helper inside HK's code: those files ship in the HA build unchanged; the rewrite gives the same
result without touching them, and `tests/test_ingress_paths.py` proves no reference escapes: it rewrites
every served file with a fictional prefix and fails on any un-prefixed asset root, any unstripped
`location.pathname`, and any other absolute URL-root literal that is not Mantel's own (through base.js) or
on a short list of non-URLs with reasons (HA API paths for the action port, example text, a WS type, a
link base.js handles). Known leftovers, accepted: HK Settings' photo URLs (`/api/image/serve/...`, HA's
image store) and the dev-only Skylab page's `location.href` jumps; `/dev` (diagnostics) is not prefix-aware.

**Mantel's own pages (`/admin`, `/proxy-check`), fixed for 0.1.6.** Found on the house in 0.1.5: `<prefix>/admin`
answered 200 but stayed on "Loading", because the page named `/admin/admin.css` and `/admin/admin.js` as absolute
paths (HA answered those from its own root, as text/plain), and `admin.js` called `fetch('/api/...')` and sent a
401 to `/login?next=/admin`; nothing in the dashboard's menu led there either. Now: `admin_page.py` serves the
page through `ingress.own_page()` (the `mantel-base` and referrer metas, `href`/`src` of `/admin/`,
`/proxy-check/` and `/home` moved under the prefix; outside Ingress the bytes are unchanged), and `admin.js` reads
`<meta name="mantel-base">` and builds every `fetch`, the `import()` of `/proxy-check/check.js`, links and the
upload `fetch` through `url()`. A signed-out answer under the prefix shows "Home Assistant has signed you out.
Reload..." instead of going to `/login`, and the Sign out panel is not drawn (HA holds the sign-in). The admin
page's CSP says `frame-ancestors 'self'` through Ingress (HA's page frames it; `'none'` everywhere else).
`/proxy-check` already used the prefix; it now also carries the referrer meta (HA's `no-referrer` otherwise breaks
its POST). A way in: the dashboard's menu has a **Mantel** section with **Mantel settings** for Owners and Admins
only (shell method `hkShell.hostMenu`, `web/shim/mantel-shell.js`; opens `<prefix>/admin` in the same frame by a
full page load), and the admin page has a **Back to the dashboard** link. HA's `/app/local_mantel/admin` still
does not pass a subpath to the iframe (the frame always opens the Ingress root), so the menu entry is the way in.
**HK Settings in Mantel (`<prefix>/hk-settings`).** Owners and Admins (never a wall tablet; a signed-out browser goes to
`/login`) get `web/hk-settings.html` + `web/shim/hk-settings-page.js`: `<hk-settings-panel>` full-window on the Mantel host adapter's `hass`
(the same one the dashboard builds), under a slim bar with **Back to the dashboard** and a notice: this is Mantel's copy, imported from
HA once, so changes affect Mantel's screens only; whatever needs HA writes (tablets as HA devices, dashboards, setup flows) is
read-only while Mantel is. Entries: **HK Settings** above **Mantel settings** in `hkShell.hostMenu` (side menu and the tab bar's
More sheet) and a link on `/admin` (managers only). A refused save says why (`settings_store.REFUSALS` for `ha_write` /
`not_yet`; the action port's refusals toast "Commands are disabled in Mantel (read-only)"). The energy sheet's "More energy
settings" link is host-relative and now lands here. Folding Mantel settings into HK Settings stays PLAN item 8.
Tests: `tests/test_ingress_own_pages.py`. **Since decision 27 (2026-10-19) both are one page, Mantel Settings at
`<prefix>/settings`**; `/hk-settings` and `/admin` send browsers there (docs/phase8/SETTINGS.md).

## The App

* **`config.yaml`**: name Mantel, slug `mantel`, version 0.1.0, `arch: [amd64, aarch64]`,
  `startup: application`, `boot: manual`, `init: true`, `ingress: true`, `ingress_port: 8099`,
  `panel_icon: mdi:fireplace`, `panel_title: Mantel`, `panel_admin: false` (was `true` up to 0.1.4),
  `homeassistant_api: true`,
  `watchdog: http://[HOST]:[PORT:8099]/healthz`; options `commands_enabled: false`, `log_level: info`,
  `default_screen: dashboard-kitchen`, `ha_door_rules: tunnel`. No `image:` (the Supervisor builds the
  local folder), no `hassio_api`/`auth_api`/host network/devices. Since decision 26 one opt-in port,
  `8100/tcp: null`, and the direct-access options (`access: ingress` by default; "Direct access" below).
* **`Dockerfile`**: `python:3.12-slim-bookworm` (a plain Python base, as the Mantel Connect proof App that
  ran on this house), the pinned `requirements.txt`, uid 10001, `COPY app /app`, `CMD python /app/entrypoint.py`.
  (packaging/docker/Dockerfile's `app` target remains the path for a published image later.)
* **Start**: `entrypoint.py` sees `SUPERVISOR_TOKEN` + `/data/options.json`, writes the token to
  `/tmp/ha_token` (0600) and removes it from the environment, builds `--ha-url http://supervisor/core
  --ha-ws-url ws://supervisor/core/websocket --data-dir /data --secrets-dir /data/secrets --port 8099
  --listen 0.0.0.0 --allow-host * --ingress --ingress-only ...`, chowns `/data` to 10001, drops root, execs
  the server. HaClient, ReadProxy, the camera signaling and (when on) the commander all use the Supervisor's
  WebSocket; REST goes to `http://supervisor/core/api/...`. Commands only when the option is exactly `true`.
* **Connections page** (2026-10-18, `connections.py`): the entrypoint also passes `--ha-managed-by-app`, so
  `/admin` → Connections shows Home Assistant as **"Provided by Home Assistant (App)"** with no form (the App
  uses the Supervisor's credential; no HA token is ever asked for, and the server refuses changes with
  `409 provided_by_app`). **Music Assistant is editable** there: the App can reach MA directly with an address and
  an MA token or MA user sign-in, sealed in `/data/connections` (inside the App's own HA backups too).
* **Music Assistant address suggestion** (App 0.1.7, `MaSuggester` in `connections.py`): HA's WebSocket does not
  expose a config entry's `data` (`config_entries/get` omits it), and Mantel has no Supervisor API, so nothing is
  read from HA and `ha_client`'s allowlist is unchanged. Instead, in App mode only, when MA is not set up and an
  Owner/Admin loads `GET /api/connections`, Mantel probes the official Music Assistant App's hostnames
  `d5369777-music-assistant`, `-beta`, `-nightly` (port 8095; Supervisor DNS resolves App hostnames): resolve the
  name, then an unauthenticated GET of MA's `/info` (2 s each, no credentials, no redirects); the first answer with
  `server_id` and `server_version` becomes `ma.suggested_url` (+ `suggested_from: "music_assistant_app"`), cached
  5 minutes. A name, never an IP. The page only prefills the editable address box with a hint; it never tests or
  saves by itself. Outside App mode, for non-managers and once MA is set up, nothing is probed. Tests:
  `tests/test_connections.py` (fake resolver and `/info`).

## Direct access (decision 26, 2026-10-18)

**Decision 26 (Avery, revised the same evening):** the HA App stays the primary deployment (HA's automatic
connection, Music Assistant by App hostname, HA's backups, easy updates), with **optional direct access**:
Mantel at its own address for tablets and devices at home, for homes that want it. The Proxmox LXC stays the
advanced path (independence from HA's machine, GPU Live TV). Living only inside HA's Ingress frame had cost
direct screen links, HA's service worker in the way, no way to be a default dashboard and `hassio_ingress`
addresses; direct access removes those for whoever turns it on, and changes nothing for anyone else.

**Three modes, the App option `access`; Ingress is always on:**

| `access` | Port 8100 | TLS | Who decides the door there |
|---|---|---|---|
| `ingress` (default) | not listened on | HA's | (only the sidebar) |
| `proxy` | plain HTTP | the home's proxy (NPM, Traefik) | the proxy's `X-Mantel-Door`, from `trusted_proxies` only, with the door key |
| `https` | HTTPS | Mantel's own Let's Encrypt certificate | the peer: a private address is `lan`, anything else `tunnel` |

`config.yaml` declares one port, `8100/tcp: null` (unpublished until the Owner maps it in the App's Network
section; `tools/package_check.py` allows exactly that), with `ports_description`. Options: `public_url`
(required for either mode: `https://<name>[:port]/`, a name, not an IP; it becomes Mantel's public URL, OAuth
client id and passkey RP id), `trusted_proxies` (`proxy`), `cloudflare_token` (masked; `https`), `acme_email`,
`acme_staging`, `ha_sign_in_url`. The entrypoint (`packaging/docker/entrypoint.py` `direct_args`) checks them
and stops the App with a reason when one is wrong; the Cloudflare token goes to `/tmp/cloudflare_token` (0600,
chowned to the server user), never an argument, the environment or a log.

**How the server tells the two ports apart** (`mantel_server/direct.py`). One aiohttp application, two
listeners (`direct.serve`): 8099 (Ingress) and 8100. A request is *direct* when its socket's local port is
`cfg.direct_port`; the peer address plays no part, because Docker's port mapping may show any client (NPM, a
tablet) as the hassio bridge's gateway `172.30.32.1`, which is also HA Core's address. Then:

* `ingress.is_ingress` is false on the direct port, whatever the peer (so `X-Remote-User-*`/`X-Ingress-Path`
  are removed there by `proxy_trust` and logged); the Ingress-only gate lets the direct port through and
  nothing else; HA Core's linked-mode exception (`/linked/ws` from `172.30.32.1`) applies on 8099 only.
* `proxy_trust.is_trusted` counts `trusted_proxies` on the direct port only (forwarding headers, the door
  header, the door key; `authz.resolve_door` and `sessions.client_ip` ask it). On 8099 nobody is "the proxy".
* The Host check (`server.loopback_only`): any Host on 8099 (HA's proxy forwards whatever it got, and linked
  mode uses `local-mantel:8099`), only `public_url`'s name on 8100 (`cfg.direct_hosts`): DNS rebinding.
* `proxy` mode sets `--proxy-kind own`, so the door key is required (door_key.py); an untrusted peer on the
  direct port is the tunnel door even from loopback. After the security review the listed proxy counts **only
  with the key** on this port, for every header (`proxy_trust.is_trusted` vs `listed`): its address alone may be
  `172.30.32.1`, i.e. anyone Docker relays. The entrypoint and `/proxy-check` warn about a hassio/Docker-bridge
  address in `trusted_proxies`. A keyed `lan` for a global client address is downgraded to `tunnel` (defence in
  depth; DOCS.md requires an NPM Access List, since the name is public in CT logs). The key travels NPM → HA's
  port in plain HTTP: a LAN hop. NPM as an HA App has a hassio address that can change on restart.
* "Sign in with Home Assistant" (every mode, auth.py): the state is single use, kept server-side (512 at most,
  10 minutes), the callback is limited to 20 per client address per 5 minutes (429), and the state cookie is
  `Secure` on https.
* "Sign in with Home Assistant" needs HA's address as browsers know it (`ha_sign_in_url` →
  `--ha-browser-url`); the code exchange, `auth/current_user` and the revoke go to `http://homeassistant:8123`
  on HA's internal network (`--ha-oauth-url`), since the Supervisor's `http://supervisor/core` proxies HA's
  API, not its `/auth`. Without the option the button's page names it (409).
* Enrolled wall tablets (devices.py, LAN door only) work as in the containers; `/home` now sends any enrolled
  device to its HK tablet's screen (`ingress.tablet_start`: HK's tablet in the device's room), in every mode.
* Connections → "HTTPS and your proxy" names the mode of the port the page was opened on (`own`, or the new
  `builtin`); through the sidebar it stays "Home Assistant App (Ingress)", and the door key is rotated there.

**Built-in HTTPS: why Mantel's own ACME client, not Caddy in the App** (`mantel_server/direct_tls.py`). The
compose stack's Caddy (xcaddy + the Cloudflare DNS module) is proven, but in the App it would mean either
compiling Caddy on the house's HA machine at every App build (the Supervisor builds local Apps there: a Go
toolchain, minutes of CPU and about a gigabyte of memory, on a box that may be a Raspberry Pi) or downloading
an unpinnable binary from Caddy's build service; and two long-running processes in a container whose
entrypoint execs one server under `init: true`, with nothing to restart Caddy if it dies (the watchdog only
asks Mantel). Certbot's `acme` library would add half a dozen pinned packages (josepy, requests, ...). DNS-01
itself is a handful of HTTPS requests, and everything it needs (aiohttp, cryptography) is already in the image,
pinned and tested. So Mantel does it: RFC 8555 with an ES256 account key, newOrder → the `dns-01` challenge →
a TXT record through Cloudflare's API (the zone found by name, so the token has Zone / Zone / Read and Zone / DNS / Edit on that zone) → wait until Cloudflare's DoH
resolver shows it → respond → finalize with a fresh P-256 key's CSR → download the chain; the TXT record is
removed afterwards, success or not. HTTP-01 is not offered: it needs port 80 reachable from the internet, which
is what DNS-01 avoids (and Caddy in the compose stack uses DNS-01 too).

* Files in `/data/tls` (0700/0600, inside HA's backups): `account.key`, `cert.pem`, `cert.key`.
* Until a certificate exists the port serves a 7-day self-signed placeholder for the name (so it answers and
  the log says why); the new certificate is loaded into the same `SSLContext`, so new connections use it with
  no restart. Renewal 30 days before expiry, checked every 12 hours; failures retry after 1, 3, 12, then 24
  hours (Let's Encrypt's failed-validation limit), and `acme_staging` uses the staging directory.
* Log lines carry Let's Encrypt's or Cloudflare's error code and message, never the token, a key or a header.
* The door: no proxy stamps one, so the socket peer decides (`direct.https_door`): an address in
  `lan_networks` (default RFC 1918, ULA, the container's loopback) → `lan`, anything else → `tunnel`; HA's
  hassio network `172.30.32.0/23`, `fd0c:ac1e:2100::/48` and Docker's `172.17.0.0/16` are never `lan`, whatever
  the list says (through Docker's userland proxy, a hairpin or a host relay every visitor arrives as
  `172.30.32.1`). A client's `X-Mantel-Door: tunnel` still tightens. Tablets need a direct LAN path. **Never
  forward the port from the internet.** Remote use stays HA's sidebar/Companion app (or the LXC's tunnel door).
* While the placeholder is served (`CertManager.pending`), every request on the port but `/healthz` gets a
  503 "certificate pending" page (ingress.middleware's direct branch): no sign-in over an unverifiable
  certificate.
* Hardening after the orchestrator's security review (2026-10-18): a new chain is checked (the leaf is for the
  generated key, its names are exactly the name, not expired, loads into a fresh `SSLContext`) and written as
  one key+chain file (`tls.pem`: temp, fsync, rename, folder fsync), so the pair is never half-replaced; a
  damaged file at start falls back to the placeholder instead of stopping the App; the issued bundle is kept as
  `pending.pem` until installed (no second issuance after a restart); `state.json` keeps the directory (a switch
  between staging and the real service reissues), failures and the next attempt (the backoff survives restarts);
  an unreadable `account.key` is moved aside and replaced; the TXT name is `_acme-challenge.<requested name>` and
  an authorization for another name is refused; every URL must be on the directory's origin, no redirects are
  followed, `Retry-After` is honoured (capped at a minute), `--acme-directory` must be https; the CSR has no
  CN (SAN only); renegotiation is off; a TXT record whose create answer was lost is found by name and removed.
  `/data/tls` is plain files (not sealed with the at-rest key) and inside HA's backups.

**Tests** (`tests/test_direct_access.py`, 52 after the review fixes): the options per mode (defaults, every refusal, the token file
0600 and never in the arguments), the server flags' guards, `config.yaml`'s port and the package check; the real
two-listener server on two loopback ports per mode: the gate (8099 still refuses non-Ingress, 8100 serves
Mantel's sign-in), the Host check, Ingress headers believed on 8099 and not on 8100 from the same peer, the door
key (lan only with it; tunnel without, with a wrong one, or from a peer that is not the proxy), trust only on
8100 (`/healthz` hidden from the proxy there, 200 for the watchdog on 8099), TLS on 8100 with the placeholder
and the peer's door, "Sign in with Home Assistant" to `ha_sign_in_url` with Mantel's public client id, an
enrolled tablet opening its HK screen (and refused without the LAN door); and the ACME client against a
fictional ACME server and Cloudflare (`tests/acme_fakes.py`: every JWS verified, nonces, the TXT value checked
against the account key): issuance, a stale nonce retried, the record removed, files 0600, a restart keeping
account and certificate, renewal at 30 days, a new name, backoff, the token never in the logs, a name outside
the token's zones. The existing byo compose run (`tools/e2e/compose_e2e.py`) covers the same door-key rules
behind a real nginx. Not covered here: the Supervisor's actual port mapping (the scratch HA has no Supervisor)
and Let's Encrypt itself; both are first seen on the house.

## Staging

```bash
~/.venvs/mantel/bin/python tools/stage_ha_app.py --dry-run           # what, how much, and the scan; writes nothing
~/.venvs/mantel/bin/python tools/stage_ha_app.py <local apps share>/mantel            # new folder
~/.venvs/mantel/bin/python tools/stage_ha_app.py <local apps share>/mantel --replace  # update one it staged
```

Dry run today: 2663 files, 66.2 MB (web 65.2 MB: HK's code and sky/landscape art; mantel_server 0.5 MB;
hk_core 0.5 MB), scan clean. The scan refuses: font files of any kind (SF Pro is Apple's; each home adds
its own through "Your files"), `hk-glyphs*`/`hk_local`, fixtures, secrets, `.env`, keys, tokens, databases;
JWT/GitHub/AWS/private-key-shaped text; private-network addresses except four named ones
(`172.30.32.2` the Supervisor, `172.30.32.1` HA Core, `172.31.251.2` compose's Caddy, and config.py's development default
`ha_url` — App mode always overrides it); `HK_PRIVATE` adds a home's own words. Writing goes to a sibling
temp folder that is renamed into place; `--replace` refuses a folder without the tool's
`.mantel-stage.json` marker; the repository itself is refused as a target.

## Verification (done here, without the house)

* `pytest -q`: 1480 passed, 2 failed — both in `tests/test_hk_core_live_tv_guide.py`, a clock-dependent
  test of `hk_core` (its XMLTV fixture is dated 2026-10-18 12:00–14:00 UTC and `parse_xmltv` drops
  programmes that ended over an hour before *now*), unrelated to this slice and outside it (hk_core).
  The 48 new tests pass: identity only from the peer, forged headers refused and logged, `--ingress-only`,
  headers unread when off, cookie scoping/Secure, one session per browser, another user's cookie not
  borrowed, Ingress cookies useless elsewhere, unlinked/disabled, bootstrap (admin + confirm, non-admin,
  HA unreachable, expired nonce, foreign nonce, closed afterwards, HK Owner closes it, not reachable
  outside Ingress), people page (link/unlink/CSRF/last Owner/Admin limits/audit), settings import, door
  rules, sign-in routes and enrolment refused, CSRF, audit door `ha`, WebSocket through Ingress (and
  X-Forwarded-Host only from the peer), redirects, file rewriting and ETag, the rewrite function, client IP,
  migration 0008 on a populated audit, config flags, entrypoint App mode, App config, the static scan,
  staging.
* `tools/build_ha.py` + `tests/run`: all suites green (126 PASS); the HA build is unchanged.
* `tools/headless/client_smoke.py`: passed (0 exceptions, 0 external requests).
* `tools/stage_ha_app.py --dry-run`: clean.
* **Prefix smoke** (`tools/headless/ingress_smoke.py`): Chrome → stand-in Ingress proxy on 127.0.0.1 →
  Mantel from `::1` (macOS has no 127.0.0.2 without a root-made lo0 alias, so `::1` plays the Supervisor):
  page drawn under `/api/hassio_ingress/<token>/dashboard-proof/home` (2 cards, sky), signed in as the
  linked Owner on door `ha`, cookies at the prefix path, a live update over the prefixed WebSocket
  (21.4 → 22.8 °C), HK navigation to Lights kept the prefix and back returned Home, a reload of the moved
  address drew Lights again, commands refused, 164 requests and **0 outside the prefix, 0 reaching "HA",
  0 browser exceptions**; forged headers straight to Mantel from 127.0.0.1 → 403.
* **App mode against the scratch HA** (`tools/testha/app_mode_check.py`, its own `TESTHA_DIR`, brought down
  after): the entrypoint's real path with a simulated `SUPERVISOR_TOKEN` and the core URLs pointed at
  127.0.0.1:8124 → health ok, HA connected over the explicit WebSocket URL; **HA's real
  `config/auth/list` named the scratch user an administrator**, the confirm made them Owner; page signed in
  on door `ha`; 121 entities and 4 areas arrived; two command shapes over the socket refused
  (`commands_disabled`) and `light.kitchen_lights` did not change; the token was in no argument and no log line.

What only the house can show: the Supervisor's proxy behaviour (`ws://supervisor/core/websocket` with
`SUPERVISOR_TOKEN`, and that it lets the App's credential read `config/auth/list`), the real headers
(`X-Ingress-Path`, `X-Forwarded-Host/-Proto`, `Sec-Fetch-Dest` through two proxies), the image building on
the HA host, and the Companion app.

## Install on the house (orchestrator, Avery approved a LOCAL App)

1. Stage: `~/.venvs/mantel/bin/python tools/stage_ha_app.py --dry-run`, then
   `~/.venvs/mantel/bin/python tools/stage_ha_app.py /Volumes/local_apps/mantel`
   (`--replace` for an update; the folder must be one the tool staged).
2. HA → Settings → Apps → App store → ⋮ → **Check for updates** (refresh). **Mantel** appears under
   *Local apps*. Install (the Supervisor builds the image: a few minutes; pip downloads wheels).
3. Configuration tab: leave `commands_enabled: false`; `default_screen` = the house's HK dashboard address
   (e.g. `dashboard-kitchen`); `ha_door_rules: tunnel`. Keep *Protection mode* on. *Start on boot* off
   until verified.
4. Start. Log tab: expect `HA App mode: identity from Ingress, believed only from 172.30.32.2 (Ingress only)`,
   the listen line `read-only; commands disabled`, no traceback, no token.
5. **Open Web UI** (or enable *Show in sidebar* and open **Mantel**) as Avery (an HA admin): *Set up Mantel*
   → **Make me Mantel's Owner** → *You are Mantel's Owner*.
6. *Link the rest of the household* → `People`: link Jordan, Riley, … to their roles; press
   **Import HK's settings from Home Assistant (once)**.
7. *Open Mantel*: the HK dashboard draws.

### Verification checklist on the house

- [ ] App builds and starts with Protection mode on; `/healthz` watchdog green; log shows HA connected
      (no "HA connection lost" loop) and no token.
- [ ] The setup page offers the button (not "could not ask Home Assistant": that would mean the
      Supervisor's credential cannot read `config/auth/list`; then link Avery by id instead, see below).
- [ ] After the confirm: `/api/session` (DevTools in the sidebar frame: `fetch(__mantelBase+'/api/session')`)
      says Avery, `owner`, door `ha`.
- [ ] The dashboard draws in the sidebar; DevTools Network: every request under `/api/hassio_ingress/…`;
      Console: no exceptions; the WebSocket `…/ws` is open and states update live.
- [ ] HK navigation (tab bar / menu) keeps the address under the prefix; a browser reload shows Mantel.
- [ ] A tap on a light says "Commands are disabled in Mantel (read-only)"; nothing changes in HA.
- [ ] Another linked user (non-admin; after setting `panel_admin: false` in a later build, or via an
      admin test account) lands in their own role; an unlinked HA user sees only "Not linked yet".
- [ ] Companion app (phone, over cellular through HA's remote URL): same page, signed in, cookies work
      (if HA is reached over https the cookies are `Secure`).
- [ ] An HA backup includes the App (its `/data`: `mantel.db`, `secrets/`).

If the Owner page says it could not ask HA: stop, note the log line (`could not read Home Assistant's
users (...)`); the fallback is a one-off link from the App's container (`docker exec -u 10001 addon_local_mantel
python /app/entrypoint.py link --ha-user-id <Avery's HA id> --role owner --name Avery`, HA id from HA →
Settings → People → Users, advanced mode) — the entrypoint defaults it to `/data`.

### Installed on the house (2026-10-18 10:33; 0.1.1 at 10:47)

HA Core 2026.10.2. HA backup `b6bccdca` ("Before_Mantel_App_2026-10-18") taken first. Staged from `0d6ea1d`
(build `34ec4e8ed5ddd420`); the same staged folder was built locally with Docker first (imports ok).
Store refresh → **Mantel 0.1.0** under local apps → install (Supervisor build) → start. Options left at
`commands_enabled: false`, `default_screen: dashboard-kitchen`, `ha_door_rules: tunnel`; Protection mode on,
boot manual, watchdog off.

- [x] Builds and starts; migrations 0001–0008 applied; log: `HA App mode: identity from Ingress, believed only
      from 172.30.32.2 (Ingress only); door 'ha' uses the tunnel rules`, `read-only; commands disabled`,
      `authenticated to Home Assistant 2026.10.2`, registries and 4499 states loaded; no traceback, no token.
- [x] `/healthz` (watchdog path) 200, HA connected.
- [x] A direct request from another App (not the Ingress proxy) with spoofed `X-Remote-User-*` headers:
      **403** "reached through Home Assistant's sidebar only".
- [x] **Found on the house, fixed in 0.1.1 (`e9e63ca`):** *Make me Mantel's Owner* answered "bad Origin". HA's
      HTTP layer stamps `Referrer-Policy: no-referrer` on every response it proxies (Ingress included), and under
      that policy a browser sends `Origin: null` on a same-origin form POST. Every page served through Ingress
      now carries `<meta name="referrer" content="same-origin">`, which overrides the header for the document.
      Updated in place (restage `--replace`, store refresh, *update*); the database was kept.
- [x] The setup page offered the button (the App credential can read `config/auth/list`); after the confirm:
      "You are Mantel's Owner"; log `HA administrator Avery Lane (...) is now Mantel's first Owner`.
- [x] `/api/session` in the sidebar frame: Avery Lane, `owner`, door `ha`.
- [x] The dashboard (`dashboard-kitchen/home`) draws live in the sidebar (Chrome as Avery, and Avery's Safari via
      `hasslocal`); all ~88 requests are under `/api/hassio_ingress/…`, except camera stills, which go to HA's own
      `/api/camera_proxy/…?token=` with HA's entity-picture tokens (works because the frame is on HA's origin; the
      camera connector routing is the known page-side gap). Closed in the repo since (not yet on the house):
      states reach the page with Mantel's own `<prefix>/api/camera/<entity>/still` and no HA token
      ([CONNECTORS.md](CONNECTORS.md) "What the page needs").
- [x] Expected 404s only: `hk/fonts/SF-Pro.*` and `hk/iconset/hk-glyphs.js`, the Apple-licensed files that are
      never staged (the App draws with fallback fonts and glyphs until an Owner supplies them: /admin, Your files,
      "HK fonts and glyphs", or `mantel files import-assets <folder>` in the App's container; kept in `/data`, in
      the App's backups; see [BACKUP-FILES.md](BACKUP-FILES.md)). Still 404 until then, by design.
- [x] `hk_music/subscribe` is refused by the read allowlist (the music feed moves with the Phase 4 music engine);
      the page backs off; the warning is now logged once per 5 minutes (next App update).
- [x] People page lists all HA users (incl. the per-tablet HA users and `claude`/`Mantel` admin users). Linked at
      Avery's direction: Jordan → `adult`, Riley → `child` (they can open the panel once `panel_admin: false`).
- [x] **Import HK's settings from Home Assistant (once)**: "imported from ha:01M35SP186GRY0MYPNJ6PDCG1Q".
- [ ] Not tapped on purpose: a light (the house rule is no service calls at all; refusal with commands off
      is covered by `tools/e2e/gateway_e2e.py` against the scratch HA).
- [ ] Companion app over cellular; non-admin user (needs `panel_admin: false`); the App in HA's next backup.
- Avery's Safari via `hasslocal` got `401` on its first loads (10:34–10:42) before the Owner existed and works
  since; not reproduced, noted.

### 0.1.2 on the house (2026-10-18 11:19, commit `53e037b`)

Updated in place (restage `--replace`, store refresh, update; `/data` kept: Avery still Owner, links and
imported settings intact). Checked in the sidebar as Avery:
- [x] Camera stills now come from Mantel (`<prefix>/api/camera/<entity>/still?v=…`, 200, real JPEGs); no
      request carries an HA `token=`; no request leaves the Ingress prefix.
- [x] Session: Avery Lane, `owner`, door `ha`. Dashboard draws (screenshot taken).
- [x] Refused reads are logged once per 5 minutes (one line since the update).
- Other page reads the allowlist refused (seen in the log before 0.1.2): `hk_music/subscribe`,
  `config/entity_registry/get` and `hk_frontend/hidden/get`. **Answered in main since (for 0.1.3):** the
  registry read and Hidden Accessories from Mantel's own copies (RBAC-filtered; also in HK Settings'
  `panel/get`), and an interim music read bridge (`hk_music/subscribe`, `/queue`, `/settings/library`
  forwarded to HA's engine; home room not preselected until Phase 4).

### 0.1.3 on the house (2026-10-18 ~12:19, commit `226c8ab`)

Checked in the sidebar as Avery, at desktop size (1366×900):
- [x] **Cameras page** draws: 9 cameras, 3×3, 16:9 tiles with stills through Mantel (`hk-picture-entity`, 18
      elements, 0 placeholders). Avery had reported it "all messed up" (placeholders) in 0.1.2.
- [x] **Calendar** ends above the tab bar (last week row and "Add an Event" visible), events load.
- [x] **Music** page draws (playlists, library, "Plays on Downstairs") through the interim read bridge.
- [x] No ERROR lines in the log.
- **Live video is refused on the `ha` door** (by design: the sidebar uses the tunnel's rules, and live view
  there needs the role's `tunnel_cameras`; at the time it also needed a step-up, removed by decision 25), so the tiles stay on refreshed stills. The connector logged every retry; fixed in
  main (`mantel.camera` refusals once per camera per 5 minutes), ships with the next update. Avery may opt the
  sidebar into the LAN's rules (`ha_door_rules: lan`), which makes live view work there.

### 0.1.5 on the house (2026-10-18 15:51, commit `f9be9cb`, build `8c1b08852dbc14d4`)

HA backup `197c2d14` ("Before_Mantel_App_0.1.5_2026-10-18") taken first. Restaged `--replace`, store refresh,
update; `/data` kept. Brings HTTPS (decision 22), wall tablets through the App and `panel_admin: false`
(decision 23: the panel is open to every HA user; unlinked users get only "Not linked yet").
- [x] Starts; migrations 0009–0012 applied; log: `identity from Ingress, believed only from 172.30.32.2`, door
      `ha` uses the trusted rules, `HA Core (172.30.32.1) may reach linked mode's endpoint`, `read-only; commands
      disabled`, `authenticated to Home Assistant 2026.10.2`, registries and 4500 states; no traceback, no token.
- [!] Found on the house: Mantel's own pages did not work through Ingress and the dashboard had no entry for them
      (see "The prefix", Mantel's own pages); fixed for 0.1.6.
- [ ] In the sidebar as Avery (needs his sign-in in the browser): Connections → Music Assistant (Avery pastes his
      MA token), feature import, SF Pro/glyphs from `hk_house/www`, every page at desktop size.

### 0.1.6 on the house (2026-10-18 ~16:16, commit `a4fa26e`, build `eab799307d2f4960`)

Updated in place (no migration; backup `197c2d14` from 0.1.5 still the rollback point).
- [x] `<prefix>/admin` loads through Ingress (CSS, JS, every `/api/...` call under the prefix; 0 console errors):
      Me, Connections, People, Devices, Your files, Roles & grants, Audit. Connections shows Home Assistant
      "Provided by Home Assistant (App)", connected, 2026.10.2, 4500 entities; Music Assistant "not set up";
      "HTTPS and your proxy": mode Home Assistant App (Ingress), no door key needed.
- [ ] **Not reachable on the kitchen dashboard (found by Avery):** the **Mantel settings** entry is in HK's
      menu model (`hkShell.hostMenu()` → `<prefix>/admin`), but that dashboard navigates with the tab bar and
      HK's side menu is off whenever a tab bar shows (`menu.on()` false). **Fixed for 0.1.7:** a **Mantel**
      section at the end of the tab bar's More sheet (hk-tabbar.js, Owner/Admin only; a full page load of
      `<prefix>/admin`), and still in the side menu where that is the navigation; empty in HA. Drawn check in
      `tools/headless/client_smoke.py`: the row has an on-screen box and is hit-testable, an Adult has none, a
      click lands on `/admin`.
- [x] **Feature import** (People page, "Import HK's features from Home Assistant again"; reads HA, changes
      nothing there): music, live_tv, clean_areas, alarm_pin, energy, notifications. Before it, Energy, Power and
      Live TV opened Home (the views didn't exist in Mantel). After it, at 1366x900: **Energy** draws its 9 cards
      (period, hero, highlights, where, day, battery, water, tracking, rank); **Power** its 7 (house, status,
      battery, load, segments, slider, rank); **Live TV** the guide (no page scroll); **Vacuums** gains the
      Clean Areas picker (`hk-area-select-card`).
- [ ] Music Assistant on Connections (Avery pastes his MA token; 0.1.7 fixes the CSRF refusal), SF Pro/glyphs.

### 0.1.7 on the house (2026-10-18 evening, commit `0475684`, build `dc8430090eb5b9cd`)

Updated in place through the Home Assistant connector (store `check_updates`, then `update`; no migration, `/data`
kept, options unchanged, commands off). Brings the Energy merge (`89c8ab2`), Mantel settings in More, and the
admin page's CSRF retry.
- [!] **Connections Save still refused in Avery's own Chrome and Safari** ("The page lost its session token"), while
      it worked in Claude's browser pane on the same addresses (`homeassistant.local`, `hasslocal`, inside the
      sidebar frame). A read-only console check (`tools/diagnose_session_snippet.js`) showed **no Mantel cookies at
      all** in his frame (only HA's `ingress_session`) and no CSRF token from the server; his HAR showed why: **HA's
      frontend service worker fetches the frame's pages itself**, so they arrive as `Sec-Fetch-Dest: empty`,
      `Sec-Fetch-Mode: navigate`, and `ingress.wants_page()` (destination only) never started a session. Fixed in 0.1.8.
- [x] Music Assistant saved meanwhile from Claude's pane (Avery pasted his token there): `http://d5369777-music-assistant:8095`,
      MA 2.10.7, user "Mantel", live connected.

### 0.1.8 on the house (2026-10-18 evening, commit `c900194`)

Updated in place the same way. `wants_page()` counts `Sec-Fetch-Mode: navigate` as a page (API and script fetches
still start nothing); test `test_a_page_that_has_service_worker_fetches_starts_the_session_and_saves_work` (fails
without the fix); the admin page's one retry sends the token the server just gave. Validation: 129 JS suites,
723 HA Python, 2,355 Mantel, smoke ok.
- [x] Running 0.1.8; the Music Assistant connection survived the update (saved, live connected).
- [x] Avery's own Chrome after a reload: Connections Test works (reported by Avery).
- [x] Kitchen dashboard at 1366x900 (Claude's pane, `hasslocal`): More shows a **Mantel** section with **Mantel
      settings**, which opens `<prefix>/admin`.
- [x] Energy: 37 cards draw; at the bottom of the scroll the last row (Charging) ends a gutter above the tab bar
      (102 px below the last card), no overscroll; shadows fade under the bar (Chromium; Safari by eye still open).
- [ ] "Where it's going now" still 0 W: the house's HK has no `hk_energy/sources` yet, so Mantel falls back to the
      `source` attributes Utility Meters lack. Needs the next HK install.

### 0.1.9 on the house (2026-10-18 ~19:11, commit `ee2c801`, build `8b6b43073bceb4a6`)

Updated in place through the HA connector (backup `29a769d0` from the HK install half an hour earlier covers the
App's data). Log: `applied migration 0013_user_data`; authenticated to HA 2026.10.2 and Music Assistant 2.10.7;
read-only, commands disabled. Brings Mantel's own per-person HK user data (the Music "Plays on" speaker).
- [x] Music page (Claude's pane, Avery's Mantel user): speaker kept by Mantel ("Plays on Downstairs"), no more "No
      speaker selected."; Your Playlists and the Library categories draw.
- [ ] **Discover shelves and category lists** still refused ("Commands are disabled"): HK loads them with
      `call_service music_assistant.get_library` (return_response), which Mantel's gateway treats as a command.
      Fix in flight: answer it as a read from Music Assistant directly (agent).

### 0.1.10 on the house (2026-10-18 ~19:25, commit `f494669`, build `4a4e6dcd758bf673`)

Updated in place (no migration). Found by Avery: a detail sheet's chart drew nothing on **Hour** and **Day**
(Week/Month fine). Cause: those two read HA's REST `history/period` (hk-stats.js history()), which Mantel refused
("Commands are disabled"); Week/Month use statistics over the WebSocket. Fix (`6897921`): the shim asks the allowed
WebSocket read `history/history_during_period` and returns the REST shape.
- [x] On the house, through the page's own client: `GET history/period` for `sensor.crawl_space_dehumidifier_power`
      returns 28 rows for the last hour and 169 for the last day (was refused).

### 0.1.11 and 0.1.12 on the house (2026-10-18 evening, commits `dd31817`, `f663973`)

0.1.11: Browse's library as a read (`music_assistant.get_library` answered by Mantel from Music Assistant, never a
command; agent branch merged `ab91f31`). On the house the reads answered with real items and artwork, but the
Discover shelves drew empty: Mantel's settings feed sent the Discover rows as stored keys, not queries. 0.1.12
(`914d511`): the feed expands them as HA's `as_client` does.
- [x] Music page (Claude's pane): five Discover shelves loaded, commands off: Recently played playlists 12 (e.g.
      "Essential Christmas"), Recently played albums 12, Favorite playlists 12, Recently added 12, Favorite radio 1.
- [x] Avery uploaded SF-Pro.woff2 and hk-glyphs.js in Your files; HK's real font and icons draw (reported by Avery).
- Smoke note: one of six runs of `client_smoke.py` lost the page to a navigation during the Music page's fit step
  (before any new step); the other five passed. Flaky, to tidy.

### 0.1.13 on the house (2026-10-18 evening, commit `bcc1f9a`, build `8ff1b662ed70fcae`)

The segmented controls slide again (merged `098fe9a`, from Avery's recording: on the detail sheets the white
highlight faded and grew instead of sliding; `segCss(fill)` gave each choice `overflow:hidden`, clipping the
slide's start). Also in main, HK-in-HA only (next HK install): the HA adapter keeps HK's settings feed across a
reconnect (`ca96237`: the chips row lost after an HA restart under an open page; root cause found).
- [x] The house serves the fixed hk-base.js (no `overflow:hidden` on filled choices). Avery to confirm by eye.

### 0.1.14 and 0.1.15 on the house (2026-10-18 evening, commits `5c49130`, `ae33b46`)

0.1.14: the Music page's false "Commands are disabled" (`hk_frontend/art/sign`, now-playing artwork, refused by the
shim for the "sign" in its name) is answered on the page as nothing signed. Commands stayed on (Avery enabled
them before this update). 0.1.15: merged `babb5c2` (HK Settings inside Mantel: `<base>/hk-settings`, Owner/Admin,
menu entry, admin link, "This is Mantel's copy" notice) and `2a20980` (Energy/Power sections keep the room pages'
spacing; shared HK code, also for HK in HA at the next install). Validation 129 JS, 723 HA Python, 2,406 Mantel,
smoke ok.
- [x] Log: COMMANDS ENABLED kept, HA and MA authenticated. Audit shows Avery's commands from Mantel (8:06–8:10 PM:
      `homeassistant.toggle` ×2, `hk_frontend.music_play`, volume, `media_pause`), all allowed.
- [x] HK Settings opens in Mantel (pane): back link, notice, 162 accessories, 2 pop-ups, 2 custom pages.
      **Gaps:** "Screens" shows 0 (HA's dashboards list isn't served by Mantel yet); Setup Check stays "Checking…".
- [x] Energy page spacing matches the room pages; HK Settings in the More sheet.
- Seen once right after the App restart: a page loaded during the restart drew without Energy/Power (the feature
  list not yet sent); a reload fixed it. Worth a later look (the page could re-plan when the feature list arrives).

### 0.1.16 refused, 0.1.17 on the house (2026-10-18 ~22:30, commit `4c890a6`, build `a93881d9e4c8bbdf`)

HA backup `ac81b300` first. 0.1.16 carried decision 25 (only the Alarm PIN), HK Settings' screens list, Setup Check,
Service accounts on the sidebar and direct access (security-reviewed: M1–M4 and L1–L8 fixed, `aaf4976`). **HA's
Supervisor refused the update** ("expected an email address": `acme_email: "email?"` with an empty default), but
recorded 0.1.16 and left the App **stopped in error** (Mantel down for a few minutes; HA's dashboards and tablets were
unaffected). Fixed `2cd4883` (plain string; the entrypoint checks the address; package_check now refuses an empty
default under a typed schema entry), restaged as 0.1.17 (HA kept 0.1.16's schema otherwise), updated, and started
by hand (the App's boot is manual). Lesson: an options/schema change must pass package_check's typed-default rule,
and a refused update can leave the App stopped.
- [x] `/healthz` ok, HA connected; options kept (commands on, `access: ingress`).
- [x] HK Settings in Mantel lists the 7 screens; Setup Check all ok (HA 2026.10.2, MA 2.10.7, SF Pro & glyphs,
      house commands, screens); Service accounts shown in Mantel settings.
- [ ] Direct access (`access: proxy` behind Avery's NPM on another LAN machine): next, with his NPM IP and hostname,
      an NPM Access List if NPM's 443 is internet-facing (review M3), then `/proxy-check`.

### 0.1.18 (2026-10-19, main `abb7cec`)

HA backup `de1c24f9` first. Carries:
- Mantel Settings: HK Settings and Mantel's settings on one page (decision 27). HK in HA shows HK Settings only
  (its shared parts reach HK in HA at the next HK install).
- Default screens per person and per tablet (landing only; migration 0014).
- Rotate door key from HA's trusted sidebar without a fresh sign-in (it looped, `2814ca4`).
- The docked menu at the window's left edge at the direct address (`c7cb43c`).
- Notification and house pop-up taps open their sheets (`1a9549c`, `ca26c5d`).
- The Power page's house picture (`998d8b0`).
- `ha_frame_origins`: HA's Webpage dashboards may frame the direct address (`ac7161f`).
- Option texts: only the alarm asks for a code (`e4ac65b`).

Validation 130 JS, 723 HA Python, 2,502 Mantel, smoke ok.
- [x] Updated and running (build `00ae61e215dabb2f`), HA connected; options kept (`access: proxy`, NPM
      192.0.2.254, sign-in at hassiot, commands on, port 8100).
- [x] `https://mantel.example.com/` answers through NPM (sign-in page with Sign in with Home Assistant).
- [x] Mantel Settings through HA's sidebar (pane): 7 screens, 162 accessories, Setup Check Ready; People & Access,
      Connections (HA and MA connected), Your Files; HTTPS and Your Proxy shows Rotate Door Key (not pressed:
      Avery rotates and pastes the key into NPM himself).
- [ ] Avery: rotate the door key, NPM Advanced block and Access List, then `/proxy-check` at home and over the tunnel.

### 0.1.19 (2026-10-19, main `f53c702`)

Carries:
- The NPM block for the HA App forwards to `HA_MACHINE_ADDRESS:8100` and says what to fill in. Its `lan` block
  stamps `tunnel` for Cloudflare's requests (`90cfec8`).
- Wall tablets' Direct Connection, slice 1: Kiosk Satellite and Fully pairing and status, no commands
  (docs/phase8/KIOSK.md, `d157f23`). Paired on the tablet's page in Mantel Settings, listed under Connections →
  Wall Tablets, sealed and audited, with a Setup Check line.

No migration. Validation 130 JS, 723 HA Python, 2,590 Mantel, smoke ok.
- [x] Updated and running (build `841f581d58ec0ab7`), HA connected; the direct address answers through NPM.
- [x] Mantel Settings → Connections lists Wall Tablets (pane): Kitchen, Living Room, Loft, Master Bathroom and
      Master Bedroom, all Kiosk Satellite, "Not Set Up". Pairing each one (its Remote Administration password,
      typed by Avery on the tablet's page) is next; Mantel sends tablets no commands yet.
- Seen: after the App restart a Settings page opened straight at its Ingress address got HA's own
  "401: Unauthorized" until Mantel was opened once from HA's sidebar (HA's Ingress session had lapsed, not Mantel).

### 0.1.20 (2026-10-19)

Pairing the Kitchen tablet (Kiosk Satellite 2026.10.6) said "not Kiosk Satellite's remote administration". Cause:
one `content.read(1 MB)` returns only what has arrived, so the command list (several pieces) was cut short and its
JSON failed. Fixed with `kiosk.read_body` (every piece, capped), also in Fully's client and the Music Assistant page
rewrite. Found with a wrong-password pairing through the App (it got "refused that password", so the App reached the
tablet) and a fake tablet that answers in pieces, which gave the same message before the fix.

### 0.1.21 (2026-10-19)

"Sign in with Home Assistant" on the Loft tablet showed a blank page or Retry and never HA's sign-in page: HA's
`trusted_networks` signs the tablet in as its own HA user at once, and HA then refuses Mantel the code exchange
(`403 access_denied`: a trusted-networks sign-in is honoured only from the trusted address, and Mantel exchanges from
the App's). It would have been the tablet's user anyway, not the Owner. The way in for such a tablet: a **Wall Tablet
account** (People → Add a Mantel Account…, role Wall Tablet, a password), signed in on the tablet with its user name and
password, which may make only its own tablet. 0.1.21 shows that account **Make This Browser a Wall Tablet** on its Me
page (it saw no Devices page before), and stores a room typed by name as its id (`Loft` → `loft`), as HK's tablets and
HA's areas name them, so the tablet finds its own screen and linked mode's tablet. Checked in the browser pane against a
local Mantel with a test Wall Tablet account: enrolled, room `loft`, the account signed out.

### 0.1.22 (2026-10-19)

A Wall Tablet account sees no Mantel Settings from the dashboard (Avery: on purpose), so 0.1.21's Me → Make This
Browser a Wall Tablet could not be reached on the tablet. Now `/home` takes a Wall Tablet account that is not a tablet
yet, on the home network, straight to that page, with Name and Room filled in from the account's name. Checked in the
browser pane against a local Mantel: sign-in → `/home` → the enrol page with Loft / Loft.

### 0.1.23 (2026-10-19)

The Loft, signed in as its Wall Tablet account `loft`, still showed its screen: Kiosk Satellite reopens the page it
last showed (`/dashboard-loft/home`, no referrer) even with `/home` as its Custom Page, so 0.1.22's `/home` redirect
never ran. Now every screen page sends a Wall Tablet account that is not a tablet yet (home network) to Me → Make This
Browser a Wall Tablet, and the form fills Name and Room from the user name when the account has no name.

### 0.1.24 (2026-10-19)

The Loft could be pinched to zoom although Kiosk Satellite's pinch-to-zoom is off: at 1x Kiosk Satellite leaves the
page's own viewport tag alone and relies on it saying `user-scalable=no`, as HA's pages do. Mantel's screen page now
says the same (`width=device-width, user-scalable=no, viewport-fit=cover, initial-scale=1`, HA's own values).

### 0.1.25 (2026-10-19, main `d81aa69`)

- **Show in Home Assistant**, per screen (`ha-dashboards`, f028add): Mantel Settings → a screen → a switch that makes,
  changes or removes an HA Webpage dashboard of the screen's own address (`mantel-<screen>`, title, icon, admins only
  or everyone); HA is the only record. HTTPS and Your Proxy checks that the HA address the page is framed from is
  allowed (`ha_frame_origins` / `ha_sign_in_url`).
- **The product's name follows the host** (`product-name`, 7fc5341): in Mantel, HK's screens and settings say Mantel; in
  HA they still say HK Frontend (that part reaches HK in HA only at the next HK install). The preview's eye is a Pin
  button. Help links to HK Frontend's wiki are hidden in Mantel until its docs have a home.

Validation 130 JS, 724 HA Python, 2,627 Mantel, smoke ok.
- [x] Updated and running (build `c7f117c2bac3df23`), HA connected. In Mantel Settings (pane, sidebar) the Loft
      screen's page has Show in Home Assistant (address `https://mantel.example.com/dashboard-loft/home`), no
      "HK Frontend" anywhere on it, and the preview's Pin button. Not switched on (Avery's call). For a dashboard opened
      at `hasslocal`, the App option `ha_frame_origins` needs `https://hasslocal.example.com` (only `hassiot`,
      the sign-in address, is allowed now); the HTTPS page says so.

### 0.1.26 (2026-10-19)

The Kitchen screen added to HA (Show in Home Assistant) was a white page: HA was open at `hasslocal`, and only
`ha_sign_in_url`'s `hassiot` might frame Mantel (console: "Framing … violates … frame-ancestors"). Avery: nothing may be
specific to one setup. Now (`frame_origins.py`) the allowed addresses are HA's own internal and external URL (read from
HA), the operator's (`ha_sign_in_url`, `ha_frame_origins`), and the ones an Owner allows in Mantel Settings →
Connections → HTTPS and Your Proxy → Home Assistant's Frame (Allow / Remove, audited, no restart), or by turning on
Show in Home Assistant while HA is open at that address.
- [x] On the house (build `bfccdcf00ff21444`): frame-ancestors now `hassiot` (option) and `hass.example.com`
      (HA's own external URL, learned from HA); Home Assistant's Frame lists both with their sources and offers Allow an
      Address (pane). `hasslocal` is not one of HA's own URLs, so it waits for Avery's Allow (the Kitchen dashboard
      `mantel-kitchen` exists).

### 0.1.27 (2026-10-19)

On Mantel the wall tablets' Sleep Screen was half there: Mantel's engine decided and turned the screensavers on and off,
but no touch ever reached it (`binary_sensor.<tablet>_screen_in_use` never on, `last_touch` null), HK's black was never
drawn or confirmed (`confirmed: false`), and the backlight was never lowered (the Loft stayed at 174). Cause: HK's
screensaver (`hk-saver.js`) read its config only from Home Assistant's Lovelace panel (`panel.lovelace.config`). On
Mantel the panel is the page, with no `lovelace`, so the screensaver had no config at all: no touch reports, no black
curtain or acknowledgement, no `setBrightness`. Now it reads the shell's `dashboardConfig()` where the panel has none
(as `hk-sky.js` already did), and on such a host the block is made again from the screen's settings when the one the
strategy made at load names no switch (Mantel's own switch states arrive a moment after its settings). In Home
Assistant nothing changes: the panel's config is read as before, and HK Frontend needs no install for this.
Checked: on a local Mantel page (fictional server, headless Chrome) the screensaver's config was `null` before and is
the screen's block after; `test_saver` covers the shell's config, a touch told from it, the block made again, and a
Lovelace panel's block read as written.
- [x] On the house (build `0aa84393125dd04a`, 16:34; the tablets' pages reloaded 16:35): the Loft's black
      `confirmed: true` at 16:35:07, backlight 0.0 (Kiosk Satellite `/api/health`) while dark, 0.68 again after the
      wake at 16:35:41. Kiosk Satellite injects `window.kioskSatellite` (with `setBrightness`) into every page,
      Custom Pages included (its docs/js-api.md).
- [ ] A touch on the Loft shows in `binary_sensor.loft_screen_in_use`; a real night.
- [ ] The other four tablets: still HA-owned (CUTOVER.md log), three of them open `/dashboard-kitchen/home` with no
      `?hk_tablet=`. Each needs its own screen and `?hk_tablet=<id>` in Kiosk Satellite, then ownership moved.

### 0.1.28 (2026-10-19, main `1bd8295`)

Mantel's side of Mantel Link (phase 9, slices 9.1–9.10; docs/phase9/MANTEL-LINK.md). Nothing changes for the house's
HK Frontend (eabb70a): a link without the `X-Mantel-Link` header is protocol 1 and answered exactly as before.
- **Linked protocol 2** for Mantel Link: Mantel's instance id in hello, the `bridge` owner, Mantel Link's report.
- **Supervisor discovery:** config.yaml gains `hassio_api: true` and `discovery: [mantel]`; at start the App
  announces `{service: "mantel", config: {url, token}}` to HA, so a Home Assistant with Mantel Link shows
  "Discovered: Mantel". Without Mantel Link installed HA does nothing with it.
- **Pairing codes** for Mantel Link (`POST /api/linked/pair`, Owner, memory only, audited).
- **Mantel Settings → Connections → Home Assistant Link:** what is linked, the bridge (hand over / give back,
  Owner, refused until HK Frontend's last feature release is installed), who runs each wall tablet.
- Mantel Link itself (HACS) and HK Frontend 1.9.0 / 1.10.0 are not part of this update; installing them is 9.11,
  step by step with Avery.
- [x] On the house (build `271eb3b80fcb024a`, 18:48; backup `be9cdef6` first): the App started, migration 0015
      applied, Supervisor discovery announced (Service account "Home Assistant - App discovery"), HK Frontend
      reconnected as protocol 1 at 18:48:23, the Loft's switches live (black screen on).
- [ ] The Loft still sleeps and wakes through the night; the Home Assistant Link page shows HK Frontend linked.

### 0.1.29 (2026-10-19, main `0dd379b`)

Everything on main since 0.1.28 (validation green: JS 130, HA py 732, Mantel 2837, smoke):
- **The screensavers' photos load again.** HK's screensaver asks `media_source/resolve_media` for each photo; Mantel
  refused it, so no photo ever showed. Mantel now answers it itself (connectors/media_photos.py): `feature:media`, HA
  media folders only, images only, with a short-lived `/api/photo/<id>` that it streams from HA Core's own address
  (`http://homeassistant:8123` in the App) with HA's signature and no credential.
- **Mantel Photos:** Mantel Settings → Photos (since moved into Your Files → Photos), the screensavers' own library (albums, bulk upload with HEIC and
  no location, a grid preview, delete, import from an HA media folder; migration 0018). New in the image: Pillow
  13.0.0 and pillow-heif 1.8.1.
- **A screen's Home Assistant section by where it is shown:** HA's sidebar inside HA, one "Open Home Assistant"
  row at Mantel's own address, none on wall tablets.
- **The wall tablet's room is picked, never typed**; a device's room can be changed without re-enrolling.
- **Phase 10, server side:** Mantel Settings on iPhone and iPad (safe areas, the iPad breakpoint), Home Screen web
  app with Web Push, the apps' sign-in (PKCE, device-bound credentials, pairing QR), the REST door, and push
  through the relay at `mantel-push.jazzphone.workers.dev` (no APNs key on the house; migrations 0016, 0017).
  Unused until a phone pairs.
- **Clean Areas and automation snooze** run on Mantel's engines as the person who asked, once Mantel Link holds
  the bridge; **Mantel's docs at `/docs`**.
- **Staging fix:** the web app's icons moved from `web/app/icons` to `web/app/art` (`/app/art/<name>`): HA's Samba
  add-on refuses to create a folder named `icons`, so staging failed (guard: `test_stage_ha_app.py`).
- [x] On the house (backup `d59597af` first; build `ec45740d508e3193`, 21:17): migrations 0016, 0017, 0018 applied;
      Mantel Link (protocol 2, the discovery account rotated) and HK Frontend reconnected; no errors; the manifest
      and icons answer 200. The Living Room's screensaver showed a photo through `/api/photo/<id>` (200, 618 KB,
      21:18:48), the first since the tablets moved to Mantel.
- [ ] The five tablets through a night on 0.1.29; Mantel Photos used for real.

### 0.1.30 (2026-10-20)

- **The tablets' displays turn off at night again.** Each tablet's Sleep Screen engine looked up its kiosk's
  entities (the display, the Black screensaver) once, when made; at 0.1.29's start the engines were made a moment
  before HA's registries arrived and every tablet kept an empty kiosk. Mantel went dark at Good Night (black,
  backlight to the target) but never turned the Master Bedroom's display off in quiet hours ("Display Off"), and
  the kiosk's Black screensaver fallback was gone too. Engines now follow their kiosk when the registries load;
  the house's registry index rebuilds on every load.
- **The app's sign-in** ("bad Origin" adding a house by hand): the consent page is same-origin, not no-referrer.
- **Photos inside Your Files**; **New Album… / Add Photos** in a screen's screensaver photo picker.
- **Reload / Clear Cache & Reload (and All at Once) work on Mantel**: each tablet's Kiosk Satellite API password is
  kept by Mantel (at rest encrypted, audited; migration 0019), typed by an Owner.
- **No flicker on the Energy and Weather screens**: their layers are kept, not made and dropped on each turn.
- [ ] On the house: every tablet's Sleep Screen names its kiosk again (`sensor.<tablet>_sleep_screen` attribute
      `kiosk`), the Master Bedroom's display goes off at Good Night.

### 0.1.31 (2026-10-20)

- **Every tablet's kiosk is found at once after a restart:** each HA connect's first registry load is told to the
  features (`on_registries_loaded`), so the Sleep engines pick up their kiosk without waiting for a settings save.
  Never told to the pages: that redrew every open page.
- **A tablet's Setup -> Device lists the kiosk apps' devices** (Kiosk Satellite, Fully Kiosk); it offered only None.
- **The home page clears the status bar and the Dynamic Island** (iPhone app, Home Screen web app); the iOS app's
  menu has Mantel Settings and Clear Cache. Mantel for Mac (menu-bar player, favorites, Play Music) uses the
  existing pages.
- [x] On the house (backup `2455d36d` first; build `deb296c6376e4174`, 07:14): Mantel Link and HK Frontend
      reconnected; all five `sensor.<tablet>_sleep_screen` named their kiosk at 07:14:48–49, at the start, with no
      settings save.
- [ ] The Device picker lists the five Kiosk Satellites (Avery, in Mantel Settings); a night with the displays off.

### 0.1.32 (2026-10-20)

- **Alarm PIN:** a PIN, arm rule or alarm saved on HK Settings' Alarm PIN page (still saved in HA) is stored in
  Mantel too, whose keypads check it; the page says whether Mantel holds one. Enter the PIN once more after this
  update.
- **Music:** saved playlists and their artwork load; the "Starting <playlist>…" toast shows again.
- **Calendar:** the Month card keeps its bottom edge in Safari; a calendar HA can't read is named once.
- **Inside HA:** no dead "Open Home Assistant" row; the bottom Home Assistant row always works.
- **Notifications** are centred on the whole screen with the screensaver's music pane up.
- **Apps:** the iPhone music player is not covered by the tab bar and is solid in the Flat look; the Mac app's
  player and pages.
- No HA backup taken (Avery: the App touches nothing in HA).
- [x] On the house (build `113bd4f7a18a90b5`, 10:23): Mantel Link and HK Frontend reconnected; all five tablets
      named their kiosk at the start.
- [ ] Avery: the Alarm PIN entered once more on HK Settings' Alarm PIN page, then a disarm at a tablet.

### 0.1.33 (2026-10-20), with Mantel Link 0.1.2

- **Mantel without HK Frontend** (docs/phase9/NO-HK-FRONTEND.md): the house's entities (Seasonal decorations, the
  Alarm PIN keypad, Live TV) can be handed to Mantel Link like the tablets; the Alarm PIN keypad and page are
  Mantel's own once the house is; HK's remaining settings saves (accessories, hidden, favorites, music) are kept in
  Mantel. Nothing moves by itself: `house` stays HA's until the hand-over in Mantel Settings.
- **Mantel Link 0.1.2:** the house's entities and the keypad, the doorbell talk view, Energy's sources, the Lights
  page's Tonight list, and Show Menu opening HA's own sidebar inside HA.
- Navigation inside HA; the Mac app's favorites search.
- No HA backup (Avery).
- [x] On the house: App build `445d866c8673aa06` (13:26); Mantel Link 0.1.2 copied (publish build, suite 54 passed,
      `diff -rq` empty), HA restarted; both links reconnected at 13:27, no Mantel errors in HA, all five tablets
      named their kiosk.
- [ ] The house hand-over, the Alarm PIN entered in Mantel Settings, then HK Frontend removed (NO-HK-FRONTEND.md).

### 0.1.34 (2026-10-20)

- **Mantel Settings -> About**: the version (from `RELEASE.json`, written at staging), commit and build, how
  Mantel runs, Home Assistant's, Music Assistant's and the links' versions, and a word on the project.
- **The House** has its own group on Home Assistant Link, apart from Who Runs Each Wall Tablet.
- No HA backup (Avery).
- [x] On the house (build `8661f15c2a105169`, RELEASE.json 0.1.34 / af4c3d7, 14:00): both links reconnected,
      `/api/about` refuses a signed-out request (401).
- [ ] Avery: Settings -> About shows 0.1.34; HK Frontend removed (a full HA backup first).

### 0.1.35 (2026-10-20)

- **The iPhone app feels native** (merge 5e59402): `web/shim/mantel-native.js` (inert without the app's bridge),
  a "Mantel App" row in the menu (app only), the More sheet runs a host row's action, a guarded `hkHostPlayer`
  hook on the music cards for the app's own player, haptics. Web only; no migration.
- No HA backup (Avery).
- [x] On the house (build `a8e831663b66a21a`, 02fe44b, 15:02): both links reconnected; the tablets' kiosks named.

### 0.1.36 (2026-10-20)

- **The pills frost again with Blur's Shared Layer and Pre-Rendered** (merge c134f82): Mantel's shell now names its
  view's element types, so the shared blur layer sits above the sky, under the cards.
- **A page change moves together** (190fa6c): the address, the page, its Highlight Color and its Flat ground change
  once the next page's states are in; on a slow link Home no longer turned the next page's color first.
- No HA backup (Avery).
- [x] On the house (build `1222925a4a8375c0`, 289a637, 16:28): both links reconnected; the tablets' kiosks named.

### Removal

Stop and uninstall **Mantel** (Settings → Apps → Mantel → Uninstall); this removes its image and `/data`
(people, roles, settings copy, audit). Delete `/Volumes/local_apps/mantel` and refresh the store. Nothing
else in HA was changed (the App creates no entities, no users, no tokens; HK Frontend is untouched).

## Not done / risks

* `panel_admin: false` is in the repository, not yet on the house (0.1.4 there is admin-only): the next
  App update opens the panel to every HA user (unlinked ones see "Not linked yet"; Jordan and Riley see
  their roles). Earlier plan (CUTOVER.md, Avery): open it to the household only at cutover; hold that update
  until Step 3 if that still stands.
* Wall tablets through the App: the kiosk path (first load by trusted_networks, HA's kiosk mode, restarts,
  ingress-session expiry) and HA Core reaching `http://local-mantel:8099/linked/ws` are read from HA's code
  and tested against stand-ins only; the scratch HA has no Supervisor, so no Ingress. Verify on the Loft.
  HK Frontend's Configure accepts that address since the 2026-10-18 change ("Linked mode in the App"); not yet installed on the house.
* No in-page UI link to the People page yet (the address is `<prefix>/ingress/people`; the setup
  confirmation links it). The HK Settings panel's own user management is P3.x front-end work.
* The passkey "confirm it is you" check does not work through Ingress (RP ID); the TOTP one does.
* `/dev` diagnostics and HK Settings' photo URLs are not prefix-aware (above).
* Requests that arrive before the page's first load set cookies run without a session (read-only);
  the policy tick cannot close such a socket on unlink (it closes it on the next reload).

## Exact continuation point

1. Orchestrator: stage into `/Volumes/local_apps/mantel` and run the install + checklist above; record HA
   Core/Supervisor versions and each checklist line's result in this file.
2. If the Supervisor refuses `config/auth/list` to the App credential: link the first Owner with the
   `docker exec` fallback. (Falling back to "only admins can open the panel" no longer holds: the panel is
   open to every HA user since `panel_admin: false`; the house already has its Owner.)
3. `panel_admin: false` is set in the repository (wall tablets): version bump, restage `--replace`, update
   the App when Avery wants the panel open (at the latest, Step 3 of CUTOVER.md); then link each tablet's HA
   user as a wall tablet and follow CUTOVER.md.
4. Front end: a *People* entry in Mantel's menu for Owners/Admins (→ `<prefix>/ingress/people`).
5. Later: publish the image (packaging/docker `app` target, GHCR) and add `image:` for updates through HA.

### HK Settings lists Mantel's screens (after 0.1.15)

`settings_store.panel_payload()` now sends `dashboards` built from Mantel's boards (HA's `panel/get` shape:
`path`, `title`, `mode: "mantel"`, `id: null`, `generated: true`, `require_admin: false`, `item` = the board key,
`icon`), so Overview counts them and each screen's page opens. The title is the board's own `title` if it has one,
else its address made readable (`dashboard-kitchen` -> Kitchen); the import keeps no dashboard titles. The
preview and its "Open Screen" link go to Mantel's own `<base>/<path>/0` (`window.__mantelBase`), never HA's.
Add Screen and Remove/Delete Screen need HA: the page says so in Mantel instead of offering them. Smoke opens
HK Settings, sees the screen count, opens a screen and sees its preview draw at 1400 and 1000 px (above the settings
at 1000).
