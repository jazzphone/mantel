# Phase 5: linked mode — `hk_frontend` "Linked to Mantel Server" (2026-10-18)

> **Decision 29 (2026-10-21):** linked mode (protocol 1) stays supported: HK Frontend and Mantel are two products that
> run together (docs/phase9/TWO-PRODUCTS.md).
>
> **Superseded for the bridge by Mantel Link (decision 28, 2026-10-19).** HA's side of Mantel is now its own
> integration, Mantel Link (domain `mantel`, `hosts/ha/custom_components/mantel`), speaking protocol 2 of the same
> link; HK Frontend's linked mode stays until each house has handed the bridge over and removed HK Frontend.
> Design, protocol 2, the hand-over and their checks: [../phase9/MANTEL-LINK.md](../phase9/MANTEL-LINK.md); for
> any house: Mantel Link's docs (`hosts/ha/custom_components/mantel/docs/`). Protocol 1 below is unchanged and
> still what HK Frontend speaks (its last release adds `features=bridge` and the `bridge` owner, MANTEL-LINK.md 9.3).

PLAN.md §6 (what stays in Home Assistant), §5 ("Service" role), §7 (identity, secrets, doors). The
house's automations, scripts and history depend on things HK puts into HA: three actions (four with
`notify`) and 31 entities. Linked mode keeps all of them, with the same domain, unique ids and entity ids, after HK
moves to Mantel Server. Each action is forwarded to Mantel and the entities' states are pushed from
Mantel. This is step 1 of §6's plan, "at cutover, change nothing."

Everything here was built and tested against fakes, the HA test harness, and a Mantel endpoint on
127.0.0.1. No real Home Assistant or house was contacted. `server.py`, `gateway.py`, `ha_client.py`
and `web/` are untouched.

**Update 2026-10-18 (afternoon): per-tablet ownership and Mantel's real handlers.** Linked mode now
moves the house **one wall tablet at a time** (CUTOVER.md §1, Option A, the recorded recommendation,
implemented as recommended): see "Per-tablet ownership" below. Mantel's real handlers answer every
forwarded action (black screen, pop-ups, `notify`, the photo screensaver and black screen switches,
Seasonal decorations, the Alarm PIN through the gateway), and Mantel publishes all 31 entities: each
Mantel-owned tablet's four, and the rest of the entry's once Mantel owns it. Linked mode is still
**off by default**; turning it on is a cutover step (CUTOVER.md Step 3).

## The option (HA side)

**Settings → Devices & services → HK Frontend → Configure → Linked to Mantel Server.** It's a page
of the existing Configure menu. There is no second integration: a second one couldn't register the
same `hk_frontend.*` action names.

| Field | Stored | Notes |
|---|---|---|
| Linked to Mantel Server | presence of `entry.data["mantel_link"]` | **Off by default.** Turning it off removes the key. |
| Mantel Server's address | `entry.data["mantel_link"]["url"]` | `https://host[:port]` (or `wss://`). With no path it means `/linked/ws`. No user, query or fragment. Plain `http://`/`ws://` is accepted only for loopback (127.0.0.1/localhost/::1), an IP literal in `172.30.32.0/23` (Home Assistant Supervisor's internal hassio network, which never leaves the host), or an App hostname (`local-<slug>`, `<8 hex>-<slug>`, e.g. the Mantel App's `http://local-mantel:8099`) **whose every resolved address** is loopback or in that range, checked on save and again before every connect (the link connects to the checked address with the original Host header; a name that stops resolving there is refused as `mantel_url_not_internal` and retried); anything else plain is `mantel_url_insecure`, so the credential never crosses the network in clear. |
| Service credential | `entry.data["mantel_link"]["token"]` | A Mantel Service account's (scope `linked`). It's never shown again: left empty, the saved one is kept. |

- **Where it's stored.** The link lives in the entry's **data**, not its options. The options are the
  dashboard settings, which the settings model reads, lifts and tidies.
- **On disk.** Home Assistant writes entry data to `.storage/core.config_entries` in plain text, as it
  does every integration's token. Anyone who can read that file, or a backup of it, can open the
  link. It's never logged, never in `repr`, and never in diagnostics (which show only `linked`,
  `url`, `connected`, `entities`, `last_error` and `owners`). It's revoked on Mantel's side in one step.
