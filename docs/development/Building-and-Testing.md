# Building and testing

Every command on this page runs from the repository root. The examples use a virtualenv in `.venv/` (git ignores
it); keep yours wherever you like and adjust the paths.

## Set up

Mantel needs Python 3.12 or newer.

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

This installs Mantel Server, `hk_core` and the test tools (`pytest`, `pytest-aiohttp`, `pyyaml` for the workflow test), and puts the
`mantel-server` command in `.venv/bin/`.

Optional tools that some checks use:

| Tool | Used by |
|---|---|
| Node.js (`node` on `PATH`) | a few tests in the main suite that run the page's JavaScript; they are skipped without it |
| Chrome or Chromium | the headless checks and the screenshot gallery |
| Playwright (`playwright-core`, with its WebKit) and Node.js | Edit mode's browser check (`PLAYWRIGHT_PATH`, `NODE`) and the other `.cjs` checks |
| Python 3.14 | Home Assistant's test harness, for the HA package's Python suites |
| macOS | the HA package's JavaScript suites (they run on JavaScriptCore) |

## Local checks

The checks run on the developer's Mac, not on GitHub (its workflows run only by hand). The release workflow
([Releasing](Releasing.md)) runs the main suite once more on Linux, on 4 workers (`pytest -n 4`) beside the image
builds, and a release is tagged only when it passed; `tools/ci.py` is unchanged by that. One command runs the local
checks and prints one table:

```bash
~/.venvs/mantel/bin/python tools/ci.py quick     # about a minute: the main suite (8 workers, pytest-xdist) and the release checks
~/.venvs/mantel/bin/python tools/ci.py full      # also the HA build, HK Frontend's suites, the browser checks: those whose inputs changed
~/.venvs/mantel/bin/python tools/ci.py full --all    # every step, whatever passed before
~/.venvs/mantel/bin/python tools/ci.py full --plan   # which steps would run and which are unchanged; runs none
~/.venvs/mantel/bin/python tools/ci.py versions  # seconds: what reads the version files and changelogs (a release's re-check)
CI_JOBS=4 ~/.venvs/mantel/bin/python tools/ci.py full    # fewer at once (three quarters of the cores, at most 14, unless set)
CI_JOBS=22 ~/.venvs/mantel/bin/python tools/ci.py full --all  # ~220 s, not ~320 (2026-11-02), but load flakes in 2 of 3 runs
~/.venvs/mantel/bin/python tools/ci.py full --only js    # only the steps whose name contains "js"
~/.venvs/mantel/bin/python tools/ci.py --list            # every step and its tier
```

- **Side by side** (2026-10-30; one at a time, full took 24 minutes; 2026-11-01, 13 at once here): the build tools and HK Frontend's build run
  first; every other step then runs at once with the others, `CI_JOBS` of them (three quarters of the cores, at most 14, unless set), the longest first by
  the last run's times (kept in `.git/mantel-ci/step-times.json` too, so a fresh worktree has them; a step never
  timed counts as the longest); the CDP checks (`headless-*`) share one fixed DevTools port and run one after
  another. Edit mode and Swipe Between Pages are a step per engine and size, so they run side by side too, as do
  the Side Pane's check (a step per size) and the screensaver Shows' (`saver-shows-check-KofN`, every N-th of its
  runs each, `--shard K/N`): each was once the full run's last few minutes alone.
