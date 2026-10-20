# Building and testing

Every command on this page runs from the repository root. The examples use a virtualenv in `.venv/` (git ignores
it); keep yours wherever you like and adjust the paths.

## Set up

Mantel needs Python 3.12 or newer.

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

This installs Mantel Server, `hk_core` and the test tools (`pytest`, `pytest-aiohttp`), and puts the
`mantel-server` command in `.venv/bin/`.

Optional tools that some checks use:

| Tool | Used by |
|---|---|
| Node.js (`node` on `PATH`) | a few tests in the main suite that run the page's JavaScript; they are skipped without it |
| Chrome or Chromium | the headless checks and the screenshot gallery |
| Python 3.14 | Home Assistant's test harness, for the HA package's Python suites |
| macOS | the HA package's JavaScript suites (they run on JavaScriptCore) |

## The main suite

```bash
.venv/bin/python -m pytest -q
```

This is the suite to run on every change. It is offline and needs no Home Assistant: Mantel Server, accounts,
RBAC, the gateway, connectors, the settings store, `hk_core`, the packaging checks, the boundary lints
(`tests/test_boundaries.py`, `tests/test_shell_boundary.py`) and the docs link check. Tests that need something
you don't have (Node, Chrome, Home Assistant's test venv, Caddy) are skipped and say why.

Run one file or one test the usual way:

```bash
.venv/bin/python -m pytest -q tests/test_gateway.py
.venv/bin/python -m pytest -q tests/test_boundaries.py -k hass
```

## The Home Assistant package

### Build it

`tools/build_ha.py` composes HK Frontend's HACS package from `hosts/ha/custom_components/hk_frontend`, `web/`,
`hk_core/` and the HA adapters in `hosts/ha/frontend/`. It writes a **new** folder (it refuses one that exists),
scans everything for private data first (private network addresses, keys, tokens, and the words in
`HK_PRIVATE`), and never installs or publishes anything.

```bash
build=$(mktemp -d)
.venv/bin/python tools/build_ha.py "$build/ha"
```

Run the HA suites in the **built** folder, never in the source tree: the component source holds no second copy of
the frontend.

### Python suites (Home Assistant's test harness)

These run on `pytest-homeassistant-custom-component`, which needs Python 3.14. The scripts and the main suite look
for this venv at `~/.venvs/hk-ha-test`, so create it there. Pin the harness to the version the published
package's CI uses (`hosts/ha/custom_components/hk_frontend/tools/publish/root/.github/workflows/tests.yml`):

```bash
python3.14 -m venv ~/.venvs/hk-ha-test
~/.venvs/hk-ha-test/bin/pip install pytest-homeassistant-custom-component==0.13.366
```

Then, on the same `$build`:

```bash
(cd "$build/ha/tests/py" && ~/.venvs/hk-ha-test/bin/pytest -q -p no:cacheprovider)
```

`$build/ha/tests/py/run` does the same, and creates the venv on first use if it is missing (unpinned).

Once `~/.venvs/hk-ha-test` exists, the main suite also runs Mantel Link's suite
(`hosts/ha/custom_components/mantel/tests/py`, through `tests/test_mantel_link.py`) and the linked-mode end-to-end
tests (`tests/test_linked_e2e.py`); without it they are skipped.

### JavaScript suites (macOS only, today)

The card and module suites run on JavaScriptCore's `jsc`, which ships with macOS, so they run only on a Mac for now.
The runner looks for `jsc` at its macOS system path.

```bash
sh "$build/ha/tests/run"            # every suite
sh "$build/ha/tests/run" chip       # only the suites whose name contains "chip"
```

### Mantel Link's package

Mantel Link has its own builder, which writes its public repository's layout to a new folder, scans it the same way,
and (without `--no-tests`) runs its suite there. It never creates a repository or pushes.

