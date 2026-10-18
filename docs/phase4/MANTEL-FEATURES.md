# Phase 4, Mantel's side: the House adapter and the feature host (2026-10-18)

PLAN.md §9 Phase 4, §0 "Plan review" item 1, §10. A feature moves in three steps: (a) its logic goes
into `hk_core` behind the `House` port, (b) Home Assistant runs it through `HaHouse`, (c) Mantel Server
runs the same code through its own House adapter. Steps (a) and (b) were done for every feature by
2026-10-18 (`hk_core/README.md`). This slice is step (c): **Mantel's House adapter**, and a **feature
host** that runs hk_core's features inside Mantel Server with that House and Mantel's own stores.

Everything was built and tested against fakes and the scratch Home Assistant (`tools/testha/`,
127.0.0.1:8124, HA's `demo` devices). No real house was contacted. `server.py`, `authz.py`,
`gateway.py`, `sessions.py`, `docs/PLAN.md` and `hosts/ha/` are untouched. **House commands stay off by
default.** Every test runs with them off, except two unit tests that use a FakeCommander (which sends
nothing anywhere) and phase B of the scratch-HA e2e.

## MantelHouse (`hosts/server/mantel_server/house.py`)

`MantelHouse(store, registry, *, tz, caller, now)` implements `hk_core.house.House` and follows
`HaHouse`'s semantics.

**Reads** come from the hub's own copies. Each one is a plain frozen view (`State`, `Entity`,
`Device`, `Floor`), so feature code can't change the hub's data.

