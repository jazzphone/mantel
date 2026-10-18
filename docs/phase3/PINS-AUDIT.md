# Phase 3: tablet PINs, the audit API and retention, the trusted proxy, page settings saves (2026-10-18)

Closes the Phase 3 items left open by P3.3 (`GATEWAY.md` "Not done") and P3.5 (`SETTINGS.md`
"continuation"): **a person's PIN at a wall tablet** (PLAN §5: "sensitive actions require a person's
PIN at the tablet"), the PIN as a step-up factor generally (§7), an **Owner/Admin audit read API** and the
**audit retention window** (§7: "audit log append-only with a retention window"), **`--trusted-proxy`
in packaging** so the LAN door is recognised behind Caddy, and **HK Settings' saves from the page**.

House commands stay off by default and in every test except the scratch-HA e2e. Nothing here touched
`/Volumes/config`, 192.0.2.53 or `~/.config/mantel/ha_token`.

## Files

| File | What |
|---|---|
| `hosts/server/mantel_server/pins.py` | **New.** `Pins` (set/remove, `identify` at a tablet, `verify_user` on a person's own session, lockouts), `check_pin`, REST (`/api/account/pin`, `/api/users/{id}/pin`), `register` |
| `hosts/server/mantel_server/migrations/0006_pins.sql` | **New.** `user_pins`, `pin_lockouts` |
| `hosts/server/mantel_server/migrations/0007_audit_retention.sql` | **New.** `audit_purge` (the permit), `audit_maintenance` (append-only log), the new `action_audit_no_delete` trigger |
| `hosts/server/mantel_server/gateway.py` | `step_up` (PIN) inside a command, `_methods` offers `pin`, `Audit.query` / `purge` / `maybe_purge`, `GET /api/audit` (`register_audit`) |
| `hosts/server/mantel_server/authz.py` | `Authz.with_person` (person ∩ device for one command); `Principal.door` / `.fresh_factor_at` |
| `hosts/server/mantel_server/server.py` | registers `pins` and the audit API; the policy tick applies the retention window (hourly) |
| `hosts/server/mantel_server/config.py` | `audit_retention_days` (default 365, `--audit-retention-days`, at least 30) |
| `packaging/docker/entrypoint.py`, `packaging/compose/compose.yaml`, `packaging/compose/caddy/Caddyfile` | `MANTEL_TRUSTED_PROXY` → `--trusted-proxy`; Caddy pinned at `172.31.251.2` on the backend network; Caddy proxies to the backend-only alias `mantel-backend` |
| `web/shim/hub.js`, `web/shim/mantel-client.js`, `web/shim/mantel-stepup.js` | `hub.write` (settings saves), the client's save routing, the PIN pad and `detail.submit` |
| `tests/test_pins.py` (24), `tests/test_audit_api.py` (24) | **New.** |
| `tests/test_packaging.py` (+3), `tests/test_gateway_catalog.py` (+1), `tests/test_boundaries.py` (changed on purpose, below) | |
| `tools/headless/client_smoke.py`, `tools/headless/gateway_page_check.py`, `tools/e2e/gateway_e2e.py` | extended (below) |

**Migration numbers.** `0005` is taken by the service-accounts slice in another worktree
(`0005_service_accounts.sql`, not on this branch), so this work uses **0006** and **0007**. The runner
applies each number not yet recorded, in order, so whichever lands first the others still apply.

## A person's PIN

* **Set from the person's own session**, with a fresh factor (signed in or stepped up within 5 min) and
  CSRF: `PUT /api/account/pin {"pin"}`, `DELETE /api/account/pin`, `GET /api/account/pin` (`{"pin": bool,
  created, updated, last_used}`). An Owner/Admin may clear someone's PIN (`DELETE /api/users/{id}/pin`;
  an Admin not an Owner's). A wall tablet (device alone) gets `403 user_required`.
* **4 to 8 digits**, not a repeated digit, not a straight run (`1234`, `98765`). Stored only as an
  Argon2id hash (the accounts' hasher); never logged, never in an audit row or a frame to HA (tested).
* **A PIN names exactly one person.** At a tablet nobody is signed in, so the server checks the PIN
  against every live person's hash (always all of them, one verification at a time) and the one match
  is the person. A new PIN that is already someone's is refused (`pin_unavailable`). Disabled people are
  never matched. If two people somehow share one (only possible by editing the database), the tablet
  refuses (`ambiguous`) rather than guess.
* **Lockouts.** Wrong PINs count where they are typed: a tablet's PIN pad locks for **15 minutes after 5
  wrong PINs in a row** (stored in `pin_lockouts`, so a restart does not reset it; a right PIN resets
  it); each source IP may fail **20 times per 15 minutes**; a person's own-session PIN locks **that
  person** after 5. `pin_unavailable` answers are limited to **5 per person per 15 minutes** (429).

### At a wall tablet (the gateway)

```
-> {"type":"command","id":1,"kind":"service","domain":"lock","service":"unlock","target":{"entity_id":"lock.kitchen_door"}}
<- {"type":"step_up_required","id":1,"reason":"person_pin_required","methods":["pin"],...}
-> the same command + "step_up":{"method":"pin","pin":"2580"}
<- {"type":"command_result","id":2,"result":...,"audit_id":14}                 Adult: allowed, sent
<- {"type":"command_result","id":2,"error":{"code":"forbidden","reason":"explicit_deny"},...}   Child
<- {"type":"step_up_required","id":2,...,"pin_error":"invalid_pin"|"locked"|"ambiguous","retry_after":901}
```

1. The command is classified first (a malformed command never spends a PIN attempt), then the PIN is
   checked (`pins.identify`).
2. The person found becomes the user **for that one command** (`Authz.with_person`): the device's
   principal with that person, fresh factor `pin` stamped now. P3.2's engine then decides **person ∩
   tablet** as for anyone at a tablet: an Adult unlocks a door the tablet may unlock; a Child's PIN is
   refused by the Child's own explicit deny on locks; an Adult's PIN for a light in another room is
   refused by the tablet's side (`no_grant`).
3. The audit row names the person: `actor`, `actor_name`, `role` = the person; `device`, `device_role`
   = the tablet; `step_up = 'pin'`, `step_up_age = 0`. Wrong PINs are audited too (`denied`,
   `pin_invalid` / `pin_locked` / `pin_ambiguous`, no actor) and nothing is sent.
4. The socket keeps the tablet's own principal: the next sensitive command asks again.
5. `methods` is `["pin"]` only when someone has a PIN (else `[]`: nobody here can answer, as before).

### On a person's own session

`methods` includes `pin` when the person has one. The same `step_up` inside the command checks that
person's PIN (`verify_user`), marks their session fresh (`fresh_factor = 'pin'`, so the next five
minutes need no prompt, as with TOTP) and the command proceeds. Wrong PINs answer `pin_error`.

### The page (`web/shim/mantel-stepup.js`, `mantel-client.js`)

`hk-step-up-required` now carries `detail.submit(step)`: it sends the command again with the PIN and
resolves `{ok: true}` (the command's answer settles the caller: result, or `forbidden` and the denied
toast) or `{error, retry_after}` (the prompt stays open). The prompt draws a PIN field (`type=password`)
and a 12-key on-screen pad (a wall tablet has no keyboard); for a person with TOTP and a PIN a
"Use PIN" button switches. Messages: "That PIN was not accepted.", "Too many wrong PINs; try again in
N min.", "That PIN cannot be used here; ask an Owner." Checked in headless Chrome
(`gateway_page_check.py`): the pad appeared (title "A person needs to confirm this", 12 keys), a wrong
PIN kept it open with that message, the Child's PIN settled `forbidden` and closed it, the Adult's PIN
unlocked and the audit row named "Offline Adult" at that tablet; 0 browser exceptions.

### The alarm keypad (`Pins.keypad`, added 2026-10-18)

HK's alarm keypad sends the typed code inside the alarm command. The gateway takes the code out and
`alarm_pin.py` asks `Pins.keypad` once, with GATEWAY.md "The alarm" giving the whole flow:

* **What counts.** The house's Alarm PIN for that keypad (`alarm_pins.pin_hash`, Argon2id, set by an
  Owner/Admin) or a person's PIN. At a tablet, or for linked mode, the PIN can name anyone; on a
  session, only the signed-in person's own PIN. Both are always checked. A person beats the house code.
  Two people with the same PIN, where it isn't the house code, are refused (`ambiguous`).
