# Mantel

Mantel is HK Frontend as its own platform: a standalone server that talks to Home Assistant and Music Assistant over their APIs, serves the HK web app without Lovelace, and adds real role-based access control. The full plan is in [docs/PLAN.md](docs/PLAN.md).

**Status: Phase 0 (proof of architecture).** Everything here is isolated and read-only; nothing live changes.

## Layout

| Path | What |
|---|---|
| `web/` | HK cards, modules and shell; talks only to `HKClient` (empty until Phase 1) |
| `hk_core/` | Feature logic shared by both hosts; no `homeassistant` imports (empty until Phase 1) |
| `hosts/ha/` | The `hk_frontend` HA integration as a thin adapter / HACS build |
| `hosts/server/` | Mantel Server. Today: the read-only state hub prototype (`mantel_server/`) |
| `packaging/` | `ha-app/`, `mantel-connect/`, `lxc/`, `compose/` |
| `docs/` | The plan and measurements ([docs/MEASUREMENTS.md](docs/MEASUREMENTS.md)) |
| `tests/` | Unit tests plus the boundary lint (`tests/test_boundaries.py`) |

## Develop

The virtualenv lives outside the repo (this folder is an SMB share, slow for venvs):

```bash
/opt/homebrew/bin/python3.12 -m venv ~/.venvs/mantel
~/.venvs/mantel/bin/pip install -e '.[dev]'
~/.venvs/mantel/bin/python -m pytest
```

## Run the state hub

Needs a Home Assistant long-lived access token in `~/.config/mantel/ha_token` (read at startup, never printed or logged; the server stops with a message if the file is missing).

```bash
~/.venvs/mantel/bin/mantel-server            # http://127.0.0.1:8765/dev
~/.venvs/mantel/bin/mantel-server --ha-url http://192.0.2.53:8123 --default-interval 0 --override 'sensor.*_distance=1'
```

- Listens on **127.0.0.1 only** (not configurable). Host and Origin headers are checked.
- **Read-only.** The HA client can only send `auth`, `subscribe_entities`, the three registry list calls and `ping`. WebSocket commands get `commands_disabled`. The isolated `/api/proof2/command` endpoint only evaluates a dry-run request for the fictional `light.proof2_demo`; it never executes anything (see `docs/proof2/RESULTS.md`).
- `/dev`: pick an area or entities, watch live updates, see messages/bytes per second from HA vs to your client.
- Client protocol is documented at the top of `hosts/server/mantel_server/server.py`.

Measure upstream vs downstream traffic (server must be running):

```bash
~/.venvs/mantel/bin/python hosts/server/tools/measure.py --minutes 5
```

## Rules

- `hk_core/` never imports `homeassistant`; `web/` never references `hass.` (a test fails otherwise).
- Secrets (`*.token`, `.env`) are git-ignored. Do not paste tokens anywhere.
