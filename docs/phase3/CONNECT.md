# Mantel Connect: guided pairing and an installer (Mantel outside Home Assistant) — 2026-10-18

Mantel can run **as** the Mantel App in HA ([HA-APP.md](HA-APP.md)); then it needs no Connect. When Mantel
Server runs somewhere else (Docker, a Proxmox LXC) and HA's sidebar and Companion app should still reach
it (PLAN §7 "Way 1"), the **Mantel Connect App** is a small HA App that puts Mantel in the sidebar. The
Phase 0 proof did that with a hand-copied key and certificate and a foreground receiver; this replaces it:
an Owner pairs once with a one-time code, and nothing is copied by hand.

## What an Owner does

1. Run Mantel with Connect on: `COMPOSE_FILE=compose.yaml:compose.connect.yaml` in the compose `.env` (the
   LXC script's `var_connect=yes` does it), or `mantel-server --connect` by hand. This adds one published
   TLS port (8766) and nothing else.
2. Stage and install the Connect App on the house like the Mantel App:
   `~/.venvs/mantel/bin/python tools/stage_connect_app.py <local apps share>/mantel_connect`, refresh the App
   store, install **Mantel Connect** from Local apps.
3. **Pair.** In `/admin`, **Connect**, **Start pairing** (or `docker compose exec mantel-server mantel connect pair`)
   shows a code like `5VRK2-JW7TQ-ACQ6G-XNHG8`, valid ten minutes, and the address to use.
4. In HA, **Settings, Apps, Mantel Connect, Configuration**: enter the address and the code, Save, Restart
   the App. The App pairs on start, keeps the result in its own storage, and Mantel appears in the sidebar.
   The first HA administrator to open it is offered the Owner role (the same bootstrap as the Mantel App);
   the Owner links the rest of the household (`.../ingress/people`).

Revoke from `/admin`, **Connect**, **Revoke**, or `mantel connect revoke --id ...`. To connect again, pair anew.

## The pairing exchange (hosts/server/mantel_connect/protocol.py)

The code is 20 characters from a 30-letter alphabet (about 98 bits), written in four groups. The first group
is a public id that selects the pending code; the other 74 bits are secret. Mantel stores only a key derived
from the code (SHA-256), only until the code is spent, burned or expired; the row is deleted with SQLite's
`secure_delete` on and the write-ahead log truncated.

1. The App opens a TLS connection to the Connect port and fingerprints the certificate Mantel presents. TLS is
   **not** trusted here: trust comes from the code.
2. It generates an EC P-256 key (the private key never leaves the App) and sends the public key, a nonce and a
   proof: an HMAC, keyed from the code, over the nonce, the public key's hash, **the certificate fingerprint it
   saw** and the App's name. A man in the middle has another certificate, so the proof fails at the real server,
   and without the code he cannot make one the real server accepts.
3. Mantel checks the proof against the code it issued and the certificate it actually serves, deletes the code
   (**single use**: whoever deletes the row wins), signs a client certificate for the App's public key with its
   **own Connect CA** and answers with the CA certificate, the client certificate and *its own* proof (an HMAC
   over the nonce, both fingerprints and the pairing id).
4. The App verifies that proof before it stores anything: **Mantel proved it knows the code, so the exchange is
   mutually authenticated**. It also checks the client certificate chains to that CA and carries its own key.
   Then it writes `ca.crt`, `client.key`, `client.crt` and `pairing.json` (0600).

Limits: a code lasts 10 minutes (`CODE_TTL`); five wrong proofs against one code burn it; failed exchanges are
limited to 10 per 10 minutes per address and 30 per 10 minutes overall (HTTP 429, one audit row per window);
starting a new pairing withdraws any earlier unspent code. Every refusal about the code is the same answer.
Requests are bounded (8 KiB, JSON object, strict field shapes, P-256 keys only).

## After pairing: mutual TLS, pinning, revocation, renewal (hosts/server/mantel_server/connect_pairing.py)

* **The listener** (`--connect-port`, default 8766) serves the same application as the ordinary listener, but
  asks for a client certificate from the Connect CA. Without one it answers only `/connect/v1/pair`. With one,
  the certificate's **fingerprint is looked up in `connect_pairings` on every request**, so a revoked pairing
  is cut off at once and its open connections (a WebSocket) are closed.
* **The App trusts only Mantel's CA** (`ssl` context with that one authority; the host name is not checked, the
  CA is private). It talks to the one configured address, never one a request names.
* **Renewal.** Client certificates last 90 days; the App renews when 30 remain (`/connect/v1/renew`, mutual TLS,
  a fresh key). The certificate it replaced stays valid one day, so a lost answer cannot strand it. Mantel's own
  listener certificate is reissued when 30 days remain (checked hourly and at start, reloaded in place); the CA
  (ten years) does not change, so pairings survive.
* **Audit** (kind `config`): `connect.pair_start`, `.pair_cancel`, `.pair_ok`, `.pair_failed` (known code, wrong
  proof; says whether it burned), `.pair_rate_limited`, `.renew`, `.revoke`, `.refused_revoked`. Never a code, key
  or certificate: pairing and certificate ids and short fingerprints only.