* **Where wrong codes count.** Once per wrong code: at a tablet `device:<id>` (the same row as its PIN
  pad, so the two share one lockout), on a session `keypad:user:<id>` (and the person's own PIN lock
  also stops it), for linked mode `keypad:mantel:linked`, plus the per-IP limit. A right code resets the
  place. A Child's correct PIN that RBAC then refuses doesn't count, as above.
* **Never stored or shown.** The code isn't in the audit, the log, the reply or the frame sent to HA. The
  alarm's own HA code (`alarm_pins.ha_code`) is sealed with Mantel's key, and only the gateway opens it
  to build the frame.

## The audit read API

`GET /api/audit?actor=&device=&decision=&kind=&since=&until=&before=&limit=`

* newest first; `limit` 1–500 (default 100); `next` is the `before` (id cursor) of the next page, or
  null; `target` comes back as the JSON list; `retention_days` says the window;
* filters: `actor` (user id), `device` (device id), `decision` (`allowed|denied|step_up`), `kind`
  (`service|ws|http|ma|config|system`), `since` / `until` (epoch seconds, `until` exclusive);
  anything else malformed is `400 {"error":"invalid_query","param":...}`;
* **who**: a signed-in user whose subject may `configure` the feature `audit`, so with the default roles
  **Owner and Admin**; Adult, Child, Guest, a wall tablet alone and a person at a tablet get 403;
  nobody signed in gets 401.

