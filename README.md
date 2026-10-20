# Mantel

Mantel is HK Frontend as its own platform. **Mantel Server** is a service that talks to Home Assistant and Music Assistant over their APIs, serves the HK web app without Lovelace, and adds what Home Assistant cannot: real role-based access control, device-bound wall-tablet sign-in, per-user settings with history, and an audit log. The same repository still builds today's HK Frontend for Home Assistant (the HACS build), so nothing has to move all at once.

The master plan, with the reasons behind every decision, is [docs/PLAN.md](docs/PLAN.md). Section 0 of it is the current status and the history. This README is the map; running the thing is in [docs/OPERATIONS.md](docs/OPERATIONS.md), and moving the house over is in [docs/phase6/CUTOVER.md](docs/phase6/CUTOVER.md).

## Where things stand (2026-10-18)

| Part | State |
|---|---|
| HK Frontend inside Home Assistant (the HACS build) | **Live on the house.** Phases 1 and 2 are installed (build `a9ffb23`): the frontend talks only to `HKClient` and `hkShell`, draws with its own elements and view host, and boots from one ordered module. HK's own HA panel exists but is switched off. |
| Mantel Server | **Built and tested offline, and run against a scratch Home Assistant. Not running on the house.** State hub, accounts (Argon2id, TOTP, passkeys), sessions, wall-tablet device credentials, RBAC, the command gateway with its audit, tablet PINs, Music Assistant and camera connectors, the settings store with import from HA, service accounts and the linked-mode endpoint. |
| House commands through Mantel | **Off.** A server only sends a command to the house when its operator starts it with `--commands-enabled`. The house stays off until Avery approves it at cutover. |
| `hk_core` | Every feature's decisions (Clean Areas, Live TV guide, Energy, notifications, music, screensaver, tablets, settings, Sleep Screen) live here, shared by both hosts. |
| Linked mode (`hk_frontend` linked to Mantel) | Built on both sides and wired, off by default: per-tablet ownership (an Owner moves one tablet at a time, audited), Mantel's real handlers (black screen, pop-ups, notify, Alarm PIN through the gateway) and all 31 entities published. Checked on the scratch HA, not yet on the house. |
| Mantel Photos | **Built and tested, not on the house.** The screensavers' own photo library: albums, bulk upload (HEIC included, location removed), a grid with a preview, delete and move, an import from a Home Assistant media folder, an album per screen, in Mantel's backups ([docs/phase4/PHOTOS.md](docs/phase4/PHOTOS.md)). |
| Packaging | Written and statically checked. **The images have never been built or run: that needs Docker, which Avery has to install.** |

## The three ways to run Mantel Server

All three run the same image; only the setup differs (PLAN §8).

| | Proxmox LXC (this house) | Docker | Home Assistant App |
|---|---|---|---|
| What | Docker Compose inside an unprivileged LXC made by `packaging/lxc/mantel.sh`, QuickSync shared in | `packaging/compose/` on any Docker host | `packaging/ha-app/`, Mantel in HA's sidebar through Ingress |
| Status | Files and script written and statically checked; never run. QuickSync in an unprivileged LXC was proven live (Proof 4) | Same files; never run | **Scaffold, in progress** (`HA-APP.md` is being written). It starts and reports healthy; sign-in through Ingress does not work yet |
| Read | [packaging/lxc/README.md](packaging/lxc/README.md), [docs/phase3/PACKAGING.md](docs/phase3/PACKAGING.md) | [packaging/compose/README.md](packaging/compose/README.md) | [packaging/ha-app/README.md](packaging/ha-app/README.md) |

Outside Home Assistant, **Mantel Connect** ([packaging/mantel-connect/README.md](packaging/mantel-connect/README.md)) puts Mantel in HA's sidebar and the Companion app. Its identity proof passed live (including over cellular); the guided installer does not exist yet.

## Layout

