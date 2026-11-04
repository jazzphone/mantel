"""tools/split_js.py --check says which moved members were edited since the split by their CODE: a part is annotated for the
type checker (phase 18, C1: JSDoc comments, and `/** @type {T} */ (x)` casts whose parentheses are the only thing they add), and
that is not an edit; a changed token is."""
from __future__ import annotations

import importlib.util
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

PLAIN = """(function () {
  'use strict';
  function f(x, el) {
    var v = el.value;
    return x.a + v.length; // sums
  }
  class Card {
    go(e) { return e.target.id + 1; }
  }
})();
"""
ANNOTATED = """(function () {
  'use strict';
  /**
   * @param {any} x
   * @param {Element} el
   */
  function f(x, el) {
    var v = /** @type {HTMLInputElement} */ (el).value;
    return /** @type {any} */ (x).a + v.length; // sums, as a number
  }
  class Card {
    /** @param {Event} e */
    go(e) { return /** @type {Element} */ (e.target).id + 1; }
  }
})();
"""
EDITED = PLAIN.replace("e.target.id + 1", "e.target.id + 2")


def _tool():
    spec = importlib.util.spec_from_file_location("split_js", ROOT / "tools/split_js.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["split_js"] = mod
    spec.loader.exec_module(mod)
    return mod


def _members(tool, path: Path) -> dict[str, tuple[str, str]]:
    out = {}
    for sc in tool.analyze(path, "shell", None)["scopes"]:
        for st in sc["stmts"]:
            for n in st["names"]:
                out[n] = (st["text"], st["code"])
    return out


@pytest.mark.skipif(shutil.which("node") is None or not (ROOT / "tools/typecheck/node_modules/typescript/package.json").is_file(),
                    reason="node or TypeScript (tools/typecheck) not installed")
def test_comments_and_cast_parentheses_are_not_an_edit_but_a_changed_token_is(tmp_path):
    tool = _tool()
    files = {}
    for name, text in (("plain", PLAIN), ("annotated", ANNOTATED), ("edited", EDITED)):
        files[name] = tmp_path / f"{name}.js"
        files[name].write_text(text)
    plain, annotated, edited = (_members(tool, files[n]) for n in ("plain", "annotated", "edited"))
    for name in ("f", "Card"):
        assert plain[name][0] != annotated[name][0], "the text differs (the annotation is there)"
    assert plain["f"][1] == annotated["f"][1] and plain["Card"][1] == annotated["Card"][1], "the code does not"
    assert plain["f"][1] == edited["f"][1] and plain["Card"][1] != edited["Card"][1], "a changed token does"