- **Saving reloads.** The entry's update listener reloads it, into or out of linked mode.
- **Ownership** (`entry.data["mantel_owners"]`, `{"house": "ha"|"mantel", "tablets": [ids]}`): the last
  ownership Mantel told this side; absent means everything is HA's. Unlinking removes it too.

**Not linked = today's behaviour, exactly.** `linked_mode.configured(entry)` is false without the key,
and then every path is the one that existed before:

- `async_setup_entry` and `async_unload_entry` take the old route.
- `show_popup` and `close_popup` check the pop-ups locally.
- Each platform adds its own entities.
- No link is ever started (pinned by `test_not_linked_is_the_default_and_nothing_changes`).
- The existing suites pass unchanged. The one deliberate test edit is `test_configure.py`: Configure's
  menu now lists `linked`.

**Linked, the rest of the entry HA's** (CUTOVER Steps 3–6). `async_setup_entry` runs today's path in
full and starts the link (`linked_mode.start`) just before the platforms. Each platform calls
`linked_mode.attach(...)` (which registers its adder) and then adds its own entities as always. What
differs, only for the tablets Mantel owns: the screensaver manager gives them no entity and no Sleep
Screen engine; their four entities are Mantel's, mirrored with the same unique and entity ids. See
"Per-tablet ownership".

**Linked, the whole entry Mantel's** (Step 7: `house` is Mantel's). `async_setup_entry` hands over to
`linked_mode.async_setup_entry` right after the feature-entry check. It starts the link (an entry
background task) and forwards the same `PLATFORMS`. Each platform calls `linked_mode.attach(...)` and
adds Mantel's entities instead of its own.

Nothing local runs that Mantel now does:

- the features (Music, Live TV, Clean Areas, Alarm PIN, Energy, Notifications)
- the screensaver manager and the Sleep Screen engines
- the wall tablets' watch
- the HK Settings page and the HK panel
- rename-following, resource checks and setup-check repairs

What still runs is `async_setup`'s part: `/hk/` is still served, the settings feed answers from the
options, and `pause_automation`/`resume_automation` still act on HA's own automations.

## Per-tablet ownership (CUTOVER.md §1, Option A)

CUTOVER.md §1 recorded two ways to cut over and recommended **A, per-tablet ownership**; that is what
is built (Avery's decision line there is still his to fill). During the transition each wall tablet is
owned by either Home Assistant's HK or Mantel Server, and `house`, the rest of the entry, likewise.

| | Where | What |
|---|---|---|
| The rows | Mantel: `linked_owners` table (migration `0010_linked_owners.sql`), `mantel_server/linked_owners.py` | One row per moved unit (`unit`, `owner`, `changed`, `changed_by`). **No row = Home Assistant's**: nothing changes until an Owner moves a tablet. |
| Moving one | `PUT /api/linked/owners {"unit": "<tablet id>"\|"house", "owner": "mantel"\|"ha"}` | **An Owner's own session on the LAN door** (CSRF through the session middleware); Admin/Adult 403, the tunnel refused. **Audited first**: an `action_audit` row (kind `config`, action `linked.owner`, target `{unit, from, to}`, the Owner and role) before the row is written. A repeat of the same move writes nothing. |
| The rules | `LinkedOwners.set` | An unknown tablet is `unknown_tablet`. `house` moves to Mantel only when every tablet already is (`tablets_first`: Step 7 after Step 4); no tablet moves back while `house` is Mantel's (`house_first`). |
| Reading | `GET /api/linked/owners` (Owner/Admin) | Every tablet Mantel knows with its owner and who moved it when, the house, the wire form, and how many linked HA instances are connected. |
| Telling HA | `hello.owners` (read from the rows at each connection) and an `owners` frame | Sent **before** any entity of a moved unit is published or withdrawn. |
| HA keeps it | `entry.data["mantel_owners"]` | Written when Mantel's word differs (deferred until the entry has finished setting up), which reloads the entry. A restart of HA without Mantel keeps the last ownership; a restart of Mantel keeps its rows. Configure → Linked to Mantel Server says who owns what; diagnostics show `owners`. |

**The forwarding decision, both ways.**

- *Home Assistant.* A tablet Mantel owns gets no entity or Sleep Screen engine of HA's own (the
  screensaver manager skips it); its four entities are Mantel's, so `set_black_screen` on its switch,
  or a command to one of them, goes to Mantel. A tablet HA owns is exactly today's: its own entities
  and engine, nothing forwarded, and Mantel's descriptors for it are ignored even if sent (`mine()`
  checks the descriptor's `tablet` against the ownership the entry was set up with). Pop-ups and
  `notify` run here as always and go to Mantel too while Mantel owns any tablet. Once `house` is
  Mantel's the whole entry is linked as before (nothing local runs).
