# Phase 3 P3.3: the command gateway, its audit, and the server wiring (P3.7) — 2026-10-18

**Built, tested offline, and run end to end against the scratch Home Assistant.** Mantel Server now has
a command gateway: a signed-in person's (or a wall tablet's) service calls, WebSocket writes, HTTP
writes and Music Assistant commands are resolved to a subject, classified, decided by P3.2's RBAC,
(since decision 25: no step-up; the alarm takes the house Alarm PIN), written to an append-only audit row **before** anything is sent, and
only then forwarded with Mantel's HA credential. **Commands stay off by default**: the command path
cannot even be constructed unless the server's operator sets `commands_enabled` (config / CLI flag),
and every test except the scratch-HA e2e runs with it off or with a fake connection that sends
nothing anywhere. `server.py` now registers every finished slice (P3.1, P3.2, P3.4, P3.6) with real
hooks. No command was ever sent to the house: nothing here pointed at `/Volumes/config` or
192.0.2.53, and `~/.config/mantel/ha_token` was never read.

## No step-up (decision 25, Avery 2026-10-18) — the rules today

**The only PIN in Mantel is the house Alarm PIN (HK Settings → Alarm PIN), and only for the alarm**
(PLAN.md §12, decision 25). This section is the current rule; the sections below that describe a
step-up, a person's PIN at a wall tablet or a PIN pad are the history of what was built first and were
**removed** by this change.

* **No command asks for a person's PIN or a fresh second factor**, on any door: a wall tablet (LAN, or
  through HA's sidebar), HA's sidebar (trusted or under tunnel rules), the LAN, the tunnel. Locks,
  the garage, valves, automations, scripts, camera live view and talk-back go through on the roles and
  grants alone. A Child is refused where the roles deny it; deny grants (by role, user or device) still
  win; on the tunnel the roles' `tunnel_sensitive` / `tunnel_cameras` / `tunnel_locations` switches
  still decide, and device credentials are still refused there. Every command still gets its audit row
  first. "Sensitive" stays meaningful: a separate grant (`control.sensitive`), the tunnel switch's scope,
  the audit's `sensitive` column and the remote notice.
* **Kept:** the "remote access" Owner notice for a remote unlock/disarm (the tunnel, or HA's sidebar when
  it is not trusted; not a sidebar wall tablet) — it never depended on the step-up. Account
  administration (roles, users, credentials, Connections, Alarm PIN settings) still asks for a recent
  sign-in ("confirm it is you", `accounts.require_fresh`): that guards account changes, not house commands.
* **The alarm keeps its code, as HK in HA does** ("The alarm" below): disarming, and arming while
  "Require the PIN to arm" is on (and any command where a code is typed), needs the house Alarm PIN
  (`alarm_pins`, Argon2id), checked by Mantel with its lockout, the same on every door. The roles are
  decided FIRST (`control.sensitive` on the keypad panel and the alarm), so a refused role never learns
  anything about the code and never counts toward a lockout. A person's own PIN is not accepted there
  (same digits as the Alarm PIN: fine, the Alarm PIN matched). **Every** `alarm_control_panel.alarm_*`
  command takes this path: a command naming the protected alarm itself is guarded by the keypad that
  protects it, and an alarm with no Alarm PIN set refuses whatever needs a code (`alarm_pin_not_set`,
  nothing sent) — before, such an alarm took the ordinary path, which without a step-up would have
  disarmed on roles alone. The alarm's own HA code (`ha_code`) is still added by Mantel.
* **Personal PINs** (Me → PIN, `/api/account/pin`) stay settable for later; nothing requires or checks them.

**Rules removed** (code): `rbac` — the `step_up_required` and `person_pin_required` decisions,
`Decision.needs_step_up`, `Policy.step_up_window` / `step_up_exempt`, `STEP_UP_WINDOW`, the Wall Tablet
role switch `sensitive_needs_person` (a stored override that still has it is accepted and ignored);
`authz` — `LAN_STEP_UP_EXEMPT` (camera live view without step-up on the LAN: now everywhere), `with_person`;
`gateway` — `_step_up` (a PIN inside the command: `identify` at a tablet, `verify_user` on a session),
`_methods`, the `step_up_required` replies (ordinary and alarm), `step_up_window` in `capabilities`, and the
"house code is the factor on the LAN only" rule (the tunnel and the `ha` door under tunnel rules wanted the
person's own fresh factor on top); `alarm_pin` — a person's PIN as a keypad code (and the `ambiguous`
outcome); `pins` — `identify`, `verify_user`, `any_pin`, the person match in `keypad`; the page —
`web/shim/mantel-stepup.js` (the step-up sheet and PIN pad) and `mantel-client.js`'s step-up loop (a
`step_up_required` from an older server is now a plain refusal: no prompt, no resend). A command that
still carries a `step_up` field is refused `invalid_command` (audited `invalid_step_up`) and nothing in it
is forwarded. The audit keeps its `step_up` column: `alarm_pin` on an alarm command the house code allowed,
empty otherwise; the `step_up` decision value is only on rows from before this change.

## Files

