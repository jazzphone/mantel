# Phase 3 P3.1: data layer, accounts, sessions and devices — 2026-10-18

**Built and tested offline.** Mantel Server now has a migrations-based SQLite layer, its own accounts
(Argon2id passwords, TOTP, passkeys), sessions as a short access token plus a rotating refresh token,
wall-tablet device credentials, and a first-Owner bootstrap. Sign in with Home Assistant lands in a
session of the linked user. The Phase 0 store API, the proof 2 audit and all earlier tests still work.
WebSocket commands stay `commands_disabled`. No real Home Assistant was contacted; tests use temp
databases, temp secret folders and fictional users.

## Modules

| Module | What it owns |
|---|---|
| `mantel_server/db.py` | The connection (WAL, `foreign_keys=ON`, `busy_timeout`, folder 0700, file 0600 created without a wider moment) and the migrations runner. |
| `mantel_server/migrations/0001_core.sql` | P3.1's schema, and the move of the Phase 0 tables into it. |
| `mantel_server/atrest.py` | `SecretBox`: AES-256-GCM for secrets at rest, key from `<secrets_dir>/at_rest.key`. |
| `mantel_server/accounts.py` | Users, passwords, lockout/rate limits, TOTP, passkeys, bootstrap, user management; its REST routes. |
| `mantel_server/sessions.py` | `SessionManager`, `Identity`, `identity(request)`, door and client-IP rules, cookies, CSRF; its REST routes. |
| `mantel_server/devices.py` | `DeviceManager`: enrolment, rotation, reuse detection, revocation; its REST routes. |
| `mantel_server/store.py` | Phase 0's `Store` API, now a thin layer over the above (`link`, `unlink`, `get_link`, `list_links`, `set_name`, `create_session`, `get_session`, `delete_session`, `audit_command`). |

`server.py` changed only to call `sessions.register`, `accounts.register`, `devices.register`
(in that order: the latter two use `app["sessions"]`). `auth.py`'s middleware now resolves
`sessions.identity` instead of Phase 0's lookup.

## Migrations

* Files `mantel_server/migrations/NNNN_name.sql` (four digits, lowercase name). P3.2 adds
  `0002_rbac.sql`, P3.5 `0003_settings.sql`.
* `schema_version(version, name, checksum, applied)` records each file applied. The runner applies
  **every file whose number is not recorded**, in number order, so a slice that merges late still
  runs (tested: 0001 + 0003 applied, then 0002 added and applied once).
* Each file runs in its own `BEGIN IMMEDIATE … COMMIT` together with its `schema_version` row; a
  failure rolls back completely (tested). Do not put BEGIN/COMMIT in a file. After the run,
  `PRAGMA foreign_key_check` must be clean.
* A file edited after it was applied is never re-run: fix forward with a new number. If its stored checksum differs, Mantel compares the database's structure (columns, indexes, foreign keys, triggers, views) with a fresh in-memory build of all migrations: the same structure refreshes the checksums quietly, a different one logs a warning naming the objects that differ.
  Duplicate numbers or badly named files stop the server.
* Roles are validated in Python against `store.ROLES`, not by a SQL CHECK, so P3.2 can make them
  editable (or add a `roles` table and reference it) without rebuilding `users`/`devices`.

### Upgrade from the Phase 0 schema

`0001_core.sql` first creates the Phase 0 tables if missing (so one statement list serves a new
database and an old one), renames Phase 0 `sessions` to `legacy_sessions`, creates the new tables,
then: every `links` row becomes a `users` row (`kind='ha_linked'`, same role, name, created time)
plus an `ha_links` row; every Phase 0 session of a linked user becomes a session (`method='legacy'`,
door `lan`) whose **access-token hash is the old `id_hash`** — both are SHA-256 of the cookie value,
so browsers signed in before the upgrade stay signed in until their old expiry. Sessions of unlinked
users (already useless) are dropped. `command_audit` and its append-only triggers are untouched.
Then `links` and `legacy_sessions` are dropped. Tested with data in all three tables.