- **How long a step may take** (2026-11-02: one commit made the Shows' check ~13 times longer, and no run said so).
  A check run in parts is cut into as many as keep its longest part near 150 s (`ci.py` `PART_TARGET`; 2 to 12
  parts, the count kept in `.git/mantel-ci/timing.json`). The count holds still while the longest part stays
  between half and one and a half times that, since it is part of each part's name and key, and a run of only some
  parts (`--only`) never changes it. Under the table, **Slower than it should be** names each step past 240 s
  (`STEP_BUDGET`) and each step more than twice as slow as its own last ten passes two runs in a row (once is a busy machine); also a check in parts whose parts add up
  to much more than usual, and a whole full run whose steps do (more parts keep each part short, but the run waits
  on their sum, `CI_JOBS` at a time). Every step is measured against the run's
  own pace, so a busy machine slowing everything flags nothing. Each line says what to do: run the check in parts,
  cut its fixed waits, or look at what the change added. A warning never fails the run; read it before you push the
  change that caused it.
- **What the release run leaves out** (2026-11-08, the owner: "a lot of these tests aren't needed"). A step with
  `tier="by-hand"` runs only when named (`full --only NAME`), never in a whole run: the frame-timing checks
  (`swipe-motion-check`, `pre-glass-motion-check`). The screensaver Shows' check runs each Show at its first size
  (`--one-size`; whole, at three and four sizes, it was a third of the run's step time) and Swipe Between Pages at
  three sizes; run either script by hand for every size. Before adding a browser check to `full`, ask what it guards
  that the main suite can't, and give it the fewest engines and sizes that say so: a one-off bug's guard belongs in
  the main suite or by hand.
- **Waiting on the page, not the clock** (2026-11-02). The screensaver Shows' check (`saver_shows_check.cjs`
  `settle`) waits until the screensaver is still (nothing on the network, no fade running, its pictures and fonts in,
  what it draws unchanged a moment), never longer than the fixed wait it replaced: 1,822 s in all, not 2,163 s, the
  same 1,502 checks passing. Most of what is left is the screensaver's own fades (4 s in, 3 s between slides), which a
  check of what they end on must wait out. `SAVER_SETTLE=probe` keeps the old waits and says, for each, when the page
  was still and anything that changed after it; `SAVER_SETTLE=fixed` is the old check.
  The main suite runs on 8 workers (`CI_PYTEST_WORKERS`) where `pytest-xdist` is installed (`pip install -e
  '.[dev]'`); a parametrized test's ids must not depend on random data, or the workers collect different tests.
- **quick** is the main suite, `check_links`, `check_version`, `package_check --release`, and the private words
  in what is committed and in the commit messages `origin/main` hasn't got.
- **full** adds the HA build, HK Frontend's Python and JavaScript suites in it, the headless checks one at a time,
  Edit mode's browser check (`edit-mode-check`), the side strip's (`side-strip-check`) and the page swipe's
  (`page-swipe-check`), all when `PLAYWRIGHT_PATH`
  and `NODE` are set, and the Caddy image
  test (it builds `mantel-caddy:ci`) when Docker is running.
- Each step ends **passed**, **failed**, **skipped** or **unchanged**, and a skip says why (no Docker, no Chrome, no
  private words, no `~/.venvs/hk-ha-test`, no `PLAYWRIGHT_PATH` or `NODE`). A skip is never counted as a pass.
- **Unchanged since it passed** (2026-11-02). Each browser check and HK Frontend's two suites name what they read
  (`ci.py` `PAGE_INPUTS`, `HK_INPUTS`): a browser check the page and the server it runs against (`web/`, `hk_core/`,
  `hosts/server/mantel_server/`, the guide the server serves, `tests/fixtures/`) and its script's own files (the
  check, its `.cjs` half, and every module of `tools/headless`, `tools` and `tests` it imports, followed through
  their imports); HK Frontend's suites what its build takes (`hosts/ha/`, `web/`, `hk_core/`, the build tools). A
  step's **key** is those files' contents in HEAD's tree (a version file without its version lines, so a release's
  bump changes no key), its command, and what it runs with: the venv's packages, Playwright and its browsers, Node,
  Chrome, macOS. A key that passed in a run that held still is kept in `.git/mantel-ci/steps.json` (every worktree
  shares it); a step whose key is there is not run again, ends **unchanged**, which counts as its pass, and its note
  names the commit it passed on. A failure with a key forgets it. A step runs whenever one of its inputs changed, is
  uncommitted (changed, new, or a git-ignored file in an input folder), or `--all` or `--only` is given. The main
  suite, the release checks, the HA build and the Caddy image always run. So a few commits to Python, shell or docs
  outside those folders check in the main suite's time; a change to `web/` or the server runs the browser checks
  it touches, which is all of them for `web/` and the server.
- **Worktrees check their own code.** `~/.venvs/mantel` installs the main checkout editable, so a check run in a
  worktree once imported the main checkout's `hk_core`. Each step run with Mantel's venv gets the checkout's root
  and `hosts/server` first on `PYTHONPATH`; HK Frontend's harness keeps its own path (the build's vendored
  `hk_core`).
- **versions** is what reads the version files and the changelogs: `check_links`, `check_version`,
  `package_check --release`, the private words, and the main suite's files that name a version file or a changelog
  (`version-tests`). It is what a release runs instead of a second full run (Releasing.md, "Make a release").
- The result is written to `.ci/last-run.json` with the commit and tree it ran on, any uncommitted files, and
  `only` for a partial run; a failed step's output goes to `.ci/<step>.log`. The exit status is 0 only when no step
  failed.