## Retention

* `cfg.audit_retention_days` (default **365**, `--audit-retention-days`, at least **30**; less is a
  start-up error).
* **The policy tick** (every 60 s) calls `Audit.maybe_purge`, which runs `Audit.purge` at most once an
  hour.
* **`Audit.purge` is the only path that deletes**, in one transaction: it writes a permit
  (`audit_purge`, one row, the cutoff), deletes rows with `timestamp < now − window`, removes the
  permit, and logs it twice: an `audit_maintenance` row (cutoff, window, how many, first/last id;
  that table is itself append-only) and an `action_audit` row (`kind 'system'`, actor `mantel`, action
  `audit.purge`, reason `retention:365d deleted:N ids:A-B`). Nothing to delete: no rows written.
* **The trigger (migration 0007)** allows a DELETE only when the permit exists **and** the row is older
  than its cutoff **and** the row is older than 30 days by SQLite's own clock, so even a wrong cutoff
  (a clock gone wrong) cannot reach recent rows: the whole purge rolls back (tested). Rows inside the
  window keep P3.3's rules: no DELETE, `result` written once from NULL.
* A failing purge is logged and never stops the tick.

## Trusted proxy (packaging)

Mantel believes `X-Mantel-Door: lan` only from a peer listed by `--trusted-proxy`, compared exactly by
address (P3.3). The compose stack now makes Caddy's address on the backend network fixed and certain:

* `backend` network: `ipam` subnet `172.31.251.0/28` (still `internal: true`); Caddy `ipv4_address:
  172.31.251.2` there.
* Mantel has the alias `mantel-backend` **on the backend network only**, and both Caddy doors
  `reverse_proxy mantel-backend:8765`; Caddy and Mantel also share `egress`, and by service name Docker
  could have answered with the egress address, making the source address unpredictable.
