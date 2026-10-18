# packaging/ha-app/

Mantel Server packaged as a Home Assistant App (add-on), the third way to run it (PLAN §8), installed as
a **local App**: the Supervisor builds `Dockerfile` from a folder that `tools/stage_ha_app.py` assembles.

| File | What it is |
|---|---|
| `config.yaml` | The App: slug `mantel`, Ingress on port 8099, `panel_admin: false` (wall tablets and household members open it), `homeassistant_api: true` (HA's built-in App credential), options `commands_enabled` (false), `log_level`, `default_screen`, `ha_door_rules`. No `image:` (local build), no ports. |
| `Dockerfile` | `python:3.12-slim-bookworm`, the pinned `requirements.txt`, then `app/` (staged). Starts as root only so `entrypoint.py` can chown `/data`, then runs the server as uid 10001. |
| `requirements.txt` | Exact dependency versions (the ones the tests ran with). |
| `DOCS.md` | What HA shows on the App's Documentation tab. |
| `translations/en.yaml` | Option names and descriptions. |
| `icon.png` | The store icon (a mantelpiece; drawn by a script, no third-party artwork). |

Stage it (never by hand):

```bash
~/.venvs/mantel/bin/python tools/stage_ha_app.py --dry-run          # list + private-content scan, writes nothing
~/.venvs/mantel/bin/python tools/stage_ha_app.py /path/to/local_apps/mantel
```

The staged folder holds `app/entrypoint.py` (packaging/docker/entrypoint.py), `app/hosts/server/mantel_server`,
`app/hk_core`, and `app/web` stamped by `tools/build_static.py`. Identity, the door decision, the path prefix,
install steps and removal: `docs/phase3/HA-APP.md`.
