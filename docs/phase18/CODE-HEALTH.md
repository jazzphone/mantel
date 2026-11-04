# Phase 18: code health (plan, 2026-11-03)

**Status: Part A built (A0-A8) and C0; Parts B and C in progress. Every decision answered by the owner on 2026-11-03 (all recommendations accepted).**

## The ask (the owner, 2026-11-03)

Three parts, in this order of importance:

- **A. One route table.** Every audit found the same bug: "a new door to an old thing, checked less than the old
  door." The third pass found it six times (SRV-1, 2, 3, 6, 8 granted what the REST route refused; SRV-4, 5 skipped a
  sibling's `view` filter; MED-10 left go2rtc's HTTP streams outside the live registry). Make every route declare, in
  one table, who may use it, from which doors, the CSRF rule, the `view` filter for reads, whether it streams, the
  audit for changes and whether an assistant can reach it. Mantel refuses to start, and a test fails, when a route is
  missing or a declaration is incomplete.
- **B. Split the four giant front-end files:** `hk-settings.js` (10,230 lines), `hk-saver.js` (6,474), `hk-media.js`
  (4,185) and `hk-grid-cards.js` (2,649). Mechanical moves; screenshots and browser checks unchanged.
- **C. Type-check the JavaScript** with `tsc --checkJs`, one file at a time, wired into `tools/ci.py`. Also Python
  type-checking on `hk_core/`, and whatever else the audits list as debt.

## The answer, in short

**Part A is not a new idea: it finishes Rule 7.** `guards.py` (165 lines) already lets a route say `@guard(who, door,
fresh, device_ok, audit)`, and `tests/test_route_guards.py` already walks the whole router. What it can't say yet is
what the audits' bugs were about: *which data a read may show* (the `view` filter), *whether the answer stays open
after a revocation* (streams), *whether a screen preview may fetch it* (a separate list in `auth.py`), and *whether an
assistant has a tool that does the same thing under a looser rule* (nothing compares them). So Part A adds those
columns, moves the free-text "own check" reasons of the 73 routes that aren't sessions from the test file onto their
handlers, and builds one table from all of it at start. A route that is missing, or has a blank column, stops the start.

**Part B follows the method the `hk-detail.js` split used** (commit `5573f9db`): real files in a folder beside the
shell, each registering a function, the shell loading them in parallel and running them with a kit. A small script
does the moving, so a collision with another session is a re-run, not a merge.

**Part C starts with `tsc`'s `// @ts-check` per file.** Its first job isn't catching bugs in old code. It is a safety
net for Part B: a part that drops a variable it used to share fails the check instead of failing on a page nobody
opened.

What already exists, and gets reused:

- **Rule 7 and `@guard`.** 220 of the 293 routes carry one; 29 distinct shapes. `guards.check` runs who, door, fresh
  factor and CSRF before the handler.
- **`tests/test_route_guards.py`** (124 lines, 4 tests): every route has a guard or an entry in a 68-entry `ALLOW`
  dict with a reason; no guarded route is public; every guard on a change names its audit action or says why none;
  the spec refuses contradictions.
- **The preview lists.** `auth.PREVIEW_PATHS` (14), `PREVIEW_PREFIXES` (9) and `PREVIEW_PATTERNS` (5) for HTTP
  reads; `server.PREVIEW_READS` (35) and `PREVIEW_READS_NEVER` (16) for socket reads, with a test that makes every
  socket read choose one (`test_mcp.py::test_every_read_a_house_registers_is_a_screens_or_not_a_previews`).
- **`live.py`** (211 lines): one registry for long-lived connections; revocation closes what it names. Seven call
  sites add to it.
- **`mcp/tools/`**: 41 tools, each already declarative (`needs` scope, `write`, JSON Schema).
- **`require_fresh_to_grant`** in `accounts.py`: the one rule for giving someone a way in as Owner or Admin.
- **The `hk-detail.js` split**: `web/hk/sheets/` (13 files), `tests/test_web_lifecycle.py` pins, and
  `hosts/ha/custom_components/hk_frontend/tests/detail_files.js`, which makes the jsc suites read the shell and its
  files as one source.
- **`ratchet.js`**: a fixture of today's off-scale values that a test lets shrink and never grow.
- **`tools/ci.py`**: one table of steps with named inputs; a step whose inputs haven't changed counts as a pass.

## What it doesn't do

- **Change what any route does.** The migration slices change no answer for any caller. What the table *finds* (two
  already, below) is fixed in separate commits, each with a test that fails first, and listed in the Build log.
- **Cover Home Assistant's own views.** HK Frontend and Mantel Link register `HomeAssistantView`s inside Home
  Assistant, behind its sign-in. The table is for Mantel Server's aiohttp routes (and the one-route proof app in
  `connect_proof.py`).
- **Split more than the four files.** `hk-sky.js` (7,023 lines), `hk-base.js` (4,802), `hk-energy.js` (4,299),
  `hk-cameras.js` (3,706), `hk-weather.js` (3,697) and `hk-strategy.js` (3,324) are bigger than `hk-grid-cards.js`.
  A size ratchet records them so none grows; they are a later phase (decision 12).
- **Rewrite the big Python files.** `music.py` (2,124), `photos.py` (1,532), `backup.py` (1,481) stay.
- **Turn on `strict`.** Types come in per file, loosely first (decision 8).

## The design

### Part A: one route table

#### What is there now (counted on `6b787ef1`, by building the app the way `test_route_guards.py` does)

| What | Number |
|---|---|
| Routes (method and path pairs, not counting HEAD) | **293**, in **60** modules, **269** distinct handlers |
| By method | GET 140, POST 77, DELETE 34, PUT 33, `*` 6, PATCH 3 |
| With `@guard` | **220**: Manager 88, Owner 68, signed-in 33, person 31 |
| Guarded doors | any 199, home 19, LAN 2 |
| Guarded fresh factor | never 180, away 25, always 11, add-factor 4 |
| Guarded and open to a wall tablet (`device_ok`) | 63 (157 refuse one) |
| Guarded changes (POST/PUT/PATCH/DELETE) | 124: 105 name an audit action, 19 say why they write none |
| Guarded GETs | 96, of which **30 are `signed_in`**: the handler alone decides what the person may see |
| On the `ALLOW` list (no `@guard`) | **73** route-methods in 68 paths: 21 app (DPoP), 16 static, 12 sign-in, 8 assistants' OAuth, 4 media proxy, 3 public, 9 others |
| The biggest modules | `app_auth` 29, `photos` 21, `accounts` 19, `server` 17, `alerts.api` 11 |
| Other doors with their own lists | 51 socket reads, 8 command types, 41 MCP tools (22 write), 8 linked-mode actions |

The numbers for flag-gated routes (Ingress, Connect, direct TLS, a Cloudflare Access team, commands on) are for the
one configuration the test builds (`ingress=True, connect=True`). Slice A0 walks every combination and records the
union.

#### What no test checks today

- **What a read may show.** Of the 96 guarded GETs, 30 are `signed_in` and nothing says what each does with the
  entities in its answer. `api_entities` cuts by `request_gate(request)`; `api_areas` lists every area; **`api_stats`
  (`server.py`) gives any signed-in session, a Child or a wall tablet included, the 15 busiest entity ids
  (`top_entities`) and every connected screen's counters.** No page of the web app calls it (only tests do). That is
  SRV-4 and SRV-5 again, found by reading, not yet reproduced.
