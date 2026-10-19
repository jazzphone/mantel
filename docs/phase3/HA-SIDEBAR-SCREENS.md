# Mantel screens in Home Assistant's sidebar (Webpage dashboards)

Status 2026-10-19: **step 1 built and merged** (App 0.1.18). **Step 3's switch built** on branch `ha-dashboards`
(not merged, App not bumped; "Built", below). Step 2 is facts.

Goal (Avery): each Mantel screen addable to HA's sidebar the way the Zigbee2MQTT UI is, mainly so the HA
Companion app can open Mantel **by default**. Wall tablets stay on Mantel's own address, unframed.

## Step 1: Home Assistant may frame Mantel's direct address (built)

| Piece | What changed |
|---|---|
| App option `ha_frame_origins` (`packaging/ha-app/config.yaml`, translations, DOCS.md) | HA's other addresses, comma separated. With `access` proxy/https, `ha_sign_in_url`'s origin plus these go to `--frame-ancestors` (`entrypoint.frame_origins`). Each must be a plain `http(s)://host[:port]` origin (no path, wildcard, user, IPv6); a bad one stops the App with a reason. Ingress-only installs add nothing. |
| `/login` and `/admin` CSP (`security_headers.own_page_csp`) | Were always `frame-ancestors 'none'` (or `'self'` via Ingress), so a signed-out frame went blank. They now admit the operator's frame-ancestors too; nothing else. |
| Signed-out frame navigation (`auth._wants_document`) | `Sec-Fetch-Dest: iframe` now redirects to `/login` like `document` (was a bare `401 sign in at /login`). |
| `login.js` in another site's frame | (a) names the frame `ha-main-window` on *Sign in with Home Assistant*; (b) adds `via=<the frame's top origin>` (`location.ancestorOrigins`) to `login/ha`, which the server uses as HA's sign-in address **only if** it is one of the frame-ancestors; (c) hides the passkey button. |

Why (a): HA's sign-in page reads `client_id`/`redirect_uri` from HA's "main window": itself if named
`ha-main-window`, else **its parent** if that one is. In a Webpage dashboard the parent is HA's main window,
so the page read the dashboard's URL and stopped with "Invalid redirect URI" (HA frontend 2026.9,
`authorize.*.js`, `a.G.location.search`). Naming the frame makes HA read its own URL. It depends on HA's
internals: if a later HA changes it, *Sign in with HA* in the frame breaks again (password still works).

Why (b): HA sends `X-Frame-Options: SAMEORIGIN`, so its sign-in page loads in the frame only from the address
the dashboard was opened at. With hasslocal at home and hassiot away, a fixed `ha_sign_in_url` would work in
one of them only. Firefox has no `ancestorOrigins`: there the configured address is used.

Why (c): HA's Webpage iframe is `sandbox="allow-forms allow-popups allow-pointer-lock allow-same-origin
allow-scripts allow-modals allow-downloads"`, `allow="fullscreen"`: no `publickey-credentials-get`, so a
passkey can only fail in it. (Also no microphone, no top navigation.)

Verified in the browser pane against a scratch HA (127.0.0.1:8125, own copy of tools/testha) and a local
Mantel (127.0.0.1:8771, `--frame-ancestors http://127.0.0.1:8125`): Webpage dashboard → Mantel's sign-in page in
the frame → *Sign in with Home Assistant* (`via` sent) → HA's page in the frame → back → the live screen;
reloads and dashboard switches stay signed in. Before the fixes: bare 401 text, then "Invalid redirect URI".

Cookies and Safari: Mantel's cookies are `SameSite=Strict`. A frame whose top page is same-site
(`hassiot.example.com` around `mantel.example.com`) gets them, and WebKit's tracking prevention
blocks cross-site cookies only (registrable domain), so Safari and the Companion app's WKWebView behave like
Chrome here. **Not tested on real Safari/iOS**; the scratch test was same-site cross-origin (two ports of
127.0.0.1) in Chromium. The rule that follows: open HA by a `example.com` name everywhere, Companion
app internal URL included. From `http://homeassistant.local:8123` or `http://192.0.2.53:8123` the frame is
cross-site: no Strict cookie, and a cookie set in it is a third-party cookie Safari drops.

