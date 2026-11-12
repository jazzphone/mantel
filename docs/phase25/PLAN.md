# Phase 25: from smaller to simpler (plan, 2026-11-11)

**Status: E, A and C built 2026-11-11 (Build log); B later (decision 2); E4 next.** Was: plan, ready to build. Every decision answered by the owner on 2026-11-11: all six recommendations accepted
("Accept all six"). The building session takes each recommendation as the answer and does not ask again. Nothing in
Parts A, B, C and E is built yet.** Written the day phase 24
finished, from what it left: the files are small, but the tangles inside them are the same tangles in more files.

## The ask (the owner, 2026-11-11)

> "So now that this is all done, do you feel like the code is in the best shape it can be, from an optimization,
> organization, and future proofing perspective?"

The answer was no, with four things to do: the quick fixes, the release, a first-load measurement on a real tablet,
and "later, as real design work with its own plan": the screensaver's and the detail sheets' features with explicit
interfaces instead of shared state, the server's modules grouped by feature, and the split modes that would then
retire. This is that plan. The first three are done (below, "Done the same day").

## Done the same day (2026-11-11)

- **Quick fixes:** `hk_core/laundry.py`'s two mypy errors (`types-py` had been red on main since `9602012e`), the
  accessory pane's Reset (it set two checkboxes the pane no longer has, threw, and left the pane unrepainted), and the
  one real drift between the hosts (`Hiding.snapshot`), now one function in `hk_core/settings/hiding.py`.
- **The release:** Mantel 0.1.163, HK Frontend 1.59.0, Mantel Link 0.1.14, on the house and published. The LXC's disk was
  92% full: 18 old hotfix images and **19.5 GB of Docker build cache** from building hotfixes on the LXC itself.
- **First load on a real tablet** (the loft's Galaxy Tab A9+, Chrome 153; the gallery's house served from the Mac
  through `adb reverse`, cold, five loads a page, two rounds): phase 24 cost **200-300 ms on every page** (Home Grid
  899 -> 1106 ms, Home 830 -> 1050, the screensaver 940 -> 1182, Settings 1280 -> 1595). A desktop browser never saw it:
  its requests are nearly free. **Bundling** (`tools/build_static.py bundle`: each split file shipped with its parts in
  front of it) then measured, as production builds (minified, each tree's own build tool), medians of two rounds:

  | Page | Before phase 24 (`bb278308`) | 0.1.163 as released | Bundled (`228f2ef4`) |
  |---|---|---|---|
  | Home Grid | 878 ms | 1,540 ms | 924 ms |
  | Home | 813 | 1,641 | 849 |
  | Screensaver | 878 | 1,079 | **733** |
  | Settings | 1,485 | 1,682 | 1,491 |

  The release had made the house's Home 550-800 ms slower on a tablet; bundling brings it within 50 ms of before phase
  24 (requests: 147 before, 222 released, 136 bundled). Shipped as Mantel 0.1.164 and HK Frontend 1.59.1 the same day.

## What is there now (measured on `228f2ef4`)

- **Size and width:** 1,473 code files; 1,201 under 500 lines; 78 over 1,000; 26 over 1,500; none over 2,000.
  Closest to the limit: `hk-media-now.js` (2,000, the one file on the width list), `tools/split_js.py` (1,932: the tool
  that cuts files is itself next), `hk-library.js` (1,926), `modules/hk-settings.js` (1,849), `hk-settings-screen-pages.js`
  (1,839).
- **The screensaver's state:** 137 names on its state object `ST`. **112 are written by more than one file, and 32 by
  three or more** (`on`, `deck`, `layer`, `idleT`, `photoRun`, `slideT`, `busy`, `cards`, ...). The shell and
  `hk-saver-start.js` touch 137 and 58 of them; `black` 52, `draw` 40, `layout` 39. The parts call each other both ways,
  which is why `bind_ahead` exists. The split moved the tangle into more files; it did not undo it.
- **The detail sheets:** the shell keeps one shared group (`D`, `TOK`, `held` and everything that reads them, ~550
  lines); 21 parts, each sheet reading that group through the kit.
- **The server:** `hosts/server/mantel_server/` is 116 flat modules beside 10 packages. Clear families: `linked_*` (9),
  `music_*` (9), `app_*` (5), identity (`accounts`, `auth`, `authz`, `rbac`, `rbac_store`, `sessions`, `login_page`,
  `door_key`, `cf_access`, `guards`, `service_accounts`, `pins`), cameras (`protect_api`, `protect_connector`,
  `cameras_direct`, `camera_setup`, `media_proxy`, `faces`, `photos`, `image_work`, `imaging`, `cutout`,
  `notify_snaps`), Home Assistant's bridge (`gateway`, `ha_client`, `ha_dashboards`, `ha_oauth`, `readproxy`, `registry`,
  `registry_feed`, `socket_reads`, `state`, `people_ha`, `supervisor_discovery`). 1,742 import lines in the server, its
  tests and tools name them.