| Path | What |
|---|---|
| `web/` | The HK frontend, written once. `web/hk` the cards and modules, `web/client` the `HKClient` contract and host shell, `web/cards`, `web/shim` Mantel's own host adapter, `web/mdi` the icon subset. See [web/README.md](web/README.md). |
| `hk_core/` | Feature logic shared by both hosts. Plain Python, no `homeassistant` import. See [hk_core/README.md](hk_core/README.md). |
| `hosts/ha/` | The HA host: `custom_components/hk_frontend` (the integration, its tests and docs) and `frontend/` (the HA adapters). Built into the HACS package by `tools/build_ha.py`. See [hosts/ha/README.md](hosts/ha/README.md). |
| `hosts/server/` | Mantel Server (`mantel_server/`), Mantel Connect's receiver (`mantel_connect/`) and measurement tools. See [hosts/server/README.md](hosts/server/README.md). |
| `packaging/` | `docker/` (Dockerfile, entrypoint), `compose/`, `lxc/`, `ha-app/`, `mantel-connect/`. |
| `tools/` | `build_ha.py` (HA staging build), `build_static.py`, `package_check.py`, `export_writes.py`, `check_links.py`, `testha/` (scratch HA), `e2e/` (gateway end-to-end), `headless/` (browser checks). |
| `tests/` | Mantel's pytest suite, including the boundary lint (`test_boundaries.py`). |
| `docs/` | The plan, [operations](docs/OPERATIONS.md), the [cutover runbook](docs/phase6/CUTOVER.md), and the design notes of each phase (`phase1/` to `phase5/`, `proof1/`, `proof2/`). |

## Develop and test

Virtualenvs live outside the repository, because this folder is an SMB share and slow for them.

```bash
/opt/homebrew/bin/python3.12 -m venv ~/.venvs/mantel
~/.venvs/mantel/bin/pip install -e '.[dev]'
```

| What | Command | Notes |
|---|---|---|
| **Mantel Server and shared Python** | `~/.venvs/mantel/bin/python -m pytest -q` | The main suite (about 1,400 tests): server, accounts, RBAC, gateway, packaging checks, `hk_core`, the boundary lint, the docs link check. Offline; no Home Assistant needed. |
| **Frontend suites** (Node) | `build=$(mktemp -d); ~/.venvs/mantel/bin/python tools/build_ha.py "$build/ha"; sh "$build/ha/tests/run"` | Run in the *built* artifact, never from the source tree: the HA component holds no second copy of the frontend. `build_ha.py` makes a new folder and refuses private content; it never deploys. |
| **HA Python suites** | `(cd "$build/ha/tests/py" && ~/.venvs/hk-ha-test/bin/pytest -q -p no:cacheprovider)` | Needs `~/.venvs/hk-ha-test`: Home Assistant plus `pytest-homeassistant-custom-component` (currently HA 2026.9.4 on Python 3.14). Run it on the same `$build`. |
| **Offline smoke** | `~/.venvs/mantel/bin/python tools/headless/client_smoke.py` | Real Mantel Server, fictional state, isolated headless Chrome. Fails on any external request or browser exception. It uses a fixed Chrome port (9337): run it alone. |
| **Command page check** | `~/.venvs/mantel/bin/python tools/headless/gateway_page_check.py` | The page's side of commands (an unlock goes through with no prompt or PIN pad, at a session and a wall tablet), against a fake command connection. |
| **Scratch Home Assistant** | `tools/testha/run.sh` (or `testha.py up` / `check.py` / `testha.py down`) | A throwaway HA on `127.0.0.1:8124` with invented `demo` devices, running the built `hk_frontend`. About 8 minutes. Always `down` it afterwards. [tools/testha/README.md](tools/testha/README.md), [docs/phase1/TESTHA.md](docs/phase1/TESTHA.md). |
| **Gateway end to end** | `~/.venvs/mantel/bin/python tools/e2e/gateway_e2e.py` | Mantel with commands on, against the scratch HA only: roles (locks and the garage with no PIN, decision 25), the house Alarm PIN for the alarm, audit. 37 of 37 on 2026-10-18 (night). Refuses any other HA. |
| **Packaging, static** | `~/.venvs/mantel/bin/python tools/package_check.py` | Hardening checks on the Dockerfile, compose file, Caddyfile, LXC script and HA App. Add `--release` to also refuse placeholder image digests. |
| **Docs links** | `~/.venvs/mantel/bin/python tools/check_links.py` | Every relative link in `README.md` and `docs/**/*.md` must resolve. Also a test. |