## Schema (0001_core)

| Table | Purpose |
|---|---|
| `users` | `id` (random hex), `username` (unique, case-insensitive, NULL for HA-only users), `name`, `role`, `kind` (`hk` / `ha_linked`), `disabled`, `password_hash` (Argon2id PHC string), `failed_logins`, `locked_until`, `webauthn_handle`, timestamps. |
| `ha_links` | `ha_user_id` → `user_id` (unique both ways; cascade on user delete). |
| `totp_credentials` | `seed_enc` (AES-GCM, AAD `totp:<user id>`), `confirmed`, `last_counter` (replay guard). |
| `passkeys` | Credential id (base64url), COSE public key, sign count, transports, name, backed-up flag. |
| `webauthn_challenges` | Server-side challenges: purpose, optional user, expiry 5 min; deleted on first use. |
| `auth_pending` | Password accepted, TOTP owed: hash of a 5-minute single-use token, door, attempts (max 5). |
| `bootstrap_tokens` | Hash of the one-time setup token, expiry 1 h; at most one row. |
| `sessions` | One per sign-in (refresh family): user, door, method, CSRF token, created, absolute `expires`, `fresh_factor_at`/`fresh_factor`, `revoked`/`revoked_reason`, user agent, source IP. |
| `access_tokens` | SHA-256 of access tokens → session, expiry. |
| `refresh_tokens` | SHA-256 of refresh tokens → session, `used` (set on rotation). |
| `devices` | Name, role, room, `enrolled_by`, `secret_hash`, `next_hash`/`next_issued` (rotation in flight), `retired_hash`/`retired_at`, `rotated_at`, CSRF token, `last_seen`, `source_ip`, `revoked`/`revoked_reason`. |
| `command_audit` | Unchanged from proof 2 (P3.3 will add its own audit migration). |

## Identity — the interface for other slices

```python
from mantel_server.sessions import identity, Identity, User, Device

ident: Identity = identity(request)   # resolved once per request, cached in request["identity"]
ident.user        # User(id, name, role, kind, username, ha_user_id) or None
ident.device      # Device(id, name, role, room, ha_user_id=None, ha_name=None) or None
ident.door        # "lan" | "tunnel" | "ha" (HA's sidebar, HA App mode)
ident.fresh_factor_at   # epoch seconds of the last interactive factor (sign-in, passkey/TOTP step-up) or None
ident.fresh_factor      # "password", "password+totp", "passkey", "totp", "ha", "bootstrap", … or None
ident.session_id, ident.csrf
ident.authenticated     # user or device present
ident.fresh_within(300, now)
```

* **Effective identity for RBAC (P3.2) is the pair `(user, device)`**: a wall tablet alone is
  `(None, device)`; a person signed in at a tablet is `(user, device)` and gets the intersection.
* The middleware has already refused anonymous requests (except public paths) and checked CSRF on
  state-changing `/api/` calls, so handlers can call `identity(request)` directly. The legacy dict
  `request["user"]` (`ha_user_id`, `name`, `role`, `user_id`, `device_id`) is still set for Phase 0
  handlers such as `/api/me`.
* A slice that adds sign-in-free routes adds them to `app["public_paths"]` in its `register`.
* Role checks for user and device management are a stand-in (`accounts.require_manager`: Owner or
  Admin; Admins never manage Owners); P3.2 replaces them with `configure` grants.

## Flows

**Password sign-in** (`POST /api/auth/password {username, password}`): rate limits first (per source
IP: 20 failures / 15 min; per submitted account name, real or not: 5 / 15 min), stored lockout
(5 consecutive failures lock a real account for 15 min, survives restarts), then Argon2id verify (a
dummy hash is verified for unknown names so timing does not reveal them). Unknown name, wrong password
and disabled account all answer `401 invalid_credentials`. Then:
* TOTP enrolled → `{"next": "totp", "pending": …}`; finish with `POST /api/auth/totp/verify {pending, code}`.
* Tunnel door and no TOTP → `403 second_factor_required` (`methods: ["passkey"]` if the user has one).
  PLAN §7: on the tunnel a password alone is never enough.
