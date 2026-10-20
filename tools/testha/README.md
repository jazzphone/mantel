# testha: a scratch Home Assistant for the HACS build

A throwaway Home Assistant on this Mac, with **invented devices only** (HA's `demo`
integration), that runs the *built* `hk_frontend` custom integration (`tools/build_ha.py`)
exactly as HACS would install it. It checks what the Node suites and the Mantel smoke cannot:
that the HA build still works inside a real HA frontend.

## Use

```
~/.venvs/mantel/bin/python tools/testha/testha.py up --fresh   # build, wipe + write config, start, onboard, add HK, make 3 dashboards
~/.venvs/mantel/bin/python tools/testha/check.py               # click through it in headless Chrome; PASS/FAIL per item
~/.venvs/mantel/bin/python tools/testha/testha.py down         # stop HA (always do this when done)
```

`up` without `--fresh` rebuilds HK into the existing scratch config and restarts HA (state, user
and dashboards are kept). `testha.py status` says whether it is running. `run.sh` is the same
three steps in one go (`tools/testha/run.sh`: up, check, down).

HA answers on `http://127.0.0.1:8124`: `/hk-scratch` (computer: menu open, the main test
screen), `/hk-wall` (wall tablet, photo screensaver on, `?hk_saver=force` to test it),
`/hk-phone` (phone/iPad; the checks switch its menu between button and tab bar), `/hk-settings`
(the HK Settings panel). Login is automatic in the check script (a token in localStorage); in
your own browser `trusted_networks` with `allow_bypass_login` signs 127.0.0.1 in without a password.

Results and screenshots go to `<scratch>/shots/` (`results.json`, `*.png`): never committed.

## Options

| Command | What it does |
|---|---|
| `testha.py up --fresh` | wipe the scratch config and credentials, then start clean |
| `testha.py up --ordered-boot` | **experiment, scratch copy only**: HA's frontend `import()`s HK's bootstrap modules in parallel, so they run in arrival order, not list order (see `docs/phase1/TESTHA.md`). This concatenates the dependency-free core into one ordered `hk-boot.js` and imports the rest after it, to prove order is the cause and that one ordered file fixes it. The repo is never touched. |
| `check.py --only home,light,weather,cameras,menu,tabs,saver,race,sim` | run some checks (8 and 8b always run) |
| `check.py --ordered` | hold the dependents of `hk-host-shell.js`/`hk-client.js` back so the build runs in list order; a cruder way to see past the race (hold times are guesses, so prefer `up --ordered-boot`) |
| `check.py --shots DIR` | where screenshots and `results.json` go (default `<TESTHA_DIR>/shots`) |
| `TESTHA_REPO=/path/to/tree testha.py up` | build HK from another checkout (e.g. a `git archive` of an older commit) to compare |

`<TESTHA_DIR>/build.json` records which commit the running build came from.

## An upgrade with a screen left open

`restart_check.py --new <tree>`: with the scratch HA running an OLD build
(`TESTHA_REPO=<old tree> testha.py up --fresh`), it opens `/hk-wall`, swaps HK for the build from
`<tree>` and restarts HA under the open page. Then it checks that same page: cards still drawn, a
state change still reaching a tile, and no errors since the swap. This is the case of a tablet nobody
may reload. Results: `<scratch>/shots-restart/restart.json`.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `TESTHA_VENV` | `<TESTHA_DIR>/venv` | venv with `hass` and the HA frontend (`bin/hass`) |
| `TESTHA_DIR` | `mantel-testha` in the system's temporary folder | holds `config/`, `build/`, `shots/`, `hass.log`, `hass.pid`, `testha.json` |

The venv needs HA's `demo` and `camera` requirements: `av`, `numpy`, `PyTurboJPEG` (HA
installs them itself at first start; if the first start fails on numpy, install them with
`uv pip install --python $TESTHA_VENV/bin/python av==17.0.1 numpy==2.3.2 PyTurboJPEG==1.8.3` and start again).

## Safety constraints (do not loosen)

- **Never** points at `/Volumes/config` or the house's HA; nothing reads `~/.config/mantel`. All
  writes go under `TESTHA_DIR` (the script refuses to delete anything outside it).
- HA binds `127.0.0.1:8124` only. HA 2026.9 keeps the `http:` block as a "pending" trial and
  reverts it after five minutes to its default (port 8123, **all interfaces**) unless confirmed.
  `up` confirms it (`http/config/promote`) right after start. If you ever start HA by hand,
  confirm the dialog in the UI within five minutes or stop it.
- No `default_config:`. Only: frontend, http, api, websocket_api, config, lovelace, auth, person,
  history, logbook, recorder (sqlite in the config dir), energy, image_upload, automation, camera,
  `demo`, and `hk_frontend` (its own dependencies add what HA requires, e.g. onboarding, stream).
  No zeroconf, ssdp, dhcp, bluetooth, homekit, cast, sonos, unifi, music_assistant, go2rtc.
- Onboarding is pre-marked done except its user step, so HA never adds Met.no, Google Translate
  or Radio Browser (network services). The one user is created through the onboarding REST API.
- The credential is a generated throwaway, stored only in `testha.json` (0600) and never printed.
- The check browser is an isolated headless Chrome (`tools/headless/cdp.py`) whose DNS resolves
  `127.0.0.1` only (`--host-resolver-rules`); any other request fails and is listed in the output
  (when HA's own error card renders it links HA's GitHub sources: those are the only ones seen).
- Everything the checks tap is a demo entity (`light.kitchen_lights`, a persistent notification).
- Nothing is committed or pushed by these scripts.

## What `check.py` covers

1 Home renders; 2 light tile toggle + detail sheet + brightness; 3 Weather page forecast
(`weather/subscribe_forecast` through the client's subscription port); 4 Cameras page and a
camera's live view; 5 side menu + notification badge (`persistent_notification`); 6 tab bar and
the HK Settings panel; 7 screensaver and its weather screen; 8 the whole session searched for
`not_allowed`, `read_only`, `commands_disabled`, `HKClient`, uncaught exceptions and failed
websocket results; 9 a load-order probe (HA imports HK's bootstrap modules in parallel), plus 9b/9c, which hold
`hk-host-shell.js` and `hk-client.js` back 2.5 s on purpose to show what the build does when
either arrives last.
Console noise that is expected (Apple's glyph and font files are licensed and never ship) is
filtered and listed separately.
