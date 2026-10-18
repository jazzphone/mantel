# Phase 5: linked mode — `hk_frontend` "Linked to Mantel Server" (2026-10-18)

PLAN.md §6 (what stays in Home Assistant), §5 ("Service" role), §7 (identity, secrets, doors). The
house's automations, scripts and history depend on things HK puts into HA: three actions and 31
entities. Linked mode keeps all of them, with the same domain, unique ids and entity ids, after HK
moves to Mantel Server. Each action is forwarded to Mantel and the entities' states are pushed from
Mantel. This is step 1 of §6's plan, "at cutover, change nothing."

Everything here was built and tested against fakes, the HA test harness, and a Mantel endpoint on
127.0.0.1. No real Home Assistant or house was contacted. `server.py`, `gateway.py`, `ha_client.py`
and `web/` are untouched.

## The option (HA side)

**Settings → Devices & services → HK Frontend → Configure → Linked to Mantel Server.** It's a page
of the existing Configure menu. There is no second integration: a second one couldn't register the
same `hk_frontend.*` action names.

| Field | Stored | Notes |
|---|---|---|
| Linked to Mantel Server | presence of `entry.data["mantel_link"]` | **Off by default.** Turning it off removes the key. |
| Mantel Server's address | `entry.data["mantel_link"]["url"]` | `https://host[:port]` (or `wss://`). With no path it means `/linked/ws`. No user, query or fragment. Plain `http://`/`ws://` is accepted only for 127.0.0.1/localhost/::1 (`mantel_url_insecure`), so the credential never crosses the network in clear. |
| Service credential | `entry.data["mantel_link"]["token"]` | A Mantel Service account's (scope `linked`). It's never shown again: left empty, the saved one is kept. |

- **Where it's stored.** The link lives in the entry's **data**, not its options. The options are the
  dashboard settings, which the settings model reads, lifts and tidies.
- **On disk.** Home Assistant writes entry data to `.storage/core.config_entries` in plain text, as it
  does every integration's token. Anyone who can read that file, or a backup of it, can open the
  link. It's never logged, never in `repr`, and never in diagnostics (which show only `linked`,
  `url`, `connected`, `entities` and `last_error`). It's revoked on Mantel's side in one step.
- **Saving reloads.** The entry's update listener reloads it, into or out of linked mode.

**Not linked = today's behaviour, exactly.** `linked_mode.configured(entry)` is false without the key,
and then every path is the one that existed before:

- `async_setup_entry` and `async_unload_entry` take the old route.
- `show_popup` and `close_popup` check the pop-ups locally.
- Each platform adds its own entities.
- No link is ever started (pinned by `test_not_linked_is_the_default_and_nothing_changes`).
- The existing suites pass unchanged. The one deliberate test edit is `test_configure.py`: Configure's
  menu now lists `linked`.

**Linked.** `async_setup_entry` hands over to `linked_mode.async_setup_entry` right after the
feature-entry check. It starts the link (an entry background task) and forwards the same `PLATFORMS`.
Each platform calls `linked_mode.attach(...)` and adds Mantel's entities instead of its own.

Nothing local runs that Mantel now does:

- the features (Music, Live TV, Clean Areas, Alarm PIN, Energy, Notifications)
- the screensaver manager and the Sleep Screen engines
- the wall tablets' watch
- the HK Settings page and the HK panel
- rename-following, resource checks and setup-check repairs

What still runs is `async_setup`'s part: `/hk/` is still served, the settings feed answers from the
options, and `pause_automation`/`resume_automation` still act on HA's own automations.

## Protocol (one WebSocket, JSON text frames, protocol 1)

`GET /linked/ws` on Mantel Server, upgraded. Authentication: `Authorization: Bearer msvc_<id>_<secret>`
on the upgrade request.