* Otherwise a session (`method: password`).

**TOTP**: RFC 6238, SHA-1, 6 digits, 30 s, ±1 step. A time step can be used once (`last_counter`).
Enrol with `POST /api/auth/totp/enroll` (returns base32 secret and `otpauth://` URI; replacing a
confirmed TOTP needs a fresh factor), confirm with `POST /api/auth/totp/enroll/confirm {code}`.
`POST /api/auth/totp/step-up {code}` refreshes `fresh_factor_at`. `DELETE /api/auth/totp` needs a
fresh factor (≤ 5 min).

**Passkeys**: `POST /api/auth/passkey/register/options` → `{challenge_id, options}`, then
`POST /api/auth/passkey/register/verify {challenge_id, credential, name}`. Sign-in:
`POST /api/auth/passkey/options {username?}` (empty = discoverable credentials), then
`POST /api/auth/passkey/verify {challenge_id, credential}`. User verification is required; the
sign count must go up (clone detection, by the library); the `userHandle` must match the credential's
user. If the caller already has a session of the same user the verify is a **step-up**
(`{"step_up": true}`, `fresh_factor_at` = now) instead of a new session. The RP ID is
`cfg.webauthn_rp_id` (default `localhost`); the expected origin is the request's Origin, accepted
only if its host is the RP ID or a subdomain (an IP origin is refused: WebAuthn forbids IP RP IDs).

**Sessions**: every sign-in sets `mantel_session` (access token, 15 min), `mantel_refresh` (refresh
token) — both `HttpOnly; SameSite=Strict; Path=/` — and `mantel_csrf` (readable by the page).
`Secure` is set whenever the Host is not a loopback name (production is always a real hostname over
Caddy's TLS; the loopback prototype is plain http, where browsers and the aiohttp test client would
otherwise drop Secure cookies). The session ends at an absolute time: **30 days on the LAN door,
12 hours on the tunnel door**, and is **bound to its door**. When the access token has expired the
middleware rotates the refresh token on the spot and the new cookies ride on whatever response
follows (an `on_response_prepare` hook, so redirects, errors and the WebSocket handshake carry them
too); `POST /api/session/refresh` does it explicitly. A refresh token presented again **more than
30 s after it was rotated revokes the whole family** (`revoked_reason = refresh_reuse`); within 30 s
it is a parallel request and is accepted without new tokens. Disabling a user or unlinking an HA
account ends their sessions at once (the user row is read on every request).

**CSRF**: `POST/PUT/PATCH/DELETE` under `/api/` with a session or device credential need
`X-CSRF-Token` equal to the identity's token. Public sign-in endpoints instead require
`Content-Type: application/json` (no form posts) and an `Origin` header (whose value the loopback
middleware already checks). Cookies are Strict, so this is defence in depth. The CSRF token is kept
in clear in the session row: on its own it grants nothing.