Run Mantel Server by hand (loopback only, commands off):

```bash
~/.venvs/mantel/bin/mantel-server           # needs an HA token in ~/.config/mantel/ha_token
# then open http://127.0.0.1:8765/login  ->  /home  or  /dev
```

The flags, secrets and data folder are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Rules

These are enforced by tests where they can be.

1. **`hass` stays in the host adapters.** Nothing in `web/` names Home Assistant's object outside `web/shim/` (Mantel's adapter) and `hosts/ha/frontend/` (HA's). `hk_core/` never imports `homeassistant` and imports only itself, relatively. `tests/test_boundaries.py` and `tests/test_shell_boundary.py` fail otherwise.
2. **`hk_core` is the only home of feature decisions.** A feature moves by extracting its logic into `hk_core` behind the `House` port, running it in HA through the HA adapter, and only then wiring Mantel's own adapter.
3. **Commands are off by default.** Mantel Server can send a command to the house only when its operator sets `--commands-enabled`. No client message, REST call or setting can switch it on. Every command is classified, checked against the person's and the device's role, refused where roles deny (no PIN or step-up for house commands; only the alarm asks for the house Alarm PIN, decision 25), and written to the audit log before anything is sent.
4. **Secrets are files.** HA and Music Assistant tokens, the at-rest key and tunnel tokens are read from files (Docker secrets, `~/.config/mantel/`), never from environment variables, the image or the repository. Do not paste a token into chat. `*.token`, `.env` and `secrets/` are git-ignored.
5. **Nothing touches the house without approval.** The house's Home Assistant (`/Volumes/config`, 192.0.2.53) is changed only when Avery approves that specific action. Tests and checks use fictional users and the scratch HA. HK builds are installed on the house by the steps in [docs/phase1/LIVE-INSTALL.md](docs/phase1/LIVE-INSTALL.md).
6. **Apple's fonts and glyphs never ship.** SF Pro and SF Symbols stay out of the repository and every image; each home supplies its own.
7. **Git.** Commit as `jazzphone <jazzphone@users.noreply.github.com>` (set repo-locally) and push to the private `jazzphone/mantel`. The NAS share is slow and can lose a repository on a dropped connection, so the GitHub copy is the one that matters.

## Where to read next

| If you want to | Read |
|---|---|
| Run or look after Mantel Server | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| Move the house over | [docs/phase6/CUTOVER.md](docs/phase6/CUTOVER.md) |
| Understand the design and why | [docs/PLAN.md](docs/PLAN.md) |
| Install an HK build on the house | [docs/phase1/LIVE-INSTALL.md](docs/phase1/LIVE-INSTALL.md) |
| Accounts, sessions, devices | [docs/phase3/ACCOUNTS.md](docs/phase3/ACCOUNTS.md) |
| Roles, grants, the read filter | [docs/phase3/RBAC.md](docs/phase3/RBAC.md) |
| The command gateway and audit | [docs/phase3/GATEWAY.md](docs/phase3/GATEWAY.md), [docs/phase3/PINS-AUDIT.md](docs/phase3/PINS-AUDIT.md) |
| Settings and the import from HA | [docs/phase3/SETTINGS.md](docs/phase3/SETTINGS.md) |
| Music Assistant, cameras, read proxies | [docs/phase3/CONNECTORS.md](docs/phase3/CONNECTORS.md) |
| Linked mode | [docs/phase5/LINKED-MODE.md](docs/phase5/LINKED-MODE.md) |
| Phase roadmaps | [docs/phase2/ROADMAP.md](docs/phase2/ROADMAP.md), [docs/phase3/ROADMAP.md](docs/phase3/ROADMAP.md) |

In progress and not written yet: `HA-APP.md` (the App's Ingress mode), `ADMIN-PAGE.md` (managing people and tablets in the page) and `BACKUP-FILES.md` (backups, "your files"). This README and the runbooks call them out where they matter.
