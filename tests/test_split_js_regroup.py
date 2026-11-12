"""split_js.py --regroup (phase 25, Part E): a class-method part cut into the parts its manifest now lists, each method's
text moved whole, nothing else; refused when a method is listed twice or is nowhere."""
from __future__ import annotations

import importlib
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
pytestmark = pytest.mark.skipif(not shutil.which("node") or not (ROOT / "tools/typecheck/node_modules/typescript/package.json").is_file(),
                                reason="needs Node.js and the pinned TypeScript (tools/typecheck: npm ci)")

PART = """// p-one.js - one part.
//
// PART OF THE X PAGE (x.js). Not a card and not run on its own: it registers one
// function, which x.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.xParts = window.xParts || {})['p-one'] = function (KIT) {
    var A = KIT.A, B = KIT.B;

    var h;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h;
    });

    var Methods = class extends /** @type {any} */ (Object) {
      // the first, which stays
      one() { return A + 1; }

      // THE SECOND: it moves, its comment with it
      two(x) {
        return B + x + h;
      }
      three() { return 3; }
    };
    KIT.install(Methods);
  };
})();
"""


def man(parts):
    return {"name": "x", "shell": "web/x.js", "folder": "web/xparts", "global": "xParts", "label": "x", "what": "THE X PAGE",
            "class": "X", "kit_name": "KIT", "parts": parts}


def test_methods_move_whole_with_their_comment_takes_and_late_names(tmp_path, monkeypatch, capsys):
    rg = importlib.import_module("split_js_regroup")
    monkeypatch.setattr(rg, "ROOT", tmp_path)
    (tmp_path / "web/xparts").mkdir(parents=True)
    (tmp_path / "web/xparts/p-one.js").write_text(PART)
    m = man([{"name": "p-one", "title": "one", "methods": ["one"]},
             {"name": "p-two", "title": "two and three", "methods": ["two", "three"]}])
    assert rg.regroup(m, write=True) == []
    one, two = (tmp_path / "web/xparts/p-one.js").read_text(), (tmp_path / "web/xparts/p-two.js").read_text()
    assert "one() { return A + 1; }" in one and "two(" not in one and "three()" not in one
    assert "      // THE SECOND: it moves, its comment with it\n      two(x) {\n        return B + x + h;\n      }" in two
    assert "    var B = KIT.B;" in two and "A = KIT.A" not in two          # what its methods name of what the old file took
    assert "      h = s.h;" in two and "KIT.install(Methods);" in two and two.startswith("// p-two.js - two and three.")


def test_a_method_listed_twice_or_nowhere_refuses(tmp_path, monkeypatch):
    rg = importlib.import_module("split_js_regroup")
    monkeypatch.setattr(rg, "ROOT", tmp_path)
    (tmp_path / "web/xparts").mkdir(parents=True)
    (tmp_path / "web/xparts/p-one.js").write_text(PART)
    assert "listed in two parts" in rg.regroup(man([{"name": "p-one", "title": "a", "methods": ["one", "two"]},
                                                    {"name": "p-two", "title": "b", "methods": ["two"]}]), write=False)[0]
    assert "no part has" in rg.regroup(man([{"name": "p-one", "title": "a", "methods": ["one", "four"]}]), write=False)[0]
