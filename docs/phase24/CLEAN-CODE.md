# Phase 24: clean code, start to finish (plan, 2026-11-10)

**Status: plan, ready to build. Nothing built yet. Every decision answered by the owner on 2026-11-10: all
recommendations accepted (decision 1 already done as `cb118148`). The building session takes each recommendation as the
answer and does not ask again.** Reviewed against the code the
same day by an independent agent. Its three blockers are now part of the plan: re-splitting a file that is already
split, files the page reads the moment they load, and the saver's state rewrite as first specified. The gaps it found
are also in.

## The ask (the owner, 2026-11-10)

> "I would like to do the whole project to bring it all into a good state. We need to devise a plan that we can run
> through the night without stop... so verification and validation with each step will be key here. I want this done
> in an intelligent way that makes sense that will also set us up for success in the future. Making it easier to
> modify code, add new features, make adjustments. Anything that can be shared should be for better code optimization
> as well... the end result being a clean code base for everything with the rules outlined earlier in this session."

The rules from earlier that day (the ten-rule Show When session):

- **Size:** no JavaScript file over 2,500 lines, no Python file over 2,200 (`tests/test_file_sizes.py`). Today that is a
  ratchet with 12 exceptions. At the end it is a flat rule with **no exceptions**.
- **A warning before the wall:** a file over 2,300 lines (JS) or 2,000 (Python) is named by `tools/ci.py quick`, so a
  split is planned before a feature is blocked. That day, `hk-grid-editor.js` reached 2,521 lines and was squeezed
  back under 2,500 by joining lines. The warning exists to stop that from happening again.
- **Width:** no line over 200 characters, so a file can't be "shortened" by cramming.

## The answer, in short

**This is phase 18 Part B again, on every file that needs it, plus two new tools.** Phase 18 split four files
(`hk-settings.js`, `hk-saver.js`, `hk-media.js`, `hk-grid-cards.js`) with `tools/split_js.py`. That tool moves code by
member name, has the TypeScript checker work out what each part shares, and proves every moved member is text-identical.
That method worked, so this phase reuses it on 20 more JavaScript files and adds a Python version for two Python
files. It adds a **line rewrapper** (`tools/rewrap.py`) whose proof is that the program's syntax tree is unchanged.
Last, it moves the few real copies of code into one place.

**What makes it safe to run unattended** is that every step either lands complete and verified or doesn't land at
all. Each slice is proved mechanically (identical syntax trees or member text), then checked by what it draws and does:
the jsc suites with output identical to before, the gallery and **the house's own screens** pixel-identical to before,
the feature's browser checks, and the first-load numbers within 50 ms. A slice that can't be made green in two tries is
dropped, logged and skipped, and its file stays held by the ratchet. `main` is green after every push, so stopping at any
hour leaves a clean, working tree. Only the last slice turns the ratchets into hard rules, once nothing is left over.

**What the measurements say (2026-11-10, `fa4429dc`):**

- **Size.** Eleven JS files are over 2,500 lines, three more within 5 lines of it, and seven between 2,000 and
  2,500. One Python file is over 2,200 and one more is over 2,000. The full table is below.
- **Width.** 1,186 lines over 200 characters in `web/` (133 files), 608 in JS outside `web/` (tests and tools) and 105
  in Python (47 files). In `web/`, 58% are long because of a **string**: CSS rules and SVG markup in quotes.
- **Copies.** **Less duplication than expected.** Exactly copied functions: 45 groups and 339 lines in JS, 23 groups
  and 353 lines in Python. Most of the Python copies are modules "ported line for line" between the two hosts. That is
  what Rule 2 says belongs in `hk_core`. The rest are helpers with the same name and *different* code (`esc` has 24
  definitions and 13 variants). Merging those changes behavior somewhere, so they are listed for the owner, not merged
  overnight.
- **Shared mutable state** decides how hard each split is. The checker's view of each file's top-level names, grouped
  by the variables they reassign: **17 of the 20 JS files split by moving whole members**, as phase 18 did. Three need
  more than moving:
  - `hk-saver.js`: one 4,302-line group around `cfg`, `on`, `host`, `root`, `deck` and the timers. Phase 18 stopped
    here (its decision 13).
  - `hk-grid-editor.js`: one reassigned variable, `VIEW`, ties the whole `GridEditor` class to the shell.
  - `hk-base.js`: everything is inside one `initialize()` function, and everything waits for it.

  The tool also needs these before the run can use it:
  - a way to look inside a *declared* function (`hk-base.js`'s `initialize`, `hk-weather.js`'s `boot`);
  - a choice of which IIFE in a file (`hk-weather.js` has four);
  - a fix for the crash on a top-level function named `valueOf` (`hk-chip.js`);
  - **a re-split mode**: today a split shell is only checked, never cut again (`split_js.py` `do_split`). The saver's
    second cut and `hk-detail.js` (whose hand-written `SHEETS` loader predates the tool) both need it.
- **Some of these files are read the moment they load.** `web/home.js` calls `window.hkStrategy.generate` right after
  its imports. `window.hkSettings` (`modules/hk-settings.js`) is read by 83 files and is the first bootstrap import.
  The Settings panel's `boot()` uses `window.hkSettingsModel` and `window.hkSettingsFeatures` as soon as `import()`
  resolves. And `hk-base`, `hk-chip`, `hk-layout` and `hk-tile` are on Mantel's **core** card list. Phase 18 split none
  of these kinds of file, because its shells were lazy cards, the saver and the panel. Parts arrive a round trip later,
  so **the loader gets a readiness promise, and everything that imports a shell awaits it** (A2). Every browser check
  waits for `__hkSplitDone` before looking, which would hide this race, so one new check deliberately doesn't wait.

**Time.** About 14 to 18 hours of wall time, mostly the shared browser gates, which run one at a time, plus A2's tool
work (re-split, readiness, the state rewrite). Started at 8 pm, expect it done around midday. The order (below) lands the most files first, so whatever the clock says, what has landed
is whole.

## What is there now (measured on `fa4429dc`)

| File | Lines | Commits since 10-20 | Shape | How it splits |
|---|---|---|---|---|
| `modules/hk-sky.js` | 7,020 | 14 | module, 301 top-level statements | the CSS group (1,241, incl. a 928-line `SHEET`), the planner group (1,550: `FORCE`, `PIN`, the schedule), the painters (free functions) |
| `cards/hk-base.js` | 4,799 | 68 | all inside `function initialize()`: 427 statements, 26 reassigned names in small groups | by section: design table and scales, builders and material, light page and palette, music (`hkMusic`, 409), sheets (confirm, choose), snapshot cache, art guard, `HkBase` (600), config editors. **On every page's critical path** |
| `modules/hk-saver.js` | 4,465 | 78 | already a phase 18 shell; one 4,302-line group | **the state rewrite** (Part B, "The saver") |
| `cards/hk-energy.js` | 4,300 | 12 | `whenBase`, 14 card classes, 1 reassigned name | whole classes by family: usage and trace, energy page, power, battery |
| `cards/hk-cameras.js` | 3,707 | 24 | `whenBase`, 6 classes | mosaic (1,613, one class), live tile with its queue, doorbell (898), TV guide |
| `cards/hk-weather.js` | 3,695 | 38 | three IIFEs; the third's `boot()` holds 10 card classes | forecast and readings modules, tile, header, alert and status, band, details and radar, strip and clock, page panel |
| `cards/hk-strategy.js` | 3,321 | 70 | 162 statements, nearly all free | the house, room pages, what exists, views, category pages, the two strategy classes |
| `cards/hk-detail.js` | 2,896 | 25 | phase 9 shell (`SHEETS`), `D` group 1,176 | helpers and axes, readout, notification, accessory (597), pop-ups |
| `panels/hk-settings-model.js` | 2,870 | 74 | 381 statements, **none reassigned** (pure) | words, menu, glass, lists, sky and dashboards, Pages screen, search (`SEARCH` 211), tablets, weather, side pane, looks |
| `cards/hk-layout.js` | 2,793 | 51 | `whenBase`, 10 classes | frame and small cards, grid card and views, Home Grid view, pager (468, with `pagerSeq`) |
| `cards/hk-calendar.js` | 2,562 | 27 | `whenBase`, 3 cards and a panel | calendar card, pane card, to-do, event panel, page CSS |
| `panels/hk-grid-editor.js` | 2,499 | 85 | `GridEditor` class 1,864 lines; `VIEW` reassigned | **class-method mode** + `VIEW` into a state object: palette, screen settings, block settings, Show When, Custom Detail Sheet, placement helpers |
| `cards/hk-home.js` | 2,496 | 46 | `whenBase`, 8 classes | vacuum and area select, timers (3 cards), timer strip |
| `cards/hk-headers.js` | 2,496 | 8 | `whenBase`, 9 header classes | climate, lights, security, vacuum, timers |
| `modules/hk-sidepane.js` | 2,485 | 65 | `HEAD_ON` group 835 (with the class), CSS group 400 | decisions (pure), house, drawing, CSS, the pane class, the Dashboard's |
| `cards/hk-chip.js` | 2,184 | 31 | `whenBase`, 5 classes | by chip family |
| `modules/hk-menu.js` | 2,116 | 17 | `whenBase` 1,607, model free | model and menu card |
| `panels/hk-settings-features.js` | 2,106 | 12 | late-bound `K` group 1,417 | by feature page (the `live` binding mode phase 18 built) |
| `cards/hk-tile.js` | 2,049 | 30 | `whenBase`, 11 classes, `CSS` 436 | base and CSS, then tile families |
| `modules/hk-settings.js` | 2,027 | 55 | `cur` group 266 | defaults and looks, subscription, the rest |
| `hk_core/settings/model.py` | 3,738 | 65 | 337 top-level defs, banners for 10 sections, no `global` | a package `hk_core/settings/model/` re-exporting every name |
| `hosts/server/mantel_server/music.py` | 2,126 | 23 | tests monkeypatch its constants | sibling modules for what no patched name reaches |