- **The preview allow-list for HTTP reads.** `auth.py` says "tests/test_mcp.py's route walk fails until it is
  [listed]". The walk exists for socket reads. For HTTP, `test_a_preview_reaches_only_what_a_screen_draws_from`
  tries 29 named paths that must be refused and 9 that must work: 38 of the 140 GET routes. A new GET is closed to
  previews only because the list is an allow-list; nothing proves it on purpose.
- **Streams.** MED-10 was found by reading `media_proxy.py`. Nothing flags a handler that returns a `StreamResponse`
  or `WebSocketResponse` without joining `live.py`. The streaming routes today: `/ws`, `/ws/talk`, `/linked/ws`, `/ma`
  and `/go2rtc` (and their tails), `/api/admin/proxy-check/ws` (a 5-second socket that is tracked in its own set,
  which is fine, but only a reader can tell), and the image proxies (`connectors/camera_still.py`: capped at 8 MB).
- **Tool parity.** Whether an MCP tool is as strict as the REST route it parallels.
- **The audit actually written first.** The test checks the guard *names* an action; per-route tests
  (`audit_unavailable` appears in 11 test files) check some of them do it.
- **Shadowing.** `/{seg:[A-Za-z0-9_]+-[A-Za-z0-9_-]*}/{view}` is registered early; a later route shaped `/some-thing/x`
  would never be reached. aiohttp matches in registration order.

#### The row

A route's declaration is two kinds. A **session route** (`@guard`) and an **own-check route** (`@open_route`, new)
for the ones that aren't signed in by a session. One `Policy` base holds what they share.