- **Passed runs, by tree.** A whole run (no `--only`) on a clean tree (nothing uncommitted but the Xcode project's
  signing team) that held still (HEAD and the files the same at its end) is also kept in
  `.git/mantel-ci/passed.json`, which every worktree shares: a pass beside the tree's other passes, a failure in
  their place until the tree passes again. The pre-push hook and `tools/release_house.py` read it. A step rerun
  with `--only` is never a whole run: after a failure, run the whole tier again.
- It uses `$MANTEL_PY`, else `~/.venvs/mantel`, else `.venv`. The private words come from `HK_PRIVATE`,
  `HK_PRIVATE_FILE`, or `~/.config/mantel/private-words`.

`tools/ci.py --install-hooks` installs two git hooks: **pre-commit** checks the staged files for private words,
and **pre-push** runs `quick --skip-passed`: `quick`, unless HEAD's tree, with nothing uncommitted, already passed a
whole `quick` or `full` run, and then only the private words in the commit messages `origin/main` hasn't got (a
message is not in the tree). Pushing checked work again, or after an amended message, takes seconds. Skip the push
check deliberately with `git push --no-verify`.

The installer tests (`tests/test_lxc_installer.py`) need bash 4 or later; macOS has 3.2, so install a newer one
(`brew install bash`) or they are skipped.

## The route table and the types

```sh
~/.venvs/mantel/bin/python tools/route_table.py           # the rules each route breaks, under every option combination
~/.venvs/mantel/bin/python tools/route_table.py --write   # regenerate docs/development/Routes.md and the lock
~/.venvs/mantel/bin/python tools/route_probe.py --diff origin/main   # every route x 9 principals x 2 doors: what changed
~/.venvs/mantel/bin/python tools/typecheck/check.py        # tsc on the files that start with // @ts-check (ci.py types-js)
~/.venvs/mantel/bin/python tools/typecheck/check.py --measure   # every file checked: the errors per file
```

Mantel refuses to start when a route is undeclared or breaks a rule ([Rules](Rules.md) rule 7), so a new route is
declared and the lock regenerated in the same commit. In a worktree set `PYTHONPATH` to the worktree for both tools.
TypeScript is pinned in its own `tools/typecheck/` (installed on first use, `npm ci`); a new web file starts with
`// @ts-check` (`tests/test_types.py`).

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
(`hosts/ha/custom_components/mantel/tests/py`, through `tests/test_mantel_link.py`, which builds the published layout
with the few `hk_core` modules Mantel Link vendors, and runs it there) and the linked-mode end-to-end
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

### Edit mode in Chromium and WebKit

`tools/headless/edit_mode_check.py` (with its `.cjs`) checks Edit mode on the gallery's fictional house against a
real Mantel Server, with Playwright: Chromium with a finger (CDP touch events: a hold of about 300 ms picks a pill
up, a quick swipe scrolls the page and picks nothing up) and WebKit with a mouse, each at a tablet's size
(Chromium the Android wall tablets' 1280 × 800, WebKit an 11" iPad's 1180 × 820) and a phone's (390 × 844).

```bash
export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
~/.venvs/mantel/bin/python tools/headless/edit_mode_check.py                     # both engines, both sizes (~2 min)
~/.venvs/mantel/bin/python tools/headless/edit_mode_check.py --engine webkit --size 390x844 --only bar --shots /tmp/edit-shots
```

- **who**: Edit Page is in the menu and in the tab bar's More for an Owner; never for a Member, for the Owner at a
  wall tablet (a device session), or on a Home Grid screen's Home.
- **room**: a pill carried and one made Tall on a room page; after Done the Tile Order and the size are saved and
  the page is drawn again from them.
- **pages**: one move each on Lights, Security, Home's Favorites and its scenes row, saved.
- **menu**: a category moved and one hidden in the side menu, the Room Order sheet's Move Up, a tab dropped on
  More; after Done and a reload the menu, the tab bar and More agree.
- **cancel**: Cancel puts the page back and saves nothing.
- **conflict**: a change made in another window between Edit and Done shows Reload / Save Anyway (each tried).
- **bar**: the Edit bar beside a tab bar at the top (below it, evenly spaced), at the bottom and on a rail; the
  page moves down so its title is never under the bar. `--shots` keeps the screenshots.

Any page error or console error fails it, except the 404s of what each home supplies itself (SF Pro, the glyphs).
Without `PLAYWRIGHT_PATH` or `NODE` it prints why and exits 0; `tools/ci.py full` runs it as `edit-mode-check-<engine>-<size>`, four steps side by side. `who`, `cancel` and `conflict` are the same in every engine and size, so only the WebKit tablet step runs them; the other three run the gesture and layout sections (`ci.py` EDIT_GESTURES).

