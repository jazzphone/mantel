"""tools/split_py.py (phase 24, A3: docs/phase24/CLEAN-CODE.md): a big Python module cut into parts by name, and proved.

On a synthetic module in a temporary package: the package mode's proof (each statement's syntax tree, the same names, the
same objects), a relative import one level deeper, the refusals (a later part, a name bound in two parts, an import-time
read before a later binder, a monkeypatched name apart from its reader) and a planted mistake the proof catches.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _tool():
    spec = importlib.util.spec_from_file_location("split_py", ROOT / "tools/split_py.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["split_py"] = mod
    spec.loader.exec_module(mod)
    return mod


SOURCE = '''"""A module to cut."""
from __future__ import annotations

import json
from . import helper as H

LIMIT = 3
NAMES = ("a", "b")
NAMES += ("c",)


def twice(n: int) -> int:
    return n * LIMIT


def show() -> str:
    from .helper import word
    return json.dumps([twice(2), word(), H.WORD])


class Box:
    size = LIMIT

    def total(self) -> int:
        return twice(self.size)
'''

MAN = {"module": "pkg/mod.py", "mode": "package", "name": "mod",
       "parts": [{"name": "base", "title": "the limits", "members": ["LIMIT", "NAMES"]},
                 {"name": "maths", "title": "the maths", "members": ["twice"]},
                 {"name": "rest", "title": "the rest", "rest": True, "members": []}]}


@pytest.fixture()
def tree(tmp_path, monkeypatch):
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg/__init__.py").write_text("")
    (tmp_path / "pkg/helper.py").write_text("WORD = 'w'\n\ndef word():\n    return WORD\n")
    (tmp_path / "pkg/mod.py").write_text(SOURCE)
    (tmp_path / "tests").mkdir()
    tool = _tool()
    monkeypatch.setattr(tool, "ROOT", tmp_path)
    return tool, tmp_path


def test_a_module_becomes_a_package_and_the_proof_holds(tree):
    tool, root = tree
    assert tool.do_split(json.loads(json.dumps(MAN)), check_only=False) == 0
    pkg = root / "pkg/mod"
    assert sorted(p.name for p in pkg.glob("*.py")) == ["__init__.py", "base.py", "maths.py", "rest.py"]
    rest = (pkg / "rest.py").read_text()
    assert "    from ..helper import word" in rest                     # one level deeper
    assert "from .maths import twice" in rest and "from .base import LIMIT" in rest
    init = (pkg / "__init__.py").read_text()
    assert "from .base import LIMIT, NAMES" in init and "'twice'," in init
    out = subprocess.run([sys.executable, "-c", "import pkg.mod as m; print(m.show(), m.NAMES, m.Box().total())"],
                         cwd=root, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert out.stdout.split() == ['[6,', '"w",', '"w"]', "('a',", "'b',", "'c')", "9"]


def test_it_refuses_what_a_move_would_change(tree, tmp_path):
    tool, root = tree

    def refused(edit, why, source=SOURCE):
        man = json.loads(json.dumps(MAN))
        edit(man)
        plan = tool.make_plan(man, source)
        assert any(why in r for r in plan.refusals), plan.refusals

    # a part that uses a later part
    refused(lambda m: m["parts"][0]["members"].append("show"), "of the later part")
    # NAMES += ... is a binder: it goes with NAMES (the tool puts an unnamed statement with the one before it, so name the
    # binder's neighbor elsewhere to force the split)
    src = SOURCE.replace('NAMES += ("c",)', 'EXTRA = 1\nNAMES += ("c",)')
    refused(lambda m: m["parts"][1]["members"].append("EXTRA"), "binds `NAMES`", src)
    # an import-time read before a later binder
    src2 = SOURCE.replace('NAMES += ("c",)', 'FIRST = NAMES[0]\nNAMES += ("c",)')
    refused(lambda m: m["parts"][1]["members"].append("FIRST"), "at import time", src2)


def test_a_monkeypatched_name_stays_with_its_readers(tree):
    tool, root = tree
    (root / "tests/test_x.py").write_text("import pkg.mod as M\n\ndef test(monkeypatch):\n    monkeypatch.setattr(M, 'LIMIT', 9)\n")
    plan = tool.make_plan(json.loads(json.dumps(MAN)), SOURCE)
    assert any("monkeypatched" in r and "`LIMIT`" in r for r in plan.refusals)


def test_the_proof_catches_a_planted_change(tree):
    tool, root = tree
    plan = tool.make_plan(json.loads(json.dumps(MAN)), SOURCE)
    files = tool.build(plan)
    files["pkg/mod/maths.py"] = files["pkg/mod/maths.py"].replace("return n * LIMIT", "return n * LIMIT + 1")
    assert any("twice" in b for b in tool.prove(plan, files))
    ast.parse(files["pkg/mod/rest.py"])
