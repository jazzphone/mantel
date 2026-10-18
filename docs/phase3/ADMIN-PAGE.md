# Mantel Server's admin page (`/admin`) — 2026-10-18

One page for the household's owner to run Mantel Server from a phone or a laptop: **who can sign in, which
tablets are enrolled, what each role may do, which machines hold a credential, and what happened** (the audit).
It is only a UI over management APIs that already exist (`ACCOUNTS.md`, `RBAC.md`, `PINS-AUDIT.md`,
`docs/phase5/LINKED-MODE.md`); the server still decides every request. Built and checked offline on fictional
users; no Home Assistant was contacted.

## Files

| File | What |
|---|---|
| `hosts/server/mantel_server/admin_page.py` | `register(app, hub)`: `GET /admin`, `GET /admin/{admin.js,admin.css}`, and the one read added, `GET /api/admin/overview` |
| `hosts/server/mantel_server/static/admin/index.html`, `admin.js`, `admin.css` | The page: static HTML, one ES module, one stylesheet. Vanilla JS, no framework, no inline script, handler or style |
| `pyproject.toml` | package-data gains `static/admin/*` |
| `tests/test_admin_page.py` (18) | Who is served, CSP hygiene, the overview per role |
| `tools/headless/admin_page_check.py` | Drives the page in isolated headless Chrome (below) |

## Serving, sign-in and CSP

* `/admin` is added to `app["public_paths"]` so the handler can send a **signed-out browser to
  `/login?next=/admin` (302)** instead of the middleware's bare 401 (the sign-in page brings them back:
  [LOGIN-PAGE.md](LOGIN-PAGE.md)). The passkey helpers now live in `static/webauthn.js` (served at
  `/webauthn.js`, imported as `../webauthn.js`), shared with the sign-in page. Everything else (`/admin/admin.js`, `/admin/admin.css`,
  `/api/admin/overview`) stays behind the normal sign-in (signed out: 401).
* A **wall tablet on its own** gets a short 403 page (a person signs in on top of a tablet to manage anything,
  and then only "Me" shows: the person ∩ tablet rule leaves nothing to configure).
