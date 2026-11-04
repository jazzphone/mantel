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
        "hk-grid-vacuum-card", "hk-on-now-card", "hk-suggested-scene-card"),
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


def test_the_register_calls_stay_in_the_shell(path):
    """hk_cards.tags_of reads a lazy card file's `register('hk-...'` calls: the shell's tags are what they were before the
    split, and no part defines an element."""
    man = _manifest(path)
    shell = ROOT / man["shell"]
    if man["shell"] in TAGS:
        assert hk_cards.tags_of(shell) == TAGS[man["shell"]]
    assert hk_cards.tags_of(shell)
    for f in sorted((ROOT / man["folder"]).glob("*.js")):
        assert hk_cards.tags_of(f) == (), f.name
        assert "customElements.define" not in f.read_text() and ".register(" not in f.read_text(), f.name


def test_every_part_has_the_header_and_registers_under_its_own_name(path):
    man = _manifest(path)
    shell = Path(man["shell"]).name
    for part in man["parts"]:
        text = (ROOT / man["folder"] / (part["name"] + ".js")).read_text()
        assert text.startswith(f"// {part['name']}.js - "), part["name"]
        head = re.sub(r"\n// ?", " ", text[:text.index("(function () {")])
        assert f"PART OF {man['what']} ({shell}). Not a card and not run on its own" in head
        assert "takes from K at the top" in head and "it hands back at the bottom" in head
        assert "(function () {\n  'use strict';\n" in text
        assert f"(window.{man['global']} = window.{man['global']} || {{}})['{part['name']}'] = function (K) {{" in text
        assert text.endswith("  };\n})();\n")


def test_the_parts_keep_to_the_size_the_split_is_for(path):
    man = _manifest(path)
    for f in (ROOT / man["folder"]).glob("*.js"):
        assert f.read_text().count("\n") <= 2000, f.name
    assert (ROOT / man["shell"]).read_text().count("\n") <= 3500


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