| Direction | Frame | Meaning |
|---|---|---|
| Mantel → HA | `{"type":"hello","protocol":1,"services":[…],"entities":[descriptor…]}` | First frame. A full snapshot. HA drops (unavailable, registry kept) any entity it held that's missing. |
| Mantel → HA | `{"type":"entity","entity":descriptor}` | One entity added or replaced. |
| Mantel → HA | `{"type":"state","unique_id","state","attributes","available"}` | One entity's state. Attributes are the full set. |
| Mantel → HA | `{"type":"removed","unique_id"}` | Removed in Mantel, for example a tablet removed. HA removes the entity and its registry entry, as before. |
| Mantel → HA | `{"type":"result","id","success":true,"result"}` / `{…,"success":false,"error":{"code","message"}}` | The answer to one request. |
| HA → Mantel | `{"id","type":"call_service","service","data","targets"?}` | One of the three actions, with the data exactly as HA validated it. `targets` (for `set_black_screen`, one per entity) is `[{"entity_id","unique_id"}]`. |
| HA → Mantel | `{"id","type":"entity_command","unique_id","command","data"}` | A command to a mirrored entity. Switch: `turn_on`/`turn_off`/`toggle`. Alarm: `alarm_disarm`, `alarm_arm_*`, `alarm_trigger`, with `data.code` when given. |
| HA → Mantel | `{"id","type":"ping"}` | Answered `{"pong":true}`. |

The rules on each side:

- **Mantel's frame types are pinned** (`linked.SERVER_TYPES`). HA ignores anything else, and its
  listener only changes mirrored entities, so **nothing Mantel sends can call an HA service**
  (`test_mantel_cannot_make_home_assistant_call_anything`).
- **Mantel validates everything** before its handler sees it:
  - the type, the keys and an integer `id`
  - the service, from `SERVICES`
  - pop-up data: `popup`, plus optional `dashboards`/`users` string lists; no targets
  - `set_black_screen` data: `black` (bool) and `brightness` (int 0–255). Its targets must be
    switches Mantel publishes.
  - commands: per platform, with `code` only for the alarm
  - Refusal codes: `bad_request`, `invalid`, `unknown_service`, `unknown_target`, `unknown_entity`,
    `unknown_command`.
- **Timeouts.** Mantel's handler gets 8 s (`timeout`); HA's request gets 10 s (`LinkTimeout`). Every
  request in flight fails with `NotConnected` the moment the socket drops, so an action never hangs.
- **How HA reports failures.** A refusal with a validation code becomes a `ServiceValidationError`
  ("Mantel Server refused hk_frontend.show_popup: …"). Any other refusal, a timeout or no connection
  becomes a `HomeAssistantError` that names the action, the reason and Mantel's address.
- **Reconnect.** The link retries 1 s after a drop, doubling to 30 s, and drops back to 1 s after a
  connection that reached hello. A 401/403 keeps retrying at that pace, logged with the status but
  never the credential.

### Entity descriptor (`mantel_server/linked.py: check_entity`)

```json
{"unique_id": "<exactly hk_frontend's>", "platform": "switch|sensor|binary_sensor|camera|alarm_control_panel",
 "entity_id": "switch.hall_black_screen", "name": null, "translation_key": "black_screen",
 "has_entity_name": true, "icon": "mdi:monitor-off", "unit": null,
 "device": {"identifier": "<entry_id>_<tablet uid>", "name": "Hall", "manufacturer": "HK Frontend", "model": "Wall Tablet"},
 "state": "off", "attributes": {"black_screen": "hk", "brightness": null, "confirmed": false},
 "available": true,
 "features": {"stream_source": "…"} | {"supported_features": 3, "code_format": "number", "code_arm_required": true}}
```

- **`entity_id` is only a suggestion**, used the first time. HA's registry keys by
  `(domain, platform, unique_id)`, so a house's existing entity keeps its id, including a renamed one
  (`test_an_entity_the_house_has_keeps_its_entity_id`).
- **Each entity stays where it was.** It keeps the subentry (item) its registry entry has, and sits on
  the device named by `device.identifier`.
- **Reserved attributes are dropped.** Attributes HA sets itself (`friendly_name`, `icon`,
  `supported_features`, …) are ignored if Mantel sends them.

## What is mirrored

| PLAN §6 count | Entities (unique id as hk_frontend makes it) | Linked class |
|---|---|---|
| 11 switches | `switch.<tablet>_black_screen` (`{entry}_{uid}_black_screen`), `switch.<tablet>_photo_screensaver` (`…_photo_screensaver`), Seasonal decorations (`{entry}_seasonal_decorations`) | `LinkedSwitch`: on/off and `set_black_screen` forwarded |
| 10 sensors | `sensor.<tablet>_sleep_screen` (`…_sleep_screen`), `sensor.tv_viewers` (`{live_tv item}_viewers`), Live TV now-on (`{item}_{n}_now`) | `LinkedSensor` |
| 5 binary sensors | `binary_sensor.<tablet>_screen_in_use` (`…_screen_in_use`) | `LinkedBinarySensor` |
| 4 cameras | Live TV channels (`{item}_{n}_camera`) | `LinkedCamera`: the stream URL Mantel names (`features.stream_source`, http/https/rtsp only); no still |
| 1 alarm panel | Alarm PIN (`{alarm_pin item id}`) | `LinkedAlarmPanel`: state, features and code format from Mantel. Arm and disarm are forwarded with the code; Mantel checks the PIN. |

