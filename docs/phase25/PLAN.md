# Phase 25: from smaller to simpler (plan, 2026-11-11)

**Status: plan, ready to build. Every decision answered by the owner on 2026-11-11: all six recommendations accepted
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

(nothing built yet)