Kiosk and screensaver in a frame: the screensaver never runs framed (`hk-saver.js` `framed`, it only runs as
HK Settings' preview); the HA kiosk request (`base.js`) is Ingress-only. Tablets on the direct address are
unframed and unchanged.

Seen once, not explained: twice the browser pane's Mantel session vanished (server-side sessions intact).
Cookies ignore ports and the pane's profile is shared with other sessions, one of which runs a Mantel on
127.0.0.1:8765, so its `mantel_session` cookie most likely replaced mine. A clean run afterwards kept the
session through reloads. On the house (separate names) this cannot happen.

## Step 2: facts from the scratch HA (2026.9.4)

1. **A Webpage dashboard can be a default dashboard.** Profile → User preferences → Dashboard lists it
   (alongside Lovelace and the built-in dashboards; App/Ingress panels and custom panels such as HK
   Settings are **not** offered, which is why the App's "Mantel" entry cannot be the Companion app's start).
   Picking it made `/` open it, at the top of the sidebar. Stored per user in
   `.storage/frontend.user_data_<user>` as `core.default_panel = "<url_path>"`; "synced across sessions and
   devices", so the Companion app follows. Resolution order in the frontend: user `default_panel`, then
   the system one (`frontend/set_system_data`, key `core`, admin only: Settings → Dashboards "Set as
   default"), then the browser's localStorage.
2. **How they are stored and created.** A Webpage dashboard is an ordinary storage-mode Lovelace dashboard
   whose config is only `{"strategy": {"type": "iframe", "url": "<address>"}}`. Over the WebSocket API:
   `lovelace/dashboards/create {url_path, title, icon?, show_in_sidebar=true, require_admin=false}` then
   `lovelace/config/save {url_path, config: {strategy: {type: "iframe", url}}}`; `lovelace/dashboards/update
   {dashboard_id, title?, icon?, show_in_sidebar?, require_admin?}`; `lovelace/dashboards/delete
   {dashboard_id}` (`dashboard_id` is `url_path` with `-` → `_`). `url_path` must contain a hyphen. Done by
   script on the scratch HA; the dashboard rendered like the UI-made one.
3. **The App's token can do it.** The create/update/delete and `config/save` commands are admin-only. The
   App's connection runs as the Supervisor's HA user, which HA creates in the admin group
   (`hassio/__init__.py`: `async_create_system_user(..., group_ids=[GROUP_ID_ADMIN])`), and the App already
   uses admin-only calls on the house (`config/auth/list` for the first Owner). Not tried on a real
   Supervisor. It **cannot** set a person's own default dashboard (`frontend/set_user_data` writes the
   caller's data only); it could set the system default.
4. **Who sees it.** HA has only `require_admin` (admins only) and `show_in_sidebar`; hiding per person is each
   person's own sidebar edit. Mantel still decides what anyone sees inside: a person not signed in to
   Mantel gets Mantel's sign-in page in the frame.

## Step 3: design (the switch is built: "Built", below)

### "Add to Home Assistant" on a screen's settings page

Where: the screen's own page in the merged Settings (`merged-settings-design.md`). HK's panel code is shared
with the HA build and must hold no Mantel words, so the row comes from the host: a new optional
`settingsHost().screenRows(screen)` (HA's shell never sets it), drawn with HK's kit under the screen's
existing rows. Shown to Owner/Admin, only when direct access is on (`public_url` known) and HA is connected.

The row: a switch **Show in Home Assistant**, and when on: Title (default the screen's name), Icon (default
`mdi:fireplace`), **Who sees it in HA**: Everyone / HA administrators only (`require_admin`), and a line
"Open it at <ha address>/<url_path>; make it your start page in HA under Profile → Dashboard".

Server (Mantel, the App and Docker alike):
- `GET /api/admin/ha-dashboards`: HA's `lovelace/dashboards/list` + each candidate's `lovelace/config`,
  keeping those whose strategy is `iframe` and whose URL is this Mantel's `public_url` + a screen. HA is the
  only record (nothing stored in Mantel), so a dashboard renamed or deleted in HA shows as such.
- `PUT /api/admin/screens/<key>/ha-dashboard {on, title, icon, require_admin}`: create
  (`url_path` = `mantel-<key without "dashboard-">`, e.g. `mantel-loft`; a taken path gets `-2`; never
  `dashboard-*`, which HK-in-HA already uses), or update, or delete. The URL written is always
  `public_url + <key>/home`, never one from the request.
- Owner and Admin, same-origin + CSRF like the rest of `/api/admin`, audited (`ha_dashboard.add/update/remove`
  with the url_path). It changes HA's configuration, not the house, so `commands_enabled` does not gate it.
- Errors in words: HA not connected; the connection is not an HA administrator (a Docker install's token of
  a non-admin user): "add it in Home Assistant yourself: Settings → Dashboards → Webpage, <url>"; direct
  access off.
- Optional, separate button for Owners: "Make this Home Assistant's start page for everyone"
  (`frontend/set_system_data core.default_panel`). Off by default; per person stays in HA's Profile.

Also worth having: a check on the Connections → HTTPS page that `ha_frame_origins`/`ha_sign_in_url` covers
the address HA is opened at (the page can see its own `ancestorOrigins` when framed).

### Built (branch `ha-dashboards`)

| Piece | Where |
|---|---|
| `GET /api/admin/ha-dashboards`, `PUT /api/admin/screens/<key>/ha-dashboard` as designed above | `mantel_server/ha_dashboards.py` |
| The row on a screen's page: Show in Home Assistant; when on Title, Icon, Who Sees It, the Profile → Dashboard line | `web/shim/mantel-settings.js` (`drawHaDashboard`) |
| The panel's hook: the existing generic `settingsHost().extend(where, c, ctx, panel)` with `where` `'screen'` (ctx `{screen, title}`, after This Device), not a new `screenRows`: the same shape the tablet page's Direct Connection already uses; HA's shell sets no host, so HK in HA draws nothing | `web/hk/panels/hk-settings.js` |
| HTTPS and Your Proxy → **Home Assistant's Frame**: the allowed origins (`frame_ancestors` in the summary), each of HA's own `internal_url`/`external_url` (`get_config`) and the page's own frame (`ancestorOrigins`) marked OK or Fix, and a field to check any address; the fix named (`ha_frame_origins`, or `--frame-ancestors` outside the App) | `mantel-settings.js` (`drawFrames`), `proxy_check.summary` |

Decisions made while building:
- **What the connection may send** is pinned by `ha_dashboards.check_frame` (its own short socket per request on
  `cfg.ws_url` and the Connections credential, never the hub's or the command path): `auth/current_user`,
  `get_config`, `get_panels`, `lovelace/dashboards/list`, `lovelace/config`; `create` only as `mantel-…`;
  `config/save` only of an iframe strategy at `public_url` + a screen, and only for a dashboard it just created;
  `update`/`delete` only of a dashboard read in the same connection whose config frames this Mantel.
- **Ours** is any storage dashboard whose config is exactly that iframe, wherever it came from: one made by hand
  in HA counts, and turning the switch off removes every dashboard of that screen.
- `url_path` is checked against HA's dashboards **and** its panels (`get_panels`): HA refuses a path a panel has.
- A failed `config/save` deletes the dashboard just created (no empty one left in the sidebar).
- "Direct access on" is `public_url` set, not `ingress.invalid` (the App's Ingress-only placeholder), and in the
  App also a direct port.
- Changes are one at a time (a lock): a double tap makes one dashboard.
- The page re-reads HA when a screen's page is drawn more than 30 s after the last read, so a rename in HA shows
  on the next visit (or a reload).
- The HTTPS check cannot see a refused frame: HA sends `Referrer-Policy: no-referrer` and the browser refuses
  the frame after Mantel answered, so Mantel never learns which HA address tried. Hence HA's own URLs, the
  page's own frame and a typed address. On the house that means hasslocal shows as Fix only if it is HA's
  internal URL, or typed in.
- Not built: the Owner's "start page for everyone" button (`frontend/set_system_data`), optional in the design.

Verified in the browser pane against the scratch HA (`tools/testha`, 127.0.0.1:8124, 2026.9.4) and a local Mantel
(127.0.0.1:8773, `public_url` its own address, `--frame-ancestors http://127.0.0.1:8124`): the switch made
`mantel-hk-wall` (fireplace icon) and HA's sidebar showed it, the screen live in the frame after Mantel's
sign-in; renamed in HA (`lovelace/dashboards/update` as HA's own dialog sends it) Mantel showed "In its sidebar
as Living Room Wall"; Who Sees It saved `require_admin`; off (with its confirm) removed it from HA's sidebar;
HTTPS page: HA's internal URL `localhost:8124` Fix, external `127.0.0.1:8124` OK, a typed address Fix. Not tried
on a real Supervisor (the App's connection as HA's admin is from step 2's reading of HA's code).

### Alternative: a Lovelace dashboard through HK in HA (linked mode)

HK Frontend in HA already draws HK screens as real Lovelace dashboards (`dashboard-loft`), which the
Companion app can open by default with HA's own sign-in and no frame. In linked mode (phase5/LINKED-MODE.md)
those dashboards forward HK's actions and mirrored entities to Mantel. That gives HA-native screens, no second
sign-in, and works from HA's IP or `homeassistant.local`, but it is HK's code inside HA's frontend, not
Mantel's page: Mantel-only parts (its roles per person, the MA engine's page, Mantel's menu and settings) are
missing or differ, and linked mode is not yet on at the house (HK's Configure refuses the App's plain-http
address today, HA-APP.md). An iframe of the App's Ingress URL is no shortcut: Ingress needs the session
cookie HA's App panel makes, which a Webpage dashboard never gets.

Recommendation: the Webpage dashboard (step 1 + the switch) for "Mantel in the Companion app"; keep linked
mode as the route to retire HK-in-HA, not as this feature.

## To ship (needs Avery's OK)

1. ~~Merge `ha-frame-origins`~~ (in 0.1.18). Merge `ha-dashboards`; bump the App and stage it.
2. House App options: `ha_frame_origins: https://hasslocal.example.com` (hassiot comes from
   `ha_sign_in_url`); HTTPS and Your Proxy → Home Assistant's Frame then shows both OK. Companion app: internal
   and external URL both `example.com` names.
3. In Mantel Settings → the Loft's page → Show in Home Assistant (or by hand in HA: Settings → Dashboards →
   Webpage → `https://mantel.example.com/dashboard-loft/home`); then Profile → Dashboard. Check on an
   iPhone (Safari and the Companion app) at home and away; away goes
   through the Cloudflare tunnel, so the tunnel rules apply in the frame.