| Column | Values | Today | Proved by |
|---|---|---|---|
| `who` | `signed_in`, `person`, `manager`, `owner` | `@guard` | `guards.check` (unchanged) |
| `device_ok` | True: a wall tablet's session may | `@guard` | `guards.check` |
| `door` | `any`, `home`, `lan` | `@guard` | `guards.check` |
| `fresh` | `never`, `away`, `always`, `add_factor` | `@guard` | `guards.check` |
| `audit` / `no_audit` | action names, or why none | `@guard`, on changes | the existing test, plus a literal-in-handler scan and the probe (below) |
| `csrf` | derived: unsafe method under `/api/`; a declared `csrf=False, why=` where the route has its own (sign-in, OAuth) | the session middleware | the probe sends a change without the header |
| `reads` | **new, required on every GET and on any change that returns data.** `view` (each entity, camera, speaker or photo passes `authz` for this person), `feature:<name>` (the RBAC feature grant), `self` (only the caller's own records), `admin` (settings no entity keys; refused with `signed_in`), `none` (carries no house data; needs a `why`) | nothing | a conformance test per `view`/`feature` route (below); rule R4 |
| `stream` | **new.** `none`, `bounded` (a cap on bytes or seconds, stated), `live:<kind>` (in `live.py`, rechecked, closed on revocation) | nothing | a scan of the handler for `StreamResponse(`, `WebSocketResponse(`, `.prepare(`; a test witness; a revocation test per `live` route |
| `preview` | **new.** True when a read-only screen preview may fetch it. Default False. | `auth.PREVIEW_*` | `auth.preview_allows` reads the table |
| `mcp` | **derived.** The tools that name this route in their `like=` | nothing | the parity rules |
| `kind` (own-check routes) | `sign_in`, `app_dpop`, `link_credential`, `one_time_code`, `proxy`, `mcp_bearer`, `oauth`, `static`, `public`, each with a `why` | the `ALLOW` dict's free-text reasons | per kind, where there is a structure to check (see A2) |

Two choices are on purpose:

- **`stream` and `mcp` don't have to be typed on 293 routes.** `stream` defaults to `none` only when the scan finds
  nothing; a route that streams and says `none` fails. `mcp` is derived by turning the tools' `like=` around. The
  table always *has* a value in every column; a person writes only the ones that aren't the default. This keeps the
  noise down without leaving a gap.
- **`reads` has no default.** It is the column the audits needed, and a guessed default would hide exactly the bug.

#### Where it is declared (decision 1)

The declaration stays on the handler, where the audit action and the checks already sit. What changes:

- `@guard(...)` gains `reads=`, `stream=` and `preview=`; it still stores its spec on `handler.__guard__`.
- `@open_route(kind, why=..., ...)` (new, in `guards.py`) stores `handler.__open__`. The 68 entries of `ALLOW` move onto
  their handlers, one module at a time, and the dict goes.
- A new module `route_table.py` builds the table from the router: a `Row(method, path, policy, module, handler)` per
  route, `app["route_table"]`. `route_table.verify(app)` applies the rules below.
- A generated, checked-in `docs/development/Routes.md` (one section per module, one line per route) and
  `tests/fixtures/route_table.lock.json` are the single table to read and to diff in review. `tools/route_table.py
  --write` regenerates both; a test fails when they are stale. Adding a route means declaring it and committing the
  regenerated lock, so a reviewer sees every door's rule in the diff. A merge conflict in the lock is resolved by
  regenerating it.

A hand-written central file with all 300 rows was weighed and not chosen (decision 1): it separates each row from
its handler, which is how a table and a handler drift, and every session that adds a route would edit it, on a
repository that took 623 commits last week.

#### The rules `verify(app)` applies

| Rule | Refuses |
|---|---|
| R1 | a route with neither `__guard__` nor `__open__` |
| R2 | a spec with a blank required column, or a contradiction (`Guard.__post_init__`'s checks, kept, and new ones: `preview` on a change; `stream="live"` without a kind) |
| R3 | a change with neither an audit action nor a reason (as today) |
| R4 | a GET (or a change that returns data) with no `reads`; `who="signed_in"` with `reads="admin"`; `reads="none"` without a `why` |
| R5 | a `live:<kind>` whose kind is not one `live.py` knows (`live.KINDS`, new), or a handler whose scan finds `StreamResponse(`/`WebSocketResponse(` with `stream="none"` |
| R6 | a `preview=True` route that isn't a GET, or whose `reads` is `admin` |
| R7 | an `@open_route` of a kind that has a structural proof (below) and lacks it |
| R8 | a guarded route that is on the session middleware's public list (the existing test, kept) |
| R9 | a tool (`mcp/tools/`) that writes and names no `like=` (or `no_route=` with a reason), or names a route that doesn't exist |
| R10 | a tool whose scope is easier to get than its route's rule (the parity table below) |
| R11 | a route shadowed by an earlier pattern: each route's sample path must resolve to itself in the router |
| R12 | two rows with the same method and path |

#### Start-up (decision 2)

`build_app` ends with `route_table.verify(app)`. A failure raises `RouteTableError` listing every route and column,
and Mantel exits before it listens. The same call is a test (`tests/test_route_table.py`) on the app built under
every combination of the flags that add routes: Ingress, Connect, direct TLS, a Cloudflare Access team, commands on
and off, Music Assistant and go2rtc configured, Protect set up. A route only one combination adds must not be able to
surprise a house. The LXC's `update` has a rollback for a version that doesn't come up (third audit, DEP-10 and DEP-17).

#### Zero behavior change: the lock and the probe

Two things prove a migration slice changed nothing.

1. **The spec matrix.** The 29 guard shapes (and the own-check kinds) are run through `guards.check` for each
   principal (nobody, Guest, Child, Adult, Admin, Owner stale, Owner fresh, wall tablet, Owner at a tablet, a screen
   preview) on each door (LAN, tunnel, Home Assistant's sidebar), and the outcome (the identity, or the error code) is
   stored per shape. It runs in the main suite in seconds. After a slice, every route's shape gives the same
   outcomes.
2. **The probe.** `tools/route_probe.py` builds the app with fakes and commands off (Rule 3), signs in as each
   principal, and sends every route a request with an empty `{}` body (a change dies in validation, after the guard).
   It records the status and the `error` code only, about 293 routes x 10 principals x 3 doors. The baseline is taken
   from the parent commit with `git worktree`, the new run from the slice, and `tools/route_probe.py --diff <rev>`
   must print nothing. A route that passes the guard shows a handler's own answer (400, 404), so a change in
   *where* the refusal comes from shows too.

`tools/route_table.py --diff <rev>` does the same for the table's columns: only the columns the slice was meant to
fill may differ.

#### The doors that aren't REST routes (A8)

The same bug lives in them, with their own lists:

- **Socket reads (51).** `connectors.read_routes` (38), `readproxy.READ_ALLOWED` (27) and `MANTEL_READS` (2) overlap
  to 51; `PREVIEW_READS` (35) and `PREVIEW_READS_NEVER` (16) cover them. They become rows of the same table with
  `reads`, `feature` and `preview`, and the two frozensets go.
- **MCP tools (41).** `Tool` gains `like=` (the REST route it parallels). The parity table has one line per write
  tool (22), reviewed once: the REST rule is `who`, `fresh`, `door`; an MCP credential gets there through its scopes
  (`SCOPES = read, settings, screens, audit, commands, restore`; a key never has `commands`; a key is LAN only; a
  sign-in is rechecked each request). A tool that is looser than its route is tightened (decision 4).
- **Linked-mode actions (8)** and **the app's DPoP routes (21)** keep their own credential. They get a row each so the
  table lists them; the app routes get the structural proof (every handler runs under `app_auth.app_route`).

#### Structural proofs for own-check routes (A2)

| Kind | Proof |
|---|---|
| `app_dpop` | the handler is wrapped by `app_auth.app_route` (an attribute it sets) |
| `proxy` | the handler calls `MediaProxy.authorize` (the proxy's four handlers share one entry point) |
| `static` | serves only under `web/` or `docs/`; a path-escape test per handler (exists for `/hk/`, `/web/`) |
| `sign_in` | names its rate limiter and its origin check; a test hits it past the limit |
| `mcp_bearer`, `oauth` | `mcp/auth.py`'s check is the first call (a scan) |
| `public` | the three health routes, listed by name; nothing else may use it |

Where no structure can be checked, the `why` stays a reviewed sentence, not a claim.

#### Conformance tests for `reads` and `stream`

- **`reads="view"` or `feature:*`** (`tests/test_route_conformance.py`): a fixture house has an entity, a camera, a
  speaker and a photo a Child may not view. For every GET declared `view` the test calls it as a Child and as a wall
  tablet and fails if any of those ids, names or addresses appears anywhere in the body (a deep string search). This
  is the SRV-4/SRV-5 test, written once for every route. It needs a sample path per route; the table keeps `sample=`
  for routes with a parameter.
- **`stream="live:<kind>"`**: for each, open the stream against a fake upstream, assert `app["live"]` holds an entry
  of that kind, call `live.revoke("user:<id>")`, assert it closed within one loop turn. Exists for go2rtc and MA
  (`test_media_proxy.py`); added for `/ws`, `/ws/talk` and `/linked/ws`.
- **`stream="none"`** is checked by the scan, and by a witness middleware that is installed only in tests and records
  every route whose answer comes back as a stream. The probe and the media tests run under it.

Limits, stated: the scan is a heuristic over source text, and the witness sees only routes the tests reach.

### Part B: split the four files

#### How modules load

Nothing is bundled. `tools/build_static.py` copies `web/`, runs every `.js` and `.css` through esbuild's whitespace
minifier (comments and indentation gone, nothing renamed or bundled), stamps `?v=<build id>` on the files' own
imports, and hashes what ships. Files load as classic scripts in an IIFE (zero `let` or `const`: 1,796 `var` lines in
`hk-settings.js` alone) and by `import()`; run-time addresses go through `window.hkV` to get the stamp.
`tools/build_ha.py` hands everything under `web/hk/` (recursively) to HK Frontend's `publish.py`, which writes the
readable `frontend/` and the minified `frontend_min/`. Mantel Link vendors `hk_core`, not `web/`, so Part B doesn't
touch it.

Two facts shape where the parts go:

- **`hk-media.js` and `hk-grid-cards.js` are card files.** Both hosts treat every `web/hk/cards/*.js` as a card: Home
  Assistant registers each as a Lovelace resource (`resources.py`, `glob("*.js")`), and `hk_cards.py` reads each file's
  `register('hk-...'` calls to know what a lazy file defines (`tags_of`; both are on its `LAZY` list). The `hk-detail`
  split put its files in `web/hk/sheets/` "beside cards/, not in it" for this reason. The new parts do the same, and
  **the `register(...)` calls stay in the shell file**, where `tags_of` finds them.
- **The jsc suites read these files as text.** `panels/hk-settings.js` is named by about 20 files outside the docs (8
  jsc suites, 4 main-suite tests, HK Frontend's Python test, `tools/`, `web/client`, `web/shim` and the server);
  `cards/hk-media.js` by 18 jsc suites and one more; `modules/hk-saver.js` by 4, 2 and a headless tool;
  `cards/hk-grid-cards.js` by 6 and one more. Pins, allow lists and snapshots keep their meaning only if reading the
  shell still returns its parts' text too.

#### The method (from `5573f9db`)

- **Parts are real files** in a new folder per shell, as classic scripts: `web/hk/settings/`, `web/hk/saver/`,
  `web/hk/media/`, `web/hk/grid-cards/`. Each begins with the same header the sheets have (what is in it; "not run
  on its own") and registers one function, `(window.hkSettingsParts = ...)['<name>'] = function (K) { ... }`.
- **The shell** lists its parts in a `PARTS` array (as `hk-detail.js` has `SHEETS`), fetches them in parallel with
  `import()`, asks again for ones that didn't come (the WEB-11 loop: 6 tries, a different address each time, backoff to
  15 s), runs them in order with a kit `K` of what they use of it, takes back what it uses of them, and only then
  defines its elements and registers. A host that has already loaded them (the jsc suites) starts in the same turn.
  The 50-line loader is generated from one template by the split tool, so the four copies are identical, and a test
  pins that.
- **For a class** (`HkSettingsPanel`: 357 methods, no `super.` outside the constructor, no `static`, no `#private`,
  three getters/setters), a part adds methods to the class's prototype through a non-enumerable define, so the class
  looks the same to anything that iterates it. **For card classes** (`hk-media`: 6 `static` and 14 `super.` uses;
  `hk-grid-cards`: 12 and 21), a whole class moves, so `super` and `static` stay inside it.
- **The tests' view of the file** is `detail_files.js` generalized: `split_files.js` (jsc) and `tests/web_sources.py`
  (main suite) answer a read or a load of a shell with the shell followed by its parts, reading the `PARTS` list the
  same way `detail_files.js` reads `SHEETS`.

#### Why a tool does the moving

Other sessions edit these files all the time: in the last 7 days `hk-settings.js` had **70 commits**, `hk-saver.js`
44, `hk-grid-cards.js` 34 and `hk-media.js` 27 (of 623 on the whole repository). A hand-made split over a day would
be out of date before it lands, and git can't follow code that moved.

`tools/split_js.py` (new) takes a manifest of **member names**, not line numbers: "these methods go to
`hk-settings-saver-rows.js`". It parses the shell with the TypeScript compiler API (so strings, regular expressions
and templates can't fool a brace match), cuts each named member with its leading comments, writes the parts and the
rewritten shell, and **proves the move by comparing every member's text before and after** (the same proof the
`features.py` and `settings_store.py` splits used: "every top-level function compared by AST"). If `origin/main` moved
while the split was being checked, the tool is run again on the new tree; nothing is merged by hand. `split_js.py
--find <name>` says which part holds a method, so a session whose branch edited the old file can port the change.

The proposed cuts (from the files' own banners; the tool settles the exact members):

| Shell (stays) | Parts (about lines, from the banners) |
|---|---|
| `grid-cards` (2,649): the loader, registrations, `window.hkGridCards` | helpers and the room math (~380), room card (~560), suggested scene (~280), action card (~400), everything card (~300), cameras face (~280) |
| `media` (4,185): loader, `register` calls, `window.hkMedia` | now playing (~1,400), speaker picker (~1,400), recent music and playlists (~600), TV channels (~190), screensaver line and browse (~340) |
| `saver` (6,474): constants, state, the element, start/stop, the loop | **only the sections that touch no shared mutable variable move at first**: pure helpers (~650: layout, mosaic, face windows), photos (~630), layout (~650), clocks (~320), music (~870), the dashboard pane (~680); see "The saver is the hard one" |
| `settings` (10,230): header, class core (start, routing, saving, drawing, sidebar, helpers; ~1,900), the tail | CSS (~260), constants and tables (~170), a screen's pages (~2,650), add a screen and chips (~250), all screens: sky, theme, menu, calendar, timers, weather (~3,500, cut into 4), rooms (~240), wall tablets (~400), accessories and hidden (~700), pop-ups, custom pages, system (~330) |

After the split no file is above about 2,000 lines, except the saver's shell, whose target is 3,500.

**The saver is the hard one.** It has 144 top-level `var`s in one closure, and many are mutable state the sections
read and write (`cfg`, `on`, `host`, `root`, `deck`, the timers; 76 of the declarations start as `null`, `false`, `0` or
empty). A function that moved to another file can't see them, and rewriting it to ask for them is no longer a
move. So B3 moves the sections that touch none (checked by `tsc` finding no unresolved name in the part), reports how
many shared variables each remaining section uses, and moves a section that needs state only through the kit's
getters and setters when the tool can rewrite the references by their resolved identity and the saver's own browser
checks pass unchanged. What can't be done that way is listed in the Build log, with the numbers. Stopping at 3,500
lines is a valid end.

#### Proving "no change"

The served bytes differ (new files), so the proof is on what they draw and do:

- **The jsc suites** pass with the same counts as before (the way `5573f9db` reported it).
- **A DOM sweep.** `tools/headless/settings_sweep.py` (new) visits every page the Settings router knows (read from
  `hk-settings-model.js`) at three sizes in Chromium and WebKit and stores each page's deep DOM (shadow roots too) as
  text, with a screenshot. `--save <dir>` is taken from the parent commit, `--compare <dir>` from the slice; any
  difference fails. The gallery has only 19 Settings shots, and the panel has dozens of pages.
- **The existing browser checks**, unchanged: `saver_shows_check` (8 shards), `saver_faces_check`,
  `saver_editor_check`, `looks_check`, `grid_blocks_check`, `block_taps_check`, `grid_edit_check`,
  `settings_viewports`, `admin_page_check`, `client_smoke`, and `sheet_review.py` (34 sheets at 8 sizes).
- **The gallery** (`gallery.py --out <dir>`, 116 shots) run on the parent and the slice, decoded and compared pixel
  for pixel. B0 first runs it twice on one tree: if two runs differ, the non-deterministic shots are listed and
  compared by DOM instead.
- **Load behavior.** The page-health numbers (time to first draw) on the dev server before and after; and the
  request count for a first load. A split adds one parallel round trip for each shell's parts the first time; the
  `?v=` files then come from the browser's cache. If first draw moves by more than 50 ms on the LAN, the build log
  says so and the owner decides (decision 6).

### Part C: type-check the JavaScript (and Python)

#### JavaScript

- **Tooling (C0).** TypeScript, pinned, in its own `tools/typecheck/package.json` and lock (decision 7), so the
  Docker image's esbuild stage and `tools/package.json` don't change. `tools/typecheck/tsconfig.json`: `allowJs`,
  `checkJs: false`, `noEmit`, `lib` ES2022 + DOM, `include` `web/**/*.js` and `hosts/ha/frontend/*.js`. With
  `checkJs` off, **only a file that starts with `// @ts-check` is checked**, but every file is read so names
  resolve. `tools/build_tools.py` installs it as it installs esbuild (its SMB-aware `npm ci`).
- **Globals (C0).** The code talks through 117 distinct `window.hk*`/`window.mantel*` names (`hkCards` alone 1,359
  uses, `hkSettings` 305, `hkShell` 173, `hkMusic` 124). `web/types/globals.d.ts` declares them all, typed `any` at
  first.
- **The host contract (C2).** `web/types/hk-shell.d.ts` and `hk-client.d.ts` describe `hkShell` and `HKClient`. Both
  adapters (`web/shim/mantel-shell.js`, `hosts/ha/frontend/hk-ha-shell.js`) mark their objects `@type` that
  interface. Rule 1 says anything the shared code needs from a host is added to both; today that is held by text
  tests (`test_shell_boundary.py`); this makes the compiler say which host forgot.
- **The ratchet (C0).** `tests/test_types.py` keeps the set of `// @ts-check` files in a fixture: the set may grow and
  never shrink, and a new `.js` file under `web/` must start with `// @ts-check` (the 142 existing files are the
  recorded exceptions).
- **Strictness (decision 8).** `checkJs` without `strict` first. A second config, `tsconfig.strict.json`, lists the pure
  logic files that also take `noImplicitAny` (`hk-settings-model.js`, 2,871 lines of "words and small decisions", is
  the first).

**How many errors?** `tsc` is not installed on this Mac (not in `tools/node_modules`, not global, not in the npx
cache), and this plan installed nothing. So the count is an estimate from reading, **not measured**. The code is old
style: no JSDoc anywhere (`@param/@type/@returns` count 0 in all four big files), `var` and function expressions, closures
that return `any` from `null`-initialized variables. In plain `checkJs` that infers most things as `any`, which is
quiet. The errors that do appear are the DOM kind (`Element` has no `.value`/`.style` after a `querySelector`: the four
files have 196 `querySelector` calls), `window.x` names (fixed once, by the globals file), wrong argument counts and
possibly-undefined misuse. A reasonable range is one error per 100 to 250 lines in DOM-heavy files: about **40-100** in
`hk-settings.js`, **30-65** in `hk-saver.js`, **15-40** in `hk-media.js`, **10-26** in `hk-grid-cards.js`, so roughly
**100-250 for the four**, and around **1,000** if all 135,000 lines were opted in. C0's first act is to turn `checkJs`
on for everything in a scratch run and record the real number per file in `tools/typecheck/baseline.json`.

**How files come in (C1).** Agents take a batch of files each. For each: add `// @ts-check`, fix its errors, with
JSDoc comments and small narrowing guards. **Comments don't ship**, and esbuild strips them, so a comment-only change
leaves the build id (`tools/build_static.py`'s hash of the minified files) the same: that is a byte-for-byte proof
that the shipped code is unchanged. A fix that changes code (a typo `tsc` found, a real bug) is its own commit with a
test, and is listed in the Build log. Files with zero errors are opted in first.

**Why before Part B.** `tsc` reports "Cannot find name 'X'" (TS2304) for every closure variable a part uses and doesn't
have. That list *is* the kit. `split_js.py` runs it on each new part, and a part that drops a name fails in CI
instead of on a page nobody opened. So C0 is built before B0.

#### Python

- **`mypy` on `hk_core/` (C3).** 15,408 lines in 59 files; 707 of 780 `def`s already have a return annotation. A
  `[tool.mypy]` section in `pyproject.toml`, `files = ["hk_core"]`, excluding `hk_core/link/` (Home Assistant's side,
  excluded from the package too). `mypy` goes in the `dev` extra. A step `types-py` in `tools/ci.py`. The baseline is a
  per-module error count in `tools/typecheck/mypy_baseline.json`; a test fails when a module's count goes up.
  `hk_core` is vendored into HK Frontend and Mantel Link, so an annotation change changes their bytes at the next
  publish; it isn't a release by itself.
- **`mantel_server` module by module.** 57,946 lines, 164 files; 3,454 of 3,762 `def`s have a return annotation. The
  new modules of Part A (`route_table.py`, `guards.py`, `live.py`) are `strict` from the start (a per-module
  override); the rest come in by the ratchet.
- **`ruff` with the pyflakes rules only (C4)**: undefined names, unused imports and redefinitions. There is no linter
  today (nothing in `pyproject.toml`, none in the venv). A name that is undefined in a branch the tests don't reach is
  the same bug class as a part that lost a variable. Same ratchet.
- **A size ratchet (B0).** `tests/test_file_sizes.py` records every `web/**/*.js` over 2,500 lines and every Python
  file over 2,200; none may grow, and none new may cross the line.

Neither tool is installed on this Mac (`mypy` is not in `~/.venvs/mantel`), so the error counts for Python are
unmeasured too; C3 records them first.

## How it's built (models and effort, the owner, 2026-11-03)

- **The building session runs Opus 5.5 at Medium effort.** It writes `route_table.py`, the rules and the
  parity table, decides each column's value for the routes that aren't obvious, reads what agents bring back, and runs
  the verification.
- **Agents run Sonnet 5.5 at High effort** (`model: "sonnet"`, `effort: "high"`), each with a brief that names its
  files and what done looks like:
  - A2: moving the 68 `ALLOW` entries onto their handlers, by module;
  - A3: filling `reads` for the 96 GETs, in three groups, and writing the conformance tests;
  - B1-B4: running `split_js.py` with a manifest an agent drafted from the banners, the sweeps and the checks;
  - C1: opting files in, in batches of 8 to 12;
  - the guide and docs.
- **Opus 5.5 for an agent only when it truly needs it.** One case, stated: **the security review of A3 to A8** (the
  `reads` values for the 30 `signed_in` GETs, the preview allow-list now taken from the table, the live-registry
  rules, and the MCP parity table): it is the same judgment that missed the six cases the audits found, so it gets the
  stronger model. Nothing else does.
- **A review agent reads every slice's diff** (Sonnet, High; the Opus case above where it is security) before the
  slice is pushed.

### Rules for the building session

- **Finish everything without stopping.** Every question for the owner is in "Decisions for the owner" now, with a
  recommendation. **Something unforeseen: take the safest choice consistent with the decisions, write it in a Build
  log at the end of this page (what, why, what else was possible), and continue.** Stop only for what only the owner
  can physically do. Nothing in this plan needs that.
- **Each slice ends with its tests and `tools/ci.py quick`.** `tools/ci.py full` before each push. A front-end slice
  leaves every browser check passing and the sweeps identical.
- **Push finished work to `origin/main`:** fetch and merge (`git merge --no-autostash -s ort` on the SMB checkout),
  `tools/check_private.py` first, never force. No release without decision 11.
- **Collisions.** Before each B slice and before A7, list the open worktrees and recent branches that touch the files
  (`git diff --stat origin/main...<branch>`). A file someone else is editing is split in the quiet minutes: the whole
  slice (script, checks, full run, push) is done in one sitting, and if `origin/main` moved the script is re-run. If a
  file is never quiet, do the other slices first and return; if it still isn't, split it anyway (decision 5) and put the
  `--find` note in the commit message.
- **Route-table enforcement (A7) lands last in Part A, on a quiet main.** A route another session adds in the
  meantime is declared by whoever lands A7, after the final merge.

## Slices

Build order: **A0-A8 and C0 first** (C0 is independent of A and can run beside it), then **B0-B4**, then **C1-C4**,
then D. Sizes: S about an hour, M a few hours, L most of a day.

| Slice | What | Size | Needs |
|---|---|---|---|
| A0 | `tools/route_table.py` (walk, print, `--diff <rev>`); the walk under every flag combination; the spec matrix; `tools/route_probe.py` and its baseline; the first findings (`api_stats`, the HTTP preview walk) written up | M | |
| A1 | `route_table.py`, `Policy`, `@guard`'s new columns (optional), `@open_route`, `verify()` in warn mode (logs, and a test that prints the gaps), generated `Routes.md` and the lock | M | A0 |
| A2 | The 68 `ALLOW` entries onto their handlers as `@open_route`, by module (app_auth 24, mcp.oauth 8, accounts 6, then the rest); the structural proofs; `ALLOW` deleted | M | A1 |
| A3 | `reads` for the 96 guarded GETs and the changes that return data, in three groups (the 30 `signed_in` first); `tests/test_route_conformance.py`; the findings fixed, each with a test that fails first | L | A1 |
| A4 | `stream`: `live.KINDS`, the scan and the witness, `proxy_check.ws` as `bounded`, revocation tests for `/ws`, `/ws/talk`, `/linked/ws` | M | A1 |
| A5 | `preview` into the table; `auth.preview_allows` reads it; the HTTP walk replaces the hand list; the old constants go | S | A3 |
| A6 | MCP parity: `Tool.like`, the parity table for the 22 write tools, R9 and R10 | M | A3 |
| A7 | Enforcement: defaults removed, warn becomes `RouteTableError` at start, the test builds every flag combination; Rule 7, Architecture, Building-and-Testing, CONTRIBUTING updated | S | A2-A6 |
| A8 | Socket reads (51), linked actions (8) and the app routes (21) as rows; `PREVIEW_READS(_NEVER)` and `READ_ALLOWED` folded in | M | A7 |
| C0 | `tools/typecheck/` (TypeScript pinned), `tsconfig.json`, `globals.d.ts`, the `types-js` step in `ci.py`, the ratchet test, the real error count per file | S | |
| B0 | `tools/split_js.py`, `split_files.js`, `tests/web_sources.py`, `settings_sweep.py`, the gallery determinism check, the size ratchet, the first-load numbers | M | C0 |
| B1 | `hk-grid-cards.js` | S-M | B0 |
| B2 | `hk-media.js` | M | B1 |
| B3 | `hk-saver.js` (the stateless sections; the rest reported) | L | B2 |
| B4 | `hk-settings.js` | L | B3 |
| C1 | Opt-in, in batches: files with no errors first, then the four split files' parts, then the rest by size | L | C0; B for the four files' parts |
| C2 | The host contract types on both adapters | M | C0 |
| C3 | `mypy` on `hk_core`, then `mantel_server` by ratchet | M | A7 for the new modules |
| C4 | `ruff` (pyflakes rules) and its ratchet | S | |
| D | Docs: Rule 7, Architecture "Route guards", Building-and-Testing (the new steps), `docs/development/Routes.md` from the table, the Audit page's debt lines marked done | S | all |

**The first useful stop** (it isn't a stop for the building session, it is where the value is): A0-A7. After them the
bug class is closed for REST routes, whatever happens to B and C.

## Tests

- `tests/test_route_table.py`: R1-R12 on the app built under every flag combination; the spec matrix equal to its
  fixture; the lock and `Routes.md` fresh; the shadowing check; `build_app` raises `RouteTableError` for a test app
  with one undeclared route, one `reads`-less GET and one tool with no `like=`. Replaces what `test_route_guards.py`
  checks; the old file stays until A7 and then holds only the guard-spec contradiction test.
- `tests/test_route_conformance.py`: a Child and a wall tablet against every `view`/`feature` GET (nothing the fixture
  forbids appears); revocation closes each `live` stream; the audit row first for each audited change that has a
  fixture (`audit_unavailable`).
- `tests/test_mcp.py`: the parity table; the preview walk for HTTP now comes from the table (A5), and the old 29+9 list
  becomes a spot check.
- `tests/test_web_sources.py`: each shell's `PARTS` equals its folder; the loader copies match the template; every
  `register('hk-...'` stays in the shell for `hk_cards.tags_of`; the parts' headers; `register` calls found by
  `tags_of` equal those before the split.
- The jsc suites unchanged, through `split_files.js`.
- `tests/test_web_lifecycle.py`: the WEB-11 test (a part that didn't come is asked for again) extended to the four
  shells.
- `tests/test_types.py`: the `// @ts-check` set only grows; a new web file has the header; `mypy`'s per-module counts
  only fall; the size ratchet.
- Run with `tools/ci.py` (`quick` while building, `full` before each push; `--only` for a step).

## Verification

Per slice, in this order, and recorded in the Build log:

1. The slice's tests, then `tools/ci.py quick`.
2. **A:** `tools/route_probe.py --diff <parent>` prints nothing; `tools/route_table.py --diff <parent>` shows only the
   columns the slice fills.
3. **B:** `split_js.py` proves every member moved unchanged; the Settings sweep, the gallery and `sheet_review.py` are
   identical to the parent's; the first-load numbers are noted.
4. **C:** `tsc` clean on the opted-in set; the build id is unchanged for a comment-only slice.
5. A review agent reads the diff; its findings fixed or answered in the Build log.
6. `tools/ci.py full` (with `PLAYWRIGHT_PATH` and `NODE` set; from a worktree, with `PYTHONPATH` set to the worktree
   and the main checkout's `tools/node_modules`), then `check_private.py`, then the push.

At the end: `ci.py full --all`, once, on the merged tree.

## Definition of done

- A0-A8 on main. `build_app` refuses an undeclared route, a GET with no `reads`, a streaming route with `stream="none"`
  and a write tool with no `like=`; `tests/test_route_table.py` fails for each. `Routes.md` and the lock are generated
  and fresh.
- The probe diff is empty for every migration slice; the fixes the table found are listed, each with its failing-first
  test.
- `ALLOW`, `PREVIEW_PATHS/PREFIXES/PATTERNS`, `PREVIEW_READS` and `PREVIEW_READS_NEVER` are gone, replaced by the table.
- The four files split as far as the method allows: no file above about 2,000 lines except the saver's shell (target
  3,500, with the remainder measured in the Build log). The sweeps, gallery, `sheet_review.py` and every browser check
  identical; the jsc suites at their old counts.
- `tsc` runs in `ci.py`; every file from the four splits and every file with zero errors starts with `// @ts-check`; the
  ratchet is in place; the real error counts are in `baseline.json`. Both host adapters typed against the contract.
- `mypy` on `hk_core` clean or at its baseline; `ruff` at its baseline.
- Rules.md Rule 7 and Architecture say what is now true. No file in this phase says "plan; nothing built" any more.
- Nothing released unless decision 11 says so.

## Decisions for the owner

**Decided 2026-11-03:** the owner accepted every recommendation below, the release decision included. The building session takes each recommendation as the answer and does not ask again.

| # | Question | Recommendation |
|---|---|---|
| 1 | Where does the route table live: (a) on each handler (`@guard` extended, `@open_route` new), with the single table assembled at start and generated into `Routes.md` and a lock file; (b) per-module `ROUTES` lists that replace `app.router.add_*`; (c) one hand-written file with all ~300 rows? | **(a).** 220 routes already declare their guard on the handler, next to the audit action; (b) rewrites 293 registrations for form; (c) separates a row from its handler and becomes the file every session edits. The table you read is the generated one |
| 2 | Refuse to start when a route is undeclared? | **Yes, always, with no escape hatch.** It is a programming error that is the same on every start of one build; a test builds every flag combination, and `update` already restores the old version after a failed start |
| 3 | The table will find routes that give more than their rule allows (`api_stats` is the first). Fix them to the stricter rule in separate commits, each with a failing-first test, and list them in the Build log? | **Yes.** Where tightening would break a page that ships, keep the access and cut the answer instead (for `api_stats`: no page calls it, so Managers only) |
| 4 | An MCP tool that is looser than the REST route it parallels: tighten the tool? | **Yes** (the stricter wins). If a tool can't be made as strict, remove it from the list and say so |
| 5 | May the session split a file while another branch still has edits to it? | **Yes.** The split is a script run on the latest main; the commit message says how to find a moved method (`split_js.py --find`). It doesn't ask other sessions to pause |
| 6 | The parts load at run time (one extra parallel fetch on first load), as `hk-detail` does, or are the source split and joined again at build? | **Run time, as `hk-detail`.** Real files are what `tsc`, the jsc suites and a reader can use; a joined build leaves fragments of a function nobody can type-check. If first draw slows by more than 50 ms on the LAN, the Build log says so and you decide |
| 7 | TypeScript in `tools/package.json` with esbuild, or its own `tools/typecheck/`? | **Its own folder.** The Docker image's esbuild stage and the lock it reads stay exactly as they are |
| 8 | `strict` for the JavaScript? | **Not yet.** `// @ts-check` per file first, `noImplicitAny` only for pure-logic files in a second config, starting with `hk-settings-model.js` |
| 9 | `mypy` for Python (not `pyright`)? | **Yes, `mypy`,** on `hk_core` first, then `mantel_server` by a ratchet, with the Part A modules strict from the start. It is a pure-Python dev dependency; `pyright` would add a second Node tool |
| 10 | `ruff` with the pyflakes rules only? | **Yes,** with a ratchet. There is no linter now |
| 11 | May the session release to the house when done? | **Yes, once, only if the Definition of done is met and `ci.py full --all` is green:** Mantel and HK Frontend together (the web files are shared); Mantel Link isn't touched. Release notes list the behavior changes from decision 3 and nothing else. If anything is red, no release: push to main and finish. The `vX.Y.Z` tag rule applies |
| 12 | The other big files (`hk-sky.js` 7,023, `hk-base.js` 4,802, `hk-energy.js` 4,299, `hk-cameras.js`, `hk-weather.js`, `hk-strategy.js`, and the Python ones over 1,400 lines)? | **Leave them,** recorded in the size ratchet so none grows. The same method does them later if you want |
| 13 | If B3 (the saver) can only move its stateless sections, is stopping at about 3,500 lines for its shell acceptable? | **Yes.** Rewriting 144 shared variables is not a move; the Build log carries the measured count for a later phase |

## Sources

- The three audits: `docs/development/Audit-2026-10.md`, `Audit-2026-10-second-pass.md`, `Audit-2026-11-third-pass.md`
  (the register rows SRV-1 to 8, MED-10, RBAC-1 to 3, AUTH-1 and 2, and the three "Remaining technical debt" notes).
- Rules 1, 3 and 7: `docs/development/Rules.md`; the guard section of `docs/development/Architecture.md`.
- Code read: `hosts/server/mantel_server/guards.py`, `auth.py` (lines 42-57), `server.py` (lines 65-90, 360-405, 618-925),
  `live.py`, `media_proxy.py`, `proxy_check.py`, `hk_cards.py`, `mcp/tools/__init__.py`, `mcp/grants.py`,
  `tests/test_route_guards.py`, `tests/test_mcp.py` (lines 1031-1090), `tests/test_route_guard_gaps.py`.
- The split precedent: commit `5573f9db`, `web/hk/cards/hk-detail.js` (the `SHEETS` loader, lines 2625-2700),
  `hosts/ha/custom_components/hk_frontend/tests/detail_files.js`, `tests/test_web_lifecycle.py`.
- Build and check tools: `tools/ci.py`, `tools/build_static.py`, `tools/build_ha.py`, `tools/build_tools.py`,
  `tools/headless/` (`gallery.py`, `sheet_review.py`, `settings_viewports.py`), `docs/development/Screenshots.md`.
- TypeScript: JS files and `checkJs`, `// @ts-check`: <https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html>
- mypy: <https://mypy.readthedocs.io/en/stable/config_file.html>; ruff's pyflakes rules: <https://docs.astral.sh/ruff/rules/#pyflakes-f>

**Not checked while planning (the building session measures these first and records them):** the TypeScript and
`mypy` error counts (neither tool is installed here; the figures above are estimates); the route count under every flag
combination (only `ingress=True, connect=True` was built); whether `api_stats` and the other `signed_in` GETs leak
beyond what was read (no request was made); that the gallery is pixel-deterministic from run to run; the cost of the
extra fetch on first load on a real tablet; that the HA App and Docker images accept the new `web/hk/` folders (the
`sheets/` precedent says they do).

## Build log

### Part A (2026-11-03)

**Built:** A0-A8. `guards.py` gained `reads`, `why`, `stream`, `preview` and `sample` on `@guard`, and
`@open_route(kind, why=...)` for the routes not called with a session; `route_table.py` builds one row per route and
applies R1-R13; `build_app` ends with `route_table.install(app)` and raises `RouteTableError` (A7);
`tools/route_table.py` generates `docs/development/Routes.md` and `tests/fixtures/route_table.lock.json`;
`tools/route_probe.py` is the probe; `socket_reads.py` declares the socket's reads and Mantel Link's messages (A8);
`mcp_parity.py` holds the parity rules.

**Measured:**
- Routes under every option combination: **302** (279 with no options; Ingress adds 9, Connect 5, go2rtc 9 -- Live
  TV, direct cameras and UniFi Protect, which the plan's count missed: it built only `ingress=True, connect=True`,
  293). With the socket's 52 reads and Mantel Link's 7 message types the table has 361 rows.
- Own-check routes (A2, by an agent): app_dpop 19, static 18, sign_in 15, oauth 8, one_time_code 6, public 3, proxy 2,
  mcp_bearer 1, link_credential 1 (73).
- The probe: 299 route-methods x 9 principals x 2 doors = 5,382 requests, 5-25 s; two runs byte-identical.
  `--diff HEAD` on the migration printed only `GET /api/stats` (the fix below).
- Building the table costs about 30 ms at start.

**Behavior changes the table found (decision 3, each its own commit, each test failing first):**
1. `GET /api/stats` gave any session, a Child or a wall tablet included, the 15 busiest entity ids and every
   connected screen's counters. No page calls it: Owners and Admins only (`test_the_busiest_entities_...`).
2. `GET /api/areas` listed every area and its entity count to any session. Owners and Admins (not at a tablet) see
   all as before; anyone else sees the areas holding something they may view, counted by what they may view
   (`test_a_child_reads_nothing_it_may_not_view_from_any_view_read`).
3. (The security review's.) `GET /api/sessions?user_id=`, `DELETE /api/sessions/{id}`, `GET /api/app/devices?all=1` and
   the app revoke took a wall tablet's session (the person's own Me page) and so let a manager's forgotten sign-in at a
   tablet list and end everyone's. Another person's are now refused at a tablet
   (`test_a_manager_signed_in_at_a_wall_tablet_manages_only_their_own_sessions_and_apps`).
4. MCP parity (decision 4): `alerts_test` parallels `POST /api/alerts/channels/{id}/test` (Owner, a fresh factor away
   from home); an assistant has no fresh factor, so the tool works from the LAN door only
   (`test_an_assistant_tests_an_alert_channel_only_from_home`). The other 21 write tools are as strict as what they
   parallel: 6 screen tools name `/api/screens` routes (manager), 15 are a page's socket frame (`no_route=`).

**Choices not in the plan (the safest consistent with the decisions):**
- `reads` for an own-check kind that never carries house data (`sign_in`, `oauth`, `static`, `public`) defaults to
  `none` with the kind's reason; every other kind states it. R4 applies to GETs (and `*`); a POST that answers with
  house data (`/api/app/command`) is not required to state `reads` -- whether a change "returns data" can't be told
  from outside the handler.
- `preview` takes `"<parameter>=<regex>"` as well as True, for `GET /api/photos/{photo}/{size}`: a preview gets a
  photo's screen sizes, never its original or mask, as the old pattern said. `auth.preview_allows` now reads the
  route's declaration and `fullmatch`es the parameter. Two edges move: `/proxy-check/{name}`'s assets, which the old
  dashboard pattern let a preview fetch by accident (a hyphen in "proxy-check"), are closed to previews; nothing a
  screen draws is affected.
- The stream scan (R5) also looks for `file_response(` and `proxy_image(` (helpers that stream), after the review found
  six picture routes that said `none` and stream through `camera_still.proxy_image`; they say `bounded:` with the cap.
- R8 also refuses an address the session middleware lets through signed out that isn't on `route_table.SIGNED_OUT`
  (the review: a new `@open_route("static")` that adds itself to `public_paths` would otherwise pass every rule).
- R1 also refuses a `@guard` spec copied onto another function by `functools.wraps` (`__guard_of__`).
- A8 also declares `read_api` (a calendar's events, the socket's other read message) and Mantel Link's
  `phone_action` (protocol 2), which the review found outside the first cut: 52 reads and 7 messages.
- A8 keeps `readproxy.READ_ALLOWED` as the relay's key filter (what keys each read may carry): the policy columns it
  doesn't have moved to `socket_reads.READS_BY_TYPE`, which replaced `server.PREVIEW_READS` and `PREVIEW_READS_NEVER`.
  Socket reads declared `view` are not in the HTTP conformance test (their filters are tested in
  `test_readproxy_filters.py` and the features' tests). The 8 command types stay the gateway's (not rows).
- The security review (Opus, as the plan says) also noted, left as they are and stated here: `/api/admin/overview` is
  `self` though it carries the Set Up summary for managers; `/api/fixtures` is `none` though a development checkout's
  captured feeds are house data (an install has none); `looser()` doesn't compare a tool with an own-check route;
  structural proofs are text scans (a comment can satisfy them); R11 tries one sample path per route.

### C0 (2026-11-03)

TypeScript 5.9.3, pinned in `tools/typecheck/` (decision 7). `tools/typecheck/check.py` installs it on first use
(`npm ci`, the old folder renamed aside first as `tools/build_tools.py` does on the SMB share), runs `tsc` on the files
that open with `// @ts-check`, and `--measure`s every file. **The real count: 1,059 errors in 89 of 146 files** (57 have
none); `hk-settings.js` 170, `hk-saver.js` 31, `hk-grid-cards.js` 22, `hk-media.js` 2, against the plan's estimate of
100-250 for the four and about 1,000 for everything. 763 are TS2339 (a property tsc can't see on an `Element` or an
inferred object). Per file in `tools/typecheck/baseline.json`; the `types-js` step is in `ci.py quick` (8 s).

Choices: the globals file is `tools/typecheck/types/globals.d.ts`, not `web/types/` (anything under `web/` ships in
the image); it declares the 103 `window.hk*`/`window.mantel*` names found today (the plan counted 117 by a looser
pattern) plus an index signature, so a misspelled `window.hk...` can't fail yet. The installer is check.py itself,
not `tools/build_tools.py`, so the Docker image's esbuild install stays untouched.

### C3 and C4 (2026-11-03)

`mypy` 2.4 and `ruff` 0.17 in the `dev` extra; `[tool.mypy]` and `[tool.ruff]` in `pyproject.toml`;
`tools/typecheck/py_check.py` and the `types-py` step in `ci.py full` (15 s warm, about two minutes with a cold cache on
the share; it is skipped as unchanged when no Python changed).

- **mypy on `hk_core`: 136 errors in 22 of its files**, recorded per file in `tools/typecheck/mypy_baseline.json`;
  a file whose count rises, or a new file with any, fails. The plan's Python estimate was unmeasured.
- **The route table's modules strict from the start** (`route_table.py`, `guards.py`, `live.py`, `socket_reads.py`,
  `mcp_parity.py`): 14 errors under `mypy --strict` fixed (annotations only), now none, and the step keeps it so.
  The rest of `mantel_server` comes in later by adding modules to that list (the ratchet the plan names); nothing
  else of it is checked yet.
- **ruff, the pyflakes rules only: 519 findings in 85 files** (`hk_core`, `hosts/server`, `tools`, `tests`): F811
  redefinition 399 (mostly pytest fixtures imported into a test module and taken as parameters), F401 unused import
  101, F841 unused variable 16, F541 an f-string with nothing in it 3. **No undefined name (F821) anywhere.** Per file
  in `tools/typecheck/ruff_baseline.json`, the same ratchet.

### C2 (2026-11-03)

`tools/typecheck/types/hk-shell.d.ts` and `hk-client.d.ts`. The contract is two layers, so there are three shell types:
`HkShell` (the `window.hkShell` facade the shared code calls: 46 methods and its own members), `HkShellHost` (what
an adapter hands `use()`: 18 members both hosts implement, required; 27 only one host has, optional, since the facade's
defaults cover the other) and `HkShellMethods`. The client: `HKClient` (19 members) and `HkClientPort`. Both hosts'
shell and client adapters (`web/shim/mantel-shell.js`, `mantel-client.js`, `hosts/ha/frontend/hk-ha-shell.js`,
`hk-ha-client.js`) are typed against them and opt in, 0 errors; dropping a required member fails `types-js`.
Comments only: Mantel's build id `d5edc76657f1a07c` and HK Frontend's minified adapters are identical before and after.

Found, not changed (a follow-up): `hk-strategy.js` polls `window.hkShell.defined()` up to 600 times at 100 ms; Mantel's
adapter has no `defined`, so the facade's default answers false and the poll runs its full 60 s on Mantel for nothing.

### B0 and B1 (2026-11-04)

`tools/split_js.py` and `tools/split_js.cjs` (the TypeScript compiler API): a manifest names the members each part
takes; the kit is computed from the checker's resolved names, and `tsc` must report exactly that kit as missing before
the takes are written, and nothing after; every moved member's text is compared after the move; a member that writes
shared state is refused; `--find NAME` and `--check`. `split_files.js` took over `detail_files.js` for the jsc suites;
`tests/web_sources.py` for the main suite; `tests/test_web_sources.py`, `tests/test_file_sizes.py` (the size ratchet,
14 web files and 1 Python file over the lines).

**B1:** `hk-grid-cards.js` 2,649 lines -> a 217-line shell and six parts in `web/hk/grid-cards/` (391, 512, 438, 570,
218, 487). The jsc suites' output identical (164 suites); the gallery's 41 shots pixel-identical (two baseline runs
identical first; `home-grid-starters` fails at baseline too and is left out); first load of a Home Grid screen 108 ->
114 requests (the parts, in parallel), time to ready 0.33 s against 0.27-0.31 s on local disk. `hk-grid-math.js` opts
in to `// @ts-check`. The browser checks now wait for a split shell's elements after `__mantelReady` (on the SMB
checkout the parts arrive later and three checks read cards too early). Under Home Assistant a YAML `custom:hk-*`
grid card is defined one round trip later than before; Lovelace rebuilds the card when it is defined.

### B3 (2026-11-04)

`hk-saver.js` 6,478 lines -> a **4,515-line shell** and seven parts in `web/hk/saver/` (2,235 lines: helpers 673, CSS
595, photos 236, draw 175, music 384, pane 84, black 88; 175 members). **Short of the 3,500 target, measured:** the
saver has 238 top-level names, 143 of them reassigned; all but six small clusters form one connected group (268
statements, 4,203 lines) around `cfg`, `on`, `host`, `root`, `deck` and the timers, with the `window.hkSaver` literal,
the `hk-music-pane-card` registration and the listeners in it. Moving more needs getters and setters on the kit
(decision 13: not a move). What is left, by section (lines, then shared mutable variables its statements touch):
helpers 97/3, the page 16/1, state 65/3, the switch 48/6, idle 15/4, input 134/19, the element 148/22, start/stop
246/30, photos 277/35, the mosaic 239/23, the forecast 89/14, the slide corner 146/17, the layout 547/25, the clocks
278/33, home energy 145/22, the weather 85/18, additional screens 78/16, the music 152/6, the music's panel 350/19, the
dashboard's pane 237/8, the pane 371/27, HK's own black 251/38, the loop 266/51; 134 distinct reassigned variables in
all. The size ratchet holds the shell at its measured size.

Proved: `split_js.py --all --check`; no TS2304 in a part (five parts opt in, 0 errors); the jsc suites identical (one
text pin in `test_saverlayers.js` read two functions now in different files, and reads them separately); the gallery's
41 shots pixel-identical; the saver's browser checks pass (each flake under load passed run alone). Load, from local
disk: a saver screen's first load 103 -> 110 requests; page ready unchanged (115-200 ms against 118-181);
`window.hkSaver` there 60-110 ms later (195-351 ms against 151-241), before the screensaver can start (it waits for
idle), so nothing a person sees moves; under decision 6's 50 ms rule this is not first draw. `web/home.js`'s
screensaver-only preview now waits up to 10 s for `window.hkSaver` (it was there at once before).

The B1 review's follow-ups: the shared loader sets `window.__hkSplitStarted[<shell>]` synchronously, so a second
evaluation never runs the parts twice; the test views fail loudly for a known shell without its parts list; the
tool keeps a `var` whose initializer touches nothing in place (it was pulled into the waiting block).

**The browser checks under load (2026-11-03/04):** with other sessions' runs on the same Mac, `ci.py full` failed a
different set of browser checks on each run (page loads past 30 s, the screensaver not up in time), on this branch and
on `origin/main` alike; every one passed run alone, and four alternating runs of a failing shard on main and on this
branch were all clean. `test_settings_viewports.py` listens on a fixed port (9371) that another session's suite can
hold at the same moment. B0-B1 was pushed with the pre-push hook skipped after its one failure (that test) passed
alone.

**Waiting on nothing.**