- *Mantel.* It publishes only the entities of the units it owns (features.py `mantel_owns`), runs a
  Sleep Screen engine and the linked backlight only for its own tablets (so Mantel and HA never drive
  the same kiosk), refuses `set_black_screen` for any other (`unknown_target`, and `not_owned` in the
  handler), and publishes the house-level entities only while it owns `house`.
- *A tablet moved back.* Mantel says `owners` first, then withdraws the tablet's entities with
  `"forget": false`; HA keeps their registry entries, reloads, and its own entities come back under the
  same entity ids (`test_mantel_moves_a_tablet_and_back`).

## Protocol (one WebSocket, JSON text frames, protocol 1)

`GET /linked/ws` on Mantel Server, upgraded. Authentication: `Authorization: Bearer msvc_<id>_<secret>`
on the upgrade request.

| Direction | Frame | Meaning |
|---|---|---|
| Mantel → HA | `{"type":"hello","protocol":1,"services":[…],"entities":[descriptor…],"owners":{…}}` | First frame. A full snapshot, and who owns what (`owners`, read from Mantel's database at that moment). HA drops (unavailable, registry kept) any entity it held that's missing. |
| Mantel → HA | `{"type":"owners","owners":{"house":"ha"\|"mantel","tablets":[ids]}}` | An Owner moved a unit. Sent **before** any entity of that unit is published or withdrawn. HA keeps it in the entry's data and reloads the entry. |
| Mantel → HA | `{"type":"entity","entity":descriptor}` | One entity added or replaced. |
| Mantel → HA | `{"type":"state","unique_id","state","attributes","available"}` | One entity's state. Attributes are the full set. |
| Mantel → HA | `{"type":"removed","unique_id","forget"?}` | Removed in Mantel, for example a tablet removed: HA removes the entity and its registry entry, as before. `"forget": false`: only no longer Mantel's (its unit moved back to HA): HA keeps the registry entry, so its own entity keeps its entity id. HA also never forgets an entity whose unit it no longer counts as Mantel's. |
| Mantel → HA | `{"type":"result","id","success":true,"result"}` / `{…,"success":false,"error":{"code","message"}}` | The answer to one request. |
| HA → Mantel | `{"id","type":"call_service","service","data","targets"?}` | One of the four actions, with the data exactly as HA validated it. `targets` (for `set_black_screen`, one per entity) is `[{"entity_id","unique_id"}]`. |
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
  - `notify` data: HA's `NOTIFY_SCHEMA` keys only (`title` required, hk_core's `TITLE_MAX` /
    `MESSAGE_MAX`, `stay` 0–3600, `icon` `mdi:`/`hk:`, `entity`/`camera` entity ids, `tap`, `page`,
    `dashboards`/`users`); no targets
  - `set_black_screen` data: `black` (bool) and `brightness` (int 0–255). Its targets must be
    switches Mantel publishes.
  - commands: per platform, with `code` only for the alarm
  - Refusal codes: `bad_request`, `invalid`, `unknown_service`, `unknown_target`, `unknown_entity`,
    `unknown_command`; the real handlers add `not_set_up`, `not_owned`, `not_a_black_screen`,
    `unknown_popup`, `invalid_code`, `code_required`, `code_locked`, `commands_disabled`, `forbidden`,
    `alarm_ha_code_missing`, `unavailable`. The alarm's are produced in one place,
    `alarm_pin.linked_error` (the gateway's refusals as wire codes, with messages that say "code").
    HA's validation set (`linked_mode._VALIDATION`) includes `invalid_code`, `code_required` and
    `code_locked`: they are about the code the person typed.
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
 "features": {"stream_source": "…"} | {"supported_features": 3, "code_format": "number", "code_arm_required": true},
 "tablet": "hall" | null}
