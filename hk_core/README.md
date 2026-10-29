# hk_core/

HK's feature logic, written once for every host (PLAN.md §4; plan review, §0). Plain Python with
no `homeassistant` imports (but for three files of `link/`, below), and only relative imports of itself. It talks to the house through
the `House` port (`house.py`). Both rules are enforced by `tests/test_boundaries.py`.

The HACS build vendors this folder as `custom_components/hk_frontend/hk_core/` (see
`publish.py`'s plan). Mantel Server imports it as `hk_core`. Mantel Link vendors only what it uses
(`__init__.py` and `link/`, its `publish.py`'s `CORE_PARTS`) as `custom_components/mantel/hk_core/`.

`link/` is the one part that is not host-neutral: what HK Frontend and Mantel Link, the two Home
Assistant integrations, had as copies of each other, written once. `mantel_link.py` is the client of
Mantel Server's linked endpoint (aiohttp only); `talk.py`, `talk_live.py` and `page_headers.py`
import Home Assistant (`tests/test_boundaries.py` names these three) and Mantel Server never
imports `link`. Each integration keeps thin modules of the same names that give them their own
address, domain and delivery: `talk.URL` (`/api/hk_frontend/talk`, `/api/mantel/talk`), the
`<domain>/talk/live` command, and `page_headers`' subscription (HK Frontend) or `get` (Mantel Link).
Both integrations' tests run against the shared copy through those modules.

## Moved so far (feature by feature, as each one moves)

| Module | Was | Host side that stays | Tests run once here |
|---|---|---|---|
| `house.py` | (new) the `House` port: states, registries, services; for notifications also every state, a device's entities, area names, the house's time zone; for music an area's floor (`area_floor`); the screensaver and tablets needed nothing new; for the Sleep Screen a state's `last_changed` (not compared) | HA: `hosts/ha/.../house.py` (`HaHouse`) | through the features below; `area_floor`, and the device and entity reads the tablets rely on, and `last_changed`, also in HA's `tests/py/test_house.py` |
| `clean_areas.py` | `features/clean_areas/clean.py` | thin wrapper with the same names (`HaHouse(hass)`) | `tests/test_hk_core_clean_areas.py` |
| `live_tv_guide.py` | `features/live_tv/guide.py` | re-export | `tests/test_hk_core_live_tv_guide.py` |
| `energy/` (`const`, `plan`, `power`; `settings`: HK Settings' Energy checks, from `settings_ws.py`, 2026-10-18) | `features/energy/` | `collect()`, which reads HA's registries and sensor component; the page and its websocket commands | `tests/test_hk_core_energy.py` |
| `notifications/` (`rules`, `const` moved; `dnd`, `accessories`, `banner`, `calendars`, `migrate`, `settings` from `__init__.py` and `settings_ws.py`) | `features/notifications/` | thin wrappers with the same names (`HaHouse(hass)`, Alarm PIN's panels); following states and the registry, the calendars' clock and `calendar.get_events`, snapshots, the pop-ups' channel, waking screens, stored options, websocket commands, the `notify` action and its schema | `tests/test_hk_core_notifications.py` |
| `music/` (`const` moved; `config`, `engine` from `music.py`; `checks` from `flows.py`; `settings` from `settings_ws.py`; `warm` from `warm.py`; `queue` and `announcements` from `__init__.py` and `announcements.py`) | `features/music/` | thin wrappers with the same names (`HaHouse(hass)`; `MusicConfig.from_entry`, `MusicManager`'s attributes, the timings tests shorten); the engine's steps (every `media_player` / `music_assistant` call in the caller's context, waits on state events, per-room locks, Stop's cancelling, persistent notifications, log lines); the library and queue reads; Keep Playlists Ready's switch, timer and task, and finding Music Assistant's client; announcements' event listeners, timers and `aliases`; actions, websocket commands, flows, stored options | `tests/test_hk_core_music.py` |
| `screensaver/` (`rules`: the board a tablet reads, `wanted`, the in-use window and rule, the entities' attributes, the tablets on a screen and who may speak for one, the old WallPanel helper's mirroring, which entities a tablet has, when it gets a Sleep Screen engine, the feed's entity ids; `black`: what the black screen switch means) | `screensaver.py`, `switch.py`, `binary_sensor.py` | thin wrappers with the same names (`window_of`, `as_board`, `wanted(entry)`, `Manager`'s attributes and methods; the black screen switch keeps a shared `Black`); the entities, devices and registry, adding and removing them, websocket commands (`screensaver/touch`, `/black`), the in-use sensor's timer, following the old helper's state and its `input_boolean` call, restoring state, holding one Sleep Screen engine per tablet | `tests/test_hk_core_screensaver.py` |
| `tablets/` (`kiosk`: parts by role, the kiosk devices, a kiosk's screen, the checks and the kiosk-screensaver fix; `suggestions`; `alerts`: offline / charging / not back, the restart's times and plan; `setup`: Setup Check's line) | `tablets.py`, the fix in `panel.py` | thin wrappers with the same names (`parts(hass, …)`, `checks`, `suggestions`, `check_lines`, `Watch` with `_raised`/`_restarted`, `CLEAR_WAIT` for the tests); reading the tablets' settings off the entry (through `settings.py`), the store of browsers seen, the minute's timer and the restart's schedule, the button presses, persistent notifications and the banner | `tests/test_hk_core_tablets.py` |
| `settings/` (`model`: the schema and DEFAULTS, every value's check, the older shapes lifted (`*_lifted`, `settings_tidied`), each screen resolved, what a screen is handed (`as_client`), and what is saved as plain data (`Stored`: options + items, `to_dict` / `from_dict`); `changes`: the settings page's writes (`apply_house`, `apply_board`, `apply_tablet`); `kinds`: Status & Chips' kinds table, `blank`, `clean`, `LEGACY`) | `settings.py` (moved wholesale to `model`), `settings_api.py` (moved wholesale to `changes`), the table at the top of `kinds.py` | thin wrappers with the same names: `settings.py` re-exports the model (its private names too) and keeps the functions that take a config entry (`boards`, `tablets`, `popups`, `custom_pages`, `custom_chips`, `taken_ids`, `as_client`: the entry read into a `Stored` by `stored(entry)`), `suggestions(hass)` and `find_extras` (HACS's files); `settings_api.py` re-exports the checks and adds `hk_panel` (HK as HA's own sidebar panel) to `TOP`; `kinds.py` keeps finding, resolving and tracking; the config entry as the store, the flows, websocket commands and dispatcher signals | `tests/test_hk_core_settings.py` |
| `sleep/` (`rules`: the Sleep Screen's settings, what counts as on, the schedule, `decide`, `action`; `engine`: one screen's memory and decisions, `Sleep`: the facts through the House, presence lingering, the power button's minute, a notification's while, the screensaver's own taps, the next moment to look again, the brightness and the display to turn off, the loop guard (`room_to_act`); the Kiosk Satellite devices and parts) | `sleep_rules.py` (moved wholesale), `sleep_engine.py` | `sleep_rules.py` re-exports; `sleep_engine.py`'s `Engine` is a `Sleep` reading `HaHouse` with HA's clock and date parser, and keeps every name the tests patch (`CONFIRM_S`, `KIOSK_WAIT_S`, `SETTLE_S`, `BACKSTOP_S`, `SAVER_WAIT`, `_recent`, `_task`, `_timer`, `_side`); following the entities and the clock, the contexts (the power button is a change with none), the sensor, and the sleep and the wake -- service calls with waits between them | `tests/test_hk_core_sleep.py` |
| `art/` (`resize`: the size buckets, `render` (pixels only), the byte-bounded LRU `Cache`; `fetch`: where artwork may be fetched from, the encoded address, the fetch that checks every redirect; 2026-10-29) | `art.py` (re-exports the names; HA's name lookup, executor, session, signing, view) | `connectors/media_art.py` in Mantel (size buckets on the player's art route, remote covers fetched and scaled here) | `tests/test_hk_core_art.py` |

Notifications keep their watching host-side on purpose: HA follows states with its trackers and
Mantel will follow its state hub, so `banner.goes_off` takes one change and answers what it sets
off, and `calendars.look_ahead` takes the host's `events` and `deliver`. Do Not Disturb's shape
(`dnd.hhmm`, `notify_dnd`) is shared with the settings model (`settings/model.py`), which re-exports it.

Music moves its DECISIONS and keeps its steps host-side on purpose: in Mantel the engine talks
to Music Assistant directly (PLAN.md §3, §10), not through HA's `media_player` services, so the
service vocabulary, the waits on HA's state events and the notifications stay with HA's engine
and only the rules are shared. Each request asks them before and between its steps: what it
claims (`entangled`, `Claims`: newest wins), what is in the way (`in_the_way`, `split`), who
leads (`play_target`, `move_plan`), what a move leaves behind (`stale`), the refusals and the
volume steps. The rules only read the house; none calls a service, so the port gained one read
(`area_floor`) and no service-response call. Keep Playlists Ready's round talks to Music
Assistant's own client (`warm.MusicServer`: `send_command`), never to the house; HA finds the
client its integration holds, Mantel will hold its own. Announcements' `aliases` (a player's
native and Music Assistant twins, matched by MAC connections and unique ids) stay in HA: the
port does not carry those registry fields, and widening it for one HA-specific identity rule
was not worth it.

The screensaver and tablets move their DECISIONS too, and the port needed nothing new: the
tablets' rules read states and the device and entity registries it already carried (a kiosk
app's enabled entities through `device_entities`' `disabled`), and the screensaver's rules
read only the old helper's state; everything else is handed in. The tablets' and screens'
settings stay HA's until settings move (the host reads them from the entry and passes plain
dicts, and a screen's resolved board through `wanted`'s `screen_board`), as do the Sleep
Screen engines; the clock is the host's (`now` is passed, so HA's frozen test clock still
rules). The alerts answer what to raise and clear (`Alert`, `note_id`) and the restart what to
press, in order; the host shows and presses. The old helper's mirroring answers the
`input_boolean` call; HA makes it without waiting, as before, which `House.call_service`
(always waited for) could not.

Settings move as a MODEL with no store: every function that read a config entry takes a `Stored`
(the options and the items -- screens, tablets, pop-ups, custom pages and chips -- as plain data),
and a store only gets and puts its dict (`to_dict` / `from_dict`), which is what Mantel's SQLite
store (P3.5) needs and what an import from HA reads. HA's `settings.py` reads the entry into one
on every call (`stored(entry)`), so the entry stays the only truth there. Two pieces stayed with
HA on purpose: `find_extras` (HACS's `www/community` files and `/hacsfiles/` URLs) and the
`hk_panel` option's check (HK as HA's own sidebar panel, `hk_panel.py`), which `apply_house`
takes as a host's own check beside `TOP`. The photo addresses the model accepts (`SKY_PHOTO`:
HA's `image_upload`, `/local/`, `/hk/`) are still HA's spellings; they did not change here. Two
JavaScript parity tests that read the Python table (`test_liveliness.js`,
`test_strategy_rebuild.js`) now read `hk_core/settings/model.py`.

The Sleep Screen moves its DECISIONS and keeps its steps host-side, as music did: the facts are
read through the House (a state's `last_changed` is the port's one addition), the clock is
injected, and `Sleep.decide(now)` answers what to show and when to look again; the brightness
and the quiet-hours display answer what to set (`brightness_step`, `quiet_display_off`) and the
host sets it. The sleep and the wake stay in `sleep_engine.py`: they are sequences of service
calls with waits on the kiosk's and the page's answers between them, in HA's vocabulary
(contexts with a parent so nothing reads them as a person's hand), and Mantel will drive the
kiosk its own way. The screensaver and tablets still hand their settings in through HA's
`settings.py` (unchanged); calling the model directly is left for when Mantel needs it.

All the feature moves of the plan review are done.
