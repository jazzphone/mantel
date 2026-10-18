# Phase 3 P3.3: the command gateway, its audit, and the server wiring (P3.7) — 2026-10-18

**Built, tested offline, and run end to end against the scratch Home Assistant.** Mantel Server now has
a command gateway: a signed-in person's (or a wall tablet's) service calls, WebSocket writes, HTTP
writes and Music Assistant commands are resolved to a subject, classified, decided by P3.2's RBAC,
held for step-up when sensitive, written to an append-only audit row **before** anything is sent, and
only then forwarded with Mantel's HA credential. **Commands stay off by default**: the command path
cannot even be constructed unless the server's operator sets `commands_enabled` (config / CLI flag),
and every test except the scratch-HA e2e runs with it off or with a fake connection that sends
nothing anywhere. `server.py` now registers every finished slice (P3.1, P3.2, P3.4, P3.6) with real
hooks. No command was ever sent to the house: nothing here pointed at `/Volumes/config` or
192.0.2.53, and `~/.config/mantel/ha_token` was never read.

## Files

| File | What |
|---|---|
| `hosts/server/mantel_server/gateway.py` | The gateway: `classify()` (pure), `Audit` (the `action_audit` table), `Gateway.handle()` (refresh subject → classify → decide → step-up → audit → forward → result), the MA command gate, the Owner notification. |
| `hosts/server/mantel_server/authz.py` | The wiring between identity and RBAC: `resolve_door`, `Principal` (one per socket), `Authz` (subject from identity, refresh from the database, the house policy, the RBAC context (cached lookups, exact time), the P3.4 hooks `may_read` / `may_view`). |
| `hosts/server/mantel_server/ha_client.py` | Adds the ONE command path, `HaCommander` (own WebSocket + REST), `CommandTicket`, `check_command`, `check_http`, `commander_for`. `HaClient` (the state connection) is unchanged and still cannot call a service. |
| `hosts/server/mantel_server/migrations/0004_audit.sql` | `action_audit`: append-only, result written once. |
| `hosts/server/mantel_server/hk_writes.json` | `hkClient.WRITES`, exported by `tools/export_writes.py`. |
| `hosts/server/mantel_server/server.py` | Wiring: `wire()` registers RBAC, gateway, connectors, health; `ClientSession` gets a principal, a gated view, a P3.4 `Ctx` and the handler dispatch; `ClientSession.read()` is gone; the policy tick; the house time zone. `/api/registry` and `/api/entities` are filtered like the socket. |
| `hosts/server/mantel_server/config.py`, `__main__.py` | `commands_enabled` (default False, `--commands-enabled`), `house_tz` (`--house-tz`, fallback "UTC"), `--trusted-proxy` (fills `trusted_proxies`). The startup line says which mode runs. |
| `tools/export_writes.py` | Exports/checks the write catalog (evaluates `hk-client.js` in Node when present, else parses the literal; both must agree). |
| `web/shim/hub.js`, `web/shim/mantel-client.js`, `web/shim/mantel-stepup.js`, `web/shim/mantel-host.js`, `web/home.js` | The page's side: `capabilities`, `command()`, the actions port, the step-up prompt, denial toasts. |
| `tools/e2e/gateway_e2e.py` | The e2e against the scratch HA. |
| `tools/headless/gateway_page_check.py` | Offline browser check of the page's commands-on path (fake command connection). |
| `tools/headless/client_smoke.py` | Stands in HK's own feeds as read routes (below). |
| `tests/test_gateway.py`, `tests/test_gateway_catalog.py`, `tests/test_wiring.py`, `tests/gateway_fakes.py` | 40 new tests. |
| `tests/test_config.py`, `tests/test_boundaries.py` | Two invariants restated on purpose (below). |

## The protocol (on the hub socket, `/ws`)