* `mantel-server` gets `MANTEL_TRUSTED_PROXY: 172.31.251.2`; `entrypoint.py` turns each address in it
  into `--trusted-proxy` (validated as an IP: a service name would never match a peer, so it is a
  config error). Unset: no flag, a start-up warning, and every request is the tunnel door (fail closed).
* Static tests: the entrypoint's flags parse into `cfg.trusted_proxies`; the compose file's trusted
  address equals Caddy's backend address, is inside the backend subnet and not the tunnel's; the alias
  is backend-only; both Caddy upstreams are `mantel-backend:8765`; `resolve_door` gives `lan` for
  Caddy's address with `lan`, `tunnel` for any other peer or claim, and `tunnel` without the flag.
  `tools/package_check.py` is clean. (Running the stack still needs Docker.)

## Settings saves from the page

See `SETTINGS.md` "Update: saves from the page": `hub.write` → `settings_write` → `settings_result`;
the client routes exactly `SETTINGS_SAVES` to the store (commands off: the only action the port has;
commands on: never through the gateway); every house command is still refused or gated as before.

## E2E against the scratch HA (`tools/e2e/gateway_e2e.py`)

Run 2026-10-18 on this branch: **38/38 checks passed** (the 24 of P3.3 plus 14 new). New checks:

```
PASS the Adult and the Child set their PINs from their own sessions (PUT /api/account/pin)
PASS the tablet now offers a PIN pad (methods: pin)
PASS a Child's PIN at the tablet is refused (explicit_deny); nothing sent, still locked
PASS the refused unlock's audit row names the Child at the tablet
PASS a wrong PIN keeps the PIN pad open (pin_error invalid_pin)
PASS an Adult's PIN at the tablet unlocked lock.kitchen_door: HA says unlocked
PASS the unlock's audit row names the Adult at the tablet (step_up pin, result ok)
PASS the PIN counted for that one command only
PASS an Owner's settings save through the socket persisted (v1); nothing sent to HA
PASS a Child's house settings save is refused (forbidden) and changes nothing
PASS GET /api/audit returns the run's 20 rows, newest first (Owner)
PASS the audit API filters by device and decision (the Adult's PIN unlock at the tablet is there)
PASS the audit API pages (limit + before)
PASS an Adult and a wall tablet may not read the audit (403)
```

Sent to HA, in order: `light.toggle, light.toggle, lock.unlock, light.toggle, lock.lock, lock.unlock,
lock.lock, lock.lock, lock.unlock, persistent_notification.create, lock.lock`. The new audit rows:

| id | who | device | action | target | decision | reason | step_up | result |
|---|---|---|---|---|---|---|---|---|
| 11 | (tablet) | wall_tablet | lock.unlock | lock.kitchen_door | step_up | person_pin_required | | not_sent |
| 12 | Fictional Child (child) | wall_tablet | lock.unlock | lock.kitchen_door | denied | explicit_deny | | not_sent |
| 13 | (tablet) | wall_tablet | lock.unlock | lock.kitchen_door | denied | pin_invalid | | not_sent |
| 14 | Fictional Adult (adult) | wall_tablet | lock.unlock | lock.kitchen_door | allowed | granted | pin | ok |
| 15 | (tablet) | wall_tablet | lock.unlock | lock.kitchen_door | step_up | person_pin_required | | not_sent |

## Tests and validation

* `~/.venvs/mantel/bin/python -m pytest -q` → **1395 passed** (1343 before; 52 new: `test_pins.py` 24,
  `test_audit_api.py` 24, `test_packaging.py` 3, `test_gateway_catalog.py` 1).
* `tools/build_ha.py` + `tests/run` → all suites green (126 PASS); the HA build is unaffected
  (`hosts/ha/`, `web/client/` untouched; `web/shim/` is not in the HA build).
* `tools/headless/client_smoke.py` → passed (0 external requests, 0 browser exceptions).
* `tools/headless/gateway_page_check.py` → passed (it had been broken since P3.5 changed
  `OfflineReads(app, identity)`; fixed here and extended with the PIN pad and the commands-on save).
