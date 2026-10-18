# hk_core/

HK's feature logic, written once for every host (PLAN.md §4; plan review, §0). Plain Python with
no `homeassistant` imports, and only relative imports of itself. It talks to the house through
the `House` port (`house.py`). Both rules are enforced by `tests/test_boundaries.py`.

The HACS build vendors this folder as `custom_components/hk_frontend/hk_core/` (see
`publish.py`'s plan). Mantel Server imports it as `hk_core`.

## Moved so far (feature by feature, as each one moves)

| Module | Was | Host side that stays | Tests run once here |
|---|---|---|---|
| `house.py` | (new) the `House` port: states, registries, services | HA: `hosts/ha/.../house.py` (`HaHouse`) | through the features below |
| `clean_areas.py` | `features/clean_areas/clean.py` | thin wrapper with the same names (`HaHouse(hass)`) | `tests/test_hk_core_clean_areas.py` |
| `live_tv_guide.py` | `features/live_tv/guide.py` | re-export | `tests/test_hk_core_live_tv_guide.py` |
| `energy/` (`const`, `plan`, `power`) | `features/energy/` | `collect()`, which reads HA's registries and sensor component | `tests/test_hk_core_energy.py` |

Next, in order of risk: notifications rules, the music engine (direct to Music Assistant in
Mantel), the screensaver and tablets, then settings and the sleep engine.