### The side strip in WebKit

`tools/headless/side_strip_check.py` (with its `.cjs`) looks at Home with the sky in WebKit at the iPhone Duo's sizes
(folded 466 × 678 and open sideways 1000 × 703, its strip 84 at the right), with Use the Side Strip off, and on a
phone held sideways (874 × 402, 62 at both sides). A headless browser has no safe area, so it stands the insets in
through `--hk-safe-left`, `--hk-safe-right` and `--hk-safe-bottom`, which the page reads before `env()`. It checks
that the sky fills the screen, the page's content stays clear of the insets, and the tab bar is a rail in the strip's
foot below its reserve (or, without a strip, the bar inside the insets); `--shots DIR` keeps the screenshots.
`tools/ci.py full` runs it as `side-strip-check`, skipped without `PLAYWRIGHT_PATH` or `NODE`.

### Swipe Between Pages in Chromium and WebKit

`tools/headless/page_swipe_check.py` (with its `.cjs`) swipes on the fictional house's screens in Chromium (a finger:
CDP touch events, so the browser's own touch-action and scrolling) and WebKit (pointer events with pointerType touch at
the element under the point; a mouse for the side menu's edge), at a tablet either way (Chromium the wall tablets'
1280 × 800 and 800 × 1280, WebKit an iPad's 1180 × 820 and 820 × 1180) and a phone either way (390 × 844, 844 × 390): a
swipe on a tile turns the page and back, the tab bar's highlight on the page's tab after each (and following down a
rail); one on the scenes row, a slider or a block that swipes its pages does not; a Home Grid turns its views first
and lands on its last view coming back; from the left 24 px the side menu opens; Off turns nothing; an up-and-down
swipe still scrolls. `--engine`, `--size` and `--shots DIR` narrow it and keep the screenshots. `tools/ci.py full`
runs it as `page-swipe-check-<engine>-<size>`, three steps since 2026-11-08 (`ci.py` `PAGE_SWIPE`: the wall tablet in
Chromium, the iPad and a phone in WebKit; the check's other `ENGINE_SIZES` run when it is run by hand), skipped without
`PLAYWRIGHT_PATH` or `NODE`.

### The house's screens, drawn by this checkout (the twin)

`tools/headless/house_twin.py` draws the owner's own screens with this checkout's code, at a wall tablet's size, without
the live site, a browser or a sign-in (2026-11-08: the cards review had judged blocks on the gallery's invented screens,
whose cells are bigger than any tablet's beside a Side Pane). `pull` reads the house's settings documents read-only from
Mantel's database on the LXC over SSH (house.json's `lxc_ssh` / `lxc_key`) and Home Assistant's states and registries with
the admin token, into `~/.cache/mantel-twin/` -- the house's own data, never the repository (camera tokens dropped).
`render SCREEN...` serves a test Mantel Server over them (commands reach nothing) and screenshots each screen's Home at
`--size` (1280x800) in `--engine` webkit or chromium; Energy, Live TV, the to-do lists and Clean Areas are the grid audit's
stand-ins. `--set SCREEN:ITEM.KEY=VALUE` changes one block's option for a render, `--js` runs page code first (open a
sheet), `screens` lists them. Judge every block of every HomeView screen here before calling a layout change done.

### How a swipe moves, frame by frame

`tools/headless/swipe_motion_check.py` (with its `.cjs`) watches a full-page swipe on its way rather than where it ends, at
a tablet and a phone in each engine: at every animation frame the page against the finger, what the page coming in shows
(its elements in sight and the edges in a screenshot of it: a title on the sky fails), how it goes on after the lift,
and the state left behind. It covers a page never visited, one flagged by the slow-tablet ladder, slow drags, flicks,
reversals, a flick back from past a fifth, a cancel, the first page's edge, a new finger at four moments of a settle, a
tap on a settling page, rapid flicks through every page and back, repeated swipes, a resize, a turn, a hidden window and
the back button under a swipe, a tab to the page waiting beside this one, a new config, Reduce Motion's cross-fade, a Home
Grid's hand-off, and a pager's glide. Times are not asserted; positions, order and state are. Chromium's finger is CDP's,
WebKit's is synthetic pointer events, which say nothing of a real iPad: [Motion](Motion.md#what-a-browser-here-cannot-say).
Without `PLAYWRIGHT_PATH` or `NODE` it says so and exits 2. It is **by hand** since 2026-11-08 (the owner's call):
`tools/ci.py full --only swipe-motion` runs its four steps (`swipe-motion-check-<engine>-<size>`), and a whole full run
never does. In the full runs of 2026-11-05 to 11-07 it failed 20 times on a busy Mac's timing, more than any other step,
and passed while swiping still felt wrong on the wall tablets. `pre-glass-motion-check` is by hand the same way.

### The screensaver's faces in WebKit

`tools/headless/saver_faces_check.py` (with its `.cjs`) draws the screensaver's HomeView-style faces
([HOMEVIEW-LOOK.md](../phase11/HOMEVIEW-LOOK.md), Phase I) in WebKit at 1180 × 820, 820 × 1180 and 390 × 844: Glance,
Month, Day (light and dark), Big Weather, Liquid, Giant and Scattered Numerals (also in each size of the Clock block),
and a generated photo with Titles and Time Behind through hk-saver.js's own layers and CSS (its cut-out judged by
`cutout.py`; no model, no real photo). `--shots DIR` keeps the screenshots; `--mock PATH` adds the mock-up's faces
section beside them. `tools/ci.py full` runs it as `saver-faces-check`, skipped without `PLAYWRIGHT_PATH` or `NODE`.