| File | What |
|---|---|
| `hosts/server/mantel_server/gateway.py` | The gateway: `classify()` (pure), `Audit` (the `action_audit` table), `Gateway.handle()` (refresh subject → classify → decide → (the alarm: the house Alarm PIN) → audit → forward → result), the MA command gate, the Owner notification. |
| `hosts/server/mantel_server/authz.py` | The wiring between identity and RBAC: `resolve_door`, `Principal` (one per socket), `Authz` (subject from identity, refresh from the database, the house policy, the RBAC context (cached lookups, exact time), the P3.4 hooks `may_read` / `may_view`). |
| `hosts/server/mantel_server/ha_client.py` | Adds the ONE command path, `HaCommander` (own WebSocket + REST), `CommandTicket`, `check_command`, `check_http`, `commander_for`. `HaClient` (the state connection) is unchanged and still cannot call a service. |
| `hosts/server/mantel_server/migrations/0004_audit.sql` | `action_audit`: append-only, result written once. |
| `hosts/server/mantel_server/hk_writes.json` | `hkClient.WRITES`, exported by `tools/export_writes.py`. |
| `hosts/server/mantel_server/server.py` | Wiring: `wire()` registers RBAC, gateway, connectors, health; `ClientSession` gets a principal, a gated view, a P3.4 `Ctx` and the handler dispatch; `ClientSession.read()` is gone; the policy tick; the house time zone. `/api/registry` and `/api/entities` are filtered like the socket. |
| `hosts/server/mantel_server/config.py`, `__main__.py` | `commands_enabled` (default False, `--commands-enabled`), `house_tz` (`--house-tz`, fallback "UTC"), `--trusted-proxy` (fills `trusted_proxies`). The startup line says which mode runs. |
| `tools/export_writes.py` | Exports/checks the write catalog (evaluates `hk-client.js` in Node when present, else parses the literal; both must agree). |
| `web/shim/hub.js`, `web/shim/mantel-client.js`, `web/shim/mantel-host.js`, `web/home.js` | The page's side: `capabilities`, `command()`, the actions port, denial toasts. (`mantel-stepup.js`, the step-up prompt, was removed by decision 25.) |
| `tools/e2e/gateway_e2e.py` | The e2e against the scratch HA. |
| `tools/headless/gateway_page_check.py` | Offline browser check of the page's commands-on path (fake command connection). |
| `tools/headless/client_smoke.py` | Stands in HK's own feeds as read routes (below). |
| `tests/test_gateway.py`, `tests/test_gateway_catalog.py`, `tests/test_wiring.py`, `tests/gateway_fakes.py` | 40 new tests. |
| `tests/test_config.py`, `tests/test_boundaries.py` | Two invariants restated on purpose (below). |
| `tests/test_gateway_talk.py`, `tests/test_shim_talk.py` + `tests/shim_talk_harness.mjs`, `tools/e2e/talk_e2e.py` | Doorbell talk-back (section "Doorbell talk-back", added later the same day). |
| `talk_relay.py`, `ha_client.HaTalkLink`; `tests/test_talk_live.py` + `tests/talk_worker_harness.mjs` | Live talk: the `talk_live` ticket and the `/ws/talk` relay (same section). |

## The protocol (on the hub socket, `/ws`)

```
<- {"type":"capabilities","commands":true,"door":"lan"}        only when commands are on
-> {"type":"command","id":7,"kind":"service","domain":"light","service":"turn_on",
    "target":{"entity_id":"light.kitchen"},"data":{...},"return_response":false}
-> {"type":"command","id":8,"kind":"ws","msg":{"type":"config/entity_registry/update",...}}
-> {"type":"command","id":9,"kind":"http","method":"POST","path":"/api/...","body":{...}}
-> {"type":"command","id":10,"kind":"ma","command":"player_queues/play","args":{"queue_id":"..."}}
-> {"type":"command","id":11,"kind":"http","method":"POST","path":"/api/hk_frontend/talk?entity_id=media_player.x",
    "content_type":"audio/webm","body_b64":"<the clip>"}                       (the ONE binary upload: talk-back)
<- {"type":"command_result","id":7,"result":<HA's result>,"audit_id":41}
<- {"type":"command_result","id":7,"error":{"code":"forbidden","reason":"no_grant","target":"light.x"},"audit_id":42}
<- {"type":"command_result","id":12,"error":{"code":"code_required"|"invalid_code"|"code_locked"|"alarm_pin_not_set",...}}
                                                                               (the alarm's keypad: "The alarm")
```

Before decision 25 the protocol also had `step_up_required` replies (`reason` `step_up_required` /
`person_pin_required`, `methods`, `window`, `pin_error`) and a `step_up` PIN inside a resent command; both
are gone (a `step_up` field is now refused `invalid_command`).

(Update, later the same day: a person's PIN at a wall tablet, the PIN as a step-up factor, the audit
read API and retention, and the packaging's `--trusted-proxy` were done: `docs/phase3/PINS-AUDIT.md`. The
PIN and step-up parts were removed again by decision 25, above.)

