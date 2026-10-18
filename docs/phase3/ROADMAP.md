# Phase 3: Mantel Server core — roadmap (2026-10-18)

PLAN.md §9, Phase 3: "Image, Caddy, SQLite, HA-account linking + Sign in with HA, HK accounts,
passkeys/TOTP, device enrollment, roles and grants, command gateway, audit, HA + MA + go2rtc
connectors, settings import from the config entry; the LXC script and compose file." Security
model: PLAN.md §5 (roles, grants, step-up) and §7 (identity, sessions, secrets, container).

Today's server (`hosts/server/mantel_server/`, ~1,800 lines) is the Phase 0 proof: a read-only
state hub, Sign in with HA, linked roles, and the dry-run permission gate (`proof2.py`).

## Ground rules for every Phase 3 slice

- **Mantel sends no command to the house's real devices until Avery approves it at cutover.** The
  gateway is built and tested end to end against the scratch HA (`tools/testha/`, `demo` devices on
  127.0.0.1:8124) and fakes. Commands are off by default (`commands.enabled = false`). Turning them
  on is per server, in the config file only; no client message can switch it.
- **One module per concern**, each with `register(app, hub)` (routes, WebSocket message types) and
  no edits to another slice's module, so slices run in parallel. `server.py` only calls the
  `register` functions; the orchestrator does that wiring.
- **The database:** `mantel_server/db.py` (P3.1) owns the SQLite connection and numbered migrations.
  Every slice that stores something adds its own migration file `mantel_server/migrations/NNNN_<name>.sql`.
- **Secrets** come from files (Docker secrets / `~/.config/mantel/…`), never env vars, the repo or
  logs. Secrets at rest (TOTP seeds, device keys) are encrypted with a key from a secret file.
- **Tests** use temp databases, fictional users and fakes. The e2e gateway tests use the scratch HA only.
- **Dependencies:** pure Python, pinned in `pyproject.toml`; they install into `~/.venvs/mantel`.
  Proposed: `argon2-cffi` (passwords), `cryptography` (secrets at rest, WebAuthn), `webauthn`
  (passkeys). TOTP is plain stdlib.

## Slices

| # | Slice | Module(s) | Depends on |
|---|---|---|---|
| P3.1 ✅ | **Data layer, accounts, sessions, devices.** Done (`docs/phase3/ACCOUNTS.md`). Migrations framework. Users (HK accounts and HA-linked), Argon2id passwords with lockout/rate limits, TOTP, passkeys (WebAuthn register/assert), sessions as a short access token plus a rotating refresh token in `HttpOnly; Secure; SameSite=Strict` cookies (reuse detection revokes the family), CSRF for state-changing REST, device enrollment ("make this a wall tablet": device credential bound to the browser, rotated, revocable, refused on the tunnel door), the first-Owner bootstrap. Existing HA sign-in and links migrate in. | `db.py`, `migrations/`, `accounts.py`, `sessions.py`, `devices.py` | — |
| P3.2 ✅ | **Roles and grants (RBAC engine).** Done (`docs/phase3/RBAC.md`, merge `fc38889`). PLAN §5: the role set, `action × resource` grants (actions `view`, `control`, `control.sensitive`, `history`, `configure`; resources entity/domain/area/floor/feature), deny by default, explicit deny wins, schedules (time windows), user ∩ device intersection, sensitive defaults, step-up requirement. Read filter for the state hub (a client only sees what it may `view`) and for proxies. Pure engine plus a storage adapter over P3.1's db. | `rbac.py`, `migrations/…_rbac.sql`, `view.py` filter hook | P3.1 (storage only) |
| P3.3 ✅ | **Command gateway.** Done with the server wiring (`docs/phase3/GATEWAY.md`, merge `3e5f1c9`); e2e against the scratch HA 24/24. The Mantel client's `actions.callService` / write `callWS` / `request` become server `command` messages. The gateway resolves user + device from the session, classifies the command (service, or a write type from `hkClient.WRITES` exported as JSON, so there is one catalog), checks RBAC, asks for step-up when needed (PIN / passkey, fresh within ~5 min), writes the audit row first (append-only; failure closes the request), then forwards with Mantel's HA credential. Off unless `commands.enabled`. E2E against the scratch HA. | `gateway.py`, `ha_client.py` (a command path behind the switch), `web/shim/mantel-client.js` actions | P3.1, P3.2 |
| P3.4 ✅ | **Connectors.** Done (`docs/phase3/CONNECTORS.md`). Music Assistant's own WebSocket API (long-lived token; queue, library, playback reads; commands through the gateway), camera WebRTC signaling and ICE config proxied to HA (as today's cards do), and the read proxies (history, logbook, statistics, calendars, forecasts, energy prefs, media browse) with RBAC applied. | `connectors/ma.py`, `connectors/camera.py`, `readproxy.py` | P3.2 (filters) |
| P3.5 ✅ | **HK settings in Mantel.** Done (`docs/phase3/SETTINGS.md`); uses hk_core's real model (`188b30b`); wired into the server (`199f71f`). The settings store (versioned, with history, per-user scope where §5 says), the API the frontend's settings feed and HK Settings panel use (the `hk_frontend/settings/*` / `panel/get` shapes), and the one-time import from HA's config entry. Retires the smoke's stand-in for `hk_frontend/panel/get`. | `settings_store.py`, `migrations/…_settings.sql` | P3.1 |
| P3.6 ✅ (static) | **Packaging.** Done as files + static checks (`docs/phase3/PACKAGING.md`, merge `e754006`); image build/run waits for Docker. Dockerfile (multi-stage, slim, non-root, read-only root fs, healthcheck), compose (caddy, mantel-server, optional cloudflared, go2rtc + the transcode), Caddyfile (LAN TLS, headers, CSP), the LXC script (`packaging/lxc/mantel.sh`, community-scripts layout, unprivileged, `var_gpu`), the HA App config, secret files, a `/healthz` route. **Building or running the image needs Docker on this Mac or a host, which Avery has to install.** | `packaging/…`, `health.py` | — |
| P3.7 | **Wiring and the e2e run.** `server.py` registers every slice. The full suite runs, plus an e2e: Mantel against the scratch HA, sign in as fictional users of different roles, a tablet device, read filtering, a command allowed/denied/step-up, audit rows. | `server.py`, `tools/e2e/` | all |

## Exact continuation point

P3.1, P3.2 (engine), P3.4 and P3.6 start in parallel. P3.3 and P3.5 follow P3.1 (and P3.3 follows
P3.2). P3.7 closes the phase.
