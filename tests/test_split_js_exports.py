"""tools/split_js_exports.cjs (phase 25): a split part reads a later part's exports object only when called, never as the
parts run (the object is still empty then). split_js.py --check runs it for every shell whose kit makes exports objects;
this pins what it finds and what it lets be."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")

PART = """(function () {
  (window.hkSaverParts = window.hkSaverParts || {})['x'] = function (K) {
    var Run = K.Run, Draw = K.Draw;
    function early() { return Run.start(); }
    function deeper() { return early(); }
    function later() { return Draw.paint(); }
    var v = deeper();
    if (Draw.ready) v = 1;
    var Pane = K.Pane;
    Pane.ok = later;
    setTimeout(function () { Run.stop(); }, 0);
  };
})();
"""


def run(files, exports):
    got = subprocess.run(["node", str(ROOT / "tools/split_js_exports.cjs")], capture_output=True, text=True, check=True,
                         input=json.dumps({"files": [str(f) for f in files], "exports": exports}))
    return json.loads(got.stdout)["bad"]


def test_a_read_as_the_parts_run_is_found_directly_and_through_what_it_calls(tmp_path):
    f = tmp_path / "x.js"
    f.write_text(PART)
    bad = run([f], ["Run", "Draw", "Pane"])
    assert any("early() reads Run.start" in b for b in bad), bad          # through deeper() -> early()
    assert any(":8: reads Draw.ready as the parts run" in b for b in bad), bad
    assert not any("Run.stop" in b or "Draw.paint" in b or "Pane.ok" in b for b in bad), bad   # when called; its own filling
    assert len(bad) == 2


def test_the_screensavers_parts_never_read_an_exports_object_as_they_run():
    files = sorted((ROOT / "web/hk/saver").glob("*.js"))
    assert run(files, ["Run", "Black", "Pane", "Screens", "Layout", "Draw", "Music"]) == []