* Every response carries `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  `Cache-Control: no-store`, `nosniff`. Because the page is all external files and sets no `style` attribute,
  it also meets **`style-src 'self'`**, stricter than the Caddyfile's global policy (PACKAGING.md). Tests
  scan the HTML and JS: no inline script, `on…=`, `style=`, `<style>`, `innerHTML`/`eval`/`document.write`,
  `localStorage`/`sessionStorage`; all data is drawn with `textContent`.
* Nothing is stored in the browser. A new service credential lives in one DOM node until "I have saved it".
* State-changing calls send `X-CSRF-Token` (from the overview, the same token `/api/session` gives).
  A plain 401 sends the browser to `/login`.

## The one added read: `GET /api/admin/overview`

The existing reads did not say whether *I* have TOTP, which sections *I* may use, or what the forms offer.
It returns, for a signed-in person: `user` (`accounts.describe`: role, kind, `totp`, `passkeys`,
`has_password`, `ha_user_id`), `door`, `csrf`, `fresh_factor_at`, `now`, `at_tablet`, `sections`, and the
lists the forms use (`roles`, `device_roles`, `actions`, `resource_kinds`, `features`, `service_scopes`).
**`sections` is computed with the same checks as the routes behind each section**, so a section is hidden
exactly when its API would refuse (the API still refuses on its own; an Adult's `/api/users` is 403 with the
page open, checked in the headless run):

| Section | Shown when | The check it mirrors |
|---|---|---|
| Me | any signed-in person | `/api/sessions`, `/api/auth/*`, `/api/account/pin`: own account |
| People | Owner or Admin | `accounts.require_manager` on `/api/users` |
| Devices | Owner or Admin | `accounts.require_manager` on `/api/devices` |
| Roles & grants | Owner | `rbac_store`'s Owner-only REST |
| Service accounts | Owner, on the LAN door | `service_accounts._owner` (Owner, own session, LAN) |
| Audit | `configure` on feature `audit` (Owner and Admin by default) | `GET /api/audit` through `Authz.decide`; a role override that grants it to an Adult shows the section (tested) |

A person at a wall tablet (user + device) always gets just Me. Unknown or hidden sections in the address
(`/admin#people` for an Adult) fall back to Me.

## What each section does (APIs used)

**Me**
* *My sessions*: `GET /api/sessions` (browser, door, method, address, started, last seen), revoke with
  `DELETE /api/sessions/{id}` (revoking this browser signs out).
* *Passkeys*: `GET/DELETE /api/auth/passkeys`, add with `POST /api/auth/passkey/register/options` → the
  browser's WebAuthn → `…/register/verify`. Needs a host name, not an IP (the server says so).
* *Authenticator app (TOTP)*: `POST /api/auth/totp/enroll` (shows the secret and an `otpauth://` link; no QR
  library, so no third-party code), `…/enroll/confirm {code}`, `DELETE /api/auth/totp`.
* *My PIN*: `GET/PUT/DELETE /api/account/pin`, 4 to 8 digits, typed twice (client check first; the server's
  rules, lockouts and "nobody else can have this PIN" still decide).
* **Step-up.** PIN set/remove, TOTP replace/remove and passkey removal need a factor within five minutes
  (`step_up_required`). The page catches that 403, asks "Confirm it is you" (TOTP code, or "Use a passkey" →
  `/api/auth/passkey/options` + `/verify`), then repeats the request once. With neither factor it tells the
  person to sign in again.
* *Sign out*: `POST /api/session/logout`.

**Connections** (Owner/Admin may look; only an Owner changes; added 2026-10-18, `connections.py`). How Mantel
reaches Home Assistant and Music Assistant, so nobody handles token files. The section is second in the bar and
**the page opens on it while Home Assistant is not set up** (`ha_set_up: false` in the overview: the first run).

* *Status*, per connection (`GET /api/connections`): where it comes from (**Saved in Mantel**, **Set by the
  installation**, **Provided by Home Assistant (App)**, or not set up), the address, "connected as
  `<HA/MA user>` (administrator), since …", how (HA sign-in, pasted token, MA sign-in) and by whom, the live state
  (connected, version, entity count, or the last error in words) and, for MA tokens, when they expire. A token is
  **never** shown again: no answer from the server contains one.
* *Home Assistant*: the address, then either **Connect to Home Assistant** (HA's own sign-in page; sign in there
  **as the user Mantel should act as**, a dedicated administrator such as `mantel-server`, not yourself; back on
  the page Mantel shows who it would act as, HA's version and the entity count, and **Save this connection**
  makes a long-lived token for that user, named `Mantel Server (<date>)`, and revokes the short sign-in), or
  **paste a long-lived token** (Test, Save). A non-administrator is accepted with a warning (importing HK's
  settings and listing HA's users need an administrator).
* *Music Assistant*: the address, then a Music Assistant **user name and password** (MA 2.7+: used once for
  `auth/login` and `auth/token/create`, kept nowhere) or a pasted token (Test, Save). MA's tokens last a year.
* **Test** runs the live check and saves nothing; **Save** tests again and saves only if it passes. Errors are
  plain words: the address is malformed, nothing answers there, something answers but is not HA/MA, the token
  was refused, the certificate does not match, it timed out.
* **Replace** opens the same form. **Disconnect** removes *Mantel's* saved copy (confirm first): Mantel then goes
  back to the installation's file if there is one, or HA/MA is not set up. A connection that comes only from the
  installation's file cannot be disconnected here (`409 set_by_installation`, with the file named).
* **Who**: Owner on the home network; on the tunnel door a fresh factor (the usual "Confirm it is you" step-up);
  through HA's sidebar HA's sign-in counts when the sidebar is trusted (`ha_door_rules: trusted`). Admins see the
  status read-only. Every change writes an audit row first (`config`, `connection.ha.saved` / `…disconnected`,
  with the address and the HA/MA user, never the token); no audit, no change.
* **HA App mode**: the Home Assistant panel reads "Provided by Home Assistant (App)" and has no form (the server
  refuses changes with `409 provided_by_app`); Music Assistant is editable.
* **Takes effect at once**: no restart. Mantel's HA objects are retargeted in place and reconnect; pages open on
  tablets keep their socket to Mantel and simply receive the new states. MA's connector is built, moved or
  removed the same way.

REST: `GET /api/connections`; `POST /api/connections/{ha|ma}/test` and `POST /api/connections/{ha|ma}`
(`{url, token}`, or for MA `{url, username, password}`, or for HA `{pending}`); `DELETE /api/connections/{ha|ma}`;
`POST /api/connections/ha/oauth/start {url}` → `{authorize_url, pending}`; HA returns the browser to the public
`GET /auth/connection/callback` (no session cookie travels on that hop: the one-time `state` names the pending
sign-in an Owner started; nothing is saved there) which sends it on to `/admin?connection=<id>#connections`;
`GET`/`DELETE /api/connections/pending/{id}` (only the Owner who started it). Pending sign-ins live ten minutes in
server memory; their refresh token is revoked when cancelled, expired or saved.

**Where the token lives.** `<data-dir>/connections/{ha,ma}.connection`: folder 0700, files 0600, AES-GCM sealed
with the at-rest key (associated data `connection:<kind>`), in every encrypted backup (`connections/` tree) and
put back by a restore. Inside the container stacks that is `/data/connections` on the data volume, because the
installation's `/run/secrets` is a read-only mount. **Precedence: Mantel's saved copy wins over the
installation's file** (`--token-file` with `--ha-url`, `--ma-token-file` with `--ma-url`; an empty file counts as
none), so "Replace" on an installed connection simply writes Mantel's copy; removing that copy goes back to the
file. If the at-rest key changes, a saved copy cannot be opened: the page says so and the server runs on.

**People** (Owner/Admin): `GET /api/users`; create a Mantel account `POST /api/users` (an Admin cannot offer
Owner); change a role or disable/enable `PATCH /api/users/{id}` (the server refuses to remove the last Owner;
an Admin cannot touch an Owner, so those rows have no controls; you cannot disable yourself here); clear
someone's PIN `DELETE /api/users/{id}/pin`. *Home Assistant users* lists linked users (`ha_user_id`) and says
how to link: there is **no REST to link an HA user**, so the page shows the CLI
(`mantel-server link --ha-user-id <id> --role adult --name "…"`, `unlink`, `links`) and that an unlinked person's
sign-in page shows their HA user id. (An endpoint would be the natural follow-up; none was added, per the brief.)

**Devices** (Owner/Admin): `GET /api/devices` (name, room, role, last seen, address, enrolled, revoked and why),
revoke `DELETE /api/devices/{id}`. *Make this browser a wall tablet* `POST /api/devices/enroll`: name, room,
role; confirms first, LAN only (hidden on the tunnel); the person is signed out of that browser by the server
in the same response, so the page then shows "This browser is now a wall tablet" with a link to `/home` and
stops calling the API.

**Roles & grants** (Owner): *Roles* shows `GET /api/rbac/roles` read-only (grants in words, the four switches,
"changed" if overridden; role overrides are not editable here). *Grants*: `GET/POST /api/rbac/grants`,
`DELETE /api/rbac/grants/{id}`; the form builds effect, actions, resource kind (entity, domain, area, floor,
feature, all; a feature picker for `feature`), optional domains, **one** target (a role, a person or a wall
tablet; add the grant again for more), optional schedule (daily window in house time, weekdays, from/until
dates in the browser's clock) and a note. Every change is audited by the server before it applies.
*Rooms*: `GET/PUT /api/rbac/scopes/{user|device}/{id}` with the area list from `/api/areas` (ticking rooms for a
Child, a Guest or a tablet; unknown stored names stay ticked so a save never drops them). Out-of-order
answers are dropped (a test found the race).

**Service accounts** (Owner, LAN): `GET /api/service-accounts`, create `POST` (name + scopes; the credential
is shown **once** with Copy and "I have saved it", with where to paste it for HK Frontend), revoke `DELETE`.

**Audit** (Owner/Admin): `GET /api/audit` with filters for who, tablet, decision, kind, from/to and rows per
page (25/50/100), newest first, Newer/Older paging with the server's `next` cursor, a shaded edge on denied
and "needed confirmation" rows, ids shown as names when the identity may read the user and device lists, and
the retention window noted. Phone: the table scrolls inside its own box.

## Phone and theme

16 px gutters, 40–44 px touch targets, section tabs scroll sideways inside their own bar, lists are cards,
forms are one or two columns; light and dark follow `prefers-color-scheme` (tokens on `:root`). The headless run
asserts no sideways page scroll in any section at 390 px.

## Checks

* `~/.venvs/mantel/bin/python -m pytest -q` → **1452 passed** (`tests/test_admin_page.py`: signed out → 302
  `/login` and 401 for assets and the overview; signed in is served with the CSP; no inline script/handler/style
  and no unsafe DOM use; the module parses (`node --check`); assets are in package-data; a tablet alone is
  refused; sections for all six roles; the overview's shape; the tunnel hides Service accounts; an audit grant
  override shows Audit and `/api/audit` agrees while `/api/users` stays 403; a person at a tablet gets Me only;
  the overview's CSRF token is the one changes need).
* `tools/headless/client_smoke.py` → passed (0 external requests, 0 browser exceptions).
* `tools/headless/admin_page_check.py [--shots DIR]` → passed. In isolated Chrome (390 px, every request pinned
  to the test server; fictional Owner, Adult and a fictional linked HA user), as a person would:
  signed out → 302 `/login`; the Owner sees six tabs; two sessions listed, the other revoked from the page;
  PIN set (a bad one refused client-side), TOTP enrolled and confirmed, then with the session aged the PIN change
  raised **"Confirm it is you"**, a TOTP code was typed and the PIN changed (checked against the Argon2 hash); a
  passkey add on 127.0.0.1 returns the server's refusal in words; a person created, role changed, disabled; the HA
  link instructions shown; a role table of 7; a grant with a schedule added, shown, removed; a person's rooms
  saved; a service credential shown once and revoked (it is not in the database, and not in the DOM after
  dismissal); the audit paged (25 + more), filtered by decision (3 denied), by person and by an empty date range,
  names resolved; a tablet revoked; **this browser enrolled as a tablet** (Owner signed out) and then revoked from
  a fresh Owner session. 0 CSP violations, 0 browser exceptions, 0 blocked/external requests. Then as the Adult:
  one tab (Me), `#people` in the address falls back to Me, `/api/users`, `/devices`, `/rbac/grants`,
  `/service-accounts`, `/audit` all 403, and the Adult set a PIN.
* Screenshots (phone, dark): `/private/tmp/claude-501/-Volumes-data-mantel/97f5b33d-8378-4f3a-82f6-9938003f5053/scratchpad/admin-shots/`
  `admin-me.png`, `admin-stepup.png`, `admin-people.png`, `admin-roles.png`, `admin-service.png`,
  `admin-devices.png`, `admin-audit.png`, `admin-me-adult.png`; desktop width: `admin-people-desktop.png`,
  `admin-audit-desktop.png`.

* Connections (2026-10-18): `tests/test_connections.py` (23: first run, RBAC per role, the tunnel's fresh factor,
  the `ha` door rule, plain errors, save → sealed 0600 file + hot reconnect + audit without the token, replace to
  another HA with an open page that only sees new states, the installation's file shown/overridden/restored,
  disconnect, a restart keeps the saved copy, a damaged file is reported, App mode read-only, the OAuth flow
  against a fake HA auth endpoint (long-lived token made, refresh token revoked, another Owner cannot use it,
  cancel/expiry/refusal), MA token save/replace/disconnect with a live connector, MA sign-in (password kept
  nowhere), backup/restore of the sealed files, the login page's first-start form in node).
  `tools/headless/admin_page_check.py` now opens `/admin` on first run, lands on Connections, tests a wrong and a
  right token against a fictional HA, saves (token not in the DOM or any input afterwards), and saves a
  pending "Connect to Home Assistant" sign-in. `tools/e2e/compose_e2e.py` sets HA up through the page against the
  scratch HA (HA's real login flow).

## Wiring (orchestrator, `server.py`)

One line in `build_app`, after `accounts.register`/`devices.register` (any point before the app starts; it
reads `app["authz"]` only when a request comes in, so it may sit before or after `wire`):

```python
from . import admin_page            # with the other imports
admin_page.register(app, hub)       # /admin + GET /api/admin/overview
```

It adds `"/admin"` to `app["public_paths"]` by itself. The route patterns (`/admin`, `/admin/{name}`) do not
collide with the dashboard catch-alls (`/{seg}/home` is the only overlap: `/admin/home`, which is not an asset).
The packaged image needs `static/admin/*` (pyproject updated). Caddy needs no change. No Dockerfile change.

## Not done / follow-ups

* No REST to link or unlink Home Assistant users (CLI shown instead).
* Role overrides (`PUT /api/rbac/roles/{role}`) are viewable, not editable; a grant names one target at a time.
* TOTP setup shows the secret and an `otpauth://` link, not a QR code.
* Step-up supports TOTP and passkey (the server has no password re-check endpoint); PIN is a factor at a tablet,
  not a step-up for these routes.
* Changing one's own password, and listing other people's sessions (the API supports `?user_id=`), are not in
  the page.