| Action | Forwarded as |
|---|---|
| `hk_frontend.set_black_screen` (entity action on switches, same schema) | `call_service` with `data` `{black?, brightness?}` and the entity as the target. One per targeted entity, as HA's entity actions run. |
| `hk_frontend.show_popup` (same schema) | `call_service` with `call.data` as validated (`dashboards`/`users` as lists) |
| `hk_frontend.close_popup` (same schema) | the same |

Not forwarded: music, `notify`, `clean_areas`. Nothing in YAML calls them (§6). They answer "not set
up" in linked mode because the features don't run.

## The confirmed-black-screen handshake

The sleep scripts call `set_black_screen` (black, brightness), then wait for
`switch.<tablet>_black_screen` to have `confirmed: true`, the page's word that it went black.

1. HA forwards the call. Mantel's handler applies hk_core's `Black` (`hk_core/screensaver/black.py`,
   the meaning HA's switch had): turning on resets `confirmed`, and `brightness` is carried.
2. **Mantel pushes the new state before it sends the result, on the same socket.** HA applies frames
   in order, so when the action returns, the switch already reads `on`, `confirmed: false`,
   `brightness: 174`. A `wait_template` can't see a stale `confirmed`.
3. The tablet's page reports black (`MemoryHandler.page_says(uid, True)`; the real wiring routes the
   tablet's `screensaver/black` there). Mantel pushes `confirmed: true`, and the script's wait ends.
4. A tap wakes it (`page_says(uid, False)`): the switch goes off, unconfirmed.

Pinned three times:

- HA against a fake Mantel (`test_the_confirmed_handshake`)
- Mantel with a fake client, asserting that the state frame precedes the result
  (`test_set_black_screen_state_comes_before_the_answer_and_the_page_confirms`)
- end to end, HA's harness against the real `linked.py`
  (`test_set_black_screen_and_the_confirmed_handshake_end_to_end`)

## Mantel side

**`mantel_server/linked.py`** exposes `register(app, hub, hooks)`, following the connectors' pattern:

- `app["linked"]` holds the registry, the handler and the credential check.
- Route `GET /linked/ws`, added to `app["public_paths"]`, because the endpoint authenticates the
  Service credential itself and session cookies don't count.
- On shutdown, every linked socket is closed (1001).

`LinkedHooks` has six fields:

| Hook | What it is |
|---|---|
| `handler` | `async call_service(service, data, targets, ctx)` and `async entity_command(unique_id, command, data, ctx)`. Raise `LinkedError(code, message)` to refuse. `ctx` is `CallCtx(account, peer)`. |
| `accounts` | Default: `app["service_accounts"]`. |
| `registry` | Share one `LinkedRegistry`. |
| `timeout` | Default 8 s. |
| `recheck` | Default 60 s. |
| `heartbeat` | Default 30 s. |

`hooks` may also be a mapping or the connectors' shared `Hooks`; the latter carries nothing for
linked mode.

`LinkedRegistry` holds the entities Mantel publishes:

- `publish(desc)`, `update(uid, state=, attributes=, merge=, available=)`, `remove(uid)`, `snapshot()`
- every change is pushed to every linked client at once, and a closed client is dropped
- sends to one client are serialised, so a push and a result never interleave

`MemoryHandler` is the in-memory default until the orchestrator wires the real features:

- black screens via `Black`, as described in the handshake above
- `show_popup` and `close_popup` recorded in `popups`, plus an optional `on_popup` callback
- switch commands set the switch
- alarm commands are refused (`not_supported`), because no PIN engine is wired here
- the PIN is never kept: `commands` records only the data keys

**`mantel_server/service_accounts.py`** and migration **`0005_service_accounts.sql`** are a new
Service account kind. P3.1 has only `hk`/`ha_linked` users; P3.1's files are untouched.

- **What an account is.** A machine account with no password, session or role grants: only a bearer
  credential and its `scopes`, the endpoint names from `SCOPES = {"linked"}`. This matches RBAC.md's
  `service` role ("give each endpoint as a feature grant").
- **Credential.** `msvc_<16 hex>_<43 base64url>`, 256 random bits. Only its SHA-256 is stored, and the
  comparison is constant-time. An unreadable `scopes` row grants nothing.
- **Use.** `verify(token, scope, source_ip=)` records `last_used` and `last_ip`. `revoke(id)` also
  closes an open linked socket, at the next frame or recheck (WebSocket close 1008).
- **Management, Owner only:**
  - CLI: `mantel-server service-account create --name home-assistant --scope linked` (prints the
    credential once), `… list`, `… revoke --id ID`
  - REST: `GET/POST /api/service-accounts`, `DELETE /api/service-accounts/{id}`. An Owner's own
    session on the LAN door only, with CSRF via the existing middleware. `POST` answers `no-store`.
- `__main__.py` gained the two-line `service-account` dispatch.

## Security

- **Who.** Only a live Service credential with scope `linked`. A wrong scope, an unknown, malformed
  or revoked credential, `Basic` auth, or a session cookie each get 401.
- **Which door.** The LAN door only: `sessions.door_of` gives 403 `lan_only` for
  `X-Mantel-Door: tunnel` or any Cloudflare header. PLAN §7: machine credentials, like tablets', are
  useless off-site. Caddy already stamps the door on every request (`packaging/compose/caddy/Caddyfile`).
- **No browsers.** Any request carrying an `Origin` header gets 403. Browsers always send `Origin`
  on WebSockets and HA's client doesn't, so no page can ever drive this endpoint.
- **One direction for commands.** HA → Mantel only. Mantel can change only the mirrored entities.
  It can't call services, fire events or run scripts in HA (pinned on both sides).
- **What Mantel trusts.** Mantel checks every request and doesn't rely on HA's own validation. A
  `set_black_screen` aimed at an entity Mantel doesn't publish is refused before any handler runs.
- **In transit.** TLS (https/wss) everywhere except loopback; Configure refuses plain http to a
  network address. The alarm PIN travels inside that TLS link, as it travels from HA to an alarm
  integration today.
- **At rest on HA.** As described under "The option": plain text in `.storage`, never logged or in
  diagnostics, revocable.
- **At rest on Mantel.** Hash only, tested by grepping the raw database and WAL files for the
  credential.

## Tests

| File | Covers |
|---|---|
| `hosts/ha/…/tests/py/mantel_fake.py` | A fake Mantel linked endpoint on 127.0.0.1. Records frames and headers; the test decides answers and pushes. Fictional house: Hall tablet, Live TV viewers and a channel, an Alarm PIN panel. |
| `hosts/ha/…/tests/py/test_linked_mode.py` (16) | See the list below. |
| `hosts/ha/…/tests/py/test_linked_e2e.py` (2) | HA's harness against the REAL `mantel_server/linked.py`, with a real Service account in SQLite and the in-memory handler. `set_black_screen` and the confirmed handshake; Mantel's state push; `show_popup`; a switch command; a revoked credential ending the link. Collected only with `MANTEL_ROOT` (`conftest.py`), because the published HACS repository has no Mantel. |
| `tests/test_linked.py` (30) | See the list below. |
| `tests/test_service_accounts.py` (7) | The migration through the runner, and idempotence; create, verify, scopes, revoke; hash only in the db and WAL; bad names and scopes; unreadable rows; the CLI; the REST (Owner only, 401/403, tunnel, a token never listed). |
| `tests/test_linked_e2e.py` (1) | Stages the integration's Python, tests and translations from `tools/build_ha.py`'s plan, without the frontend files, and runs `test_linked_e2e.py` + `test_linked_mode.py` in `~/.venvs/hk-ha-test` with `MANTEL_ROOT` set. That way the cross-host e2e runs in Mantel's own suite. Skipped only if that venv is absent. |

`test_linked_mode.py` covers:

- not linked is the default and nothing changes, with no link started
- a half-filled link isn't a link
- address normalisation
- entities appear with the same unique ids, entity ids and devices, and nothing local runs
- an existing entity id is kept
- pushed state, a new entity, removal and Mantel-side unavailability
- frames that could act on HA do nothing
- the three actions forwarded with exact data
- entity commands with the alarm code
- the handshake
- refusals, as validation errors vs other errors
- a slow Mantel times out cleanly
- reconnect with backoff, with in-flight and while-away calls failing clearly
- a refused credential retried and never logged or in diagnostics
- unload stops the link
- Configure: link, insecure address, keep the saved credential, unlink back to today's integration

`tests/test_linked.py` covers:

- the hello snapshot
- refusals: no or bad credential, Basic, tunnel door, Cloudflare header, browser Origin, wrong
  scope, revoked (the open socket closes 1008), session cookie
- state before result, and the full handshake with the in-memory handler
- pop-ups recorded
- 12 checked-call cases
- bad frames answered and not fatal
- entity commands, including the alarm refused and the PIN not kept
- pushes to every client, with a closed one dropped
- descriptor checks
- the pinned frame types
- a custom handler's refusal, timeout and bug
- hooks coercion

Validation (2026-10-18, this worktree):

- `tools/build_ha.py` → built 3,255 files; `tests/run` → all suites green
- HA `pytest` in the build → **697 passed, 1 skipped** (681 before; +16 in `test_linked_mode.py`; the
  e2e file isn't collected there)
- `~/.venvs/mantel/bin/python -m pytest -q` → **1,340 passed** (includes the 38 new tests, one of which
  runs the cross-host e2e in HA's venv: 18 HA-side tests pass there)
- `tools/headless/client_smoke.py` → passed (0 external requests, 0 browser exceptions)

## What's left

1. **Wiring (orchestrator, `server.py`):** `service_accounts.register(app, hub)`, then
   `linked.register(app, hub, LinkedHooks(handler=<the real features>))`.
2. **The real handler**, replacing `MemoryHandler`:
   - `set_black_screen`: Mantel's Sleep Screen and black screen per tablet. The tablet page's
     `screensaver/black` calls the equivalent of `page_says`.
   - `show_popup` / `close_popup`: Mantel's pop-ups and its screens' event channel. Validate the hash
     against Mantel's pop-ups (`unknown_popup`).
   - Alarm PIN: check the PIN, then arm or disarm through the command gateway (P3.3: RBAC as the
     Service subject, audit row first, `commands.enabled`). Map refusals to `invalid_code`.
   - Switch commands: the photo screensaver (the doorbell turns it off) and Seasonal decorations as
     Mantel settings.
3. **Publishing the 31 entities** from Mantel's own state:
   - Each tablet's four (unique ids `{ha entry_id}_{tablet uid}_{key}`, devices `{entry_id}_{uid}`).
     The entry id and item ids come from the P3.5 settings import, which read HA's config entry.
   - Live TV's viewers, now-on and cameras, with a `stream_source` Mantel serves. Live TV's
     transcode is Phase 4+.
   - The Alarm PIN panel (unique id = its item id).
   - Seasonal decorations.
   - Keep `translation_key`/`entity_id` as hk_frontend has them, so names and new-install ids match.
4. **Cutover procedure:** create the Service account, set Configure → Linked to Mantel Server with the
   LAN `https://` address, and check the 5 automations, 11 scripts and 2 packages from §6 still run.
   Reversible: switch it off and today's integration comes back.
5. **Later (§6 step 2):** retire the tablet plumbing into Mantel, room by room (Loft first). Linked
   mode then shrinks to the popups' actions and a few entities.
6. Small items:
   - Cameras have no still image.
   - A descriptor's name or device change applies only when the entity is re-added (on reconnect, or
     via `removed` + `entity`).
   - `show_popup` while the entry is configured as linked but not loaded (disabled) falls back to
     the local behaviour.

## Exact continuation point

Wire the two `register` calls in `server.py` (P3.7, with the gateway agent's rework), then write
`linked` handlers for the real features:

1. black screen + `page_says` from the tablet's `screensaver/black`
2. pop-ups to Mantel's screen channel
3. Alarm PIN through the gateway

Then publish the 31 entities from Mantel's state, keyed by the unique ids imported from HA's config
entry.

Files: `hosts/server/mantel_server/linked.py`, `hosts/server/mantel_server/service_accounts.py`,
`hosts/server/mantel_server/migrations/0005_service_accounts.sql`,
`hosts/ha/custom_components/hk_frontend/linked_mode.py`,
`hosts/ha/custom_components/hk_frontend/mantel_link.py`.
