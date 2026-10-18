# hk_core/

HK's feature logic, written once for every host (PLAN.md §4; plan review, §0). Plain Python with
no `homeassistant` imports, and only relative imports of itself. It talks to the house through
the `House` port (`house.py`). Both rules are enforced by `tests/test_boundaries.py`.

The HACS build vendors this folder as `custom_components/hk_frontend/hk_core/` (see
`publish.py`'s plan). Mantel Server imports it as `hk_core`.

## Moved so far (feature by feature, as each one moves)

| Module | Was | Host side that stays | Tests run once here |
|---|---|---|---|
| `house.py` | (new) the `House` port: states, registries, services; for notifications also every state, a device's entities, area names, the house's time zone; for music an area's floor (`area_floor`); the screensaver and tablets needed nothing new | HA: `hosts/ha/.../house.py` (`HaHouse`) | through the features below; `area_floor`, and the device and entity reads the tablets rely on, also in HA's `tests/py/test_house.py` |
| `clean_areas.py` | `features/clean_areas/clean.py` | thin wrapper with the same names (`HaHouse(hass)`) | `tests/test_hk_core_clean_areas.py` |
| `live_tv_guide.py` | `features/live_tv/guide.py` | re-export | `tests/test_hk_core_live_tv_guide.py` |
| `energy/` (`const`, `plan`, `power`) | `features/energy/` | `collect()`, which reads HA's registries and sensor component | `tests/test_hk_core_energy.py` |
| `notifications/` (`rules`, `const` moved; `dnd`, `accessories`, `banner`, `calendars`, `migrate`, `settings` from `__init__.py` and `settings_ws.py`) | `features/notifications/` | thin wrappers with the same names (`HaHouse(hass)`, Alarm PIN's panels); following states and the registry, the calendars' clock and `calendar.get_events`, snapshots, the pop-ups' channel, waking screens, stored options, websocket commands, the `notify` action and its schema | `tests/test_hk_core_notifications.py` |
| `music/` (`const` moved; `config`, `engine` from `music.py`; `checks` from `flows.py`; `settings` from `settings_ws.py`; `warm` from `warm.py`; `queue` and `announcements` from `__init__.py` and `announcements.py`) | `features/music/` | thin wrappers with the same names (`HaHouse(hass)`; `MusicConfig.from_entry`, `MusicManager`'s attributes, the timings tests shorten); the engine's steps (every `media_player` / `music_assistant` call in the caller's context, waits on state events, per-room locks, Stop's cancelling, persistent notifications, log lines); the library and queue reads; Keep Playlists Ready's switch, timer and task, and finding Music Assistant's client; announcements' event listeners, timers and `aliases`; actions, websocket commands, flows, stored options | `tests/test_hk_core_music.py` |
| `screensaver/` (`rules`: the board a tablet reads, `wanted`, the in-use window and rule, the entities' attributes, the tablets on a screen and who may speak for one, the old WallPanel helper's mirroring, which entities a tablet has, when it gets a Sleep Screen engine, the feed's entity ids; `black`: what the black screen switch means) | `screensaver.py`, `switch.py`, `binary_sensor.py` | thin wrappers with the same names (`window_of`, `as_board`, `wanted(entry)`, `Manager`'s attributes and methods; the black screen switch keeps a shared `Black`); the entities, devices and registry, adding and removing them, websocket commands (`screensaver/touch`, `/black`), the in-use sensor's timer, following the old helper's state and its `input_boolean` call, restoring state, the Sleep Screen engines (`sleep_engine.py`, a later move) | `tests/test_hk_core_screensaver.py` |
| `tablets/` (`kiosk`: parts by role, the kiosk devices, a kiosk's screen, the checks and the kiosk-screensaver fix; `suggestions`; `alerts`: offline / charging / not back, the restart's times and plan; `setup`: Setup Check's line) | `tablets.py`, the fix in `panel.py` | thin wrappers with the same names (`parts(hass, …)`, `checks`, `suggestions`, `check_lines`, `Watch` with `_raised`/`_restarted`, `CLEAR_WAIT` for the tests); the tablets' settings (`settings.py`, a later move), the store of browsers seen, the minute's timer and the restart's schedule, the button presses, persistent notifications and the banner | `tests/test_hk_core_tablets.py` |

Notifications keep their watching host-side on purpose: HA follows states with its trackers and
Mantel will follow its state hub, so `banner.goes_off` takes one change and answers what it sets
off, and `calendars.look_ahead` takes the host's `events` and `deliver`. Do Not Disturb's shape
(`dnd.hhmm`, `notify_dnd`) is shared with HA's `settings.py`, which re-exports it.

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

Next: settings and the sleep engine.