Error codes: `forbidden` (RBAC; `reason` is the engine's), `invalid_command`, `not_a_write`,
`unsupported_target`, `unsupported_body`, `body_too_large` (the talk-back clip), `unauthenticated` (the session or device ended while the
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
  `entity_id`; `frontend/set_user_data` = `configure` `profile` (except HK's own keys, e.g. `hk_music_focus`: Mantel keeps those per person itself, `user_data.py`, never a command); `*/settings/set` = `configure`
  `settings`; `hk_music/*` = `control` `music`; `hk_notify/*` = `configure` `notifications`;
  `hk_energy/*` = `configure` `energy`; **every other write** (HK boards, dashboards, tablets, Lovelace,
  registries) = `configure` `settings`. A test pins that every catalog type has a rule.
* **http** → methods POST/PUT/PATCH/DELETE (GET is `not_a_write`), a plain `/api/...` path (no `..`,
  `//`, scheme or host), a JSON body (else `unsupported_body`). `POST /api/services/<d>/<s>` is the
  service path; any other path is `configure` `settings`. **One exception carries bytes**: the
  doorbell's recorded talk-back clip (`content_type` + `body_b64`, exactly one path; section
  "Doorbell talk-back"). A binary body anywhere else, or a JSON body to the talk path, is
  `unsupported_body`.
* **ma** → a command in `connectors/ma.py` `MA_COMMANDS` with its exact args, `control` on `music`.

**One catalog.** `hk_writes.json` is generated from `web/client/hk-client.js` by
`tools/export_writes.py` (Node evaluates the file exactly as the page does; the literal is also
parsed; both must agree). `tests/test_gateway_catalog.py` fails when the JSON and `hk-client.js`
differ (`tools/export_writes.py` regenerates, `--check` compares).

## Step-up (removed by decision 25; history)

> **Superseded (2026-10-18):** none of this exists any more — see "No step-up (decision 25)" above. Kept
> as the record of what was built and then removed.

1. `Policy.decide` says `needs_step_up` (sensitive, everything else allowed, no fresh factor within
   300 s). The gateway writes a `step_up` audit row and answers `step_up_required` with the person's
   methods (`totp` if enrolled, `passkey` if registered).
2. The page fires `hk-step-up-required`; `web/shim/mantel-stepup.js` draws a small prompt in HK's
   overlay layer (`hkOverlays.root()`, HK's dialog root): the authenticator code
   (`POST /api/auth/totp/step-up`) or the passkey (`POST /api/auth/passkey/options` + `/verify`, which
   steps up a signed-in session). P3.1 marks the session's `fresh_factor_at`.
3. The page sends the same command again. The gateway re-reads the session row **at every command**,
   so the fresh factor counts at once; after 300 s it asks again (tested at 299 / 301 s).
4. **A wall tablet alone** (`person_pin_required`) gets `methods: ["pin"]` (once anyone has a PIN;
   `[]` before that): the prompt shows a PIN pad, the PIN goes back inside the same command
   (`step_up`), the server finds which person it belongs to and decides that one command as person ∩
   tablet; the audit row names the person. Done in `docs/phase3/PINS-AUDIT.md` (originally the
   continuation point here).

Note (P3.1's semantics, unchanged): a sign-in is itself a fresh factor, so for five minutes after
signing in a sensitive action needs no second prompt.

## The audit (`migrations/0004_audit.sql`, `action_audit`)

| Column | |
|---|---|
| `id`, `timestamp` | |
| `actor`, `actor_name`, `role` | the user (id, name, role at the time); `mantel` for the server's own notifications; NULL for a device alone |
| `device`, `device_role` | the wall tablet, if any |
| `kind` | `service`, `ws`, `http`, `ma`, `config` (RBAC REST changes), `system`, `tablet` (a wall tablet's Reload or Clear Cache sent to its kiosk app directly: docs/phase8/KIOSK.md section 12; migration 0019) |
| `action`, `target` | `lock.unlock` / a WS type / `POST /api/x` / an MA command; JSON list of entity ids or `feature:<name>` |
| `decision`, `reason`, `sensitive` | `allowed` / `denied` (`step_up` only on rows from before decision 25); the engine's or gateway's reason; the sensitive kind |
| `door`, `source_ip` | `lan` / `tunnel`; the client IP (X-Forwarded-For only from trusted proxies) |
| `step_up`, `step_up_age` | since decision 25: `alarm_pin` (age 0) on an alarm command the house Alarm PIN allowed, else empty. Older rows: the step-up factor (`totp`, `passkey`, `pin`, …) and its age |
| `result`, `result_at` | NULL until HA answered; `ok`, `error:<code>`, or `not_sent` (denied/step-up rows) |

Rules: the row is written **before** anything is sent, and a failed insert refuses the command
(`audit_unavailable`, tested); a trigger forbids DELETE (since migration 0007: except rows older than
the retention window, by the logged maintenance path only; PINS-AUDIT.md), and UPDATE is allowed only
to write `result` once, from NULL (tested); service data is never stored (it can carry an alarm code). The forward
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
  (refused locally unless enabled), `command_result` / id'd errors resolve the
  waiting command; a lost socket answers waiting commands `unavailable` (none is re-sent).
* `mantel-client.js`: a port made after `capabilities` said `commands: true` gets `actions`
  (`callService` with HA's signature, `callWS`, `request` answering a `Response` like
  `fetchWithAuth`); they send only gateway `command` messages through the hub. `liveSocket(speaker)`
  sends one `talk_live` command and resolves Mantel's `/ws/talk` and the ticket, or refuses quietly
  (`live_unavailable`, no toast): the doorbell card then sends its recorded clip ("Doorbell
  talk-back"). Every
  other port has no actions: hkClient refuses (`commands_disabled`) and `port.refused` is told, as
  before. `home.js` hands over the hub and republishes the snapshot when capabilities arrive.
* `mantel-host.js`: a toast for a denied command (and "No Alarm PIN is set in Mantel yet" for
  `alarm_pin_not_set`). There is no step-up prompt or PIN pad (decision 25; `mantel-stepup.js` removed):
  a `step_up_required` reply, which only an older server sends, is a plain refusal.
* The HA build is untouched (`hosts/ha/` not edited; all HA suites green).

## E2E against the scratch HA (`tools/e2e/gateway_e2e.py`)

`testha.py up --fresh` (127.0.0.1:8124, `demo` devices only), Mantel in-process with
`commands_enabled=True` and the scratch HA's throwaway credential (traded for an access token from
`<TESTHA_DIR>/testha.json`, never printed), a temp database and secrets; people created through
Mantel's own APIs; `testha.py down` at the end.

**Rerun for decision 25 (2026-10-18, night): 37/37 checks passed.** The Adult unlocks `lock.front_door`
and opens `cover.garage_door` with no PIN and a stale factor (audit: allowed, sensitive lock / garage, no
step-up); the Kitchen tablet alone unlocks `lock.kitchen_door` with no PIN (audit names the tablet), a
`step_up` PIN sent along is refused `invalid_command` with nothing sent, and a lock it has no grant for is
refused; the demo alarm (`alarm_control_panel.security`, HA code 1234) with a house Alarm PIN set in
Mantel refuses no code, a wrong code and the alarm's own HA code (nothing sent), refuses a Child by role
even with the right Alarm PIN, and arms (`armed_home`) and disarms with the house Alarm PIN, Mantel adding
the HA code (audit `step_up` = `alarm_pin`; the PIN never in the audit); a remote (tunnel) unlock with no
step-up still notifies the Owners; all 21 commands have audit rows; the audit API returns the run's 24 rows.

The first run (before decision 25), kept as history: **24/24 checks passed.**

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
(Decision 25 rewrote the step-up and PIN tests to the new rule: unlock and the garage go through with no
PIN at a wall tablet, on HA's sidebar and on the tunnel, with their audit rows; a Child is still refused by
role; the alarm takes only the house Alarm PIN, with its lockout.)

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

## Doorbell talk-back (added 2026-10-18, CUTOVER.md item 13)

**What HK does in HA today** (`web/hk/cards/hk-cameras.js`, `HkDoorbellCard`; `hosts/ha/.../talk.py`,
`talk_live.py`). The doorbell sheet's hold-to-talk button (drawn only when the card has a `speaker`
and the page is secure, because the microphone needs https) does two things on every press:

1. **Live talk** (`talk_live.py`, UniFi Protect speakers only, unless the card says `live: false`): a
   Worker opens its **own** WebSocket to HA with an access token from
   `client.actions.liveSocket(speaker)` (`{url, token()}`), subscribes `hk_frontend/talk/live {entity_id: <speaker>, rate}`, gets
   `{handler_id}` back, then sends binary frames `[handler_id][s16le mono PCM]` every 40 ms;
   `unsubscribe_events` is "let go". HA paces the PCM into Protect's talkback session.
2. **The recorded clip**, kept all the while as the safety net: a `MediaRecorder` clip (≤ 30 s,
   `audio/webm;codecs=opus` on Chrome/Android, ogg on Firefox, mp4 on Safari, ~32 kbit/s). If live
   never started (or failed), release sends it:
   `client.actions.request('/api/hk_frontend/talk?entity_id=<speaker>', {method: 'POST', body: <Blob>,
   headers: {'Content-Type': <the recorder's type>}})`. HA's talk view checks the target is a
   `media_player`, the type is one of its `AUDIO_TYPES`, 200 B ≤ size ≤ 3 MB, keeps the clip in memory
   for 120 s and calls `media_player.play_media` on the speaker with a signed URL of the clip; the
   speaker's integration fetches and plays it. Answer: `{"ok": true, "bytes": N}`.

**Through Mantel (built): the recorded clip is the gateway's one binary upload.**

* **The page** (`web/shim/mantel-client.js`, the shared card unchanged): `actions.request` with a
  `Blob` body is accepted only for `POST` to `/api/hk_frontend/talk?entity_id=media_player.<name>`
  with an `audio/*` type from the list below and ≤ 512,000 bytes; the Blob is read and sent as
  base64 inside the usual gateway command (`content_type` = the bare type, `body_b64`). Anything else
  binary is refused locally (`unsupported_body` / `body_too_large`), nothing read or sent. (There is no
  step-up since decision 25; before it, the same clip was sent again after the prompt.) `liveSocket(speaker)`
  is live talk (below); whenever it cannot start, it refuses quietly (`live_unavailable`, no toast, no
  prompt) and the card goes on as a clip. With commands off the port has no `request` and no
  `liveSocket`: hkClient refuses (`commands_disabled`), nothing sent.
* **The allowlist** (`ha_client.py`, checked by the gateway's `talk_command` and again by
  `HaCommander.upload` / `check_upload` with its own one-shot `upload` ticket): exactly
  `^/api/hk_frontend/talk\?entity_id=(media_player\.[a-z0-9_]+)$` (one entity, no other query),
  `POST` only, `audio/webm|ogg|mp4|mpeg|aac|wav|x-wav` (talk.py's `AUDIO_TYPES`; parameters such as
  `codecs=opus` are dropped and the bare type is forwarded), strict base64, 200 B to 512,000 B
  (`UPLOAD_MAX_BYTES`: the card's longest hold is ~120 KB; as base64 the frame stays under the hub
  socket's 1 MiB limit). No other path can ever carry bytes. The bytes are forwarded as the raw
  body with that type and Mantel's HA credential; the clip is never stored or logged.
* **RBAC: two checks, both must pass.** `media_player.play_media` on the speaker (what HA will do
  with it: `control` on that entity), and `camera.talk` on feature `cameras` (talking at the door is
  part of the doorbell, so it follows the camera rules). The audit target is
  `["<speaker>", "feature:cameras"]`.
* **Sensitive: yes, kind `camera`** (decision for Avery). It speaks for the household to whoever is
  at the door, so it gets exactly the camera live-view treatment: no PIN and no step-up on any door
  (decision 25; before it, the LAN skipped the step-up via `LAN_STEP_UP_EXEMPT` and the tunnel asked for a
  fresh factor within 300 s); on the **tunnel** (and the `ha` door under tunnel rules) the role's
  `tunnel_sensitive` **and** `tunnel_cameras` switches decide; a Child
  or Guest (cameras denied) is refused whatever their media-player grants; a remote talk does not
  notify the Owners (only locks and alarms do).
* **Wall tablets**: the camera half passes for every tablet (`HOUSE_GRANTS`). The speaker half: every
  wall tablet may `control` **the doorbell's talk-back speaker(s), for talk only**, with no Owner
  grant (decision for Avery, 2026-10-18; it replaces "an Owner grant per speaker"). The speakers are
  derived from HK's own settings: every pop-up of kind `camera` (HK's doorbell pop-up: its camera and
  its `speaker`, hk_core `settings.model.popup`; Mantel's settings store keeps them as the house
  document `popups`, written by the settings import and HK's settings page). `authz.talk_policy` is
  the house policy plus one grant per such speaker (`allow control entity <speaker>` for the role
  `wall_tablet`), computed like `HOUSE_GRANTS` but used **only** for the two talk-back checks (the
  clip and live), so a tablet outside the speaker's room still cannot change its volume, play to it
  or turn it off. Rename or remove the pop-up's speaker and the grant follows at the next command.
  **An Owner adjusts it** with an ordinary grant, and an explicit deny wins: `POST /api/rbac/grants
  {"effect":"deny","actions":["control"],"resource_kind":"entity","resource":"media_player.<speaker>",
  "roles":["wall_tablet"]}` (or `"devices":["<device id>"]` for one tablet). A speaker no pop-up
  names still needs an allow grant as before; a tablet in the speaker's room needs nothing.
* **Audit and the off switch** are the gateway's: the row (`kind` http, `action`
  `POST /api/hk_frontend/talk`, `sensitive` camera) is written before anything is sent and a failed
  insert refuses; refused uploads are audited `denied / not_sent`; HA's refusal (`http_4xx/5xx`) is
  the row's result and the page's `Response` status. With commands off the server answers
  `commands_disabled` exactly as for any command, no row, nothing sent.

**Live talk (built 2026-10-18, `talk_relay.py`).** It does not fit one gateway frame (a stream of
~25 binary frames a second for up to two minutes, on a socket HK's Worker opens itself and speaks HA's
protocol on), so the gateway issues a ticket and a relay of its own carries the stream:

1. **The ticket.** The card asks `client.actions.liveSocket(speaker)` (the shared card now names the
   speaker; HA's adapter ignores it). Mantel's port sends ONE gateway command
   `{"kind": "talk_live", "speaker": "media_player.<name>"}`. It is decided exactly as the clip (the
   same two checks with the talk-back policy, the camera rules, `sensitive` camera), the audit row
   (`kind` ws, `action` `hk_frontend/talk/live`, targets `[speaker, feature:cameras]`) is written
   FIRST, and the answer is `{"ticket": <32 random bytes>, "expires_in": 10}`: bound to that
   connection's identity (session, user, device), that speaker and that row, valid 10 s, spent once.
   Live never prompts: a refusal, commands off, or anything but a ticket rejects quietly
   (`live_unavailable`) and the press goes on as the clip, which says any refusal itself. (Before
   decision 25 a stale tunnel factor also fell back to the clip, which asked for the step-up.) A
   `step_up` field on any command, `talk_live` included, is refused (`invalid_command`). `hk_frontend/talk/live` as a plain `ws` command is refused
   (`unsupported_command`), and the command connection's guard refuses the type too.
2. **The socket.** `liveSocket` resolves `{url: hub.talkUrl(), token: () => ticket}`;
   `hub.talkUrl()` is `wsUrl('/ws/talk')`, so under HA's Ingress prefix too. `GET /ws/talk` is behind
   the sign-in like `/ws`: a session (cookies), an `Origin` header (required) whose value
   `loopback_only` checks (the Ingress host rule included); a Worker's socket carries the page's
   cookies and origin. With commands off it answers 403 `commands_disabled` before the upgrade (no
   relay exists, nothing is opened). It speaks the part of HA's protocol the Worker uses:
   `auth_required` -> `auth` with the ticket -> `auth_ok` (wrong, spent, expired or another
   identity's ticket: `auth_invalid`, closed 1008, and the row's result says why).
3. **ONE subscription**: exactly `{id, type: "hk_frontend/talk/live", entity_id, rate}` with the
   ticket's speaker and a rate talk_live.py accepts; anything else answers a failed `result` and
   closes (1008). One live talk per person and per tablet at a time (`busy`). The session and device
   are re-read first.
4. **Mantel's own HA socket** (`HaCommander.talk_link` -> `ha_client.HaTalkLink`, made only on the
   command path, with a one-shot `talk` ticket bound to the row; the HA credential stays inside it).
   It can send exactly: the auth frame; `{"id": 1, "type": "hk_frontend/talk/live", "entity_id":
   <that speaker>, "rate": <that rate>}`; binary frames `[HA's handler id][PCM]`; and one
   `{"id": 2, "type": "unsubscribe_events", "subscription": 1}`. HA's result and events are relayed
   with the client's id; HA's handler id is replaced by `1` (the page never sees HA's).
5. **Frames.** Binary `[1][even-length s16le PCM up to 100 ms at the rate]`; another handler id, an
   empty, odd or oversized frame closes the socket (1008; the socket reads at most 19,201 bytes).
   **Rate cap**: a token bucket of 1.25 x the declared PCM rate with one second of burst; the excess
   is dropped (HA trims a backlog anyway). The only text frame accepted after the subscription is the
   one `unsubscribe_events` for it ("let go"); anything else closes the socket.
6. **The end.** On unsubscribe, either side closing, **120 s** (talk_live.py's own cap), or the policy
   tick finding the session or device revoked: Mantel lets go on HA's side (HA plays out its cushion),
   closes both sockets, and writes the row's result: `ok`, `ok:max_session`, `error:<HA's code>`
   (`not_supported`: not a Protect speaker), `error:ha_failed` (HA's mid-stream error event, relayed
   to the Worker, which then sends the clip), `error:unauthenticated`, `refused:<why>`, or
   `error:ticket_unused` / `ticket_expired` / `ticket_other_identity`. Nothing of the audio is stored
   or logged (counts and the duration only).

The recorded clip stays the safety net exactly as in HA: if live never started (or failed), release
sends the clip through the gateway (above).

**Verified (live talk).** Unit: `tests/test_talk_live.py` (34, a full app with a loopback stand-in for
HA's talk_live WebSocket): the audit row before the ticket and nothing opened to HA until the socket;
the exact frames HA receives (Mantel's credential, the subscription, the PCM with HA's handler id, one
unsubscribe) and nothing else; the ticket single-use, expiring, bound to who asked, garbage refused;
another speaker, other subscriptions and other text frames refused; another handler id, empty, odd and
oversized frames close the socket; the rate cap; the 120 s cap (shortened); one at a time per person;
HA's refusal and a mid-stream failure relayed and recorded; the page going away lets go; a revoked
session closed at the policy tick; Child and Guest get no ticket (a stale tunnel factor does since decision 25); wall tablets
talk (clip and live) on the speaker HK's doorbell pop-up names, nothing else on it, and an Owner's deny
wins; commands off (no ticket, `/ws/talk` 403); the upgrade's session and Origin rules; the guards
(classification, `check_command`, `check_talk`, `HaTalkLink`); and **HK's own talk Worker** (the exact
`TALK_WORKER` source, run in node by `tests/talk_worker_harness.mjs`) streaming through `/ws/talk`, and
falling back when live cannot start. `tests/test_shim_talk.py` (now 10): `liveSocket(speaker)` is one
`talk_live` command the server classifies, the Worker gets `/ws/talk` and the ticket; refusals and
a `step_up_required` from an older server are quiet, nothing re-sent; `talkUrl()` under the Ingress prefix. **Against the scratch HA**
(`tools/e2e/talk_e2e.py`, 19/19 with the clip checks, 2026-10-18): the Owner's ticket, then HK's Worker
through Mantel to the scratch HA's REAL `hk_frontend/talk/live`, whose schema took the subscription and
which refused the demo player (`not_supported`), the Worker told so (the card sends the clip, which
went through), the row `error:not_supported`, the spent ticket refused; the **streaming** checked with
HA's side stood in (the demo has no Protect speaker, so talk_live.py cannot open a session): 10 frames
of 40 ms reached "HA" with its handler id, then one unsubscribe, row `ok`; a Kitchen tablet talks
(clip and live) once HK's doorbell pop-up names the speaker, and the Owner's deny wins. **Not
verified**: a real UniFi Protect doorbell hearing a live stream through Mantel, and the card in a
browser with a real microphone.

**Verified (the clip).** Unit: `tests/test_gateway_talk.py` (40: allowed and audited first; LAN Adult with a
stale factor needs no step-up; Child refused on the camera half even with the speaker in their room;
Guest; tablets by room and grant; tunnel step-up then allowed (since decision 25: the tunnel with a stale factor is allowed outright); tunnel switches `tunnel_cameras_off` /
`tunnel_lan_only`; commands off; 26 refused shapes (paths, methods, types, base64, size); refused
uploads audited; HA's refusal as the result; the command connection's own guard; `HaCommander.upload`
over real HTTP to a loopback stand-in of the talk view: exact bytes, type and bearer).
`tests/test_shim_talk.py` (7, node: the card's exact call becomes one command that `classify()`
accepts byte for byte; step-up resend (since decision 25: a `step_up_required` is a refusal, no prompt, no resend); HA's 415 as a `Response`; nothing else binary sent; quiet live
refusal; commands off). **Against the scratch HA** (`tools/e2e/talk_e2e.py`, 11/11, 2026-10-18; the
built hk_frontend's real talk view, a demo media player standing in for the doorbell speaker since the
demo has none, a fictional clip): the Owner's clip went through Mantel and HA answered
`{"ok": true, "bytes": 4004}`; HA told the speaker to play the clip's signed URL; fetching that URL
without a token (as the speaker's ffmpeg does) returned the same 4,004 bytes as `audio/webm`; the
audit row; a Child refused and nothing sent; a Kitchen tablet refused until the Owner's speaker grant,
then allowed with no PIN; a tunnel Adult with a stale factor asked to step up, nothing sent (since
decision 25 talk_e2e checks that this Adult talks with no step-up); a binary
body to another path refused. **Not verified**: a real UniFi Protect doorbell playing a clip sent
through Mantel, and the card in a browser against Mantel with a real microphone.

## The alarm: HK's Alarm PIN in Mantel (added 2026-10-18)

HK's keypad card (`web/hk/cards/hk-security.js`) is unchanged: it calls
`alarm_control_panel.alarm_<x>` with `{entity_id, code}` and shows "Wrong code" for a refusal whose
message mentions a code. In HA, HK's Alarm PIN feature (`hk_frontend/features/alarm_pin`) checks that
code (a PBKDF2 hash, constant-time compare) on a second panel in front of an alarm that takes no code.
Disarming always needs it; arming only while "Require the PIN to arm" is on. In Mantel the gateway and
`alarm_pin.py` do the same job:

1. **The code comes out first.** `service_command` takes `code` out of any `alarm_control_panel.alarm_*`
   command (service, `ws` `call_service`; the `/api/services/...` HTTP form is refused) before anything
   is audited, logged or sent. The command must name exactly one alarm panel, and its data may carry
   only `entity_id` and `code`.
2. **RBAC first.** The command's own check runs on the keypad panel *and* on the alarm it forwards to.
   When a code is needed (disarm, arm while `arm_required`, or any code given), `control.sensitive` is
   checked on both as well — before the code is looked at, so a refused role learns nothing about it and
   never counts toward a lockout. A Child is refused whatever they type (the alarm domain is denied).
   Wall tablets get `control` + `control.sensitive` on configured keypads (`tablets`, on by default, as
   HK's keypad is on every screen), only for keypad commands (`AlarmPins.keypad_policy`). An Owner's deny
   grant still wins.
3. **Mantel checks the code** (`AlarmPins.check` → `Pins.keypad`): **the house Alarm PIN** for that keypad
   (Argon2id, table `alarm_pins`, migration 0010) — the only PIN in Mantel (decision 25). A person's own
   PIN is not a code here (same digits as the Alarm PIN: fine). Wrong codes are counted where they are
   typed: at a tablet `device:<id>`, on a session `keypad:user:<id>`, linked mode `keypad:mantel:linked`;
   there's also a per-IP limit. 5 wrong codes in a row lock that place for 15 minutes. A wrong code answers
   `invalid_code` ("Wrong code"), a lockout `code_locked` (+ `retry_after`), a missing one
   `code_required`, a keypad with no Alarm PIN set `alarm_pin_not_set`. Each gets a `denied` audit row
   (`alarm_code_invalid|locked`, `alarm_code_required`, `alarm_pin_not_set`) and nothing is sent.
4. **The same on every door** (decision 25). The house Alarm PIN is all the alarm asks for, on the LAN,
   a wall tablet, HA's sidebar (trusted or under tunnel rules) and the tunnel; no fresh factor on top.
   (Before: a person's PIN named them and was decided as person ∩ tablet; the house code counted as the
   factor only on the LAN rules door, and the tunnel wanted the person's own fresh factor too.)
5. **The audit row comes first** (`sensitive: alarm_control_panel`, `step_up: alarm_pin` when the code was given,
   targets `[panel, alarm]`). Then the command goes to the **alarm itself** (`forward_to`). If that
   panel reports a `code_format`, it carries **the alarm's own HA code from Mantel's store** (`ha_code`,
   AES-GCM sealed with Mantel's key), never the page's. If no code is held, the answer is
   `alarm_ha_code_missing` and nothing is sent.
6. **Owner notice:** a disarm through the tunnel, or through the `ha` door under tunnel rules, notifies
   the Owners as before. There's none for the trusted `ha` door.
7. **Every alarm command takes this path** (decision 25). A command naming the protected alarm itself is
   guarded by the keypad that protects it (`AlarmPins.entry_for`). An alarm no keypad covers has no
   Alarm PIN, so whatever needs a code is refused (`code_required` / `alarm_pin_not_set`) and never sent.
   (Before, such an alarm took the ordinary path with a step-up; with no step-up that path would have
   disarmed on roles alone.) With no keypad engine in the app, every alarm command is refused
   (`alarm_pin_unavailable`).
8. **Commands off:** the server answers `commands_disabled` as for every command (no gateway exists).
   Everything up to "would send" is exercised in `tests/test_alarm_pin.py` with the fake connection.

**Settings (REST, Owner/Admin, fresh factor; a PIN or code is never returned):** `GET /api/alarm/pins`,
`PUT /api/alarm/pins/{entity}` `{forward_to, pin, pin_again, arm_required, tablets, ha_code}` (the PIN
typed twice, 4–10 digits; `pin: null` removes the house code), `DELETE /api/alarm/pins/{entity}`,
`POST /api/alarm/pins/import`. The import reads HA's `hk_alarm_pin/settings/get`, a server-only read
(`readproxy.SERVER_ONLY_READS`), and makes each Alarm PIN panel a keypad that forwards to the alarm it
protects, with the arm rule. **HA never gives out its PIN or hash**, so the house code is set again in
Mantel (`need_pin`); until then the keypad refuses whatever needs a code. Changes are audited as `config` rows that
name the fields, never the values.

**Linked mode** (2026-10-18: one code path). `linked_house.LinkedHouse._alarm`, the handler for HA's
forwarded `alarm_*` on the linked Alarm PIN panel, only calls
`alarm_pin.linked_command(app, entity=, command=, code=, account=, peer=)`. That runs the command
through this same gateway path as the Service actor `mantel:linked`, with grants on configured keypads
only and wrong codes counted at `keypad:mantel:linked`. The house code works there as at a tablet; a
person's own PIN does not (decision 25; before, it named them as the audit's actor). Steps 1–8 above
apply unchanged. In particular, **the
typed code is never sent to HA**: the alarm's own code comes only from Mantel's store. (The earlier
linked handler had its own path, which would have passed a person's PIN on as the alarm's code. It is
gone.) The gateway's refusals become linked wire codes in one place, `alarm_pin.linked_error`:
`invalid_code` ("Wrong code"), `code_locked`, `code_required`, `alarm_pin_not_set`, `forbidden`,
`commands_disabled`, `alarm_ha_code_missing`, `alarm_pin_unavailable`. **Which alarm** the linked
panel forwards to is its `alarm_pins` row. That row is authoritative. linked_house creates it from HA's
registry `protects` only when none exists, with `tablets` off, no house code and a `config` audit row.
After that the row wins over HA's attribute for the mirror too (docs/phase5/LINKED-MODE.md).

The page (`web/shim/mantel-client.js`): `invalid_code` / `code_locked` / `code_required` are the card's
to show, so there's no "Not allowed" toast on top (`tests/test_shim_alarm.py`, node harness);
`alarm_pin_not_set` toasts "No Alarm PIN is set in Mantel yet (HK Settings, Alarm PIN)".

## Decisions (made here; Avery may revisit)

1. ~~**Camera live view needs no step-up on the LAN door** (`authz.LAN_STEP_UP_EXEMPT`)~~ — moot since
   decision 25: nothing has a step-up on any door. On the tunnel the role's `tunnel_cameras` switch still
   decides.
2. **Wall tablets may view and live-view every camera** (`authz.HOUSE_GRANTS`): the doorbell pop-up
   shows on every tablet whatever room the doorbell is in. Devices are refused on the tunnel anyway; a
   Child at a tablet still sees no camera (intersection).
3. A tablet with no stored area scope is scoped to its **enrolled room** (by name).
4. The door rule above (only a trusted proxy can grant `lan` by header; stricter claims honoured).
5. Area/device/floor/label targets are refused rather than expanded; entity-less services other than
   notifications and scripts are `configure` `settings`.
6. HK's own writes not otherwise mapped are `configure` `settings` (Owner/Admin) until P3.5 moves HK's
   settings into Mantel with finer rules (e.g. a tablet touching its own screensaver).
7. HTTP writes are JSON only, except the one talk-back clip (section "Doorbell talk-back"). Live talk
   is its own path: a `talk_live` ticket and the `/ws/talk` relay (same section); it never prompts for
   a step-up (and since decision 25 nothing does).
11. **Wall tablets may talk on the doorbell's speaker** (2026-10-18): the speaker(s) HK's camera
    pop-ups name, `control` for the two talk-back checks only (`authz.talk_policy`); an Owner's deny
    grant on the speaker wins. Replaces "an Owner grant per speaker".
8. P3.4's `feature:media` is decided as `music`.
9. The Owner notification covers remote **lock** and **alarm** sensitive actions (PLAN §7 says
   unlock/disarm); a remote garage open does not notify yet.
10. `capabilities` is sent only when commands are on, so a server with them off behaves byte for byte
    as before.
12. **The alarm keypad** (2026-10-18, section "The alarm"; revised by decision 25). The house's Alarm PIN
    works like HA's: anyone who knows it may use it, but within RBAC (a tablet's grants at a tablet, the
    person's own role on a session; a Child is refused). It is the only code: a person's PIN is not
    accepted, and the house code counts on every door (no step-up). Arming, when a code is needed, is
    decided as `control.sensitive`. Mantel sends to the protected alarm directly rather than to HA's
    Alarm PIN panel. Wall tablets may use configured keypads (`tablets`, default on). A Mantel house code
    is 4–10 digits (HK's keypad types digits; HA allowed any 4+ characters). With no house code set
    (`pin: null`) the keypad refuses whatever needs a code.

## Not done / open questions

* ~~A person's PIN at a wall tablet~~, ~~a PIN factor generally~~ (done, then removed by decision 25),
  ~~audit retention and an audit read API~~, ~~the packaging's `--trusted-proxy`~~: see
  `docs/phase3/PINS-AUDIT.md`.
* The tablets' read-side features: with the default roles a wall tablet has no `music`,
  `notifications` or `media` feature grant, so those reads are refused for a tablet alone (P3.2's
  model; add grants or role defaults when the tablet cutover is planned).
* MA commands through the gateway are tested with the gate only (MA stays fake-only until a scratch MA).
* The `/dev` page's endpoints `/api/stats` (top updating entity ids) and `/api/areas` (entity counts)
  are behind sign-in but not RBAC-filtered; `/api/registry` and `/api/entities` are.

## Exact continuation point

1. **Cutover (Avery):** decide on decisions 1 and 2, then run the house server with `--commands-enabled`
   (and `--trusted-proxy <caddy>` behind Caddy) only when ready; before that, run
   `tools/e2e/gateway_e2e.py` once more on the commit being deployed.
2. ~~Packaging: pass `--trusted-proxy`~~ done (`MANTEL_TRUSTED_PROXY`, Caddy's fixed backend address;
   PINS-AUDIT.md). `--commands-enabled` from the entrypoint stays a cutover decision.
3. ~~Person-at-tablet PIN~~ done (PINS-AUDIT.md), then removed by decision 25 (no PIN at a tablet).
4. ~~P3.5: HK's settings writes from the page~~ done: they go to Mantel's settings store
   (`settings_write`), never through the gateway (SETTINGS.md).
5. ~~Audit read API and retention~~ done (`GET /api/audit`, `--audit-retention-days`; PINS-AUDIT.md).
