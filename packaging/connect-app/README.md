# packaging/connect-app/

Mantel Connect as a Home Assistant App (add-on), for a **Mantel Server running outside Home Assistant**
(Docker, a Proxmox container). Installed as a **local App**: the Supervisor builds `Dockerfile` from a folder
that `tools/stage_connect_app.py` assembles. Guided pairing replaces the Phase 0 proof's manual key and
certificate transfer; start at `packaging/mantel-connect/README.md` and `docs/phase3/CONNECT.md`.

| File | What it is |
|---|---|
| `config.yaml` | The App: slug `mantel_connect`, Ingress on 8099, `panel_admin: false`, `boot: auto`, a `/healthz` watchdog, options `mantel_address`, `pairing_code` (a password field), `log_level`. No ports, no Supervisor or HA API, no host network, no mapped folders. |
| `Dockerfile` | `python:3.12-slim-bookworm`, the pinned `requirements.txt`, then `app/` (staged). Starts as root only to hand its `/data` folder to uid 10001, then drops root. |
| `requirements.txt` | Exact dependency versions (aiohttp and cryptography; nothing of Mantel Server). |
| `DOCS.md` | What HA shows on the App's Documentation tab. |
| `translations/en.yaml` | Option names and descriptions. |

`icon.png` is the Mantel icon with a link badge, `logo.png` (250x100) its name for the store; both are drawn by
`tools/make_brand_logos.py`.

```bash
.venv/bin/python tools/stage_connect_app.py --dry-run         # list + private-content scan, writes nothing
.venv/bin/python tools/stage_connect_app.py /path/to/local_apps/mantel_connect
```

The staged folder holds `app/mantel_connect/` (`__main__`, `app`, `pairing`, `pki`, `protocol`): the App's
code and the shared pairing protocol; nothing else of the repository.