```bash
.venv/bin/python hosts/ha/custom_components/mantel/tools/publish/publish.py "$build/mantel-link" --no-tests
.venv/bin/python hosts/ha/custom_components/mantel/tools/publish/publish.py --scan
```

## Headless browser checks

These start a real Mantel Server in-process on `127.0.0.1` with a fictional house, and drive an isolated headless
Chrome through `tools/headless/cdp.py`. The browser may only reach Mantel's own address; any other request, and any
page exception, fails the check.

```bash
.venv/bin/python tools/headless/client_smoke.py          # the Home page and the client port, offline
.venv/bin/python tools/headless/gateway_page_check.py    # the page's side of commands, against a fake connection
.venv/bin/python tools/headless/admin_page_check.py      # the admin page (/admin), as an Owner on a phone-sized screen
.venv/bin/python tools/headless/settings_viewports.py    # Mantel Settings at iPhone and iPad sizes
.venv/bin/python tools/headless/ingress_smoke.py         # Mantel under a Home Assistant App's Ingress prefix
```

- **Which Chrome.** `$CHROME` if set; else Google Chrome at its macOS location; else the first of
  `google-chrome`, `google-chrome-stable`, `chromium` or `chromium-browser` on `PATH`.
- **As root** (a container, a CI runner), Chrome is started with `--no-sandbox`, because it refuses its sandbox as
  root. The pages are Mantel's own, on loopback.
- **One at a time.** Each check uses a fixed DevTools port (for example `client_smoke.py` uses 9337), so don't run
  two at once.

The screenshot gallery uses the same driver; see [Screenshots](Screenshots.md).

## A scratch Home Assistant

`tools/testha/` starts a throwaway Home Assistant on `127.0.0.1:8124` with only the `demo` integration's invented
devices, installs the **built** HK Frontend (and Mantel Link) into it as HACS would, and clicks through it in
headless Chrome. It checks what the other suites can't: that the HA build works inside a real Home Assistant
frontend. A full run takes several minutes.

