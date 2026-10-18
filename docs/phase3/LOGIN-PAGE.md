# Phase 3: the sign-in page (`/login`) — 2026-10-18

**Built and tested offline.** Mantel now has its own sign-in page, the prerequisite for wall tablets
and for people at cutover. It drives the sign-in APIs P3.1 already built ([ACCOUNTS.md](ACCOUNTS.md));
it adds no new way to sign in and no new check. No real Home Assistant was contacted.

## What the page offers, in this order

1. **Passkey**, shown only when the browser has WebAuthn. Discoverable: the page sends
   `POST /api/auth/passkey/options {}` with **no user name** (so the page never reveals which accounts
   have passkeys), then `navigator.credentials.get`, then `POST /api/auth/passkey/verify`.
2. **User name + password** (`POST /api/auth/password`). When the server answers `{next: "totp",
   pending}` the page swaps to a 6-digit code step (`POST /api/auth/totp/verify`); *Back* returns to
   the password. The pending token lives only in a JS variable.
3. **Sign in with Home Assistant**: a plain link to `login/ha` (works without JavaScript), the OAuth
   start that `GET /login` used to be. The callback (`/auth/callback`), state cookie and token handling
   are unchanged.

On success the page goes to `next` (below) with `location.replace`.

## Messages

| Server answer | The page says |
|---|---|
| `401 invalid_credentials` (unknown name, wrong password, disabled — all alike) | "That user name and password did not match." Never which part, never whether the name exists. |
| `429 too_many_attempts` + `retry_after` | "Too many tries. Try again in N seconds/minutes." |
| `403 second_factor_required` (tunnel door) | with `methods: ["passkey"]`: use your passkey instead (focus moves to it); else: this account has no passkey or authenticator app yet, sign in at home or with HA. |
| `invalid_code` | the code was not accepted (stays on the code step) |
| `pending_invalid` (expired, 5 tries) | "That took too long. Enter your password again." (back to the password step) |
| passkey 400/401 | "That passkey was not accepted." Cancelled prompt: says so. |
| `origin_not_allowed_for_passkeys` | passkeys need the hostname, not an IP |
| network failure | "Could not reach Mantel." |

On the tunnel door the page says up front that a password alone is not enough there
(`<meta name="mantel-door">`, from `sessions.door_of`).

## `next`: where to land

`login_page.safe_next` (Python) and `safeNext` (login.js) apply the same rules, and a test runs both
on one table: only RFC 3986 URL characters (no space, control, backslash, quote, `<>`), exactly one
leading `/` (no `//`, so no scheme-relative URL), no scheme or host, no `.`/`..` segments, at most
1024 characters, and not `/login…`, `/logout`, `/auth/…`, `/api/…` or `/ws`. Anything else becomes
the default screen, `/home` (which goes on to `/<default_screen>/home`).

* The server cleans `?next=` and puts it in `<meta name="mantel-next">` (escaped); the page cleans it
  again before navigating.
* Through HA sign-in, `next` rides in a cookie `mantel_login_next` (HttpOnly, Lax, path `/auth`, 10
  min) and is cleaned again at the callback; the callback page's refresh goes there (was `/dev`).
* A signed-out browser asking for a page is sent to `/login?next=<that page>`: `/dev`, `/home`,
  `/admin`, and any GET that is a document navigation (`Sec-Fetch-Dest: document`, or `Accept:
  text/html` without that header). APIs, scripts and the WebSocket still get a plain 401.
* A person already signed in who opens `/login` is sent straight to `next`. A wall tablet on its own
  (device credential, no person) gets the page, so a person can sign in at it.

## Files and routes

| | |
|---|---|
| `mantel_server/login_page.py` | `GET /login` (page), `GET /login/{login.js,login.css}`, `GET /webauthn.js`; `safe_next`, `login_url`. Wired in `server.build_app` before `admin_page`. |
| `mantel_server/auth.py` | `GET /login/ha` (OAuth start, keeps `next`), the callback lands on `next`, the middleware's signed-out redirects carry `next`. |
| `static/login/index.html`, `login.js`, `login.css` | the page; `login.js` exports its pure parts (`safeNext`, `messageFor`, `retryText`, `baseFrom`, `signIn`) for tests. |
| `static/webauthn.js` | the WebAuthn JSON ↔ ArrayBuffer helpers, **moved out of admin.js** and shared: both `/login/login.js` and `/admin/admin.js` import `../webauthn.js`, which is the URL `/webauthn.js` and also the file next to them on disk. |

**CSP**: the page and its assets are served with `default-src 'none'; script-src 'self'; style-src
'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self';
frame-ancestors 'none'` (as `/admin`), and are compatible with Caddy's site-wide CSP. No inline
script, handler or style. Without JavaScript only the HA link is visible; the password form is
`hidden` and `method="post"`, so a password can never end up in a URL.

**HA App mode (Ingress)**: HA has already signed the person in, so every `/login` path (`/login`,
`/login/ha`, the assets) is refused through Ingress with ingress.py's "Signed in by Home Assistant"
page; no session starts. Outside Ingress (when `ingress_only` is off) the page works as usual. The
page uses only relative URLs and reads `<meta name="mantel-base">` with web/shim/base.js's rule, so
it does not assume it sits at the root.

**Accessible**: real `<label>`s, `autocomplete` (`username`, `current-password`, `one-time-code`),
`inputmode="numeric"` for the code, errors in a `role="alert"` region, `aria-invalid` on the fields,
`aria-busy` while waiting, focus moved to the field that needs attention, 48 px targets (56 px on
wall-tablet sized screens), safe-area padding, light and dark from the same tokens as `/admin`.

## Tests

`tests/test_login_page.py` (62): the page and assets, relative URLs and order, CSP and no inline
script/handler/style, banned DOM/storage APIs in the scripts, the package data, the shared WebAuthn
module; the `next` table in Python and **the same table through login.js in node**; escaping;
signed-out redirects; signed-in and wall-tablet visitors; password→TOTP and passkey flows through
the page's endpoints (fictional users, the software authenticator from `test_passkeys.py`), tunnel
refusal and passkey on the tunnel, generic errors for unknown vs. wrong, 429 `retry_after`, JSON and
Origin still required; login.js's messages and its `signIn()` flows against a fake server and a fake
authenticator; and **login.js's `signIn()` run in node against the real test server** (password, wrong
code, right code, session `password+totp`). `tests/test_auth.py` +4: `next` through HA sign-in, never
off-site (bad values and a planted cookie), the canonical-host hop keeps it, the page's HA link.
`tests/test_ingress.py` +1 and an extended refusal test. Changed on purpose: the OAuth start is
`/login/ha`; the callback lands on `/home` by default; signed-out redirects carry `?next=`.

Checked by hand in a browser against a local server with a fictional user (phone width dark, tablet
width light): wrong password message, then a correct one landing on `next=/admin`; a signed-out
dashboard URL sent to `/login?next=…`.

## Not done

* Conditional mediation (passkeys offered in the user-name field's autofill) — a later nicety.
* ~~`POST /api/auth/passkey/options {username}` returns that user's credential ids~~ fixed (`8a2ea4a`):
  the user name is honoured only for that same signed-in person (admin step-up); signed out the request
  is always discoverable, and registration now requires a discoverable credential.
* `tools/headless/admin_page_check.py` was updated for the new redirect but not re-run here; no
  headless check of `/login` yet.