```

- **`tablet`** names the wall tablet the entity belongs to (its settings id: the unit of ownership).
  `null` is the rest of the entry's (Seasonal decorations, Alarm PIN, Live TV). HA mirrors an entity
  only while its unit is Mantel's.

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
| `hk_frontend.notify` (same schema, with its defaults filled) | `call_service` with `call.data` as validated; the response is Mantel's `{id, snap: false}` |

Not forwarded: music and `clean_areas`. Nothing in YAML calls them (§6). With the whole entry
Mantel's they answer "not set up" because the features don't run here.

**Who answers what, and when** (per-tablet ownership, below):

| Action / command | A tablet HA owns (or the rest, while HA's) | A tablet Mantel owns | The whole entry Mantel's |
|---|---|---|---|
| `set_black_screen`, a black screen / photo switch command | HA's own entity, as today; nothing forwarded | Mantel's (the entity is the mirrored one) | Mantel's |
| `show_popup`, `close_popup`, `notify` | HA's own screens, as today; **and** forwarded while Mantel owns any tablet (a Mantel that can't be reached is logged, not raised: HA's screens got it) | (same) | forwarded only |
| Seasonal decorations, Alarm PIN, Live TV | HA's own | (HA's own) | Mantel's |

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

`MemoryHandler` is the in-memory default when nothing else is wired (tests; `linked.register` on its
own). In the server the real handlers replace it (below):

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

**The real handlers** (wired in `server.wire`, 2026-10-18): `features.register` sets
`app["linked"].handler` to features.py's `FeatureLinked`, and `linked_house.register` wraps it in
`LinkedHandler`. Nothing here sends a house command except the Alarm PIN, and that only through the
command gateway (off on the house: `commands_disabled`, an audit row, nothing sent).

| Forwarded | Handled by | What happens |
|---|---|---|
| `set_black_screen` | `FeatureLinked` → `FeatureHost.set_black` | hk_core's `Black`; a `screen` frame to Mantel's screens (the page draws the black, docs/phase4/MANTEL-FEATURES.md); the new state pushed **before** the answer; the page's `screen_report {black}` confirms it (`page_says`). Only for a tablet Mantel owns. Opt-in backlight through the gateway as `mantel:features`. |
| `show_popup` / `close_popup` | `FeatureLinked` | Checked against Mantel's pop-ups (`unknown_popup`), then `popup` / `popup_close` on the screens' event feed. |
| `notify` | `linked_house.LinkedHouse.notify` | hk_core's `banner.build_action` → the event feed; Wakes the Screen through Mantel's Sleep Screen engines (Do Not Disturb unless Important). Needs Mantel's `notifications` piece (`not_set_up` otherwise, as HA answers). No camera snapshot yet (`snap: false`). |
| photo screensaver / black screen switch | `FeatureLinked` | Mantel's own screen state (`screen` frames), pushed back. |
| Seasonal decorations | `LinkedHouse` | Its state is Mantel's house setting `sky.decorations`; a command saves it (settings store, versioned, author `linked:<service account>`; HK's own data, as HA's switch writes its options) and the settings feed is re-sent. |
| Alarm PIN `alarm_*` | `LinkedHouse._alarm` → `alarm_pin.linked_command` | **The one alarm path** (docs/phase3/GATEWAY.md "The alarm"), the same gateway code as a page's keypad, as the Service actor `mantel:linked`. The code is **the house's Alarm PIN** for that panel and nothing else (decision 25, 2026-10-18, docs/PLAN.md: a person's own PIN is not accepted; the audit's actor is `mantel:linked`). With no Alarm PIN set, anything that needs a code is refused `alarm_pin_not_set` and nothing is sent. Wrong codes are counted at `keypad:mantel:linked`: 5 in a row lock it for 15 minutes (`code_locked`). RBAC runs on the panel and the alarm, so a Child is refused (`forbidden`). The audit row comes first. With commands off the answer is `commands_disabled` and nothing is sent. **The typed code is never sent to HA.** If the protected alarm reports a `code_format`, Mantel adds its own stored code for it (`ha_code`), or refuses with `alarm_ha_code_missing`. A missing code is `code_required`, a wrong one `invalid_code`. The code is never logged, audited or kept. |

**What Mantel publishes** (`linked_house.py` for the rest of the entry, features.py for the tablets):

| Entities | Published while | From |
|---|---|---|
| Each tablet's four (`{entry}_{uid}_{key}`, device `{entry}_{uid}`, `tablet: <id>`) | the `linked` piece is on and Mantel owns that tablet | Mantel's screens, the screensaver rules, the Sleep Screen engine (as before) |
| Seasonal decorations (`{entry}_seasonal_decorations`, device `{entry}` "HK Frontend") | the `linked` piece is on and Mantel owns `house` | Mantel's house settings |
| Alarm PIN panel (unique id = its item id, device = the item) | the same, once HA's registry has the panel | the protected alarm's state, features and availability from the hub; `code_format: number` (Mantel PINs are digits) |
| Live TV: `sensor.tv_viewers`, `…_{n}_now`, `camera.tv_*` | the same, once HA's registry has them | now-on from Mantel's guide (`live_tv` piece; "Live" without it); where Mantel serves Live TV (its own go2rtc, `live_tv.py`) the viewers are its count and the channels it serves are available, never with a stream source; otherwise viewers 0 and the cameras **unavailable** (the HA App) |

The house-level unique ids, entity ids, names and the protected alarm are read from Home Assistant's
own entity registry (`platform: hk_frontend`, the entry's) and states through the hub, never
invented, and remembered in Mantel's `linked_house` table so a restart while HA mirrors them (and no
longer shows the originals' attributes) still knows them. They follow the hub (the protected alarm's
changes), registry reloads, settings saves, a move, and a minute's tick (now-on).

**Which alarm the Alarm PIN panel stands for** (decided 2026-10-18): **Mantel's `alarm_pins` row for
the panel is authoritative.** An Owner sets it or imports it (`POST /api/alarm/pins/import`), and it
also holds the house code and the alarm's own code. HA's registry `protects` is used only to create
that row when none exists (`LinkedHouse.keypad_for`, on the first refresh while Mantel owns `house`).
That row has `tablets` off and no house code, so anything that needs a code is refused (`alarm_pin_not_set`) until an Owner sets one. It
gets a `config` audit row, `alarm_pin.linked`. After that, a disagreement is logged and the row wins
for both the commands and the mirror, so the panel always shows the alarm its commands go to. A row
that forwards to the panel itself is refused (`not_set_up`), because it would loop through HA.

## Security

- **Who.** Only a live Service credential with scope `linked`. A wrong scope, an unknown, malformed
  or revoked credential, `Basic` auth, or a session cookie each get 401.
- **Which door.** The LAN door only: `sessions.door_of` gives 403 `lan_only` for
  `X-Mantel-Door: tunnel` or any Cloudflare header. PLAN §7: machine credentials, like tablets', are
  useless off-site. Caddy already stamps the door on every request (`packaging/compose/caddy/Caddyfile`).
  **In the HA App** (no Caddy, no published port, `ingress_only`): HA Core reaches the App from
  `172.30.32.1` (`--ha-core-peer`, set by the App's entrypoint); from that address `/linked/ws` alone is let
  through and counted as the LAN door, and the credential is still required. HA's option: address
  `http://local-mantel:8099`. Ownership moves from the Owner's own sidebar there (`authz.home_door`).
  [../phase3/HA-APP.md](../phase3/HA-APP.md) "Linked mode in the App". **Not usable yet:** this page's
  address rule (plain `http://` only for 127.0.0.1) refuses that address; how to allow it is Avery's decision
  (HA-APP.md lists the options).
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
| `tests/test_linked_e2e.py` (1) | Stages the integration's Python, tests and translations from `tools/build_ha.py`'s plan, without the frontend files, and runs `test_linked_e2e.py` + `test_linked_mode.py` + `test_linked_owners.py` in `~/.venvs/hk-ha-test` with `MANTEL_ROOT` set. That way the cross-host e2e runs in Mantel's own suite. Skipped only if that venv is absent. |
| `hosts/ha/…/tests/py/test_linked_owners.py` (6) | Per-tablet ownership on HA's side: a tablet Mantel owns is Mantel's (no engine or entity of HA's; `set_black_screen` forwarded) while Seasonal decorations and the manager stay HA's; pop-ups and `notify` here **and** forwarded; Mantel away never stops HA's own screens; a tablet HA owns stays HA's whatever Mantel describes, nothing forwarded; Mantel moves a tablet (kept in the entry, reload) and back (same registry entry, so the same entity id; HA's own again); a restart without Mantel keeps the last ownership; Configure says who owns what, and unlinking forgets it. |
| `hosts/ha/…/tests/py/test_linked_e2e.py` (+1) | Step 3 end to end against the REAL `linked.py`: the hall tablet Mantel's, the rest HA's. |
| `tests/test_linked_owners.py` (15) | Default HA (nothing published, no engine, `unknown_target` / `not_owned`); an Owner's move (who may: Owner on the LAN only; the audit row; `owners` before the entities; Mantel then answers; a repeat writes nothing; back to HA withdrawn with `forget: false`); the rules (`tablets_first`, `unknown_tablet`, `house_first`); the store alone; a restart on the same database (hello's owners and entities); `notify` to Mantel's screens and Wakes the Screen, and `not_set_up` with notifications off; the rest of the entry published only while Mantel owns it (from HA's registry, the protected alarm followed, remembered, withdrawn); Seasonal decorations saved as Mantel's setting; the Alarm PIN through `alarm_pin.linked_command` (its row made from HA's registry, tablets off, audited; no code `code_required`, a wrong one `invalid_code`; an Adult's PIN with commands off: `commands_disabled`, an audit row as the person on `[panel, alarm]`, nothing sent, the PIN nowhere; with commands on through a FakeCommander: a Child refused `forbidden`, an Adult's disarm sent to the alarm itself as that person; the house code works as at a tablet, actor `mantel:linked`; the typed PIN is never the alarm's code (`alarm_ha_code_missing`, then only Mantel's stored code); 5 wrong lock it `code_locked`; Mantel's row decides which alarm, for the mirror too, and a row naming the panel itself is `not_set_up`). |