**Sign in with Home Assistant**: unchanged up to the callback (state cookie, code exchange,
`auth/current_user`, the user's HA token revoked at once). The callback then creates a session for
the linked user (`method: ha`) on the request's door and answers with a small page that moves on to
`/dev` (`<meta refresh>`), not a 302: Strict cookies set during a navigation that began on HA's site
are not sent on a redirect in the same chain. A disabled linked user is refused.

**Wall tablets** (`POST /api/devices/enroll {name, tablet | room, role?}`): an Owner/Admin (any role except
Owner/Admin, default `wall_tablet`), or a Wall Tablet account for itself (always `wall_tablet`),
turns the current browser into a device. Refused on the tunnel door (`403 lan_only`). The person's
session on that browser is revoked in the same response and `mantel_device` (`HttpOnly;
SameSite=Strict`, 400 days) is set. Its requests then resolve to `user=None, device=…`. The secret
rotates every 24 h: a new one is issued but the old stays valid until the new one comes back (a lost
response never strands a tablet; re-issued after 60 s if unseen); then the old one is retired, and a
retired secret seen more than 60 s later revokes the device (`credential_reuse`). Unused for 90 days
→ refused. A device cookie on the tunnel door is ignored and logged. `DELETE /api/devices/{id}`
(Owner/Admin, or the device itself) revokes at once; `GET /api/devices` lists (never hashes), each
with `hk_tablets` (the HK tablets in its room). The room is one of HK's wall tablets' (`tablet`: its id)
or an HA area, never free text (`400 unknown_room` / `unknown_tablet`; `GET /api/devices/rooms` lists both
for the enrol dialog); `PATCH /api/devices/{id} {tablet | room}` (Owner/Admin) moves a device in place,
audited (`device.room`), its cookie kept. See [../OPERATIONS.md](../OPERATIONS.md) section 5.

**Wall tablets in the HA App** (decision 21, 2026-10-18; [HA-APP.md](HA-APP.md) "Wall tablets through the
App"): each house tablet is already its own HA user (trusted_networks in Kiosk Satellite). An Owner links
that **HA user to a device** instead of a person (People page *Link as a wall tablet*, or `POST
/api/ingress/tablets {ha_user_id, device_id? | name?, room?}`; `DELETE /api/ingress/tablets/{ha_user_id}`;
`GET /api/ingress/tablets` for Owners/Admins; each audited `ingress.link_tablet` / `ingress.unlink_tablet`).
Table `ha_tablet_links` (migration `0012`): `ha_user_id` → `device_id` (UNIQUE both ways), `ha_name`,
`own_device` (a device made for the link is revoked when it is unlinked; an existing LAN-enrolled device is
kept), `created`, `created_by`. An HA user is a person *or* a tablet, never both (linking one way removes the
other in one transaction; the last Owner cannot be turned into a tablet). Through Ingress that HA user then
resolves to `Identity(user=None, device=Device(id, name, "wall_tablet", room, ha_user_id, ha_name), door="ha",
csrf=<the device's CSRF token>)`: no session row and no device secret are ever issued (the secret made at
creation is discarded); the HA user Ingress vouches for on every request is the credential. `Device` gained
the optional `ha_user_id` / `ha_name`; `/api/me` for such a tablet answers as that HA user (HK finds its
tablet by the Tablet User's name). Device credentials remain refused on `ha`, and with `ha_door_rules:
tunnel` a linked tablet is refused (`401 tablet_refused`).

**First Owner**: `mantel-server bootstrap [--data-dir …]` prints a one-time token (valid 1 h; a
new run replaces it) **only while no enabled Owner exists** (an HA-linked Owner counts). `POST
/api/bootstrap {token, username, name, password}` spends the token and creates the Owner in one
transaction (re-checking that no Owner exists), then signs them in. Afterwards it answers `410
bootstrap_closed`. `GET /api/bootstrap` → `{"open": bool}`.

## Endpoints

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/session` | signed in / device | user, device, door, csrf, fresh_factor_at; re-sets `mantel_csrf` |
| POST | `/api/session/refresh` | session | explicit rotation |
| POST | `/api/session/logout` | session | revoke the family, clear cookies |
| GET | `/api/sessions[?user_id=]` | user | own sessions; others' for Owner/Admin |
| DELETE | `/api/sessions/{id}` | user | own, or as Owner/Admin |
| POST | `/api/auth/password` | public | see flows |
| POST | `/api/auth/totp/verify` | public (pending token) | second step |
| POST | `/api/auth/totp/enroll`, `/enroll/confirm`, `/step-up` | user | |
| DELETE | `/api/auth/totp` | user, fresh | |
| POST | `/api/auth/passkey/options`, `/verify` | public | sign-in or step-up |
| POST | `/api/auth/passkey/register/options`, `/register/verify` | user | |
| GET / DELETE | `/api/auth/passkeys`, `/api/auth/passkeys/{id}` | user (delete: fresh) | |
| POST | `/api/account/password {current, new}` | user (no password yet: fresh) | revokes the user's other sessions; audited (`account.password.change`) |
| GET / POST | `/api/bootstrap` | public | |
| GET / POST | `/api/users` | Owner/Admin | create HK users (Admins cannot create Owners) |
| PATCH | `/api/users/{id} {role?, disabled?, name?}` | Owner/Admin | never the last enabled Owner |
| POST | `/api/users/{id}/password {password}` | Owner/Admin, fresh | not an Owner's for an Admin, not your own, not a Home Assistant user's; revokes all their sessions; audited (`account.password.reset`) |
| POST | `/api/devices/enroll` | Owner/Admin/Wall Tablet account, LAN | |
| GET | `/api/devices` | Owner/Admin | |
| GET | `/api/devices/rooms` | Owner/Admin/Wall Tablet account | |
| PATCH | `/api/devices/{id}` | Owner/Admin | audited |
| DELETE | `/api/devices/{id}` | Owner/Admin or the device | |

Phase 0 routes are unchanged except `/login`: `/auth/callback`, `/logout` (POST; now revokes the family),
`/api/me` (same three fields), `/api/proof2/command` (resolves its own session as before; the actor of
an HK user without an HA link is the user id). **`/login` is now the sign-in page** (passkey, password +
TOTP, Sign in with HA) and the HA OAuth start moved to `/login/ha`; the HA callback lands on a safe
`next` (default `/home`). See [LOGIN-PAGE.md](LOGIN-PAGE.md).

## Config

`Config` gains `secrets_dir` (default `~/.config/mantel/secrets`), `lan_session_days` (30),
`session_hours` (now the tunnel lifetime, 12), `access_minutes` (15), `device_rotate_hours` (24),
`webauthn_rp_id` (`localhost`) and `trusted_proxies` (empty: `X-Forwarded-For` is believed only
from these peers). CLI: `--secrets-dir`, `--lan-session-days`, `--rp-id`. The at-rest key file
`<secrets_dir>/at_rest.key` (base64url of 32 bytes) is read on first use and created 0600 in a 0700
folder if missing; building the app never touches it, so tests and the smoke never create one in the
real home folder. Under Docker, mount it as a read-only secret. No secret, token or code is logged.

## Threat notes

* **Database copy**: tokens (access, refresh, device, bootstrap, pending) are SHA-256 only; passwords
  Argon2id; TOTP seeds AES-GCM with a key that is not in the database. A test greps the raw DB and
  WAL files for the seed (raw, base32) and the key: absent. Passkeys store public keys only.
  The audit table's triggers do not stop someone who can replace the file (as proof 2 noted).
* **Ciphertext swapping**: TOTP seeds are bound to their row by AAD (`totp:<user id>`).
* **Stolen refresh token**: rotation + reuse detection revokes the family for both holders.
* **Stolen tablet credential**: useless on the tunnel door; rotation means a copy is detected when
  either holder presents the retired secret; revocable in one call.
* **Password guessing**: per-IP and per-name sliding windows (in memory, reset by a restart) plus a
  stored per-account lockout. Unknown names are limited like real ones, so 429s do not reveal which
  accounts exist. A lockout can be triggered by anyone who knows a user name (accepted: 15 min, and
  passkeys/HA sign-in still work).
* **Door spoofing**: the door comes from `X-Mantel-Door`, which the reverse proxy (P3.6) must set on
  every request and overwrite; any Cloudflare header, or an unknown value, means `tunnel` (fail
  closed). Today's server is loopback only, where a local process could claim `lan`.
* **Login CSRF / cross-site**: Strict cookies, Origin checks, JSON-only public endpoints.
* **Not yet**: Cloudflare Access JWT verification *(update: built, optional: `cf_access.py`, `--cf-access-team`/`--cf-access-aud`)* and the Host allowlist for real hostnames (P3.6);
  HK notifications for new-device sign-ins and lockouts; rate limits shared across processes;
  Sign in with Google/Apple (optional, later).

## Tests

64 new tests (281 total, all passing): `tests/test_db.py` (fresh DB modes/WAL/FK/version, upgrade
from Phase 0 with links, sessions and audit rows, late-merged migrations, rollback of a failed
migration, bad names/duplicates, edited migrations), `tests/test_accounts.py` (password policy,
Argon2id format and defaults, sign-in, lockout, unknown-name limits, per-IP limit, JSON/Origin
requirement, RFC 6238 vectors for SHA-1/256/512, RFC 4226 vectors, window and replay, TOTP enrol and
two-step sign-in, tunnel refusal, seeds encrypted at rest and bound to their row, key file handling,
lazy key, bootstrap once / expiry / replacement / CLI, user management limits, password change),
`tests/test_sessions.py` (hashes only, transparent rotation, reuse revokes the family in the manager
and over HTTP, CSRF required, logout, list/revoke, tunnel lifetime and door binding, disabled users,
the identity interface, WebSocket Origin and `commands_disabled`, door and Secure-cookie policy,
Phase 0 cookie and `/api/me`), `tests/test_devices.py` (enrolment swaps the session, refused on the
tunnel, credential refused on the tunnel, who may enrol which role, rotation with a lost response,
promotion, grace and reuse revocation, revoke, device CSRF, person-at-a-tablet identity),
`tests/test_passkeys.py` (a software P-256 authenticator built from the WebAuthn spec drives the
`webauthn` library end to end: registration, discoverable sign-in, single-use challenges, tunnel
sign-in, wrong origin, wrong RP ID, sign-count regression, foreign credential, missing UV, expired
challenge, IP origin refused, step-up). `tests/conftest.py` holds the shared fixture (temp DB and
secrets folder, fake clock, cheap Argon2 parameters, upstream HA poisoned).

Changed existing tests, on purpose: `tests/test_auth.py` now expects the HA callback's page (not a
302) and `SameSite=Strict` cookies (PLAN §7), a 30-day LAN session (with a transparent refresh after
12 h), and reads token hashes from `access_tokens`. `packaging/mantel-connect/stage.py` copies
`db.py`, `sessions.py` and `migrations/` into the minimal receiver, since `store.py` uses them.

Validation: `pytest -q` 281 passed; `tools/build_ha.py` + `tests/run` all suites green (126 PASS);
`tools/headless/client_smoke.py` passed (0 external requests, 0 browser exceptions,
`commands_disabled`).

## Exact continuation point

* **P3.2** builds on `identity(request)` → `(user, device)` and adds `0002_rbac.sql` (grants may
  reference `users(id)` / `devices(id)` with `ON DELETE CASCADE`); it replaces
  `accounts.require_manager` and `sessions._may_manage` with `configure` grants.
* **P3.3** used `ident.fresh_within(300, now)` and `ident.fresh_factor` for house-command step-up
  (passkey via `/api/auth/passkey/verify` while signed in, TOTP via `/api/auth/totp/step-up`; a PIN
  factor was its to add). Decision 25 (2026-10-18, docs/PLAN.md) removed step-up for house commands;
  the fresh factor remains only for account administration ("confirm it is you"), and its own audit migration (device and user ids instead of `device='unknown'`).
* **P3.5** adds `0003_settings.sql`; per-user scope keys on `users.id`.
* **P3.6** must: set `X-Mantel-Door` (overwriting) in Caddy for each door, list Caddy in
  `trusted_proxies`, widen the loopback Host/Origin allowlist to the real hostnames (cookies then
  become `Secure` automatically), set `webauthn_rp_id` to the LAN/public hostname's registrable
  domain, mount `at_rest.key` as a Docker secret, and verify Cloudflare Access JWTs on the tunnel.
* **Frontend**: the login page is built ([LOGIN-PAGE.md](LOGIN-PAGE.md)); the "Make this a wall
  tablet" button and session/device lists are in `/admin` ([ADMIN-PAGE.md](ADMIN-PAGE.md)).
