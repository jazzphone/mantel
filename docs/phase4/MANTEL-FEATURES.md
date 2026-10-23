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
| `live_tv` | `mantel/live_tv/guide` (read): the HDHomeRun `lineup.json` and the XMLTV guide, fetched from the URLs in the settings every 30 min (at most 60 MB; `hooks.fetch` in tests), parsed by `hk_core.live_tv_guide`; channels with now/next. **Where Mantel has its own go2rtc** (`--go2rtc-url`, Docker/LXC): `live_tv.py` serves HK's whole Live TV page from it (`hk_tv/channels`, the channel cameras and "now playing" sensors with HA's entity ids, the WebRTC signaling to go2rtc, `sensor.tv_viewers`, linked HA's Live TV entities). Settings gained `quality` (`720`/`1080`). | None (watching TV is a read; the heartbeat `tv_watching` isn't a command) |

Since 2026-10-18 ([FEATURE-PARITY.md](FEATURE-PARITY.md)): the feature import fills these settings from HA
(plus `ha`, what HA has added, and `live_tv.names`); `clean_areas` also answers HK's own
`hk_clean_areas/subscribe`; `energy`'s plan goes to the screens in the settings feed (`energy`), with
Status & Chips' thermostats as HA's plan has them; the import leaves Mantel's own Live TV guide fetch off
(the page reads HA's channel cameras through the interim `hk_tv/channels`), except where Mantel has its own
go2rtc: there the re-import turns Live TV on and Mantel serves it (FEATURE-PARITY.md "Live TV served by Mantel").

**`notifications`.** It follows the hub's changes. `banner.goes_off` decides what a change sets off
(Goes Off When, Only When, Not Again For, Mute 1 Hour). Then:

- `banner.build`'s payload goes to every Mantel screen on **`hk_frontend/events/subscribe`**, the
  message type HK's page already opens, served from `read_routes`. A frame naming `users` reaches only
  those people. A user matches by their Mantel id, their linked HA user id or their username.
- Wakes the Screen goes through the Sleep Screen engines, with Do Not Disturb respected unless the
  notification is Important.
- Mute 1 Hour: `notify_mute {key, seconds}` is persisted in `house/notify_mutes`, so it survives a
  restart.
- Since the Phase 4 ports (below): a camera's snapshot (`snap`) and the calendars' look-ahead. Not on
  Mantel yet: the `notify` action.

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

- ~~the music engine~~ moved 2026-10-18: see "Music" below (on once Music Assistant is given to Mantel)
- Alarm PIN in linked mode (`not_supported` until linked.py calls `alarm_pin.linked_command`; the keypad
  itself is on Mantel since 2026-10-18, below)
- in the HA App only: the Live TV cameras and transcode (Docker/LXC: Mantel's since 2026-10-18,
  FEATURE-PARITY.md "Live TV served by Mantel"; the viewer heartbeat is counted by Mantel everywhere;
  the tablets' alerts/restart and the calendars' look-ahead moved since: "Phase 4 ports" below)
- the history proxies (already read proxies)

None of these message types is command-shaped. A house command still only ever leaves through the
gateway.

## Music: the engine in Mantel, talking to Music Assistant directly (2026-10-18)

`hosts/server/mantel_server/music.py` (`app["music"]`, a `MusicHost`; wired in `server.wire()` after the feature
host). HA's `hk_frontend` music engine is no longer needed once it is on.

**The switch (`MusicHost.active`).** Mantel answers only when **both** Music Assistant is configured in Mantel
(`cfg.ma_url` and its token file: [../OPERATIONS.md](../OPERATIONS.md) section 7a) **and** the music settings are
in Mantel's store (`house/music`, from the feature import). Otherwise every music read goes to the interim bridge
(readproxy.py, as before) and every music action to HA's engine through the gateway, so the house keeps working
in HA App mode until Avery gives Mantel a Music Assistant token. `GET /api/music/status` (Owner/Admin) says which.

**What runs where.**

| Part | On Mantel |
|---|---|
| Decisions | hk_core/music (config, engine, checks, settings, queue item, warm), unchanged, over MantelHouse: the Music Assistant players' `media_player` states and registry entries HA's `music_assistant` integration keeps |
| Steps | Music Assistant's own WebSocket commands (connectors/ma.py), exactly what HA's integration sends for each service call HA's engine makes (`music.to_ma`): `media_pause/stop/next/...` → `players/cmd/*`, `unjoin` → `players/cmd/ungroup`, `join` → `players/cmd/group_many`, `volume_set` → `players/cmd/volume_set` (0..100), `shuffle_set` → `player_queues/shuffle`, `music_assistant.play_media` → `player_queues/play_media`, `transfer_queue` → `player_queues/transfer`, queue jump → `player_queues/play_index`. A player's MA id is its registry `unique_id` (platform `music_assistant`), its queue id its player id |
| Engine | `MantelMusic`: HA's MusicManager ported line for line (per-room locks, the newest request wins, Stop cancels, waits on the players' state changes from the hub, every request answers `{ok, leader}` / `{ok: false, message}`) |
| Reads | `hk_music/subscribe`, `hk_music/queue` (`player_queues/get_active_queue` + `player_queues/items`), `hk_music/settings/library` (`music/playlists/library_items`); HK Settings' music page (`hk_music/settings/get`) is feature_pages.py's one route, which answers with `MusicHost.page` (Mantel's settings) while the engine is on |
| Settings | `house/music` in Mantel's settings store (versioned); HK Settings' saves (`hk_music/settings/set`, `preset/save`, `playlist/save`, `playlists/order`, `item/remove`) are checked by hk_core's settings rules and written there |
| Keep Playlists Ready | `MantelWarmer` (hk_core's rounds) on Mantel's MA client, while the switch is on and the engine runs; its two refresh reads are **server-only** (`MA_SERVER_READS`: `playlist_tracks` with `force_refresh`, `recently_played_items` with a time) and a page's `ma/read` can never send them |
| `hk_music/used` | the page's adapter sends `music_used` (`web/shim/mantel-client.js`), answered by the music host on every server, commands on or off: Keep Playlists Ready waits. Never a command |

**Per person, per device.** The feed's `home` is the signed-in person's home room (chosen in Mantel's music
settings, keyed by Mantel user; or, until then, the one HA had for the HA user they are linked to: imported as
`ha:<HA user id>`), else the wall tablet's: the first speaker, in the order the speakers were picked, in the
device's room. It is sent only if the person may view that speaker. HA's own answer was Mantel's HA user's, so
the bridge always sent `null`.

**RBAC.** Reads: feature `music`; only the players the subject may `view` (a preset when its sync group or all
its rooms are viewable; a hidden or nonexistent queue answers `not_found`); the settings page needs `configure` on
settings (HA: `require_admin`). Actions (`classify_service` / `classify_ws`, called from `gateway.classify`):
`control` on feature `music` and `hk_frontend.music_*` on every room/source/player the call names; Stop All names
every room and a preset's group is checked as its rooms (`MusicHost.expand`); `queue_play` is
`media_player.play_media` on its player; the settings writes are `configure` on settings. This also fixes the
fallback: through the gateway those service calls used to be `configure` on settings (Owner/Admin only), and the
settings writes `control` on music (any Adult). **Wall tablets** get a house grant of `view`/`control` on feature
`music` (`authz.HOUSE_GRANTS`; recorded for Avery's review): HK's Music page on every tablet, its speakers still
its room's.

**Commands.** Only through the gateway: RBAC, the audit row first, then `Gateway._forward` →
`MusicHost.run(principal, music, audit_id)`, which mints a `MusicRun`. The MA client's gate is the gateway, and
`Gateway.allow` lets a `MusicRun` through only while it is open, only for the engine's own commands
(`RUN_COMMANDS`), and only on the house's speakers (their MA ids). **Commands off** (the house): there is no
gateway, the MA client's gate is `REFUSE_ALL`, and the page's commands are answered `commands_disabled` before
anything is sent; nothing reaches Music Assistant (pinned). Answers keep HA's shapes: a service call
`{context, response}`, a refusal without `return_response` an error (HA's `_answer`), a settings refusal
`invalid_format` with HA's JSON field map.

**Import.** `music.import_doc`: when HA has Music added (panel/get's `features.hk_music`), one server-only read of
`hk_music/settings/get` (new in `readproxy.SERVER_ONLY_READS`); speakers, volume, home rooms, presets, playlists
(HA's item ids kept), Keep Playlists Ready and Ignore Announcements. HA's user names are not kept. It runs with the
one-time settings import and with `POST /api/features/import`.

**Ignore Announcements.** Mantel observes HA's `call_service` events through its read-only state connection.
TTS, announced media and Music Assistant announcements mark their players before playback arrives. Native and
Music Assistant counterparts match by device/MAC identity. Only target IDs and the announcement flag reach the
tracker; spoken text is not retained or forwarded. Markers end on completion, resumed music, ordinary play,
failed-start timeout (20 seconds), maximum lifetime (120 seconds), or disconnect. The setting controls display
suppression only; no audio or automation changes are made. The feed filters markers to permitted players.
Fictional lifecycle, feed and no-command tests pass; live speaker/display acceptance remains after deployment.

**Not on Mantel (documented gaps).**
- **The failure notifications** HA raises (`music_play_failed`, `speaker_group_failed`, ...: HK's Speakers picker
  shows them): Mantel logs them and lists them in `/api/music/status` (`notes`), but does not create HA
  persistent notifications (nothing is written to HA).
- **Browse's library lists** (Discover's shelves and every category list: `music_assistant.get_library` with a
  response) are Mantel's reads when Music Assistant is given to Mantel: the page's shim sends that one service as the
  read `music_assistant/get_library`, Mantel checks its fields against HA's action, needs `view` on the music feature,
  and answers `{items}` in HA's shape from Music Assistant's library commands, on every server (commands off too;
  nothing audited, nothing to HA). A picture that is not a web address goes by Music Assistant's
  `/imageproxy/<proxy_id>` under Mantel's `/ma` (MA 2.10 answers its older `?path=&provider=` form 400; that form is
  kept only for an MA that sends no `proxy_id`; the route needs `control` on music and `--ma-web-url`). Without Music
  Assistant in Mantel the call goes the old way (the gateway: HA's, or refused with commands off). The tree reads
  (`media_player/browse_media`, `search_media`: an album's tracks, an artist's albums, a search) still go through
  HA. When HA fails to open a playlist (its bare `unknown_error`), Mantel asks Music Assistant once for the same
  songs: a refused sign-in (MA's LoginFailed: Apple Music's user token expired, so the account's own saved
  playlists cannot be read while catalog playlists from a search still open) is answered `login_failed` with what to
  do, and Keep Playlists Ready's note says the same.
- **Not run against a real Music Assistant** (none for testing; the house's is never contacted): the message
  shapes follow HA's integration and the official client, and are pinned against a fake. `ma_players` relies on
  HA's `music_assistant` entities' `unique_id` being the MA player id, and the queue id being the player id.

Tests: `tests/test_music.py` (26, against `tests/music_fakes.py`'s fake MA: exact MA messages per request, RBAC,
per-person and per-tablet home room, commands off, the gate, the switch, import, Keep Playlists Ready, settings
saves), `tests/test_shim_features.py` (+2, `music_used`), `tests/test_packaging.py` (+1, the App's token file).
Offline e2e over real sockets: `~/.venvs/mantel/bin/python tools/e2e/music_e2e.py` (12/12; commands off then on).

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
- **The photos are reported** (since the Phase 4 ports): when HK turns its photo switch on or off (the
  photo screensaver came up / went away), the page also sends `screen_report {tablet, photos}`, so Mantel's
  `ScreenState.photos` (what the Sleep Screen and linked HA read) follows the page too. A refusal leaves the
  page's own switch as HK set it.

## Phase 4 ports (2026-10-18, second slice)

Five more pieces moved onto Mantel, each through `MantelHouse` and `FeatureCaller`, each with RBAC, an
allowlist of keys, and no HA token in anything a page gets. HA's own engines are untouched; the only HA-side
change is a no-behaviour move of Energy's settings checks into `hk_core/energy/settings.py` (HA's
`settings_ws.py` re-exports every name; 697 HA Python tests pass unchanged).

**1. Notification snapshots** (`notify_snaps.py`). A notification naming a camera (an item's Snapshot, a
Cameras category's camera) has its picture taken first, as HA's `async_deliver` does:

- Taken by Mantel through its own HA credential (`GET <ha>/api/camera_proxy/<camera>`, the still route's
  call; the connectors' `ha_token` hook), at most 6 s and 8 MB, image types only. Nothing in time: the
  notification goes without (`snap: null`), as in HA.
- Kept in `<data_dir>/notify-snaps` (folder 0700, files 0600): the picture plus `{camera, type, until}`.
  Retention is HA's: 10 minutes, at most 30 (the oldest go first), pruned on every put, every minute and at
  start (a restart keeps the current ones).
- The events feed's `snap` is the picture's id (32 random hex characters).
- HK's `hk_notify/snap/sign {snaps}` is a Mantel read (`read_routes`): `{signed: {id: "/api/notify/snap/<id>"}}`,
  only for a picture of a camera the person may see as a still (`Authz.may_still`). The page's adapter
  (`mantel-host.js`) accepts only that exact path shape and puts the page's prefix in front (HA App mode).
- `GET /api/notify/snap/<id>`: signed-in, decided again with `may_still`; unknown, expired and refused all
  answer 404. `Cache-Control: private, max-age=<left>`, `nosniff`.

**2. Calendars' look-ahead** (`feature_watch.CalendarLook`). Once a minute, while Notifications is on and
has a Calendars item, `hk_core.notifications.calendars.look_ahead` runs over MantelHouse. The events come from
the read proxy's REST calendar read (`GET /api/calendars/<calendar>?start&end`, Mantel's own credential),
turned into `calendar.get_events`' shape. What is due goes out the one notification way (snapshot, feed,
Wakes the Screen). HK Settings' Calendars test (`hk_notify/test`) uses `calendars.sample` the same way.

**3. Tablet alerts and restarts** (`feature_watch.TabletWatch`, piece `tablets`, off by default):

- Every minute `hk_core.tablets.alerts.Alerts.check` over MantelHouse with the house settings' `tablets`
  choices. A raised alert is an Important banner on the screens (`banner.build_action`, as HA's `_banner`),
  listed in `GET /api/features/status` (`tablets.up`) until it clears. (HA also makes a persistent
  notification; Mantel has none.)
- The scheduled restart (`restart_times`, in the house's zone, once per minute): Clear Cache on every tablet,
  then each restart, every press a `button.press` through `MantelHouse.call_service` → `FeatureCaller` →
  the gateway as the Service actor. Its computed grants are exactly the planned buttons, only while the
  schedule is on. With commands off each press is audited `denied`/`commands_disabled` and listed `would`.
- "Restart all now" (HK's `hk_frontend/tablet/act {act: restart_all}`): the page's adapter sends Mantel's
  `tablets_restart`; it needs `configure` on settings (HA: admin), and runs as the person, each press a
  gateway command with that person's rights. No gateway change was needed.

**4. Photos in `screen_report`**: see "The page's side" above (`photos` bool; `may_speak_for` as before).

**5. HK Settings → Features** (`feature_pages.py`). The pages' `<id>/settings/get` reads are answered by
Mantel (`read_routes`, never forwarded) for Owners/Admins (RBAC `configure` on `settings`, and on
`notifications` / `energy` / `music` where RBAC has the feature):

| Page | Read | Saves |
|---|---|---|
| Notifications | `hk_core` `notifications.settings.page` over Mantel's piece and MantelHouse | `settings/set`, `item/save`, `item/remove` (the shared checks); `test` is Mantel's own delivery |
| Clean Areas | HA's page shape over `hk_core.clean_areas` | `settings/set` (vacuums, areas) |
| Energy | options, plan, devices, batteries, sections from HA's Energy settings (read by Mantel) + MantelHouse | `settings/set`, `device/set`, `device/section` (`hk_core/energy/settings.py`) |
| Live TV | Mantel's piece and its own lineup copy (no tuner is read for the page) | `settings/set`: host, guide, channels, names; `quality` refused (the transcode is HA's) |
| Music | Mantel's own music settings (`music.MusicHost.page`, HA's shape) while Mantel's music engine is on ("Music" above); otherwise INTERIM: HA's page, a server-only read rebuilt key by key | through the gateway as commands (`hk_music/*`, `configure` on settings) to `house/music` when the engine is on; `settings_write` still refuses them `not_yet` |
| Alarm PIN | INTERIM: HA's own page, a server-only read rebuilt key by key (`pin_set` only, never a PIN or hash) | still refused `not_yet` (its settings are HA's until that port lands) |

Saves go through the page's `settings_write` (`settings_store.FEATURE_SAVES`, kind `feature`; the page's
`mantel-client.js FEATURE_SAVES` is pinned to it), are checked by the shared checks, and are written as a new
version of `house/mantel_features` with who made them (the settings store's history); nothing is sent to HA.
The running pieces follow at once (a reload).

**Decisions for Avery** (recorded here, not in PLAN.md):

- Snapshots keep HA's retention (10 min, 30 at most) and are plain files under the data folder (0600), not
  encrypted at rest. Any signed-in person who may view the camera as a still can load a picture.
- Calendar and tablet-alert banners go to every signed-in screen, as HA's do; no per-person RBAC filter on
  the feed's notifications (unchanged from the first slice).
- Tablet alerts on Mantel are banners only (no persistent notification); the banner goes out even when the
  notifications piece is off (with Notifications' defaults), so an alert is never silent.
- "Restart all now" on Mantel needs the `tablets` piece on; with it off the page is told `not_set_up`
  rather than forwarding HA's `tablet/act` through the gateway.
- Live TV's settings saved in Mantel change Mantel's piece only; HA's channel cameras keep HA's settings until
  the transcode moves.
- Music and Alarm PIN pages read HA through an interim server-only read (two new `READ_ALLOWED` entries, both
  in `SERVER_ONLY_READS`).

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
Extended with the Phase 4 ports (phase A) and run again `up --fresh` the same day: **35/35**. The leak
notification carried a snapshot of the demo camera (taken through Mantel's credential, served by
`/api/notify/snap/<id>` as a 43,965-byte JPEG); `calendar.calendar_1`'s "Future Event" was read by Mantel and
sent by the look-ahead; HK Settings' Notifications page was answered and saved by Mantel with nothing about it
read from or written to HA; a page's `photos` report reached linked HA's photo screensaver switch.

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
3. ~~**Feature settings import**~~ **done** (2026-10-18, [FEATURE-PARITY.md](FEATURE-PARITY.md)): part of
   the one-time import, and on its own with `POST /api/features/import` (Owner) or the Ingress people
   page's button. The screens are told what HA tells them (`added`, `energy`, panel/get's `features`);
   Clean Areas' picker is answered by Mantel; Live TV's channel list is an interim filtered read.
4. **What's still HA-only on Mantel:**
   - ~~notification snapshots~~ done (Phase 4 ports, below)
   - ~~calendars' look-ahead~~ done; the `notify` action (in linked mode, later)
   - ~~Alarm PIN through the gateway~~ **done 2026-10-18** (`alarm_pin.py`; GATEWAY.md "The alarm"):
     Mantel checks the keypad's code (the house's Alarm PIN, set in Mantel or imported from HA's page
     without its PIN; since decision 25 a person's own PIN is no longer accepted), decides arm/disarm as sensitive, audits first and sends to the
     alarm with Mantel's own copy of the alarm's HA code. Left: linked mode's `alarm_*` handler calling
     `alarm_pin.linked_command` (linked.py, another slice)
   - ~~the music engine against MA~~ built ("Music" below); waits for Music Assistant's URL and token in Mantel
   - ~~the tablets' alerts and restarts~~ done
   - ~~the Live TV viewers and cameras~~ **done where Mantel has go2rtc** (2026-10-18, `live_tv.py`); the HA
     App keeps HA's Live TV by decision (FEATURE-PARITY.md)

   Each goes through `MantelHouse` and `FeatureCaller` the same way.

Files:

- `hosts/server/mantel_server/house.py`
- `hosts/server/mantel_server/features.py`
- `hosts/server/mantel_server/registry.py` (4 read-only properties)
- `tests/mantel_house_fakes.py`, `tests/test_mantel_house.py`, `tests/test_mantel_house_contract_*.py`,
  `tests/test_features.py`
- `tools/e2e/features_e2e.py`