You need a venv with Home Assistant itself in it (`bin/hass` and HA's frontend):
<!-- CHECK: the exact Home Assistant version and packages for the scratch venv (the design notes record HA 2026.9.4 on Python 3.14; is `pip install homeassistant==2026.9.4` enough, or is home-assistant-frontend needed separately?) -->

```bash
python3.14 -m venv ~/testha-venv
~/testha-venv/bin/pip install homeassistant
```

Then point the scripts at that venv. `TESTHA_DIR` (the scratch folder) defaults to `mantel-testha` in your system's
temporary folder; set it to keep the scratch Home Assistant somewhere else.

```bash
export TESTHA_DIR=$HOME/testha-scratch TESTHA_VENV=$HOME/testha-venv
.venv/bin/python tools/testha/testha.py up --fresh   # build HK, write config, start, onboard, add HK, make dashboards
.venv/bin/python tools/testha/check.py               # click through it; PASS/FAIL per item
.venv/bin/python tools/testha/testha.py down         # stop it (always do this)
```

`tools/testha/run.sh` does all three in one go; tell it which Python to use with `TESTHA_PY`:

```bash
TESTHA_PY=.venv/bin/python tools/testha/run.sh
```

<!-- CHECK: the scratch HA has only been run on macOS so far; confirm testha.py up/check.py work on Linux. -->

The scratch HA binds loopback only, has no discovery or network integrations, and keeps its generated credential
in `$TESTHA_DIR/testha.json`. Its options (`--only`, `--shots`, `TESTHA_REPO`, the upgrade check) and its safety
rules are in [tools/testha/README.md](../../tools/testha/README.md); the first run's record is
[TESTHA.md](../phase1/TESTHA.md).

## End to end against the scratch Home Assistant

`tools/e2e/` runs Mantel Server in-process against the scratch HA. The scripts start the scratch HA themselves
(`testha.py up --fresh`), wait if another job is using it, and stop it afterwards unless you pass `--keep-up`. They
refuse any other Home Assistant. Set `TESTHA_DIR` and `TESTHA_VENV` as above.

```bash
.venv/bin/python tools/e2e/gateway_e2e.py
```

`gateway_e2e.py` is the one place commands are ever on: fictional people (an Owner, an Adult, a Child) and a wall
tablet, roles allowing and refusing, the Alarm PIN for the demo alarm, and an audit row for every command. The
others cover linked mode (`linked_e2e.py`), Mantel Link (`mantel_link_e2e.py --phase …`), the features
(`features_e2e.py`, `feature_parity_e2e.py`) and talk-back (`talk_e2e.py`). `music_e2e.py` uses a fake Music
Assistant; `compose_e2e.py` and `live_tv_e2e.py` need Docker.

## Static checks

### Packaging

Hardening checks on the Dockerfile, the compose file, the Caddyfile, the LXC script and the HA App. They read the
files only; they cannot prove the image builds.

```bash
.venv/bin/python tools/package_check.py
.venv/bin/python tools/package_check.py --release    # also refuse placeholder image digests
```

### Docs links

Every relative link in `README.md` and `docs/**/*.md` must resolve, including `#anchors`. The main suite runs this
too (`tests/test_docs_links.py`).

```bash
.venv/bin/python tools/check_links.py
```

### Private words

`tools/check_private.py` fails when a tracked file (or, with `--messages`, a commit message or author) contains any
of a list of words you don't want published: your name, your street, your network's host names. The words never
come from the repository, because listing them there would publish them. They come only from:

- `HK_PRIVATE`: one regular expression, for example `word1|word2`;
- `HK_PRIVATE_FILE`: a file outside the repository with one regular expression per line (blank lines and `#`
  lines are skipped).

Matching ignores case. Findings name the file and line, never the matching text. With neither variable set there
is nothing to check and it exits 0.

```bash
HK_PRIVATE_FILE=~/.config/mantel/private-words .venv/bin/python tools/check_private.py
HK_PRIVATE_FILE=~/.config/mantel/private-words .venv/bin/python tools/check_private.py --messages origin/main..HEAD
```

We recommend running it as a pre-commit hook. Save this as `.git/hooks/pre-commit` and make it executable
(`chmod +x .git/hooks/pre-commit`):

```sh
#!/bin/sh
HK_PRIVATE_FILE="$HOME/.config/mantel/private-words" exec .venv/bin/python tools/check_private.py
```

With the words set, `tests/test_check_private.py` also checks the whole repository as part of the main suite.

## Running Mantel Server by hand

For development, run the server on your machine against a Home Assistant you use for testing. By default it
listens on loopback only (`127.0.0.1:8765`) and **commands are off**: it reads states, but cannot change anything
in the house.

It needs Home Assistant's address and a long-lived access token **in a file** (never on the command line or in an
environment variable). The default file is `~/.config/mantel/ha_token`.

```bash
.venv/bin/mantel-server --ha-url http://homeassistant.local:8123 --token-file ~/.config/mantel/ha_token
```

Then open `http://127.0.0.1:8765/login`. The first time, create the first Owner with a one-time setup token:

```bash
.venv/bin/mantel-server bootstrap
```

It prints the token (valid for an hour) and the `curl` call that spends it. If you started the server with
`--data-dir`, pass the same `--data-dir` to `bootstrap`. After you sign in, `/home` opens HK's screens and `/dev` is
a test page for the hub.

Useful flags: `--data-dir` (where `mantel.db` lives, default `~/.local/share/mantel`), `--secrets-dir` (the
at-rest key, default `~/.config/mantel/secrets`), `--port`, `--ma-url` and `--ma-token-file` (Music Assistant).
`--commands-enabled` turns the command gateway on; leave it off unless you are pointing at a test Home Assistant.
`mantel-server --help` lists everything, and [Operations](../OPERATIONS.md) explains the flags, secrets and data
folder.
