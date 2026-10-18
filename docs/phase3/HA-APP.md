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
| `web/shim/base.js` (new), `web/home.js`, `web/shim/hub.js`, `mantel-stepup.js`, `mantel-host.js` | Mantel's own page code: prefix from `<meta name="mantel-base">`, REST and WebSocket through it, history writes/links kept under it. **No file of `web/hk`, `web/client`, `web/cards`, `hk_core` or `hosts/ha` changed: the HA build is byte-identical.** |
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
* **Not a fresh factor.** HA's sign-in may be days old; the session starts with `fresh_factor_at = NULL`,
  so locks, alarms and other sensitive actions still need a PIN/TOTP step-up (P3.3).
* **Sign-in routes are refused through Ingress** (`/login`, `/auth/callback`, `/api/auth/password`,
  `/api/auth/totp/verify`, `/api/auth/passkey/*`, `/api/bootstrap`): HA already signed the person in.
  TOTP and PIN step-up work; passkeys do not (their RP ID is Mantel's own hostname, not HA's).
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
so (503) and nothing is created (fail closed). `panel_admin: true` keeps the panel to HA admins anyway
until the Owner opens it to everyone.

### People (linking the household)

`<prefix>/ingress/people` (Owner or Admin): HA's people (from `config/auth/list`, system users and
deactivated accounts left out) with their Mantel role; *Link* with a role (owner/admin/adult/child/guest)
or *Unlink*; a by-id form if HA's list cannot be read. Plain forms with the session's CSRF token and an
Origin check; Admins never link, re-role or unlink Owners; the last Owner cannot be removed; each change is
audited (`ingress.link` / `ingress.unlink`). Unlinking ends that user's sessions at once (Store.unlink).
For the Owner it also offers **Import HK's settings from Home Assistant (once)**, the same one-time import
as `POST /api/settings/import` (P3.5), so a fresh App draws the house's dashboards.

## The door decision: `ha`

Requests through the sidebar come by a third door, **`ha`**. **Decision (Avery, 2026-10-18): the sidebar is
fully trusted**, as HK in Home Assistant and the Companion app always were:

* **`ha_door_rules: trusted` (the App's default since 0.1.4).** The `ha` door gets the LAN's RBAC rules, and
  the HA sign-in counts as a fresh factor (`authz.ha_trusted`), so nothing asks for a Mantel code: live
  cameras, locks, garage and the alarm work in the sidebar and the Companion app, at home or away. Each
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

## The App

* **`config.yaml`**: name Mantel, slug `mantel`, version 0.1.0, `arch: [amd64, aarch64]`,
  `startup: application`, `boot: manual`, `init: true`, `ingress: true`, `ingress_port: 8099`,
  `panel_icon: mdi:fireplace`, `panel_title: Mantel`, `panel_admin: true`, `homeassistant_api: true`,
  `watchdog: http://[HOST]:[PORT:8099]/healthz`; options `commands_enabled: false`, `log_level: info`,
  `default_screen: dashboard-kitchen`, `ha_door_rules: tunnel`. No `image:` (the Supervisor builds the
  local folder), no ports, no `hassio_api`/`auth_api`/host network/devices.
* **`Dockerfile`**: `python:3.12-slim-bookworm` (a plain Python base, as the Mantel Connect proof App that
  ran on this house), the pinned `requirements.txt`, uid 10001, `COPY app /app`, `CMD python /app/entrypoint.py`.
  (packaging/docker/Dockerfile's `app` target remains the path for a published image later.)
* **Start**: `entrypoint.py` sees `SUPERVISOR_TOKEN` + `/data/options.json`, writes the token to
  `/tmp/ha_token` (0600) and removes it from the environment, builds `--ha-url http://supervisor/core
  --ha-ws-url ws://supervisor/core/websocket --data-dir /data --secrets-dir /data/secrets --port 8099
  --listen 0.0.0.0 --allow-host * --ingress --ingress-only ...`, chowns `/data` to 10001, drops root, execs
  the server. HaClient, ReadProxy, the camera signaling and (when on) the commander all use the Supervisor's
  WebSocket; REST goes to `http://supervisor/core/api/...`. Commands only when the option is exactly `true`.

## Staging

```bash
~/.venvs/mantel/bin/python tools/stage_ha_app.py --dry-run           # what, how much, and the scan; writes nothing
~/.venvs/mantel/bin/python tools/stage_ha_app.py <local apps share>/mantel            # new folder
~/.venvs/mantel/bin/python tools/stage_ha_app.py <local apps share>/mantel --replace  # update one it staged
```

Dry run today: 2663 files, 66.2 MB (web 65.2 MB: HK's code and sky/landscape art; mantel_server 0.5 MB;
hk_core 0.5 MB), scan clean. The scan refuses: font files of any kind (SF Pro is Apple's; each home adds
its own through "Your files"), `hk-glyphs*`/`hk_local`, fixtures, secrets, `.env`, keys, tokens, databases;
JWT/GitHub/AWS/private-key-shaped text; private-network addresses except three named ones
(`172.30.32.2` the Supervisor, `172.31.251.2` compose's Caddy, and config.py's development default
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
  there needs a step-up), so the tiles stay on refreshed stills. The connector logged every retry; fixed in
  main (`mantel.camera` refusals once per camera per 5 minutes), ships with the next update. Avery may opt the
  sidebar into the LAN's rules (`ha_door_rules: lan`), which makes live view work there without a step-up.

### Removal

Stop and uninstall **Mantel** (Settings → Apps → Mantel → Uninstall); this removes its image and `/data`
(people, roles, settings copy, audit). Delete `/Volumes/local_apps/mantel` and refresh the store. Nothing
else in HA was changed (the App creates no entities, no users, no tokens; HK Frontend is untouched).

## Not done / risks

* `panel_admin: true` for now: non-admin household members cannot open the panel until it is set to
  `false` (a config.yaml change + restage + rebuild). Their Mantel role still governs once they can.
* No in-page UI link to the People page yet (the address is `<prefix>/ingress/people`; the setup
  confirmation links it). The HK Settings panel's own user management is P3.x front-end work.
* Passkey step-up does not work through Ingress (RP ID); TOTP and PIN step-up do.
* `/dev` diagnostics and HK Settings' photo URLs are not prefix-aware (above).
* Requests that arrive before the page's first load set cookies run without a session (read-only);
  the policy tick cannot close such a socket on unlink (it closes it on the next reload).

## Exact continuation point

1. Orchestrator: stage into `/Volumes/local_apps/mantel` and run the install + checklist above; record HA
   Core/Supervisor versions and each checklist line's result in this file.
2. If the Supervisor refuses `config/auth/list` to the App credential: link the first Owner with the
   `docker exec` fallback and change `bootstrap_state` to fall back to `panel_admin` (only admins can open
   the panel) — a decision for Avery.
3. When the household is linked: `panel_admin: false`, version bump, restage `--replace`, rebuild.
4. Front end: a *People* entry in Mantel's menu for Owners/Admins (→ `<prefix>/ingress/people`).
5. Later: publish the image (packaging/docker `app` target, GHCR) and add `image:` for updates through HA.