```
<- {"type":"capabilities","commands":true,"step_up_window":300,"door":"lan"}        only when commands are on
-> {"type":"command","id":7,"kind":"service","domain":"light","service":"turn_on",
    "target":{"entity_id":"light.kitchen"},"data":{...},"return_response":false}
-> {"type":"command","id":8,"kind":"ws","msg":{"type":"config/entity_registry/update",...}}
-> {"type":"command","id":9,"kind":"http","method":"POST","path":"/api/...","body":{...}}
-> {"type":"command","id":10,"kind":"ma","command":"player_queues/play","args":{"queue_id":"..."}}
<- {"type":"command_result","id":7,"result":<HA's result>,"audit_id":41}
<- {"type":"command_result","id":7,"error":{"code":"forbidden","reason":"no_grant","target":"light.x"},"audit_id":42}
<- {"type":"step_up_required","id":7,"reason":"step_up_required"|"person_pin_required","action":"lock.unlock",
    "targets":["lock.front_door"],"methods":["totp","passkey"],"window":300,"audit_id":43}
```

Error codes: `forbidden` (RBAC; `reason` is the engine's), `invalid_command`, `not_a_write`,
`unsupported_target`, `unsupported_body`, `unauthenticated` (the session or device ended while the
socket was open), `audit_unavailable`, `unavailable`, and HA's own code (`not_found`, `http_400`, …)
when HA refused. With commands off, every command-shaped frame answers exactly as before:
`{"type":"error","code":"commands_disabled",...,"id":…}`, and no `capabilities` frame is sent. With
them on, a command-shaped frame that is not `{"type":"command",…}` answers `invalid_command`.

## Classification (`gateway.classify`, pure)

* **service** → `<domain>.<service>`, decided once per target entity (all must pass). Targets come from
  `target.entity_id` and `data.entity_id` (a string, comma list, or list). `area_id`, `device_id`,
  `floor_id`, `label_id` and `entity_id: all` are refused (`unsupported_target`): HA would expand them
  to entities the gateway never checked. With no entity: `notify.*` and `persistent_notification.*`
  are the `notifications` feature; `script.<name>` is that script; **anything else is `configure` on
  `settings`** (Owner/Admin), so an Adult's "control the whole house" never reaches
  `homeassistant.restart`, `recorder.purge` and the like. Service names go to `Policy.decide` as
  services (never a bare `control`), so the sensitive set applies.
* **ws** → the type must be in `hkClient.WRITES` (else `not_a_write`: reads go through `read`).
  `call_service` inside `ws` is the service path. Others (`gateway.ws_rule`): `calendar/event/*` =
  `control` on the frame's `entity_id`; `config/entity_registry/update` = `configure` on its
  `entity_id`; `frontend/set_user_data` = `configure` `profile`; `*/settings/set` = `configure`
  `settings`; `hk_music/*` = `control` `music`; `hk_notify/*` = `configure` `notifications`;
  `hk_energy/*` = `configure` `energy`; **every other write** (HK boards, dashboards, tablets, Lovelace,
  registries) = `configure` `settings`. A test pins that every catalog type has a rule.
* **http** → methods POST/PUT/PATCH/DELETE (GET is `not_a_write`), a plain `/api/...` path (no `..`,
  `//`, scheme or host), a JSON body (else `unsupported_body`: the doorbell's recorded talk-back audio
  is therefore not offered yet). `POST /api/services/<d>/<s>` is the service path; any other path is
  `configure` `settings`.
* **ma** → a command in `connectors/ma.py` `MA_COMMANDS` with its exact args, `control` on `music`.

**One catalog.** `hk_writes.json` is generated from `web/client/hk-client.js` by
`tools/export_writes.py` (Node evaluates the file exactly as the page does; the literal is also
parsed; both must agree). `tests/test_gateway_catalog.py` fails when the JSON and `hk-client.js`
differ (`tools/export_writes.py` regenerates, `--check` compares).

## Step-up

1. `Policy.decide` says `needs_step_up` (sensitive, everything else allowed, no fresh factor within
   300 s). The gateway writes a `step_up` audit row and answers `step_up_required` with the person's
   methods (`totp` if enrolled, `passkey` if registered).
2. The page fires `hk-step-up-required`; `web/shim/mantel-stepup.js` draws a small prompt in HK's
   overlay layer (`hkOverlays.root()`, HK's dialog root): the authenticator code
   (`POST /api/auth/totp/step-up`) or the passkey (`POST /api/auth/passkey/options` + `/verify`, which
   steps up a signed-in session). P3.1 marks the session's `fresh_factor_at`.
3. The page sends the same command again. The gateway re-reads the session row **at every command**,
   so the fresh factor counts at once; after 300 s it asks again (tested at 299 / 301 s).
4. **A wall tablet alone** (`person_pin_required`) gets `methods: []` and the page says "A person has to
   confirm this": the person-PIN-at-the-tablet flow is not built yet (continuation point).

Note (P3.1's semantics, unchanged): a sign-in is itself a fresh factor, so for five minutes after
signing in a sensitive action needs no second prompt.

## The audit (`migrations/0004_audit.sql`, `action_audit`)

| Column | |
|---|---|
| `id`, `timestamp` | |
| `actor`, `actor_name`, `role` | the user (id, name, role at the time); `mantel` for the server's own notifications; NULL for a device alone |
| `device`, `device_role` | the wall tablet, if any |
| `kind` | `service`, `ws`, `http`, `ma`, `config` (RBAC REST changes), `system` |
| `action`, `target` | `lock.unlock` / a WS type / `POST /api/x` / an MA command; JSON list of entity ids or `feature:<name>` |
| `decision`, `reason`, `sensitive` | `allowed` / `denied` / `step_up`; the engine's or gateway's reason; the sensitive kind |
| `door`, `source_ip` | `lan` / `tunnel`; the client IP (X-Forwarded-For only from trusted proxies) |
| `step_up`, `step_up_age` | for a sensitive action allowed: the factor (`totp`, `passkey`, `password+totp`, …) and its age |
| `result`, `result_at` | NULL until HA answered; `ok`, `error:<code>`, or `not_sent` (denied/step-up rows) |

Rules: the row is written **before** anything is sent, and a failed insert refuses the command
(`audit_unavailable`, tested); a trigger forbids DELETE, and UPDATE is allowed only to write `result`
once, from NULL (tested); service data is never stored (it can carry an alarm code). The forward
needs a `CommandTicket` bound to that row's id, which `HaCommander` spends once (tested). RBAC REST
changes (`rbac_store`'s audit hook) land here too as `kind='config'`, before they are applied. Proof
2's `command_audit` table is unchanged for `/api/proof2/command`.

## Enabling commands, and the safeguards

* **Off by default.** `Config.commands_enabled = False`; `mantel-server --commands-enabled` (or a
  `Config` built by code) turns it on. No client message, REST call or setting can change it.
* **While off:** `build_app` creates no `Gateway`, `commander_for` returns None, `HaCommander(cfg)`
  raises `CommandsDisabled`, the MA gate is `REFUSE_ALL`, no `capabilities` frame is sent, the page's
  client has no actions (hkClient refuses with `commands_disabled`, sending nothing), and the socket
  answers commands exactly as today. `tests/test_config.py` pins all of this.
* **While on:** the state connection (`HaClient`) still has no service path (pinned); the command
  connection sends only `call_service` with its own keys or a type from the catalog, never a frame
  without a fresh ticket from the audit row, and HTTP writes only to plain `/api/` paths.
* **Turning it on for the house is Avery's decision at cutover** (ROADMAP ground rule). The startup
  line and a log warning say when it is on.

## Wiring (P3.7, `server.py`)

* `wire()` (called from `build_app` after P3.1's three registers): installs `app["door_resolver"]`,
  `rbac_store.register` (identity = the signed-in user; CSRF = P3.1's check; audit = `action_audit`),
  `Authz`, the command path and `Gateway` (only when on), `Hooks(may_read, may_view, ma_gate=gateway or
  REFUSE_ALL, ha_token)`, then `readproxy.register`, `camera.register`, `ma.register`, `health.register`.
* **Per socket**: `Authz.principal(request)` → `Principal(identity, subject, source_ip, gate)`. The
  subject has the user's role/id, the device's role/id, the door, `fresh_factor_at`, the stored area
  scopes (a tablet with no stored scope gets its enrolled room). The `rbac.Gate` filters the
  socket's `ClientView`; the same principal is the P3.4 `Ctx.identity` and the gateway's subject.
* **Dispatch**: `classify()` first (command-shaped frames go to the gateway or get
  `commands_disabled`), then subscribe/unsubscribe/ping/watch_stats, then `app["ws_handlers"]` (read,
  read_subscribe, read_unsubscribe, read_api, ma/*), each as a task; `ctx.close()` on socket end.
  `ClientSession.read()` is removed, as P3.4 described.
* **The door**: Caddy's `X-Mantel-Door` is believed for `lan` only from a peer in `trusted_proxies`
  (`--trusted-proxy`); from Caddy a missing or unknown value is `tunnel`; any Cloudflare header is
  `tunnel`; a request from loopback with no claim is `lan` (the prototype); every other peer is
  `tunnel`. A claim that can only tighten the rules (`tunnel`) is honoured from anyone.
* **Policy tick** (60 s): every socket's principal is re-read from the database (role changes, scopes,
  revoked sessions/devices close the socket), then `view.policy_changed()` (schedules, guest windows).
  Grant edits through the RBAC REST already reach sockets at once.
* **House time zone**: HA's `get_config` `time_zone` (read through the ReadProxy, retried with backoff
  until HA answers), validated; `cfg.house_tz` (default "UTC") until then or if HA's zone is unknown.
* `/api/registry` (filter_registry) and `/api/entities` are filtered with the same gate.

## Web client

* `hub.js`: `capabilities`, `commandsEnabled()` (true only after the server said so), `command(body)`
  (refused locally unless enabled), `command_result` / `step_up_required` / id'd errors resolve the
  waiting command; a lost socket answers waiting commands `unavailable` (none is re-sent).
* `mantel-client.js`: a port made after `capabilities` said `commands: true` gets `actions`
  (`callService` with HA's signature, `callWS`, `request` answering a `Response` like
  `fetchWithAuth`); they send only gateway `command` messages through the hub. No `liveSocket`. Every
  other port has no actions: hkClient refuses (`commands_disabled`) and `port.refused` is told, as
  before. `home.js` hands over the hub and republishes the snapshot when capabilities arrive.
* `mantel-stepup.js`: the prompt (above). `mantel-host.js`: a toast for a denied command.
* The HA build is untouched (`hosts/ha/` not edited; all HA suites green).

## E2E against the scratch HA (`tools/e2e/gateway_e2e.py`)

`testha.py up --fresh` (127.0.0.1:8124, `demo` devices only), Mantel in-process with
`commands_enabled=True` and the scratch HA's throwaway credential (traded for an access token from
`<TESTHA_DIR>/testha.json`, never printed), a temp database and secrets; people created through
Mantel's own APIs; `testha.py down` at the end. Run on 2026-10-18: **24/24 checks passed.**

```
PASS house time zone read from HA's get_config (America/New_York)
PASS first Owner created through the bootstrap API
PASS Child and Adult created by the Owner (POST /api/users)
PASS the socket says commands are enabled (capabilities)
PASS Owner toggled light.kitchen_lights through Mantel: HA says on -> off
PASS Mantel's state hub followed HA's change
PASS the Child's socket holds 2 entities and no lock, camera or alarm
PASS Child denied lock.unlock (explicit_deny)
PASS nothing was sent to HA for the Child's unlock; the lock is still locked
PASS the Child's unlock has an audit row: denied / not_sent
PASS Child may toggle light.bed_light in their own room
PASS Adult's unlock answered step_up_required (methods: totp)
PASS the lock stayed locked while step-up was owed
PASS Adult stepped up with TOTP (POST /api/auth/totp/step-up)
PASS after step-up the Adult unlocked lock.front_door: HA says unlocked
PASS the unlock's audit row: allowed, sensitive lock, step_up totp, result ok
PASS a wall tablet enrolled (POST /api/devices/enroll)
PASS the tablet sees its room (Kitchen) and not the Bedroom
PASS the tablet toggled a Kitchen light
PASS the tablet alone needs a person for a lock (person_pin_required)
PASS a remote unlock created an Owner notification in HA (persistent notification)
PASS all 10 commands have an audit row
PASS every service call sent to HA has an allowed audit row with result ok
PASS the Owner notification is audited too
```

Sent to HA, in order: `light.toggle, light.toggle, lock.unlock, light.toggle, lock.lock, lock.unlock,
persistent_notification.create, lock.lock`. The audit table afterwards (13 rows):

| id | who | kind | action | target | decision | reason | sensitive | door | step_up | result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | owner | config | rbac.scopes.set | child → Bedroom | allowed | owner | | | | |
| 2 | owner | service | light.toggle | light.kitchen_lights | allowed | granted | | lan | | ok |
| 3 | child | service | lock.unlock | lock.front_door | denied | explicit_deny | lock | lan | | not_sent |
| 4 | child | service | light.toggle | light.bed_light | allowed | granted | | lan | | ok |
| 5 | adult | service | lock.unlock | lock.front_door | step_up | step_up_required | lock | lan | | not_sent |
| 6 | adult | service | lock.unlock | lock.front_door | allowed | granted | lock | lan | totp | ok |
| 7 | (tablet) | service | light.toggle | light.kitchen_lights | allowed | granted | | lan | | ok |
| 8 | owner | config | rbac.grant.add | tablet → lock.kitchen_door | allowed | owner | | | | |
| 9 | (tablet) | service | lock.unlock | lock.kitchen_door | step_up | person_pin_required | lock | lan | | not_sent |
| 10 | owner | service | lock.lock | lock.front_door | allowed | granted | | lan | | ok |
| 11 | adult | service | lock.unlock | lock.front_door | allowed | granted | lock | tunnel | password+totp | ok |
| 12 | mantel | system | persistent_notification.create | feature:notifications | allowed | owner_notification:11 | | | | ok |
| 13 | owner | service | lock.lock | lock.front_door | allowed | granted | | lan | | ok |

(HA's demo locks have no unique_id, so they have no registry entry and no area; the e2e gives the
tablet the Kitchen lock with an Owner entity grant, as a house would.) Evidence JSON:
`<TESTHA_DIR>/gateway_e2e.json`.

The page side was checked separately in headless Chrome (`tools/headless/gateway_page_check.py`,
commands on, fake command connection): capabilities turned the actions on; `callService` came back
with HA's result; a read through `actions.callWS` was refused `not_a_write`; `lock.unlock` raised the
prompt in HK's overlay root, nothing was sent while it was owed, the TOTP code was accepted and the
unlock went out and succeeded; 0 browser exceptions.

## Tests and validation

* `~/.venvs/mantel/bin/python -m pytest -q` → **1232 passed** (1192 before; 40 new in
  `test_gateway.py` (23), `test_gateway_catalog.py` (4), `test_wiring.py` (13, incl. the door table)).
* `tools/build_ha.py` + `tests/run` → all suites green (HA build unaffected).
* `tools/headless/client_smoke.py` → passed (0 external requests, 0 browser exceptions; commands off).
  It uses the fixed Chrome port 9337 and fails when another job's smoke holds it; run it alone.
* `tools/e2e/gateway_e2e.py` → 24/24. (One earlier run caught a real bug: a per-second cache of the
  RBAC context made a step-up stamped later in the same second look like a factor from the future, so
  the retried unlock asked again. The context now always carries the exact time; a regression test
  pins it.)
* `tools/headless/gateway_page_check.py` → passed.

Gateway paths covered: allowed; denied (and nothing sent); every target must pass; step-up required
then satisfied; stale step-up (299/301 s); a tablet alone (`person_pin_required`, `methods: []`);
audit failure closes; rows append-only, result written once; HA's error as the row's result; commands
disabled answers exactly as before (no capabilities, no audit); only the gateway's own shape when on;
WS write vs read; classification table and every catalog write has a rule; unsupported targets
audited; HTTP writes; revoked session on an open socket; role change at the next command; remote
unlock notifies the Owners; a Guest with a lock grant on the tunnel gets `tunnel_lan_only` (no prompt);
tickets one-shot and bound to an audit row; MA gate one-shot; MA off → `unavailable`. Wiring: a Child
socket never receives a lock (snapshot, by id, new entities, diffs, `/api/registry`, `/api/entities`);
a tablet's subject (room default, stored scope replaces it, camera live view); a person at a tablet
gets the intersection; the door table; `build_app` registers everything (commands off/on); reads go
through the filtered handlers; `may_read`/`may_view`; the tick applies role changes and closes revoked
sockets; the house time zone and its fallback; health public, RBAC REST Owner-only and audited.

Changed existing tests, on purpose:
* `tests/test_config.py::test_ha_client_source_has_no_service_call_path`: the brief puts the command
  path in `ha_client.py`, so the pin moves from "the module never says call_service" to "HaClient and
  check_outgoing never do, and HaCommander cannot be built while commands are off".
* `tests/test_boundaries.py::test_mantel_host_has_no_action_transport`: Mantel's port now gets actions,
  but only after `capabilities` said so, and they only send gateway `command` messages through the hub;
  the snapshot's service method is still never forwarded.
* `tools/headless/client_smoke.py`: HK's own feeds (`hk_frontend/panel/get`, `…/settings/subscribe`,
  `hk_music/subscribe`, …) were answered by the smoke's `OfflineReads` because the old unfiltered
  `ClientSession.read()` passed anything to it (a real ReadProxy refuses them). Reads now go through
  P3.4's filtered handlers, so the smoke answers these as read routes (`app["read_routes"]`), the
  connector mechanism. P3.5 replaces them with Mantel's own settings.

## Decisions (made here; Avery may revisit)

1. **Camera live view needs no step-up on the LAN door** (`authz.LAN_STEP_UP_EXEMPT`), so the doorbell
   pop-up opens on the wall tablets without a PIN. On the tunnel door the §7 rules are unchanged (a
   fresh factor and the role's `tunnel_cameras` switch). Applied in the house policy layer, not by
   changing `rbac.DEFAULT_ROLES`, so P3.2's matrix tests stand.
2. **Wall tablets may view and live-view every camera** (`authz.HOUSE_GRANTS`): the doorbell pop-up
   shows on every tablet whatever room the doorbell is in. Devices are refused on the tunnel anyway; a
   Child at a tablet still sees no camera (intersection).
3. A tablet with no stored area scope is scoped to its **enrolled room** (by name).
4. The door rule above (only a trusted proxy can grant `lan` by header; stricter claims honoured).
5. Area/device/floor/label targets are refused rather than expanded; entity-less services other than
   notifications and scripts are `configure` `settings`.
6. HK's own writes not otherwise mapped are `configure` `settings` (Owner/Admin) until P3.5 moves HK's
   settings into Mantel with finer rules (e.g. a tablet touching its own screensaver).
7. HTTP writes are JSON only (the recorded talk-back POST is not offered); no `liveSocket`.
8. P3.4's `feature:media` is decided as `music`.
9. The Owner notification covers remote **lock** and **alarm** sensitive actions (PLAN §7 says
   unlock/disarm); a remote garage open does not notify yet.
10. `capabilities` is sent only when commands are on, so a server with them off behaves byte for byte
    as before.

## Not done / open questions

* **A person's PIN at a wall tablet** (`person_pin_required`): needs a PIN factor (P3.1 left it to P3.3)
  and a way to name the person on a device-only socket; then decide again with that person as the user.
* A PIN factor generally (TOTP and passkey are the step-up factors today).
* Audit retention window and an Owner-only audit read API (`feature:audit`).
* The tablets' read-side features: with the default roles a wall tablet has no `music`,
  `notifications` or `media` feature grant, so those reads are refused for a tablet alone (P3.2's
  model; add grants or role defaults when the tablet cutover is planned).
* The packaging entrypoint does not pass `--trusted-proxy` yet: behind Caddy every request is
  `tunnel` (fail closed) until it does.
* MA commands through the gateway are tested with the gate only (MA stays fake-only until a scratch MA).
* The `/dev` page's endpoints `/api/stats` (top updating entity ids) and `/api/areas` (entity counts)
  are behind sign-in but not RBAC-filtered; `/api/registry` and `/api/entities` are.

## Exact continuation point

1. **Cutover (Avery):** decide on decisions 1 and 2, then run the house server with `--commands-enabled`
   (and `--trusted-proxy <caddy>` behind Caddy) only when ready; before that, run
   `tools/e2e/gateway_e2e.py` once more on the commit being deployed.
2. **Packaging (P3.6 follow-up):** pass `--trusted-proxy` (Caddy's address on the backend network) and,
   if wanted, `--commands-enabled` from `MANTEL_*` settings in `packaging/docker/entrypoint.py`.
3. **Person-at-tablet PIN:** a per-user PIN (Argon2id, lockout) in P3.1's style, a
   `POST /api/auth/pin/step-up {user, pin}` usable from a device socket, and the gateway deciding again
   with that person as the user (the engine already intersects).
4. **P3.5:** move HK's settings writes into Mantel (finer RBAC than `configure settings`), retire the
   smoke's feed stand-ins.
5. **Audit read API** for Owners and a retention job.