- **The split modes:** every one is used by at least one of the 22 manifests -- `run_in` 12, `early` 4, `shell_edits` 4,
  `class` 2, `live` 2, `wait_all` 2, `run_in_decl` 2, `bind_ahead` 1 (saver), `adopt`/`wait`/`@text` 1 (detail), `iife` 1.
  None can be retired as the code stands; `bind_ahead`, `live`, `adopt` and `wait` exist only because of tangles.
- **Checks that are not run:** the five by-hand motion checks (`swipe-motion-check` at four sizes, `pre-glass`). The
  phone-size swipe failure went unseen from 2026-11-08 to 2026-11-11 because nothing ran them.
- **Log noise:** at every release, Mantel's log holds dozens of full tracebacks of `ClientConnectionResetError: Cannot
  write to closing transport` and "Task exception was never retrieved" (`WebSocketWriter._send_compressed_frame...`):
  a tablet or Home Assistant going away mid-send, logged as an error. 160 such lines after 0.1.163's release.

## The design

### Part A: the screensaver's state, owned

**Goal:** each piece of the saver's state has one owner, and the other parts ask it through a few functions.

1. **A map, by tool** (`tools/state_owners.py`): for each `ST` name, which files read it and which write it, and each
   name's write sites. Kept as `docs/phase25/SAVER-STATE.md`, regenerated by the tool and checked fresh by a test (as the
   code map is).
2. **Owners by feature**, from that map, decided once and written into the map: the run (`on`, `busy`, `entrance`,
   `idleT`, `lastInput`, `pressStop`, `nightT`: `hk-saver-start.js`), the deck and photos (`deck`, `lastPh`, `lastPhoto`,
   `photoRun`, `displayLayer`, `shown`, `queued`: `hk-saver-photos.js`), the slides and corner (`lastSlide`,
   `slideHeld`, `slideT`, `sinceFc`, `fcShowing`, `exKind`, `exT`, `exOutT`: `hk-saver-layout.js` and `-screens.js`),
   the covers and curtain (`coverT`, `curtainRun`, `downOpts`: `hk-saver-black.js`), music (`muShowing`: `-music.js`).
3. **One owner at a time**, each its own commit: the owner's names move off `ST` into the owner's part (its own
   variables again), and each write from another file becomes a call of a small function the owner exports
   (`stopRun(why)`, `nextPhoto()`, `holdSlide(ms)`, ...). Reads that other files need become getters. **No new behavior:
   each write becomes the same assignment, behind a function name.**
4. **The proof is behavioral, not textual** (this is a code change, not a move): the saver's browser checks
   (`saver-shows-check-*`, `saver-designs-check-*`, `saver_faces_check`, `saverlayout`, `screensaver` gallery shots, the
   motion of `pre-glass-motion-check`), the jsc suites identical, and the tool's map showing that owner's names written
   only by their owner.
5. **Done when** no `ST` name is written by two files, `bind_ahead` has nothing to bind (the manifest drops it) and
   `ST` holds only what is truly shared (expected: a handful, each named in the map with why).

### Part B: the detail sheets' context

The sheets read the shell's shared group through the kit. **A sheet context object** (`D` already is most of it) passed
to each sheet's function makes that explicit: what a sheet may read and call is the context's API. Then `adopt` has
done its work (the sheets are ordinary parts) and stays only as the tool's history; `wait: false` stays (the sheets are
still not needed for the first draw).

### Part C: the server in packages

**Goal:** a feature's server code in one folder, the way `alerts/`, `intercom/` and `timeline/` already are.

1. **Packages by family** (above): `identity/`, `ha/`, `linked/`, `music/`, `cameras/`, `apps/`, `network/` (`direct`,
   `direct_tls`, `ingress`, `proxy_check`, `proxy_trust`, `frame_origins`, `security_headers`, `connect_*`), `storage/`
   (`db`, `backup`, `store`, `user_data`, `user_files`, `atrest`, `audit`), `pages/` (`about`, `admin_page`,
   `docs_pages`, `feature_pages`, `page_headers`, `page_health`, `setup_*`, `default_screens`, `screens`), and the house's
   features (`laundry`, `tv`, `live_tv`, `timers`, `vacuum_water`, `talk_*`, `announce`, `hidden`, `accessories`)
   beside the packages that exist. The final list is decision 3.
2. **A tool does the move** (`tools/move_py.py`, from `split_py.py`'s machinery): `git mv`, every import rewritten by the
   AST (absolute and relative), and the proof that every module's names are the same objects at their new home. For
   one release the old module paths stay importable as aliases (`sys.modules`), so other sessions' work in progress and
   any import the AST could not see keep working; the next release drops them.
3. **Run at a quiet moment**, one package per commit, with no other session building: a move conflicts with any open
   change to the moved files.

### Part D: ship lean (landed 2026-11-11)

Bundling is in `tools/build_static.py` (Mantel's image and HK Frontend's `frontend_min/`). What is left: **measure a
real page on the house** once the next release carries it (Mantel's own `page_health` reports, per tablet), and decide
whether `hk-detail.js`'s sheets should load after the first draw rather than beside it (they are fetched by their own
loader as the page starts).

### Part E: keep it healthy

- **The motion checks run by themselves:** `tools/ci.py full` runs them on a release commit (the release tool already
  requires a whole full run), or nightly on main by a scheduled task. Decision 5.
- **Log hygiene:** a send to a client that has gone away is expected; log it once, at debug level, without a
  traceback, and retrieve the writer task's exception. One fix in the hub's socket send.
- **The near-limit list:** `tools/split_js.py` (1,932) is split by feature (the analysis, the plan, the writers, the
  proofs, state, adopt); `hk-library.js`, `hk-settings-screen-pages.js` and `modules/hk-settings.js` get manifests
  ready, used the day one crosses 2,000.
- **Hotfixes built on the LXC** prune Docker's build cache afterwards (`docker builder prune -f` in the hotfix script).

## Order and cost

| Slice | What | Size | Needs |
|---|---|---|---|
| E1 | Log hygiene (socket sends) | S | -- |
| E2 | Motion checks in `ci.py full` (release) or nightly | S | decision 5 |
| E3 | Hotfix script prunes the build cache | S | -- |
| A1 | `state_owners.py` and `SAVER-STATE.md` | M | -- |
| A2-A6 | The saver's owners, one a commit | L | A1, decision 1 |
| B1 | The detail sheets' context | M | decision 2 |
| C1 | `move_py.py` with its proof and aliases | M | -- |
| C2 | The server packages, one a commit | L | C1, decision 3, a quiet moment |
| E4 | `split_js.py` split by feature | M | after A and B (they change it) |

## Decisions for the owner (answered 2026-11-11: all recommendations accepted)

| # | Decision | Recommendation (accepted) |
|---|---|---|
| 1 | Untangle the saver's state (Part A) with behavior checks as the proof, not text proofs? | **Yes.** It is the one place the tangle hurts every change to the saver, and its browser checks are among the best the project has |
| 2 | The detail sheets' context (Part B) now, or leave the sheets as they are? | **Later**: the sheets are independent enough already; do it when a sheet change needs it |
| 3 | The server's packages as listed in Part C? | **Yes, as listed**, `identity/` and `ha/` first (the most imported), one package a commit |
| 4 | Keep the old module paths as aliases for one release? | **Yes**: other sessions' work keeps importing them |
| 5 | Motion checks: in every release's full run, or nightly on main? | **Every release's full run** (about 15 minutes more on a release) and once on main after a change to the pager or the swipe |
| 6 | Order: E, then A, then C, then B? | **Yes**: the small health fixes first, then the saver (the biggest win), then the server |

## Sources

- The tablet measurements: `tablet_load.py` / `.cjs` (first_load.py's way, driven over adb's devtools socket), results
  in the Build log below.
- `tools/split_js.py --report`, the state map above (`ST` names by file), `git ls-files`, the LXC's `docker system df`.

## Build log

- **E1, log hygiene** (`b42a3170`). Every reset in the house's log came from one place, the hub's
  `ClientSession.send` (a `pong` or a snapshot to a page that had gone). It now sends through its own shielded task
  whose end is always read: a reset marks the page gone, logs one debug line with no traceback, and drops its later
  sends; aiohttp's compressed-frame task, left behind when `run()` cancels the pump mid-send, is awaited by ours, so
  nothing is "never retrieved". `tests/test_hub_send_gone.py` fails on the old send.
- **E2, the motion checks** (`4c35b7ed`, decision 5). `swipe-motion-check-*` (4) and `pre-glass-motion-check` are full
  steps again that read only the pager, the swipe and the glass (`ci.py MOTION_INPUTS`): a full run on main runs them
  after a change there. They run after every other step, one at a time, and a failure gets one more try (the result
  says so). `tools/ci.py full --release` runs them whatever passed before, and `release_house.py` takes only a full run
  in which they ran.
- **E3, the hotfix script** (`70c36c12`). The on-LXC script lived only in `/root` with its version written in;
  `packaging/lxc/mantel-hotfix.sh` reads the commit's version and every way out runs `docker builder prune -f`.
  `Releasing.md` says how to run it. (The LXC had 486 MB of build cache on 2026-11-11, after the release's cleanup.)
- **A1, the map.** `tools/state_owners.py` (its parser half `state_owners.cjs`) finds every `ST.x` with TypeScript's
  parser and writes `SAVER-STATE.md`; `tests/test_state_owners.py` holds it fresh, every name owned, and each moved
  owner's names written by it alone. On `094f673b`: **136 names, 113 written by more than one file** (32 by three or
  more). Counting the shell's starting values as writes, 44 names are used by one part only, 42 have one writer that
  others read, and 50 are written by two files or more besides the shell's starting value.
  **The owners, decided from the map** (in `state_owners.py`, `FEATURES`): the plan's guesses held where the writes
  are, and moved where they are not: the photos own the count since the last slide (`sinceFc`, `lastSlide`: every
  slide and every photo writes it, and the photos part runs before all of them), the shell owns touch and idle
  (`pressStop`, `press`, `lastInput`, `idleT`: its `onInput` and `armIdle` write them), `nightT` is the clock's
  (`hk-saver-draw`), `photoRun` and `queued` the run's (`hk-saver-start`, where `advance` lives). **Reads stay on
  `ST` where several files read a name with one writer** (`cfg`, `host`, `root`, `on`, `mode`, `ly`, `pnl`, ...): a
  getter would have been one more name each reading part binds from a later part, the opposite of what Part A is for.
- **A2-A11, the owners** (`8c62c697` .. `c8aa9d7c`). Done: **no `ST` name is written by two files** (`state_owners.py
  --check` holds every owner its names' only writer); `ST` went from 136 names to 91.
  - A2: the 44 names only one file used left `ST`, as that file's own variables (`state_owners.py --own`: the starting
    value moves from the shell's top, which runs before the parts and holds only declarations, to the owner's opening;
    every `ST.x` there becomes `x`, typed `any` as `ST`'s properties were). A3: 24 names with one writing part stay on
    `ST` for their readers, their starting values moved to that part (`--init`).
  - A4-A11, one owner a commit, each other file's write the same assignment behind a name the owner exports (32
    functions in all): photos (`countPhoto`, `slideShown`, `keepPh`, `deckFor`, ...), draw (`forecastSky`, `nightWatch`,
    ...), pane (`curtainOpts`, `paneRelease`, ...), black (`forgetRaw`, `beatFrom`, ...), layout (`landIm` its own),
    screens (`extraIs`, `exCancel`, ...), start (`runEnds`, `slideCancel`, ...), the shell through the kit (`dropCard`,
    `idleCancel`, `noteInput`, ...).
  - The proof: tsc, `split_js.py saver --check` and the jsc suites at each commit (one harness, `test_saverlayers`,
    declares the two variables A2 moved); full runs on A4 and A11: every saver browser check passed, the motion
    checks unchanged. `music-pane-check` and `saver-designs-check-webkit` failed in three full runs in a row under
    load (a cancelled `mdi/icons` fetch reported by WebKit, a drag that found the slide laid out again) and passed
    every time alone, four times each, on A11 and on the C tree (and in the full run on `26090f0e`, before A2).
  - **Not done: `bind_ahead` stays in the manifest.** What it binds (115 names) is functions the parts call both ways
    (the run's `start`, `stop`, `schedule`, `reveal`; the slide objects `HL`, `TM`, `WX`; `setAttr`, `clock`), not state:
    the plan read the two-way calls as a consequence of the shared state, and they are not. Retiring it means moving
    features between parts (the run and the slides each into one part), design work of its own. `ST` keeps 91 names,
    not a handful: a name several files read with one writer stays there (a getter would be one more name bound ahead).
- **C1, `tools/move_py.py`** (`2c5d1599`, by an agent; reviewed and merged). One operation per package: `git mv`,
  every import rewritten by the syntax tree, the proof (each file's tree the same but its imports, each module the
  same object at its new path and through its old one), and `mantel_server/_moved.py`: the old paths import, lazily,
  until 0.1.166 (decision 4; `move_py.py --expired 0.1.166` lists the rows to delete).
- **C2-C8, the packages** (decision 3), one a commit at a quiet moment (no other session running): `identity/` (12
  modules), `ha/` (11), `cameras/` (11), `apps/` (5), `network/` (8), `storage/` (7), `pages/` (10). 64 modules moved; the
  server has 53 flat modules (116 before). Before them, six modules that found files beside themselves (migrations,
  models) find them through the package (`82ec3492`, `f61647f6`). By hand each time: the route lock, the code map, the
  type check's lists keyed by path, the Connect receiver's stage (it copies modules by name), backup's sealing list,
  tests and comments that name files. Main suite green after each.
  - **Not moved:** `linked/` and `music/` as listed collide with `linked.py` and `music.py` (a package cannot have a
    module's name); `connect_proof` stays flat (the Dockerfile runs it with `-m`, the receiver copies it by name); the
    house's features (`laundry`, `tv`, `timers`, ...) stay flat, decision 3's list naming no package for them. The
    next step for `linked` and `music`: make each module its package's `__init__` (the tool would need to learn it).
- **E4, `split_js.py` by feature.** The 1,932-line tool is now `tools/split_js.py` (171 lines: its docstring, the imports back
  and `main`) and seven siblings, cut by `tools/split_py.py` from `tools/split_py_manifests/split_js.json`:
  `split_js_names.py` (138: paths, loader and part templates, shared names), `_analysis.py` (155: the TypeScript helper's
  analysis, text helpers, `Member`, `Plan`), `_plan.py` (512: `make_plan` and what it reads), `_writers.py` (253: the
  parts' and the shell's text), `_adopt.py` (155), `_proofs.py` (456: `build`, `verify`, the split, `--check` on a split
  tree) and `_state.py` (188: `--report`, the state rewrite, `--write-loaders`, `--find`). `python tools/split_js.py ...`
  and every test that loads it by file path work unchanged. **`split_py.py` gained a "flat" siblings shape** (a module of
  `tools/`, which is no package): the parts are imported by plain name and the module that stays puts its own folder on
  `sys.path` first, so a script run and an `importlib` load by path both work; `tests/test_split_py.py` runs both.
  **Proof:** `split_py.py split_js.json --check` (every moved statement's syntax tree the same, the same 83 names, each
  the same object through its part); `split_js.py --all --check` prints the same text before and after.
- **Round two (the owner, after the first push: "let's do your recommendations, but all of one, and the screensaver
  work now as well"; all but the `ST` names and `connect_proof`).**
  - **C9-C15, the rest of the packages.** `move_py.py` learned `"init"`: the module of the package's own name becomes
    its `__init__.py`, keeping its dotted name (no alias), its relative imports redone against the package itself.
    Then `linked/` (`linked.py` its `__init__`, 7 modules), `music/` (`music.py` its `__init__`, its phase 24 sibling
    parts beside it; `split_py.py --find` follows), `features/` (laundry, tv, timers, vacuum_water joined the package
    that already runs hk_core's features inside Mantel), `cameras/` gained `live_tv` (not `features/`: it registers
    read routes of its own, and `test_feature_parity` holds `features/` to hk_core's rules), `accessories/`
    (`accessories.py` its `__init__`, `hidden`), `intercom/` gained `talk_direct` and `talk_relay`, `network/` gained
    `announce` (its `python -m` commands say `mantel_server.network.announce`: the alias cannot serve `-m`). **27
    modules are left flat** (116 at the start): the core (`server`, `config`, `live`, `view`, `route_table`, ...) and the
    `-m` entry points `health` and `connect_proof`. `house.py` is the house port, not a feature: it stays.
  - **B, the detail sheets' context.** The sheets reached the shell's state in one place: `hk-sheet-group.js` read
    the open sheet's panel, title and body off `D` (`sheetState()` handed `D` over). The kit is now the sheets'
    context, said so where it is made: `open`, `openPopup`, `navigateFrom`, `toHost`, `noteEl`, `HkBase`, and of the
    sheet that is up `sheetPanel`, `sheetBody`, `sheetTitle`. The manifest drops `"adopt"` (`--check` reads the
    adopted file's blob, still in the repository, with the same result); `adopt_from` stays as history.
  - **A12-A13, `bind_ahead` gone.** The eight feature parts are ONE cycle (Tarjan on the parts' takes: every one
    reaches every other), so no order and no file layout under the size limits can do without a late call. What
    changed is how: `setAttr`, `clock` and `clock24` moved to the helpers part; the music part moved up to run after
    the photos (draw, layout and the extras take its 30 names as ordinary takes); and the 115 generated binders
    became seven **exports objects** the shell's kit makes empty (`Run`, `Black`, `Pane`, `Screens`, `Layout`, `Draw`,
    `Music`), each filled by its part as it runs; an earlier part calls `Run.schedule()` when it is called. The rewrite
    was TypeScript's (each reference resolved to the part's own ahead declaration; no exported function uses
    `this`); 139 references go through the objects. `split_js.py --check` takes `Name: {}` as a kit entry; the
    manifest drops `"bind_ahead"`. Nothing checks statically that a part never calls an exports object as it runs
    (bind_ahead's check did): the parts' run-time statements were proven free of them before the rewrite, and a
    call there would throw on every load, which the jsc suites and every saver browser check would see.
  - **The proof of round two:** a full run on `97aced10` (A13): 84 of 86, every screensaver browser check and the
    motion checks among them; the two failures the state map (stale after the rewrap; written again in `f89b3c65`)
    and `music-pane-check`'s fade (one of the flakes below). A13's commit message says 59 references; the rewrite
    made 139.
- **Round three (the owner: "I'm good with 1-9").**
  - **The exports objects' rule, checked:** `split_js.py --check` runs `tools/split_js_exports.cjs` for a shell whose
    kit makes exports objects: no part reads one as the parts run, directly or through the functions of the same part
    it calls (`905dcc11`, its test plants both).
  - **`move_py.py`:** data keyed by path follows an `"init"` move (`47677d7d`).
  - **The five load flakes, fixed at their cause** (`8dab4bf2`): Chrome takes its own DevTools port (the viewports'
    "Chrome did not start"); the music pane's fade is waited for; WebKit's report of a dropped icon-file fetch is
    forgiven for this server's own icon files; the audit's PIN is matched as a whole number; the timeline's
    wall-clock budgets run in a new full step, `perf-budgets`, alone at the end.
  - **Old paths in comments and current docs** follow the moves (`55fab4b0`; 34 mentions; migrations' SQL left as is).
  - **The aliases' deadline, held by a test:** `tests/test_moved_aliases.py` fails once the version reaches a row's
    release (all 87 rows: 0.1.166) while the row is there; that release deletes them.
- **Round four (the owner: "Yes I am good with a new release to the house"; then "lets do connect_proof, we should also
  do hk-settings and hk-library while we are here").**
  - **Mantel 0.1.165 and HK Frontend 1.59.2 on the house** (E, A, C and B released; House-releases.md has the OK quoted).
    0.1.165's first attempt stopped before its tag: two new tests read the pinned TypeScript GitHub's Linux runner
    doesn't install, and move_py's proof left `__pycache__` (`b33bd853`); `--retry` finished it.
  - **`split_js.py --regroup`:** a class-method part cut into more, each method moved whole and proven (every method once,
    its text the same, then the whole --check). `hk-settings-screen-pages.js` 1,839 -> 249 lines and six parts.
  - **`modules/hk-settings.js` split** (1,851 -> 915 and five parts, after its `lookNow` was set by a statement of its
    own) **and `hk-library.js`** (1,926 -> 759 and five). Two things the browser checks found: a split shell's
    readiness was found by its file's name, and two shells share one (`hk-settings.js`): every label is now its folder
    and name (`modules/hk-settings`), and every importer looks it up that way; and the library card registered at once
    while its methods came with its parts (`this._bindBack is not a function` on every page with the card): a card in
    class mode may now let its `register(...)` wait (`"register_waits"` with `"wait_all"`), so it is defined only once
    every method is there.
  - **`connect_proof` in `network/`** (its receiver's `python -m` and stage follow), and **0.1.166 drops the 87 old
    paths** (`connect_proof`'s row stays until 0.1.167). Removing them found what the import rewrite couldn't see:
    three tests' child-process code in strings, the receiver's setup script.
  - **The release checks trimmed** (`87ed730e`): a release's motion checks are carried when they passed in a release run
    as they are, and run in two lanes (Chromium's, WebKit's) side by side. A release's full run: 25+ minutes that night,
    10 minutes 20 seconds on `3687dbd2` with every motion check run (each as long as alone: no new noise).
  - **More flakes found and fixed:** the fictional house's random passwords could hold a user's name (the policy refused
    it); a third TypeScript-reading test without the guard (0.1.166's first attempt: `3687dbd2`, and the suite run with
    the pinned TypeScript moved away, as the runner has it: 7,181 passed).
  - **The rules, written for whoever adds a feature next:** `docs/development/Rules.md` opens with "Where new code goes"
    (the decision in `hk_core`, the server's side in its feature's package -- a table of them --, the web side's places,
    a file sized to one feature, under about 800 lines) and gains rules 9-12 (server packages, a file in parts, the
    screensaver's state owners, tests that run where the release's checks run).
- **D, the house's own numbers** (page health, the five wall tablets' first draw, each release's reload with the cache
  cleared, all five at once): 0.1.164 (bundled) 3.3-3.7 s; 0.1.165 2.3-4.6 s; HK Frontend 1.59.2 2.6-4.1 s; 0.1.166
  (the settings splits) 2.3-3.8 s; HK Frontend 1.59.3 3.0-4.2 s. No release of phase 25 slowed a tablet's first screen.
  A tablet's ordinary reload on 0.1.164: 2.1-4.4 s. (A reload during Home Assistant's restart: 13-198 s, the server
  waiting for Home Assistant, not the page.) The detail sheets had already stopped loading with the page in 0.1.164, so
  Part D's other question is answered. The lab's 0.85 s (one tablet, the Mac serving, PLAN.md above) is not the house's
  ~3 s: five tablets at once over the house's proxy, the cache cleared.
- **Left for later:** when Home Assistant restarts, two of Mantel's pending calls to it fail with "Home Assistant closed
  the connection" and nobody reads them ("Future exception was never retrieved", twice per restart): E1's kind of noise
  on the Home Assistant side (`mantel_server/ha/ha_client.py`), harmless, its own small fix and release.