* **Owner REST** (LAN door, an Owner's own session, CSRF; the same rule as service accounts): `GET /api/connect`,
  `POST /api/connect/pair`, `DELETE /api/connect/pair`, `DELETE /api/connect/pairings/<id>`; CLI:
  `mantel connect pair|list|status|cancel|revoke`.

## Identity: the trust rules stay in ingress.py

A request on the Connect listener that passes the certificate check is a **paired Connect** request, and for
ingress.py it counts as if the Supervisor's Ingress proxy had sent it (`is_ingress` has one added condition).
Everything else is unchanged and not duplicated: the `X-Remote-User-*` headers are believed only then; a linked
HA user gets their role, an unlinked one gets "not linked yet"; the **`ha` door is `trusted`** by Avery's decision
(`ha_door_rules: trusted`; the compose override and entrypoint default to it, `MANTEL_HA_DOOR_RULES` changes it);
first-Owner bootstrap and the people page work; sessions are Ingress sessions bound to the HA user. The same
headers on the ordinary listener are ignored and logged; on the Connect listener without a paired certificate nothing is served (401).
The Connect App builds its outbound headers from an allow-list (never the browser's identity, `X-Mantel-*` or
`Authorization`), takes requests only from the Supervisor's socket address, and never decides anything itself.
The Connect listener skips the Host-name check (mutual TLS replaces it; the browser's host rides in
`X-Forwarded-Host`, which the existing Origin rule uses).

## Secrets

Files only. Mantel: the CA key and listener key in `<data-dir>/connect/` (0700 folder, 0600 files) on the `/data`
volume. The App: key, certificate and CA in its own `/data/connect` (0600); it drops root before serving. Nothing
secret is in an environment variable (`MANTEL_CONNECT=1` is a switch), a log (access logs are off in the App) or
a status page (which says only whether Mantel is reachable). The one-time code is typed into the App's options
(a masked password field, `options.json` in HA's own storage); it is single-use and expires; a code that already
failed is not retried on restart (`attempt.json` keeps its hash).

## What the App does (hosts/server/mantel_connect/app.py)

An Ingress reverse proxy over HTTP and WebSocket: streaming bodies both ways, redirects and cookies passed
through (Mantel already moves them under the Ingress prefix), `Accept-Encoding` passed through undecoded.
`/healthz` is the watchdog (bare "ok"); `boot: auto` starts it with HA. A connection test runs every minute and
logs only when the state changes; `/__mantel_connect/status` (inside the sidebar page) shows it. Unpaired, wrong
or expired code, Mantel unreachable and revoked each get a plain page that says what to do.

## Packaging

* `packaging/connect-app/` (config, Dockerfile, requirements, DOCS, translations); `tools/stage_connect_app.py`
  (dry run with the private-content scan, `--replace` only for folders this tool staged, never inside the repo).
* `packaging/compose/compose.connect.yaml`: one published port and the switch; `tools/package_check.py` checks
  both it and the App's config (no ports, no HA/Supervisor API, nothing mapped, masked code).
* The migration is `0009_connect_pairing.sql` (two tables). If another slice already took 0009, renumber one of
  them: the backup test requires numbers without gaps.

## Verified (2026-10-18, this repo, no house contact)

* `tests/test_connect_pairing.py` (single use, expiry, wrong code, burn, rate limits, a man in the middle with
  another certificate, malformed requests, pinning, wrong CA, revocation closing an open connection, renewal and
  its grace, listener renewal, CLI, Owner REST, identity rules, the real App proxying HTTP, bodies and a
  WebSocket, re-pair, unpaired/revoked/unreachable pages) and `tests/test_stage_connect_app.py` (staging,
  scan, replace guards, isolation, packaging checks, entrypoint and flags).
* **Docker, real images (Docker Desktop):** the Mantel Server image (`--target server`, compose mode with
  `MANTEL_CONNECT=1`) and the Connect App image (built from the staged folder) on one Docker network. Pairing
  with a code from `mantel connect pair` in the server container; the App (uid 10001, files 0600) proxied the
  sidebar page, `/api/session` as the linked Owner (door `ha`), an unlinked HA user refused, and a WebSocket
  snapshot; a container restart kept the pairing and did not re-spend the code; `mantel connect revoke` cut the
  App off at once (it showed the "disconnected" page); a new code re-paired. Neither container's log held a
  code or key. (The scratch HA was not used: Connect needs no HA, and a scratch core has no Supervisor Ingress.)
* The admin page's Connect section was clicked through in the Browser pane (start, the code box noticing the
  code was spent, a second pairing listed, revoke).

## Not done / next

* **On the house:** the App has not been installed in the real HA, so the real Supervisor Ingress path through
  Connect (header names, the `172.30.32.2` peer, the Companion app over cellular) is exercised only by the
  simulated Supervisor here; the Phase 0 proof already showed the real headers and peer for the old App.
* **No QR code.** The pairing string is typed (an HA App's options form cannot take a scan); a terminal or page QR
  needs a QR encoder that is not a dependency yet.
* Pairing needs the Connect port reachable from HA. Nothing opens a firewall or forwards a port.
* The Phase 0 proof (`connect_proof.py`, `packaging/mantel-connect/stage.py`, `setup-receiver.sh`) is left in
  place for its tests and the LXC 103 proof; it is not part of the new flow.