## Big files and long lines

The size and width rules (Rules, rule 8) are checked by the main suite. When a file comes near the limit
(`tools/ci.py quick` names it under "Near the size limit"), cut it, by feature, with the tools:

```bash
~/.venvs/mantel/bin/python tools/split_js.py --report web/hk/cards/hk-x.js --run-in whenBase
```

`--report` groups the file's top-level members by the variables they set again and again: a group moves whole. If one
big group holds the file together, `tools/split_js.py --state FILE --vars a,b,c --write` first puts those variables on
one object (proved by running it backwards). Then write `tools/split_manifests/x.json` (the shell, a folder beside it
that is not under `cards/`, and the parts, each a feature: its members by name) and run:

```bash
~/.venvs/mantel/bin/python tools/split_js.py x --check
```

```bash
~/.venvs/mantel/bin/python tools/split_js.py x
```

The tool refuses what a move would change (it names the member and why) and proves the rest: every moved member's text,
`tsc`, and that nothing that runs before the parts arrive reaches what moved. After it: `split_js.py --all --check`,
`tests/test_file_sizes.py --update`, `tests/test_line_widths.py --update`, `tools/code_map.py`, the jsc suites (their
output must be the same as before), the main suite, and the browser checks of what the file draws. A file that other
code reads the moment it loads waits for its parts through `window.__hkSplitReady`; `tools/headless/split_race_check.py`
holds the parts back and looks. `tools/split_py.py` does the same for Python (`--find NAME` on either says which file
holds a name).

A long line: `~/.venvs/mantel/bin/python tools/rewrap.py PATH` (`--check` to see first). It breaks between tokens and
splits strings, never inside a template or a regular expression, and writes nothing whose syntax tree changed. A line it
can't break goes in `tests/fixtures/line_width_exceptions.json` with its reason.

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

Edit mode in the scratch HA, as an admin and as a plain user, is `tools/testha/edit_check.py` (Playwright, with
`PLAYWRIGHT_PATH` and `NODE` as above; run it between `up` and `down`).

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

`home_screen_e2e.py` is the first-run check for a Home Assistant **without** HK Frontend. A new Mantel (no screens, no
people) gets its Owner through the bootstrap API and connects the scratch HA through Connections; then headless
Chrome opens `/home` and checks that it lands on the generated Home screen (`/dashboard-home/home`), that the demo's
rooms and tiles are drawn, that a room page, Lights, Climate and Security open, and that no page logs a console error
or makes a failed request. It runs twice, against the `us` scratch house and a `metric` one (metric units,
`de`/`DE`, Sydney: `testha.py up --region metric`), about 40 seconds in all and no Docker. It starts HA with
`--no-hk --rooms`. The only requests it lets fail are the licensed font and glyph files Mantel asks for until the
owner supplies them (Mantel Settings, Your files).

```bash
.venv/bin/python tools/e2e/home_screen_e2e.py [--region us|metric]
```

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

Without an option it reads the working tree; `--rev HEAD` reads a commit as git has it (what a push sends) and
`--staged` the index (what a commit takes), so a local edit you never commit is not a finding.
`tools/ci.py --install-hooks` installs it as the pre-commit hook, with `--staged`.

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
`--commands-enabled` turns the command gateway on at the very first start (after that, Mantel Settings → General →
Allow Control of the House holds it, and `--read-only` keeps it off whatever is stored); leave it off unless you are
pointing at a test Home Assistant.
`mantel-server --help` lists everything, and [Operations](../OPERATIONS.md) explains the flags, secrets and data
folder.