Everything else is 2,000 lines or fewer. `media/hk-media-now.js` is exactly 2,000 and stays as it is. `hk-glass.js`,
`hk-view-host.js` and the jsc suites are all under 1,700. **Read the moment they load** (see "The answer"): `hk-base`,
`hk-chip`, `hk-layout` and `hk-tile` (Mantel's core cards), `hk-strategy`, `modules/hk-settings`,
`hk-settings-model` and `hk-settings-features`.

## What it doesn't do

- **Change what anything does.** Every slice is a move or a provable rewrite. A behavior change found along the way is
  written down in the Build log for the owner, not made.
- **Merge drifted copies.** Two functions with the same name and different code are listed with their differences
  (Part D's report). Choosing one changes behavior on one host or card. That's a separate decision for the owner.
- **Touch the Apple apps** (`mantel-ios`, `mantel-mac`): separate repositories. They only name web files in comments.
- **Release.** Nothing goes to the house or GitHub Releases during the run (decision 9).
- **Reformat the codebase.** No formatter is introduced. Only lines over 200 characters change.

## The design

### Part P: preflight (before the first change)

1. **Stay awake and off the share.** The session requests keep-awake (`mcp__ccd_host__request_keep_awake`). It
   works in a local-disk worktree, `/private/tmp/mantel-p24`, cut from `origin/main` *after* this plan is pushed, so the
   Build log is there. Browser checks time out from the SMB checkout under load (memory: CI from local disk). It pushes
   from there. Then the set-up a fresh worktree needs:
   - `tools/typecheck/check.py --install`, because `split_js.cjs` needs `tools/typecheck/node_modules`;
   - `tools/node_modules` linked from the main checkout;
   - Python from `~/.venvs/mantel/bin/python`, because the system `python3` has no aiohttp;
   - `PLAYWRIGHT_PATH` and `NODE` set, and `PYTHONPATH` set to the worktree (memory: worktree headless checks);
   - at least 30 GB free (229 GB at planning time).
   **Ports and other sessions:** the browser checks use fixed CDP ports (9333, 9337, 9341, 9347, 9371, 9394), and
   other sessions' checks or Chrome may hold them. The session lists the ports in use and the running sessions
   (`list_sessions`). If a check's port is held, it waits for it to be free before that check, never more than 30
   minutes, and logs the wait. It doesn't stop anything it didn't start.
2. **Nothing the house runs is missing from main.** `speaker-picker` went to main on 2026-11-10 (`cb118148`,
   decision 1). Before B1 the session runs `git cherry origin/main <branch>` for any branch a house hotfix was built
   from since then (memory and the house's `MANTEL_SERVER_IMAGE` say which). If one has a change main lacks, the Build
   log lists each member it touches and the part that member moved to (`split_js.py --find`). The session doesn't
   merge it, because that is the owner's call.
3. **Open branches.** List branches and worktrees with commits not on main that touch a file in the table, with
   `git diff --stat origin/main...<branch>`. Phase 18 decision 5 applies: split anyway, and put the `--find` note in
   the commit.
4. **Baselines, taken twice on the parent, so what varies on its own is known before anything is compared:**
   - `tests/run` output of all jsc suites (text, kept);
   - the main suite's pass count;
   - the gallery (`gallery.py --out`), pixel by pixel;
   - **the house twin** (`house_twin.py pull` once, then `render` of every screen at 1280x800 in WebKit and Chromium,
     plus `--sheets` and `--busy` for the Home Grid screens);
   - the Settings sweep (`settings_sweep.py --save --repeat`);
   - `sheet_review.py`;
   - the first-load numbers (`home_numbers.py --runs 5`, plus Settings' and a saver screen's, as phase 18 measured them);
   - `tsc` and `mypy` baselines.

   **Only the Settings sweep compares by itself** (`--compare`). `gallery.py`, `house_twin.py render` and
   `sheet_review.py` only write PNGs, so A6 adds the comparer before these baselines are taken. A shot or page that
   differs between its own two runs is marked volatile and compared by DOM instead. The baselines
   are kept under `/private/tmp/mantel-p24-base/` and re-taken whenever `origin/main` brings a change to a file not part
   of this phase that draws something.

### Part A: the rules and the tools

- **A1, the rules as ratchets now.** `tests/test_file_sizes.py` gains:
  - the warning band (`--warn`, which `ci.py quick` prints but doesn't fail on);
  - JS outside `web/` in the size count (none is over);
  - the **width ratchet**: `tests/fixtures/line_widths.json` records each file's count of lines over 200 characters. A
    count may only fall, and an unlisted file may not have any. Scope: every hand-written `.js`, `.cjs` and `.py` in the
    repository, except `node_modules`, the vendored `hk_core` copies, `frontend/`, `frontend_min/`, `web/hk/vendor/`
    (`d3-geo.js` has one 20,555-character line) and generated files. The generated files are listed by name in the test,
    beginning with `hosts/ha/custom_components/hk_frontend/tools/sf_symbols/names.py`. Their width comes from their
    generator.

  From A1 on, nothing anyone writes during the night makes things worse.
- **A2, `split_js.py` extensions**, each with a test in `tests/test_web_sources.py` on a synthetic file:
  - `"run_in_decl": "initialize"`: a declared function's body is the scope;
  - `"iife": 2`: pick the third IIFE;
  - the `byName` map built without a prototype (the `valueOf` crash);
  - `--report`, which prints the groups this plan measured (the reassigned names, each group's lines and members), so a
    manifest is drafted from data, not guessed. It doesn't count two kinds of assignment as reassignment: a split
    shell's take-backs from the kit (the saver has 151 names assigned only that way, in `runParts`), and a `var` local to
    a function (the analyzer's `hoisted` branch counts those today);
  - **re-split**: a shell already split is cut further from the **same** manifest. A member moves from the shell or a
    part into a new part. The proof covers every member's text in its new place. `tests/test_web_sources.py`'s rule of
    one manifest per shell and `PARTS` equal to it stays as it is, and so do the test views (`web_sources.LIST`,
    `split_files.js`), which read one list. `"adopt": "SHEETS"` turns `hk-detail.js`'s hand-written `SHEETS` loader
    (line 2639, inside a function) into the generated loader, with the sheets as its first parts. The sheet files'
    text stays unchanged, and `detail_files.js`'s special case goes;
  - **readiness**: the loader template gains `window.__hkSplitReady[label]`, a promise that resolves when the parts have
    run (and rejects where the 75-second limit does today). Everything that imports a module and uses it at once awaits
    it when the module is a shell:
    - `web/home.js`'s `imp()`;
    - `hk-loader`'s `needFile`;
    - the Settings panel's `boot()`;
    - Home Assistant's boot imports (`hosts/ha/frontend/`, `boot.py`'s order).

    The four existing loaders are regenerated, because `test_web_sources.py` pins them byte for byte. The template takes
    one parameter, the double-import guard's name (needed for `hk-base`, B8). Before each shell is split, the session
    greps for every global the file publishes (`window.hkX = ...`) and lists its readers that don't wait, as B8 (i)
    does for `window.hkCards`;
  - **the state rewrite** (`"state": {"vars": [...]}`): each listed top-level `var` becomes a property of one object,
    and every reference, *resolved by the checker's symbol* (never by text), becomes a property access. Its parts:
    - **The object's name** is one the file never uses, chosen by the tool and checked against every identifier and
      property name in the shell and its parts. (`S` would be wrong: it is a parameter in the saver at lines 613 and
      2624 to 2635, and is used 54 times in `hk-base.js`.)
    - **It is declared** with `/** @type {Record<string, any>} */`, so `// @ts-check` files stay clean.
    - **Declarations:**
      - a declaration with a value stays where it was, as an assignment (`ST.cfg = null;`), so the order of
        evaluation is unchanged;
      - a `var` statement that declares several names becomes one assignment per name, in order;
      - a bare `var x;` becomes nothing, because the object starts with every listed property `undefined`, as hoisting
        left a `var`.
    - **It refuses:**
      - a listed name used under `typeof`, `delete` or `with`, or as a function's own name;
      - a listed name that is a parameter or is shadowed in a scope where it is read;
      - a closure that captures one of them in a loop header;
      - a listed name that a jsc suite stands in for by text (below).

    **The proof** is the rewrite run backwards: replace each property access with the bare name and each assignment with
    its `var`. The syntax tree, printed without comments, must equal the original's. A moved member that only writes
    `ST.x` writes a property, so the rule against "a member that assigns a shell variable" no longer stops it.
    **Suites that stand in for a variable by text** (`test_saverlayers.js` lines 174 to 206 evaluate saver text with
    `var coverT = null, coveredPage = null ...`, and pin `enCtl = X.create(...)` and `insertBefore(enCtl.el`) are
    listed by the tool. B9's rewrite commit updates them to read the same values through the object, and their
    output must still match the baseline. These are the only jsc edits Part B allows. The commit names them.
  - **The test rules for shells**, in `tests/test_web_sources.py`, widened only where a new kind of shell needs it:
    - `test_the_register_calls_stay_in_the_shell` asserts `tags_of(shell)` is non-empty. That fails for a shell that
      registers nothing (`hk-base`, `hk-sky`, the Settings files, `hk-sidepane`) or whose tags `DEFINES` doesn't
      match (`hk-strategy`'s `ll-strategy-*`). The rule becomes "a shell's tags equal its file's tags before the split".
    - The ban on `customElements.define` and `.register(` in parts becomes a ban on *calls at a part's top level*, so
      `hk-base`'s `register()` helper can live in a part.
    - `SHELL_LINES` loses the saver's 4,600-line exception at E.
- **A3, `tools/split_py.py`**, the Python twin of `split_js.py`, from a manifest of top-level names per submodule.
  - A module becomes a package, `__init__.py` imports every public and private name back, and the submodules import from
    each other by name.
  - **Proof:**
    - each moved definition's `ast.dump` is identical;
    - the package's set of names equals the old module's;
    - every name `is` the same object when read through the package or its submodule;
    - no import cycle at import time (each submodule imports only earlier ones, checked by importing each alone);
    - `mypy` at its baseline.
  - A name a test monkeypatches stays in the module whose code reads it. The tool reads `monkeypatch.setattr(M, ...)`
    from the tests and refuses a manifest that separates a patched name from its readers. A patch through a variable
    (`test_music.py` lines 45 to 47 patch six constants in a loop) counts as patching **every** upper-case name of the
    module, which is the cautious reading.
  - **What the package needs that a move doesn't give it:**
    - `__init__.py` imports each name explicitly (no `*`), listing them in `__all__`, so ruff's F401 and F403 stay at
      baseline. Private names are imported too, because `hk_frontend/settings.py` lines 25 to 30 import `_BIRTHDAY` and
      others.
    - A relative import inside a moved function (`model.py` line 1774's `from .saver_designs import`, and the
      mid-file import at line 1727) gains one dot. The proof compares the syntax tree with each relative import's level
      taken from where it now sits, so this one change is expected and nothing else is.
    - `tools/typecheck/mypy_baseline.json` is keyed by file (`model.py` carries 26 errors). The slice moves each error
      count to the submodule that now has the error. The rule is the same total and no file above what it carried.
- **A4, `tools/rewrap.py`**, which breaks lines over 200 characters:
  - **JS:** it breaks only between tokens, never inside a template literal or a regular expression, never where JavaScript
    inserts a semicolon (after `return`, `throw`, `break`, `continue`, `yield`, before a postfix `++`/`--`, before `=>`).
    A long string literal is split at a CSS rule boundary (after `;` or `}`) or a space, into `'...' +` and `'...'`,
    only where its parent is an argument, an array element, an initializer, a property value, a `return` or a `+`
    chain; never the object of a `.` or a call.
  - **Python:** it breaks inside brackets and splits strings into adjacent literals, which Python folds back into one
    constant at parse time.
  - **Comments** reflow at the same indent.
  - **Proof.** JS: the TypeScript AST printed without comments, after folding adjacent string-literal `+` chains, is
    identical before and after. Python: `ast.dump` is identical. `--check` proves without writing. A line the tool can't
    break safely is left alone and reported. An agent breaks it by hand, and the same proof judges the result.
  - **What can't be broken without changing a value.** About 110 lines overflow *inside* a template literal, a regular
    expression or a Python multi-line string: about 61 in JS, and about 50 of the 104 Python lines, which are JavaScript
    embedded in tests. A newline there changes the string. These lines go in
    `tests/fixtures/line_width_exceptions.json`, each with its file, a hash of its text and its reason. Like the
    other fixtures, the list can only shrink (decision 4). An agent first tries to rebuild such a value from
    concatenated pieces when the context allows it, with the same proof. A line carrying `@ts-expect-error`, and the
    line after it, is never split.
- **A6, `tools/headless/shots_compare.py`** (built in P, before the baselines): two folders of PNGs compared pixel for
  pixel with PIL. It takes a list of volatile shots to judge by DOM instead, and a tolerance as the sweep's
  `--tolerance` does. It prints the shots that differ and writes a diff image of each.
- **A5, the code map.** `tools/code_map.py` writes `docs/development/Code-map.md` from the manifests and each file's
  header comment: one line per file, what lives there, and for a shell, its parts and what each holds. A test keeps it
  fresh. It is the "where do I change X" page for every later session, and the main thing that makes the next feature
  easier.

### Part B: the splits

**The method is phase 18's** (`docs/phase18/CODE-HEALTH.md`, "Part B"), unchanged:

- parts are real files in a folder beside the shell, never under `cards/`, because both hosts treat every
  `cards/*.js` as a card;
- the `register(...)` calls stay in the shell, where `hk_cards.tags_of` finds them;
- the one generated loader fetches the parts in parallel and retries the way WEB-11 does;
- `split_files.js` and `tests/web_sources.py` show the jsc suites and the main suite the shell and its parts as one file;
- every part opts in to `// @ts-check` with zero errors where phase 18's parts could, and the ratchet never rises.

**Targets.** Each part about 1,500 lines or less, and a shell under 1,000 where the file allows. **No file over 2,000
lines when the phase ends**, which leaves every file 300 lines below the warning and 500 below the wall. Parts are cut
**by feature** (a card family, a settings page, a sheet), plus at most one helpers part and one CSS part per shell. The
manifest names each part for what it is (`hk-energy-power.js`), so `Code-map.md` reads like a table of contents.

**The order** puts the easy, provable splits first, so most files land early. The hard ones come later and are
isolated, so one failing doesn't block the others.

| Batch | Files | What is new |
|---|---|---|
| B1 | `hk-energy`, `hk-cameras`, `hk-calendar`, `hk-home`, `hk-headers` | nothing: lazy cards, whole classes, as `hk-grid-cards` |
| B2 | `hk-layout`, `hk-tile`, `hk-chip` | core cards: readiness; `hk-chip` needs A2's fix |
| B3 | `hk-weather`, `hk-menu`, `hk-sidepane` | `hk-weather` needs `iife` + `run_in_decl` |
| B4 | `hk-strategy`, `hk-settings-model`, `hk-settings-features`, `modules/hk-settings` | read at load: readiness; the Settings sweep is a gate; features uses `live` |
| B5 | `hk-detail` | re-split with `adopt` (its `SHEETS` become generated parts) |
| B6 | `hk-grid-editor` | class-method mode + `VIEW` as state; after decision 1 |
| B7 | `hk-sky` | the biggest file, but no reassigned name crosses a group |
| B8 | `hk-base` | the critical path (below) |
| B9 | `hk-saver` | the state rewrite (below) |
| B10 | `hk_core/settings/model.py` | A3 |
| B11 | `mantel_server/music.py` | A3, monkeypatch-aware |

**`hk-base.js` is on every page's critical path.** Every card waits for `hk-cards-ready`. Today `window.hkCards` is
filled in the same turn the file runs. After the split, it is filled when the parts arrive. So:

- **(i)** the shell creates `window.hkCards` only when the parts have run. The double-import guard becomes its own
  flag, so no reader ever sees a half-filled object. Before the split, a grep lists every reader of `window.hkCards`
  that doesn't wait for `hk-cards-ready` or check `HkBase`.
- **(ii)** `web/home.html` preloads the parts (`modulepreload`, as it preloads the eight bootstrap modules;
  `tests/test_home_preload.py` updated), so Mantel fetches them alongside the shell.
- **(iii)** the gate is the first-load numbers. If first draw moves by more than 50 ms with the preloads, the parts
  needed for first draw (the design table, scales, builders, `HkBase`) stay in the shell, and only the rest moves
  (decision 6).
- Home Assistant loads `hk-base.js` as a Lovelace resource with no preload. One parallel round trip more there, as with
  phase 18's splits.

**The saver** is where phase 18 stopped. B9:

1. Uses A2's state rewrite to put the reassigned names of the 4,302-line group on one object, whose name the tool
   chooses. The list comes from `--report`: about 134 names that are truly reassigned, once the 151 take-backs are left
   out. The proof is the backwards rewrite. The same commit carries the jsc stand-ins A2 lists.
2. Lands that rewrite **alone**, after the saver's browser checks (`saver-faces-check`, `saver_shows_check`'s 8
   shards, `saver-editor-check`, `holiday-scenes-check`, `timer-slide-check`), the gallery's saver shots and the house
   twin's screensaver screens all pass.
3. Then **re-splits** (A2) by feature: switch and idle, input, start/stop, the mosaic, the forecast, the slide corner,
   the layout, the clocks, home energy, weather and holidays, additional screens, the dashboard's pane, HK's own black,
   the loop. Each section is a part of about 150 to 550 lines, as phase 18's measurements list them.

The building session does this itself (Opus). An Opus agent reviews it (decision 5).

**`hk-grid-editor.js`**: class-method mode, as `hk-settings.js` used. `VIEW` (the one reassigned name) goes on a
state object first, then the methods move by panel. The Show When panel becomes its own part, and the lines the ten-rule
change joined are unjoined there.

**Python.** `model.py` becomes `hk_core/settings/model/` with `__init__.py` and one submodule per banner:

- Pages screen, screensaver, side pane, dashboards, pop-ups, custom pages, chips, wall tablets, what is stored, and text
  fields;
- the first 1,400 lines (schema, defaults and checks) become `schema.py` and `checks.py`.

Two jsc suites read `model.py` as text (`test_strategy_rebuild.js`, `test_wallpapers.js`). They read the package's files
through a small reader in the suite's prelude, as `split_files.js` does. HK Frontend's build vendors all of `hk_core`, so
the package goes with it, and `build_ha.py` plus HK Frontend's Python suite prove it. Mantel Link vendors only
`hk_core/link` and `hk_core/talk`, so it isn't touched. `music.py` moves only the parts no patched constant reaches
(A3's check).

### Part C: the width

After the splits and the sharing, so every line that moves is wrapped once and in its final place:

- `rewrap.py` folder by folder: `web/hk/` per subfolder, `web/` (the rest), `hosts/`, `hk_core/`, `tools/`, `tests/`;
- one commit per folder, each with `--check`'s proof, the main suite and the jsc suites.

A test that pins source text (several read the JS as text) may fail because a line it reads was split. The tool first
tries a different break point. Only if no break avoids the pinned text is the pin changed, and only to read the same
value: the commit names each such test.

### Part D: what can be shared

Only **exact** copies, proved identical by the duplicate finder before the move:

- **JS:**
  - `drawNoMusic` and `musicMissing` (hk-library, hk-media, hk-music), onto the card base `C`;
  - `motionOn`, `anyCard`, `fillSlots`, `rect` (the edit modules), into one edit helper;
  - `cfgId` (hk-menu, hk-tabbar), `mmss`, `fahr`, `ringed`, `wakeAll`, and `process` (hk-mic-tap and hk-pcm-tap: the
    audio worklets, so only if the two stay separate files with one shared source the build copies into both);
  - and the rest of the 45 groups where the copies live in files that already share a module.
  - **`whenBase` and `whenDetail`** (26 copies, 23 distinct texts) can't be imported: each card file waits with its
    own copy because Home Assistant loads card files in any order. The copies differ in what they hand on
    (`fn(window.hkCards)` in `hk-energy.js`, `fn(window.hkCards.HkBase)` in `hk-chip.js`) and in their console
    labels. Making them one text would edit about 20 callers, so it isn't an exact copy and is **not** done
    overnight. It goes in the report.
- **Python, into `hk_core`** (Rule 2: "hk_core owns feature decisions"), each with both hosts' suites green:
  - the 93 identical lines between HK Frontend's `kinds.py` and Mantel's `hidden.py`;
  - the 57 between the two `accessories.py`;
  - the 99 between HK Frontend's `linked_mode.py` and Mantel Link's `entity.py` (into `hk_core/link/`, which both
    vendor);
  - the 24 in the two pairing modules;
  - the 15 in the two TV stream modules.
- **The rest is a report**, `docs/phase24/SHARED-REPORT.md`: the same-name functions with different code (with their
  diffs), the modules that say "ported line for line" with what has drifted, and a recommendation for each. They are
  the owner's decision for later, because each one changes behavior somewhere.

### Part E: hard rules

When B, C and D are done:

- the size and width fixtures empty, and the ratchet tests become plain rules (no list). The one list left is
  `line_width_exceptions.json`, the lines A4 proved can't be broken without changing a value. Each entry has its
  reason, and it can only shrink;
- a new file or line over the limit fails the main suite (`ci.py quick`, the pre-push run). The git hooks are not
  changed: every worktree and session shares them;
- `ci.py quick` names any file in the warning band;
- **Rule 8, "Files stay small and lines stay short"** in `docs/development/Rules.md`;
- `Building-and-Testing.md` (how to split: `split_js.py --report`, a manifest, the gates);
- `CONTRIBUTING.md`, Architecture ("How a big web file is cut");
- `Code-map.md`;
- one "Internal" line in each changelog's Unreleased.

### Part F: the last proof

- `ci.py full --all`, once, on the final tree;
- the by-hand motion checks (`swipe-motion-check` at 4 sizes, `pre-glass-motion-check`), because `hk-sidepane` and the
  pager moved;
- the gallery, house twin, Settings sweep and `sheet_review.py` against the preflight baselines;
- the first-load numbers for Home, Settings and a saver screen;
- `tsc` and `mypy` baselines no higher;
- the HK Frontend and Mantel Link builds;
- **a morning report** at the end of the Build log, also sent as a file: what landed, what was dropped and why, the
  numbers before and after, and anything that needs the owner.

## How it's built (models, agents, gates)

- **The building session runs Opus 5.5 at High effort** (the owner, 2026-11-10; earlier phases ran at Medium). It
  writes the A tools, runs every gate, lands every slice, and does B9 (the saver) and B8 (`hk-base`) itself. High
  because no one is there to catch a wrong call: the tools' proofs, the saver's rewrite and every unforeseen choice are
  its own judgment. The cost is small, because most of the run is browser checks, not thinking.
- **Agents run Sonnet 5.5 at High effort**, in worktrees branched from `origin/main` (push first; memory: worktree
  agents branch from origin), **at most three at once**:
  - they draft a manifest from `--report` and the file's banners, run the tool, the jsc suites and `ci.py quick`, and
    hand back a branch;
  - A4's hand breaks;
  - Part D's moves;
  - the docs.
- **Opus 5.5 for an agent only for two reviews**, both because a mistake there is silent until a tablet shows it:
  the B9 state rewrite (about 134 names whose meaning is "the same object everywhere"), and the readiness change: A2's
  loader promise and every importer that awaits it, reviewed with B8's critical-path change (the `window.hkCards`
  timing).
- **A review agent** (Sonnet, High) reads every other slice's diff before it lands: shell edits, manifests, anything
  not produced by a tool.
- **Gates are serial.** Browser checks fail under load (phase 18's build log). Agents author in parallel. The building
  session runs one slice's gates at a time, on local disk at the default `CI_JOBS`.

### Each slice's gate, in order (all recorded in the Build log)

1. The tool's own proof (`split_js.py <name>` / `--check`, `split_py.py`, `rewrap.py --check`) and
   `split_js.py --all --check`.
2. `tsc` (parts at zero errors, baseline not higher) and, for Python, `mypy`.
3. **The jsc suites' output identical** to the baseline (text diff, not just counts).
4. `tools/ci.py quick` (main suite, types, private words).
5. **The gallery** pixel-identical (volatile shots by DOM) and **the house twin's screens identical**, for every
   slice that touches `web/`.
6. The file's own browser checks, from this table:

   | Slice | Checks |
   |---|---|
   Names with dashes are `ci.py` steps (`--only`); names with underscores are `tools/headless/<name>.py`, run directly.

   | Slice | Checks |
   |---|---|
   | energy, weather, headers | `house-status-check-*`, `alert-check-*`, `pager-edges-check` |
   | cameras | `cameras_face_check`, `media-card-check-*` |
   | layout, home, tile, chip | `headless-grid_blocks_check`, `block_taps_check`, `grid-edit-check-*`, `edit-mode-check-*`, `side-strip-check` |
   | calendar | `timeline_check` |
   | strategy, Settings files | the Settings sweep, `headless-settings_viewports`, `headless-admin_page_check`, `looks-check`, `headless-client_smoke` |
   | detail | `sheet_review.py`, `media-card-check-*`, `music_page_check`, `now_playing_page_check`, `custom-sheet-check-*` |
   | sidepane, menu | `side_pane_check`, `page-swipe-check-*`, `pages_screen_check` |
   | grid-editor | `grid-edit-check-*`, `grid_editor_smoke`, `custom-sheet-check-*`, the grid editor jsc suite's ten-rule step |
   | sky | `looks-check`, `holiday-scenes-check-*`, `motion_themes_check`, the gallery's sky shots |
   | base | everything in `ci.py full` (it is under everything) |
   | saver | `saver-faces-check`, `saver_shows_check` (12 shards), `saver-editor-check`, `saver_designs_check`, `timer-slide-check-*` |
   | Python | HK Frontend's Python suite, `ha-build`, `types-py`, the MCP and settings tests |

   **For every shell read at load (B2, B4, B8), also the no-wait check** (new, `tools/headless/split_race_check.py`).
   It loads Home, Settings and a saver screen in WebKit and Chromium *without* waiting for `__hkSplitDone`, with parts
   delayed by 300 ms through a request hook. It passes only with no console errors, no `undefined` read off a shell's
   global, and the first draw complete. A control with readiness switched off must fail it.
7. First-load numbers within 50 ms of the baseline (Home, plus Settings or a saver screen when the slice is theirs).
8. The review agent's findings fixed or answered.
9. Fetch and merge `origin/main` (`git merge --no-autostash -s ort`).
   - If the file changed, **re-run the tool** on the new tree and repeat 1 to 6. Nothing is merged by hand.
   - Then `check_private.py`, and push.

**A slice that fails.** Its cause is either in the slice (a manifest, a shell edit) or not. In the slice: two attempts.
Still red: `git reset` to before the slice, the file stays held by the ratchet, and the Build log says what failed, with
the output. Then the next slice. A failure that also happens on the parent (a flaky check) is re-run alone. If it
passes alone, it is noted and the slice lands (phase 18 did this for `test_photos` and `settings_viewports`).

### Rules for the building session

- **Never stop for a question.** Every decision is below with its answer. Something not foreseen: take the safest
  choice consistent with them, write it in the Build log (what, why, what else was possible), and continue.
- **The Build log is the memory.** After every slice, append its result to this page's Build log and commit it with the
  slice. After any compaction or restart, read the Build log first and continue from the first slice not marked
  landed or dropped.
- Commit messages say what moved and how to find it (`split_js.py --find <name>`), with no "phase 24" shorthand alone.
- **No release, no house.** Reads from the house for the twin (`house_twin.py pull`) are allowed. Nothing is written
  there.
- American English everywhere (memory). Grep the diff before each commit.

## Slices

| Slice | What | Size | Needs |
|---|---|---|---|
| P | Preflight: plan pushed, keep-awake, worktree and its set-up, ports, decision 1, branch list, A6, baselines (twice) | M | |
| A1 | Warning band, JS outside `web/` in the size rule, width ratchet + fixture | S | P |
| A2 | `split_js.py`: `run_in_decl`, `iife`, the `valueOf` fix, `--report` (take-backs left out), re-split and `adopt`, readiness (template, the four loaders regenerated, every importer awaits), state rewrite + its proof, the widened shell rules; `split_race_check.py` | L | P |
| A3 | `tools/split_py.py` + tests | M | P |
| A4 | `tools/rewrap.py` (JS and Python) + tests; `--check` over the tree reports what it can't break | M | P (an agent, beside A2) |
| A5 | `tools/code_map.py`, `Code-map.md`, its freshness test | S | A2 |
| A6 | `tools/headless/shots_compare.py` (in P, before the baselines) | S | |
| B1-B5 | 16 JS files, batched as above; up to three agents author, gates serial | L | A2 (re-split, readiness, the no-wait check) |
| B6 | `hk-grid-editor.js` | M | A2, decision 1 |
| B7 | `hk-sky.js` | M | A2 |
| B8 | `hk-base.js` (preloads, `window.hkCards` timing, Opus review) | M-L | A2 |
| B9 | `hk-saver.js`: rewrite lands alone, then the moves (Opus review) | L | A2 |
| B10 | `model.py` → package | M | A3 |
| B11 | `music.py` | S-M | A3 |
| D | Exact copies shared; `SHARED-REPORT.md` | M | B |
| C | `rewrap.py` folder by folder | M | A4, B, D |
| E | Fixtures emptied, Rule 8, docs, changelogs | S | C |
| F | `ci.py full --all`, motion checks, every baseline, morning report | M | E |

S about an hour, M a few hours, L most of a day. With agents authoring B1-B5 in parallel, the critical path is P, A2,
B (gated serially, about 8 to 10 hours), D, C, E, F.

## Tests (new or changed)

- `tests/test_file_sizes.py`: the warning band; JS outside `web/`; at E, no list.
- `tests/test_line_widths.py` (new): the width ratchet; at E, no list.
- `tests/test_web_sources.py`: A2's modes on synthetic files (`run_in_decl`, `iife`, a `valueOf` member, the state
  rewrite and each of its refusals, the backwards proof catching a planted mistake); every new shell's `PARTS` equals
  its folder; the loader copies match the template; the readiness promise in every loader; the widened shell rules (tags equal before and after, no top-level define in a part).
- `tests/test_split_py.py` (new): the proofs on a synthetic module, the monkeypatch refusal, the import-cycle check.
- `tests/test_rewrap.py` (new): each forbidden break (ASI positions, templates, regexps, `.` on a string) refused; a
  planted bad split caught by the proof.
- `tests/test_code_map.py` (new): `Code-map.md` is fresh.
- `tests/test_home_preload.py`: the preload list now includes `hk-base`'s parts.
- The jsc suites unchanged except the two `model.py` readers (B10) and any pin C must move (named in its commit).

## Definition of done

- **No JavaScript file over 2,000 lines and no Python file over 2,000**, and `test_file_sizes.py` has no list. The
  only exception is a file whose slice was dropped. It is named in the morning report with why, and it stays held at
  its size.
- **No line over 200 characters** in any hand-written `.js`, `.cjs` or `.py`; `test_line_widths.py` has no list,
  apart from `line_width_exceptions.json`: only lines A4 proved can't break without changing a value, each with its reason.
- Every exact copy in Part D's list shared, or reported with why not; `SHARED-REPORT.md` written.
- The jsc suites' output, the gallery, the house twin's screens, the Settings sweep and `sheet_review.py` identical to
  the preflight baselines, apart from volatile items. Every browser check and the motion checks pass. First load within
  50 ms on Home, Settings and the saver.
- `tsc` and `mypy` no higher than their baselines; every new part `// @ts-check` clean where phase 18's parts were.
- Rule 8, `Code-map.md`, Building-and-Testing, Architecture and CONTRIBUTING say what is true. The Build log ends with
  the morning report.
- Nothing released.

## What could surprise us, and what the run does

| What | Why it could happen | What the run does |
|---|---|---|
| The Mac sleeps or the share drops | it's overnight | keep-awake; local-disk worktree; push from there |
| Another session edits a file mid-split | 367 commits in the last 3 days on main | re-run the tool on the new tree (step 9); never merge by hand |
| The house runs code main doesn't have | a hotfix built from a branch | P step 2's check; the `--find` port list in the Build log |
| A text-pinning test breaks on a moved or wrapped line | ~190 files read `hk-base.js` by name | `split_files.js` already shows shells whole; C picks another break before touching a pin |
| A card shows before `hk-base`'s parts arrive | `window.hkCards` filled later | (i): the object appears only when complete; the readers listed first |
| First draw gets slower | parts are fetched at run time | preloads; 50 ms gate; decision 6's fallback |
| The saver's rewrite changes meaning | about 134 shared names | proof by backwards rewrite; lands alone behind every saver check; Opus review |
| Browser checks flake under load | phase 18 saw it | gates serial; a failure that also fails on the parent is re-run alone |
| A gallery or twin shot varies by itself | clocks, animations | baselines taken twice; volatile items compared by DOM |
| The session's context fills up | a long run | the Build log is the state; resume from it |
| A slice can't be made green | anything unforeseen | two tries, then dropped and logged; main stays green |
| The night isn't long enough | 14 to 18 hours | order lands most files first; whatever has landed is whole |
| A page uses a shell's global before its parts arrive | 8 shells are read at load or are core cards | readiness promise awaited by every importer; the no-wait check with parts delayed 300 ms |
| An agent commits a manifest without its split | a manifest alone makes `web_sources` raise | agents hand back a branch with manifest and split in one commit; the building session lands nothing else |

## Decisions for the owner

**Decided 2026-11-10:** the owner accepted every recommendation below: 2 "Every file", 3 to 5 "Yes", 6 "Split it", 7
and 8 "Ok", 9 "Agreed", 10 "I'll start before I go to bed." The owner starts the building session.

| # | Question | Recommendation |
|---|---|---|
| 1 | `speaker-picker` was on the house but not on main, and it edits files this phase splits. Merge it into main before the run? | **Decided 2026-11-10 by the owner: yes** ("it's a valid change"). Merged and pushed the same day as `cb118148`, beside the TV block's picker, as the house build has it |
| 2 | Which files: only the 12 over the wall, or **every file over 2,000 lines** (20 JS + 2 Python)? | **Every file over 2,000.** Otherwise five hot files (`hk-settings.js` 55 commits, `hk-chip` 31, `hk-tile` 30...) start the next week within 300 lines of the warning |
| 3 | Limits: walls stay 2,500 JS / 2,200 Python; warning at 2,300 / 2,000; parts aimed at ≤1,500; nothing over 2,000 at the end? | **Yes.** |
| 4 | Width 200 for **every** hand-written `.js`, `.cjs`, `.py` (web, hosts, `hk_core`, tools, tests), not just `web/`? | **Yes, with one named list:** the ~110 lines that overflow inside a template, regex or multi-line string, where a newline would change the value, kept with their reason in `line_width_exceptions.json`, which can only shrink. 1,899 lines in all, almost all done by the tool |
| 5 | The saver: allow the state rewrite (phase 18 decision 13 said no: "not a move")? | **Yes.** It is mechanical, proved by running it backwards, lands alone behind every saver check, and the building session does it with an Opus review. Without it the saver stays at 4,465 lines |
| 6 | `hk-base.js` on the critical path: split with preloads, and if first draw slows more than 50 ms, keep the first-draw sections in the shell? | **Yes.** |
| 7 | Sharing: only exact copies tonight; drifted copies go into a report for you? | **Yes.** Merging a drifted copy picks one behavior over another, and that's yours to choose, not something to decide overnight |
| 8 | A slice that can't be made green in two tries: drop it, log it, keep going? | **Yes.** `main` stays green; the morning report lists it |
| 9 | Release when done? | **No release in the run.** Read the morning report, then one normal release (Mantel and HK Frontend; Mantel Link too if Part D touched `hk_core/link`), tagged as usual |
| 10 | Start time and other sessions | **Start in the evening with no other session running** (main is quietest midnight to 6 am), and let it run into the morning. Sessions started while it runs merge `origin/main` before every push, as they already do |

## Sources

- `docs/phase18/CODE-HEALTH.md` (Part B, its Build log B1-B4, decisions 5, 6, 12, 13); `docs/development/Rules.md`;
  `docs/development/Architecture.md` ("hk_core and the House port", the boundary rules).
- `tools/split_js.py`, `tools/split_js.cjs`, `tools/split_manifests/*.json`, `tests/test_file_sizes.py`,
  `hosts/ha/custom_components/hk_frontend/tests/split_files.js`, `tests/test_home_preload.py`, `tools/ci.py --list`,
  `tools/headless/` (`gallery.py`, `house_twin.py`, `settings_sweep.py`, `home_numbers.py`, `sheet_review.py`),
  `hosts/ha/custom_components/mantel/tools/publish/publish.py` (what Mantel Link vendors).
- Measured for this plan (scripts in the planning session's scratchpad):
  - every file's lines and lines over 120, 160 and 200 characters;
  - each long JS line's cause (comment, string, template, regex or code), from the TypeScript AST;
  - each big file's top-level statements, reassigned names and groups, from `split_js.cjs analyze` (with
    `hk-base.js`'s `initialize` and `hk-weather.js`'s `boot` unwrapped in a copy);
  - exact function copies across files (JS: TS printer without comments; Python: `ast.dump` without docstrings);
  - copied 6-line windows;
  - commits per file since 2026-10-20;
  - open branches' files against `origin/main`.

**Not measured while planning:** how long each gate takes on this Mac (phase 18's numbers are the guide); whether the
house twin renders deterministically (preflight finds out); first-load cost of `hk-base`'s parts (B8 measures it).

## Build log

The building session (Opus 5.5, started 2026-11-10 at 22:00 after the Security card and HomeView session ended).
State is here: after a restart, continue from the first slice not marked **landed** or **dropped**.

### Backup (2026-11-10)

Before anything changed: `~/Backups/mantel-pre-phase24-2026-11-10/` holds `mantel-all-refs.bundle` (`git bundle --all`:
every branch, tag and the stash; cloned back to prove it restores) and `mantel-checkout.tgz` (the whole checkout without
`.claude/worktrees` and `node_modules`, ignored files included). The bundle is copied to `/Volumes/data/Back Up/`. A local
tag `pre-phase24-2026-11-10` marks `bb278308` (not pushed).

### P: preflight (2026-11-10) — landed

- Worktree `/private/tmp/mantel-p24` (branch `phase24`) from `origin/main` `bb278308`; TypeScript installed
  (`check.py --install`), `tools/node_modules` linked, Mantel's venv, `PLAYWRIGHT_PATH` and `NODE` set. 229 GB free.
- **Ports:** 9337 is held by Google Chrome (another app's DevTools); the checks this run needs take free ports
  (`cdp.free_port`) except the six fixed ones, and none of those is in use. No other session is running.
- **The house runs main:** `ghcr.io/jazzphone/mantel-server:0.1.162-main.bb278308f`, this run's own parent. Nothing
  the house runs is missing from main. The two hotfix branches with commits not on main (`hotfix-laundry-2`,
  `hotfix-tv-speaker`) were the builds of earlier house hotfixes; main has since been deployed over them.
- **Open branches** touching a file in the table: none.
- **A6, `tools/headless/shots_compare.py`:** two folders of PNGs compared pixel for pixel, volatile shots judged by a DOM
  file beside them (or reported as not compared, never as passing), a diff picture of each shot that differs.
- **`tools/headless/first_load.py`** (new; not in the plan): `home_numbers.py` measures a running server signed in with a
  measuring cookie, which this run can't hold steady overnight. This one starts the gallery's test server (fictional house,
  commands off) and loads Home Grid, Home, Settings and a screensaver preview cold, five times each in Chromium and
  WebKit: navigation start to the first draw (`rendered`, or the Settings panel ready, or `window.hkSaver`), to every
  started shell's parts having run (`__hkSplitDone`), and the requests until then. Gate 7 compares its medians.
- **Baselines** are taken from a second worktree at the parent (`/private/tmp/mantel-p24-basetree`), twice, into
  `/private/tmp/mantel-p24-base/b1` and `b2`, by one script (`/private/tmp/mantel-p24-base/gates.py take|compare`): the
  jsc suites' output, the main suite, `tsc`/`mypy`, the gallery, the house twin (all 14 screens in WebKit and Chromium,
  the six Home Grid screens `--busy` in both and `--sheets` in WebKit), `sheet_review.py`, the first-load numbers, and the
  Settings sweep (`--save --repeat`). The house twin's data was pulled once (`house_twin.py pull`, 14 screens, 4,565
  states) and copied to `/private/tmp/mantel-p24-base/twin-cache`; every render uses that copy, so the parent and each
  change draw the same states.

### A1: the rules as ratchets — landed

- `tests/hand_written.py` (new): which files the rules cover. Every `.js`, `.cjs` and `.py` in the repository except
  installed packages, build output, `web/hk/vendor/` and the generated files named in it (so far
  `hk_frontend/tools/sf_symbols/names.py`).
- `tests/test_file_sizes.py` now counts JavaScript outside `web/` (none is over) and has the warning band (2,300 / 2,000):
  `near()`, `--warn`, and `tools/ci.py`'s table names those files under "Near the size limit". It never fails a run.
  Today's band: `hk-headers.js` 2,496, `hk-home.js` 2,500, `hk-sidepane.js` 2,484, `hk-grid-editor.js` 2,500, `music.py`
  2,125.
- `tests/test_line_widths.py` (new) and `tests/fixtures/line_widths.json`: **1,914 lines over 200 characters in 276
  files** today. A count only falls; an unlisted file may have none. `tests/fixtures/line_width_exceptions.json` (empty
  for now) will hold the lines A4 proves can't be broken, each by its file, a hash of its text and why; it only shrinks.

### A2, first stage — landed

**The order changed (the session's call):** A2 is built in three stages, so the batches that need nothing new land first.
Stage 1 (this one) is what B1, B3 and B7 need. Stage 2 is readiness and `split_race_check.py` (B2, B4, B8). Stage 3 is
re-split, `adopt` and the state rewrite (B5, B9). The other order was the plan's: all of A2 before any split.

- `"iife": k` picks the file's k-th IIFE (0-based); `"run_in_decl": "initialize"` makes a function declared in the IIFE
  the scope (its body is not walked as part of the declaration); the analyzer's name table has no prototype, so a member
  named `valueOf` (`hk-chip.js`) no longer crashes it.
- `--report FILE [--run-in NAME | --run-in-decl NAME] [--iife K] [--json OUT]`: the top-level members grouped by the
  variables they reassign (a writer, and every reader of a reassigned name, join its group). A split shell's take-backs
  and a function's own `var` are not counted. Measured: `hk-energy.js` one group (`animQ`), `hk-chip.js` none, the saver
  one group of 3,795 lines around 250 members (plus 37 small ones), `hk-base.js`'s `initialize` 402 groups, the largest
  `MUSIC`/`hkMusic` (409 lines).
- The shell rules in `tests/test_web_sources.py`: every tag the file had before its split is still the shell's (it may
  gain some: the saver has since added `hk-now-playing-page-card`), so a shell that registered nothing is held to nothing;
  a part may not define an element at its top level (a helper that registers may live in one). Tests for `run_in_decl`
  with a `valueOf` member, `iife`, and `--report`.

### Baselines (2026-11-10, the parent `bb278308`)

- jsc suites green (`-- all suites green --`); main suite **6,862 passed**, 15 skipped; `tsc` at its baseline; `mypy`
  **fails on the parent**: `hk_core/laundry.py` has 2 errors (lines 344-345, from the Laundry change, not this run), so the
  type gate is "no file above the parent's count", not the fixture.
- Gallery: 40 of 46 shots. Six fail on the parent too and are left out (`intercom-picker`, `intercom-sheet-message`,
  `intercom-sheet-review`, `home-grid-speakers`, `home-grid-browse`, `home-grid-starters`: a wait that times out). The
  gallery stops at its first failure, so the gate takes it one shot at a time.
- House twin: 40 screens (14 × 2 engines, the six Home Grid screens `--busy` × 2) and 39 sheets (`--sheets`, WebKit).
- `sheet_review.py`: 39 shots (730 s).
- First load (medians of five; Chromium / WebKit): Home Grid 97 / 163 ms to first draw (parts 238 / 389), Home 82 / 139,
  Settings 111 / 155, the screensaver preview 99 / 107. Five runs agree within about 10 ms.

### A2, second stage (readiness) — committed, gates pending

- The loader template keeps `window.__hkSplitReady[label]`: resolves once the parts have run, rejects when the loader gives
  up (the `then` throwing, or the last try failing). `split_js.py --write-loaders` rewrote the four shells' loaders (the
  saver's shell is 14 lines longer; its size entry follows).
- **Every importer waits for every started shell**, not a shell by name: `web/home.js` `imp()`, `hk-loader.js` (the
  bootstrap modules and `needFile`), the Settings panel's `boot()`, Home Assistant's panel (`importOnce`). By name would
  have needed the label to be the file's name, and two shells will share one (`modules/hk-settings.js`,
  `panels/hk-settings.js`). Waiting for all is a little longer only when another file's parts are still on their way.
  Home Assistant's ordered boot (`boot.py`) imports its last five modules and waits for none of them; nothing there
  changes.
- `tools/headless/split_race_check.py` (with `.cjs`): Home Grid, Home, Settings and a screensaver preview in both
  engines, as they are and with every part held back 300 ms; a delayed load passes with no error the plain load lacks, no
  element undefined that the plain load defined, and the first draw done. **8 of 8 pass. The control (`--no-ready`) also
  passes today**: no file a page reads at load is a shell yet (hk-grid-cards, hk-media, hk-saver and hk-settings are all
  waited for by an element or by `boot()`). The control has to fail once B2 has made a core card a shell; that is part of
  B2's gate.
- Tests: the promise resolves when the parts ran and rejects when they never come (node, the loader's own text, per
  shell); each of the four importers reads `__hkSplitReady`.

### A3: `tools/split_py.py` — committed

Package mode (a module becomes a package whose `__init__.py` imports every name back, in `__all__`) and sibling mode (the
module stays; its parts become `<module>_<part>.py` beside it). Names are found with `symtable`, so a local is never taken
for a module name. Refuses: a later part; a name bound in two parts (`X += ...`, `X[k] = ...`, `X.append(...)` at the top
level bind X); an import-time read with a binder of that name later in the file (`model.py` has `SAVER_SHOWS += (...)`
mid-file); a monkeypatched name apart from its readers (a patch through a variable means every upper-case name). Proof:
each statement's `ast.dump` in its new place (a relative import one level deeper counted), the same names, each the same
object through the package as through its file, imports only to earlier parts. `tests/test_split_py.py`: the split of a
synthetic package that then runs, three refusals, the monkeypatch rule, a planted change caught.

### A5: the code map — committed

`tools/code_map.py` writes `docs/development/Code-map.md` (794 lines: `web/`, `hk_core/`, Mantel Server, the HA
integrations, `tools/`), one line per file from its opening comment, a shell's parts under it with their titles.
`tests/test_code_map.py` fails until it is written again.

### A2, third stage — part committed

- **The state rewrite** (`split_js.py --state FILE --vars ... [--write]`), as the plan specifies it, with its backwards
  proof and its tests. `hk-grid-editor.js`'s `VIEW` rewrites and proves clean (B6 can use it).
- **The saver: refused as specified.** Its 120 reassigned names (from `--report`) include names that locals and parameters
  shadow (`on`, `layer`, `mx`, `force`, ...) and one in a loop header (`cards`). The plan refuses shadowing because the
  backwards proof turns `ST.on` back into `on` by text, so a forward step that wrongly took a shadowed `on` would still
  prove. Allowing it needs a second, independent scope resolver. Left for B9.
- **Re-split and `adopt` are not built yet.** Since phase 18, other sessions have hand-edited the saver shell's generated
  `kit()` and `runParts()` (`panelDone` and `clock24` kit entries; `inPane` wrapped, `designController` made and the Now
  Playing page registered in `runParts`). An "unsplit" can't simply delete those functions; it has to carry that code back.
  `hk-detail.js`'s hand-written kit has a `sheetState` entry of the same kind. **B5 and B9 move to the end of the run.**

### The splits so far (2026-11-10/11) — B1, B2, B3, B4 (three of four), B6, B7, B8, B11 committed; gates below

Every split was made by the tool on this run's tree (an agent's manifest taken alone, the tool re-run here: the
agents' branches had the loader template before readiness). Members moved text for text; `split_js.py --find NAME`
(or `split_py.py --find NAME`) says which file holds one. Line counts are the files after the split.

| File | Before | Shell | Parts |
|---|---|---|---|
| `hk-energy.js` | 4,299 | 433 | 8 in `web/hk/energy/` (largest 824) |
| `hk-cameras.js` | 3,706 | 417 | 5 in `web/hk/cameras/` (the mosaic, one class, 1,632) |
| `hk-calendar.js` | 2,561 | 581 | 6 in `web/hk/calendar/` |
| `hk-home.js` | 2,500 | 306 | 4 in `web/hk/home-cards/` |
| `hk-headers.js` | 2,496 | 647 | 4 in `web/hk/headers/` |
| `hk-tile.js` | 2,048 | 294 | 4 in `web/hk/tile/` |
| `hk-chip.js` | 2,183 | 298 | 4 in `web/hk/chip/` |
| `hk-layout.js` | 2,792 | 332 | 4 in `web/hk/layout/` |
| `hk-weather.js` | 3,694 | 953 | 7 in `web/hk/weather/` (`iife: 2`, `run_in_decl: boot`) |
| `hk-menu.js` | 2,115 | 718 | 2 in `web/hk/menu/` |
| `hk-sidepane.js` | 2,484 | 485 | 4 in `web/hk/sidepane/` |
| `hk-strategy.js` | 3,320 | 429 | 5 in `web/hk/strategy/` |
| `hk-settings-model.js` | 2,869 | 357 | 5 in `web/hk/settings-model/` |
| `hk-settings-features.js` | 2,105 | 216 | 4 in `web/hk/settings-features/` (`live: ["K"]`) |
| `hk-grid-editor.js` | 2,503 | 1,139 | 6 in `web/hk/grid-editor/` (`VIEW` on `ST`; class-method mode) |
| `hk-sky.js` | 7,038 | 1,605 | 9 in `web/hk/sky-parts/` (40 names on `ST`; the largest part 1,444) |
| `hk-base.js` | 4,811 | 1,099 | 10 in `web/hk/base/` (26 names on `ST`; `wait_all`; the largest part 1,789) |
| `music.py` | 2,125 | 1,564 | 4 siblings (`music_names`, `_docs`, `_library`, `_calls`) |

**Dropped, with why:**
- **`modules/hk-settings.js` (2,027 lines) stays one file.** 83 files read `window.hkSettings` the moment they load, and
  its literal names every exported function, whose bodies reach every helper. A part arrives a round trip after the
  shell, so any member moved would be undefined for those readers. It is 27 lines over the 2,000 target and under the
  2,300 warning.
- **B10, `hk_core/settings/model.py` (3,737 lines), stays one module.** Its checks call one another across every
  section, and the defaults are built and mutated in section order (`DEFAULTS["side_pane"] = ...`,
  `SAVER_DEFAULTS.update(...)`). Any order of submodules has an earlier one using a later one (an import cycle), and the
  best order the solver found put 3,243 lines in the first. Splitting it needs late imports inside functions, which is a
  code change, not a move.

**Tool changes found on the way** (each with a test or re-checked over every manifest):
- `--write-loaders`; readiness's resolver in `window.__hkSplitSettle` (a property on the promise was a `tsc` error).
- A kit name that is also a browser global (`CSS`, `valueOf`) is accepted though `tsc` never reports it missing.
- Statements that share a line, if one waits, all wait (a line is cut whole); the state rewrite writes one statement to a
  line.
- A declared scope's last `return x;` stays last, after the loader's call (`hk-weather.js` `boot()`).
- `live` works outside class mode (`hk-settings-features.js`'s `K`).
- **Refused now:** a shell statement that runs at load and reaches a moved member through the shell's functions; a part
  that reads, as it runs, an `ST` property set by a statement that waits, or an object a waiting statement changes
  (`X.y =`, `X.push(`, `Object.assign(X`). `ST.x = value` and `X.y = value` that reach nothing moved stay where they were.
  Every manifest (but the saver's and the settings panel's, from phase 18) re-checked against its original: none trips.
- `wait_all` (`hk-base.js`): every statement of `initialize` that is not a declaration waits, in order, so
  `window.hkCards` is made, filled and announced in one turn.
- `split_py.py`: a statement begins at its own line or the comments right above it; a part may not be named like a
  top-level name; a monkeypatch through a loop variable whose loop lists its names literally counts those names (the
  plan's "every upper-case name" left `music.py` with no movable constant); the import-back and the imports only the
  parts use are marked for ruff.

**Tests that read a file's text** read a shell with its parts (`web_sources.read`, `split_files.js` `cut()`), or load
the parts first; three jsc suites get `window = globalThis` (the loader registers on it); pins on a renamed variable read
`ST.x`. Each pin reads the same code as before.

**`tsc`:** the baseline total is 788 (the parent's 812). Measured one way (each file alone), `hk-chip` went 46 → 38 and
`hk-grid-editor` 15 → 30: properties its moved methods assign are not seen on the shell's class. **mypy** has only the
parent's two `hk_core/laundry.py` errors. **ruff** 518, its baseline.

**The pictures can't be compared pixel for pixel.** Two runs of the parent differ in 25 of 40 gallery shots, 38 of 40
house twin screens and 323 of 324 sheet shots. A countdown, the energy figures and the falling leaves move, and the
gallery draws the real sky for the time of day. `shots_compare.py --noise` (what differs between two parent runs is
noise) still leaves the leaves, which land somewhere new each run. So the picture gate is by eye: side-by-side contact
sheets of every flagged shot. The DOM gates are the browser checks, the Settings sweep and `split_race_check.py`.

### B5 and B9 — dropped

- **B5, `hk-detail.js` (2,896 lines).** `adopt` rebuilds the shell and its hand-split sheets as one file, proven
  faithful (every shell statement in order, all 157 sheet members, nothing else but `sheetState` and `wire()`;
  `/private/tmp/adopt_detail.py`). But each sheet file has its own scope and some declare the same names (`LIST_CSS` in
  two sheets, `v` in the laundry and TV sheets). In one scope the second declaration would replace the first for the
  other sheet's code, so a split of that file would not be a move; making it one needs renaming, a code change.
- **B9, `hk-saver.js` (4,478 lines).** Two things stop it. The state rewrite as specified refuses 120 names, some
  shadowed by locals and parameters (`on`, `layer`, `mx`, `force`) and one in a loop header. And the re-split needs the
  phase 18 split undone, but other sessions have since edited its generated `kit()` and `runParts()` by hand (an
  `inPane` wrapper over the part's `inPane`, the design controller, the Now Playing page's registration, two kit entries
  that are code). Undoing those is a translation with renames, not a move.

### D: what can be shared — landed in the branch

- **Python, into `hk_core`** (an agent; each move proved by `ast.dump` against both originals, every name the same
  object through the host module): `kinds.py`/`hidden.py` (94 lines) -> `hk_core/settings/kind_match.py`; the two
  `accessories.py` (72) -> `hk_core/settings/accessory_fields.py`; Mantel Link's `pairing.py` and the server's
  `linked_pairing.py` (31) -> `hk_core/pairing.py` (Mantel Server may not import `hk_core/link`; Mantel Link's build
  copies it: `CORE_PARTS`); HK Frontend's `stream.py` and Mantel Link's `tv.py` (24) -> `hk_core/link/tv_stream.py`;
  `linked_mode.py`/`entity.py`: only `_RESERVED` (3), because the four entity classes with the same text each extend
  their own file's `LinkedEntity`, and the two differ. Main suite 7,144; Mantel Link's 88; HK Frontend's Python suite 792
  passed and 5 failed both before and after the move, in the agent's scratch build (no esbuild, no theme sources), and
  the release run builds it properly.
- **JavaScript: reported, not moved.** 29 groups, 269 lines of the same text in two or more files. Each copy is
  closed over its own file's names, and the files load on their own, so sharing one means publishing it on a global
  and changing every copy into a reference: a code change with a new load order. `docs/phase24/SHARED-REPORT.md`
  lists them with a recommendation, and the drifted Python copies with their diffs.

### C: the width — landed in the branch

`tools/rewrap.py` folder by folder, each commit proved (every changed file's syntax tree the same): `web/` 1,209 lines,
`tools/` and `tests/` 362, `docs/` 17, `hosts/` and `hk_core/` 269. The tool learned two safe split points on the way: a
string in a branch of `c ? 'a' : 'b'`, and a comma inside a string as a last choice. By hand, proved the same way:
`hk-weather.js`'s mid-array `/* */` comment moved to `//` lines; three Python strings split into adjacent literals;
`server.py`'s long `from . import`. **80 lines** are listed in `tests/fixtures/line_width_exceptions.json`, each with its
reason: inside a template literal, a regular expression or a multi-line string (code embedded in a test). The held
files keep their long lines, since a rewrap would add lines past their limits: `hk-saver.js` 29, `hk-media-now.js` 10
(a phase 18 part of exactly 2,000 lines), `hk-detail.js` 6, `modules/hk-settings.js` 5, `model.py` 3. The jsc suites'
output and the main suite were unchanged after each folder.

### E: the hard rules — landed in the branch

- Rule 8 in `Rules.md`; "Big files and long lines" in `Building-and-Testing.md`; "How a big web file is cut" in
  `Architecture.md`; CONTRIBUTING; the Internal line in Mantel's and HK Frontend's changelogs (Mantel Link's has none:
  its change is a shared file it builds in, nothing it does).
- **The lists can't be empty**, because three slices were dropped. So each test names its held files with why (`HELD`):
  a file not named may never cross a limit, and `--update` can't add one. The size list holds `hk-saver.js`,
  `hk-detail.js` and `model.py`; the width list those, `modules/hk-settings.js` and `hk-media-now.js`.
  `test_web_sources.py`'s `SHELL_LINES` keeps the saver's 4,600.

### The review (Opus, read-only) and what it changed

No defect was found in what shipped: no committed manifest or state rewrite hits any hole it found. It showed the
tool could accept three kinds of wrong split and the state rewrite one, and two readiness behaviors cost time or
recovery. All are fixed, with the review's counter-examples as tests:
- **Readiness waited for every started shell.** `hk-loader` starts the sky's, the screensaver's, the menu's and the Side
  Pane's files during the bootstrap, so Home's first draw also waited for their parts; with a part that keeps failing,
  for the loader's ~30 s of retries. Now each importer waits for the file it imported, by name (every label is its
  file's name: a test).
- **Settings lost its "couldn't load" message** when a part never came (the rejection was swallowed and `F.use(K)`
  threw outside the `try`). `boot()` now waits for its own split modules, unswallowed.
- **The tool:** a direct use inside a callback or an IIFE of a statement that runs at load is refused; a moved or
  waiting member and an at-once statement after it may not both touch an object one of them changes (the state object
  per property); only real mutators count as changes; the state rewrite refuses a name declared twice in its scope.
  Every manifest re-checked: none trips.
- On Home Assistant the strategy element is defined once its parts have run (it was at once). HA waits up to 5 s for a
  strategy; on a slow first fetch `recoverLate()` rebuilds the page. Not changed: noted for the owner.

### F: the last proof (2026-11-11, `239f194f`)

- **The house twin found one regression the other gates missed:** the Side Pane, on a page where no card had loaded the
  calendar, imported `hk-calendar.js` and drew before its parts had run, then showed "Reading the calendars..." for
  minutes (Kitchen, Living Room, Loft, both Bathrooms and the Master Bedroom HomeViews). Fixed (it waits for the file's
  parts), and a test now fails any `import()` of a split file that doesn't wait. Re-rendered: all ten screens with a
  Side Pane show the day's events.
- **Pictures by eye**, the parent rendered minutes before the final tree (`b3`), contact sheets of all 40 gallery shots
  and 40 house twin screens: the same but for the clock, the energy figures and the sky's moving leaves and clouds. The
  sky picks its scenery by the date (a canopy on November 10, none on the 11th: the parent does the same).
- `sheet_review.py`: all 315 sheet-and-size measurements identical to the parent's.
- jsc suites' output identical (169 lines); main suite 7,169 passed; HK Frontend's Python suite 797 passed; Mantel
  Link's package builds and its tests pass (81).
- `ci.py full --all`: 80 passed, 1 failed (`types-py`: the parent's two `hk_core/laundry.py` mypy errors, not this run's).
  Two load flakes in earlier full runs passed alone on the parent and the final tree (`music-pane-check-webkit`,
  `saver-shows-check-3of12`: WebKit's "access control checks" page error).
- `split_race_check.py` (parts held back 300 ms, no waiting for `__hkSplitDone`): 8 of 8 pages pass in both engines,
  and **its control (readiness off) fails**, as it must now that core cards are shells.
- First load (median of five, Chromium / WebKit, ms to first draw): Home Grid 97 → 94 / 163 → 141; Home 82 → 83 /
  139 → 118; Settings 111 → 90 / 155 → 125; screensaver 99 → 93 / 107 → 99. More requests (the parts, in parallel:
  Home Grid 150 → 207), no slower draw anywhere.
- `tsc` baseline 814 → 788; mypy and ruff at the parent's.
- **The by-hand motion checks** on the final tree: `pre-glass-motion-check`, `swipe-motion-check` at WebKit
  1180x820 and Chromium 1280x800 pass. Both 390x844 sizes fail at one step ("a finger 30 ms into a settle: it lands one
  or two pages on /ps-bar/home"), **and so does the parent `bb278308`**, the same step, the same words (WebKit 3 of 3
  runs, Chromium 1 of 1; the final tree WebKit 3 of 3, Chromium 2 of 2). It's older than this run, not one of its
  splits; left for the owner.

### The held files, cut (2026-11-11, afternoon; the owner: "we should do all 4")

The four files the run held (B5, B9, B10 and `modules/hk-settings.js`) are cut, each by a tool that proves it. Three
Sonnet agents in local worktrees (`hk-detail.js`, `model.py`, `hk-settings.js`); the saver by the building session; one
Opus review of all four; the gates one at a time on the merged tree, against baselines taken twice on `016198eb` that
morning. **No file is over its size limit now: `tests/test_file_sizes.py` HELD is empty**; the width list holds only
`hk-media-now.js` (a phase 18 part of exactly 2,000 lines).

- **`hk-saver.js` (B9): 4,477 lines -> a 1,454-line shell and 10 parts in `web/hk/saver/` (the largest 950).** Four proved
  steps, the scripts in `docs/phase24/held/`:
  1. *Rejoined* (`rejoin_saver.py`): the phase 18 shell and its 7 parts as one file. The hand edits since phase 18 are
     carried back, each checked by its exact text (kit()'s `panelDone` and `clock24`, `K.inPane` and the shell's `inPane`,
     runParts' design controller and Now Playing registration, the parts' live `K.x`, `K.PageCard`). Proof: every statement
     in order, 428 cross references each resolving where it did, tsc missing nothing, no name declared twice.
  2. *25 locals renamed* (`shadows.cjs`): the parameters and locals that shadowed a state name (`on` 9 times, `layer` 3,
     ...). Proof: every identifier resolves to the same declaration, spelled the same unless renamed.
  3. *136 names on `ST`* (`split_js.py --state`), proved backwards.
  4. *Cut* with the new `bind_ahead`: the saver's features call each other both ways, so a part may use a later part's
     member when it is called (bound once every part has run); what runs while the parts run may not reach one.
- **`hk-detail.js` (B5): 2,895 -> a 735-line shell; its 15 hand-split sheets and 6 new parts are generated parts of
  `web/hk/sheets/` (the largest 767).** First two renames (vacuum's `LIST_CSS` -> `VACUUM_LIST_CSS`, laundry's `v` ->
  `laundryVar`, proved token for token) and one hand edit (`hk-sheet-group.js` took `K.TvPanel` off the kit object).
  Then the new `"adopt": "SHEETS"`: the shell and its sheets as one file, proved (statements in order, members text for
  text, no name meaning another), cut by the ordinary split. `"wait": false` (the review): its users wait for
  `hk-detail-ready` as before, so no page holds its first draw for the sheets.
- **`hk_core/settings/model.py` (B10): 3,737 lines -> a package of 13 modules (the largest 1,152).** The new `split_py`
  `"lazy": true`: the import cycle was only in call-time references, so the 8 functions that call a later module import
  it inside the function (16 imports), proved by the function's syntax tree less those imports; every value built at
  import has the same `repr`. 396 names, each the same object through the package and its file.
- **`modules/hk-settings.js`: 2,026 -> 1,849 lines.** Its 181-line first-paint `DEFAULTS` table is a plain script,
  `modules/hk-settings-defaults.js`, that every loader runs first (`web/home.js`, `web/home.html`'s preload, Mantel's
  Settings page, HK Frontend's `boot.py` core, the jsc prelude, and -- found at the merge -- the Settings panel's two
  imports of it, which on Home Assistant may run before boot.py's core has).

**The tools gained** (each with tests in `tests/test_web_sources.py` / `tests/test_split_py.py`): `bind_ahead`, `adopt`,
`"wait": false`, the state rewrite's loop-condition reads and its called names (`(0, ST.x)()` where the value may read
`this`), split_py's lazy mode, and the loader starting over after it gave up.

**The review (Opus, read-only)** found two defects and three proof holes, all fixed in `cb0e8d33`: the loader stayed
given up after six failed tries (HK Settings' retry of the sheets did nothing until a reload); hk-detail's readiness
could hold a page's first draw for the 21 sheet files; a test pin read the security sheet twice (`--hkd-strip`); and the
holes -- `this` in a called state name, a destructuring shorthand in the rename, a part's class defined over a later
part's name. It checked and found sound: every loader of `hk-settings.js`, the saver's and the sheets' order at load,
the model package's import-time values, the proofs (each re-run from `016198eb`).

**The gates on the merged tree:**
- jsc suites' output identical to `016198eb`'s (169 lines); the main suite passes (its 51 more skips are the new
  tests' and the detail manifest's "run once" cases, reason for reason); tsc 0 errors, mypy and ruff at the parent's
  (the two `hk_core/laundry.py` errors are `016198eb`'s); HK Frontend's Python suite and `split_py`'s proofs pass.
- `sheet_review.py`: all 317 measurement lines identical to the parent's.
- Pictures by eye, the parent and the tree rendered minutes apart (gallery 40, house twin 40): the same but for the
  clock and the live energy figures; the Side Pane calendars show their events.
- Settings sweep (`--compare`, 386 pages, 2 engines x 3 sizes): DOM identical on every page; two screenshots differ,
  the front door lock page (phase 24's known flap) and the backyard camera's picture.
- **First load found a cost the other gates missed:** hk-detail.js's 21 sheet files, now named as its parts, were
  preloaded with the page and held the first draw back 9-13 ms (Home Grid 106 vs 94 ms, Chromium; a quiet machine,
  016198eb measured between). A shell nothing waits for is no longer preloaded (`7ff56228`); after it, the same as the
  parent: Home Grid 94/94, Home 82/83, the screensaver 94-96/93, Settings 89-91/90-91, WebKit within 4 ms.
  (The morning's two baselines were taken while three agents ran their suites, so their load times read 10-25 ms slow:
  load is compared on a quiet machine, alternating trees.)
- `ci.py full --all`: 80 passed, 1 failed (`types-py`: the parent's two `hk_core/laundry.py` mypy errors).
- `split_race_check.py`: 8 of 8 pages pass; its control (readiness off) fails, as it must.
- The by-hand motion checks: `pre-glass-motion-check` and `swipe-motion-check` at all four sizes pass (the phone sizes
  since `016198eb`'s fix).

## Morning report (2026-11-11)

**What landed** (pushed to `main`; nothing released, the house untouched):
- **18 big files cut by the tool into shells and parts**, every move proved text for text: hk-energy, hk-cameras,
  hk-calendar, hk-home, hk-headers, hk-tile, hk-chip, hk-layout, hk-weather, hk-menu, hk-sidepane, hk-strategy,
  hk-settings-model, hk-settings-features, hk-grid-editor, hk-sky, hk-base (web), and `music.py` (Python siblings).
  **Files over 2,000 lines: 22 → 4.** The largest new file is 1,789 lines (`hk-base-card-core.js`).
- **Readiness:** a page waits for a split file's parts before it uses it; the core files' parts download with the page.
- **Three state rewrites** (hk-sky 40 names, hk-base 26, the grid editor's `VIEW`), proved by running them backwards.
- **Width:** 1,914 lines over 200 characters → 53, all in the four held files and `hk-media-now.js`; 80 more are
  listed exceptions that can't break without changing a value (templates, regular expressions, code inside test strings).
- **Shared:** 224 lines of exact copies between the hosts moved into `hk_core` (`kind_match`, `accessory_fields`,
  `pairing`, `link/tv_stream`, `link/linked_reserved`).
- **New tools:** `split_js.py --report/--state/--write-loaders` and its new modes and refusals, `split_py.py`,
  `rewrap.py`, `code_map.py` (`docs/development/Code-map.md`), `shots_compare.py`, `first_load.py`,
  `split_race_check.py`. Rule 8 and the docs say how to use them.

**What was dropped, and why** (each held at its size by a named list; **all four cut the same afternoon**, "The held files, cut" above):
- `hk-saver.js` (4,477): its phase 18 split's generated `kit()`/`runParts()` were edited by hand since; undoing them is
  a translation with renames, not a move. The state rewrite as specified also refuses its shadowed names.
- `hk-detail.js` (2,895): adopting its hand-split sheets merges their scopes, and two names are declared in two sheets.
- `hk_core/settings/model.py` (3,737): its sections call one another; any order of submodules is an import cycle.
- `modules/hk-settings.js` (2,026): 83 files read `window.hkSettings` the moment they load, and everything in it is
  reachable from there; any part would arrive too late. (Under the 2,300 warning; 26 lines over the 2,000 target.)
- The JavaScript exact copies (29 groups, 269 lines): reported in `SHARED-REPORT.md`, not moved (each is closed over its
  own file's names, and sharing needs a load order the files don't have).

**For the owner:**
1. `docs/phase24/SHARED-REPORT.md`: the drifted copies (the real one is `Hiding.snapshot`, where the server filters bad
   ids and HK Frontend doesn't) and the JavaScript copies, each with a recommendation.
2. The release, when you're ready: Mantel, HK Frontend, and Mantel Link (its shared code changed).
3. On Home Assistant, the strategy element and the core cards are defined once their parts have run, a round trip
   later than before (HA has no preloads); worth a look on a slow tablet.
4. ~~The four held files above~~: cut the same afternoon ("The held files, cut"); no file is over its size limit.
5. ~~`swipe-motion-check` at the phone size~~: fixed the same afternoon (`016198eb`), a catch's slow push went back against the finger.