| Port method | Source |
|---|---|
| `state`, `states(domain)` | `StateStore` (HA's `subscribe_entities`). `State.last_changed` is HA's `lc` as an aware UTC datetime. |
| `entity`, `entities(domain)` | `Registry.entries` / `entity_entries` (HA's `config/entity_registry/list`), disabled ones included |
| `device` | the device list: `name_by_user`, else `name` |
| `device_entities` | the device's entries, disabled ones too (`disabled` says) |
| `area_ids`, `area_name`, `area_floor` | the area and floor lists |
| `local_time(when)` | the house's zone. That is HA's `get_config` zone once `Authz.tz` has it, `cfg.house_tz` until then. It's read at every call. A naive time is taken as the house's. |
| `call_service` | handed to `caller` (`features.FeatureCaller`, through the gateway). With no caller it raises `HouseCommandsDisabled`; a refusal raises `HouseCommandRefused(code)`. |

`registry.py` gained four read-only properties (`area_entries`, `device_entries`, `entity_entries`,
`floor_entries`). The adapter's device/floor indexes rebuild only when HA reloads a registry.

**Differences from HaHouse, forced by HA's wire format** (pinned in `tests/test_mantel_house.py`):

- The StateStore drops contexts, so a host can't tell a person's change from the house's.
- HA's registry *list* call doesn't carry `supported_features`, `device_class` or
  `original_device_class`, so those read `None`. Feature code reads the state's attributes first.
  Clean Areas only falls back to the registry for an offline robot.
- `area_name` falls back to the area id for an unnamed area.

**The contract.** hk_core's own behavioural suites run a second time with MantelHouse underneath:
`tests/test_mantel_house_contract_{clean_areas,notifications,sleep,music,screensaver,tablets,settings}.py`
(108 tests). Each swaps the suite's `FakeHouse` for a subclass (`tests/mantel_house_fakes.py`). The
subclass writes the fake's data in HA's wire shapes into a real `StateStore` and `Registry`, and reads
it back through `MantelHouse`; service calls go through `MantelHouse.call_service`. So the same
expectations that pin HaHouse pin MantelHouse. A sabotage check (MantelHouse returning no states)
fails 24 of the 33 sleep and notification tests, so the contract files really do exercise the adapter.

## The Service actor: feature commands through the gateway

A feature's own house command (the Sleep Screen, the linked backlight) runs through **the same
`gateway.Gateway` code path** as a person's. It runs as the server's own Service subject:
user id `mantel:features`, name "Mantel features", role `service`.

- `FeatureGateway` is a `Gateway` subclass. It shares the app's `Audit` and reads the app's command
  connection at each call, so it uses none while commands are off.
- `FeatureAuthz` wraps the app's `Authz` and adds grants for the Service actor only.
- **The grants are computed, not stored.** The actor gets `control` on exactly the entities the
  enabled features act on: each acting tablet's kiosk parts (light/switch/select/button) and each
  linked backlight. Anything else is `no_grant` (pinned: `lock.unlock` and `homeassistant.restart`
  are refused). An Owner's stored deny grant naming user `mantel:features` still wins (explicit deny
  wins; pinned).
- Order, as for a person:
  1. RBAC
  2. the audit row first (actor `mantel:features`, role `service`)
  3. Home Assistant, only if `cfg.commands_enabled`
- **With commands off:** the gateway answers `commands_disabled` and writes a `denied` / `not_sent`
  row. The caller raises `HouseCommandsDisabled`, and the attempt is listed with outcome `would` in
  `GET /api/features/status`. So every intended action is audited and observable, and nothing is
  sent.
- **Clean Areas** runs as the person who asked (their `Principal` is the call's `context`), with that
  person's rights and name in the audit. HA does the same: it runs in the caller's context.

## The feature host (`hosts/server/mantel_server/features.py`)

`features.register(app, hub, hooks)` installs:

- `app["features"]` (a `FeatureHost`)
- its reads in `app["read_routes"]` and its messages in `app["ws_handlers"]`
- its REST routes
- **the linked handler**: `app["linked"].handler` becomes `FeatureLinked`, replacing `MemoryHandler`

It also chains itself after HaClient's `on_change` / `on_registry` callbacks, so `server.py` stays
unedited.

**Settings.** The pieces and their settings live in Mantel's settings store as `house/mantel_features`
(versioned, with history), checked by `check_settings`. Every piece is off by default, and a piece
that's off does nothing.

| REST | Who |
|---|---|
| `GET /api/features/status` | Owner/Admin |
| `GET /api/features/settings` | Owner/Admin |
| `PUT /api/features/settings` | Owner only (CSRF through the existing middleware) |

A settings save, a tablet/board change (the settings feed) or a registry reload brings every piece
back in line.

### Each feature on Mantel

| Piece | What runs | House commands? |
|---|---|---|
| `notifications` | See below. | None. Delivery is Mantel's own. |
| `linked` | See below. | Only the opt-in `backlight` (gated). |
| `sleep` | See below. | Kiosk calls, gated. With commands off it records `would`. |
| `clean_areas` | `mantel/clean_areas/coverage` (read: offered areas + coverage) and `clean_areas_run {areas, dry_run}`: `hk_core.clean_areas.async_clean` through MantelHouse | Each robot's call is gated and runs **as the person who asked**. With commands off: `ok: false`, each robot `commands_disabled`. |
| `energy` | `mantel/energy/plan` (read; RBAC feature `energy` through `hooks.may_read`): HA's Energy settings via the read proxy's server read (`energy/get_prefs`), the house via MantelHouse (`energy_context`, HA's `collect` ported to the port), then `hk_core.energy.plan.build`. Gap: a sensor's helper source (Utility Meter → Integral) isn't on the port, so power sensors are found by the Energy settings, the options and the meter's device. | None |
| `live_tv` | `mantel/live_tv/guide` (read): the HDHomeRun `lineup.json` and the XMLTV guide, fetched from the URLs in the settings every 30 min (at most 60 MB; `hooks.fetch` in tests), parsed by `hk_core.live_tv_guide`; channels with now/next | None |

**`notifications`.** It follows the hub's changes. `banner.goes_off` decides what a change sets off
(Goes Off When, Only When, Not Again For, Mute 1 Hour). Then:

- `banner.build`'s payload goes to every Mantel screen on **`hk_frontend/events/subscribe`**, the
  message type HK's page already opens, served from `read_routes`. A frame naming `users` reaches only
  those people. A user matches by their Mantel id, their linked HA user id or their username.
- Wakes the Screen goes through the Sleep Screen engines, with Do Not Disturb respected unless the
  notification is Important.
- Mute 1 Hour: `notify_mute {key, seconds}` is persisted in `house/notify_mutes`, so it survives a
  restart.
- Not on Mantel yet: camera snapshots (`snap` stays None), calendars' look-ahead, and the `notify`
  action.

**`linked`.** This is the real handler at Phase 5's hook point.

- `set_black_screen` acts on Mantel's screens through hk_core's `Black`. The new state is pushed to
  linked HA **before** the answer: the confirmed handshake.
- `show_popup` / `close_popup` go to the screens' feed, checked against Mantel's pop-ups
  (`unknown_popup`).
- Switch commands: black screen and photo screensaver. The alarm is `not_supported`.
- Each tablet's four entities are published with hk_frontend's unique ids:
  - unique id `{entry}_{uid}_{key}`, device `{entry}_{uid}`
  - entity ids `switch.<tablet>_black_screen`, `switch.<tablet>_photo_screensaver`,
    `binary_sensor.<tablet>_screen_in_use`, `sensor.<tablet>_sleep_screen`
  - states from the screensaver rules (in-use window, attributes), `Black` and the Sleep Screen engine
    (`want` + its attributes)
  - unchanged states aren't re-sent
- The entry id comes from the settings, else the settings import's `ha:<entry id>`.
- Opt-in `backlight`: a forwarded black screen also sets the tablet's backlight (the kiosk's
  `light.*_screen`, or `backlights[tablet]`): lowest when black, the carried brightness when woken.

**`sleep`.** There's one `MantelSleep` (`hk_core.sleep.engine.Sleep`) per tablet whose Sleep Screen is
Decided By HK; `shadow` decides and never acts.

- The sleep and the wake are HA's `sleep_engine.py` sequences, with Mantel's own black and photos.
- Kiosk calls (screensaver mode/switches, screen light, brightness, bring to front) go through
  `MantelHouse.call_service`.
- With commands off, each call is recorded as `would` (`status.sleep[tid].actions`), plus an audit row.
- The decisions, presence memory, loop guard and timers are hk_core's. Mantel's own photos and black
  are Mantel's state, not house commands.
- Gap: the power-button-in-quiet-hours wake can't be detected, because the StateStore keeps no
  contexts.

**Screens.** `ScreenState` per tablet holds the black (`Black`), the photos, the last touch, the
screensaver's own touch and whether the screen is in use. The page reports with
`screen_report {tablet, touch?, saver?, black?}`. That's allowed only as
`screensaver.rules.may_speak_for` says: the tablet's user, an admin, anyone for a tablet with no user,
or a wall-tablet device in the tablet's room. Mantel tells screens to change with
`{"type": "screen", "tablet", "black"|"photos", ...}` frames on the same events feed.

**Not on Mantel (unchanged by this slice).** These still run in HA, or aren't in scope here:

- the music engine (it talks to MA directly: decisions are shared, steps are Phase 4+)
- Alarm PIN (`not_supported` in linked mode)
- the tablets' alerts/restart and the Live TV viewers, cameras and transcode
- calendars and the history proxies (already read proxies)

None of these message types is command-shaped. A house command still only ever leaves through the
gateway.

## The page's side (`web/shim/`, 2026-10-18)

Only Mantel's host adapter changed. The shared frontend (`web/hk`, `web/client`, `web/cards`) still sends
and reads exactly what it sends to Home Assistant, and HA's build is byte-identical.

- **Events feed.** `hk_frontend/events/subscribe` goes to `hub.readSubscribe` (it was stood in locally), so
  notifications and pop-ups reach HK's `hk-house-event` as they do from HA. `screen` frames are Mantel's
  own and are not passed on: they move the two switches below. On subscribe the server first sends a
  `screen` frame for any tablet that is already black (with its brightness) or showing photos, so a page
  reloaded under a black screen is told.
- **What HK reads when HA tells it.** In HA a tablet's black screen and photo screensaver are two switches
  whose states `hk-saver.js` reads (`black_switch`, `screensaver_switch`). Mantel has no such entities, so
  `mantel-host.js` keeps the same two states for each tablet under ids of its own,
  `switch.mantel_<tablet>_black_screen` and `switch.mantel_<tablet>_photo_screensaver`. It names them in
  the settings feed where the server names none (`tablet_items.<tablet>.black_switch` /
  `screensaver_switch`; a switch the server did name is kept), and sets them from the `screen` frames
  (`black`, with `brightness` as an attribute, and `photos`). Until the feed has answered (plus 400 ms for
  the initial frames) a state is "not known", which HK reads as "no change", never as "not black".
- **What the page sends** (in `mantel-client.js`, in front of the gateway; on every server, commands on or
  off; none is a house command, and none calls an HA service):

  | HK sends (the HA message) | Mantel sends |
  |---|---|
  | `hk_frontend/screensaver/touch {tablet, saver?}` | `screen_report {tablet, touch: true, saver?: true}` |
  | `hk_frontend/screensaver/black {tablet, black}` | `screen_report {tablet, black}` |
  | `hk_notify/mute {key, minutes}` | `notify_mute {key, seconds: minutes * 60}` |

  The page's own report moves its black switch at once (a tap that wakes the screen must not be undone by
  the stale "on" it was holding). An error from the server (`forbidden` for a tablet that isn't the page's,
  `invalid`) rejects the promise and is swallowed by HK as it is for an older integration. A report
  without a `tablet` (the pre-1.14 `dashboard` form) is refused in the page, sending nothing.
- **The photo switch.** HK turns its photo switch on when the screensaver starts and off when it ends
  (`switch.turn_on|turn_off`). On Mantel that call is answered inside the page (the switch is the page's
  own state) and nothing is sent. Any other service call is refused with commands off, or goes to the
  gateway with them on, exactly as before.
- **RBAC** is the server's, unchanged: `screen_report` only as `may_speak_for` says (the tablet's user, an
  admin, anyone for a tablet with no user, or a wall-tablet device in the tablet's room); `notify_mute` any
  signed-in person.
- **Not reported to the server:** that the *photos* came up or went away. `screen_report` has no field for
  it (touch, saver touch and black only), so Mantel's `ScreenState.photos` follows linked HA / Sleep Screen
  commands, not the page. Adding a `photos` field is a small follow-up if Sleep Screen needs it.

## Tests

| File | Covers |
|---|---|
| `tests/test_shim_features.py` (10) | the real shim run in node (`tests/shim_features_harness.mjs`; `hk-client.js`, `mantel-client.js`, `mantel-host.js`, `hub.js`): the events feed, `screen` frames moving the switches, the settings feed naming them, the exact `screen_report` / `notify_mute` frames with commands off and on, the photo switch local, everything else refused or gated as before, the shared frontend untouched |
| `tests/test_features.py` | (+1) a page that subscribes under a black screen / photos gets the `screen` frames |
| `tests/test_mantel_house.py` (6) | wire shapes → views, `last_changed`, copies, registry fields the list lacks, devices/areas/floors, a reloaded registry, the house's zone (callable, naive, unknown), `call_service` to the caller or refused, the port satisfied |
| `tests/test_mantel_house_contract_*.py` (108) | hk_core's clean areas, notifications, sleep, music, screensaver, tablets and settings suites with MantelHouse underneath |
| `tests/test_features.py` (17) | See the list below. |

`tests/test_features.py` covers:

- every piece off by default (nothing runs, nothing audited), and the settings checks
- the REST is Owner-only, and a save is versioned with its author
- a state change → a notification on a signed-in screen's feed, waking the shadow engine, a mute
  persisted and honoured
- `users` filtering
- linked:
  - hello with the four entities and unique ids
  - the handshake: state before the result, page confirms, tap wakes and touches
  - pop-ups to the feed, `unknown_popup`
  - the photos command
  - a page speaking for someone else's tablet refused
- the backlight with commands off: `would` in the status, plus a `denied` / `commands_disabled` row
  for the Service actor, and no command connection
- the backlight with commands on (FakeCommander): two `light.turn_on` frames, `allowed` / `ok` rows
- the Service actor refused a lock and a restart, and an Owner's deny grant wins
- the Sleep Screen with commands off: the sleep's calls recorded as `would`, Mantel's black up, no
  loop, the sensor published, a walk-in wakes it
- the Sleep Screen with commands on: kiosk switches sent through the gateway, and the grants are
  exactly the kiosk parts
- Clean Areas as the person (dry run sends nothing; the run is audited with the person's role), and
  with commands off
- the energy plan from fake prefs, and RBAC (a Guest is refused)
- the Live TV guide from fake fetches
- a caller with no gateway, and `energy_context` over the port

## e2e against the scratch HA (`tools/e2e/features_e2e.py`)

`~/.venvs/mantel/bin/python tools/e2e/features_e2e.py` starts the scratch HA (`testha.py up --fresh`;
it waits while `testha.py status` shows another job using it). It runs Mantel in-process against it
twice, with temp databases and the one wiring line, then stops HA. The evidence is in
`<TESTHA_DIR>/features_e2e.json`.

Run 2026-10-18, both a `--reuse` iteration and the full `up --fresh` … `down` run: **26/26 checks passed**.

- **Both phases:**
  - Mantel reads the scratch HA (121 demo entities).
  - MantelHouse answers states, areas and the house's zone (America/New_York, from HA's `get_config`).
  - The demo `binary_sensor.basement_floor_wet` going on (set through the scratch HA's own REST)
    sets off the notification rule. "Basement Floor Wet: Water detected." reaches the fictional
    screen, with no audit row and no house command.
  - The fake linked `hk_frontend`'s hello carries the tablet's four entities.
  - `set_black_screen` pushes the state before the answer, and the screen's report makes linked HA
    see `confirmed: true`.
- **Phase A, commands disabled:**
  - The status lists `light.turn_on {light.bed_light, brightness 1}` as `would`.
  - Its audit row is `mantel:features` / `service` / `denied` / `commands_disabled` / `not_sent`.
  - No command connection exists, and `light.bed_light` is unchanged in HA.
- **Phase B, commands enabled:**
  - The same request makes HA report `light.bed_light` on at brightness 1, through the gateway.
  - Its audit row is `mantel:features` / `light.turn_on` / `allowed` / `ok`.
  - Exactly one call reached HA.
  - The wake carries brightness 150 back, and HA shows it.

## Validation (this worktree)

- `~/.venvs/mantel/bin/python -m pytest -q`: **1513 passed** (1382 before; +131: 6 + 108 + 17).
- `tools/build_ha.py` → built 3,255 files (into a temp folder inside the worktree, deleted after);
  `tests/run` → **all suites green**. The HA build is unchanged by this slice.
- `tools/headless/client_smoke.py`: passed (0 external requests, 0 browser exceptions).
- `tools/e2e/features_e2e.py`: 26/26.

## Wiring (orchestrator, `server.py`)

In `wire()`, after `linked.register(app, hub)` (the `hooks` there is the connectors' `Hooks`, which
carries `may_read`):

```python
from . import features            # with the other slice imports
...
    linked.register(app, hub)
    features.register(app, hub, hooks)
```

Nothing else changes: every piece stays off until an Owner turns it on (`PUT /api/features/settings`).

## Exact continuation point

1. **Wire the line above** in `server.py` (gateway agent's rework permitting), then run
   `tools/e2e/features_e2e.py` again. It calls `features.register` itself, so after the wiring it
   should construct the app without calling it a second time: drop that call in `phase()`.
2. ~~**The page's side**~~ **done** (2026-10-18, `web/shim/` only; see "The page's side" below).
3. **Feature settings import:** read HA's Notifications / Clean Areas / Energy / Live TV feature items
   into `house/mantel_features` (today an Owner writes them by REST). The tablets, boards and pop-ups
   already come from P3.5's import.
4. **What's still HA-only on Mantel:**
   - notification snapshots
   - calendars' look-ahead and the `notify` action (in linked mode, later)
   - Alarm PIN through the gateway (linked `alarm_*` commands)
   - the music engine against MA
   - the tablets' alerts and restarts, and the Live TV viewers and cameras

   Each goes through `MantelHouse` and `FeatureCaller` the same way.

Files:

- `hosts/server/mantel_server/house.py`
- `hosts/server/mantel_server/features.py`
- `hosts/server/mantel_server/registry.py` (4 read-only properties)
- `tests/mantel_house_fakes.py`, `tests/test_mantel_house.py`, `tests/test_mantel_house_contract_*.py`,
  `tests/test_features.py`
- `tools/e2e/features_e2e.py`
