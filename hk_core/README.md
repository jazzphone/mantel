# hk_core/

HK's feature logic, written once for every host (PLAN.md §4; plan review, §0). Plain Python with
no `homeassistant` imports, and only relative imports of itself. It talks to the house through
the `House` port (`house.py`). Both rules are enforced by `tests/test_boundaries.py`.

The HACS build vendors this folder as `custom_components/hk_frontend/hk_core/` (see
`publish.py`'s plan). Mantel Server imports it as `hk_core`.

## Moved so far (feature by feature, as each one moves)

| Module | Was | Host side that stays | Tests run once here |
|---|---|---|---|
| `house.py` | (new) the `House` port: states, registries, services; for notifications also every state, a device's entities, area names, the house's time zone | HA: `hosts/ha/.../house.py` (`HaHouse`) | through the features below |
| `clean_areas.py` | `features/clean_areas/clean.py` | thin wrapper with the same names (`HaHouse(hass)`) | `tests/test_hk_core_clean_areas.py` |
| `live_tv_guide.py` | `features/live_tv/guide.py` | re-export | `tests/test_hk_core_live_tv_guide.py` |
| `energy/` (`const`, `plan`, `power`) | `features/energy/` | `collect()`, which reads HA's registries and sensor component | `tests/test_hk_core_energy.py` |
| `notifications/` (`rules`, `const` moved; `dnd`, `accessories`, `banner`, `calendars`, `migrate`, `settings` from `__init__.py` and `settings_ws.py`) | `features/notifications/` | thin wrappers with the same names (`HaHouse(hass)`, Alarm PIN's panels); following states and the registry, the calendars' clock and `calendar.get_events`, snapshots, the pop-ups' channel, waking screens, stored options, websocket commands, the `notify` action and its schema | `tests/test_hk_core_notifications.py` |

Notifications keep their watching host-side on purpose: HA follows states with its trackers and
Mantel will follow its state hub, so `banner.goes_off` takes one change and answers what it sets
off, and `calendars.look_ahead` takes the host's `events` and `deliver`. Do Not Disturb's shape
(`dnd.hhmm`, `notify_dnd`) is shared with HA's `settings.py`, which re-exports it.

Next, in order of risk: the music engine (direct to Music Assistant in
Mantel), the screensaver and tablets, then settings and the sleep engine.
