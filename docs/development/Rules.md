# Rules

Every change to Mantel follows these rules. Where a rule can be checked, a test or tool checks it, and a change
that breaks it fails the main suite. [Architecture](Architecture.md) explains the design behind them.

## Where new code goes

Before writing a feature, find its place; a new file is cut to the size of one feature, well under the limits of rule 8
(aim under about 800 lines: a file that starts big reaches the wall in a few weeks).

- **The decision** (what the feature does, in plain data and words): `hk_core/<feature>.py`, or `hk_core/<feature>/` for a
  big one (rule 2), tested once in `tests/test_hk_core_<feature>.py`. Both hosts call it.
- **Mantel Server's side** goes in its feature's package under `hosts/server/mantel_server/`, never a new flat module:

  | Package | For |
  |---|---|
  | `identity/` | people, sign-in, sessions, roles, guards, pins, service accounts |
  | `ha/` | Home Assistant's bridge: the gateway, the client, the registry, states, socket reads |
  | `cameras/` | cameras, Protect, Live TV, photos, faces, images |
  | `music/` | Music Assistant: calls, states, the library, browsing |
  | `linked/` | linked mode: a Mantel linked to Home Assistant's Mantel Link |
  | `features/` | hk_core's features running in Mantel, and the house's own (laundry, TVs, timers, the vacuum's water) |
  | `accessories/` | how each accessory shows up on the screens |
  | `intercom/`, `alerts/`, `timeline/`, `mcp/` | those features |
  | `apps/` | the iPhone and Mac apps' API |
  | `network/` | how pages and apps reach the server: the direct listener, Ingress, proxies, headers, Connect, discovery |
  | `storage/` | the database, backups, the store, users' files, sealing, the audit |
  | `pages/` | the server's own pages: About, admin, docs, setup, feature pages, page health |

  A new family of modules gets a package of its own. The flat modules left are the core (`server`, `config`, `live`,
  `view`, `route_table`, ...) and the `python -m` entry points (`health`). A route it adds is declared (rule 7).
- **The web side**, in `web/hk/`: a Home Grid or HomeView block in `cards/hk-<name>.js`, its detail sheet in
  `sheets/hk-sheet-<name>.js` (a part of `cards/hk-detail.js`: it reaches the open sheet only through the sheets' context,
  the kit `hk-detail.js` makes), a shared module in `modules/`, a Settings page as methods in the `settings/` part of its
  section (a section that grows gets a part of its own with `tools/split_js.py settings --regroup`). A screensaver
  feature goes in the part that owns its kind of state (rule 11), with its own `ST` names given an owner.
- **A check:** the main suite first; a browser check only for what the main suite can't see, at the fewest engines and
  sizes that say it ([Building and testing](Building-and-Testing.md#local-checks)).
- **Its documentation:** a phase plan or a feature page under `docs/`, and the code map (`tools/code_map.py`).

## 1. `hass` stays in the host adapters

The shared frontend talks only to `HKClient` and the host shell. Nothing in `web/` names Home Assistant's object
(`hass`) outside `web/shim/` (Mantel's adapter) and `hosts/ha/frontend/` (Home Assistant's). Home Assistant's
element names and frontend events appear only in the host-shell adapters. `hk_core/` never imports
`homeassistant`, and imports only itself, relatively, with one exception: the Home Assistant side of the link that
Mantel Link and HK Frontend share (`hk_core/link/talk.py`, `talk_live.py` and `page_headers.py`), which only those
integrations load; the boundary test lists them.

**Checked by** `tests/test_boundaries.py` and `tests/test_shell_boundary.py`.

If you need something from the host that the contract doesn't offer, add it to `HKClient`, `hkShell` or the
`House` port and implement it in both hosts.

## 2. `hk_core` owns feature decisions

A feature's decisions live in `hk_core/` and nowhere else. A feature moves in three steps: extract its logic into
`hk_core` behind the `House` port; run it in Home Assistant through the HA adapter (`HaHouse`); only then wire
Mantel's own adapter (`MantelHouse`). The hosts keep only their own steps: following states, timers, sequences of
service calls, storage. Test the decisions once, in `tests/test_hk_core_*.py`.

## 3. Commands are off by default

Mantel Server sends a command to the house only while house commands are on. They start off; an Owner turns them on
in Mantel Settings (General → Allow Control of the House, `server_settings.py`) after a fresh sign-in, and the change
is audited before it is applied. `--commands-enabled` is only the value for the very first start. The kill switch
(`--read-only`, `MANTEL_READ_ONLY`, the App's `read_only`) is a start-up option no client message, REST call or
setting can override: with it, the house stays read-only, and Mantel adds and removes no Home Assistant dashboard. Every command is classified, checked against the person's and
the device's role, refused where roles deny, and written to the audit log **before** anything is sent. The only
code a house command asks for is the house Alarm PIN, and only for the alarm.

Tests and checks run with commands off, or against a fake connection that sends nothing anywhere. The one
exception is the end-to-end run against the scratch Home Assistant (`tools/e2e/gateway_e2e.py`), which refuses
any other Home Assistant.

## 4. Secrets are files

Home Assistant and Music Assistant tokens, the at-rest key and tunnel tokens are read from files (Docker secrets,
or a folder such as `~/.config/mantel/`), never from environment variables, command-line arguments, the image
or the repository. `*.token`, `.env` and `secrets/` are git-ignored. Don't paste a token into an issue, a pull
request or a chat.

## 5. Apple's fonts and glyphs never ship

SF Pro and SF Symbols are Apple's and licensed. They stay out of the repository, out of every build and package,
and out of every image, including the docs' screenshots. Each home supplies its own copy. Git ignores them, and
`tests/test_proof1_guards.py` checks that none is tracked.

## 6. Nothing personal in the repository

Code, tests, fixtures, docs, screenshots and commit messages use invented homes, people and devices only: no real
names, addresses, domains, network addresses or pictures of a home. Tests and checks use fictional users and the
scratch Home Assistant (`tools/testha/`), never a real one.

**Checked by** `tools/check_private.py`, with your own list of words kept outside the repository
(`HK_PRIVATE` or `HK_PRIVATE_FILE`). Run it as a pre-commit hook; see
[Building and testing](Building-and-Testing.md#private-words). `tools/build_ha.py` and the publishers also refuse
to build when they find private network addresses, keys or tokens.

## 7. Every route declares its guard

Every route Mantel Server serves declares, on its handler, who may call it and what it may show, in one table
(`route_table.py`; read it in [Routes](Routes.md)). A route called with a session says so with `@guard(...)`
(`guards.py`): who (a session, a person, an Owner or Admin, an Owner), whether a wall tablet's session may, from which
door, how fresh the sign-in must be, what a read may show (`reads`: `view`, `feature:<name>`, `self`, `admin`, `none`
with why), whether its answer stays open (`stream`: `none`, `bounded:<cap>`, `live:<kind>` in the live registry) and
whether a screen preview may fetch it (`preview`). A route with its own check (sign-in, the app's DPoP routes, Mantel
Link, an assistant's `/mcp` and its OAuth sign-in, the media proxy, static files, health) says so with
`@open_route(kind, why=...)`. Every route that changes something names the audit action it writes, or says why it
writes none. The row goes through `audit.config`, before the change: no row, no change (503 `audit_unavailable`). An
assistant's write tool names the REST route it parallels (`like=`) and is never easier to use than it
(`mcp_parity.py`).

**Checked at start:** `build_app` builds the table and refuses to start (`RouteTableError`) when a route is
undeclared or breaks a rule (R1-R12 in `route_table.py`). **Checked by** `tests/test_route_table.py`, which builds the
app under every combination of the options that add routes; `tests/test_route_conformance.py`, which reads every
`view` route as a Child and a wall tablet; and the stream witness in the tests' app. After adding or changing a
route, run `tools/route_table.py --write` and commit the regenerated `Routes.md` and lock: the reviewer reads each
door's rule in the diff.

Write a new route's declaration first, as strict as the route allows; a check only the handler can make (an Admin
never manages an Owner, say) stays in the handler as well. See [Architecture](Architecture.md#route-guards-and-the-audit-of-changes).

## 8. Files stay small and lines stay short

No JavaScript file over 2,500 lines and no Python file over 2,200, and no line over 200 characters, in any hand-written
`.js`, `.cjs` or `.py` (`tests/hand_written.py` says which files count: not installed packages, build output,
`web/hk/vendor/` or a generated file named there). A file over 2,300 lines (JavaScript) or 2,000 (Python) is named under
`tools/ci.py`'s table, "Near the size limit", so a split is planned before a feature is blocked by the wall. A file is
never made shorter by joining lines: that is what the width rule is for.

When a file gets near the limit, cut it by feature with the tools, never by hand: `tools/split_js.py --report FILE`
shows which members must move together, a manifest in `tools/split_manifests/` names the parts, and `tools/split_js.py
NAME` moves the members and proves nothing but their place changed (`tools/split_py.py` for Python). A part of a class-method split (the settings panel's) that grows is cut with `tools/split_js.py NAME
--regroup` (rule 10); a file's manifest can be made and proven before it is needed (`tools/split_manifests/ready/`). A long line is
broken with `tools/rewrap.py`, which proves the program's syntax tree is unchanged. See
[Building and testing](Building-and-Testing.md#big-files-and-long-lines) and
[Architecture](Architecture.md#how-a-big-web-file-is-cut).

**Checked by** `tests/test_file_sizes.py` and `tests/test_line_widths.py` (part of `tools/ci.py quick`, the pre-push run).
Each keeps a list that only shrinks: the files whose split was left for later (`tests/fixtures/file_sizes.json`,
`tests/fixtures/line_widths.json`), and the lines that can't be broken without changing a value, inside a template, a
regular expression or a multi-line string (`tests/fixtures/line_width_exceptions.json`, each with its reason). A new
file or line over the limit fails the run.

## 9. Server modules live in their package

A module of Mantel Server is in its feature's package ("Where new code goes"). Modules are moved with
`tools/move_py.py <manifest>` (`tools/move_py_manifests/`): `git mv`, every import rewritten by the syntax tree, and the
proof that each module is the same object at its new path. The old path keeps importing for one release
(`hosts/server/mantel_server/_moved.py`), so other work in progress goes on; the release its row names deletes it
(`tools/move_py.py --expired VERSION` lists them). A module that finds files beside itself (`__file__`) finds them
through the package (`files("mantel_server")`) instead, so it can move.

**Checked by** `tests/test_moved_aliases.py` (an old path past its release fails) and `tests/test_move_py.py`.

## 10. A file in parts is one file to its callers

A web file cut by `tools/split_js.py` is a shell and parts that register with it; the manifest
(`tools/split_manifests/<name>.json`) says which member is where (`tools/split_js.py --find NAME`). Edit a member where
it is. A part takes from the shell's kit what it uses and hands back what others use; a part that calls a LATER part
does so through that part's exports object (`Run.schedule()`: made empty by the kit, filled by its part), and only when
it is called, never as the parts load. A page that imports a file in parts and uses it at once waits for
`window.__hkSplitReady['<folder>/<name>']` (`imp()` in `web/home.js` and `hk-loader.js` do): two shells share a file
name, so the key is the folder and the name. A file near its limit can have its manifest ready before it is needed,
in `tools/split_manifests/ready/`, proven by `split_js.py <name> --check`.

**Checked by** `tests/test_web_sources.py` (`split_js.py <name> --check` for every split: the members, the kit, `tsc`,
the loader, the exports objects' rule) and `tests/test_settings_prototype.py` (the settings panel's class).

## 11. The screensaver's state has one owner per name

The screensaver's shared state, `ST`, holds what several of its parts read; each name has one owner, the part that
writes it (`tools/state_owners.py`, its `FEATURES`), and the others change it only through a function the owner
exports (`countPhoto()`, `slideCancel()`, `noteInput()`). A name only one part uses is that part's own variable, not on
`ST`. `docs/phase25/SAVER-STATE.md` is the map.

**Checked by** `tests/test_state_owners.py`: the map is current, every name has an owner, and no name has a second writer.

## 12. A test runs where the release's checks run

A test that needs a tool the Linux runner lacks skips there: one that runs a TypeScript-backed tool (`split_js`,
`state_owners`, `rewrap`, the exports check) checks for `tools/typecheck/node_modules/typescript`, not only for Node
(a house release waits on that runner's suite). Before pushing such a test, run the suite with that folder moved away
([Building and testing](Building-and-Testing.md#the-main-suite)).