* `tools/e2e/gateway_e2e.py` → 38/38.

Covered by `tests/test_pins.py`: PIN rules; set/change/remove from the person's session, hashed; needs a
fresh factor, CSRF and a person (a tablet cannot); no shared PINs and the probing limit (429, then
fine after the window); Owner/Admin clearing; Adult's PIN at a tablet unlocks, the audit names the
Adult and the tablet, the PIN is never forwarded or stored, for one command only; a Child's PIN cannot
unlock (and is not counted as a wrong PIN); person ∩ tablet (another room refused); wrong PINs lock the
pad after 5, even the right PIN is then refused, the lock survives a new `Pins`, and lifts after 15
min; no PIN anywhere → `methods: []`; malformed `step_up` refused; disabled people not matched; a
shared PIN refused as `ambiguous`; the PIN as an own-session factor (fresh afterwards) and its own
lockout; commands off → `commands_disabled` exactly as before. `tests/test_audit_api.py`: filters,
order, pages, Admin yes / Adult, Child, Guest, tablet no / anonymous 401, bad queries; retention deletes
only older rows and logs it; rows inside the window stay append-only with or without a permit; the
30-day floor by the database's clock; the window ≥ 30 days; the tick purges at most hourly and survives
a failing purge; the audit never holds a PIN or service data.

Changed on purpose: `tests/test_boundaries.py::test_mantel_host_has_no_action_transport` now expects two
`port.actions =` assignments (the commands-on gateway port, and the commands-off port whose only action
is the settings save through `hub.write`), and pins that the latter has no `callService`, `request`,
`liveSocket` or `hub.command`.

## Decisions (made here; Avery may revisit)

1. **The PIN travels inside the command** (`step_up`), not through a separate REST step-up: the person
   is named and the command decided in one step, nothing about a "person at the tablet" is held
   between requests, and a wrong PIN simply asks again.
2. **A PIN names one person, so PINs are unique**; a taken PIN is refused with `pin_unavailable`. That
   answer tells the person setting it that *someone* has that PIN (not who), so it is limited to 5 per
   15 minutes. The alternative (allowing duplicates and asking "who are you?" at the tablet) would
   need a person picker on the tablet; not chosen.
3. **A correct PIN of someone who may not do it** (a Child's) is refused with `forbidden` and audited
   with that person's name, but does **not** count toward the tablet's lockout (so a child pressing
   their own PIN cannot lock the adults out). Wrong PINs do count.
4. **The tablet's lockout belongs to the tablet** (wrong PINs name nobody); a locked pad refuses even a
   right PIN for 15 minutes. A child can therefore lock a tablet's pad for 15 minutes with five wrong
   PINs; the adults can still use their own phones.
5. **4–8 digits** (as HK's alarm PIN feature), with the obvious ones refused.
6. **Reading the audit is `configure` on feature `audit`** (Owner, Admin by default). `view`/`history`
   would have let Adults in: their "whole house" grant (`all`, no domains) also covers features.
7. **Retention default 365 days, minimum 30**; the purge runs hourly from the policy tick and writes a
   record only when it deleted something.
8. **Caddy's backend address is fixed in compose** (`172.31.251.2`, subnet `172.31.251.0/28`) and Caddy
   reaches Mantel by a backend-only alias, rather than resolving a service name at start-up (Caddy
   starts after Mantel, and the shared `egress` network would make the source address unpredictable).

## Open / continuation

* **HA App mode**: requests arrive through Supervisor's Ingress proxy; the entrypoint passes no
  `--trusted-proxy` there yet (so every request is `tunnel`, fail closed). Decide how the App's doors
  map (Ingress has no wall-tablet door) before tablets use the App.
* PIN management UI in HK Settings (the REST is there; nothing in the page sets a PIN yet).
* An Owner notification for repeated PIN lockouts at a tablet (logged as a warning today).
* The image build/run still waits for Docker.