`test_linked_mode.py` covers:

- not linked is the default and nothing changes, with no link started
- a half-filled link isn't a link
- address normalisation
- entities appear with the same unique ids, entity ids and devices, and nothing local runs
- an existing entity id is kept
- pushed state, a new entity, removal and Mantel-side unavailability
- frames that could act on HA do nothing
- the actions forwarded with exact data
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
- pop-ups recorded, `notify` forwarded and checked
- 16 checked-call cases
- `owners` frames and a withdrawn entity not forgotten
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

Validation of per-tablet ownership and the real handlers (2026-10-18 afternoon, this worktree):

- `tools/build_ha.py` → `tests/run`: all suites green; HA `pytest` in the build: **703 passed, 1
  skipped** (+6 `test_linked_owners.py`; with `MANTEL_ROOT` the 3 e2e tests too: 706)
- `~/.venvs/mantel/bin/python -m pytest -q tests`: **1,949 passed** (+11 `test_linked_owners.py`,
  +6 in `test_linked.py`; the cross-host e2e now runs the HA owners file too)
- **On the scratch HA** (`tools/testha`, 127.0.0.1:8124, commands disabled):
  `tools/e2e/linked_e2e.py` **23/23** (the real HA linked to Mantel in-process: hello with nothing
  moved, HA's own Seasonal decorations kept; the Owner moves `house` → HA keeps it and reloads, the
  switch becomes Mantel's under the same entity id, turning it off in HA saves Mantel's setting and the
  state comes back; `hk_frontend.notify` in HA reaches a Mantel screen; an unknown pop-up is Mantel's
  validation error in HA; moved back → HA's own again; no household service called);
  `tools/e2e/features_e2e.py` 26/26; `tools/testha/check.py` 14/14 PASS (linked mode off);
  `restart_check.py` from main's build to this one: cards drawn 17/17 and state followed, with one
  "Subscription not found" page error that main → main shows too (not from this change).
- Not checked on a real HA: a wall tablet moved (the scratch HA has no tablet items); covered by the
  harness tests and the HA-harness e2e against the real endpoint.

## What's left

1. **Cutover procedure** (CUTOVER.md, Steps 3 and 7): create the Service account; at Step 3 turn on
   Configure → Linked to Mantel Server with the LAN `https://` address (everything stays HA's), then
   the Owner moves the Loft (`PUT /api/linked/owners`); at Step 7 the Owner moves `house`. Check the
   5 automations, 11 scripts and 2 packages from §6 still run. Reversible per tablet (move it back)
   and as a whole (switch linked mode off).
2. **Not on Mantel yet**, so not answered or published truthfully by it:
   - notification camera snapshots (`snap` is false)
   - Live TV in the HA App (no go2rtc of Mantel's): the channel cameras are published unavailable, viewers 0 (Docker/LXC: served by Mantel, phase4/FEATURE-PARITY.md)
   - the Alarm PIN takes only the house's Mantel Alarm PIN (decision 25; people's own PINs are not
     accepted). HA's hash is never imported, so the house code is set again in Mantel; until then
     anything that needs a code is refused (`alarm_pin_not_set`). Arming
     without a PIN follows the row's `arm_required`, as at a tablet.
3. **Later (§6 step 2):** retire the tablet plumbing into Mantel, room by room (Loft first). Linked
   mode then shrinks to the popups' actions and a few entities.
4. Small items:
   - Cameras have no still image.
   - A descriptor's name or device change applies only when the entity is re-added (on reconnect, or
     via `removed` + `entity`).
   - `show_popup` while the entry is configured as linked but not loaded (disabled) falls back to
     the local behaviour.
   - HA's tablet alerts and scheduled restart (tablets.py) still run for every tablet until the
     whole entry is Mantel's (Mantel has none yet).
   - No `/admin` page control for ownership yet: the REST only.

## Exact continuation point

Linked mode is complete for the cutover's needs as far as the items above allow. Next: run the
cutover's Step 3 when Avery says (CUTOVER.md), and port the remaining Phase 4 pieces (snapshots,
Live TV's stream) so the rest of the entry is truthful before Step 7.

Files: `hosts/server/mantel_server/linked.py`, `linked_owners.py`, `linked_house.py`,
`service_accounts.py`, `features.py` (ownership guards), `migrations/0005_service_accounts.sql`,
`migrations/0010_linked_owners.sql`, `server.py` (wiring);
`hosts/ha/custom_components/hk_frontend/linked_mode.py`, `mantel_link.py`, `__init__.py`,
`screensaver.py`, `features/notifications/__init__.py`, `config_flow.py`, `const.py`; `tools/e2e/linked_e2e.py`
(the real-HA check).
