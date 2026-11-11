"""The big web files cut into parts by tools/split_js.py (phase 18, Part B; docs/phase18/CODE-HEALTH.md).

A shell (web/hk/cards/hk-grid-cards.js, ...) lists its parts in ``PARTS``, fetches them in parallel, runs them in order with a
kit and then registers its elements. These tests pin what makes that safe to leave alone: the list is the folder, the loader is
the one template every shell shares, the ``register(...)`` calls stay in the shell (both hosts find a lazy card file's elements by
reading them: hk_cards.tags_of), every part has the header and registers under its own name, a part that did not come is asked
for again (WEB-11), and the manifest, the shell and the parts still agree (``split_js.py --check``: the kit, ``tsc``).
"""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import web_sources
from mantel_server import hk_cards

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = sorted((ROOT / "tools/split_manifests").glob("*.json"))


def _tool():
    spec = importlib.util.spec_from_file_location("split_js", ROOT / "tools/split_js.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["split_js"] = mod                   # (its dataclasses look their module up here)
    spec.loader.exec_module(mod)
    return mod


def _manifest(path: Path) -> dict:
    man = json.loads(path.read_text())
    man["name"] = path.stem
    return man


# the elements each split card file defines, before and after the split (a card file's tags are read from its register calls)
TAGS = {
    "web/hk/cards/hk-grid-cards.js": (
        "hk-action-card", "hk-everything-card", "hk-grid-accessories-card", "hk-grid-cameras-card", "hk-grid-clock-card",
        "hk-grid-entity-card", "hk-grid-keypad-card", "hk-grid-panel-card", "hk-grid-room-card", "hk-grid-security-card",
        "hk-grid-security-hv-card", "hk-grid-security-key-card", "hk-grid-vacuum-card", "hk-on-now-card", "hk-suggested-scene-card"),
}

pytestmark = pytest.mark.parametrize("path", MANIFESTS, ids=[p.stem for p in MANIFESTS])


def test_a_manifest_exists_for_every_shell_that_has_a_parts_list(path):
    shells = {s.relative_to(ROOT).as_posix() for s in web_sources.shells()}
    detail = "web/hk/cards/hk-detail.js"           # split by hand (5573f9db): its list is SHEETS, no manifest
    assert {_manifest(p)["shell"] for p in MANIFESTS} == shells - {detail}


def test_the_parts_list_is_the_manifest_and_the_folder(path):
    man = _manifest(path)
    shell = ROOT / man["shell"]
    listed = re.findall(r"'([^']+)'", re.search(r"var PARTS = \[([^\]]*)\]", shell.read_text()).group(1))
    assert listed and len(listed) == len(set(listed))
    assert listed == [p["name"] + ".js" for p in man["parts"]]
    folder = ROOT / man["folder"]
    assert sorted(p.name for p in folder.glob("*.js")) == sorted(listed)
    # the members the manifest names are each in one part only
    named = [m for p in man["parts"] for m in p["members"]]
    assert len(named) == len(set(named))


def test_a_shells_parts_are_not_in_a_folder_both_hosts_load_as_cards(path):
    """Both hosts load every file in web/hk/cards/ as a card (server.py api_hk_cards, HK Frontend's resources.py): the parts
    sit beside it, as the detail sheets do."""
    man = _manifest(path)
    assert not man["folder"].startswith("web/hk/cards")
    assert not list((ROOT / "web/hk/cards").glob(f"{Path(man['folder']).name}*"))
    for f in (ROOT / man["folder"]).glob("*.js"):
        assert f.name not in {p.name for p in (ROOT / "web/hk/cards").glob("*.js")}


def test_every_shell_has_the_loader_template_byte_for_byte(path):
    tool = _tool()
    man = _manifest(path)
    text = (ROOT / man["shell"]).read_text()
    start = text.index("  " + tool.LOADER_BEGIN)
    end = text.index(tool.LOADER_END) + len(tool.LOADER_END) + 1
    assert text[start:end] == tool.loader_block(man, "  ")
    assert text.count(tool.LOADER_BEGIN) == 1


def test_the_register_calls_stay_in_the_shell(path, tmp_path):
    """hk_cards.tags_of reads a lazy card file's `register('hk-...'` calls: the shell's tags are what they were before the
    split, and no part defines an element."""
    man = _manifest(path)
    shell = ROOT / man["shell"]
    if man.get("class"):
        # a panel (HK Settings), not a card file: its element is defined by the shell, at once (the host makes one the moment
        # the module is in), with the class and its entry; the parts only add methods to the prototype
        text = shell.read_text()
        assert re.search(r"^  customElements\.define\('hk-settings-panel', %s\);$" % man["class"], text, re.M)
        # (the base may carry a JSDoc cast for the type checker: `extends /** @type {...} */ (HTMLElement)`)
        assert re.search(r"^  class %s extends (?:/\*\* @type \{\w+\} \*/ \()?HTMLElement\)? \{$" % man["class"], text, re.M)
        assert text.index("customElements.define(") < text.index("var partsReady = ")
    else:
        # (phase 24, A2) every tag the file had before the split is still the shell's (it may have gained some since): a
        # shell that registered nothing (hk-base, hk-sky, the Settings files) is held to nothing, and one whose tags
        # DEFINES doesn't list (hk-strategy's ll-strategy-*) to its own
        assert set(_tags_before(man, tmp_path)) <= set(hk_cards.tags_of(shell))
    for f in sorted((ROOT / man["folder"]).glob("*.js")):
        assert hk_cards.tags_of(f) == (), f.name
        # no element is defined at a part's top level: a helper that registers (hk-base's register()) may live in a part,
        # but it is called from the shell
        assert not TOP_LEVEL_DEFINE.search(f.read_text()), f.name


# a call that defines an element, at the top level of a part's function (four spaces in)
TOP_LEVEL_DEFINE = re.compile(r"^    (?:customElements\.define\(|[\w$.]*\.register\()", re.M)


def _tags_before(man: dict, tmp_path: Path) -> tuple:
    """The tags of the shell's file as the split found it (the blob the manifest records), else as listed in TAGS."""
    if man["shell"] in TAGS:
        return TAGS[man["shell"]]
    blob = (man.get("source") or {}).get("blob")
    got = subprocess.run(["git", "cat-file", "blob", blob], capture_output=True, text=True, cwd=ROOT) if blob else None
    if not got or got.returncode:
        pytest.skip("the shell's original is not in this repository")
    f = tmp_path / Path(man["shell"]).name
    f.write_text(got.stdout)
    return hk_cards.tags_of(f)


def test_every_part_has_the_header_and_registers_under_its_own_name(path):
    man = _manifest(path)
    shell = Path(man["shell"]).name
    for part in man["parts"]:
        text = (ROOT / man["folder"] / (part["name"] + ".js")).read_text()
        assert text.startswith(f"// {part['name']}.js - "), part["name"]
        head = re.sub(r"\n// ?", " ", text[:text.index("(function () {")])
        assert f"PART OF {man['what']} ({shell}). Not a card and not run on its own" in head
        kit = man.get("kit_name", "K")
        assert f"takes from {kit} at the top" in head and "it hands back at the bottom" in head
        assert "(function () {\n  'use strict';\n" in text
        assert f"(window.{man['global']} = window.{man['global']} || {{}})['{part['name']}'] = function ({kit}) {{" in text
        assert text.endswith("  };\n})();\n")


# what the split is for (CODE-HEALTH.md "Part B"): no web file above about 2,000 lines, except the saver's shell, which keeps
# the one connected group of shared state (268 statements around 134 reassigned variables: B3 in the
# Build log) -- decision 13 accepts that; the plan's 3,500 is not reachable without rewriting those references.
# tests/test_file_sizes.py holds it from growing
SHELL_LINES = {"saver": 4600}


def test_the_parts_keep_to_the_size_the_split_is_for(path):
    man = _manifest(path)
    for f in (ROOT / man["folder"]).glob("*.js"):
        assert f.read_text().count("\n") <= 2000, f.name
    assert (ROOT / man["shell"]).read_text().count("\n") <= SHELL_LINES.get(path.stem, 2000)


def test_a_part_that_did_not_come_is_asked_for_again(path, tmp_path):
    """WEB-11, for a split shell: one failed fetch of a part used to leave every card of the shell dead until a reload. The ones
    still missing are asked for again, later each time, at an address of their own (a browser keeps a failed module's answer for
    its address); the shell's `then` runs once they are all there. Run in node, with the loader's own text and a stand-in
    import() that fails a part's first try."""
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    tool = _tool()
    man = _manifest(path)
    text = (ROOT / man["shell"]).read_text()
    block = text[text.index("  " + tool.LOADER_BEGIN):text.index(tool.LOADER_END)]
    assert "'retry=' + n" in block and "setTimeout(function () { loadParts(then, n + 1); }" in block and "PARTS_TRIES" in block
    assert "import(href)" in block                 # the first try at the build's own address
    harness = tmp_path / "loader.js"
    harness.write_text("""
globalThis.window = globalThis;
var asked = [], ran = 0, timers = [];
var names = %s;
globalThis.__import = function (u) {
  asked.push(u);
  if (u.indexOf('%s') >= 0 && u.indexOf('retry=') < 0) return Promise.reject(new Error('Load failed'));
  var key = u.split('/').pop().split('?')[0].replace(/\\.js$/, '');
  window.%s = window.%s || {};
  window.%s[key] = function () {};
  return Promise.resolve({});
};
globalThis.setTimeout = function (fn, ms) { timers.push(ms); fn(); };
console.warn = function () {};
%s
loadParts(function () { ran++; });
setTimeout = globalThis.setTimeout;
// wait for the promise chain to finish
var tries = 0;
(function wait() { if (ran || tries++ > 200) { console.log(JSON.stringify({ ran: ran, asked: asked, timers: timers })); return; } setTimeout.__real ? 0 : 0; Promise.resolve().then(wait); })();
""" % (json.dumps([p["name"] for p in man["parts"]]), man["parts"][1 if len(man["parts"]) > 1 else 0]["name"], man["global"],
        man["global"], man["global"], re.sub(r"\bimport\(", "__import(", block)))
    out = subprocess.run(["node", str(harness)], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout.strip().splitlines()[-1])
    failing = man["parts"][1 if len(man["parts"]) > 1 else 0]["name"]
    assert got["ran"] == 1
    assert sum(1 for u in got["asked"] if failing in u) == 2          # tried twice
    assert any("retry=1" in u for u in got["asked"] if failing in u)    # at an address of its own
    assert got["timers"] == [1000]                                       # after a pause that grows


def test_the_split_still_agrees_with_its_manifest(path):
    """tools/split_js.py --check on a split tree: the files are where the manifest says, the kit's takes and hand-backs match,
    and tsc finds no name a part cannot see (the proof of the move itself was made when the split was run)."""
    if shutil.which("node") is None or not (ROOT / "tools/typecheck/node_modules/typescript/package.json").is_file():
        pytest.skip("node or TypeScript (tools/typecheck) not installed")
    run = subprocess.run([sys.executable, str(ROOT / "tools/split_js.py"), path.stem, "--check"],
                         capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stdout + run.stderr


def test_a_shell_evaluated_twice_before_its_parts_arrive_runs_them_once(path, tmp_path):
    """The double-load guard is a flag set when the loader starts, not a global the parts define when they have run: two
    evaluations of the shell (hk-loader importing it at two addresses) before the parts arrive both asked for the parts and
    both ran them (two `window.customCards` entries). Run in node with the loader's own text and an import() that answers a
    turn later."""
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    tool = _tool()
    man = _manifest(path)
    text = (ROOT / man["shell"]).read_text()
    block = text[text.index("  " + tool.LOADER_BEGIN):text.index(tool.LOADER_END)]
    assert "__hkSplitStarted" in block and "__hkSplitDone" in block
    harness = tmp_path / "twice.js"
    harness.write_text("""
globalThis.window = globalThis;
var asked = [], ran = 0;
globalThis.__import = function (u) {
  asked.push(u);
  var key = u.split('/').pop().split('?')[0].replace(/\\.js$/, '');
  return new Promise(function (ok) { setImmediate(function () {
    window.%s = window.%s || {}; window.%s[key] = function () {}; ok({}); }); });
};
%s
loadParts(function () { ran++; });
loadParts(function () { ran++; });                  // the second evaluation, before any part has come
setTimeout(function () { console.log(JSON.stringify({ ran: ran, asked: asked.length, flag: window.__hkSplitStarted, done: window.__hkSplitDone })); }, 200);
""" % (man["global"], man["global"], man["global"], re.sub(r"\bimport\(", "__import(", block)))
    out = subprocess.run(["node", str(harness)], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout.strip().splitlines()[-1])
    assert got["ran"] == 1 and got["asked"] == len(man["parts"]) and got["flag"] == {man["label"]: True}
    assert got["done"] == {man["label"]: True}        # (what the browser checks wait for)


def test_a_known_shell_with_no_parts_list_is_an_error_not_a_plain_file(path, tmp_path, monkeypatch):
    """web_sources reads a file as "not a shell" when it has no parts list; for a path a manifest names (or hk-detail.js) that
    would hide its parts from every test that reads it, so it raises."""
    man = _manifest(path)
    monkeypatch.setattr(web_sources, "ROOT", tmp_path)
    monkeypatch.setattr(web_sources, "_known", None)
    (tmp_path / "tools/split_manifests").mkdir(parents=True)
    (tmp_path / "tools/split_manifests" / path.name).write_text(json.dumps({"shell": man["shell"]}))
    shell = tmp_path / man["shell"]
    shell.parent.mkdir(parents=True)
    shell.write_text("(function () { 'use strict'; var PARTS_GONE = []; })();\n")
    with pytest.raises(ValueError, match="has no parts list"):
        web_sources.parts(man["shell"])
    other = tmp_path / "web/hk/modules/plain.js"
    other.parent.mkdir(parents=True, exist_ok=True)
    other.write_text("(function () {})();\n")
    assert web_sources.parts("web/hk/modules/plain.js") == []
    detail = tmp_path / web_sources.DETAIL
    detail.parent.mkdir(parents=True, exist_ok=True)
    detail.write_text("(function () {})();\n")
    with pytest.raises(ValueError):
        web_sources.parts(web_sources.DETAIL)


SYNTHETIC = """(function () {
  'use strict';
  var LABEL = 'a';
  function twice(n) { return n * 2; }
  var LIMIT = 5, NAMES = ['x', 'y'];
  var doubled = twice(LIMIT);
  function use() { return LIMIT + NAMES.length + LABEL; }
  window.thing = { use: use, doubled: doubled };
})();
"""


def test_a_variable_that_touches_nothing_that_moved_stays_where_it_is_and_one_that_does_waits(path, tmp_path):
    """tools/split_js.py: a statement after the first moved member used to wait for the parts whatever it was, which took a
    `var` out of the scope the shell's functions are declared in (the saver has 238 of them). A variable whose initializer
    touches nothing that moved or waits stays in place; one that calls a moved function waits, and the tool refuses if a
    function that stays uses it (it could not see it there)."""
    if shutil.which("node") is None or not (ROOT / "tools/typecheck/node_modules/typescript/package.json").is_file():
        pytest.skip("node or TypeScript (tools/typecheck) not installed")
    tool = _tool()
    man = {"shell": "x.js", "folder": "web/hk/x", "global": "hkXParts", "label": "hk-x", "what": "X", "name": "x",
           "parts": [{"name": "hk-x-a", "title": "twice", "members": ["twice"]}]}
    plan, parts, shell = tool.build(man, SYNTHETIC, tmp_path / "ok")
    by = {m.label: m for m in plan.members.values()}
    assert not by["LIMIT"].late and by["doubled"].late              # LIMIT, NAMES: early; doubled calls `twice`, which moved
    assert "  var LIMIT = 5, NAMES = ['x', 'y'];" in shell          # where it was: the scope `use` is declared in
    assert "    var doubled = twice(LIMIT);" in shell               # in the function that waits for the parts
    assert tool.verify(plan, parts, shell, tmp_path / "ok") == []
    # the function that stays reads `doubled`, which waits: it cannot see it there
    with pytest.raises(tool.Refusal, match="waits for the parts"):
        tool.build(man, SYNTHETIC.replace("LIMIT + NAMES.length", "doubled + NAMES.length"), tmp_path / "late")


CLASS_SOURCE = """(function () {
  'use strict';
  var LABEL = 'a';
  var M = null;
  function twice(n) { return n * 2; }
  var TABLE = { a: 1 };
  class Panel extends HTMLElement {
    constructor() { super(); this.n = LABEL; this.h = this.helper.bind(this); }
    boot() { M = window.model; return TABLE.a; }
    go(x) { return twice(x) + M.k + this.helper(); }
    helper() { return 1; }
    get size() { return 2; }
    set size(v) { this._s = v; }
  }
  customElements.define('x-panel', Panel);
})();
"""

CLASS_MANIFEST = {"shell": "x.js", "folder": "web/hk/x", "global": "hkXParts", "label": "hk-x", "what": "X", "name": "x",
                  "class": "Panel", "kit_name": "KIT", "early": ["Panel", "customElements.define"], "early_methods": ["constructor"],
                  "live": ["M"], "shell_edits": [{"find": "M = window.model;", "replace": "M = window.model; bindLate();"}],
                  "parts": [{"name": "hk-x-tables", "title": "tables", "members": ["TABLE", "twice"], "methods": []},
                            {"name": "hk-x-go", "title": "go", "members": [], "methods": ["go", "size"]}]}


def _node_ready():
    return shutil.which("node") is not None and (ROOT / "tools/typecheck/node_modules/typescript/package.json").is_file()


def test_class_method_mode_moves_methods_into_a_class_expression_and_proves_it(path, tmp_path):
    """tools/split_js.py with a class named in the manifest: a part writes the methods it takes in `var Methods = class {...}` and
    hands them to the shell's install(); a variable the shell sets later (live) is bound by bindLate(); the constructor and what
    the shell needs before its parts are in stay."""
    if not _node_ready() or path.stem != "settings":                # (the same whichever manifest it is run for: once)
        pytest.skip("node or TypeScript (tools/typecheck) not installed, or run once, for the class's manifest")
    tool = _tool()
    man = json.loads(json.dumps(CLASS_MANIFEST))
    plan, parts, shell = tool.build(man, CLASS_SOURCE, tmp_path / "ok")
    assert tool.verify(plan, parts, shell, tmp_path / "ok") == []
    go = parts["hk-x-go.js"]
    assert "var Methods = class extends /** @type {any} */ (Object) {" in go and "KIT.install(Methods);" in go
    assert "    var M;" in go and "KIT.late.push(function (s) {" in go           # its own copy of the live variable
    assert "go(x) { return twice(x) + M.k + this.helper(); }" in go and "get size() { return 2; }" in go
    assert "helper() { return 1; }" in shell and "go(x)" not in shell             # helper stayed (not named): the constructor binds it
    assert "customElements.define('x-panel', Panel);" in shell.split("var partsReady")[0]          # defined at once
    assert "M = window.model; bindLate();" in shell and "var partsReady = new Promise(" in shell
    assert "function install(from) {" in shell and "enumerable: false" in shell


def test_class_method_mode_refuses_what_a_move_would_change(path, tmp_path):
    if not _node_ready() or path.stem != "settings":
        pytest.skip("node or TypeScript (tools/typecheck) not installed, or run once, for the class's manifest")
    tool = _tool()

    def refused(source, edit, why):
        man = json.loads(json.dumps(CLASS_MANIFEST))
        edit(man)
        with pytest.raises(tool.Refusal, match=why):
            tool.build(man, source, tmp_path / why[:12].replace(" ", "_"))

    # a method the constructor reaches through `this` cannot move (it runs before the parts are in)
    refused(CLASS_SOURCE, lambda m: m["parts"][1]["methods"].append("helper"), "runs before the parts are in")
    # `super` would mean another prototype in a class expression
    refused(CLASS_SOURCE.replace("go(x) { return", "go(x) { super.go(); return"), lambda m: None, "uses `super`")
    # a moved method that sets a variable of the shell (a copy through the kit would go stale)
    refused(CLASS_SOURCE.replace("var LABEL = 'a';", "var LABEL = 'a', COUNT = 0;").replace("go(x) { return", "go(x) { COUNT++; return"),
            lambda m: None, "assigns `COUNT`")
    # a name the manifest gives that the class does not have
    refused(CLASS_SOURCE, lambda m: m["parts"][1]["methods"].append("nope"), "is not a method")
    # the constructor
    refused(CLASS_SOURCE, lambda m: m["parts"][1]["methods"].append("constructor"), "is the constructor")
    # a variable set later by the shell must say so: without bindLate() after the assignment the parts keep a stale copy
    man = json.loads(json.dumps(CLASS_MANIFEST))
    man["shell_edits"] = []
    plan, parts, shell = tool.build(man, CLASS_SOURCE, tmp_path / "late")
    assert any("bindLate()" in b for b in tool.verify(plan, parts, shell, tmp_path / "late"))


# ------------------------------------------------------------------------------------------------ phase 24, A2
DECL_SOURCE = """(function () {
  'use strict';
  var NAME = 'x';
  function initialize() {
    var LIMIT = 3;
    function twice(n) { return n * LIMIT; }
    function valueOf() { return twice(2); }
    window.thing = { v: valueOf, name: NAME };
  }
  initialize();
})();
"""

THREE_IIFES = """(function () {
  window.first = 1;
})();
(function () {
  'use strict';
  function a() { return 1; }
  function b() { return a() + 1; }
  window.second = b;
})();
"""


def test_a_declared_function_is_a_scope_and_a_member_named_valueof_moves(path, tmp_path):
    """run_in_decl: the body of a function declared in the IIFE (hk-base.js's initialize) is the scope the parts are cut
    from; a member named `valueOf` (hk-chip.js) no longer meets Object.prototype's in the analyzer's name table."""
    if not _node_ready() or path.stem != "grid-cards":
        pytest.skip("node or TypeScript (tools/typecheck) not installed, or run once")
    tool = _tool()
    man = {"shell": "x.js", "folder": "web/hk/x", "global": "hkXParts", "label": "hk-x", "what": "X", "name": "x",
           "run_in_decl": "initialize", "parts": [{"name": "hk-x-a", "title": "a", "members": ["twice", "valueOf"]}]}
    plan, parts, shell = tool.build(man, DECL_SOURCE, tmp_path / "decl")
    assert tool.verify(plan, parts, shell, tmp_path / "decl") == []
    a = parts["hk-x-a.js"]
    assert "function valueOf() { return twice(2); }" in a and "var LIMIT = K.LIMIT;" in a
    assert "  function initialize() {" in shell and "      runParts();" in shell


def test_the_iife_a_manifest_names_is_the_one_cut(path, tmp_path):
    if not _node_ready() or path.stem != "grid-cards":
        pytest.skip("node or TypeScript (tools/typecheck) not installed, or run once")
    tool = _tool()
    man = {"shell": "x.js", "folder": "web/hk/x", "global": "hkXParts", "label": "hk-x", "what": "X", "name": "x",
           "iife": 1, "parts": [{"name": "hk-x-a", "title": "a", "members": ["a"]}]}
    plan, parts, shell = tool.build(man, THREE_IIFES, tmp_path / "iife")
    assert tool.verify(plan, parts, shell, tmp_path / "iife") == []
    assert shell.startswith("(function () {\n  window.first = 1;\n})();")
    assert "function a() { return 1; }" in parts["hk-x-a.js"]


def test_the_report_groups_members_by_what_they_reassign(path, tmp_path):
    if not _node_ready() or path.stem != "grid-cards":
        pytest.skip("node or TypeScript (tools/typecheck) not installed, or run once")
    tool = _tool()
    f = tmp_path / "r.js"
    f.write_text("""(function () {
  var count = 0, LABEL = 'a';
  function bump() { count++; }
  function show() { return count + LABEL; }
  function other() { var local = 1; local = 2; return local; }
})();
""")
    rep = tool.report(f, {})
    big = [g for g in rep["groups"] if g["reassigned"]]
    assert len(big) == 1 and big[0]["reassigned"] == ["count"]
    assert set(big[0]["members"]) == {"count", "bump", "show"}          # LABEL is declared with count: one statement
    assert not any("other" in g["members"] for g in big)                 # a function's own var is not shared state
